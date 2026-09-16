import { documentContentSchema, documentTextSlots, walkDocument, type DocumentContent } from '../../shared/document/content'
import { documentResourcesSchema, validateDocumentResources, type DocumentResources } from '../../shared/document/resources'

type ComponentIdentity = { packageId: string; version: string }
export interface PreparedClipboardResources<T> {
  /** Only resources referenced by the prepared fragment, never the whole target registry. */
  resources: DocumentResources
  assetIds: Record<string, string>
  components: { from: ComponentIdentity; to: ComponentIdentity }[]
  prepared: T
}
export interface DocumentClipboardResourcePort<T> {
  /** Stage bytes/packages only. The canonical owner commits this handle with the body. */
  prepareResources(input: { resources: DocumentResources; targetResources: DocumentResources }): Promise<PreparedClipboardResources<T>>
  discard(prepared: T): Promise<void>
}
export interface PreparedDocumentClipboard<T> {
  document: { content: DocumentContent; resources: DocumentResources }
  prepared: T
}

/** No live document or registry mutation occurs here. Caller must discard on stale target
 * or rejected commit, and pass the handle to its single canonical resource/body commit. */
export async function prepareDocumentClipboard<T>(
  source: { content: DocumentContent; resources: DocumentResources },
  targetResources: DocumentResources,
  port: DocumentClipboardResourcePort<T>,
  createId: () => string = () => crypto.randomUUID(),
): Promise<PreparedDocumentClipboard<T>> {
  const content = documentContentSchema.parse(source.content)
  const resources = documentResourcesSchema.parse(source.resources)
  validateDocumentResources(content.blocks, resources)
  const target = documentResourcesSchema.parse(targetResources)
  const staged = await port.prepareResources({ resources, targetResources: target })
  try {
    const ids = new Map<string, string>()
    const oldIds = new Set<string>()
    walkDocument(content.blocks, block => {
      oldIds.add(block.id)
      if (block.type === 'formula') oldIds.add(block.formulaId)
      if (block.type === 'list') block.items.forEach(item => oldIds.add(item.id))
      if (block.type === 'table') { block.rows.forEach(row => oldIds.add(row.id)); block.columns.forEach(column => oldIds.add(column.id)) }
      for (const slot of documentTextSlots(block)) for (const atom of slot.content.inlines) if (atom.type === 'math') oldIds.add(atom.formulaId)
    })
    const generated = new Set<string>()
    for (const id of oldIds) {
      const next = createId()
      if (oldIds.has(next) || generated.has(next)) throw new Error('复制身份生成器返回重复身份')
      generated.add(next); ids.set(id, next)
    }
    const rewriteAsset = (id: string) => {
      if (!Object.hasOwn(staged.assetIds, id)) throw new Error(`尚未准备素材：${id}`)
      return staged.assetIds[id]
    }
    walkDocument(content.blocks, block => {
      block.id = ids.get(block.id)!
      if (block.type === 'formula') block.formulaId = ids.get(block.formulaId)!
      for (const slot of documentTextSlots(block)) for (const atom of slot.content.inlines) {
        if (atom.type === 'math') atom.formulaId = ids.get(atom.formulaId)!
        if (atom.link?.href.startsWith('#') && ids.has(atom.link.href.slice(1))) atom.link = { ...atom.link, href: `#${ids.get(atom.link.href.slice(1))}` }
      }
      if (block.type === 'list') block.items.forEach(item => { item.id = ids.get(item.id)! })
      if (block.type === 'table') {
        block.columns.forEach(column => { column.id = ids.get(column.id)! })
        block.rows.forEach(row => { row.id = ids.get(row.id)!; row.cells = Object.fromEntries(Object.entries(row.cells).map(([key, value]) => [ids.get(key)!, value])) })
        block.merges?.forEach(merge => { merge.rowIds = merge.rowIds.map(id => ids.get(id)!); merge.columnIds = merge.columnIds.map(id => ids.get(id)!) })
      }
      if (block.type === 'media') block.assetId = rewriteAsset(block.assetId)
      if (block.type === 'component') {
        block.staticFallbackAssetId = rewriteAsset(block.staticFallbackAssetId)
        const mappings = staged.components.filter(item => item.from.packageId === block.component.packageId && item.from.version === block.component.version)
        if (mappings.length !== 1) throw new Error(`尚未唯一准备组件：${block.component.packageId}@${block.component.version}`)
        block.component = { ...mappings[0].to }
      }
    })
    const preparedResources = documentResourcesSchema.parse(staged.resources)
    documentContentSchema.parse(content)
    validateDocumentResources(content.blocks, preparedResources)
    return { document: { content, resources: preparedResources }, prepared: staged.prepared }
  } catch (error) {
    await port.discard(staged.prepared)
    throw error
  }
}
