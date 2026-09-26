import type { CourseProjectDocument, FlowBlock, FlowSurfaceLayerEntry } from '../../shared/courseProjectTypes'
import { flowParagraphAnchorAt, flowParagraphAnchoredFrame, type FlowParagraphBlockRect } from '../../shared/flowParagraphAnchors'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { flowSurfaceIn, walkFlowBlocks } from './flowDocumentModel'

export function reconcileFlowParagraphAnchors(
  beforeBlocks: readonly FlowBlock[],
  afterBlocks: readonly FlowBlock[],
  entries: readonly FlowSurfaceLayerEntry[],
): FlowSurfaceLayerEntry[] {
  const before: string[] = []
  const after = new Set<string>()
  walkFlowBlocks(beforeBlocks, block => { before.push(block.id) })
  walkFlowBlocks(afterBlocks, block => { after.add(block.id) })
  const first = afterBlocks[0]?.id
  return entries.map(entry => {
    const anchor = entry.paragraphAnchor
    if (!anchor || after.has(anchor.blockId)) return entry
    const index = before.indexOf(anchor.blockId)
    const preceding = index < 0 ? undefined : before.slice(0, index).reverse().find(id => after.has(id))
    const target = preceding ?? first
    if (!target) throw new Error('Flow 正文不能为空，无法改挂段落对象')
    return { ...entry, paragraphAnchor: { ...anchor, blockId: target } }
  })
}

export function setFlowParagraphPlacement(
  document: CourseProjectDocument,
  input: { surfaceId: string; layerItemId: string; mode: 'paragraph' | 'paper'; paperWidth: number; blocks: readonly FlowParagraphBlockRect[]; expectedRevision?: number; now?: string },
): CourseProjectDocument {
  if (input.expectedRevision !== undefined && input.expectedRevision !== document.revision) throw new Error('stale-revision')
  const surface = flowSurfaceIn(document, input.surfaceId)
  const entry = surface.surfaceLayerItems.find(candidate => candidate.item.layerItemId === input.layerItemId)
  if (!entry) throw new Error('找不到 Flow 纸面对象')
  if (entry.item.paperSpace !== 'paper') throw new Error('只有纸面对象可以随段落移动')
  const currentFrame = entry.paragraphAnchor
    ? flowParagraphAnchoredFrame(entry.paragraphAnchor, entry.item.frame, input.paperWidth, input.blocks)
    : entry.item.frame
  if (!currentFrame) throw new Error('正文尚未完成布局')
  const nextAnchor = input.mode === 'paragraph' ? flowParagraphAnchorAt(currentFrame, input.paperWidth, input.blocks) : null
  if (input.mode === 'paragraph' && (!nextAnchor || !input.blocks.some(block => block.blockId === nextAnchor.blockId && Boolean(findBlock(surface.blocks, block.blockId))))) throw new Error('找不到可挂靠的正式段落')
  if ((input.mode === 'paper' && !entry.paragraphAnchor) || (nextAnchor && entry.paragraphAnchor && equalAnchor(nextAnchor, entry.paragraphAnchor))) return document
  return commitCourseProjectMutation(document, draft => {
    const target = flowSurfaceIn(draft, input.surfaceId).surfaceLayerItems.find(candidate => candidate.item.layerItemId === input.layerItemId)!
    target.item.frame = { ...target.item.frame, ...currentFrame }
    if (nextAnchor) target.paragraphAnchor = nextAnchor
    else delete target.paragraphAnchor
  }, input.now)
}

function equalAnchor(a: { blockId: string; offsetY: number; xRatio: number }, b: typeof a): boolean {
  return a.blockId === b.blockId && a.offsetY === b.offsetY && a.xRatio === b.xRatio
}

function findBlock(blocks: readonly FlowBlock[], id: string): FlowBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block
    if (block.type === 'section') {
      const found = findBlock(block.blocks, id)
      if (found) return found
    }
  }
  return undefined
}
