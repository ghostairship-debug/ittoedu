import { allDocumentTextSlots, documentComponentDataVersions, documentTextRanges, inlineComponentIds } from '../../shared/document/textInteraction'
import type { BehaviorAttachment, ComponentContainer, ComponentEdit, ComponentInstance, CourseProjectV10 } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey, owningContainer } from '../../shared/contracts/component-platform/project'
import { equalComponentValue } from '../../shared/componentValue'

export interface TextRelationshipSlot { instanceId: string; dataPath: string[] }
/** The structural editor supplies actual old-to-new slots; range identity supplies the surviving portions. */
export interface TextRelationshipSlotMigration { from: TextRelationshipSlot; to: readonly TextRelationshipSlot[] }
export interface TextRelationshipPlanOptions {
  slotMigrations?: readonly TextRelationshipSlotMigration[]
  explicitlyRemoved?: ReadonlySet<string>
  attachmentSources?: ReadonlyMap<string, readonly BehaviorAttachment[]>
  affectedInstanceIds?: ReadonlySet<string>
  deferTextRelationshipCleanup?: boolean
  insertedInstances?: ReadonlyMap<string, { instance: ComponentInstance; owner?: ComponentContainer }>
}
const samePath = (left: readonly string[], right: readonly string[]) => equalComponentValue(left, right)
function flowOwner(project: CourseProjectV10, id: string): string | undefined {
  let owner = owningContainer(project, id)
  while (owner?.kind === 'instance') {
    const instance = project.instances[owner.instanceId]
    if (instance?.container) return instance.container.kind === 'flow' ? instance.id : undefined
    owner = owningContainer(project, owner.instanceId)
  }
  return owner?.kind === 'surface' && project.instances[owner.surfaceId]?.container?.kind === 'flow' ? owner.surfaceId : undefined
}

