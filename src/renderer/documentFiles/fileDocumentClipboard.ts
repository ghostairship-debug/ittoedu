import { zipSync } from 'fflate'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { ComponentPackageData } from '../../shared/contracts/component-v4'
import type { DocumentResources } from '../../shared/document/resources'
import { importComponentPackage } from '../components/importComponentPackage'
import { createFileDocumentResourcePort } from '../document/fileDocumentResources'
import { createDocumentClipboardContext, readDocumentClipboardContext, selectDocumentClipboardContext, type DocumentClipboardContext } from '../document/documentClipboardContext'

export type FileClipboardContext = DocumentClipboardContext
type ResourceReader = (relativePath: string) => Promise<{ bytes: Uint8Array; mime: string; filename: string }>
export async function readFileClipboardContext(resources: DocumentResources, read: ResourceReader): Promise<DocumentClipboardContext> {
  const assets: Record<string, AssetMeta> = {}, assetFiles: Record<string, Uint8Array> = {}, componentPackages: Record<string, ComponentPackageData> = {}
  await Promise.all(resources.assets.map(async resource => {
    if (resource.source.kind !== 'relative') throw new Error('文件素材必须使用课例内引用')
    const loaded = await read(resource.source.path)
    const kind = loaded.mime.startsWith('image/') ? 'image' : loaded.mime.startsWith('audio/') ? 'audio' : loaded.mime.startsWith('video/') ? 'video' : loaded.mime.startsWith('font/') ? 'font' : null
    if (!kind) throw new Error(`不支持复制此素材：${loaded.filename}`)
    assets[resource.assetId] = { id: resource.assetId, filename: loaded.filename, mimeType: loaded.mime, kind, path: resource.source.path, byteLength: loaded.bytes.byteLength }
    assetFiles[resource.assetId] = loaded.bytes
  }))
  await Promise.all(resources.components.map(async resource => {
    if (resource.source.kind !== 'relative') throw new Error('文件组件必须使用课例内引用')
    const loaded = await read(resource.source.path)
    componentPackages[resource.packageId] = importComponentPackage(loaded.bytes, { expectedId: resource.packageId, expectedVersion: resource.version })
  }))
  return createDocumentClipboardContext(resources, { assets, assetFiles, componentPackages })
}
export function selectedFileClipboardContext(context: DocumentClipboardContext | null, resources: DocumentResources) {
  if (!context && (resources.assets.length || resources.components.length)) throw new Error('复制素材尚未读取完成，请稍后重试')
  return selectDocumentClipboardContext(context ?? { kind: 'cw-document-resources', assets: {}, components: {} }, resources)
}
export function fileClipboardResourcePort(value: unknown) {
  const source = readDocumentClipboardContext(value)
  return createFileDocumentResourcePort({
    resolveAsset: source.resolveAsset,
    async resolveComponent(resource) { return zipSync((await source.resolveComponent(resource)).data.files) },
  })
}
