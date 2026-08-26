import { _electron as electron, chromium, type ElectronApplication, type Page } from '@playwright/test'
import { assertElectronCanLaunchAsApp } from './electronLaunchEnvironment'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { strFromU8, strToU8, Unzip, UnzipInflate, unzipSync, zipSync } from 'fflate'

interface Options {
  caseDir: string
  editorRoot: string
  inventory: string
  project: string
  report: string
  deliveryHtml?: string
  deliveryWebPackage?: string
  deliveryPdf?: string
  deliveryPptx?: string
  verifyReport: boolean
  writeDeliveries: boolean
}

interface InventoryEntity {
  id: string
  kind: string
  binding: string
  requiredForAcceptance: boolean
}

interface NativeTextTarget extends InventoryEntity {
  sceneId: string
  nodeId: string
  field: 'text'
}

interface ProjectNode {
  id: string
  type: string
  text?: string
  x: number
  y: number
  width: number
  height: number
  visible?: boolean
}

interface ProjectScene {
  id: string
  nodes: ProjectNode[]
  presentation?: {
    initialStateId: string
    states: Array<{
      id: string
      nodeOverrides?: Record<string, { visible?: boolean, text?: string }>
    }>
  }
}

interface ProjectDocument {
  schemaVersion: number
  scenes: ProjectScene[]
}

interface EntityReceipt {
  inventoryEntityId: string
  binding: string
  carrier: 'native-scene-text'
  status: 'passed' | 'unsupported' | 'failed'
  probeValue?: string
  selectedNodeId?: string
  canvasSelectionVerified?: boolean
  renderedBounds?: { x: number, y: number, width: number, height: number }
  observationStateId?: string
  saved?: boolean
  reopened?: boolean
  player?: {
    beforeSha256: string
    afterSha256: string
    changed: boolean
  }
  html?: {
    beforeSha256: string
    afterSha256: string
    changed: boolean
  }
  errors: string[]
}

interface AuthoringReceipt {
  schemaVersion: 1
  receiptType: 'editor-authoring-session-v1'
  caseId: string
  runnerSha256: string
  inputs: {
    projectSha256: string
    inventorySha256: string
    coursewareContractSha256: string
    presentationScriptSha256: string
    developmentPlanSha256: string
    capabilityIndexSha256: string
  }
  editorBuild: Record<string, string>
  exporter: {
    kind: 'editor-single-html-ui-v1'
    viewport: { width: 1280, height: 720 }
    checkedDeliveryPath: string | null
    exportedSha256: string
    deliverySha256: string | null
    deliveryMatches: boolean
    deliveries: Record<'html' | 'webPackage' | 'pdf' | 'pptx', {
      path: string
      exportedSha256: string
      deliverySha256: string
      matches: boolean
      algorithm: DeliveryFingerprintAlgorithm
      canonicalSha256: string
    }>
  }
  entities: EntityReceipt[]
  errors: string[]
}

type DeliveryKind = 'html' | 'webPackage' | 'pdf' | 'pptx'
type DeliveryFingerprintAlgorithm =
  | 'raw-sha256-v1'
  | 'zip-members-sha256-v1'
  | 'pdf-info-time-normalized-sha256-v1'
  | 'pptx-members-core-time-normalized-sha256-v1'

const DELIVERY_FINGERPRINT_ALGORITHMS: Record<DeliveryKind, DeliveryFingerprintAlgorithm> = {
  html: 'raw-sha256-v1',
  webPackage: 'zip-members-sha256-v1',
  pdf: 'pdf-info-time-normalized-sha256-v1',
  pptx: 'pptx-members-core-time-normalized-sha256-v1',
}

