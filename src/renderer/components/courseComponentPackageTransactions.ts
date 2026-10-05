import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import { owningContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { prepareComponentLibraryInsertion } from '../../core/components/library'

export interface CourseComponentPackageUsage {
  packageId: string; packageExists: boolean; totalInstanceCount: number; sceneInstanceCount: number; globalInstanceCount: number
  references: { instanceId: string; surfaceId?: string; scope: 'scene' | 'global'; carrier: 'instance' }[]
}
export function collectCourseComponentPackageUsage(project: CourseProjectV10, definitionId: string): CourseComponentPackageUsage {
  const references = Object.values(project.instances).filter(instance => instance.definitionId === definitionId).map(instance => {
    let owner = owningContainer(project, instance.id)
    while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
    return { instanceId: instance.id, surfaceId: owner?.kind === 'surface' ? owner.surfaceId : undefined,
      scope: owner?.kind === 'global' ? 'global' as const : 'scene' as const, carrier: 'instance' as const }
  })
  const globalInstanceCount = references.filter(reference => reference.scope === 'global').length
  return { packageId: definitionId, packageExists: Boolean(project.definitions[definitionId]), references,
    totalInstanceCount: references.length, globalInstanceCount, sceneInstanceCount: references.length - globalInstanceCount }
}
export const collectCourseComponentPackageReferences = (project: CourseProjectV10, id: string) => collectCourseComponentPackageUsage(project, id).references

/** Replacement changes the shared definition, preserving instance data/frame/overrides and the library original. */
export function planCourseComponentPackageReplacement(project: CourseProjectV10, definitionId: string, entry: ComponentLibraryEntry): ComponentEdit[] {
  if (!project.definitions[definitionId]) throw new Error('待替换组件已不存在。')
  const root = entry.example.instances[entry.example.rootIds[0]]
  if (!root) throw new Error('替换条目没有可用的组件实例。')
  const surface = project.surfaces[0]
  if (!surface) throw new Error('工程没有可用页面。')
  const prepared = prepareComponentLibraryInsertion(project, entry, {
    container: { kind: 'surface', surfaceId: surface.id }, index: surface.childIds.length,
    definitionBindings: { [root.definitionId]: definitionId },
  })
  return prepared.command.edits.filter(edit => edit.type !== 'instance.insert')
}
