import type { ComponentDefinition, ComponentEdit, ComponentImplementation, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../shared/workbench/document'
import { getBuiltinComponentSource } from './builtinSources'
import { componentSourceAuthoringEdits, type ComponentSourceEditTarget } from './sourceAuthoringEdits'

type Source = Extract<ComponentImplementation, { kind: 'source' }>
export interface ComponentAuthorSource {
  implementation: Source
  /** Read-only preparation. These definitions enter the project only with an actual edit. */
  definitions: ComponentDefinition[]
}

/** UI and file observations use the same author entry, without mutating a builtin on read. */
export function prepareComponentAuthorSource(project: CourseProjectV10, effective: ComponentImplementation | undefined): ComponentAuthorSource | undefined {
  if (!effective) return undefined
  if (effective.kind === 'source') return { implementation: effective, definitions: [] }
  const source = getBuiltinComponentSource(effective.key)
  if (!source) return undefined
  const base = `source-${effective.key}`
  let id = base, suffix = 1
  while (Object.hasOwn(project.definitions, id)) {
    const existing = project.definitions[id].implementation
    if (existing.kind === 'source' && existing.source === source.source && existing.language === source.language
      && !existing.workspace && !existing.moduleBindings && !existing.dependencies && !existing.resourceBindings) break
    id = `${base}-${++suffix}`
  }
  return {
    implementation: { kind: 'source', language: 'javascript', moduleBindings: { './implementation': id },
      source: "import implementation from './implementation';\n\nexport default {\n  ...implementation,\n  mount(context) {\n    return implementation.mount(context);\n  },\n};\n" },
    definitions: Object.hasOwn(project.definitions, id) ? [] : [{ id, title: `${effective.key} 实现`, role: 'mixed', implementation: source }],
  }
}

export function componentAuthorSourceProject(project: CourseProjectV10, prepared: ComponentAuthorSource): CourseProjectV10 {
  return prepared.definitions.length ? { ...project, definitions: { ...project.definitions,
    ...Object.fromEntries(prepared.definitions.map(definition => [definition.id, definition])) } } : project
}

/** Dependencies are formal source owners, never a second writable expanded closure. */
export function componentAuthorSourceModules(project: CourseProjectV10, resources: DocumentResources, prepared: ComponentAuthorSource): Array<{
  id?: string; title: string; implementation: Source
}> {
  const current = componentAuthorSourceProject(project, prepared)
  const ids = new Set<string>(), pending = Object.values(prepared.implementation.moduleBindings ?? {})
  pending.push(...prepared.implementation.dependencies ?? [])
  while (pending.length) {
    const id = pending.shift()!, source = current.definitions[id]?.implementation
    if (ids.has(id) || source?.kind !== 'source') continue
    ids.add(id); pending.push(...Object.values(source.moduleBindings ?? {}), ...source.dependencies ?? [])
  }
  return [{ title: '作者入口', implementation: prepared.implementation },
    ...[...ids].map(id => ({
      id, title: current.definitions[id].title ?? id, implementation: current.definitions[id].implementation as Source,
    }))]
}

const sourceBindings = (source: Source) => source.moduleBindings ?? Object.fromEntries((source.dependencies ?? []).map(id => [id, id]))

export function componentAuthorSourceDependencyPaths(project: CourseProjectV10, prepared: ComponentAuthorSource,
  dependencyId: string, resources?: DocumentResources): string[][] {
  const current = componentAuthorSourceProject(project, prepared)
  const paths: string[][] = []
  const visit = (source: Source, path: string[], seen: Set<string>) => {
    for (const [specifier, id] of Object.entries(sourceBindings(source))) {
      if (id === dependencyId) paths.push([...path, specifier])
      if (seen.has(id)) continue
      const next = current.definitions[id]?.implementation
      if (next?.kind === 'source') visit(next, [...path, specifier], new Set([...seen, id]))
    }
  }
  visit(prepared.implementation, [], new Set())
  return paths
}

/** Recovery stores import spellings, not a second dependency registry or source snapshot. */
export function resolveComponentAuthorSourceDependencyPaths(project: CourseProjectV10, prepared: ComponentAuthorSource,
  paths: readonly (readonly string[])[], resources?: DocumentResources): string | undefined {
  const current = componentAuthorSourceProject(project, prepared)
  const targets = new Set<string>()
  for (const path of paths) {
    let source: ComponentImplementation | undefined = prepared.implementation, id: string | undefined
    for (const specifier of path) {
      id = source?.kind === 'source' ? sourceBindings(source)[specifier] : undefined
      source = id ? current.definitions[id]?.implementation : undefined
    }
    if (!id || source?.kind !== 'source') return undefined
    targets.add(id)
  }
  return targets.size === 1 ? [...targets][0] : undefined
}

/** Replace one module through the selected author root. Only its live ancestors are copied. */
export function componentAuthorSourceEdits(project: CourseProjectV10, resources: DocumentResources,
  target: ComponentSourceEditTarget, prepared: ComponentAuthorSource, replacement: Source,
  files?: Extract<ComponentEdit, { type: 'component.files.set' }>, dependencyId?: string): ComponentEdit[] {
  const current = componentAuthorSourceProject(project, prepared)
  const rootId = Object.values(current.definitions).find(definition => definition.implementation === prepared.implementation)?.id
  if (!dependencyId || target.kind === 'definition' && dependencyId === rootId) return [...prepared.definitions.map(definition => ({ type: 'definition.set' as const, definition })),
    ...componentSourceAuthoringEdits(target, replacement, files)]
  const modules = componentAuthorSourceModules(project, resources, prepared)
  const definitions = new Set(modules.flatMap(module => module.id ? [module.id] : []))
  const references = (source: Source) => new Set(Object.values(sourceBindings(source)))
  if (!definitions.has(dependencyId)) throw new Error('原源码依赖已不在当前作者入口中，请读取当前源码。')
  const copied = new Set([dependencyId])
  let changed = true
  while (changed) {
    changed = false
    for (const id of definitions) if (!copied.has(id)) {
      const definition = current.definitions[id]
      if (definition.implementation.kind === 'source' && [...references(definition.implementation)].some(value => copied.has(value))) {
        copied.add(id); changed = true
      }
    }
  }
  // A dependency already private to this author root can be edited in place.
  // Preserve modules reached by other instances and by independent definition roots.
  const incoming = new Set<string>()
  for (const definition of Object.values(current.definitions)) if (definition.implementation.kind === 'source')
    Object.values(sourceBindings(definition.implementation)).forEach(id => incoming.add(id))
  for (const instance of Object.values(current.instances)) if (instance.implementationOverride?.kind === 'source')
    Object.values(sourceBindings(instance.implementationOverride)).forEach(id => incoming.add(id))
  const protectedIds = new Set<string>()
  const protect = (implementation: ComponentImplementation, id?: string) => {
    if (id) { if (protectedIds.has(id)) return; protectedIds.add(id) }
    if (implementation.kind !== 'source') return
    for (const nextId of Object.values(sourceBindings(implementation))) {
      const next = current.definitions[nextId]
      if (next) protect(next.implementation, nextId)
    }
  }
  for (const definition of Object.values(current.definitions)) if ((!incoming.has(definition.id) || !definitions.has(definition.id) && definition.id !== rootId)
    && !(target.kind === 'definition' && definition.id === target.definition.id)) protect(definition.implementation, definition.id)
  for (const instance of Object.values(current.instances)) {
    if (target.kind === 'instance' && instance.id === target.instanceId
      || target.kind === 'definition' && instance.definitionId === target.definition.id && !instance.implementationOverride) continue
    const effective = instance.implementationOverride ?? current.definitions[instance.definitionId]?.implementation
    if (effective) protect(effective, instance.implementationOverride ? undefined : instance.definitionId)
  }
  // A definition is itself a public author root, even when only this instance uses it.
  if (target.kind === 'instance' && rootId) protect(prepared.implementation, rootId)
  const ids = new Map([...copied].map(id => [id, protectedIds.has(id) ? crypto.randomUUID() : id]))
  if (rootId && copied.has(rootId) && target.kind === 'definition') ids.set(rootId, target.definition.id)
  const rebind = (source: Source): Source => {
    const bindings = { ...(source.moduleBindings ?? Object.fromEntries((source.dependencies ?? []).map(id => [id, id]))) }
    return { ...source, moduleBindings: Object.fromEntries(Object.entries(bindings).map(([name, id]) => [name, ids.get(id) ?? id])),
      ...(source.dependencies ? { dependencies: source.dependencies.map(id => ids.get(id) ?? id) } : {}) }
  }
  const edits: ComponentEdit[] = prepared.definitions.filter(definition => !copied.has(definition.id))
    .map(definition => ({ type: 'definition.set', definition }))
  for (const id of copied) {
    if (id === rootId && target.kind === 'definition') continue
    const original = current.definitions[id], definition = { ...original, id: ids.get(id)!, implementation: rebind(id === dependencyId ? replacement : original.implementation as Source) }
    const added = componentSourceAuthoringEdits({ kind: 'definition', definition }, definition.implementation,
      id === dependencyId ? files : undefined)
    // The source origin is a captured read dependency of this copy, not a write to the shared module.
    for (const edit of added) if (edit.type === 'definition.set') edit.sourceOriginId = id
    edits.push(...added)
  }
  // An instance override has its own module identity. A cycle back to the original
  // definition must resolve to the same private module, not evaluate a duplicate root.
  const implementation = rootId && copied.has(rootId) && target.kind === 'instance'
    ? { kind: 'source' as const, language: 'javascript' as const,
      source: "import * as implementation from './implementation';\nexport default Reflect.get(implementation, 'default') ?? implementation;\nexport * from './implementation';\n",
      moduleBindings: { './implementation': ids.get(rootId)! },
      ...(prepared.implementation.resourceBindings ? { resourceBindings: prepared.implementation.resourceBindings } : {}) }
    : rebind(prepared.implementation)
  return [...edits, ...componentSourceAuthoringEdits(target, implementation)]
}
