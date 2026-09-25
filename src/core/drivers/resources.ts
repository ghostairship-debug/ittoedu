import type { DocumentResources } from '../../shared/workbench/document'
import { assertSafeArchivePath } from './codecs/archivePath'

export const emptyDocumentResources = (): DocumentResources => ({ assets: {}, components: {} })

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}必须是资源记录`)
}

/** Resource bytes are owned by the model; external buffers never remain writable aliases. */
export function cloneDocumentResources(resources: DocumentResources, relativePaths = false): DocumentResources {
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
    if (!id.trim() || !(bytes instanceof Uint8Array)) throw new TypeError('素材身份或字节无效')
    if (relativePaths) claimPath(id)
    assets[id] = Uint8Array.from(bytes)
  }
  for (const [id, files] of Object.entries(resources.components)) {
    if (!id.trim()) throw new TypeError('组件身份无效')
    if (relativePaths) assertSafeArchivePath(id, 'project')
    record(files, '组件包')
    const next: Record<string, Uint8Array> = Object.create(null)
    for (const [path, bytes] of Object.entries(files)) {
      assertSafeArchivePath(path, 'component')
      if (!(bytes instanceof Uint8Array)) throw new TypeError('组件文件不是有效字节')
      if (relativePaths) claimPath(`${id}/${path}`)
      next[path] = Uint8Array.from(bytes)
    }
    components[id] = next
  }
  return { assets, components }
}
