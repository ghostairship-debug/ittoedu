import { componentRenderMode } from '../../../shared/componentCapabilities'
import { componentContentSha256 } from '../../../shared/componentContentIntegrity'
import {
  getComponentPropValue,
  mergeComponentProps,
} from '../../../shared/componentProps'
import type {
  ComponentPackageData,
} from '../../../shared/componentTypes'
import { courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import type {
  ComponentLayerItem,
  CourseProjectDocument,
  CourseSurfaceDocument,
  FlowBlock,
  LayerItem,
  LayerItemOverride,
  RuntimeLayerItem,
  ScopedLayerItem,
} from '../../../shared/courseProjectTypes'
import {
  PUBLISHED_COURSE_FORMAT,
  PUBLISHED_COURSE_VERSION,
  type PublishedComponentLayerItem,
  type PublishedCourseComponent,
  type PublishedCourseExecutableCode,
  type PublishedCourseSurface,
  type PublishedCourseV2Payload,
  type PublishedLayerItem,
  type PublishedRuntimeLayerItem,
  type PublishedScopedLayerItem,
} from '../../../shared/publishedCourseTypes'
import { publishedCourseV2Schema } from '../../../shared/publishedCourseSchema'
import type { AssetMeta, EmbeddedComponentPackageMeta } from '../../../shared/projectTypes'
import { compareStableStrings } from '../../../shared/stableOrder'
import { bytesToBase64, bytesToDataUrl } from '../base64'

export interface CoursePublishSources {
  project: CourseProjectDocument
  /** Binary project assets keyed by AssetMeta.id or by the project record key. */
  assetFiles: Readonly<Record<string, Uint8Array>>
  /** Parsed component packages keyed by package id, package@version, or project record key. */
  components: Readonly<Record<string, ComponentPackageData>>
}

export interface PublishedCourseAssetProjection {
  mimeType: string
  url: string
}

export interface BuildPublishedCourseOptions {
  /** Defaults to a Data URL, which is suitable for a standalone HTML file. */
  projectAssetUrl?: (
    assetId: string,
    meta: AssetMeta,
    bytes: Uint8Array,
  ) => string
  /** Defaults to a Data URL, which is suitable for a standalone HTML file. */
  componentAssetUrl?: (
    componentKey: string,
    assetKey: string,
    mimeType: string,
    bytes: Uint8Array,
  ) => string
}

/** Deterministic source facts that must hold before a V9 project can publish. */
export type PublishedCourseSourceIssueCode =
  | 'asset-metadata-missing'
  | 'asset-bytes-missing'
  | 'asset-byte-length-mismatch'
  | 'component-metadata-missing'
  | 'component-bytes-missing'
  | 'component-manifest-identity-mismatch'
  | 'component-hash-mismatch'
  | 'component-asset-bytes-missing'

export interface PublishedCourseSourceIssue {
  code: PublishedCourseSourceIssueCode
  message: string
  path: ReadonlyArray<string | number>
}

/**
 * Retains the machine-stable source fact for callers that build without first
 * showing the package preflight report.
 */
export class PublishedCourseSourceError extends Error {
  readonly code: PublishedCourseSourceIssueCode
  readonly path: ReadonlyArray<string | number>

  constructor(readonly issue: PublishedCourseSourceIssue) {
    super(issue.message)
    this.name = 'PublishedCourseSourceError'
    this.code = issue.code
    this.path = issue.path
  }
}

interface ComponentReference {
  packageId: string
  version: string
  props: Record<string, unknown>
}

function cloneJson<T>(value: T): T {
  return structuredClone(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Same UTF-16LE encoding as V8 `encodePublishedCode`, copied here so the V9
 * producer does not import or alter the default lesson publisher.
 */
function encodePublishedCode(source: string): PublishedCourseExecutableCode {
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) {
    const codeUnit = source.charCodeAt(index)
    bytes[index * 2] = codeUnit & 0xff
    bytes[index * 2 + 1] = codeUnit >>> 8
  }
  return {
    encoding: 'base64-utf16le',
    data: bytesToBase64(bytes),
  }
}

function mergeLayerOverride(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(base)
  for (const [key, value] of Object.entries(override)) {
    result[key] = isRecord(value) && isRecord(result[key])
      ? mergeLayerOverride(result[key], value)
      : structuredClone(value)
  }
  return result
}

function componentKey(packageId: string, version: string): string {
  return `${packageId}@${version}`
}

function findComponentMetadata(
  project: CourseProjectDocument,
  packageId: string,
  version: string,
): readonly [string, EmbeddedComponentPackageMeta] | undefined {
  const direct = project.componentPackages[componentKey(packageId, version)]
    ?? project.componentPackages[packageId]
  if (direct?.packageId === packageId && direct.version === version) {
    const key = Object.entries(project.componentPackages).find(([, value]) => value === direct)?.[0]
      ?? packageId
    return [key, direct]
  }
  return Object.entries(project.componentPackages).find(([, metadata]) => (
    metadata.packageId === packageId && metadata.version === version
  ))
}

function findComponentSource(
  sources: CoursePublishSources,
  recordKey: string,
  packageId: string,
  version: string,
): ComponentPackageData | undefined {
  return sources.components[recordKey]
    ?? sources.components[componentKey(packageId, version)]
    ?? sources.components[packageId]
    ?? Object.values(sources.components).find(({ manifest }) => (
      manifest.id === packageId && manifest.version === version
    ))
}

function findAssetEntry(
  project: CourseProjectDocument,
  assetId: string,
): readonly [string, AssetMeta] | undefined {
  const direct = project.assets[assetId]
  if (direct) return [assetId, direct]
  return Object.entries(project.assets).find(([, metadata]) => metadata.id === assetId)
}

function findAssetBytes(
  sources: CoursePublishSources,
  recordKey: string,
  metadata: AssetMeta,
): Uint8Array | undefined {
  return sources.assetFiles[metadata.id]
    ?? sources.assetFiles[recordKey]
}

function extensionMimeType(path: string): string {
  const extension = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', ogg: 'audio/ogg',
    wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    json: 'application/json', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
    txt: 'text/plain',
  }
  return extension ? mimeTypes[extension] ?? 'application/octet-stream' : 'application/octet-stream'
}

function visitFlowBlocks(
  blocks: readonly FlowBlock[],
  visit: (block: FlowBlock) => void,
): void {
  for (const block of blocks) {
    visit(block)
    if (block.type === 'section') visitFlowBlocks(block.blocks, visit)
  }
}

function allLayerItems(project: CourseProjectDocument): LayerItem[] {
  const items = project.globalLayerItems.map((entry) => entry.item)
  for (const surface of project.surfaces) {
    items.push(...surface.surfaceLayerItems.map((entry) => entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => items.push(...scene.layerItems))
    } else if (surface.type === 'spatial-2d') {
      items.push(...surface.world.layerItems)
    }
  }
  return items
}

function collectComponentReferences(project: CourseProjectDocument): ComponentReference[] {
  const result: ComponentReference[] = []
  for (const item of allLayerItems(project)) {
    if (item.kind === 'component') {
      result.push({ ...item.component, props: item.props })
    }
  }
  for (const surface of project.surfaces) {
    if (surface.type !== 'flow') continue
    visitFlowBlocks(surface.blocks, (block) => {
      if (block.type === 'component') result.push({ ...block.component, props: block.props })
    })
  }
  return result
}

export function collectPublishedCourseComponentKeys(
  project: CourseProjectDocument,
): Set<string> {
  return new Set(collectComponentReferences(project).map((reference) => (
    componentKey(reference.packageId, reference.version)
  )))
}

function addComponentPropAssets(
  target: Set<string>,
  manifest: ComponentPackageData['manifest'],
  props: Record<string, unknown>,
): void {
  const effective = mergeComponentProps(manifest, props)
  for (const property of manifest.editor?.properties ?? []) {
    if (property.type !== 'image') continue
    const assetId = getComponentPropValue(effective, property.key)
    if (typeof assetId === 'string' && assetId) target.add(assetId)
  }
}

function addOverrideAssetReferences(
  target: Set<string>,
  override: LayerItemOverride,
): void {
  const nativeData = override.nativeData
  if (typeof nativeData?.assetId === 'string') target.add(nativeData.assetId)
  const poster = nativeData?.poster
  if (typeof poster === 'object' && poster !== null) {
    const assetId = Reflect.get(poster, 'assetId')
    if (typeof assetId === 'string' && assetId) target.add(assetId)
  }
}

function addLayerAssetReferences(target: Set<string>, item: LayerItem): void {
  if (item.kind === 'native') {
    if (item.content.nativeType === 'image') target.add(item.content.data.assetId)
    if (item.content.nativeType === 'video') {
      target.add(item.content.data.assetId)
      if (item.content.data.poster.assetId) target.add(item.content.data.poster.assetId)
    }
    return
  }
  if (item.kind === 'component') {
    if (item.staticFallbackAssetId) target.add(item.staticFallbackAssetId)
    return
  }
  Object.values(item.runtime.assets).forEach(({ assetId }) => target.add(assetId))
  if (item.runtime.staticFallback) target.add(item.runtime.staticFallback.assetId)
}

/** Exact project-asset closure used by both single-file and web-package publishing. */
export function collectPublishedCourseAssetIds(
  sources: Pick<CoursePublishSources, 'project' | 'components'>,
): Set<string> {
  const { project } = sources
  const result = new Set<string>()
  Object.values(project.media.audio.sounds).forEach((sound) => result.add(sound.assetId))
  allLayerItems(project).forEach((item) => addLayerAssetReferences(result, item))

  for (const surface of project.surfaces) {
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        if (scene.backgroundAssetId) result.add(scene.backgroundAssetId)
        for (const state of scene.presentation?.states ?? []) {
          if (state.backgroundAssetId) result.add(state.backgroundAssetId)
          for (const [layerItemId, override] of Object.entries(state.layerItemOverrides)) {
            addOverrideAssetReferences(result, override)
            if (!override.componentProps) continue
            const item = scene.layerItems.find((candidate) => (
              candidate.layerItemId === layerItemId && candidate.kind === 'component'
            ))
            if (!item || item.kind !== 'component') continue
            const metadataEntry = findComponentMetadata(
              project,
              item.component.packageId,
              item.component.version,
            )
            if (!metadataEntry) continue
            const component = findComponentSource(
              sources as CoursePublishSources,
              metadataEntry[0],
              item.component.packageId,
              item.component.version,
            )
            if (component) {
              addComponentPropAssets(
                result,
                component.manifest,
                mergeLayerOverride(item.props, override.componentProps),
              )
            }
          }
        }
      }
    }
    if (surface.type === 'flow') {
      visitFlowBlocks(surface.blocks, (block) => {
        if (block.type === 'media') result.add(block.assetId)
        if (block.type === 'component') result.add(block.staticFallbackAssetId)
      })
    }
  }

  for (const reference of collectComponentReferences(project)) {
    const metadataEntry = findComponentMetadata(project, reference.packageId, reference.version)
    if (!metadataEntry) continue
    const component = findComponentSource(
      sources as CoursePublishSources,
      metadataEntry[0],
      reference.packageId,
      reference.version,
    )
    if (component) addComponentPropAssets(result, component.manifest, reference.props)
  }
  return result
}

