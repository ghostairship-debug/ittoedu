import { composeMatrices, frameCorners, invertMatrix, reparentFrame, transformVector, translationMatrix } from '../../../../core/components/geometry'
import type { ComponentEdit } from '../../../../shared/contracts/component-platform/operations'
import { containerChildIds, type ComponentInstance, type CourseProjectV10 } from '../../../../shared/contracts/component-platform/project'
import { freeSelectionBounds, freeTargetBounds, ownerOfSelection, pointsBounds, type FreeObjectTarget } from './targets'

export interface FreeObjectCommand { edits: ComponentEdit[]; selectedIds: string[] }
const newId = () => crypto.randomUUID()
const empty = (targets: readonly FreeObjectTarget[]): FreeObjectCommand => ({ edits: [], selectedIds: targets.map(target => target.instanceId) })

export function nudgeFreeObjects(targets: readonly FreeObjectTarget[], delta: { x: number; y: number }): ComponentEdit[] {
  return targets.map(target => {
    const local = transformVector(invertMatrix(target.parentToSurface), delta)
    return { type: 'frame.set', instanceId: target.instanceId, frame: { ...target.frame,
      transform: [...composeMatrices(translationMatrix(local.x, local.y), target.frame.transform)] } }
  })
}

export function alignFreeObjects(targets: readonly FreeObjectTarget[], alignment: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'): ComponentEdit[] {
  const bounds = freeSelectionBounds(targets)
  if (!bounds || targets.length < 2) return []
  return targets.flatMap(target => {
    const box = freeTargetBounds(target)
    const x = alignment === 'left' ? bounds.left - box.left : alignment === 'right' ? bounds.right - box.right
      : alignment === 'center-x' ? (bounds.left + bounds.right - box.left - box.right) / 2 : 0
    const y = alignment === 'top' ? bounds.top - box.top : alignment === 'bottom' ? bounds.bottom - box.bottom
      : alignment === 'center-y' ? (bounds.top + bounds.bottom - box.top - box.bottom) / 2 : 0
    return nudgeFreeObjects([target], { x, y })
  })
}

export function distributeFreeObjects(targets: readonly FreeObjectTarget[], axis: 'x' | 'y'): ComponentEdit[] {
  if (targets.length < 3) return []
  const low = axis === 'x' ? 'left' : 'top', high = axis === 'x' ? 'right' : 'bottom'
  const size = axis === 'x' ? 'width' : 'height'
  const sorted = targets.map(target => ({ target, box: freeTargetBounds(target) })).sort((a, b) => a.box[low] - b.box[low])
  const first = sorted[0]!, last = sorted.at(-1)!
  const gap = (last.box[high] - first.box[low] - sorted.reduce((sum, value) => sum + value.box[size], 0)) / (sorted.length - 1)
  let cursor = first.box[low]
  return sorted.flatMap(({ target, box }, index) => {
    const delta = cursor - box[low]
    cursor += box[size] + gap
    return index === 0 || index === sorted.length - 1 ? [] : nudgeFreeObjects([target], axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta })
  })
}

export function groupFreeObjects(project: CourseProjectV10, targets: readonly FreeObjectTarget[], allocateId = newId): FreeObjectCommand {
  if (targets.length < 2) return empty(targets)
  const ids = targets.map(target => target.instanceId), owner = ownerOfSelection(project, ids)
  if (!owner) throw new Error('请选择同一容器中的对象再编组')
  const siblings = containerChildIds(project, owner), sorted = [...targets].sort((a, b) => siblings.indexOf(a.instanceId) - siblings.indexOf(b.instanceId))
  const bounds = pointsBounds(sorted.flatMap(target => [...frameCorners(target.frame)]))
  const groupId = allocateId()
  const existing = Object.values(project.definitions).find(definition => definition.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.group')
  const definitionId = existing?.id ?? allocateId()
  const frame = { width: Math.max(bounds.width, 0.001), height: Math.max(bounds.height, 0.001), transform: [...translationMatrix(bounds.left, bounds.top)] as [number, number, number, number, number, number] }
  const edits: ComponentEdit[] = []
  if (!existing) edits.push({ type: 'definition.set', definition: { id: definitionId, title: '编组', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } } })
  edits.push({ type: 'instance.insert', container: owner, index: siblings.indexOf(sorted[0]!.instanceId),
    instances: [{ id: groupId, definitionId, data: {}, frame, childIds: [] }], rootIds: [groupId] })
  sorted.forEach((target, index) => {
    const childFrame = reparentFrame(target.frame, [1, 0, 0, 1, 0, 0], frame.transform)
    edits.push({ type: 'instance.move', instanceId: target.instanceId, container: { kind: 'instance', instanceId: groupId }, index,
      frame: { ...childFrame, transform: [...childFrame.transform] } })
  })
  return { edits, selectedIds: [groupId] }
}

