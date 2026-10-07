import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { courseProjectV10Schema } from '../../../shared/contracts/component-platform/schema'
import type { CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
import { assertSafeArchivePath } from './archivePath'
import { validateDocumentResources } from '../resources'

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
  const claim = (path: string) => {
    assertSafeArchivePath(path, 'project')
    const folded = path.toLowerCase()
    if (claimed.has(folded)) throw new Error(`工程资源路径重复：${path}`)
    claimed.add(folded)
  }
  for (const [id, asset] of Object.entries(project.assets)) {
    claim(asset.path)
    if (!Object.hasOwn(resources.assets, id)) throw new Error(`工程素材字节缺失：${id}`)
  }
  for (const id of Object.keys(resources.assets)) if (!Object.hasOwn(project.assets, id)) throw new Error(`素材字节缺少工程归属：${id}`)
  for (const [id, files] of Object.entries(resources.components)) for (const path of Object.keys(files)) claim(`components/${encodeURIComponent(id)}/${path}`)
}

export function createCourseProjectV10Archive(data: CourseProjectV10ArchiveData): Uint8Array {
  validateCourseProjectV10Archive(data)
  const files: Record<string, Uint8Array> = Object.create(null)
  files['project.json'] = strToU8(JSON.stringify(data.project))
  for (const [id, asset] of Object.entries(data.project.assets)) files[asset.path] = data.resources.assets[id]
  for (const [id, component] of Object.entries(data.resources.components)) for (const [path, bytes] of Object.entries(component)) files[`components/${encodeURIComponent(id)}/${path}`] = bytes
  return zipSync(files)
}

export function openCourseProjectV10Archive(bytes: Uint8Array): CourseProjectV10ArchiveData {
  const files = unzipSync(bytes)
  for (const path of Object.keys(files)) assertSafeArchivePath(path, 'project', { allowDirectory: true })
  if (!files['project.json']) throw new Error('工程包缺少 project.json')
  const raw: unknown = JSON.parse(strFromU8(files['project.json']))
  if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw) || raw.schemaVersion !== 10) throw new Error('此入口仅支持独立 Project V10；旧工程原件未改变')
  const project = courseProjectV10Schema.parse(raw)
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
  return { project, resources }
}
