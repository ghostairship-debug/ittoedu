import type { DocumentAcceptedChange, DocumentHistoryEntry, DocumentModel, DurableDocumentState } from '../../shared/workbench/document'
import { createWorkProjectMigrationMap, normalizeWorkProject, type WorkProjectMigrationMap } from '../../shared/contracts/component-platform/workProjectMigration'
import { hasLegacyFlowBackgrounds } from '../../shared/contracts/component-platform/legacyFlowBackground'
import { applyDocumentAcceptedChange, applyDocumentHistoryEntry, createDocumentAcceptedChange, documentRecoveryModels } from '../documents/documentStateEffects'
import { describeComponentChanges } from './courseV10Operations'

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
export function normalizeCourseDocumentRecovery(input: DurableDocumentState): DurableDocumentState {
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