function sourceIssuePathKey(path: ReadonlyArray<string | number>): string {
  return JSON.stringify(path)
}

function compareSourceIssues(
  left: PublishedCourseSourceIssue,
  right: PublishedCourseSourceIssue,
): number {
  return compareStableStrings(left.code, right.code) ||
    compareStableStrings(left.message, right.message) ||
    compareStableStrings(sourceIssuePathKey(left.path), sourceIssuePathKey(right.path))
}

interface PublishedCourseSourceFacts {
  /**
   * Available only when this is a V9 project that is either fully parsed, or
   * has passed every structural check and failed solely on semantic references.
   * The latter retains actionable missing-resource diagnostics before the
   * final schema rejection path.
   */
  sources: CoursePublishSources | null
  parsedProject: ReturnType<typeof courseProjectDocumentSchema.safeParse>
}

function isRawV9Project(value: unknown): value is { schemaVersion: 9 } {
  return isRecord(value) && value.schemaVersion === 9
}

/**
 * Derive source facts from the same canonical V9 document the producer emits.
 * A schema-valid document can trim stable IDs, so collecting against the raw
 * object would disagree with subsequent producer lookups.  When parsing only
 * fails on custom semantic/reference checks, the raw shape is still safe to
 * inspect for an actionable source issue.  Other failures must stay on the
 * ordinary Zod error path rather than entering the graph walker.
 */
