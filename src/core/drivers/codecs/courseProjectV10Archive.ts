import { strFromU8, strToU8 } from 'fflate'
import { courseProjectV10Schema } from '../../../shared/contracts/component-platform/schema'
import { createWorkProjectMigrationMap, normalizeWorkProject, type WorkProjectMigrationMap } from '../../../shared/contracts/component-platform/workProjectMigration'
import type { CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
import { assertSafeArchivePath } from './archivePath'
import { validateDocumentResources } from '../resources'
import { unzipFlatArchive, zipFlatArchive } from './flatArchive'
import { normalizeWebAuthoring } from '../../components/authoring/normalizeWebAuthoring'
import { createResourceContentIndex, resourceContentSha256 } from '../../../shared/resourceContent'

const RESOURCE_INDEX_PATH = 'resource-index.json'
const resourceContentPath = (digest: string) => `resources/sha256/${digest}`

interface ArchiveResourceIndex {
  format: 'guoling-resource-index'
  version: 1
  /** Original resource paths retain editing identities; only ZIP storage is addressed by content. */
  paths: Record<string, string>
}

export interface CourseProjectV10ArchiveData {
  project: CourseProjectV10
  resources: DocumentResources
}

export function validateCourseProjectV10Archive(data: CourseProjectV10ArchiveData): void {
  const project = courseProjectV10Schema.parse(data.project)
  validateCourseProjectV10Resources(project, data.resources)
}

/** Resource closure is checked separately when the operation owner has already parsed the project. */
export function validateCourseProjectV10Resources(project: CourseProjectV10, resources: DocumentResources): void {
  validateDocumentResources(resources)
  const claimed = new Set<string>(['project.json'])
  const physicalClaimed = new Set<string>(['project.json'])
  const claim = (path: string, virtual = false) => {
    assertSafeArchivePath(path, 'project')
    if (claimed.has(path) || !virtual && physicalClaimed.has(path.toLowerCase())) throw new Error(`工程资源路径重复：${path}`)
    claimed.add(path)
    if (!virtual) physicalClaimed.add(path.toLowerCase())
  }
  for (const [id, asset] of Object.entries(project.assets)) {
    claim(asset.path)
    if (!Object.hasOwn(resources.assets, id)) throw new Error(`工程素材字节缺失：${id}`)
  }
  for (const id of Object.keys(resources.assets)) if (!Object.hasOwn(project.assets, id)) throw new Error(`素材字节缺少工程归属：${id}`)
  for (const [id, files] of Object.entries(resources.components)) for (const path of Object.keys(files)) claim(`components/${encodeURIComponent(id)}/${path}`, true)
}

export function createCourseProjectV10Archive(data: CourseProjectV10ArchiveData): Uint8Array {
  validateCourseProjectV10Archive(data)
  const files: Record<string, Uint8Array> = Object.create(null)
  files['project.json'] = strToU8(JSON.stringify(data.project))
  const contents = createResourceContentIndex()
  const index: ArchiveResourceIndex = { format: 'guoling-resource-index', version: 1, paths: Object.create(null) }
  const add = (path: string, bytes: Uint8Array) => { index.paths[path] = contents.add(bytes).sha256 }
  for (const [id, asset] of Object.entries(data.project.assets)) add(asset.path, data.resources.assets[id])
  for (const [id, component] of Object.entries(data.resources.components)) for (const [path, bytes] of Object.entries(component)) add(`components/${encodeURIComponent(id)}/${path}`, bytes)
  if (Object.keys(index.paths).length) {
    files[RESOURCE_INDEX_PATH] = strToU8(JSON.stringify(index))
    for (const content of contents.values()) files[resourceContentPath(content.sha256)] = content.bytes
  }
  return zipFlatArchive(files)
}

/** Existing path-based packages remain readable. New packages expand to the same
 * logical file map before any project/component consumer observes their bytes.
 */
function logicalArchiveFiles(files: Record<string, Uint8Array>, project: CourseProjectV10): Record<string, Uint8Array> {
  if (!files[RESOURCE_INDEX_PATH]) return files
  // A pre-index archive could legally have an asset with this path.
  const namedAsset = Object.values(project.assets).some(asset => asset.path === RESOURCE_INDEX_PATH)
  let raw: unknown
  try { raw = JSON.parse(strFromU8(files[RESOURCE_INDEX_PATH])) } catch (error) { if (namedAsset) return files; throw error }
  if (!raw || typeof raw !== 'object' || !('format' in raw) || raw.format !== 'guoling-resource-index') {
    if (namedAsset) return files
    throw new Error('工程资源索引无效')
  }
  if (!('version' in raw) || raw.version !== 1 || !('paths' in raw)
    || !raw.paths || typeof raw.paths !== 'object' || Array.isArray(raw.paths)) throw new Error('工程资源索引无效')
  const logical: Record<string, Uint8Array> = Object.create(null)
  logical['project.json'] = files['project.json']
  const consumed = new Set(['project.json', RESOURCE_INDEX_PATH])
  for (const [path, digest] of Object.entries(raw.paths)) {
    assertSafeArchivePath(path, 'project')
    if (path === 'project.json' || typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw new Error(`工程资源索引无效：${path}`)
    const physicalPath = resourceContentPath(digest), bytes = files[physicalPath]
    if (!bytes) throw new Error(`工程资源实体缺失：${path}`)
    if (!consumed.has(physicalPath) && resourceContentSha256(bytes) !== digest) throw new Error(`工程资源内容与索引不符：${path}`)
    consumed.add(physicalPath)
    // Public archive results have independent mutable logical entries, as before.
    logical[path] = Uint8Array.from(bytes)
  }
  for (const path of Object.keys(files)) if (!consumed.has(path) && !path.endsWith('/')) throw new Error(`工程包中存在未归属文件：${path}`)
  return logical
}

export function openCourseProjectV10Archive(bytes: Uint8Array, options: { identities?: WorkProjectMigrationMap; includeMigrationIds?: boolean } = {}): CourseProjectV10ArchiveData & { courseProjectMigrationIds?: WorkProjectMigrationMap } {
  let files = unzipFlatArchive(bytes)
  for (const path of Object.keys(files)) assertSafeArchivePath(path, 'project', { allowDirectory: true })
  if (!files['project.json']) throw new Error('工程包缺少 project.json')
  const raw: unknown = JSON.parse(strFromU8(files['project.json']))
  if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw) || raw.schemaVersion !== 10 && raw.schemaVersion !== 11) throw new Error('此入口支持 Project 11 及现行 V10 的单次读入转换；原件未改变')
  const identities = raw.schemaVersion === 10 ? createWorkProjectMigrationMap([raw], options.identities) : undefined
  const project = normalizeWebAuthoring(normalizeWorkProject(raw, identities))
  files = logicalArchiveFiles(files, project)
  const resources: DocumentResources = { assets: Object.create(null), components: Object.create(null) }
  const consumed = new Set(['project.json'])
  for (const [id, asset] of Object.entries(project.assets)) {
    if (!files[asset.path]) throw new Error(`工程素材字节缺失：${id}`)
    resources.assets[id] = files[asset.path]
    consumed.add(asset.path)
  }
  for (const [path, content] of Object.entries(files)) {
    if (consumed.has(path) || path.endsWith('/')) continue
    if (!path.startsWith('components/')) throw new Error(`工程包中存在未归属文件：${path}`)
    const [, encodedId, ...parts] = path.split('/')
    if (!encodedId || !parts.length) throw new Error('组件资源路径无效')
    const id = decodeURIComponent(encodedId)
    resources.components[id] ??= Object.create(null)
    resources.components[id][parts.join('/')] = content
  }
  validateCourseProjectV10Resources(project, resources)
  return { project, resources, ...(options.includeMigrationIds && identities ? { courseProjectMigrationIds: identities } : {}) }
}
