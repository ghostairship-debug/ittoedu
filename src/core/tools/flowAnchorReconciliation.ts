import type { FlowBlock, FlowSurfaceLayerEntry } from '../../shared/courseProjectTypes'
import { walkFlowBlocks } from './flowDocumentModel'

/** Keep existing anchors valid in the same transaction that changes Flow blocks. */
export function reconcileFlowParagraphAnchors(
  beforeBlocks: readonly FlowBlock[],
  afterBlocks: readonly FlowBlock[],
  entries: readonly FlowSurfaceLayerEntry[],
): FlowSurfaceLayerEntry[] {
  const before: string[] = [], after: string[] = []
  walkFlowBlocks(beforeBlocks, block => { before.push(block.id) })
  walkFlowBlocks(afterBlocks, block => { after.push(block.id) })
  const surviving = new Set(after)
  return entries.map(entry => {
    const anchor = entry.paragraphAnchor
    if (!anchor || surviving.has(anchor.blockId)) return entry
    const index = before.indexOf(anchor.blockId)
    if (index < 0) throw new Error(`挂靠段落不属于原正文：${anchor.blockId}`)
    const preceding = before.slice(0, index).reverse().find(id => surviving.has(id))
    const target = preceding ?? after[0]
    if (!target) throw new Error('Flow 正文不能为空，无法改挂段落对象')
    return { ...entry, paragraphAnchor: { ...anchor, blockId: target } }
  })
}
