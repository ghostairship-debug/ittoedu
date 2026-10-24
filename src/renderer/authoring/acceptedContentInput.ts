import { CourseV10Driver } from '../../core/drivers/CourseV10Driver'
import { resolveComponentPresentation } from '../../shared/contracts/component-platform/project'
import { equalComponentValue } from '../../shared/componentValue'
import { isCourseComponentInputFailure, settleCourseComponentInput, type CapturedComponentOperation, type CapturedCourseTarget, type CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'

/** Runtime-only facts retained by the existing input owner while its original ACK is unknown. */
export interface RetainedContentInput<Value = unknown> {
  error: unknown
  target: CapturedCourseTarget
  command: CapturedComponentOperation
  value: Value
}

/** Advance only through the confirmed original proposal, preserving real external conflicts. */
export function acceptedContentInputTarget(input: Pick<RetainedContentInput, 'target' | 'command'>, revision?: number): CapturedCourseTarget {
  const { target, command } = input
  if (command.documentId !== target.documentId || command.epoch !== target.epoch) throw new Error('原输入的文档身份已改变')
  const { documentId: _documentId, epoch: _epoch, ...operation } = command
  const model = new CourseV10Driver().applyValidated({ kind: 'course-v10', project: target.project, resources: target.resources }, operation)
  if (model.kind !== 'course-v10') throw new Error('原输入的文档类型已改变')
  const project = revision === undefined ? model.project : { ...model.project, revision }
  return { ...target, project, resources: model.resources,
    editingProject: resolveComponentPresentation(project, target.surfaceId, target.activeStateId) }
}

/** An ACK for A never certifies a later value B, even when both belong to the same field. */
export async function settleRetainedContentInput<Value>(input: RetainedContentInput<Value>, currentValue: Value, bridge?: CourseV10DocumentBridge) {
  const outcome = await settleCourseComponentInput(input.error)
  let revision: number | undefined
  if (outcome === 'applied' && bridge && isCourseComponentInputFailure(input.error)) {
    const original = await bridge.queryUnconfirmedInput({ documentId: input.target.documentId, epoch: input.target.epoch, operationId: input.error.operationId })
    if (original.status === 'settled' && 'revision' in original.result) revision = original.result.revision
  }
  return outcome === 'applied'
    ? { outcome, sameValue: equalComponentValue(input.value, currentValue), target: acceptedContentInputTarget(input, revision) } as const
    : { outcome } as const
}
