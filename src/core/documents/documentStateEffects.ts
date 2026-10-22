import type { ComponentAppliedChanges } from '../../shared/contracts/component-platform/operations'
import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { DocumentAcceptedChange, DocumentDriver, DocumentHistoryAction, DocumentHistoryEntry, DocumentModel, DocumentModelUpdate, DocumentResources,
  DocumentStateTransition, DurableDocumentState } from '../../shared/workbench/document'
import { isSourceDocumentModel } from '../../shared/workbench/document'
import { documentSourceReplacement, sourceEditsFromChanges, type SourceEdit, type SourceRangeChange } from '../../shared/document/sourceMerge'
import { documentEqual } from './documentEqual'

function valueAt(value: unknown, path: readonly string[]): { exists: boolean; value?: unknown } {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return { exists: false }
    current = (current as Record<string, unknown>)[key]
  }
  return { exists: true, value: current }
}

/** Copy only accepted property ancestors. These are state facts, not commands and not UI input. */
function acceptedProject(project: CourseProjectV10, changes: ComponentAppliedChanges, revision: number): CourseProjectV10 {
  let result = project
  const replace = (node: unknown, path: readonly string[], exists: boolean, value: unknown): unknown => {
    if (!path.length) return value
    if (!node || typeof node !== 'object') throw new Error('已接受工程变化无法定位其父级')
    const copy = Array.isArray(node) ? [...node] : { ...node }
    const key = path[0]!
    if (path.length > 1) {
      const child = replace((node as Record<string, unknown>)[key], path.slice(1), exists, value)
      Object.defineProperty(copy, key, { value: child, enumerable: true, configurable: true, writable: true })
    } else if (!exists) delete (copy as Record<string, unknown>)[key]
    else Object.defineProperty(copy, key, { value, enumerable: true, configurable: true, writable: true })
    return copy
  }
  for (const change of changes.changes) {
    if (!Array.isArray(change.path) || !change.path.length || change.path.some(key => typeof key !== 'string')) throw new Error('已接受工程变化地址无效')
    result = replace(result, change.path, change.exists, change.value) as CourseProjectV10
  }
  return { ...result, revision }
}

export function createDocumentAcceptedChange(before: DocumentModel, after: DocumentModel,
  appliedChanges?: ComponentAppliedChanges, sourceCommand?: SourceEdit | readonly SourceEdit[], sourceChanges?: readonly SourceRangeChange[]): DocumentAcceptedChange {
  if (before.kind === after.kind && isSourceDocumentModel(before) && isSourceDocumentModel(after)) {
    const commandEdits = sourceCommand && ('from' in sourceCommand ? [sourceCommand] : sourceCommand)
    const exact = (sourceChanges && sourceEditsFromChanges(before.source, after.source, sourceChanges)) ?? commandEdits
    const replacement = exact === undefined ? documentSourceReplacement(before.source, after.source) : undefined
    return { kind: 'source', documentKind: before.kind,
      edits: (exact ?? (replacement ? [replacement] : [])).map(edit => ({ from: edit.from, removed: before.source.slice(edit.from, edit.to), text: edit.text })),
      beforeResources: before.resources, afterResources: after.resources }
  }
  if (before.kind === 'course-v10' && after.kind === 'course-v10' && before.project.id === after.project.id && appliedChanges) {
    const inverse: ComponentAppliedChanges = { affectedTargets: appliedChanges.affectedTargets,
      changes: appliedChanges.changes.map(change => {
        const previous = valueAt(before.project, change.path)
        return { path: change.path, exists: previous.exists, ...(previous.exists ? { value: previous.value as never } : {}) }
      }) }
    return { kind: 'course-v10', beforeRevision: before.project.revision, revision: after.project.revision,
      forward: appliedChanges, inverse, beforeResources: before.resources, afterResources: after.resources }
  }
  // V9 and genuine model replacements remain lossless snapshots; ordinary V11 edits use facts above.
  return { kind: 'replace', before, after }
}

/** Canonical execution coordinates come from accepted effects, never advisory input. */
export function documentAcceptedSourceRanges(effect: DocumentAcceptedChange, direction: 'forward' | 'inverse'): SourceRangeChange[] | undefined {
  if (effect.kind !== 'source') return
  let offset = 0
  const located = effect.edits.map(edit => {
    const from = edit.from + offset
    offset += edit.text.length - edit.removed.length
    return { edit, from }
  })
  if (direction === 'inverse') located.reverse()
  return located.map(({ edit, from }) => ({ from,
    to: from + (direction === 'forward' ? edit.removed.length : edit.text.length),
    inserted: direction === 'forward' ? edit.text.length : edit.removed.length }))
}

