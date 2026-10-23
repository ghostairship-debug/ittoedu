import { componentDefinitionBuiltinKey, isComponentVisibleAtSurface, type ComponentInstance, type CourseProjectV10 } from './contracts/component-platform'
import { isNativeFlowLayoutGroup } from './flowNativeLayout'

/** A chapter opens its existing reading group; object navigation keeps the exact target.
 * The group's real padding and scroll margin remain the layout owner's responsibility. */
export function resolveFlowChapterEntry(project: CourseProjectV10, containerId: string, targetId: string): string {
  const container = project.instances[containerId]
  if (container?.container?.kind !== 'flow') return targetId
  const kind = (instance: ComponentInstance) => {
    if (componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) !== 'guoling.document-block') return undefined
    const data = instance.data
    return data && typeof data === 'object' && !Array.isArray(data) ? data.type : undefined
  }
  const readable = (instance: ComponentInstance) => !instance.container && !instance.flowPlacement
    && isComponentVisibleAtSurface(instance, containerId)
  const childrenFlow = (instance: ComponentInstance) => !instance.frame && (kind(instance) === 'section'
    || isNativeFlowLayoutGroup(instance, project.definitions[instance.definitionId]))
  const find = (ids: readonly string[]): ComponentInstance[] | undefined => {
    for (const id of ids) {
      const instance = project.instances[id]
      if (!instance || !readable(instance)) continue
      if (id === targetId) return [instance]
      const path = childrenFlow(instance) ? find(instance.childIds ?? []) : undefined
      if (path) return [instance, ...path]
    }
  }
  const path = find(container.childIds ?? []), target = path?.at(-1)
  if (!path || !target || kind(target) !== 'heading') return targetId
  const firstHeading = (ids: readonly string[]): string | undefined => {
    for (const id of ids) {
      const instance = project.instances[id]
      if (!instance || !readable(instance)) continue
      // A nested section has its own chapter title and cannot be skipped.
      if (kind(instance) === 'heading' || kind(instance) === 'section') return id
      const first = childrenFlow(instance) ? firstHeading(instance.childIds ?? []) : undefined
      if (first) return first
    }
  }
  for (let index = path.length - 2; index >= 0; index--) {
    const ancestor = path[index]
    if (kind(ancestor) === 'section') return firstHeading(ancestor.childIds ?? []) === targetId ? ancestor.id : targetId
  }
  const group = path[0]
  return isNativeFlowLayoutGroup(group, project.definitions[group.definitionId])
    && firstHeading(group.childIds ?? []) === targetId ? group.id : targetId
}
