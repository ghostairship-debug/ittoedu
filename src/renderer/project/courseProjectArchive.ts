import { strToU8, unzip, unzipSync, zip, zipSync } from 'fflate'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { UserFacingError } from '@/shared/errors'
import type { EmbeddedComponentPackageMeta } from '@/shared/contracts/component-v4'
import {
  assertSafeArchivePath,
  componentArchiveRoot,
  componentPackageKey,
  isArchiveDirectory,
} from './archivePath'

const PROJECT_DOCUMENT_PATH = 'project.json'
const MAX_COURSE_PROJECT_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
const MAX_COURSE_PROJECT_ENTRIES = 100_000
const MAX_ARCHIVE_PATH_LENGTH = 1_024

export interface CourseProjectArchiveData {
  project: CourseProjectDocument
  /** Binary asset data keyed by AssetMeta.id. */
  assetFiles: Record<string, Uint8Array>
  /** Component files keyed by `${packageId}@${version}`. */
  componentFiles: Record<string, Record<string, Uint8Array>>
}

export interface CourseProjectArchiveIdentity {
  schemaVersion: number | null
  projectId: string | null
  revision: number | null
  updatedAt: string | null
  title: string | null
}

export type CourseProjectArchiveFormatKind =
  | 'v9'
  | 'corrupted'
  | 'unsupported'

export interface CourseProjectArchiveFormatProbe {
  kind: CourseProjectArchiveFormatKind
  identity: CourseProjectArchiveIdentity
  reason: string
}

export interface CreateCourseProjectArchiveOptions {
  /** Optional deterministic ZIP timestamp, primarily used by fixtures/exporters. */
  mtime?: Date | string | number
  signal?: AbortSignal
}

export class UnsupportedCourseProjectVersionError extends Error {
  constructor(public readonly schemaVersion: number | null) {
    super(`Unsupported Course Project schema version: ${schemaVersion ?? 'missing'}`)
    this.name = 'UnsupportedCourseProjectVersionError'
  }
}

function openError(message: string, cause?: unknown): UserFacingError {
  return new UserFacingError(
    '课程工程文件损坏',
    message,
    '请重新选择有效的课程工程，或从备份恢复。不要把损坏文件另存覆盖原件。',
    { cause },
  )
}

function saveError(message: string, cause?: unknown): UserFacingError {
  return new UserFacingError(
    '课程工程保存失败',
    message,
    '请检查工程内容后重试；如问题持续，请另存为新文件。',
    { cause },
  )
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]'
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch (error) {
    throw openError('project.json 不是有效的 UTF-8 JSON 文件。', error)
  }
}

function declaredSchemaVersion(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const version = Reflect.get(value, 'schemaVersion')
  return typeof version === 'number' && Number.isInteger(version) ? version : null
}

function emptyArchiveIdentity(): CourseProjectArchiveIdentity {
  return {
    schemaVersion: null,
    projectId: null,
    revision: null,
    updatedAt: null,
    title: null,
  }
}

function identityFromProjectJson(value: unknown): CourseProjectArchiveIdentity {
  if (typeof value !== 'object' || value === null) return emptyArchiveIdentity()
  const record = value as Record<string, unknown>
  const schemaVersion = declaredSchemaVersion(value)
  return {
    schemaVersion,
    projectId: typeof record.id === 'string' && record.id.length > 0 ? record.id : null,
    revision: typeof record.revision === 'number' && Number.isInteger(record.revision)
      ? record.revision
      : null,
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt.length > 0
      ? record.updatedAt
      : null,
    title: typeof record.title === 'string' && record.title.length > 0 ? record.title : null,
  }
}

type ArchiveProjectPeek = {
  identity: CourseProjectArchiveIdentity
  failure: null | 'empty' | 'unzip' | 'missing-json' | 'invalid-json'
}

