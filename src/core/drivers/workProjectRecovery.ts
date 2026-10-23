import type { DocumentAcceptedChange, DocumentHistoryEntry, DocumentModel, DurableDocumentState } from '../../shared/workbench/document'
import { createWorkProjectMigrationMap, normalizeWorkProject, type WorkProjectMigrationMap } from '../../shared/contracts/component-platform/workProjectMigration'
import { hasLegacyFlowBackgrounds } from '../../shared/contracts/component-platform/legacyFlowBackground'
import { applyDocumentAcceptedChange, applyDocumentHistoryEntry, createDocumentAcceptedChange, documentRecoveryModels } from '../documents/documentStateEffects'
import { describeComponentChanges } from './courseV10Operations'
import { isSourceDocumentModel } from '../../shared/workbench/document'
import { documentEqual } from '../documents/documentEqual'

// Undo/Redo stamp the restored project with a new Session revision. Content and
// resources must still join; the old effect's revision is not that identity.
function sameHistoryModel(left: DocumentModel, right: DocumentModel): boolean {
  if (left.kind === right.kind && (left.kind === 'course-v10' || left.kind === 'course-v9')
    && (right.kind === 'course-v10' || right.kind === 'course-v9')) {
    return documentEqual(left, { ...right, project: { ...right.project, revision: left.project.revision } })
  }
  return documentEqual(left, right)
}

/** Keep executable history adjacent to current. Receipts remain authoritative even
 * when their optional reconstruction payload cannot be used. The caller preserves
 * the original record before publishing this bounded recovery. */
function isolateRecoveryHistory(input: DurableDocumentState, validate: (model: DocumentModel) => void): DurableDocumentState {
  const checked = new Map<DocumentModel, DocumentModel>()
  const check = (model: DocumentModel) => {
    const known = checked.get(model)
    if (known) return known
    const normalized = normalizeCourseDocumentModel(model, input.courseProjectMigrationIds)
    validate(normalized)
    checked.set(model, normalized)
    return normalized
  }
  check(input.model)
  const diagnostics = [...(input.recoveryDiagnostics ?? [])]
  const diagnostic = (message: string, error: unknown) => diagnostics.push(`${message}：${error instanceof Error ? error.message : String(error)}`)
  const effectAt = (effect: DocumentAcceptedChange, current: DocumentModel, direction: 'forward' | 'inverse') => {
    if (effect.kind === 'replace') { check(effect.before); check(effect.after) }
    const next = applyDocumentAcceptedChange(current, effect, direction)
    check(next)
    const restored = applyDocumentAcceptedChange(next, effect, direction === 'forward' ? 'inverse' : 'forward')
    check(restored)
    if (!sameHistoryModel(check(current), check(restored))) throw new Error('历史变化与相邻内容不连续')
    return next
  }
  const stack = (entries: DocumentHistoryEntry[], direction: 'forward' | 'inverse') => {
    let current = input.model
    for (let index = entries.length - 1; index >= 0; index--) {
      try {
        const entry = entries[index]!
        if (entry.before) check(entry.before)
        if (entry.after) check(entry.after)
        if (entry.effects) {
          if (!entry.effects.length) throw new Error('历史记录缺少已接受变化')
          for (const effect of direction === 'forward' ? entry.effects : [...entry.effects].reverse()) current = effectAt(effect, current, direction)
        } else {
          const adjacent = direction === 'forward' ? entry.before : entry.after
          if (!adjacent || !sameHistoryModel(check(current), check(adjacent))) throw new Error('历史快照与相邻内容不连续')
          current = applyDocumentHistoryEntry(current, entry, direction); check(current)
        }
      } catch (error) {
        diagnostic(`${direction === 'inverse' ? '撤销' : '重做'}历史在“${entries[index]?.operationId ?? index}”处不可执行，已保留相邻的 ${entries.length - index - 1} 项`, error)
        return entries.slice(index + 1)
      }
    }
    return entries
  }
  const past = stack(input.past, 'inverse'), future = stack(input.future, 'forward')
  let current = input.model, unavailable = false, changed = false
  const operations = [...input.operations].reverse().map(receipt => {
    if (receipt.historyUnavailable) { unavailable = true; return receipt }
    const hasPayload = receipt.effect || receipt.before || receipt.after || receipt.sourceChange && receipt.sourceChange.kind !== 'unchanged'
    if (!hasPayload) return receipt
    try {
      if (unavailable) throw new Error('较新的操作历史存在断点')
      if (receipt.before) check(receipt.before)
      if (receipt.after) check(receipt.after)
      if (receipt.effect) current = effectAt(receipt.effect, current, 'inverse')
      else if (receipt.sourceChange?.kind === 'edits') current = effectAt({ ...receipt.sourceChange, kind: 'source' }, current, 'inverse')
      else if (receipt.before && receipt.after) {
        if (!sameHistoryModel(check(current), check(receipt.after))) throw new Error('操作快照与相邻内容不连续')
        current = receipt.before
      }
      else if (receipt.sourceChange?.kind === 'changed' && isSourceDocumentModel(current)) {
        if (current.source !== receipt.sourceChange.after) throw new Error('操作源文与相邻内容不连续')
        check({ ...current, source: receipt.sourceChange.after })
        current = { ...current, source: receipt.sourceChange.before }; check(current)
      }
      return receipt
    } catch (error) {
      if (!unavailable) diagnostic(`操作“${receipt.operationId}”的历史无法还原；操作回执与停止屏障仍保留`, error)
      unavailable = true; changed = true
      const { before: _before, after: _after, sourceChange: _sourceChange, effect: _effect, textChanges: _textChanges, ...metadata } = receipt
      return { ...metadata, historyUnavailable: true }
    }
  }).reverse()
  let savedModel = input.savedModel
  if (savedModel) try { check(savedModel) } catch (error) {
    diagnostic('已保存基线的内容不可读取；未改变已确认保存版本', error)
    savedModel = undefined
  }
  if (past === input.past && future === input.future && !changed && savedModel === input.savedModel) return input
  const { savedModel: _savedModel, ...state } = input
  return { ...state, ...(savedModel ? { savedModel } : {}), past, future, operations, recoveryDiagnostics: diagnostics }
}

