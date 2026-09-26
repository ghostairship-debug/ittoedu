import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { FlowTextContent } from '../../shared/document/content'
import { planInsertFlowBlock, type FlowBlockInput, type FlowContentResult } from './flowContent'
import { findFlowBlockRecursive, flowSurfaceIn, stableFlowId } from './flowDocumentModel'

export type FlowMenuDocumentKind = 'heading' | 'list' | 'table' | 'formula' | 'divider' | 'callout' | 'section'

export interface FlowMenuDocumentTarget {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly selectedBlockId: string | null
}

const emptyContent = (): FlowTextContent => ({ inlines: [] })
const textContent = (text: string): FlowTextContent => ({ inlines: [{ type: 'text', text }] })

function menuBlock(kind: FlowMenuDocumentKind): FlowBlockInput | null {
  switch (kind) {
    case 'heading': return { type: 'heading', level: 2, content: textContent('新标题') }
    case 'list': return { type: 'list', ordered: false, items: [{ id: stableFlowId('list-item'), content: emptyContent() }] }
    case 'table': {
      const columnId = stableFlowId('column'), rowId = stableFlowId('row')
      return { type: 'table', columns: [{ id: columnId, header: textContent('列 1') }], rows: [{ id: rowId, cells: { [columnId]: emptyContent() } }] }
    }
    case 'formula': return { type: 'formula', formulaId: stableFlowId('formula'), latex: 'x', accessibleText: 'x' }
    case 'divider': return { type: 'divider' }
    case 'callout': return { type: 'callout', tone: 'note', body: textContent('输入提示内容') }
    case 'section': return { type: 'section', title: textContent('新分节'), collapsedByDefault: false, blocks: [] }
    default: return null
  }
}

/** Returns one canonical document candidate; the caller commits it through the existing writer. */
export function planFlowMenuDocumentInsertion(
  document: CourseProjectDocument,
  target: FlowMenuDocumentTarget,
  kind: FlowMenuDocumentKind,
): FlowContentResult {
  const fail = (reason: string): FlowContentResult => ({ ok: false, reason, historyEntry: false })
  if (document.id !== target.projectId || document.revision !== target.revision) return fail('stale-revision')
  const location = document.locations.find(candidate => candidate.id === target.locationId)
  if (!location || location.kind !== 'flow-block' || location.surfaceId !== target.surfaceId) return fail('当前 Flow 页面已改变')
  let surface: ReturnType<typeof flowSurfaceIn>
  try { surface = flowSurfaceIn(document, target.surfaceId) } catch { return fail('找不到 Flow 页面') }
  const selected = target.selectedBlockId === null ? null : findFlowBlockRecursive(surface.blocks, target.selectedBlockId)
  if (target.selectedBlockId !== null && !selected) return fail('所选正文块已改变')
  const block = menuBlock(kind)
  if (!block) return fail('不支持的正文插入类型')
  return planInsertFlowBlock(document, {
    surfaceId: surface.id,
    parentId: selected?.parentId ?? null,
    index: selected ? selected.index + 1 : surface.blocks.length,
    block,
  }, { expectedRevision: target.revision })
}
