import { zipFlatArchive } from '../../core/drivers/codecs/flatArchive'
import { documentResourceReferences, type DocumentResources } from '../../shared/document/resources'
import { walkDocument, type DocumentBlock } from '../../shared/document/content'
import { importComponentPackage } from '../../core/drivers/codecs/importComponentPackage'
import { createFileDocumentResourcePort } from '../document/fileDocumentResources'
import { createDocumentClipboardContext, documentComponentKey, readDocumentClipboardContext, selectDocumentClipboardContext, type DocumentClipboardContext } from '../document/documentClipboardContext'

export type FileClipboardContext = DocumentClipboardContext
type ResourceReader = (relativePath: string) => Promise<{ bytes: Uint8Array; mime: string; filename: string }>
export async function readFileClipboardContext(resources: DocumentResources, read: ResourceReader, options: {
  blocks?: readonly DocumentBlock[]; previous?: DocumentClipboardContext | null; unchanged?(path: string): boolean; onError?(error: Error): void
} = {}): Promise<DocumentClipboardContext> {
  const refs = options.blocks && documentResourceReferences(options.blocks)
  const used = refs ? { assets: resources.assets.filter(resource => refs.assets.includes(resource.assetId)),
    components: resources.components.filter(resource => refs.components.some(ref => ref.packageId === resource.packageId && ref.version === resource.version)) } : resources
  const kinds = new Map<string, 'image' | 'audio' | 'video'>()
  if (options.blocks) walkDocument(options.blocks, block => { if (block.type === 'media' && block.assetId) kinds.set(block.assetId, block.mediaKind) })
  const context: DocumentClipboardContext = { kind: 'cw-document-resources', assets: Object.create(null), components: Object.create(null) }
  const attempt = async (readOne: () => Promise<void>) => {
    try { await readOne() } catch (reason) { if (!options.onError) throw reason; options.onError(reason instanceof Error ? reason : new Error(String(reason))) }
  }
  await Promise.all(used.assets.map(resource => attempt(async () => {
    if (resource.source.kind !== 'relative') throw new Error('文件素材必须使用课例内引用')
    const previous = options.previous?.assets[resource.assetId], declaredKind = kinds.get(resource.assetId)
    if (previous && previous.meta.path === resource.source.path && (!declaredKind || previous.meta.kind === declaredKind) && options.unchanged?.(resource.source.path)) {
      context.assets[resource.assetId] = previous; return
    }
    const loaded = await read(resource.source.path)
    const kind = declaredKind ?? (loaded.mime.startsWith('image/') ? 'image' : loaded.mime.startsWith('audio/') ? 'audio' : loaded.mime.startsWith('video/') ? 'video' : loaded.mime.startsWith('font/') ? 'font' : null)
    if (!kind) throw new Error(`不支持复制此素材：${loaded.filename}`)
    const mimeType = kind === 'audio' && loaded.mime === 'video/mp4' ? 'audio/mp4' : loaded.mime
    const created = createDocumentClipboardContext({ assets: [resource], components: [] }, {
      assets: { [resource.assetId]: { id: resource.assetId, filename: loaded.filename, mimeType, kind, path: resource.source.path, byteLength: loaded.bytes.byteLength } },
      assetFiles: { [resource.assetId]: loaded.bytes }, componentPackages: {},
    })
    context.assets[resource.assetId] = created.assets[resource.assetId]
  })))
  await Promise.all(used.components.map(resource => attempt(async () => {
    if (resource.source.kind !== 'relative') throw new Error('文件组件必须使用课例内引用')
    const key = documentComponentKey(resource), previous = options.previous?.components[key]
    if (previous && options.unchanged?.(resource.source.path)) { context.components[key] = previous; return }
    const loaded = await read(resource.source.path)
    const created = createDocumentClipboardContext({ assets: [], components: [resource] }, { assets: {}, assetFiles: {},
      componentPackages: { [key]: importComponentPackage(loaded.bytes, { expectedId: resource.packageId, expectedVersion: resource.version }) },
    })
    context.components[key] = created.components[key]
  })))
  return context
}
export function selectedFileClipboardContext(context: DocumentClipboardContext | null, resources: DocumentResources) {
  if (!context && (resources.assets.length || resources.components.length)) throw new Error('复制素材尚未读取完成，请稍后重试')
  return selectDocumentClipboardContext(context ?? { kind: 'cw-document-resources', assets: {}, components: {} }, resources)
}
export function fileClipboardResourcePort(value: unknown) {
  const source = readDocumentClipboardContext(value)
  return createFileDocumentResourcePort({
    resolveAsset: source.resolveAsset,
    async resolveComponent(resource) { return zipFlatArchive((await source.resolveComponent(resource)).data.files) },
  })
}
