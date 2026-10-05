import { containerChildIds, owningContainer, type ComponentContainer, type ComponentInstance, type CourseProjectV10, type JsonValue } from '../../../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../../../shared/contracts/component-platform/operations'
import { equalComponentValue } from '../../../../core/drivers/courseV10Operations'
import type { TextComponentData } from '../../../../components/text/data'

/** The view borrows the canonical ownership relation; it never stores a body document. */
export function flowSurface(project: CourseProjectV10, surfaceId: string) {
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (!surface || surface.kind !== 'flow') throw new Error('当前表面不是讲义')
  return surface
}

export function flowInstanceIds(project: CourseProjectV10, surfaceId: string): string[] {
  const visit = (ids: readonly string[]): string[] => ids.flatMap(id => [id, ...visit(project.instances[id]?.childIds ?? [])])
  return visit(flowSurface(project, surfaceId).childIds)
}

export function flowTextEdits(instanceId: string, before: TextComponentData, after: TextComponentData): ComponentEdit[] {
  const edits: ComponentEdit[] = []
  if (!equalComponentValue(before.content, after.content)) edits.push({ type: 'data.set', instanceId, path: ['content'], value: after.content as unknown as JsonValue })
  for (const key of Object.keys(after.appearance) as (keyof TextComponentData['appearance'])[]) {
    const value=after.appearance[key]
    if (value!==undefined && !equalComponentValue(before.appearance[key], value)) edits.push({ type: 'data.set', instanceId, path: ['appearance', key], value })
  }
  return edits
}

/** Index is the final sibling position, matching canonical instance.move. */
export function flowMoveEdit(project: CourseProjectV10, surfaceId: string, instanceId: string, index: number): ComponentEdit[] {
  if (!flowInstanceIds(project, surfaceId).includes(instanceId)) throw new Error('对象不属于当前讲义')
  const container = owningContainer(project, instanceId)
  if (!container) throw new Error('对象已失去归属')
  const siblings = containerChildIds(project, container)
  if (!Number.isInteger(index) || index < 0 || index >= siblings.length) throw new RangeError('阅读位置超出当前容器')
  return siblings.indexOf(instanceId) === index ? [] : [{ type: 'instance.move', instanceId, container, index }]
}

export function flowParent(project: CourseProjectV10, instanceId: string): ComponentContainer | null {
  return owningContainer(project, instanceId)
}

export function flowIsHeadless(project: CourseProjectV10, instance: ComponentInstance): boolean {
  return project.definitions[instance.definitionId]?.role === 'behavior'
}
