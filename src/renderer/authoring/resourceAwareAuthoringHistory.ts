import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  createEditorTransactionStep,
  type EditorTransactionStep,
} from './editorTransaction'
import {
  cloneHistoryResourceChanges,
  type HistoryResourceChanges,
  type HistoryResourceDirection,
} from '../store/courseResourceState'

export const RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT = 100

export interface AuthoringHistoryTransactionFrame {
  readonly kind: 'editor-transaction'
  readonly document: CourseProjectDocument
  readonly resourceChanges: HistoryResourceChanges
}

export type ResourceAwareAuthoringHistoryEntry =
  | CourseProjectDocument
  | AuthoringHistoryTransactionFrame

export interface ResourceAwareAuthoringHistory {
  readonly present: CourseProjectDocument
  readonly past: readonly ResourceAwareAuthoringHistoryEntry[]
  readonly future: readonly ResourceAwareAuthoringHistoryEntry[]
}

export interface AuthoringHistoryResourceTransition {
  readonly resourceChanges: HistoryResourceChanges
  readonly resourceDirection: HistoryResourceDirection
}

export function isAuthoringHistoryTransactionFrame(
  entry: ResourceAwareAuthoringHistoryEntry,
): entry is AuthoringHistoryTransactionFrame {
  return 'kind' in entry && entry.kind === 'editor-transaction'
}

export function authoringLegacyHistoryEntryCount(
  entries: readonly ResourceAwareAuthoringHistoryEntry[],
): number {
  return entries.reduce(
    (count, entry) => count + (isAuthoringHistoryTransactionFrame(entry) ? 0 : 1),
    0,
  )
}

function historyEntryDocument(
  entry: ResourceAwareAuthoringHistoryEntry,
): CourseProjectDocument {
  return isAuthoringHistoryTransactionFrame(entry) ? entry.document : entry
}

function transactionFrame(
  document: CourseProjectDocument,
  resourceChanges: HistoryResourceChanges,
): AuthoringHistoryTransactionFrame {
  return Object.freeze({
    kind: 'editor-transaction' as const,
    document,
    resourceChanges: cloneHistoryResourceChanges(resourceChanges),
  })
}

export function createResourceAwareAuthoringHistory(
  project: CourseProjectDocument,
): ResourceAwareAuthoringHistory {
  return Object.freeze({
    present: project,
    past: Object.freeze([] as ResourceAwareAuthoringHistoryEntry[]),
    future: Object.freeze([] as ResourceAwareAuthoringHistoryEntry[]),
  })
}

export function commitResourceAwareAuthoringHistory(
  history: ResourceAwareAuthoringHistory,
  next: CourseProjectDocument,
  limit = RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT,
  resourceChanges?: HistoryResourceChanges,
): ResourceAwareAuthoringHistory {
  const previous = resourceChanges === undefined
    ? history.present
    : transactionFrame(history.present, resourceChanges)
  return Object.freeze({
    present: next,
    past: Object.freeze([...history.past, previous].slice(-limit)),
    future: Object.freeze([] as ResourceAwareAuthoringHistoryEntry[]),
  })
}

export function commitEditorTransactionToAuthoringHistory(
  history: ResourceAwareAuthoringHistory,
  step: EditorTransactionStep,
  limit = RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT,
): ResourceAwareAuthoringHistory {
  if (
    history.present.id !== step.projectId ||
    history.present.revision !== step.baseRevision
  ) {
    throw new TypeError('编辑事务与当前文档不一致')
  }
  return commitResourceAwareAuthoringHistory(
    history,
    step.nextDocument,
    limit,
    step.resourceChanges,
  )
}

/**
 * One document+resource commit. Empty resource deltas still produce a
 * transaction frame so sidecar stacks are not used as a second history.
 */
export function commitAuthoringDocumentTransaction(
  history: ResourceAwareAuthoringHistory,
  next: CourseProjectDocument,
  resourceChanges: HistoryResourceChanges = {},
  limit = RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT,
): {
  readonly history: ResourceAwareAuthoringHistory
  readonly resourceTransition: AuthoringHistoryResourceTransition
} | null {
  const step = createEditorTransactionStep(history.present, {
    projectId: history.present.id,
    baseRevision: history.present.revision,
    nextDocument: next,
    resourceChanges,
  })
  if (!step) return null
  return {
    history: commitEditorTransactionToAuthoringHistory(history, step, limit),
    resourceTransition: Object.freeze({
      resourceChanges: step.resourceChanges,
      resourceDirection: 'forward' as const,
    }),
  }
}

export function authoringHistoryUndoResourceTransition(
  history: ResourceAwareAuthoringHistory,
): AuthoringHistoryResourceTransition | undefined {
  const previous = history.past.at(-1)
  if (!previous || !isAuthoringHistoryTransactionFrame(previous)) return undefined
  return Object.freeze({
    resourceChanges: previous.resourceChanges,
    resourceDirection: 'inverse' as const,
  })
}

export function authoringHistoryRedoResourceTransition(
  history: ResourceAwareAuthoringHistory,
): AuthoringHistoryResourceTransition | undefined {
  const next = history.future[0]
  if (!next || !isAuthoringHistoryTransactionFrame(next)) return undefined
  return Object.freeze({
    resourceChanges: next.resourceChanges,
    resourceDirection: 'forward' as const,
  })
}

export function undoResourceAwareAuthoringHistory(
  history: ResourceAwareAuthoringHistory,
): ResourceAwareAuthoringHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  const transaction = isAuthoringHistoryTransactionFrame(previous)
  return Object.freeze({
    present: historyEntryDocument(previous),
    past: Object.freeze(history.past.slice(0, -1)),
    future: Object.freeze([
      transaction
        ? transactionFrame(history.present, previous.resourceChanges)
        : history.present,
      ...history.future,
    ]),
  })
}

export function redoResourceAwareAuthoringHistory(
  history: ResourceAwareAuthoringHistory,
): ResourceAwareAuthoringHistory {
  const next = history.future[0]
  if (!next) return history
  const transaction = isAuthoringHistoryTransactionFrame(next)
  return Object.freeze({
    present: historyEntryDocument(next),
    past: Object.freeze([
      ...history.past,
      transaction
        ? transactionFrame(history.present, next.resourceChanges)
        : history.present,
    ]),
    future: Object.freeze(history.future.slice(1)),
  })
}