/** Read-boundary conversion only; resources and Session identities stay with their original owners. */
export function normalizeCourseDocumentModel(model: DocumentModel, identities?: WorkProjectMigrationMap): DocumentModel {
  if (model.kind !== 'course-v10' || model.project.schemaVersion === 11 && !hasLegacyFlowBackgrounds(model.project)) return model
  return { ...model, project: normalizeWorkProject(model.project, identities) }
}

const needsModel = (model: DocumentModel | undefined) => model?.kind === 'course-v10'
  && (model.project.schemaVersion !== 11 || hasLegacyFlowBackgrounds(model.project))
function needsEffect(effect: DocumentAcceptedChange): boolean {
  if (effect.kind === 'replace') return Boolean(needsModel(effect.before) || needsModel(effect.after))
  if (effect.kind !== 'course-v10') return false
  return [...effect.forward.changes, ...effect.inverse.changes].some(fact => {
    // Absent facts delete a value; only the present inverse/forward value can
    // carry a legacy background that needs read-boundary conversion.
    if (!fact.exists) return false
    const path = fact.path, value = fact.value
    if (path[0] !== 'instances') return false
    if (path.length === 1) return hasLegacyFlowBackgrounds({ instances: value })
    if (path.length === 2) return hasLegacyFlowBackgrounds({ instances: { x: value } })
    if (path[2] !== 'container') return false
    if (path.length === 3) return hasLegacyFlowBackgrounds({ instances: { x: { container: value } } })
    if (path[3] !== 'flow') return false
    if (path.length === 4) return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && value.layout && typeof value.layout === 'object' && Object.hasOwn(value.layout, 'paperBackgroundColor'))
    return path[4] === 'layout' && (path[5] === 'paperBackgroundColor'
      || path.length === 5 && Boolean(value && typeof value === 'object' && Object.hasOwn(value, 'paperBackgroundColor')))
  })
}

/** Migrate each accepted historical state once, so Undo/Redo never restores a second background fact. */
export function normalizeCourseDocumentRecovery(input: DurableDocumentState, validate: (model: DocumentModel) => void = () => {}): DurableDocumentState {
  input = isolateRecoveryHistory(input, validate)
  const entries = [...input.past, ...input.future]
  const models = [input.model, input.savedModel, ...entries.flatMap(entry => [entry.before, entry.after]),
    ...input.operations.flatMap(operation => [operation.before, operation.after])]
  if (!models.some(needsModel) && !entries.some(entry => entry.effects?.some(needsEffect))
    && !input.operations.some(operation => operation.effect && needsEffect(operation.effect))) return input
  const projects = [...documentRecoveryModels(input)].flatMap(model => model.kind === 'course-v10' ? [model.project] : [])
  const identities = projects.some(project => project.schemaVersion !== 11)
    ? createWorkProjectMigrationMap(projects, input.courseProjectMigrationIds) : input.courseProjectMigrationIds
  const normalized = new Map<DocumentModel, DocumentModel>()
  const model = (value: DocumentModel): DocumentModel => {
    let result = normalized.get(value)
    if (!result) { result = normalizeCourseDocumentModel(value, identities); normalized.set(value, result) }
    return result
  }
  const effectAt = (effect: DocumentAcceptedChange, current: DocumentModel, direction: 'forward' | 'inverse') => {
    const next = applyDocumentAcceptedChange(current, effect, direction)
    if (effect.kind === 'replace') return { next, effect: { ...effect, before: model(effect.before), after: model(effect.after) } }
    if (effect.kind === 'source') return { next, effect }
    const before = model(direction === 'forward' ? current : next), after = model(direction === 'forward' ? next : current)
    return { next, effect: createDocumentAcceptedChange(before, after,
      before.kind === 'course-v10' && after.kind === 'course-v10' ? describeComponentChanges(before.project, after.project) : undefined) }
  }
  const snapshots = <T extends { before?: DocumentModel; after?: DocumentModel }>(entry: T): T => ({ ...entry,
    ...(entry.before ? { before: model(entry.before) } : {}), ...(entry.after ? { after: model(entry.after) } : {}) })
  const stack = (entries: DocumentHistoryEntry[], direction: 'forward' | 'inverse') => {
    let current = input.model
    return [...entries].reverse().map(entry => {
      if (!entry.effects) { current = applyDocumentHistoryEntry(current, entry, direction); return snapshots(entry) }
      const effects = [...entry.effects], indexes = effects.map((_effect, index) => index)
      if (direction === 'inverse') indexes.reverse()
      for (const index of indexes) { const result = effectAt(effects[index], current, direction); effects[index] = result.effect; current = result.next }
      return { ...snapshots(entry), effects }
    }).reverse()
  }
  let current = input.model
  const operations = [...input.operations].reverse().map(operation => {
    if (operation.effect) {
      const result = effectAt(operation.effect, current, 'inverse'); current = result.next
      return { ...snapshots(operation), effect: result.effect }
    }
    if (operation.before && operation.after) current = operation.before
    return snapshots(operation)
  }).reverse()
  return { ...input, ...(identities ? { courseProjectMigrationIds: identities } : {}), model: model(input.model),
    ...(input.savedModel ? { savedModel: model(input.savedModel) } : {}), past: stack(input.past, 'inverse'), future: stack(input.future, 'forward'), operations }
}
