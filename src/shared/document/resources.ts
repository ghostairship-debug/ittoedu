import { z } from 'zod'
import { documentBlockSchema, documentContentSchema, documentIdSchema, walkDocument, type DocumentBlock } from './content'

export const documentRelativePathSchema = z.string().min(1).refine(path =>
  !path.includes('\\') && !/^[\/]|[:\u0000-\u001f]/.test(path) && path.split('/').every(p => p !== '' && p !== '.' && p !== '..'), '需要课例内的相对路径')
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project') }).strict(),
  z.object({ kind: z.literal('relative'), path: documentRelativePathSchema }).strict(),
])
export const documentResourcesSchema = z.object({
  assets: z.array(z.object({ assetId: documentIdSchema, source: sourceSchema }).strict()),
  components: z.array(z.object({ packageId: documentIdSchema, version: z.string().min(1), source: sourceSchema }).strict()),
}).strict()
export type DocumentResources = z.infer<typeof documentResourcesSchema>
export type ResourceSource = z.infer<typeof sourceSchema>
export const emptyDocumentResources = (): DocumentResources => ({ assets: [], components: [] })

/** These are the static resource-bearing fields of the official Flow carriers.
 * Component prop interpretation belongs to the package owner, not this codec.
 */
export function documentResourceReferences(blocks: readonly DocumentBlock[]) {
  const assets = new Set<string>()
  const components = new Map<string, { packageId: string; version: string }>()
  walkDocument(blocks, block => {
    if (block.type === 'media') assets.add(block.assetId)
    if (block.type === 'component') {
      assets.add(block.staticFallbackAssetId)
      components.set(JSON.stringify([block.component.packageId, block.component.version]), block.component)
    }
  })
  return { assets: [...assets], components: [...components.values()] }
}
export function validateDocumentResources(blocks: readonly DocumentBlock[], resources: DocumentResources, target: 'flow' | 'file' = 'flow'): void {
  documentResourcesSchema.parse(resources)
  const refs = documentResourceReferences(blocks)
  const assetIds = resources.assets.map(a => a.assetId)
  const packageIds = resources.components.map(c => JSON.stringify([c.packageId, c.version]))
  if (new Set(assetIds).size !== assetIds.length || new Set(packageIds).size !== packageIds.length) throw new Error('重复的资源映射')
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(v => b.includes(v))
  if (!sameSet(assetIds, refs.assets)) throw new Error('资源映射缺少或多出素材')
  if (!sameSet(packageIds, refs.components.map(c => JSON.stringify([c.packageId, c.version])))) throw new Error('资源映射缺少或多出组件包版本')
  if (target === 'file' && [...resources.assets, ...resources.components].some(r => r.source.kind !== 'relative')) throw new Error('真实 Markdown 保存需要课例内相对资源，不能保留 project 引用')
}
export const documentObjectSchema = z.object({ kind: z.literal('flow-block'), block: documentBlockSchema, resources: documentResourcesSchema }).strict().superRefine((value, ctx) => {
  try { documentContentSchema.parse({ blocks: [value.block] }); validateDocumentResources([value.block], value.resources) } catch (e) { ctx.addIssue({ code: 'custom', path: ['resources'], message: (e as Error).message }) }
})

export function resourcesForBlock(block: DocumentBlock, resources: DocumentResources): DocumentResources {
  const refs = documentResourceReferences([block])
  return {
    assets: resources.assets.filter(a => refs.assets.includes(a.assetId)),
    components: resources.components.filter(c => refs.components.some(r => r.packageId === c.packageId && r.version === c.version)),
  }
}