/** Pure final-batch planning: no intermediate body can delete another body's binding. */
export function componentTextRelationshipEdits(before: CourseProjectV10, final: CourseProjectV10,
  options: TextRelationshipPlanOptions = {}): ComponentEdit[] {
  const slots = new Map<string, ReturnType<typeof allDocumentTextSlots>>()
  const dataSlots = (id: string) => {
    if (!slots.has(id)) slots.set(id, documentComponentDataVersions(final, id).flatMap(data => allDocumentTextSlots(data)))
    return slots.get(id)!
  }
  for (const id of options.affectedInstanceIds ?? Object.keys(final.instances)) if (final.instances[id]) dataSlots(id)
  const moves: ComponentEdit[] = [], changes: ComponentEdit[] = [], removed = new Set<string>()
  const moving = new Set<string>(), destinationSizes = new Map<string, number>()
  const move = (id: string, ownerId: string) => {
    const instance = final.instances[id] ?? before.instances[id] ?? options.insertedInstances?.get(id)?.instance
    const owner = owningContainer(final, id) ?? owningContainer(before, id) ?? options.insertedInstances?.get(id)?.owner
    if (!instance || moving.has(id) || owner?.kind === 'instance' && owner.instanceId === ownerId) return
    const size = destinationSizes.get(ownerId) ?? final.instances[ownerId]?.childIds?.length ?? 0
    moves.push({ type: 'instance.move', instanceId: id, container: { kind: 'instance', instanceId: ownerId },
      index: size, ...(instance.frame ? { frame: instance.frame } : {}) })
    destinationSizes.set(ownerId, size + 1); moving.add(id)
  }
  const candidates = new Map([...Object.values(before.instances), ...[...options.insertedInstances?.values() ?? []].map(value => value.instance),
    ...Object.values(final.instances)].map(instance => [instance.id, instance]))
  for (const instance of candidates.values()) {
    if (options.explicitlyRemoved?.has(instance.id)) continue
    const source = options.attachmentSources?.get(instance.id) ?? before.instances[instance.id]?.attachments ?? instance.attachments
    if (!source?.some(attachment => attachment.target.kind === 'text-range')) continue
    if (options.affectedInstanceIds && !options.affectedInstanceIds.has(instance.id) && !source.some(attachment =>
      attachment.target.kind === 'text-range' && options.affectedInstanceIds!.has(attachment.target.instanceId))) continue
    const attachments = source.flatMap((attachment): BehaviorAttachment[] => {
      const target = attachment.target
      if (target.kind !== 'text-range') return final.instances[instance.id]?.attachments?.filter(value => equalComponentValue(value, attachment)) ?? []
      const migrated = options.slotMigrations?.filter(migration => migration.from.instanceId === target.instanceId
        && samePath(migration.from.dataPath, target.dataPath)).flatMap(migration => migration.to)
      const targets = migrated?.length ? migrated : [{ instanceId: target.instanceId, dataPath: target.dataPath }]
      return targets.flatMap(candidate => dataSlots(candidate.instanceId)
        .filter(slot => documentTextRanges(slot.content).has(target.rangeId))
        .map(slot => ({ ...attachment, target: { ...target, instanceId: candidate.instanceId, dataPath: slot.path } })))
    })
    const unique = [...new Map([...(options.deferTextRelationshipCleanup ? source : []), ...attachments]
      .map(attachment => [JSON.stringify(attachment), attachment])).values()]
    const popover = componentDefinitionBuiltinKey(final.definitions[instance.definitionId] ?? before.definitions[instance.definitionId]) === 'guoling.popover'
    if (!unique.length && popover) {
      if (final.instances[instance.id]) removed.add(instance.id)
      continue
    }
    if (!final.instances[instance.id] && !unique.length) continue
    const owners = new Set(unique.flatMap(attachment => attachment.target.kind === 'text-range'
      ? [flowOwner(final, attachment.target.instanceId)].filter((id): id is string => Boolean(id)) : []))
    if (popover && owners.size === 1) move(instance.id, [...owners][0])
    if (!final.instances[instance.id] && !moving.has(instance.id)) continue
    if (!equalComponentValue(unique, final.instances[instance.id]?.attachments)) changes.push({ type: 'attachments.set', instanceId: instance.id, attachments: unique })
  }
  const oldInline = new Set(Object.keys(before.instances).filter(id => !options.affectedInstanceIds || options.affectedInstanceIds.has(id)).flatMap(id => documentComponentDataVersions(before, id)
    .flatMap(data => allDocumentTextSlots(data).flatMap(slot => inlineComponentIds(slot.content)))))
  const referenced = new Set([...oldInline, ...[...slots.values()].flatMap(dataSlots => dataSlots.flatMap(slot => inlineComponentIds(slot.content)))])
  for (const child of referenced) for (const project of [before, final]) {
    const owner = owningContainer(project, child)
    if (owner?.kind === 'instance' && final.instances[owner.instanceId]) dataSlots(owner.instanceId)
  }
  const inlineOwners = new Map<string, Set<string>>()
  for (const [id, dataSlots] of slots) for (const slot of dataSlots) for (const child of inlineComponentIds(slot.content)) {
    const owners = inlineOwners.get(child) ?? new Set<string>(); owners.add(id); inlineOwners.set(child, owners)
  }
  for (const [child, owners] of inlineOwners) {
    if (options.affectedInstanceIds && !oldInline.has(child) && ![...owners].some(id => options.affectedInstanceIds!.has(id))) continue
    if (owners.size > 1) throw new Error('行内组件同时出现在多个正文对象中，原对象与输入已保留')
    if (final.instances[child] || before.instances[child] || options.insertedInstances?.has(child)) move(child, [...owners][0])
  }
  for (const child of oldInline) if (!options.deferTextRelationshipCleanup && !inlineOwners.has(child) && final.instances[child]) {
    const owner = owningContainer(before, child)
    if (owner?.kind === 'instance' && documentComponentDataVersions(before, owner.instanceId)
      .some(data => allDocumentTextSlots(data).some(slot => inlineComponentIds(slot.content).includes(child)))) removed.add(child)
  }
  return [...moves, ...changes, ...[...removed].map((instanceId): ComponentEdit => ({ type: 'instance.remove', instanceId }))]
}