function peekArchiveProject(bytes: Uint8Array): ArchiveProjectPeek {
  if (bytes.byteLength === 0) {
    return { identity: emptyArchiveIdentity(), failure: 'empty' }
  }
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, archiveFilter())
  } catch {
    return { identity: emptyArchiveIdentity(), failure: 'unzip' }
  }
  const projectBytes = files[PROJECT_DOCUMENT_PATH]
  if (!projectBytes) {
    return { identity: emptyArchiveIdentity(), failure: 'missing-json' }
  }
  try {
    const value = decodeJson(projectBytes)
    return { identity: identityFromProjectJson(value), failure: null }
  } catch {
    return { identity: emptyArchiveIdentity(), failure: 'invalid-json' }
  }
}

/** Peeks archive identity without opening the document. */
export function inspectCourseProjectArchiveIdentity(
  bytes: Uint8Array,
): CourseProjectArchiveIdentity {
  return peekArchiveProject(bytes).identity
}

/**
 * Classifies a zip as V9, corrupted, or an unsupported integer schema version.
 * Does not infer format from `scenes` / `locations` when schemaVersion is missing.
 */
export function detectCourseProjectArchiveFormat(
  bytes: Uint8Array,
): CourseProjectArchiveFormatProbe {
  const peeked = peekArchiveProject(bytes)
  if (peeked.failure === 'empty') {
    return { kind: 'corrupted', identity: peeked.identity, reason: '所选课程工程文件为空。' }
  }
  if (peeked.failure === 'unzip') {
    return { kind: 'corrupted', identity: peeked.identity, reason: '无法解压课程工程，文件可能已损坏。' }
  }
  if (peeked.failure === 'missing-json') {
    return { kind: 'corrupted', identity: peeked.identity, reason: '工程包缺少根目录下的 project.json。' }
  }
  if (peeked.failure === 'invalid-json') {
    return { kind: 'corrupted', identity: peeked.identity, reason: 'project.json 不是有效的 UTF-8 JSON 文件。' }
  }

  const { identity } = peeked
  if (identity.schemaVersion === 9) {
    return { kind: 'v9', identity, reason: '这是 Course Project V9 工程。' }
  }
  if (identity.schemaVersion !== null) {
    return {
      kind: 'unsupported',
      identity,
      reason: `该文件的格式版本为 ${identity.schemaVersion}，当前编辑器无法直接打开。`,
    }
  }
  return { kind: 'corrupted', identity, reason: 'project.json 未声明有效的 schemaVersion。' }
}

function readCourseProject(bytes: Uint8Array): CourseProjectDocument {
  const value = decodeJson(bytes)
  const schemaVersion = declaredSchemaVersion(value)
  if (schemaVersion === 9) {
    const parsed = courseProjectDocumentSchema.safeParse(value)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw openError(
        `project.json 校验失败：${issue?.path.join('.') || 'project'} ${issue?.message ?? '字段无效'}。`,
        parsed.error,
      )
    }
    return parsed.data
  }

  const cause = new UnsupportedCourseProjectVersionError(schemaVersion)
  if (schemaVersion !== null) {
    throw new UserFacingError(
      '课程工程版本不支持',
      `该文件的格式版本为 ${schemaVersion}，当前编辑器无法直接打开。`,
      `请使用支持格式版本 ${schemaVersion} 的编辑器打开。当前不会转换不受支持的工程。`,
      { cause },
    )
  }
  throw openError('project.json 未声明有效的 schemaVersion。', cause)
}

function validateCourseProjectForSave(project: CourseProjectDocument): CourseProjectDocument {
  const parsed = courseProjectDocumentSchema.safeParse(project)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw saveError(
      `工程数据校验失败：${issue?.path.join('.') || 'project'} ${issue?.message ?? '字段无效'}。`,
      parsed.error,
    )
  }
  return parsed.data
}

function assertLeafFilename(filename: string, context: string, opening: boolean): void {
  if (
    filename.trim().length === 0 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    /^[a-zA-Z]:/.test(filename)
  ) {
    const message = `${context}包含绝对路径或无效文件名。`
    throw opening ? openError(message) : saveError(message)
  }
}

function assertPortablePath(path: string, context: string, opening: boolean): void {
  try {
    assertSafeArchivePath(path, 'project')
  } catch (error) {
    if (opening) throw openError(`${context}的存储路径不安全。`, error)
    throw saveError(`${context}的存储路径不安全。`, error)
  }
  if (path.length > MAX_ARCHIVE_PATH_LENGTH) {
    const message = `${context}的存储路径过长。`
    throw opening ? openError(message) : saveError(message)
  }
}

