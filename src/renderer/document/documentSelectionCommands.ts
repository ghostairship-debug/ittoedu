import type { DocumentContextSelection } from '../../shared/document/ports'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import { prepareExecutionContentOutput, textSelectionTarget } from '../../core/tools/ToolTargets'
import { textTargetContent } from '../../core/drivers/course/elementFields'
import { workbenchSelection, type SelectionCapture } from '../workbench/SelectionContextController'

/** The file/Flow owner translates only its source or component slot semantics. */
export type DocumentSelectionAdapter = (snapshot: DocumentSnapshot, target: DocumentContextSelection) => SelectionCapture

/** Drain the existing input owner, then capture exactly the held selection in that document. */
export async function prepareDocumentSelection(documentId: string, target: DocumentContextSelection, capture: DocumentSelectionAdapter) {
  const snapshot = await workbenchSelection.prepare(documentId)
  let selection = capture(snapshot, target)
  if (snapshot.model.kind === 'markdown' && target.mode === 'layout')
    selection = { ...selection, targets: [textSelectionTarget(snapshot.model, selection.targets) as typeof selection.targets[number]] }
  return { snapshot, selection }
}

export async function requestDocumentSelection(documentId: string, target: DocumentContextSelection, instruction: string, capture: DocumentSelectionAdapter) {
  const { selection } = await prepareDocumentSelection(documentId, target, capture)
  await workbenchSelection.request(selection, instruction, true)
}

/** The text card reads from its captured target; later response/preview uses the same target. */
export async function prepareDocumentTextEdit(documentId: string, target: DocumentContextSelection, capture: DocumentSelectionAdapter, label?: string) {
  const { snapshot, selection } = await prepareDocumentSelection(documentId, target, capture)
  const range = selection.targets.length === 1 ? selection.targets[0] : textSelectionTarget(snapshot.model, selection.targets)
  if (!range || range.kind !== 'text-selection' && (!('from' in range) || !('to' in range) || range.from === undefined || range.to === undefined || range.from >= range.to)) {
    throw new Error('请选择连续的一段文字再用 AI 修改。')
  }
  const captured = { ...selection, targets: [range as typeof selection.targets[number]] }
  return { target: range as typeof selection.targets[number], label: label ?? selection.label,
    content: textTargetContent(snapshot.model, range as typeof selection.targets[number]), capture: captured, contentOutput: prepareExecutionContentOutput(snapshot, range) }
}