function resolvePublishedCourseSourceFacts(
  input: CoursePublishSources,
): PublishedCourseSourceFacts {
  const parsedProject = courseProjectDocumentSchema.safeParse(input.project)
  if (parsedProject.success) {
    return {
      parsedProject,
      sources: { ...input, project: parsedProject.data },
    }
  }
  if (
    isRawV9Project(input.project)
    && parsedProject.error.issues.length > 0
    && parsedProject.error.issues.every((issue) => issue.code === 'custom')
  ) {
    return { parsedProject, sources: input }
  }
  return { parsedProject, sources: null }
}

function collectPublishedCourseSourceIssuesFromFacts(
  sources: CoursePublishSources,
): PublishedCourseSourceIssue[] {
  const issues: PublishedCourseSourceIssue[] = []
  const add = (issue: PublishedCourseSourceIssue): void => { issues.push(issue) }

  for (const assetId of [...collectPublishedCourseAssetIds(sources)].sort(compareStableStrings)) {
    const entry = findAssetEntry(sources.project, assetId)
    if (!entry) {
      add({
        code: 'asset-metadata-missing',
        message: `工程引用的素材“${assetId}”没有对应的素材元数据。`,
        path: ['assets', assetId],
      })
      continue
    }
    const [recordKey, metadata] = entry
    const bytes = findAssetBytes(sources, recordKey, metadata)
    if (!bytes) {
      add({
        code: 'asset-bytes-missing',
        message: `素材“${metadata.filename}”只有工程元数据，没有可嵌入导出物的本地字节。`,
        path: ['assets', recordKey],
      })
      continue
    }
    if (bytes.byteLength !== metadata.byteLength) {
      add({
        code: 'asset-byte-length-mismatch',
        message: `素材“${metadata.filename}”的本地字节长度与工程元数据不一致。`,
        path: ['assets', recordKey, 'byteLength'],
      })
    }
  }

  for (const key of [...collectPublishedCourseComponentKeys(sources.project)].sort(compareStableStrings)) {
    const separator = key.lastIndexOf('@')
    const packageId = key.slice(0, separator)
    const version = key.slice(separator + 1)
    const metadataEntry = findComponentMetadata(sources.project, packageId, version)
    if (!metadataEntry) {
      add({
        code: 'component-metadata-missing',
        message: `工程引用的组件包“${key}”没有对应的工程锁定元数据。`,
        path: ['componentPackages', packageId],
      })
      continue
    }

    const [recordKey, metadata] = metadataEntry
    const source = findComponentSource(sources, recordKey, packageId, version)
    if (!source) {
      add({
        code: 'component-bytes-missing',
        message: `组件包“${key}”没有可嵌入导出物的执行内容。`,
        path: ['componentPackages', recordKey],
      })
      continue
    }

    if (source.manifest.id !== metadata.packageId || source.manifest.version !== metadata.version) {
      add({
        code: 'component-manifest-identity-mismatch',
        message: `组件包“${key}”的 manifest ID 或版本与工程锁定值不一致。`,
        path: ['componentPackages', recordKey],
      })
    }

    const actualHash = source.contentSha256 ?? componentContentSha256(source.files)
    if (actualHash !== metadata.contentSha256) {
      add({
        code: 'component-hash-mismatch',
        message: `组件包“${key}”的工程锁定内容哈希与当前执行内容不一致。`,
        path: ['componentPackages', recordKey, 'contentSha256'],
      })
    }

    for (const [assetKey, path] of Object.entries(source.manifest.assets)
      .sort(([left], [right]) => compareStableStrings(left, right))) {
      if (!source.files[path]) {
        add({
          code: 'component-asset-bytes-missing',
          message: `组件包“${key}”缺少声明素材“${assetKey}”对应的文件“${path}”。`,
          path: ['componentPackages', recordKey],
        })
      }
    }
  }

  return issues.sort(compareSourceIssues)
}