function validateAssetPath(path: string, opening: boolean): void {
  assertPortablePath(path, `素材“${path}”`, opening)
  if (!path.startsWith('assets/')) {
    const message = `素材路径“${path}”必须位于 assets/ 目录。`
    throw opening ? openError(message) : saveError(message)
  }
}

function getComponentFiles(
  componentFiles: Readonly<Record<string, Readonly<Record<string, Uint8Array>>>>,
  recordKey: string,
  meta: EmbeddedComponentPackageMeta,
): Readonly<Record<string, Uint8Array>> | undefined {
  return componentFiles[componentPackageKey(meta.packageId, meta.version)]
    ?? componentFiles[recordKey]
    ?? componentFiles[meta.packageId]
}

function validateComponent(
  meta: EmbeddedComponentPackageMeta,
  recordKey: string,
  files: Readonly<Record<string, Uint8Array>>,
  opening: boolean,
): void {
  let parsed: ReturnType<typeof parseComponentPackageFiles>
  try {
    parsed = parseComponentPackageFiles(files, {
      expectedId: meta.packageId,
      expectedVersion: meta.version,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : '组件内容无效'
    const message = `工程内组件“${recordKey}”无效：${detail}`
    throw opening ? openError(message, error) : saveError(message, error)
  }

  const root = componentArchiveRoot(meta.packageId, meta.version)
  const expectedManifest = `${root}/manifest.json`
  const expectedRuntime = `${root}/${parsed.manifest.entry}`
  const expectedThumbnail = parsed.manifest.thumbnail
    ? `${root}/${parsed.manifest.thumbnail}`
    : undefined
  const valid =
    parsed.manifest.name === meta.name &&
    parsed.contentSha256 === meta.contentSha256 &&
    meta.manifestPath === expectedManifest &&
    meta.runtimePath === expectedRuntime &&
    meta.thumbnailPath === expectedThumbnail
  if (!valid) {
    const message = `组件“${recordKey}”的名称、内容校验或嵌入路径与包内文件不一致。`
    throw opening ? openError(message) : saveError(message)
  }
}

function addArchiveFile(
  files: Record<string, Uint8Array>,
  foldedPaths: Set<string>,
  path: string,
  bytes: Uint8Array,
): void {
  assertPortablePath(path, `归档项“${path}”`, false)
  const folded = path.toLocaleLowerCase('en-US')
  if (hasOwn(files, path) || foldedPaths.has(folded)) {
    throw saveError(`归档路径重复或仅大小写不同：“${path}”。`)
  }
  if (!isUint8Array(bytes)) {
    throw saveError(`归档项“${path}”不是有效的二进制内容。`)
  }
  files[path] = bytes
  foldedPaths.add(folded)
}

function createCourseProjectArchiveFiles(
  data: CourseProjectArchiveData,
): Record<string, Uint8Array> {
  const project = validateCourseProjectForSave(data.project)
  const files = Object.create(null) as Record<string, Uint8Array>
  const foldedPaths = new Set<string>()
  addArchiveFile(
    files,
    foldedPaths,
    PROJECT_DOCUMENT_PATH,
    strToU8(JSON.stringify(project, null, 2)),
  )

  for (const [assetId, meta] of Object.entries(project.assets)) {
    if (assetId !== meta.id) throw saveError(`素材记录键“${assetId}”与素材 ID 不一致。`)
    assertLeafFilename(meta.filename, `素材“${assetId}”`, false)
    validateAssetPath(meta.path, false)
    const bytes = hasOwn(data.assetFiles, assetId) ? data.assetFiles[assetId] : undefined
    if (!isUint8Array(bytes)) throw saveError(`素材“${meta.filename}”缺少二进制内容。`)
    if (bytes.byteLength !== meta.byteLength) {
      throw saveError(`素材“${meta.filename}”的字节数与工程记录不一致。`)
    }
    addArchiveFile(files, foldedPaths, meta.path, bytes)
  }
  for (const suppliedId of Object.keys(data.assetFiles)) {
    if (!hasOwn(project.assets, suppliedId)) throw saveError(`存在未登记的素材文件“${suppliedId}”。`)
  }

  const expectedComponentKeys = new Set<string>()
  for (const [recordKey, meta] of Object.entries(project.componentPackages)) {
    const canonicalKey = componentPackageKey(meta.packageId, meta.version)
    if (expectedComponentKeys.has(canonicalKey)) throw saveError(`组件“${canonicalKey}”在工程中重复。`)
    expectedComponentKeys.add(canonicalKey)
    const packageFiles = getComponentFiles(data.componentFiles, recordKey, meta)
    if (!packageFiles) throw saveError(`组件“${canonicalKey}”缺少包文件。`)
    validateComponent(meta, recordKey, packageFiles, false)
    const root = componentArchiveRoot(meta.packageId, meta.version)
    for (const [relativePath, bytes] of Object.entries(packageFiles)) {
      assertSafeArchivePath(relativePath, 'component')
      addArchiveFile(files, foldedPaths, `${root}/${relativePath}`, bytes)
    }
  }
  for (const suppliedKey of Object.keys(data.componentFiles)) {
    if (
      !expectedComponentKeys.has(suppliedKey) &&
      !Object.entries(project.componentPackages).some(
        ([recordKey, meta]) => suppliedKey === recordKey || suppliedKey === meta.packageId,
      )
    ) {
      throw saveError(`存在未登记的组件文件“${suppliedKey}”。`)
    }
  }
  if (Object.keys(files).length > MAX_COURSE_PROJECT_ENTRIES) {
    throw saveError(`课程工程包超过 ${MAX_COURSE_PROJECT_ENTRIES} 个文件的安全限制。`)
  }
  return files
}

function parseCourseProjectArchiveFiles(
  files: Record<string, Uint8Array>,
): CourseProjectArchiveData {
  const projectBytes = files[PROJECT_DOCUMENT_PATH]
  if (!projectBytes) throw openError('工程包缺少根目录下的 project.json。')
  const project = readCourseProject(projectBytes)
  const consumedPaths = new Set<string>([PROJECT_DOCUMENT_PATH])
  const foldedPaths = new Map<string, string>()
  for (const path of Object.keys(files)) {
    const folded = path.toLocaleLowerCase('en-US')
    const existing = foldedPaths.get(folded)
    if (existing !== undefined && existing !== path) {
      throw openError(`工程包包含仅大小写不同的冲突路径：“${existing}”与“${path}”。`)
    }
    foldedPaths.set(folded, path)
  }

  const assetFiles = Object.create(null) as Record<string, Uint8Array>
  const seenAssetPaths = new Set<string>()
  for (const [assetId, meta] of Object.entries(project.assets)) {
    if (assetId !== meta.id) throw openError(`素材记录键“${assetId}”与素材 ID 不一致。`)
    assertLeafFilename(meta.filename, `素材“${assetId}”`, true)
    validateAssetPath(meta.path, true)
    if (seenAssetPaths.has(meta.path)) throw openError(`多个素材使用了相同路径“${meta.path}”。`)
    seenAssetPaths.add(meta.path)
    const bytes = files[meta.path]
    if (!bytes) throw openError(`工程包缺少素材“${meta.filename}”。`)
    if (bytes.byteLength !== meta.byteLength) throw openError(`素材“${meta.filename}”的字节数与记录不一致。`)
    assetFiles[assetId] = bytes
    consumedPaths.add(meta.path)
  }

  const componentFiles = Object.create(null) as Record<string, Record<string, Uint8Array>>
  for (const [recordKey, meta] of Object.entries(project.componentPackages)) {
    const canonicalKey = componentPackageKey(meta.packageId, meta.version)
    const root = `${componentArchiveRoot(meta.packageId, meta.version)}/`
    const packageFiles = Object.create(null) as Record<string, Uint8Array>
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith(root)) continue
      const relativePath = path.slice(root.length)
      if (!relativePath) continue
      assertSafeArchivePath(relativePath, 'component')
      packageFiles[relativePath] = bytes
      consumedPaths.add(path)
    }
    if (Object.keys(packageFiles).length === 0) throw openError(`工程包缺少组件“${canonicalKey}”的文件。`)
    validateComponent(meta, recordKey, packageFiles, true)
    componentFiles[canonicalKey] = packageFiles
  }

  const unregistered = Object.keys(files).find((path) => !consumedPaths.has(path))
  if (unregistered !== undefined) {
    throw openError(`工程包包含未登记文件“${unregistered}”。`)
  }
  return { project, assetFiles, componentFiles }
}