/** Preserve the actual source replacements while Undo/Redo traverse an entire
 * History group. Their coordinates are the model at each execution step. */
export function documentHistorySourceRanges(entry: DocumentHistoryEntry, direction: 'forward' | 'inverse'): SourceRangeChange[] | undefined {
  if (!entry.effects) return
  const effects = direction === 'forward' ? entry.effects : [...entry.effects].reverse()
  const result: SourceRangeChange[] = []
  for (const effect of effects) {
    const ranges = documentAcceptedSourceRanges(effect, direction)
    if (!ranges) return
    result.push(...ranges)
  }
  return result
}

export function applyDocumentAcceptedChange(model: DocumentModel, change: DocumentAcceptedChange, direction: 'forward' | 'inverse'): DocumentModel {
  if (change.kind === 'replace') return direction === 'forward' ? change.after : change.before
  const resources = direction === 'forward' ? change.afterResources : change.beforeResources
  if (change.kind === 'course-v10') {
    if (model.kind !== 'course-v10') throw new Error('已接受工程变化与文档类型不一致')
    return { kind: model.kind, project: acceptedProject(model.project, direction === 'forward' ? change.forward : change.inverse,
      direction === 'forward' ? change.revision : change.beforeRevision), resources }
  }
  if (!isSourceDocumentModel(model) || model.kind !== change.documentKind) throw new Error('已接受源文变化与文档类型不一致')
  let source = model.source
  let offset = 0
  const located = change.edits.map(edit => {
    const at = edit.from + offset
    offset += edit.text.length - edit.removed.length
    return { ...edit, at }
  })
  const edits = direction === 'forward' ? located : located.reverse()
  for (const edit of edits) {
    const removed = direction === 'forward' ? edit.removed : edit.text
    const text = direction === 'forward' ? edit.text : edit.removed
    if (!Number.isSafeInteger(edit.from) || edit.from < 0 || source.slice(edit.at, edit.at + removed.length) !== removed) throw new Error('已接受源文变化无法还原当前版本')
    source = source.slice(0, edit.at) + text + source.slice(edit.at + removed.length)
  }
  return { kind: model.kind, source, resources }
}

/** Transport the same accepted facts, omitting every unchanged resource byte. */
export function createDocumentModelUpdate(change: DocumentAcceptedChange): DocumentModelUpdate | undefined {
  if (change.kind === 'replace') return
  const diff = (before: Record<string, Uint8Array>, after: Record<string, Uint8Array>) => Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => before[id] !== after[id])
      .map(id => [id, Object.hasOwn(after, id) ? after[id] : null]))
  const components = Object.fromEntries([...new Set([...Object.keys(change.beforeResources.components), ...Object.keys(change.afterResources.components)])]
    .filter(id => change.beforeResources.components[id] !== change.afterResources.components[id])
    .map(id => [id, Object.hasOwn(change.afterResources.components, id)
      ? diff(change.beforeResources.components[id] ?? {}, change.afterResources.components[id]) : null]))
  const resources = { assets: diff(change.beforeResources.assets, change.afterResources.assets), components }
  return change.kind === 'source' ? { kind: 'source', documentKind: change.documentKind, edits: change.edits, resources }
    : { kind: 'course-v10', revision: change.revision, changes: change.forward, resources }
}

/** A renderer applies committed state facts to the exact base; no author command runs. */
export function applyDocumentModelUpdate(model: DocumentModel, update: DocumentModelUpdate): DocumentModel {
  const resources: DocumentResources = { assets: { ...model.resources.assets }, components: { ...model.resources.components } }
  for (const [id, bytes] of Object.entries(update.resources.assets)) {
    if (bytes === null) delete resources.assets[id]
    else Object.defineProperty(resources.assets, id, { value: bytes, enumerable: true, configurable: true, writable: true })
  }
  for (const [id, changes] of Object.entries(update.resources.components)) {
    if (changes === null) { delete resources.components[id]; continue }
    const files = { ...resources.components[id] }
    for (const [name, bytes] of Object.entries(changes)) {
      if (bytes === null) delete files[name]
      else Object.defineProperty(files, name, { value: bytes, enumerable: true, configurable: true, writable: true })
    }
    Object.defineProperty(resources.components, id, { value: files, enumerable: true, configurable: true, writable: true })
  }
  return update.kind === 'source'
    ? applyDocumentAcceptedChange(model, { ...update, beforeResources: model.resources, afterResources: resources }, 'forward')
    : applyDocumentAcceptedChange(model, { kind: 'course-v10', beforeRevision: model.kind === 'course-v10' ? model.project.revision : 0,
      revision: update.revision, forward: update.changes, inverse: { changes: [], affectedTargets: [] }, beforeResources: model.resources, afterResources: resources }, 'forward')
}