/**
 * Collect every deterministic local source condition required by the V2
 * producer. Package preflight maps these facts directly, while the producer
 * raises the first fact as a structured hard gate before it starts emitting.
 */
export function collectPublishedCourseSourceIssues(
  input: CoursePublishSources,
): PublishedCourseSourceIssue[] {
  const { sources } = resolvePublishedCourseSourceFacts(input)
  return sources ? collectPublishedCourseSourceIssuesFromFacts(sources) : []
}

export function assertPublishedCourseSourceIssues(
  sources: CoursePublishSources,
): void {
  const issue = collectPublishedCourseSourceIssues(sources)[0]
  if (issue) throw new PublishedCourseSourceError(issue)
}

function publishComponent(
  metadata: EmbeddedComponentPackageMeta,
  source: ComponentPackageData,
  key: string,
  options: BuildPublishedCourseOptions,
): PublishedCourseComponent {
  if (source.manifest.id !== metadata.packageId || source.manifest.version !== metadata.version) {
    throw new Error(`Component ${key} manifest identity does not match the project lock`)
  }
  const actualHash = source.contentSha256 ?? componentContentSha256(source.files)
  if (actualHash !== metadata.contentSha256) {
    throw new Error(`Component ${key} content hash does not match the project lock`)
  }
  const assets: PublishedCourseComponent['assets'] = {}
  for (const [assetKey, path] of Object.entries(source.manifest.assets)) {
    const bytes = source.files[path]
    if (!bytes) throw new Error(`Component ${key} is missing asset ${path}`)
    const mimeType = extensionMimeType(path)
    assets[assetKey] = {
      mimeType,
      url: options.componentAssetUrl?.(key, assetKey, mimeType, bytes)
        ?? bytesToDataUrl(bytes, mimeType),
    }
  }
  return {
    id: source.manifest.id,
    name: source.manifest.name,
    version: source.manifest.version,
    contentSha256: metadata.contentSha256,
    apiVersion: 4,
    scopes: cloneJson(source.manifest.supportedScopes),
    renderMode: componentRenderMode(source.manifest),
    code: encodePublishedCode(source.runtimeSource),
    assets,
  }
}

