import { MIN_NODE_SIZE } from '../../../shared/constants'
import type { LayerFrame } from '../../../shared/courseProjectTypes'
import type { FlowMenuParagraphAnchor } from '../../../core/tools/flowMenuPaperInsertion'
import { flowParagraphAnchorAt } from '../../../shared/flowParagraphAnchors'
import type { FlowMenuPageCapture } from '../FlowWorkspace'

type CapturedPage = Extract<FlowMenuPageCapture, { ok: true }>

/** Place a new paper item next to the selected document block, using only observed layout. */
export function flowMenuPaperPlacement(
  capture: CapturedPage,
  preferred: { width: number; height: number },
): { frame: LayerFrame; paragraphAnchor: FlowMenuParagraphAnchor } {
  const paperWidth = capture.paperWidth
  if (!Number.isFinite(paperWidth) || paperWidth < MIN_NODE_SIZE + 72) throw new Error('纸面尚未完成布局，请稍后重试')
  if (![preferred.width, preferred.height].every(Number.isFinite) || preferred.width < MIN_NODE_SIZE || preferred.height < MIN_NODE_SIZE) {
    throw new Error('插入对象的尺寸无效')
  }
  const width = Math.min(preferred.width, paperWidth - 72)
  const height = preferred.height
  const selected = capture.selectedBlockId
  const rect = selected ? capture.paragraphRects.find(entry => entry.blockId === selected) : undefined
  if (selected && !rect) throw new Error('所选段落尚未完成布局，请稍后重试')
  if (!selected && capture.paragraphRects.length > 0) throw new Error('请选择当前页中的正文位置')
  const x = Math.max(36, Math.min(paperWidth - width - 36, rect?.x ?? 36))
  const y = rect ? rect.y + rect.height + 16 : 52
  const frame: LayerFrame = { mode: 'absolute', x, y, width, height }
  const anchor = rect ? flowParagraphAnchorAt(frame, paperWidth, capture.paragraphRects) : null
  if (rect && !anchor) throw new Error('找不到可挂靠的正式段落')
  const paragraphAnchor: FlowMenuParagraphAnchor = anchor ?? { kind: 'empty-body', offsetY: 24, xRatio: x / paperWidth }
  return { frame, paragraphAnchor }
}
