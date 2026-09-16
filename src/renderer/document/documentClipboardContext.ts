import { z } from 'zod'
import { assetMetaSchema } from '../../shared/contracts/media-v1/schema'
import type { AssetMeta } from '../../shared/contracts/media-v1/types'
import { componentManifestSchema, embeddedComponentPackageMetaSchema } from '../../shared/contracts/component-v4/schema'
import type { ComponentPackageData, EmbeddedComponentPackageMeta } from '../../shared/contracts/component-v4/types'
import { documentResourcesSchema, type DocumentResources } from '../../shared/document/resources'
import { componentPackageMeta } from '../components/editableComponentPackage'
import { parseComponentPackageFiles } from '../components/importComponentPackage'

const bytesSchema = z.array(z.number().int().min(0).max(255))
const contextSchema = z.object({
  kind: z.literal('cw-document-resources'),
  assets: z.record(z.string(), z.object({ meta: assetMetaSchema, bytes: bytesSchema }).strict()),
  components: z.record(z.string(), z.object({ meta: embeddedComponentPackageMetaSchema, data: z.object({
    manifest: componentManifestSchema, runtimeSource: z.string(), contentSha256: z.string().optional(),
    files: z.record(z.string(), bytesSchema),
  }).strict() }).strict()),
}).strict()
export type DocumentClipboardContext = z.infer<typeof contextSchema>
type AssetRef = DocumentResources['assets'][number]
type ComponentRef = DocumentResources['components'][number]

export function createDocumentClipboardContext(resources: DocumentResources, source: {
  assets: Readonly<Record<string, AssetMeta>>
  assetFiles: Readonly<Record<string, Uint8Array>>
  componentPackages: Readonly<Record<string, ComponentPackageData>>
}): DocumentClipboardContext {
  documentResourcesSchema.parse(resources)
  const context: DocumentClipboardContext = { kind: 'cw-document-resources', assets: {}, components: {} }
  for (const ref of resources.assets) {
    const meta = source.assets[ref.assetId]
    const bytes = meta && source.assetFiles[ref.assetId]
    if (!meta || !bytes) throw new Error(`复制素材缺少真实文件：${ref.assetId}`)
    context.assets[ref.assetId] = { meta: structuredClone(meta), bytes: Array.from(bytes) }
  }
  for (const ref of resources.components) {
    const data = source.componentPackages[ref.packageId]
    if (!data || data.manifest.version !== ref.version) throw new Error(`复制组件缺少真实包：${ref.packageId}@${ref.version}`)
    if (context.components[ref.packageId] && context.components[ref.packageId].meta.version !== ref.version) throw new Error('同一复制片段不能携带冲突的组件版本')
    context.components[ref.packageId] = { meta: componentPackageMeta(data), data: {
      manifest: structuredClone(data.manifest), runtimeSource: data.runtimeSource, contentSha256: data.contentSha256,
      files: Object.fromEntries(Object.entries(data.files).map(([filename, bytes]) => [filename, Array.from(bytes)])),
    } }
  }
  return validated(context)
}

function validated(input: unknown): DocumentClipboardContext {
  const context = contextSchema.parse(input)
  for (const [id, asset] of Object.entries(context.assets)) {
    if (asset.meta.id !== id || asset.meta.byteLength !== asset.bytes.length) throw new Error(`复制素材身份或字节长度不符：${id}`)
  }
  for (const [id, entry] of Object.entries(context.components)) {
    if (id !== entry.meta.packageId) throw new Error(`复制组件身份不符：${id}`)
    const data = parseComponentPackageFiles(Object.fromEntries(Object.entries(entry.data.files).map(([filename, bytes]) => [filename, Uint8Array.from(bytes)])), {
      expectedId: id, expectedVersion: entry.meta.version,
      provenance: entry.meta.sha256 ? { sha256: entry.meta.sha256, importedAt: entry.meta.importedAt!, sourceLabel: entry.meta.sourceLabel! } : undefined,
    })
    if (JSON.stringify(data.manifest) !== JSON.stringify(entry.data.manifest) || data.runtimeSource !== entry.data.runtimeSource
      || data.contentSha256 !== entry.meta.contentSha256 || entry.data.contentSha256 !== undefined && data.contentSha256 !== entry.data.contentSha256) throw new Error(`复制组件内容与声明不符：${id}`)
    const expected = componentPackageMeta(data, entry.meta)
    for (const key of ['manifestPath', 'runtimePath', 'thumbnailPath', 'name'] as const) if (entry.meta[key] !== expected[key]) throw new Error(`复制组件元数据不符：${id}`)
  }
  return context
}

export function selectDocumentClipboardContext(input: unknown, resources: DocumentResources): DocumentClipboardContext {
  const context = validated(input)
  documentResourcesSchema.parse(resources)
  const selected: DocumentClipboardContext = { kind: 'cw-document-resources', assets: {}, components: {} }
  for (const ref of resources.assets) {
    if (!Object.hasOwn(context.assets, ref.assetId)) throw new Error(`复制素材不在资源闭包中：${ref.assetId}`)
    selected.assets[ref.assetId] = context.assets[ref.assetId]
  }
  for (const ref of resources.components) {
    if (!Object.hasOwn(context.components, ref.packageId) || context.components[ref.packageId].meta.version !== ref.version) throw new Error(`复制组件不在资源闭包中：${ref.packageId}@${ref.version}`)
    selected.components[ref.packageId] = context.components[ref.packageId]
  }
  return selected
}

export function readDocumentClipboardContext(input: unknown) {
  const context = validated(input)
  const resolveAsset = async (ref: AssetRef): Promise<{ meta: AssetMeta; bytes: Uint8Array }> => {
    const asset = Object.hasOwn(context.assets, ref.assetId) ? context.assets[ref.assetId] : undefined
    if (!asset) throw new Error(`复制素材缺少真实字节：${ref.assetId}`)
    return { meta: structuredClone(asset.meta), bytes: Uint8Array.from(asset.bytes) }
  }
  const prepareComponent = async (ref: ComponentRef, _target?: EmbeddedComponentPackageMeta): Promise<{ meta: EmbeddedComponentPackageMeta; data: ComponentPackageData }> => {
    const entry = Object.hasOwn(context.components, ref.packageId) ? context.components[ref.packageId] : undefined
    if (!entry || entry.meta.version !== ref.version) throw new Error(`复制组件缺少真实包：${ref.packageId}@${ref.version}`)
    const data = parseComponentPackageFiles(Object.fromEntries(Object.entries(entry.data.files).map(([filename, bytes]) => [filename, Uint8Array.from(bytes)])), { expectedId: ref.packageId, expectedVersion: ref.version,
      provenance: entry.meta.sha256 ? { sha256: entry.meta.sha256, importedAt: entry.meta.importedAt!, sourceLabel: entry.meta.sourceLabel! } : undefined })
    return { meta: structuredClone(entry.meta), data }
  }
  return { resolveAsset, prepareComponent, resolveComponent: prepareComponent }
}