function requireComponent(
  sources: CoursePublishSources,
  packageId: string,
  version: string,
): { key: string; metadata: EmbeddedComponentPackageMeta; source: ComponentPackageData } {
  const metadataEntry = findComponentMetadata(sources.project, packageId, version)
  const key = componentKey(packageId, version)
  if (!metadataEntry) throw new Error(`Component ${key} is not embedded in the project`)
  const source = findComponentSource(sources, metadataEntry[0], packageId, version)
  if (!source) throw new Error(`Component ${key} has no package bytes`)
  return { key, metadata: metadataEntry[1], source }
}

function publishComponentProps(
  sources: CoursePublishSources,
  item: ComponentLayerItem,
): PublishedComponentLayerItem {
  const component = requireComponent(
    sources,
    item.component.packageId,
    item.component.version,
  ).source
  const { label: _label, locked: _locked, ...base } = item
  return {
    ...base,
    props: mergeComponentProps(component.manifest, item.props),
  }
}

function publishRuntime(item: RuntimeLayerItem): PublishedRuntimeLayerItem {
  const { label: _label, locked: _locked, runtime, ...base } = item
  const { source, ...runtimeData } = runtime
  return {
    ...base,
    runtime: {
      ...cloneJson(runtimeData),
      code: encodePublishedCode(source),
    },
  }
}

