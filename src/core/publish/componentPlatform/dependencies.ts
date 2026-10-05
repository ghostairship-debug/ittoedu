import type {
  ComponentImplementation,
  CourseProjectV10,
} from '../../../shared/contracts/component-platform/project'

export interface ComponentPublishDependencies {
  /** Shared defaults are resolved by the consumer, never compiled per instance. */
  builtinKeys: string[]
  /** Diagnostic inventory only; shared compilation input resolves each importer within its owner. */
  moduleSpecifiers: string[]
  sourceInstanceIds: string[]
}

/** Read the same effective implementation that R0 executes. No source rewriting. */
export function componentPublishDependencies(project: CourseProjectV10): ComponentPublishDependencies {
  const builtinKeys = new Set<string>()
  const moduleSpecifiers = new Set<string>()
  const sourceInstanceIds: string[] = []
  for (const instance of Object.values(project.instances)) {
    const implementation: ComponentImplementation | undefined = instance.implementationOverride
      ?? project.definitions[instance.definitionId]?.implementation
    if (!implementation) throw new Error(`发布对象的定义已不存在：${instance.id}`)
    if (implementation.kind === 'builtin') builtinKeys.add(implementation.key)
    else {
      sourceInstanceIds.push(instance.id)
      for (const dependency of (implementation.moduleBindings ? Object.keys(implementation.moduleBindings) : implementation.dependencies ?? [])) moduleSpecifiers.add(dependency)
    }
  }
  return { builtinKeys: [...builtinKeys], moduleSpecifiers: [...moduleSpecifiers], sourceInstanceIds }
}