function archiveFilter(): { filter(file: { name: string; originalSize: number }): boolean } {
  let totalBytes = 0
  let entries = 0
  return {
    filter(file) {
      assertSafeArchivePath(file.name, 'project', { allowDirectory: true })
      if (file.name.length > MAX_ARCHIVE_PATH_LENGTH) throw openError('工程包包含过长的文件路径。')
      entries += 1
      if (entries > MAX_COURSE_PROJECT_ENTRIES) throw openError('工程包文件数超过安全限制。')
      totalBytes += file.originalSize
      if (totalBytes > MAX_COURSE_PROJECT_UNCOMPRESSED_BYTES) {
        throw openError('工程解压后超过 512MB 安全限制。')
      }
      return !isArchiveDirectory(file.name)
    },
  }
}

function abortError(): Error {
  return new DOMException('操作已取消。', 'AbortError')
}

export function createCourseProjectArchive(
  data: CourseProjectArchiveData,
  options: CreateCourseProjectArchiveOptions = {},
): Uint8Array {
  if (options.signal?.aborted) throw abortError()
  try {
    return zipSync(createCourseProjectArchiveFiles(data), {
      level: 6,
      ...(options.mtime === undefined ? {} : { mtime: options.mtime }),
    })
  } catch (error) {
    if (error instanceof UserFacingError || error instanceof DOMException) throw error
    throw saveError('压缩课程工程失败。', error)
  }
}