function publishLayerItem(
  sources: CoursePublishSources,
  item: LayerItem,
): PublishedLayerItem {
  if (item.kind === 'runtime') return publishRuntime(item)
  if (item.kind === 'component') return publishComponentProps(sources, item)
  const { label: _label, locked: _locked, ...published } = item
  return cloneJson(published)
}

function publishScoped(
  sources: CoursePublishSources,
  entry: ScopedLayerItem,
): PublishedScopedLayerItem {
  return {
    item: publishLayerItem(sources, entry.item),
    visibility: cloneJson(entry.visibility),
  }
}

function publishFlowBlocks(
  sources: CoursePublishSources,
  blocks: readonly FlowBlock[],
): FlowBlock[] {
  return blocks.map((block) => {
    if (block.type === 'section') {
      return { ...cloneJson(block), blocks: publishFlowBlocks(sources, block.blocks) }
    }
    if (block.type === 'component') {
      const component = requireComponent(
        sources,
        block.component.packageId,
        block.component.version,
      ).source
      return {
        ...cloneJson(block),
        props: mergeComponentProps(component.manifest, block.props),
      }
    }
    return cloneJson(block)
  })
}

function publishSurface(
  sources: CoursePublishSources,
  surface: CourseSurfaceDocument,
): PublishedCourseSurface {
  const base = {
    id: surface.id,
    title: surface.title,
    surfaceLayerItems: surface.surfaceLayerItems.map((entry) => publishScoped(sources, entry)),
  }
  if (surface.type === 'slide') {
    return {
      ...base,
      type: 'slide',
      canvas: cloneJson(surface.canvas),
      scenes: surface.scenes.map((scene) => ({
        id: scene.id,
        name: scene.name,
        backgroundColor: scene.backgroundColor,
        ...(scene.backgroundAssetId !== undefined
          ? { backgroundAssetId: scene.backgroundAssetId }
          : {}),
        layerItems: scene.layerItems.map((item) => publishLayerItem(sources, item)),
        ...(scene.presentation
          ? {
              presentation: {
                initialStateId: scene.presentation.initialStateId,
                states: scene.presentation.states.map((state) => ({
                  id: state.id,
                  name: state.name,
                  ...(state.backgroundColor !== undefined
                    ? { backgroundColor: state.backgroundColor }
                    : {}),
                  ...(state.backgroundAssetId !== undefined
                    ? { backgroundAssetId: state.backgroundAssetId }
                    : {}),
                  layerItemOverrides: cloneJson(state.layerItemOverrides),
                  ...(state.layerItemOrder
                    ? { layerItemOrder: cloneJson(state.layerItemOrder) }
                    : {}),
                })),
              },
            }
          : {}),
        interactions: cloneJson(scene.interactions),
      })),
    }
  }
  if (surface.type === 'flow') {
    return {
      ...base,
      type: 'flow',
      ...(surface.backgroundColor !== undefined ? { backgroundColor: surface.backgroundColor } : {}),
      layout: cloneJson(surface.layout),
      blocks: publishFlowBlocks(sources, surface.blocks),
    }
  }
  return {
    ...base,
    type: 'spatial-2d',
    ...(surface.backgroundColor !== undefined ? { backgroundColor: surface.backgroundColor } : {}),
    world: {
      bounds: cloneJson(surface.world.bounds),
      layerItems: surface.world.layerItems.map((item) => publishLayerItem(sources, item)),
      paths: cloneJson(surface.world.paths ?? []),
      relations: cloneJson(surface.world.relations ?? []),
    },
    camera: cloneJson(surface.camera),
    semanticZoom: cloneJson(surface.semanticZoom),
  }
}

