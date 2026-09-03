import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  applyHistoryResourceChanges,
  cloneHistoryResourceChanges,
  historyResourceChangesAreEmpty,
  type HistoryResourceChanges,
  type HistoryResourceDirection,
  type HistoryResourceState,
} from '../store/courseResourceState'

export interface EditorTransactionPlan<
  TSelectionHint = unknown,
  TFeedback = unknown,
> {
  readonly projectId: string
  readonly baseRevision: number
  readonly nextDocument: CourseProjectDocument
  readonly resourceChanges: HistoryResourceChanges
  readonly selectionHint?: TSelectionHint
  readonly feedback?: TFeedback
}

/**
 * One completed user commit. This is a value object, not a Store, Session,
 * command bus, or second history timeline.
 */
export interface EditorTransactionStep<
  TSelectionHint = unknown,
  TFeedback = unknown,
> {
  readonly projectId: string
  readonly baseRevision: number
  readonly previousDocument: CourseProjectDocument
  readonly nextDocument: CourseProjectDocument
  readonly resourceChanges: HistoryResourceChanges
  readonly selectionHint?: TSelectionHint
  readonly feedback?: TFeedback
}

export interface EditorTransactionState {
  readonly document: CourseProjectDocument
  readonly resources: HistoryResourceState
}

function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    ArrayBuffer.isView(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function documentsEqual(
  left: CourseProjectDocument,
  right: CourseProjectDocument,
): boolean {
  if (left === right) return true
  if (left.id !== right.id || left.revision !== right.revision) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

function validatePlan(
  baseDocument: CourseProjectDocument,
  plan: EditorTransactionPlan,
): void {
  if (!plan.projectId.trim()) throw new TypeError('projectId 不能为空')
  if (!Number.isInteger(plan.baseRevision) || plan.baseRevision < 0) {
    throw new TypeError('baseRevision 必须是非负整数')
  }
  if (
    baseDocument.id !== plan.projectId ||
    plan.nextDocument.id !== plan.projectId
  ) {
    throw new TypeError('事务计划不属于同一个 Course Project')
  }
  if (baseDocument.revision !== plan.baseRevision) {
    throw new TypeError('事务计划的 baseRevision 与基础文档不一致')
  }
}

export function createEditorTransactionStep<
  TSelectionHint = unknown,
  TFeedback = unknown,
>(
  baseDocument: CourseProjectDocument,
  plan: EditorTransactionPlan<TSelectionHint, TFeedback>,
): EditorTransactionStep<TSelectionHint, TFeedback> | null {
  validatePlan(baseDocument, plan)
  const resourceChanges = cloneHistoryResourceChanges(plan.resourceChanges)
  if (
    documentsEqual(baseDocument, plan.nextDocument) &&
    historyResourceChangesAreEmpty(resourceChanges)
  ) {
    return null
  }
  if (plan.nextDocument.revision !== plan.baseRevision + 1) {
    throw new TypeError('非空事务必须将文档 revision 精确增加 1')
  }
  return Object.freeze({
    projectId: plan.projectId,
    baseRevision: plan.baseRevision,
    previousDocument: immutableClone(baseDocument),
    nextDocument: immutableClone(plan.nextDocument),
    resourceChanges,
    ...(plan.selectionHint === undefined
      ? {}
      : { selectionHint: immutableClone(plan.selectionHint) }),
    ...(plan.feedback === undefined
      ? {}
      : { feedback: immutableClone(plan.feedback) }),
  })
}

export function applyEditorTransactionStep(
  state: EditorTransactionState,
  step: EditorTransactionStep,
  direction: HistoryResourceDirection,
): EditorTransactionState {
  if (state.document.id !== step.projectId) {
    throw new TypeError('事务步骤不属于当前 Course Project')
  }
  const expectedRevision = direction === 'forward'
    ? step.baseRevision
    : step.nextDocument.revision
  if (state.document.revision !== expectedRevision) {
    throw new TypeError('事务步骤与当前文档 revision 不一致')
  }
  return Object.freeze({
    document: immutableClone(
      direction === 'forward' ? step.nextDocument : step.previousDocument,
    ),
    resources: applyHistoryResourceChanges(
      state.resources,
      step.resourceChanges,
      direction,
    ),
  })
}
