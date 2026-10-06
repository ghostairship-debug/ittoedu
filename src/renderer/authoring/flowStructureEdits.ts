import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, containerChildIds, owningContainer, type ComponentContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'

export function flowStructureDisabledReason(project: CourseProjectV10, instanceId: string): string | null {
  return componentIsLocked(project, instanceId) ? '对象已锁定，请先解锁' : null
}

const containerKey = (container: ComponentContainer) => container.kind === 'surface' ? `surface:${container.surfaceId}`
  : container.kind === 'instance' ? `instance:${container.instanceId}` : `global:${container.plane}`
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/** The PM planner may move a surviving root just to make room for a new neighboring paragraph. */
function passiveMoves(project: CourseProjectV10, edits: readonly ComponentEdit[]): Set<string> {
  const children = new Map<string, string[]>([
    ...project.surfaces.map(surface => [`surface:${surface.id}`, [...surface.childIds]] as [string, string[]]),
    ...Object.values(project.instances).map(instance => [`instance:${instance.id}`, [...(instance.childIds ?? [])]] as [string, string[]]),
    ['global:underlay', [...project.global.underlay]], ['global:overlay', [...project.global.overlay]],
  ])
  const remove = (id: string) => { for (const siblings of children.values()) { const index = siblings.indexOf(id); if (index >= 0) siblings.splice(index, 1) } }
  for (const edit of edits) {
    if (edit.type === 'instance.insert') {
      for (const instance of edit.instances) children.set(`instance:${instance.id}`, [...(instance.childIds ?? [])])
      edit.rootIds.forEach(remove)
      const key = containerKey(edit.container), siblings = children.get(key) ?? []
      siblings.splice(edit.index, 0, ...edit.rootIds); children.set(key, siblings)
    } else if (edit.type === 'instance.move') {
      remove(edit.instanceId)
      const key = containerKey(edit.container), siblings = children.get(key) ?? []
      siblings.splice(edit.index, 0, edit.instanceId); children.set(key, siblings)
    } else if (edit.type === 'instance.remove') remove(edit.instanceId)
  }
  const permitted = new Set<string>()
  for (const edit of edits) {
    if (edit.type !== 'instance.move') continue
    const instance = project.instances[edit.instanceId], owner = owningContainer(project, edit.instanceId)
    if (!instance || !owner || containerKey(owner) !== containerKey(edit.container) || edit.frame && !same(edit.frame, instance.frame)) continue
    const before = containerChildIds(project, owner), after = children.get(containerKey(owner)) ?? []
    const readingRoot = owner.kind === 'surface' && project.surfaces.find(surface => surface.id === owner.surfaceId)?.kind === 'flow'
      && !instance.flowPlacement && project.definitions[instance.definitionId]?.role !== 'behavior'
    const orderPeer = (id: string) => !readingRoot || !project.instances[id]?.flowPlacement
      && project.definitions[project.instances[id]?.definitionId]?.role !== 'behavior'
    if (!after.includes(edit.instanceId)) continue
    // Existing peers must remain on the same side; introduced/removed peers may change the numeric slot.
    if (before.every(id => id === edit.instanceId || !orderPeer(id) || !after.includes(id)
      || (before.indexOf(id) < before.indexOf(edit.instanceId)) === (after.indexOf(id) < after.indexOf(edit.instanceId)))) permitted.add(edit.instanceId)
  }
  return permitted
}

/** Flow locks protect structure/free geometry, while content, selection and unlock keep their existing owners. */
export function assertFlowStructureEditsAllowed(project: CourseProjectV10, edits: readonly ComponentEdit[], documentProjection = false): void {
  const passive = documentProjection && edits.some(edit => edit.type === 'instance.move' && componentIsLocked(project, edit.instanceId))
    ? passiveMoves(project, edits) : new Set<string>()
  for (const edit of edits) {
    if (edit.type === 'instance.move' && edit.container.kind === 'instance' && !passive.has(edit.instanceId)
      && flowStructureDisabledReason(project, edit.container.instanceId)) throw new Error('对象已锁定，请先解锁')
    const id = edit.type === 'instance.insert' && edit.container.kind === 'instance' ? edit.container.instanceId
      : 'instanceId' in edit ? edit.instanceId : null
    if (!id || !flowStructureDisabledReason(project, id)) continue
    const instance = project.instances[id]
    const blockTypeChanged = edit.type === 'data.set' && componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.document-block'
      && (edit.path.length === 0 && edit.value !== null && typeof edit.value === 'object' && !Array.isArray(edit.value)
        && edit.value.type !== (instance.data as Record<string, unknown>).type
        || edit.path.length === 1 && edit.path[0] === 'type' && edit.value !== (instance.data as Record<string, unknown>).type)
    const changed = edit.type === 'instance.remove' || edit.type === 'instance.insert'
      || edit.type === 'instance.move' && !passive.has(id)
      || edit.type === 'frame.set' && !same(edit.frame, instance?.frame ?? null)
      || edit.type === 'instance.definition.set' && edit.definitionId !== instance?.definitionId
      || edit.type === 'instance.flowPlacement.set' && !same(edit.flowPlacement, instance?.flowPlacement ?? null)
      || edit.type === 'instance.flowLayout.set' && !same(
        [edit.flowLayout?.width ?? 'content-width', edit.flowLayout?.wrap ?? 'none'], [instance?.flowLayout?.width ?? 'content-width', instance?.flowLayout?.wrap ?? 'none'])
      || blockTypeChanged
    if (changed) throw new Error('对象已锁定，请先解锁')
  }
}