export function applyDocumentHistoryEntry(model: DocumentModel, entry: DocumentHistoryEntry, direction: 'forward' | 'inverse'): DocumentModel {
  if (!entry.effects) {
    const legacy = direction === 'forward' ? entry.after : entry.before
    if (!legacy) throw new Error('历史记录缺少已接受状态')
    return legacy
  }
  const effects = direction === 'forward' ? entry.effects : [...entry.effects].reverse()
  return effects.reduce((current, effect) => applyDocumentAcceptedChange(current, effect, direction), model)
}

export function compactDocumentHistory(entry: DocumentHistoryEntry, driver: DocumentDriver,
  current?: DocumentModel, direction: 'forward' | 'inverse' = 'inverse'): DocumentHistoryEntry {
  if (entry.effects) return entry
  if (!entry.before || !entry.after) throw new Error('历史记录缺少原始状态')
  const { before, after, ...metadata } = entry
  let effect = createDocumentAcceptedChange(before, after, driver.describeChanges?.(before, after))
  if (current) {
    // Legacy snapshots were exact replacements. Keep that meaning for an old discontinuous stack;
    // ordinary coherent history can use the small accepted effect without retaining whole models.
    try {
      if (!documentEqual(applyDocumentAcceptedChange(current, effect, direction), direction === 'forward' ? after : before)) effect = { kind: 'replace', before, after }
    } catch { effect = { kind: 'replace', before, after } }
  }
  return { ...metadata, effects: [effect] }
}

export function compactDocumentRecovery(state: DurableDocumentState, driver: DocumentDriver): DurableDocumentState {
  const stack = (entries: DocumentHistoryEntry[], direction: 'forward' | 'inverse') => {
    let current = state.model
    return [...entries].reverse().map(entry => {
      const compact = compactDocumentHistory(entry, driver, current, direction)
      current = applyDocumentHistoryEntry(current, compact, direction)
      return compact
    }).reverse()
  }
  let current = state.model
  const operations = [...state.operations].reverse().map(receipt => {
    const { before, after, sourceChange: source, ...metadata } = receipt
    if (metadata.effect) { current = applyDocumentAcceptedChange(current, metadata.effect, 'inverse'); return metadata }
    let effect: DocumentAcceptedChange | undefined
    if (source?.kind === 'edits') effect = { ...source, kind: 'source' }
    else if (before && after) {
      effect = createDocumentAcceptedChange(before, after, driver.describeChanges?.(before, after))
      try { if (!documentEqual(applyDocumentAcceptedChange(current, effect, 'inverse'), before)) effect = { kind: 'replace', before, after } }
      catch { effect = { kind: 'replace', before, after } }
    } else if (source?.kind === 'changed' && isSourceDocumentModel(current)) effect = createDocumentAcceptedChange(
      { ...current, source: source.before }, { ...current, source: source.after })
    if (effect) { current = applyDocumentAcceptedChange(current, effect, 'inverse'); return { ...metadata, effect } }
    return { ...metadata, ...(source ? { sourceChange: source } : {}) }
  }).reverse()
  return { ...state, past: stack(state.past, 'inverse'), future: stack(state.future, 'forward'), operations }
}