export async function createCourseProjectArchiveAsync(
  data: CourseProjectArchiveData,
  options: CreateCourseProjectArchiveOptions = {},
): Promise<Uint8Array> {
  if (options.signal?.aborted) throw abortError()
  const files = createCourseProjectArchiveFiles(data)
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false
    let terminate = () => {}
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      operation()
    }
    const onAbort = () => {
      terminate()
      finish(() => reject(abortError()))
    }
    try {
      terminate = zip(files, {
        level: 6,
        ...(options.mtime === undefined ? {} : { mtime: options.mtime }),
      }, (error, bytes) => {
        if (error) finish(() => reject(saveError('压缩课程工程失败。', error)))
        else finish(() => resolve(bytes))
      })
    } catch (error) {
      finish(() => reject(error instanceof UserFacingError ? error : saveError('压缩课程工程失败。', error)))
      return
    }
    if (!settled) {
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted) onAbort()
    }
  })
}

export function openCourseProjectArchive(bytes: Uint8Array): CourseProjectArchiveData {
  if (bytes.byteLength === 0) throw openError('所选课程工程文件为空。')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, archiveFilter())
  } catch (error) {
    if (error instanceof UserFacingError) throw error
    throw openError('无法解压课程工程，文件可能已损坏。', error)
  }
  return parseCourseProjectArchiveFiles(files)
}

export async function openCourseProjectArchiveAsync(
  bytes: Uint8Array,
  options: { signal?: AbortSignal } = {},
): Promise<CourseProjectArchiveData> {
  if (bytes.byteLength === 0) throw openError('所选课程工程文件为空。')
  if (options.signal?.aborted) throw abortError()
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let settled = false
    let terminate = () => {}
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      operation()
    }
    const onAbort = () => {
      terminate()
      finish(() => reject(abortError()))
    }
    try {
      terminate = unzip(bytes, archiveFilter(), (error, unzipped) => {
        if (error) finish(() => reject(openError('无法解压课程工程，文件可能已损坏。', error)))
        else finish(() => resolve(unzipped))
      })
    } catch (error) {
      finish(() => reject(error instanceof UserFacingError ? error : openError('无法解压课程工程，文件可能已损坏。', error)))
      return
    }
    if (!settled) {
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted) onAbort()
    }
  })
  return parseCourseProjectArchiveFiles(files)
}
