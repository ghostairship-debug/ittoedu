import { owningContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
export { planCourseComponentPackageReplacement } from '../../core/components/library/replacement'

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
