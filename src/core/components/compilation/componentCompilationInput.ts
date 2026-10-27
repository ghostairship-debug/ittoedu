import type { ComponentImplementation, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
import type { ComponentCompilationInput, ComponentModuleDependency, ComponentModuleSource } from './types'

type SourceImplementation = Extract<ComponentImplementation, { kind: 'source' }>

/** Editing projects text only; opaque files keep their canonical bytes. */
export function componentSourceFileText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return null }
}

function sourceModule(implementation: SourceImplementation, resources: DocumentResources | undefined, requireEntry: boolean): ComponentModuleSource {
  const moduleBindings = implementation.moduleBindings
    ?? Object.fromEntries((implementation.dependencies ?? []).map(id => [id, id]))
  if (implementation.workspace) {
    const { ownerId, entry } = implementation.workspace
    const files = resources?.components[ownerId]
    if (requireEntry && (!files || !Object.hasOwn(files, entry))) throw new Error(`组件源码入口尚未提供：${ownerId}/${entry}`)
    const text: Record<string, string> = Object.create(null), binaryFiles: Record<string, Uint8Array> = Object.create(null)
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
  const dependencies: Record<string, ComponentModuleDependency> = Object.create(null)
  const pending = [...Object.values(source.moduleBindings ?? {})]
  while (pending.length) {
    const id = pending.shift()!
    if (Object.hasOwn(dependencies, id)) continue
    const definition = Object.hasOwn(project.definitions,id) ? project.definitions[id] : undefined
    // A dormant binding must not reject a usable module. The compiler reports an
    // absent definition/entry at the actual import, with the original spelling intact.
    if (!definition || definition.implementation.kind !== 'source') continue
    const dependency = sourceModule(definition.implementation, resources, false)
    dependencies[id] = { version: definition.version ?? '', ...dependency }
    pending.push(...Object.values(dependency.moduleBindings ?? {}))
  }
  const rootDefinitionId = Object.values(project.definitions).find(definition => definition.implementation === implementation)?.id
  return { ...source, dependencies, ...(rootDefinitionId ? { rootDefinitionId } : {}) }
}

/** A World owns this reader for its immutable author/resource inputs. It checks
 * only the source owners actually named by the input before decoding files.
 * The general componentCompilationInput entry point remains a fresh snapshot. */
export function createComponentCompilationInputReader() {
  type Entry = { input: ComponentCompilationInput; implementation: string; source?: string; rootDefinitionId?: string;
    rootDefinitions?: WeakRef<CourseProjectV10['definitions']>; owners: Array<{ id: string;
      version?: string; implementation: string; source?: string;
      files: Readonly<Record<string, Uint8Array>> | undefined; entries: Array<[string, Uint8Array]> }> }
  const cached = new WeakMap<SourceImplementation, Entry>()
  type SourceOwner = { key: string; rootDefinitionId?: string; instanceId?: string }
  let indexedProject: WeakRef<CourseProjectV10> | undefined, indexedProjectId: string | undefined
  let sourceOwners = new WeakMap<SourceImplementation, SourceOwner>()
  let ownerInputs = new Map<string, Entry>()
  const ownerOf = (project: CourseProjectV10, implementation: SourceImplementation): SourceOwner | undefined => {
    if (indexedProject?.deref() !== project) {
      const nextOwners = new WeakMap<SourceImplementation, SourceOwner>(), retained = new Map<string, Entry>()
      const remember = (value: ComponentImplementation | undefined, owner: SourceOwner) => {
        if (value?.kind !== 'source' || nextOwners.has(value)) return
        nextOwners.set(value, owner)
        const previous = indexedProjectId === project.id ? ownerInputs.get(owner.key) : undefined
        if (previous) retained.set(owner.key, previous)
      }
      // Formal owners survive immutable project snapshots. Object allocation is
      // not a source edit, and must not force another compilation/preparation.
      // Definitions come first, matching componentCompilationInput's root identity.
      for (const definition of Object.values(project.definitions)) remember(definition.implementation,
        { key: `definition:${definition.id}`, rootDefinitionId: definition.id })
      for (const instance of Object.values(project.instances)) remember(instance.implementationOverride, { key: `instance:${instance.id}`, instanceId: instance.id })
      sourceOwners = nextOwners; ownerInputs = retained
      indexedProject = new WeakRef(project); indexedProjectId = project.id
    }
    const owner = sourceOwners.get(implementation)
    // Keep the existing detached/in-place edit path honest as well: an index
    // entry cannot preserve shared-root identity after its owner was replaced.
    return owner && (owner.rootDefinitionId ? project.definitions[owner.rootDefinitionId]?.implementation === implementation
      : owner.instanceId && project.instances[owner.instanceId]?.implementationOverride === implementation) ? owner : undefined
  }
  const definitionAt = (project: CourseProjectV10, id: string) => Object.hasOwn(project.definitions, id) ? project.definitions[id] : undefined
  const ownerFiles = (implementation: ComponentImplementation | undefined, resources: DocumentResources | undefined) =>
    implementation?.kind === 'source' && implementation.workspace ? resources?.components[implementation.workspace.ownerId] : undefined
  const sameFiles = (owner: Entry['owners'][number], files: Readonly<Record<string, Uint8Array>> | undefined) =>
    owner.files === files && owner.entries.length === Object.keys(files ?? {}).length
      && owner.entries.every(([name, bytes]) => files?.[name] === bytes)
  const metadataFor = (value: ComponentImplementation | undefined) => value?.kind === 'source'
    ? JSON.stringify([value.kind, value.language, value.workspace, value.dependencies, value.moduleBindings, value.resourceBindings])
    : JSON.stringify(value) ?? ''
  return (project: CourseProjectV10, implementation: SourceImplementation, resources?: DocumentResources): ComponentCompilationInput => {
    // Source text is already a string; keep it out of the repeatedly serialized
    // metadata, while observing edits to maps or the declared workspace.
    const metadata = metadataFor(implementation)
    const owner = ownerOf(project, implementation)
    const previous = (owner ? ownerInputs.get(owner.key) : undefined) ?? cached.get(implementation)
    if (previous?.implementation === metadata && previous.source === implementation.source
      && (owner ? previous.rootDefinitionId === owner.rootDefinitionId
        : previous.rootDefinitionId ? definitionAt(project, previous.rootDefinitionId)?.implementation === implementation : previous.rootDefinitions?.deref() === project.definitions)
      && previous.owners.every(owner => {
        const definition = owner.id === '' ? undefined : definitionAt(project, owner.id)
        const value = owner.id === '' ? implementation : definition?.implementation
        return definition?.version === owner.version
          && metadataFor(value) === owner.implementation && (value?.kind === 'source' ? value.source : undefined) === owner.source
          && sameFiles(owner, ownerFiles(value, resources))
      })) {
      cached.set(implementation, previous)
      if (owner) ownerInputs.set(owner.key, previous)
      return previous.input
    }
    const input = componentCompilationInput(project, implementation, resources)
    const ids = new Set(['', ...Object.keys(input.dependencies ?? {}), ...Object.values(input.moduleBindings ?? {})])
    for (const dependency of Object.values(input.dependencies ?? {})) for (const id of Object.values(dependency.moduleBindings ?? {})) ids.add(id)
    const owners = [...ids].map(id => {
      const definition = id === '' ? undefined : definitionAt(project, id)
      const value = id === '' ? implementation : definition?.implementation
      const files = ownerFiles(value, resources)
      return { id, version: definition?.version, implementation: metadataFor(value), source: value?.kind === 'source' ? value.source : undefined,
        files, entries: Object.entries(files ?? {}) }
    })
    const entry = { input, implementation: metadata, source: implementation.source,
      rootDefinitionId: input.rootDefinitionId, rootDefinitions: input.rootDefinitionId ? undefined : new WeakRef(project.definitions), owners }
    cached.set(implementation, entry)
    if (owner) ownerInputs.set(owner.key, entry)
    return input
  }
}