const usage = [
  'Usage: npm run --silent run-courseware-authoring -- --case-dir <dir> [options]',
  '  --editor-root <dir>    editor checkout (default current directory)',
  '  --inventory <path>     case-relative inventory path',
  '  --project <path>       case-relative Course Project V9 path',
  '  --report <path>        case-relative receipt path',
  '  --delivery-html <path> case-relative delivered HTML to byte-compare with a fresh UI export',
  '  --delivery-web-package <path> case-relative delivered web-package ZIP',
  '  --delivery-pdf <path>  case-relative delivered PDF',
  '  --delivery-pptx <path> case-relative delivered PPTX',
  '  --write-deliveries     explicitly create/replace all four delivery paths from real UI exports',
  '  --write-delivery-html  legacy alias for --write-deliveries',
  '  --verify-report        rerun and compare stable receipt claims; do not overwrite',
].join('\n')

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string>()
  let verifyReport = false
  let writeDeliveries = false
  const flags = new Set([
    '--case-dir', '--editor-root', '--inventory', '--project', '--report', '--delivery-html',
    '--delivery-web-package', '--delivery-pdf', '--delivery-pptx',
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--verify-report') {
      verifyReport = true
      continue
    }
    if (flag === '--write-delivery-html' || flag === '--write-deliveries') {
      writeDeliveries = true
      continue
    }
    if (!flag || !flags.has(flag)) throw new Error(`unknown argument: ${flag ?? ''}\n${usage}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value\n${usage}`)
    values.set(flag, value)
  }
  const caseDir = values.get('--case-dir')
  if (!caseDir) throw new Error(`--case-dir is required\n${usage}`)
  if (verifyReport && writeDeliveries) throw new Error('--verify-report forbids --write-deliveries')
  return {
    caseDir,
    editorRoot: values.get('--editor-root') ?? '.',
    inventory: values.get('--inventory') ?? 'implementation/authoring-inventory.json',
    project: values.get('--project') ?? '',
    report: values.get('--report') ?? 'evidence/authoring-session-report.json',
    deliveryHtml: values.get('--delivery-html'),
    deliveryWebPackage: values.get('--delivery-web-package'),
    deliveryPdf: values.get('--delivery-pdf'),
    deliveryPptx: values.get('--delivery-pptx'),
    verifyReport,
    writeDeliveries,
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function pathIdentity(filename: string): string {
  const resolved = existsSync(filename) ? realpathSync.native(filename) : path.resolve(filename)
  if (existsSync(filename)) {
    const metadata = statSync(filename, { bigint: true })
    if (metadata.ino !== 0n) return `inode:${metadata.dev}:${metadata.ino}`
  }
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function requireExtension(filename: string, extensions: readonly string[], label: string): void {
  if (!extensions.includes(path.extname(filename).toLowerCase())) {
    throw new Error(`${label} must use ${extensions.join(' or ')}`)
  }
}

function inside(root: string, value: string, label: string): string {
  const resolved = path.resolve(root, value)
  if (!isWithin(root, resolved)) throw new Error(`${label} escapes case directory: ${value}`)
  const realRoot = realpathSync.native(root)
  let existing = resolved
  while (!existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error(`${label} has no existing safe parent: ${value}`)
    existing = parent
  }
  const realExisting = realpathSync.native(existing)
  if (!isWithin(realRoot, realExisting)) {
    throw new Error(`${label} resolves through a symlink/reparse point outside the case: ${value}`)
  }
  return resolved
}

async function enforceOffline(page: Page, errors: string[]): Promise<void> {
  await page.route('**/*', async (route) => {
    const protocol = new URL(route.request().url()).protocol
    if (protocol === 'http:' || protocol === 'https:') {
      errors.push(`external network request blocked: ${route.request().url()}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  await page.routeWebSocket(/.*/, (route) => {
    errors.push(`external WebSocket blocked: ${route.url()}`)
  })
}

async function installElectronOfflineGuard(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session }) => {
    const blocked: string[] = []
    Reflect.set(globalThis, '__coursewareAuthoringBlockedNetwork', blocked)
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        blocked.push(details.url)
        callback({ cancel: true })
      },
    )
  })
}

async function electronBlockedNetwork(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const value = Reflect.get(globalThis, '__coursewareAuthoringBlockedNetwork') as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  })
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (typeof item === 'object' && item !== null) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      )
    }
    return item
  }
  return JSON.stringify(normalize(value))
}

function framedMembersSha256(
  algorithm: DeliveryFingerprintAlgorithm,
  members: Readonly<Record<string, Uint8Array>>,
): string {
  const digest = createHash('sha256')
  digest.update(`${algorithm}\0`)
  for (const name of Object.keys(members).sort()) {
    const nameBytes = Buffer.from(name, 'utf8')
    const value = members[name]!
    digest.update(`${nameBytes.byteLength}:`)
    digest.update(nameBytes)
    digest.update(`${value.byteLength}:`)
    digest.update(value)
  }
  return digest.digest('hex')
}

function assertSafeUniqueZipMembers(bytes: Uint8Array): void {
  const value = Buffer.from(bytes)
  const minimumEocdOffset = Math.max(0, value.byteLength - 65_557)
  let eocd = -1
  for (let offset = value.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (value.readUInt32LE(offset) === 0x06054b50 && offset + 22 + value.readUInt16LE(offset + 20) === value.byteLength) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP has no valid end-of-central-directory record')
  const disk = value.readUInt16LE(eocd + 4)
  const centralDisk = value.readUInt16LE(eocd + 6)
  const diskEntries = value.readUInt16LE(eocd + 8)
  const totalEntries = value.readUInt16LE(eocd + 10)
  const centralSize = value.readUInt32LE(eocd + 12)
  const centralOffset = value.readUInt32LE(eocd + 16)
  if (
    disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries ||
    totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
  ) {
    throw new Error('multi-disk and ZIP64 archives are not supported for trusted delivery fingerprints')
  }
  if (centralOffset + centralSize !== eocd) {
    throw new Error('ZIP central directory bounds are inconsistent')
  }
  const localNames: string[] = []
  const localUnzip = new Unzip((file) => {
    localNames.push(file.name.normalize('NFC'))
    file.ondata = (error) => {
      if (error) throw error
    }
    file.start()
  })
  localUnzip.register(UnzipInflate)
  localUnzip.push(bytes, true)
  const names = new Set<string>()
  let cursor = centralOffset
  let entries = 0
  while (cursor < eocd) {
    if (cursor + 46 > eocd || value.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('ZIP central directory member is malformed')
    }
    const flags = value.readUInt16LE(cursor + 8)
    const nameLength = value.readUInt16LE(cursor + 28)
    const extraLength = value.readUInt16LE(cursor + 30)
    const commentLength = value.readUInt16LE(cursor + 32)
    const diskStart = value.readUInt16LE(cursor + 34)
    const localOffset = value.readUInt32LE(cursor + 42)
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength
    if (entryEnd > eocd || diskStart !== 0 || localOffset === 0xffffffff) {
      throw new Error('ZIP central directory member bounds are invalid or ZIP64')
    }
    const nameBytes = value.subarray(cursor + 46, cursor + 46 + nameLength)
    if ((flags & 0x800) === 0 && nameBytes.some((byte) => byte > 0x7f)) {
      throw new Error('non-ASCII ZIP member names must be explicit UTF-8')
    }
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes)
    if (
      !name || name.includes('\0') || name.includes('\\') || name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').some((part, index, parts) => (
        part === '.' || part === '..' || (part === '' && index !== parts.length - 1)
      ))
    ) {
      throw new Error(`ZIP member path is not portable and safe: ${JSON.stringify(name)}`)
    }
    const normalized = name.normalize('NFC')
    if (names.has(normalized)) throw new Error(`ZIP contains a duplicate normalized member: ${name}`)
    names.add(normalized)
    if (localOffset + 30 > centralOffset || value.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`ZIP member has an invalid local header: ${name}`)
    }
    const localNameLength = value.readUInt16LE(localOffset + 26)
    const localName = value.subarray(localOffset + 30, localOffset + 30 + localNameLength)
    if (!nameBytes.equals(localName)) throw new Error(`ZIP central/local names differ: ${name}`)
    cursor = entryEnd
    entries += 1
  }
  if (cursor !== eocd || entries !== totalEntries || entries === 0) {
    throw new Error('ZIP central directory count is inconsistent')
  }
  const centralNames = [...names]
  if (
    localNames.length !== centralNames.length ||
    localNames.some((name, index) => name !== centralNames[index])
  ) {
    throw new Error('ZIP local headers and central directory are not an exact ordered member set')
  }
}

function canonicalPptxCoreXml(bytes: Uint8Array): Uint8Array {
  let xml = strFromU8(bytes)
  for (const tag of ['created', 'modified'] as const) {
    let replacements = 0
    const pattern = new RegExp(
      `(<dcterms:${tag}\\b[^>]*>)[^<]*(</dcterms:${tag}>)`,
      'g',
    )
    xml = xml.replace(pattern, (_match, open: string, close: string) => {
      replacements += 1
      return `${open}1970-01-01T00:00:00Z${close}`
    })
    if (replacements !== 1) {
      throw new Error(`PPTX docProps/core.xml must contain exactly one dcterms:${tag}`)
    }
  }
  return strToU8(xml)
}

function canonicalChromiumPdf(bytes: Uint8Array): Uint8Array {
  const value = Buffer.from(bytes)
  if (!value.subarray(0, 8).toString('latin1').startsWith('%PDF-')) {
    throw new Error('PDF delivery has no PDF header')
  }
  const firstObjectEnd = value.indexOf(Buffer.from('endobj', 'ascii'))
  if (firstObjectEnd < 0 || firstObjectEnd > 64 * 1024) {
    throw new Error('PDF delivery has no bounded first metadata object')
  }
  let info = value.subarray(0, firstObjectEnd).toString('latin1')
  if (!info.includes('/Creator (Chromium)') || !info.includes('/Producer (Skia/PDF')) {
    throw new Error('PDF delivery is not the expected Chromium/Skia export')
  }
  for (const key of ['CreationDate', 'ModDate'] as const) {
    let replacements = 0
    const pattern = new RegExp(
      `(\\/${key}\\s*\\()D:\\d{14}(?:Z|[+-]\\d{2}'\\d{2}')(\\))`,
      'g',
    )
    info = info.replace(pattern, (_match, open: string, close: string) => {
      replacements += 1
      return `${open}D:19700101000000+00'00'${close}`
    })
    if (replacements !== 1) {
      throw new Error(`Chromium PDF metadata must contain exactly one ${key}`)
    }
  }
  return Buffer.concat([
    Buffer.from(info, 'latin1'),
    value.subarray(firstObjectEnd),
  ])
}

export function canonicalDeliveryFingerprint(
  kind: DeliveryKind,
  bytes: Uint8Array,
): { algorithm: DeliveryFingerprintAlgorithm, sha256: string } {
  const algorithm = DELIVERY_FINGERPRINT_ALGORITHMS[kind]
  if (kind === 'html') return { algorithm, sha256: sha256(bytes) }
  if (kind === 'pdf') return { algorithm, sha256: sha256(canonicalChromiumPdf(bytes)) }
  assertSafeUniqueZipMembers(bytes)
  const members = unzipSync(bytes)
  if (Object.keys(members).length === 0) throw new Error(`${kind} archive is empty`)
  if (kind === 'pptx') {
    const core = members['docProps/core.xml']
    if (!core) throw new Error('PPTX delivery has no docProps/core.xml')
    members['docProps/core.xml'] = new Uint8Array(canonicalPptxCoreXml(core))
  }
  return { algorithm, sha256: framedMembersSha256(algorithm, members) }
}

function portableRelative(root: string, filename: string): string {
  return path.relative(root, filename).split(path.sep).join('/')
}

async function hashFile(filename: string): Promise<string> {
  return sha256(await readFile(filename))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nativeTextNodeFromLayer(item: unknown): ProjectNode | null {
  const layer = asRecord(item)
  const content = asRecord(layer?.content)
  const data = asRecord(content?.data)
  const frame = asRecord(layer?.frame)
  if (
    !layer ||
    layer.kind !== 'native' ||
    content?.nativeType !== 'text' ||
    typeof layer.layerItemId !== 'string' ||
    typeof data?.text !== 'string' ||
    !frame
  ) {
    return null
  }
  return {
    id: layer.layerItemId,
    type: 'text',
    text: data.text,
    x: Number(frame.x),
    y: Number(frame.y),
    width: Number(frame.width),
    height: Number(frame.height),
    visible: layer.visible !== false,
  }
}

function presentationFromV9Scene(scene: Record<string, unknown>): ProjectScene['presentation'] {
  const presentation = asRecord(scene.presentation)
  if (!presentation || typeof presentation.initialStateId !== 'string' || !Array.isArray(presentation.states)) {
    return undefined
  }
  return {
    initialStateId: presentation.initialStateId,
    states: presentation.states.flatMap((candidate) => {
      const state = asRecord(candidate)
      if (!state || typeof state.id !== 'string') return []
      const overrides = asRecord(state.layerItemOverrides) ?? {}
      const nodeOverrides: NonNullable<NonNullable<ProjectScene['presentation']>['states'][number]['nodeOverrides']> = {}
      for (const [layerItemId, raw] of Object.entries(overrides)) {
        const override = asRecord(raw)
        if (!override) continue
        const mapped: { visible?: boolean, text?: string } = {}
        if (typeof override.visible === 'boolean') mapped.visible = override.visible
        const nativeData = asRecord(override.nativeData)
        if (typeof nativeData?.text === 'string') mapped.text = nativeData.text
        if (Object.keys(mapped).length > 0) nodeOverrides[layerItemId] = mapped
      }
      return [{ id: state.id, nodeOverrides }]
    }),
  }
}

function slideScenesFromCourseProject(value: Record<string, unknown>): ProjectScene[] {
  const surfaces = Array.isArray(value.surfaces) ? value.surfaces : []
  const scenes: ProjectScene[] = []
  for (const surfaceValue of surfaces) {
    const surface = asRecord(surfaceValue)
    if (!surface || surface.type !== 'slide' || !Array.isArray(surface.scenes)) continue
    for (const sceneValue of surface.scenes) {
      const scene = asRecord(sceneValue)
      if (!scene || typeof scene.id !== 'string') continue
      const items = Array.isArray(scene.layerItems) ? scene.layerItems : []
      scenes.push({
        id: scene.id,
        nodes: items.flatMap((item) => {
          const node = nativeTextNodeFromLayer(item)
          return node ? [node] : []
        }),
        presentation: presentationFromV9Scene(scene),
      })
    }
  }
  return scenes
}

function projectFromArchive(bytes: Uint8Array): ProjectDocument {
  const archive = unzipSync(bytes)
  const projectBytes = archive['project.json']
  if (!projectBytes) throw new Error('Project archive has no project.json')
  const value = JSON.parse(strFromU8(projectBytes)) as Record<string, unknown>
  if (value.schemaVersion !== 9) throw new Error('Project must be Course Project V9')
  const scenes = slideScenesFromCourseProject(value)
  if (scenes.length === 0) throw new Error('Course Project V9 has no Slide scenes')
  return { schemaVersion: 9, scenes }
}

function observationStateId(scene: ProjectScene, node: ProjectNode): string | null {
  const presentation = scene.presentation
  if (!presentation) return null
  const visibleStates = presentation.states.filter((state) => (
    state.nodeOverrides?.[node.id]?.visible ?? node.visible ?? true
  ))
  const initial = visibleStates.find((state) => state.id === presentation.initialStateId)
  return initial?.id ?? visibleStates[0]?.id ?? null
}

function assertObservationUsesBoundField(
  scene: ProjectScene,
  node: ProjectNode,
  stateId: string | null,
  field: NativeTextTarget['field'],
): void {
  if (stateId === null) return
  const state = scene.presentation?.states.find((candidate) => candidate.id === stateId)
  const override = state?.nodeOverrides?.[node.id]
  if (override && Object.prototype.hasOwnProperty.call(override, field)) {
    throw new Error(
      `observation state overrides the bound field instead of observing it: ${scene.id}/${stateId}/${node.id}/${field}`,
    )
  }
}

function withInitialState(bytes: Uint8Array, sceneId: string, stateId: string | null): Uint8Array {
  if (stateId === null) return bytes
  const archive = unzipSync(bytes)
  const projectBytes = archive['project.json']
  if (!projectBytes) throw new Error('Project archive has no project.json')
  const project = JSON.parse(strFromU8(projectBytes)) as Record<string, unknown>
  if (project.schemaVersion !== 9) throw new Error('Project must be Course Project V9')
  const surfaces = Array.isArray(project.surfaces) ? project.surfaces : []
  let scene: Record<string, unknown> | null = null
  for (const surfaceValue of surfaces) {
    const surface = asRecord(surfaceValue)
    if (!surface || surface.type !== 'slide' || !Array.isArray(surface.scenes)) continue
    scene = surface.scenes.map(asRecord).find((candidate) => candidate?.id === sceneId) ?? null
    if (scene) break
  }
  const presentation = asRecord(scene?.presentation)
  const states = Array.isArray(presentation?.states) ? presentation.states : []
  if (!presentation || !states.some((candidate) => asRecord(candidate)?.id === stateId)) {
    throw new Error(`observation state is absent from Project: ${sceneId}/${stateId}`)
  }
  presentation.initialStateId = stateId
  archive['project.json'] = strToU8(`${JSON.stringify(project, null, 2)}\n`)
  return zipSync(archive, { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') })
}

function collectRequiredEntities(inventory: Record<string, unknown>): InventoryEntity[] {
  const output: InventoryEntity[] = []
  const push = (value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      const item = value as Record<string, unknown>
      if (item.requiredForAcceptance === true) output.push(item as unknown as InventoryEntity)
    }
  }
  const globals = inventory.globalEntities
  if (Array.isArray(globals)) globals.forEach(push)
  const scenes = inventory.scenes
  if (Array.isArray(scenes)) {
    for (const scene of scenes) {
      if (typeof scene === 'object' && scene !== null && Array.isArray((scene as Record<string, unknown>).entities)) {
        ((scene as Record<string, unknown>).entities as unknown[]).forEach(push)
      }
    }
  }
  return output
}

function nativeTextTarget(entity: InventoryEntity): NativeTextTarget | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entity.id)) return null
  const match = /^native:scene:([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):(text)$/.exec(entity.binding)
  if (!match || entity.kind !== 'text') return null
  return { ...entity, sceneId: match[1]!, nodeId: match[2]!, field: 'text' }
}

async function patchDialogs(
  app: ElectronApplication,
  values: {
    projectOpen: string
    htmlSave: string
    webPackageSave?: string
    pdfSave?: string
    pptxSave?: string
  },
): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.projectOpen] })
    dialog.showSaveDialog = async (...args:
      | [Electron.BaseWindow, Electron.SaveDialogOptions]
      | [Electron.SaveDialogOptions]
    ) => {
      const options = args.length === 1 ? args[0] : args[1]
      return {
        canceled: false,
        filePath: options.title?.includes('网页')
          ? paths.webPackageSave ?? paths.projectOpen
          : options.title?.includes('HTML')
            ? paths.htmlSave
            : options.title?.includes('PDF')
              ? paths.pdfSave ?? paths.projectOpen
              : options.title?.includes('PowerPoint')
                ? paths.pptxSave ?? paths.projectOpen
                : paths.projectOpen,
      }
    }
    dialog.showMessageBox = async (...args:
      | [Electron.MessageBoxOptions]
      | [Electron.BaseWindow, Electron.MessageBoxOptions]
    ) => {
      const options = args.length === 1 ? args[0] : args[1]
      return {
        response: options.title === '放弃未保存的修改？' ? 0 : options.defaultId ?? 0,
        checkboxChecked: false,
      }
    }
  }, values)
}

async function clickBaseState(page: Page): Promise<void> {
  const base = page.getByRole('button', { name: '基础场景，所有命名状态的继承源' })
  if (await base.count()) await base.click()
}

async function openProject(page: Page, app: ElectronApplication, projectPath: string, htmlPath: string): Promise<void> {
  await page.getByText('正在处理…', { exact: true }).waitFor({ state: 'hidden' })
  await patchDialogs(app, { projectOpen: projectPath, htmlSave: htmlPath })
  await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
  await page.locator('[data-testid="canvas-stage"] canvas').waitFor({ state: 'visible' })
}

async function exportHtml(page: Page, outputPath: string): Promise<void> {
  await rm(outputPath, { force: true })
  await page.getByTestId('export-menu-trigger').click()
  await page.getByTestId('export-single-html').click()
  const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
  await preflight.waitFor({ state: 'visible' })
  const continueButton = preflight.getByRole('button', { name: '继续导出' })
  if (!(await continueButton.isEnabled())) throw new Error('single HTML export preflight is blocked')
  await continueButton.click()
  const deadline = Date.now() + 20_000
  while (!existsSync(outputPath) && Date.now() < deadline) {
    await page.waitForTimeout(100)
  }
  if (!existsSync(outputPath)) throw new Error('single HTML export did not create a file')
}

async function exportDelivery(
  page: Page,
  testId: 'export-web-package' | 'export-pdf' | 'export-pptx',
  dialogName: '网页包 导出预检' | 'PDF 导出预检' | 'PPTX 导出预检',
  outputPath: string,
): Promise<void> {
  await rm(outputPath, { force: true })
  await page.getByTestId('export-menu-trigger').click()
  await page.getByTestId(testId).click()
  const preflight = page.getByRole('alertdialog', { name: dialogName })
  await preflight.waitFor({ state: 'visible' })
  const continueButton = preflight.getByRole('button', { name: '继续导出' })
  if (!(await continueButton.isEnabled())) throw new Error(`${dialogName} is blocked`)
  await continueButton.click()
  const deadline = Date.now() + 120_000
  let previousSize = -1
  let stablePolls = 0
  while (Date.now() < deadline) {
    const size = await stat(outputPath).then((metadata) => metadata.size).catch(() => 0)
    if (size > 100 && size === previousSize) stablePolls += 1
    else stablePolls = 0
    if (stablePolls >= 3) return
    previousSize = size
    await page.waitForTimeout(100)
  }
  throw new Error(`${dialogName} did not create a stable output file`)
}

async function sceneCanvasScreenshot(page: Page, sceneIndex: number): Promise<Buffer> {
  const canvas = page.locator('.lesson-canvas-host canvas')
  const adapter = page.locator('.slide-published-adapter')
  await canvas.or(adapter).waitFor({ state: 'visible', timeout: 20_000 })
  for (let index = 0; index < sceneIndex; index += 1) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)
  }
  if (await adapter.isVisible()) return adapter.screenshot()
  return canvas.screenshot()
}

async function previewScreenshot(
  app: ElectronApplication,
  page: Page,
  sceneIndex: number,
  networkErrors: string[],
): Promise<Buffer> {
  const overlay = page.getByTestId('course-preview-overlay')
  const previewPromise = app.waitForEvent('window')
  await page.getByRole('button', { name: '全屏 16:9 整课预览' }).click()
  const mode = await Promise.race([
    overlay.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'overlay' as const),
    previewPromise.then(() => 'window' as const),
  ])
  if (mode === 'overlay') {
    void previewPromise.catch(() => undefined)
    try {
      const stage = overlay.locator('.slide-published-adapter')
      await stage.waitFor({ state: 'visible', timeout: 20_000 })
      for (let index = 0; index < sceneIndex; index += 1) {
        await page.getByTestId('course-preview-next').click()
        await page.waitForTimeout(150)
      }
      return await stage.screenshot()
    } finally {
      await overlay.getByRole('button', { name: '关闭预览' }).click()
      await overlay.waitFor({ state: 'hidden' })
    }
  }
  const preview = await previewPromise
  try {
    await enforceOffline(preview, networkErrors)
    return await sceneCanvasScreenshot(preview, sceneIndex)
  } finally {
    await preview.close().catch(() => undefined)
  }
}

async function htmlScreenshot(browser: Awaited<ReturnType<typeof chromium.launch>>, filename: string, sceneIndex: number): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
  })
  const networkErrors: string[] = []
  await context.route('**/*', async (route) => {
    const protocol = new URL(route.request().url()).protocol
    if (protocol === 'http:' || protocol === 'https:') {
      networkErrors.push(`external network request blocked: ${route.request().url()}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  await context.routeWebSocket(/.*/, (route) => {
    networkErrors.push(`external WebSocket blocked: ${route.url()}`)
  })
  const page = await context.newPage()
  try {
    await page.goto(pathToFileURL(filename).toString())
    const screenshot = await sceneCanvasScreenshot(page, sceneIndex)
    if (networkErrors.length) throw new Error(networkErrors.join('; '))
    return screenshot
  } finally {
    await context.close()
  }
}

function stableProjection(receipt: AuthoringReceipt): unknown {
  return {
    schemaVersion: receipt.schemaVersion,
    receiptType: receipt.receiptType,
    caseId: receipt.caseId,
    runnerSha256: receipt.runnerSha256,
    inputs: receipt.inputs,
    editorBuild: receipt.editorBuild,
    exporter: {
      kind: receipt.exporter.kind,
      viewport: receipt.exporter.viewport,
      checkedDeliveryPath: receipt.exporter.checkedDeliveryPath,
      // Single HTML is deterministic and is the exact Behavior target.
      exportedSha256: receipt.exporter.exportedSha256,
      deliverySha256: receipt.exporter.deliverySha256,
      deliveryMatches: receipt.exporter.deliveryMatches,
      deliveries: Object.fromEntries(Object.entries(receipt.exporter.deliveries).map(([kind, delivery]) => [
        kind,
        {
          path: delivery.path,
          deliverySha256: delivery.deliverySha256,
          algorithm: delivery.algorithm,
          canonicalSha256: delivery.canonicalSha256,
          ...(kind === 'html'
            ? { exportedSha256: delivery.exportedSha256, matches: delivery.matches }
            : {}),
        },
      ])),
    },
    entities: receipt.entities.map((entity) => ({
      inventoryEntityId: entity.inventoryEntityId,
      binding: entity.binding,
      carrier: entity.carrier,
      status: entity.status,
      probeValue: entity.probeValue,
      selectedNodeId: entity.selectedNodeId,
      canvasSelectionVerified: entity.canvasSelectionVerified,
      renderedBounds: entity.renderedBounds,
      observationStateId: entity.observationStateId,
      saved: entity.saved,
      reopened: entity.reopened,
      player: entity.player,
      html: entity.html && {
        beforeSha256: entity.html.beforeSha256,
        afterSha256: entity.html.afterSha256,
        changed: entity.html.changed,
      },
      errors: entity.errors,
    })),
    errors: receipt.errors,
  }
}

async function launchBrowser() {
  const args = [
    '--disable-background-networking',
    '--disable-dns-prefetch',
    '--disable-quic',
    '--disable-features=WebTransport',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=127.0.0.1;localhost',
  ]
  try {
    return await chromium.launch({ channel: 'msedge', headless: true, args })
  } catch {
    return chromium.launch({ headless: true, args })
  }
}

async function execute(options: Options): Promise<AuthoringReceipt> {
  const caseRoot = path.resolve(options.caseDir)
  const editorRoot = path.resolve(options.editorRoot)
  const inventoryPath = inside(caseRoot, options.inventory, '--inventory')
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as Record<string, unknown>
  const caseId = String(inventory.caseId ?? '')
  if (!caseId) throw new Error('inventory caseId is missing')
  const inventoryProjectPath = String(inventory.projectPath ?? '')
  const projectPath = inside(caseRoot, options.project || inventoryProjectPath, '--project')
  const reportPath = inside(caseRoot, options.report, '--report')
  const deliveryHtmlPath = options.deliveryHtml
    ? inside(caseRoot, options.deliveryHtml, '--delivery-html')
    : undefined
  const deliveryWebPackagePath = options.deliveryWebPackage
    ? inside(caseRoot, options.deliveryWebPackage, '--delivery-web-package')
    : undefined
  const deliveryPdfPath = options.deliveryPdf
    ? inside(caseRoot, options.deliveryPdf, '--delivery-pdf')
    : undefined
  const deliveryPptxPath = options.deliveryPptx
    ? inside(caseRoot, options.deliveryPptx, '--delivery-pptx')
    : undefined
  requireExtension(inventoryPath, ['.json'], '--inventory')
  requireExtension(projectPath, ['.h5lesson'], '--project')
  requireExtension(reportPath, ['.json'], '--report')
  if (deliveryHtmlPath) requireExtension(deliveryHtmlPath, ['.html', '.htm'], '--delivery-html')
  if (deliveryWebPackagePath) requireExtension(deliveryWebPackagePath, ['.zip'], '--delivery-web-package')
  if (deliveryPdfPath) requireExtension(deliveryPdfPath, ['.pdf'], '--delivery-pdf')
  if (deliveryPptxPath) requireExtension(deliveryPptxPath, ['.pptx'], '--delivery-pptx')
  const deliveryPaths = [deliveryHtmlPath, deliveryWebPackagePath, deliveryPdfPath, deliveryPptxPath]
  if (deliveryPaths.some((filename) => !filename)) {
    throw new Error('trusted export replay requires all four --delivery-* paths')
  }
  const namedPaths = [
    ['--inventory', inventoryPath],
    ['--project', projectPath],
    ['--report', reportPath],
    ...(deliveryHtmlPath ? [['--delivery-html', deliveryHtmlPath]] : []),
    ...(deliveryWebPackagePath ? [['--delivery-web-package', deliveryWebPackagePath]] : []),
    ...(deliveryPdfPath ? [['--delivery-pdf', deliveryPdfPath]] : []),
    ...(deliveryPptxPath ? [['--delivery-pptx', deliveryPptxPath]] : []),
  ] as const
  const pathOwners = new Map<string, string>()
  for (const [label, filename] of namedPaths) {
    const identity = pathIdentity(filename)
    const other = pathOwners.get(identity)
    if (other) throw new Error(`${label} must not alias or overwrite ${other}`)
    pathOwners.set(identity, label)
  }
  if (!(await stat(projectPath)).isFile()) throw new Error('Project file is missing')
  const generated = inventory.generatedFrom as Record<string, unknown> | undefined
  if (!generated) throw new Error('inventory generatedFrom is missing')
  const actualHashes = {
    projectSha256: await hashFile(projectPath),
    inventorySha256: await hashFile(inventoryPath),
    coursewareContractSha256: await hashFile(path.join(caseRoot, '01-courseware-contract.md')),
    presentationScriptSha256: await hashFile(path.join(caseRoot, '02-presentation-script.md')),
    developmentPlanSha256: await hashFile(path.join(caseRoot, '03-development-plan.md')),
    capabilityIndexSha256: await hashFile(path.join(editorRoot, 'artifacts', 'ai-capabilities', 'index.json')),
  }
  for (const [key, value] of Object.entries({
    coursewareContractSha256: actualHashes.coursewareContractSha256,
    presentationScriptSha256: actualHashes.presentationScriptSha256,
    developmentPlanSha256: actualHashes.developmentPlanSha256,
    capabilityIndexSha256: actualHashes.capabilityIndexSha256,
  })) {
    if (generated[key] !== value) throw new Error(`inventory generatedFrom.${key} is stale`)
  }
  const buildFiles = {
    renderer: path.join(editorRoot, 'dist-renderer', 'index.html'),
    main: path.join(editorRoot, 'dist-electron', 'main', 'index.js'),
    player: path.join(editorRoot, 'dist-player', 'player.iife.js'),
  }
  for (const filename of Object.values(buildFiles)) {
    if (!existsSync(filename)) throw new Error(`built editor file is missing: ${filename}`)
  }
  const editorBuild = Object.fromEntries(await Promise.all(
    Object.entries(buildFiles).map(async ([key, filename]) => [key, await hashFile(filename)]),
  ))
  const runnerSha256 = await hashFile(fileURLToPath(import.meta.url))
  const project = projectFromArchive(await readFile(projectPath))
  const required = collectRequiredEntities(inventory)
  for (const entity of required) {
    const target = nativeTextTarget(entity)
    if (!target) continue
    const scene = project.scenes.find((candidate) => candidate.id === target.sceneId)
    const node = scene?.nodes.find((candidate) => candidate.id === target.nodeId)
    if (!scene || !node || node.type !== 'text' || typeof node.text !== 'string') continue
    const observedStateId = observationStateId(scene, node)
    assertObservationUsesBoundField(scene, node, observedStateId, target.field)
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'courseware-authoring-'))
  const profile = path.join(temporaryRoot, 'profile')
  const baselineProject = path.join(temporaryRoot, 'baseline.h5lesson')
  const baselineHtml = path.join(temporaryRoot, 'baseline.html')
  const baselineWebPackage = path.join(temporaryRoot, 'baseline-web.zip')
  const baselinePdf = path.join(temporaryRoot, 'baseline.pdf')
  const baselinePptx = path.join(temporaryRoot, 'baseline.pptx')
  await copyFile(projectPath, baselineProject)
  let app: ElectronApplication | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const entities: EntityReceipt[] = []
  const errors: string[] = []
  let exportedSha256 = ''
  let deliverySha256: string | null = null
  let deliveryMatches = false
  const deliveries = {} as AuthoringReceipt['exporter']['deliveries']
  // Before the launch, so an inherited `ELECTRON_RUN_AS_NODE` is named here
  // instead of surfacing as Playwright's contentless "Process failed to launch!".
  assertElectronCanLaunchAsApp()
  try {
    app = await electron.launch({
      args: [
        '.',
        `--user-data-dir=${profile}`,
        '--disable-background-networking',
        '--disable-dns-prefetch',
        '--disable-quic',
        '--disable-features=WebTransport',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
        '--proxy-server=http://127.0.0.1:9',
        '--proxy-bypass-list=127.0.0.1;localhost',
      ],
      cwd: editorRoot,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        COURSEWARE_E2E_BACKGROUND: '1',
      },
    })
    await installElectronOfflineGuard(app)
    const page = await app.firstWindow()
    await enforceOffline(page, errors)
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor({ state: 'visible' })
    await openProject(page, app, baselineProject, baselineHtml)
    await patchDialogs(app, {
      projectOpen: baselineProject,
      htmlSave: baselineHtml,
      webPackageSave: baselineWebPackage,
      pdfSave: baselinePdf,
      pptxSave: baselinePptx,
    })
    await exportHtml(page, baselineHtml)
    await exportDelivery(page, 'export-web-package', '网页包 导出预检', baselineWebPackage)
    await exportDelivery(page, 'export-pdf', 'PDF 导出预检', baselinePdf)
    await exportDelivery(page, 'export-pptx', 'PPTX 导出预检', baselinePptx)
    exportedSha256 = await hashFile(baselineHtml)
    const deliveryDefinitions: ReadonlyArray<readonly [DeliveryKind, string, string, string]> = [
      ['html', baselineHtml, deliveryHtmlPath!, '--delivery-html'],
      ['webPackage', baselineWebPackage, deliveryWebPackagePath!, '--delivery-web-package'],
      ['pdf', baselinePdf, deliveryPdfPath!, '--delivery-pdf'],
      ['pptx', baselinePptx, deliveryPptxPath!, '--delivery-pptx'],
    ] as const
    for (const [kind, freshPath, deliveredPath, label] of deliveryDefinitions) {
      if (options.writeDeliveries) {
        await mkdir(path.dirname(deliveredPath), { recursive: true })
        inside(caseRoot, portableRelative(caseRoot, deliveredPath), label)
        await copyFile(freshPath, deliveredPath)
      }
      const freshSha256 = await hashFile(freshPath)
      const deliveredSha256 = await hashFile(deliveredPath)
      const matches = freshSha256 === deliveredSha256
      const [freshFingerprint, deliveryFingerprint] = await Promise.all([
        readFile(freshPath).then((bytes) => canonicalDeliveryFingerprint(kind, bytes)),
        readFile(deliveredPath).then((bytes) => canonicalDeliveryFingerprint(kind, bytes)),
      ])
      if (
        freshFingerprint.algorithm !== deliveryFingerprint.algorithm ||
        freshFingerprint.sha256 !== deliveryFingerprint.sha256
      ) {
        errors.push(`delivered ${kind} differs semantically from the fresh Editor UI export`)
      }
      deliveries[kind] = {
        path: portableRelative(caseRoot, deliveredPath),
        exportedSha256: freshSha256,
        deliverySha256: deliveredSha256,
        matches,
        algorithm: freshFingerprint.algorithm,
        canonicalSha256: freshFingerprint.sha256,
      }
      if (!matches && (!options.verifyReport || kind === 'html')) {
        errors.push(`delivered ${kind} differs byte-for-byte from the fresh Editor UI export`)
      }
    }
    deliverySha256 = deliveries.html.deliverySha256
    deliveryMatches = deliveries.html.matches
    browser = await launchBrowser()

    for (const entity of required) {
      const target = nativeTextTarget(entity)
      if (!target) {
        entities.push({
          inventoryEntityId: entity.id,
          binding: entity.binding,
          carrier: 'native-scene-text',
          status: 'unsupported',
          errors: ['only native scene text is supported by editor-authoring-session-v1'],
        })
        continue
      }
      const receipt: EntityReceipt = {
        inventoryEntityId: target.id,
        binding: target.binding,
        carrier: 'native-scene-text',
        status: 'failed',
        errors: [],
      }
      try {
        const sceneIndex = project.scenes.findIndex((scene) => scene.id === target.sceneId)
        const scene = project.scenes[sceneIndex]
        const node = scene?.nodes.find((candidate) => candidate.id === target.nodeId)
        if (sceneIndex < 0 || !node || node.type !== 'text' || typeof node.text !== 'string') {
          throw new Error('native text binding is absent from the current Project')
        }
        const probe = `${node.text} [probe-${sha256(target.binding).slice(0, 8)}]`
        const observedStateId = observationStateId(scene, node)
        if (scene.presentation && observedStateId === null) {
          throw new Error('bound node is hidden in every named presentation state')
        }
        assertObservationUsesBoundField(scene, node, observedStateId, target.field)
        receipt.observationStateId = observedStateId ?? undefined
        receipt.probeValue = probe
        receipt.renderedBounds = { x: node.x, y: node.y, width: node.width, height: node.height }
        const safeToken = sha256(`${target.id}\0${target.binding}`).slice(0, 32)
        const probeProject = path.join(temporaryRoot, `${safeToken}.h5lesson`)
        const beforeHtml = path.join(temporaryRoot, `${safeToken}-before.html`)
        const probeHtml = path.join(temporaryRoot, `${safeToken}.html`)
        if (
          !isWithin(temporaryRoot, probeProject) || !isWithin(temporaryRoot, beforeHtml) ||
          !isWithin(temporaryRoot, probeHtml)
        ) {
          throw new Error('derived probe path escaped the temporary workspace')
        }
        await writeFile(
          probeProject,
          withInitialState(await readFile(projectPath), target.sceneId, observedStateId),
        )
        await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
        await openProject(page, app, probeProject, beforeHtml)
        await page.getByTestId(`scene-item-${target.sceneId}`).click()
        await clickBaseState(page)
        await patchDialogs(app, { projectOpen: probeProject, htmlSave: beforeHtml })
        await exportHtml(page, beforeHtml)
        const beforePlayer = await previewScreenshot(app, page, sceneIndex, receipt.errors)
        const canvas = page.locator('[data-testid="canvas-stage"] canvas')
        const bounds = await canvas.boundingBox()
        if (!bounds) throw new Error('editor canvas has no measurable bounds')
        await page.mouse.click(
          bounds.x + ((node.x + node.width / 2) / 1280) * bounds.width,
          bounds.y + ((node.y + node.height / 2) / 720) * bounds.height,
        )
        await page.getByRole('tab', { name: '图层' }).click()
        const selected = page.getByTestId(`node-item-${target.nodeId}`)
        const selectedClass = await selected.getAttribute('class')
        if (!selectedClass?.includes('node-item--selected')) {
          throw new Error('canvas pointer did not select the bound node')
        }
        receipt.selectedNodeId = target.nodeId
        receipt.canvasSelectionVerified = true
        await selected.locator('.node-name').click()
        await page.getByRole('tab', { name: '属性' }).click()
        const text = page.getByRole('textbox', { name: '文字内容' })
        if (await text.inputValue() !== node.text) throw new Error('selected text does not match Project binding')
        await text.fill(probe)
        await text.press('Tab')
        const beforeSaveHash = await hashFile(probeProject)
        await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
        const deadline = Date.now() + 20_000
        let outputHash = beforeSaveHash
        while (outputHash === beforeSaveHash && Date.now() < deadline) {
          await page.waitForTimeout(100)
          outputHash = await hashFile(probeProject)
        }
        if (outputHash === beforeSaveHash) throw new Error('Editor save did not change the temporary Project bytes')
        receipt.saved = true
        await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
        await openProject(page, app, probeProject, probeHtml)
        await page.getByTestId(`scene-item-${target.sceneId}`).click()
        await clickBaseState(page)
        await page.getByRole('tab', { name: '图层' }).click()
        await page.getByTestId(`node-item-${target.nodeId}`).locator('.node-name').click()
        await page.getByRole('tab', { name: '属性' }).click()
        if (await page.getByRole('textbox', { name: '文字内容' }).inputValue() !== probe) {
          throw new Error('edited value did not survive Editor reopen')
        }
        receipt.reopened = true
        const afterPlayer = await previewScreenshot(app, page, sceneIndex, receipt.errors)
        receipt.player = {
          beforeSha256: sha256(beforePlayer),
          afterSha256: sha256(afterPlayer),
          changed: !beforePlayer.equals(afterPlayer),
        }
        await patchDialogs(app, { projectOpen: probeProject, htmlSave: probeHtml })
        await exportHtml(page, probeHtml)
        const [beforeHtmlScreenshot, afterHtmlScreenshot] = await Promise.all([
          htmlScreenshot(browser, beforeHtml, sceneIndex),
          htmlScreenshot(browser, probeHtml, sceneIndex),
        ])
        receipt.html = {
          beforeSha256: sha256(beforeHtmlScreenshot),
          afterSha256: sha256(afterHtmlScreenshot),
          changed: !beforeHtmlScreenshot.equals(afterHtmlScreenshot),
        }
        if (!receipt.player.changed) throw new Error('Player canvas did not visibly change for the edited entity')
        if (!receipt.html.changed) throw new Error('exported HTML canvas did not visibly change for the edited entity')
        if (receipt.errors.length) throw new Error(receipt.errors.join('; '))
        receipt.status = 'passed'
      } catch (error) {
        receipt.errors.push(error instanceof Error ? error.message : String(error))
      }
      entities.push(receipt)
    }
  } finally {
    await browser?.close().catch(() => undefined)
    if (app) {
      const blocked = await electronBlockedNetwork(app).catch(() => ['unable to audit Electron network activity'])
      for (const url of blocked) errors.push(`Electron external network request blocked: ${url}`)
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((window) => window.destroy())
        setTimeout(() => electronApp.exit(0), 0)
      }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  if (required.length === 0) errors.push('inventory has no required authoring entities')
  for (const entity of entities) {
    if (entity.status !== 'passed') errors.push(`${entity.inventoryEntityId}: ${entity.errors.join('; ')}`)
  }
  const receipt: AuthoringReceipt = {
    schemaVersion: 1,
    receiptType: 'editor-authoring-session-v1',
    caseId,
    runnerSha256,
    inputs: actualHashes,
    editorBuild,
    exporter: {
      kind: 'editor-single-html-ui-v1',
      viewport: { width: 1280, height: 720 },
      checkedDeliveryPath: deliveryHtmlPath ? portableRelative(caseRoot, deliveryHtmlPath) : null,
      exportedSha256,
      deliverySha256,
      deliveryMatches,
      deliveries,
    },
    entities,
    errors,
  }
  if (options.verifyReport) {
    const expected = JSON.parse(await readFile(reportPath, 'utf8')) as AuthoringReceipt
    if (canonicalJson(stableProjection(expected)) !== canonicalJson(stableProjection(receipt))) {
      receipt.errors.push('persisted authoring receipt differs from trusted current replay')
    }
  } else {
    await mkdir(path.dirname(reportPath), { recursive: true })
    inside(caseRoot, portableRelative(caseRoot, reportPath), '--report')
    await writeFile(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  }
  return receipt
}

export async function runCoursewareAuthoringCli(argv: readonly string[]): Promise<0 | 1 | 2> {
  try {
    const receipt = await execute(parseArgs(argv))
    process.stdout.write(`${JSON.stringify({
      status: receipt.errors.length === 0 ? 'passed' : 'failed',
      receiptType: receipt.receiptType,
      entities: receipt.entities.map(({ inventoryEntityId, status }) => ({ inventoryEntityId, status })),
      exporter: receipt.exporter,
      errors: receipt.errors,
    }, null, 2)}\n`)
    return receipt.errors.length === 0 ? 0 : 1
  } catch (error) {
    process.stderr.write(`authoring runner configuration/error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

const invoked = process.argv[1]
if (invoked && import.meta.url === pathToFileURL(path.resolve(invoked)).href) {
  void runCoursewareAuthoringCli(process.argv.slice(2)).then((code) => { process.exitCode = code })
}