function sameEntries(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function historyAction(before: DurableDocumentState, after: DurableDocumentState): DocumentHistoryAction | undefined {
  if (sameEntries(before.past, after.past) && sameEntries(before.future, after.future)) return
  if (before.past.length && sameEntries(after.past, before.past.slice(0, -1))
    && sameEntries(after.future, [...before.future, before.past.at(-1)])) return { type: 'undo' }
  if (before.future.length && sameEntries(after.future, before.future.slice(0, -1))
    && sameEntries(after.past, [...before.past, before.future.at(-1)])) return { type: 'redo' }
  if (after.future.length === 0 && after.past.length === before.past.length + 1
    && sameEntries(after.past.slice(0, -1), before.past)) return { type: 'push', entry: after.past.at(-1)! }
  const prior = before.past.at(-1), next = after.past.at(-1)
  if (prior?.effects && next?.effects && after.past.length === before.past.length && after.future.length === 0
    && sameEntries(before.past.slice(0, -1), after.past.slice(0, -1))
    && sameEntries(prior.effects, next.effects.slice(0, prior.effects.length))) {
    const { effects, before: _before, after: _after, ...entry } = next
    return { type: 'amend', entry, effects: effects.slice(prior.effects.length) }
  }
  return { type: 'replace', past: after.past, future: after.future }
}

export function createDocumentStateTransition(before: DurableDocumentState, after: DurableDocumentState,
  modelChange?: DocumentAcceptedChange): DocumentStateTransition {
  if (before.documentId !== after.documentId || after.sequence !== before.sequence + 1) throw new Error('文档状态变化缺少连续身份')
  const history = historyAction(before, after)
  const operation = after.operations.length === before.operations.length + 1 ? after.operations.at(-1) : undefined
  if (after.operations.length !== before.operations.length && !operation) throw new Error('文档回执变化无法定位')
  return { documentId: after.documentId, baseSequence: before.sequence, sequence: after.sequence, epoch: after.epoch,
    revision: after.revision, savedRevision: after.savedRevision, disposition: after.disposition ?? 'active',
    ...(before.binding !== after.binding ? { binding: after.binding } : {}), ...(modelChange ? { modelChange } : {}),
    ...(before.savedModel !== after.savedModel ? { savedModel: after.savedModel ? { model: after.savedModel } : { clear: true } } : {}),
    ...(history ? { history } : {}), ...(operation ? { operation } : {}),
    ...(before.stoppedRuns.length !== after.stoppedRuns.length ? { stoppedRuns: after.stoppedRuns.slice(before.stoppedRuns.length) } : {}),
    ...(before.courseProjectMigrationIds !== after.courseProjectMigrationIds ? { courseProjectMigrationIds: after.courseProjectMigrationIds } : {}) }
}

export function applyDocumentStateTransition(before: DurableDocumentState, transition: DocumentStateTransition): DurableDocumentState {
  if (before.documentId !== transition.documentId || transition.baseSequence !== before.sequence
    || transition.sequence !== before.sequence + 1 || transition.epoch !== before.epoch) throw new Error('恢复变化的身份或顺序不连续')
  const next: DurableDocumentState = { ...before, schemaVersion: 3, sequence: transition.sequence, revision: transition.revision,
    savedRevision: transition.savedRevision, disposition: transition.disposition, epoch: transition.epoch,
    past: [...before.past], future: [...before.future], operations: [...before.operations], stoppedRuns: [...before.stoppedRuns] }
  if (transition.binding) next.binding = transition.binding
  if (transition.modelChange) next.model = applyDocumentAcceptedChange(next.model, transition.modelChange, 'forward')
  if (transition.savedModel) {
    if ('model' in transition.savedModel) next.savedModel = transition.savedModel.model
    else delete next.savedModel
  }
  if (transition.courseProjectMigrationIds) next.courseProjectMigrationIds = transition.courseProjectMigrationIds
  const history = transition.history
  if (history?.type === 'push') { next.past.push(history.entry); next.future = [] }
  else if (history?.type === 'amend') {
    const prior = next.past.at(-1)
    if (!prior?.effects) throw new Error('恢复历史追加缺少原分组')
    next.past[next.past.length - 1] = { ...history.entry, effects: [...prior.effects, ...history.effects] }
    next.future = []
  } else if (history?.type === 'undo') {
    const entry = next.past.pop()
    if (!entry) throw new Error('恢复撤销缺少历史记录')
    next.future.push(entry)
  } else if (history?.type === 'redo') {
    const entry = next.future.pop()
    if (!entry) throw new Error('恢复重做缺少历史记录')
    next.past.push(entry)
  } else if (history?.type === 'replace') { next.past = history.past; next.future = history.future }
  if (transition.operation) next.operations.push(transition.operation)
  if (transition.stoppedRuns) next.stoppedRuns.push(...transition.stoppedRuns)
  return next
}

/** Restore validates every reachable legacy snapshot and every retained effect endpoint once. */
export function documentRecoveryModels(state: DurableDocumentState): Set<DocumentModel> {
  const models = new Set<DocumentModel>([state.model, ...(state.savedModel ? [state.savedModel] : [])])
  let prior = state.model
  for (const entry of [...state.past].reverse()) {
    if (entry.before) models.add(entry.before)
    if (entry.after) models.add(entry.after)
    prior = applyDocumentHistoryEntry(prior, entry, 'inverse'); models.add(prior)
  }
  let future = state.model
  for (const entry of [...state.future].reverse()) {
    if (entry.before) models.add(entry.before)
    if (entry.after) models.add(entry.after)
    future = applyDocumentHistoryEntry(future, entry, 'forward'); models.add(future)
  }
  let current = state.model
  for (const operation of [...state.operations].reverse()) {
    if (operation.before) models.add(operation.before)
    if (operation.after) models.add(operation.after)
    if (operation.effect) { current = applyDocumentAcceptedChange(current, operation.effect, 'inverse'); models.add(current) }
  }
  return models
}
