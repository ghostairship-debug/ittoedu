import type { DocumentResources } from '../../shared/workbench/document'
import { assertSafeArchivePath } from './codecs/archivePath'

export const emptyDocumentResources = (): DocumentResources => ({ assets: {}, components: {} })

/** Tag check instead of `instanceof`: bytes cloned in another realm (jsdom, structuredClone) keep their tag. */
function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]'
}

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}必须是资源记录`)
}

/** Resource bytes are owned by the model; external buffers never remain writable aliases. */
export function cloneDocumentResources(resources: DocumentResources, relativePaths = false): DocumentResources {
  return mapDocumentResources(resources, bytes => Uint8Array.from(bytes), relativePaths)
}

/** Validate resource structure and paths without allocating a second copy of every byte. */
export function validateDocumentResources(resources: DocumentResources, relativePaths = false): void {
  mapDocumentResources(resources, bytes => bytes, relativePaths)
}

function mapDocumentResources(resources: DocumentResources, copy: (bytes: Uint8Array) => Uint8Array, relativePaths: boolean): DocumentResources {
  record(resources, 'resources')
  if (Object.keys(resources).some(key => key !== 'assets' && key !== 'components')) throw new TypeError('未知资源字段')
  record(resources.assets, 'assets')
  record(resources.components, 'components')
  const assets: DocumentResources['assets'] = Object.create(null)
  const components: DocumentResources['components'] = Object.create(null)
  const paths = new Set<string>()
  const claimPath = (path: string) => {
    assertSafeArchivePath(path, 'project')
    const folded = path.toLocaleLowerCase('en-US')
    if ([...paths].some(existing => existing === folded || existing.startsWith(`${folded}/`) || folded.startsWith(`${existing}/`))) throw new TypeError(`冲突的资源路径：${path}`)
    paths.add(folded)
  }
  for (const [id, bytes] of Object.entries(resources.assets)) {
    if (!id.trim() || !isUint8Array(bytes)) throw new TypeError('素材身份或字节无效')
    if (relativePaths) claimPath(id)
    assets[id] = copy(bytes)
  }
  for (const [id, files] of Object.entries(resources.components)) {
    if (!id.trim()) throw new TypeError('组件身份无效')
    if (relativePaths) assertSafeArchivePath(id, 'project')
    record(files, '组件包')
    const next: Record<string, Uint8Array> = Object.create(null)
    for (const [path, bytes] of Object.entries(files)) {
      assertSafeArchivePath(path, 'component')
      if (!isUint8Array(bytes)) throw new TypeError('组件文件不是有效字节')
      if (relativePaths) claimPath(`${id}/${path}`)
      next[path] = copy(bytes)
    }
    components[id] = next
  }
  return { assets, components }
}

/** Session-owned snapshots may share unchanged bytes; callers must never receive these aliases. */
export function retainDocumentResourceBytes(resources: DocumentResources, previous: DocumentResources): DocumentResources {
  const retain = (bytes: Uint8Array, prior?: Uint8Array): Uint8Array => {
    if (prior === bytes || prior?.length === bytes.length && bytes.every((value, index) => value === prior[index])) return prior!
    return Uint8Array.from(bytes)
  }
  const assets: DocumentResources['assets'] = Object.create(null)
  const components: DocumentResources['components'] = Object.create(null)
  for (const [id, bytes] of Object.entries(resources.assets)) assets[id] = retain(bytes, previous.assets[id])
  for (const [id, files] of Object.entries(resources.components)) {
    const next: Record<string, Uint8Array> = Object.create(null)
    for (const [name, bytes] of Object.entries(files)) next[name] = retain(bytes, previous.components[id]?.[name])
    components[id] = next
  }
  return { assets, components }
}