/**
 * Compile a validated authoring project into the one-way Published Course V2
 * contract. Author-only labels, locks, timestamps and Runtime source strings
 * are deliberately absent from the returned object.
 *
 * This producer copies Flow `blocks` and Spatial `world`/`camera` as data. It
 * does not reconstruct a project from DOM, Phaser proxies, or a Player host,
 * and it does not claim that unimplemented hosts have played the payload.
 */
export function buildPublishedCourseV2Payload(
  input: CoursePublishSources,
  options: BuildPublishedCourseOptions = {},
): PublishedCourseV2Payload {
  const sourceFacts = resolvePublishedCourseSourceFacts(input)
  // Keep the stable source-issue gate for V9 projects that are safe to walk;
  // raw V8 and structurally malformed V9 input continue to surface Zod errors.
  if (isRawV9Project(input.project) && sourceFacts.sources) {
    const issue = collectPublishedCourseSourceIssuesFromFacts(sourceFacts.sources)[0]
    if (issue) throw new PublishedCourseSourceError(issue)
  }
  if (!sourceFacts.parsedProject.success) throw sourceFacts.parsedProject.error
  const project = sourceFacts.parsedProject.data
  const sources: CoursePublishSources = sourceFacts.sources ?? { ...input, project }
  const assetIds = collectPublishedCourseAssetIds(sources)
  const assets: PublishedCourseV2Payload['assets'] = {}
  for (const assetId of [...assetIds].sort()) {
    const entry = findAssetEntry(project, assetId)
    if (!entry) throw new Error(`Published course references missing asset ${assetId}`)
    const bytes = findAssetBytes(sources, entry[0], entry[1])
    if (!bytes) throw new Error(`Asset ${entry[1].filename} has no binary content`)
    if (bytes.byteLength !== entry[1].byteLength) {
      throw new Error(`Asset ${entry[1].filename} byte length does not match project metadata`)
    }
    assets[assetId] = {
      mimeType: entry[1].mimeType,
      url: options.projectAssetUrl?.(assetId, entry[1], bytes)
        ?? bytesToDataUrl(bytes, entry[1].mimeType),
    }
  }

  const components: PublishedCourseV2Payload['components'] = {}
  for (const key of [...collectPublishedCourseComponentKeys(project)].sort()) {
    const separator = key.lastIndexOf('@')
    const packageId = key.slice(0, separator)
    const version = key.slice(separator + 1)
    const resolved = requireComponent(sources, packageId, version)
    components[key] = publishComponent(
      resolved.metadata,
      resolved.source,
      key,
      options,
    )
  }

  const published: PublishedCourseV2Payload = {
    format: PUBLISHED_COURSE_FORMAT,
    formatVersion: PUBLISHED_COURSE_VERSION,
    sourceSchemaVersion: 9,
    courseId: project.id,
    title: project.title,
    assets,
    components,
    designTokens: cloneJson(project.designTokens),
    media: cloneJson(project.media),
    playback: cloneJson(project.playback),
    courseState: cloneJson(project.courseState),
    navigationGuards: cloneJson(project.navigationGuards),
    locations: cloneJson(project.locations),
    startLocationId: project.startLocationId,
    globalLayerItems: project.globalLayerItems.map((entry) => publishScoped(sources, entry)),
    globalInteractions: cloneJson(project.globalInteractions),
    surfaces: project.surfaces.map((surface) => publishSurface(sources, surface)),
    ...(project.mixedPrintPlan ? { mixedPrintPlan: cloneJson(project.mixedPrintPlan) } : {}),
  }
  return publishedCourseV2Schema.parse(published)
}
