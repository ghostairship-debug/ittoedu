import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { prepareComponentLibraryInsertion } from './insert'

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
