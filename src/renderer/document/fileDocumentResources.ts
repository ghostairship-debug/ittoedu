import type { AssetMeta } from '../../shared/contracts/media-v1'
import { documentResourcesSchema, type DocumentResources } from '../../shared/document/resources'
import type { DocumentClipboardResourcePort } from './documentClipboard'
type AssetReference = DocumentResources['assets'][number]
type ComponentReference = DocumentResources['components'][number]
type ResolvedDocumentAsset = { meta: AssetMeta; bytes: Uint8Array }
const extension = (filename: string) => /\.([a-z0-9]{1,12})$/i.exec(filename)?.[1]?.toLowerCase() ?? 'bin'

export interface FilePreparedDocumentResources { attachments: { relativePath: string; bytes: Uint8Array }[] }
export function createFileDocumentResourcePort(input: {
  resolveAsset(ref: AssetReference): Promise<ResolvedDocumentAsset>
  resolveComponent(ref: ComponentReference): Promise<Uint8Array>
  createId?: () => string
}): DocumentClipboardResourcePort<FilePreparedDocumentResources> {
  return {
    async prepareResources({ resources }) {
      documentResourcesSchema.parse(resources)
      const prepared: FilePreparedDocumentResources = { attachments: [] }
      const mapped: DocumentResources = { assets: [], components: [] }
      const assetIds: Record<string, string> = {}
      const components: { from: { packageId: string; version: string }; to: { packageId: string; version: string } }[] = []
      const paths = new Set<string>()
      const attach = (suffix: string, bytes: Uint8Array) => {
        const relativePath = `resources/${(input.createId ?? (() => crypto.randomUUID()))()}.${suffix}`
        if (!bytes.byteLength || paths.has(relativePath)) throw new Error('附件为空或身份冲突')
        paths.add(relativePath)
        prepared.attachments.push({ relativePath, bytes: bytes.slice() })
        return relativePath
      }
      for (const ref of resources.assets) {
        const asset = await input.resolveAsset(ref)
        const path = attach(extension(asset.meta.filename), asset.bytes)
        const assetId = (input.createId ?? (() => crypto.randomUUID()))()
        if (mapped.assets.some(asset => asset.assetId === assetId)) throw new Error('素材身份生成冲突')
        assetIds[ref.assetId] = assetId
        mapped.assets.push({ assetId, source: { kind: 'relative', path } })
      }
      for (const ref of resources.components) {
        const path = attach('h5component', await input.resolveComponent(ref))
        const identity = { packageId: ref.packageId, version: ref.version }
        components.push({ from: identity, to: identity })
        mapped.components.push({ ...identity, source: { kind: 'relative', path } })
      }
      return { resources: mapped, assetIds, components, prepared }
    },
    async discard(prepared) { prepared.attachments.length = 0 },
  }
}
