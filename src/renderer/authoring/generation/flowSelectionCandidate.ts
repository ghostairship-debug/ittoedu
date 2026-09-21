import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { GenerationCandidate, GenerationRequest } from '../../../shared/generationContract'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import { flowContextTextRangeSchema, flowSelectionContextTarget } from '../../course/flowContextSelection'
import { AuthoringToolFailure } from '../tools/executeAuthoringTool'

/** A frozen text range is a mutation boundary, unlike ordinary page/object focus.
 * Validate before any semantic expansion or private tool plan. One edit may combine
 * replacement and formatting; later edits require newly observed offsets.
 */
export function assertFlowSelectionCandidate(request: GenerationRequest, candidate: GenerationCandidate, document: CourseProjectDocument): void {
  const context = request.context && typeof request.context === 'object' && !Array.isArray(request.context) ? request.context : {}
  if (context.reference !== 'selection' || !context.flowSelection) return
  const selection = context.flowSelection as unknown as FlowEditorSelection
  const surface = document.surfaces.find(value => value.id === selection.surfaceId)
  if (surface?.type !== 'flow') throw new Error('冻结正文页面已失效，请重新选择。')
  const target = flowSelectionContextTarget(surface.blocks, document.revision, selection)
  if (target?.kind !== 'text') return
  if (candidate.steps.length === 0) return
  const fail = (): never => { throw new AuthoringToolFailure([{ code: 'flow-selection-range', path: ['steps'],
    message: '当前冻结的是精确正文选区；只允许一次 flow.content edit，目标块与 textRange 的 slot/start/end 必须保持一致，且只提交 content/textStyle。不能使用整块或工程工具扩大范围；后续修改须重新观察选区。' }]) }
  if (candidate.steps.length !== 1) fail()
  const step = candidate.steps[0]!
  if (step.tool !== 'flow.content' || step.destination.kind !== 'update'
    || step.destination.target.surfaceId !== surface.id || step.destination.target.itemId !== target.blockId) fail()
  const input = step.input as Record<string, unknown> | null
  if (!input || input.operation !== 'edit' || Object.keys(input).some(key => !['operation', 'textRange', 'content', 'textStyle'].includes(key))) fail()
  const parsed = flowContextTextRangeSchema.safeParse(input!.textRange)
  if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(flowContextTextRangeSchema.parse(target.textRange))) fail()
}
