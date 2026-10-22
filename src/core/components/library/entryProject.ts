import { normalizeLegacyFlowBackgrounds } from '../../../shared/contracts/component-platform/legacyFlowBackground'
import type { ComponentLibraryEntry, ComponentLibraryInput } from '../../../shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { migrateCourseProjectV10 } from '../../../shared/contracts/component-platform/workProjectMigration'

/** One-time library V1 read adaptation. New entries own containers through the same instance tree as a project. */
export function normalizeComponentLibraryEntry(input: ComponentLibraryInput): ComponentLibraryEntry {
  input = normalizeLegacyFlowBackgrounds(input)
  if (input.schemaVersion === 2) return input
  const original = structuredClone(input)
  const global = original.global ?? { underlay: [], overlay: [] }
  const globalIds = new Set([...global.underlay, ...global.overlay])
  const claimed = new Set((original.surfaces ?? []).flatMap(surface => surface.childIds))
  const extras = original.example.rootIds.filter(id => !claimed.has(id) && !globalIds.has(id))
  // A V1 object entry has no page. Its roots stay ordinary roots without a manufactured container.
  if (!original.surfaces?.length) {
    const { surfaces: _surfaces, ...entry } = original
    return { ...entry, schemaVersion: 2, example: { ...entry.example, rootIds: extras } }
  }
  const surfaceIds = new Set(original.surfaces.map(surface => surface.id))
  const isExternalTarget = (attachment: NonNullable<typeof original.example.instances[string]['attachments']>[number]) =>
    (attachment.target.kind === 'instance' || attachment.target.kind === 'text-range') && !original.example.instances[attachment.target.instanceId]
      || attachment.target.kind === 'surface' && !surfaceIds.has(attachment.target.surfaceId)
  // Library targets may intentionally be external. Only the owned structure goes through the Project migration;
  // external targets retain their descriptors until the insertion's explicit host/target bindings apply.
  const ownedInstances = Object.fromEntries(Object.entries(original.example.instances).map(([id, instance]) => [id, { ...instance,
    ...(instance.attachments ? { attachments: instance.attachments.filter(attachment => !isExternalTarget(attachment)) } : {}) }]))
  const project = migrateCourseProjectV10({ schemaVersion: 10, id: original.id, revision: 0, title: original.title,
    definitions: original.definitions, instances: ownedInstances, assets: original.assets,
    surfaces: original.surfaces.map((surface, index) => ({ ...surface, childIds: index === 0 ? [...surface.childIds, ...extras] : surface.childIds })),
    global, ...(original.logic ? { logic: original.logic } : {}),
    ...(original.theme ? { theme: original.theme } : {}), ...(original.designTokens ? { designTokens: original.designTokens } : {}) })
  for (const [id, instance] of Object.entries(original.example.instances)) if (instance.attachments?.some(isExternalTarget)) {
    let ownedIndex = 0
    const migrated = project.instances[id].attachments ?? []
    project.instances[id].attachments = instance.attachments.map(attachment => isExternalTarget(attachment)
      ? structuredClone(attachment) : migrated[ownedIndex++])
  }
  const { surfaces: _surfaces, ...entry } = original
  return { ...entry, schemaVersion: 2, definitions: project.definitions,
    example: { instances: project.instances, rootIds: project.rootIds }, global: project.global,
    ...(project.logic ? { logic: project.logic } : {}) }
}

/** Detached author view for closure analysis; it is never another writer or persisted tree. */
export function componentLibraryProject(entry: ComponentLibraryEntry): CourseProjectV10 {
  return { schemaVersion: 11, id: entry.id, revision: 0, title: entry.title,
    definitions: entry.definitions, instances: entry.example.instances, rootIds: entry.example.rootIds,
    ...(entry.example.rootIds[0] ? { entry: { rootInstanceId: entry.example.rootIds[0] } } : {}),
    assets: entry.assets, global: entry.global ?? { underlay: [], overlay: [] },
    ...(entry.logic ? { logic: entry.logic } : {}), ...(entry.theme ? { theme: entry.theme } : {}),
    ...(entry.designTokens ? { designTokens: entry.designTokens } : {}) }
}
