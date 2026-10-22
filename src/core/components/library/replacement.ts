import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { prepareComponentLibraryInsertion } from './insert'
import { componentDefinitionHasLocalSourceChanges, type ComponentLibraryUpdateOptions } from './updateSource'
import type { DocumentResources } from '../../../shared/workbench/document'

/** Replacement changes the shared definition, preserving instance data/frame/overrides and the library original. */
export function planCourseComponentPackageReplacement(project: CourseProjectV10, definitionId: string, entry: ComponentLibraryEntry,
  options: ComponentLibraryUpdateOptions = {}, resources?: DocumentResources): ComponentEdit[] {
  const definition = project.definitions[definitionId]
  if (!definition) throw new Error('待替换组件已不存在。')
  if (!options.replaceLocalSource && componentDefinitionHasLocalSourceChanges(definition, resources?.components)) {
    throw new Error('当前组件源码包含本地修改；请查看来源差异后明确选择更新，或继续保留当前版本。')
  }
  const root = entry.example.instances[entry.example.rootIds[0]]
  if (!root) throw new Error('替换条目没有可用的组件实例。')
  const prepared = prepareComponentLibraryInsertion(project, entry, {
    container: { kind: 'project' }, index: project.rootIds.length,
    definitionBindings: { [root.definitionId]: definitionId },
    definitionsOnly:true,
  })
  const edits = prepared.command.edits.filter(edit => edit.type !== 'instance.insert')
  const implementation = definition.implementation
  const ownerId = implementation.kind === 'source' ? implementation.workspace?.ownerId : undefined
  const previousFiles = ownerId && resources?.components[ownerId]
  if (ownerId && previousFiles) edits.unshift({ type: 'component.files.set', ownerId,
    expectedFiles: structuredClone(previousFiles), files: structuredClone(previousFiles) })
  return edits
}