export function ungroupFreeObjects(project: CourseProjectV10, targets: readonly FreeObjectTarget[]): FreeObjectCommand {
  const edits: ComponentEdit[] = [], selectedIds: string[] = []
  const siblingProjection = new Map<string, string[]>()
  for (const target of targets) {
    const group = project.instances[target.instanceId]
    const implementation = project.definitions[group.definitionId]?.implementation
    if (!group.childIds?.length || implementation?.kind !== 'builtin' || implementation.key !== 'guoling.group') continue
    const parentKey = JSON.stringify(target.parent)
    const siblings = siblingProjection.get(parentKey) ?? [...containerChildIds(project, target.parent)]
    siblingProjection.set(parentKey, siblings)
    const index = siblings.indexOf(group.id)
    group.childIds.forEach((id, offset) => {
      const child = project.instances[id]!
      if (!child.frame) throw new Error('组内对象没有自由 frame，不能直接解组')
      const frame = reparentFrame(child.frame, target.frame.transform, [1, 0, 0, 1, 0, 0])
      edits.push({ type: 'instance.move', instanceId: id, container: target.parent, index: index + offset, frame: { ...frame, transform: [...frame.transform] } })
      selectedIds.push(id)
    })
    siblings.splice(index, 1, ...group.childIds)
    edits.push({ type: 'instance.remove', instanceId: group.id })
  }
  return { edits, selectedIds }
}

export function reorderFreeObjects(project: CourseProjectV10, targets: readonly FreeObjectTarget[], direction: 'front' | 'back' | 'forward' | 'backward'): ComponentEdit[] {
  const owner = ownerOfSelection(project, targets.map(value => value.instanceId))
  if (!owner) throw new Error('请选择同一容器中的对象再调整层级')
  const original = [...containerChildIds(project, owner)], selected = new Set(targets.map(value => value.instanceId))
  const desired = [...original]
  if (direction === 'front' || direction === 'back') {
    desired.splice(0, desired.length, ...(direction === 'front'
      ? [...original.filter(id => !selected.has(id)), ...original.filter(id => selected.has(id))]
      : [...original.filter(id => selected.has(id)), ...original.filter(id => !selected.has(id))]))
  } else if (direction === 'forward') {
    for (let i = desired.length - 2; i >= 0; i--) if (selected.has(desired[i]!) && !selected.has(desired[i + 1]!)) [desired[i], desired[i + 1]] = [desired[i + 1]!, desired[i]!]
  } else {
    for (let i = 1; i < desired.length; i++) if (selected.has(desired[i]!) && !selected.has(desired[i - 1]!)) [desired[i], desired[i - 1]] = [desired[i - 1]!, desired[i]!]
  }
  const current = [...original], edits: ComponentEdit[] = []
  const chosen = original.filter(id => selected.has(id))
  // Move only the user's selected objects. Higher moves run from the top so targets
  // retain their mutual order even when several selected siblings cross one neighbor.
  if (direction === 'front' || direction === 'forward') chosen.reverse()
  chosen.forEach(id => {
    const index = desired.indexOf(id)
    if (current.indexOf(id) === index) return
    current.splice(current.indexOf(id), 1); current.splice(index, 0, id)
    edits.push({ type: 'instance.move', instanceId: id, container: owner, index })
  })
  return edits
}

/** Software allocates clone identities and remaps only formal internal attachments. */
export function duplicateFreeObjects(project: CourseProjectV10, targets: readonly FreeObjectTarget[], allocateId = newId): FreeObjectCommand {
  const owner = ownerOfSelection(project, targets.map(target => target.instanceId))
  if (!owner) throw new Error('请选择同一容器中的对象再复制')
  const ids = new Map<string, string>(), clones: ComponentInstance[] = []
  const collect = (id: string) => { ids.set(id, allocateId()); for (const child of project.instances[id]?.childIds ?? []) collect(child) }
  for (const target of targets) collect(target.instanceId)
  for (const [id, nextId] of ids) {
    const instance = structuredClone(project.instances[id]!)
    const { id: _oldId, ...fields } = instance
    const clone: ComponentInstance = { ...fields, id: nextId }
    if (clone.childIds) clone.childIds = clone.childIds.map(child => ids.get(child)!)
    if (clone.attachments) clone.attachments = clone.attachments.map(attachment => ({ ...attachment,
      instanceId: ids.get(attachment.instanceId) ?? attachment.instanceId,
      target: attachment.target.kind === 'instance' ? { kind: 'instance', instanceId: ids.get(attachment.target.instanceId) ?? attachment.target.instanceId } : attachment.target }))
    if (targets.some(target => target.instanceId === id) && clone.frame) {
      const target = targets.find(value => value.instanceId === id)!
      const edit = nudgeFreeObjects([target], { x: 16, y: 16 })[0]!
      if (edit.type === 'frame.set' && edit.frame) clone.frame = edit.frame
    }
    clones.push(clone)
  }
  const selectedIds = targets.map(target => ids.get(target.instanceId)!), siblings = containerChildIds(project, owner)
  return { selectedIds, edits: [{ type: 'instance.insert', container: owner,
    index: Math.max(...targets.map(target => siblings.indexOf(target.instanceId))) + 1, instances: clones, rootIds: selectedIds }] }
}
