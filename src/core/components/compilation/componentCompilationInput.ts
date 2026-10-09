import type { ComponentImplementation, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
import type { ComponentCompilationInput, ComponentModuleDependency, ComponentModuleSource } from './types'

type SourceImplementation = Extract<ComponentImplementation, { kind: 'source' }>

/** Editing projects text only; opaque files keep their canonical bytes. */
export function componentSourceFileText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\0') ? null : text
  } catch { return null }
}

function sourceModule(implementation: SourceImplementation, resources: DocumentResources | undefined, requireEntry: boolean): ComponentModuleSource {
  const moduleBindings = implementation.moduleBindings
    ?? Object.fromEntries((implementation.dependencies ?? []).map(id => [id, id]))
  if (implementation.workspace) {
    const { ownerId, entry } = implementation.workspace
    const files = resources?.components[ownerId]
    if (requireEntry && (!files || !Object.hasOwn(files, entry))) throw new Error(`组件源码入口尚未提供：${ownerId}/${entry}`)
    const text: Record<string, string> = {}, binaryFiles: Record<string, Uint8Array> = {}
    for (const [name, bytes] of Object.entries(files ?? {})) {
      const value = componentSourceFileText(bytes)
      if (value === null) binaryFiles[name] = Uint8Array.from(bytes)
      else text[name] = value
    }
    return { entry, entryLanguage: implementation.language, files: text, ...(Object.keys(binaryFiles).length ? { binaryFiles } : {}), moduleBindings }
  }
  if (typeof implementation.source !== 'string') throw new Error('组件源码尚未提供')
  const entry = `component.${implementation.language === 'typescript' ? 'ts' : 'js'}`
  return { entry, entryLanguage: implementation.language, files: { [entry]: implementation.source }, moduleBindings }
}

/** Resolve the required author entry; dependency availability is checked when an import actually resolves it. */
export function componentModuleSource(implementation: SourceImplementation, resources?: DocumentResources): ComponentModuleSource {
  return sourceModule(implementation, resources, true)
}

/** Editor and Published compile the same formal file owners and importer bindings. */
export function componentCompilationInput(
  project: CourseProjectV10, implementation: SourceImplementation, resources?: DocumentResources,
): ComponentCompilationInput {
  const source = componentModuleSource(implementation, resources)
  const dependencies: Record<string, ComponentModuleDependency> = {}
  const pending = [...Object.values(source.moduleBindings ?? {})]
  while (pending.length) {
    const id = pending.shift()!
    if (Object.hasOwn(dependencies, id)) continue
    const definition = project.definitions[id]
    // A dormant binding must not reject a usable module. The compiler reports an
    // absent definition/entry at the actual import, with the original spelling intact.
    if (!definition || definition.implementation.kind !== 'source') continue
    const dependency = sourceModule(definition.implementation, resources, false)
    dependencies[id] = { version: definition.version ?? '', ...dependency }
    pending.push(...Object.values(dependency.moduleBindings ?? {}))
  }
  return { ...source, dependencies }
}
