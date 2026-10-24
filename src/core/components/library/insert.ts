import type { ComponentLibraryEntry, ComponentLibraryInput } from '../../../shared/contracts/component-platform/library'
import type { ComponentEdit, ComponentOperationBatch } from '../../../shared/contracts/component-platform/operations'
import type { ComponentContainer, ComponentImplementation, ComponentInstance, ComponentTarget, CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform/project'
import { componentDefinitionBuiltinKey, componentSurface, componentContainers, isComponentVisibleAtSurface, owningContainer } from '../../../shared/contracts/component-platform/project'
import { captureComponentOperation } from '../../drivers/courseV10Operations'
import { equalComponentValue } from '../../../shared/componentValue'
import { authoringAssetIds, componentAssetIds, rebindAuthoringAssets, rebindInteractionReferences, rebindProfessionalAssets, rebindWebAssets, sourceAssetIds, sourceModuleBindings } from './references'
import type { LibraryDiagnostic, LibraryIdentityMap, LibraryInputValues, LibraryReferenceAdapter } from './types'
import { rebindComponentLibraryImplementation } from './rebindSource'
import { createProfessionalDocumentIdentityCopy } from './professionalCopy'
import { extractComponentLibraryEntry } from './extract'
import { componentInteractionDataSchema, createComponentInteractionCopyIdentities } from '../../../shared/componentInteractionData'
import { remapComponentInputData } from '../../../components/input/authoring'
import { componentBackgroundAssetIds, rebindComponentBackground } from '../../../shared/componentBackgroundPaint'
import { componentLibraryProject, normalizeComponentLibraryEntry } from './entryProject'
import { componentImplementationSourceFiles } from './updateSource'
import { planComponentLibraryUsage } from './usage'

export interface InsertLibraryOptions {
  container: ComponentContainer
  index: number
  createId?: (kind: 'instance' | 'definition' | 'asset' | 'component') => string
  definitionBindings?: Readonly<Record<string, string>>
  targetBindings?: Readonly<Record<string, string>>
  surfaceBindings?: Readonly<Record<string, string>>
  inputs?: LibraryInputValues
  adapters?: Readonly<Record<string, LibraryReferenceAdapter>>
  definitionsOnly?:boolean
  /** Explicit selection of reusable object roots; descendants and behavior/resource closure follow. */
  rootIds?: readonly string[]
  surfaceIndex?: number
  /** Explicit local composition keeps page/template assets inside the chosen container. */
  placement?: 'root' | 'local'
}
export interface LibraryInsertion { command: ComponentOperationBatch; rootIds: string[]; identities: LibraryIdentityMap; diagnostics: LibraryDiagnostic[] }

function setInput(data: JsonValue, path: string[], value: JsonValue): JsonValue {
  if (!path.length) return structuredClone(value)
  let target: JsonValue = data
  for (const part of path.slice(0, -1)) {
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, part)) throw new Error('库输入字段已不存在')
    target = (target as Record<string, JsonValue>)[part]
  }
  if (!target || typeof target !== 'object') throw new Error('库输入字段无效')
  Object.defineProperty(target, path.at(-1)!, { value: structuredClone(value), configurable: true, writable: true, enumerable: true })
  return data
}

/** Produces a single canonical batch. It never writes a project or owns history. */
export function prepareComponentLibraryInsertion(project: CourseProjectV10, input: ComponentLibraryInput, options: InsertLibraryOptions): LibraryInsertion {
  let entry = normalizeComponentLibraryEntry(input)
  if (options.rootIds) {
    const source = componentLibraryProject(entry)
    entry = extractComponentLibraryEntry(source, entry.resources, { id: entry.id, title: entry.title, rootIds: [...options.rootIds], adapters: options.adapters }).entry
  }
  const usage = options.definitionsOnly ? undefined : planComponentLibraryUsage(project, entry, options)
  if (usage?.attachmentOnly) return { command: captureComponentOperation(project, usage.edits), rootIds: [], diagnostics: [],
    identities: { instances: new Map(), definitions: new Map(), assets: new Map(), components: new Map(), surfaces: new Map() } }
  const entryProject = componentLibraryProject(entry)
  const containers = componentContainers(entryProject)
  // Missing bytes remain unresolved in the new namespace instead of resolving to an unrelated destination asset.
  const assetIds = new Set(Object.keys(entry.assets))
  const implementations = [...Object.values(entry.definitions).map(value => value.implementation),
    ...Object.values(entry.example.instances).map(value => value.implementationOverride)]
  for (const implementation of implementations) if (implementation?.kind === 'source') {
    for (const id of sourceAssetIds(implementation)) assetIds.add(id)
  }
  for (const instance of options.definitionsOnly ? [] : Object.values(entry.example.instances)) {
    const definition = entry.definitions[instance.definitionId]
    if (definition) {
      for (const id of componentAssetIds(instance, definition)) assetIds.add(id)
      for (const id of options.adapters?.[instance.definitionId]?.references(instance, definition).assetIds ?? []) assetIds.add(id)
    }
  }
  if (!options.definitionsOnly) for (const surface of containers) {
    componentBackgroundAssetIds(surface.background).forEach(id => assetIds.add(id))
    for (const state of surface.presentation?.states ?? []) {
      componentBackgroundAssetIds(state.background).forEach(id => assetIds.add(id))
      for (const [id, override] of Object.entries(state.overrides)) {
        const instance = entry.example.instances[id], definition = instance && entry.definitions[instance.definitionId]
        if (!instance || !definition) continue
        for (const assetId of authoringAssetIds(override.authoring)) assetIds.add(assetId)
        if (override.data !== undefined) for (const assetId of componentAssetIds({ ...instance, data: override.data }, definition)) assetIds.add(assetId)
      }
    }
  }
  const diagnostics: LibraryDiagnostic[] = [...assetIds].filter(id => !entry.assets[id] || !entry.resources.assets[id])
    .map(id => ({ code: 'missing-asset', message: `保留了待修复的素材引用：${id}` }))
  const occupied = new Set([...Object.keys(project.instances), ...Object.keys(project.definitions), ...Object.keys(project.assets),
    ...(project.logic?.courseState ?? []).map(state => state.key), ...(entry.logic?.courseState ?? []).map(state => state.key)])
  for (const implementation of [...Object.values(project.definitions).map(value => value.implementation),
    ...Object.values(project.instances).map(value => value.implementationOverride)]) {
    if (implementation?.kind === 'source' && implementation.workspace) occupied.add(implementation.workspace.ownerId)
  }
  const allocate = (kind: 'instance' | 'definition' | 'asset' | 'component') => {
    const id = options.createId?.(kind) ?? `${kind}_${globalThis.crypto.randomUUID()}`
    if (!id || occupied.has(id)) throw new Error(`软件生成了重复的组件库身份：${id}`)
    occupied.add(id)
    return id
  }
  const missingDependencies=[...new Set(implementations.flatMap(value=>value?.kind==='source' ? Object.values(sourceModuleBindings(value)):[]))].filter(id=>!Object.hasOwn(entry.definitions,id))
  const primaryDefinitionId=entry.example.instances[entry.example.rootIds[0]]?.definitionId
  const libraryIdentity=(definition:typeof entry.definitions[string])=>({packageId:entry.id,version:definition.library?.version ?? definition.version ?? '1.0.0'})
  diagnostics.push(...missingDependencies.map(id=>({code:'missing-source-dependency',message:`保留待修复模块：${id}；副本不会绑定目的工程同名定义`})))
  const identities: LibraryIdentityMap = {
    instances: new Map(Object.keys(entry.example.instances).map(id => [id, allocate('instance')])),
    definitions: new Map([...Object.keys(entry.definitions).map(id => {
      const bound = options.definitionBindings?.[id]
      if (bound !== undefined) {
        if (!Object.hasOwn(project.definitions,bound)) throw new Error(`待替换组件定义不存在：${bound}`)
        return [id, bound]
      }
      const implementation = entry.definitions[id].implementation
      // Rebinding an equal source definition would also change the destination's existing instances.
      const ownsReboundReferences = implementation.kind === 'source' && (implementation.workspace
        || Object.keys(sourceModuleBindings(implementation)).length > 0 || assetIds.size > 0)
      const comparable={...entry.definitions[id],...(id===primaryDefinitionId ? {library:libraryIdentity(entry.definitions[id])}:{})}
      const existing = project.definitions[id]
      const existingComparable = existing?.library?.baseline ? { ...existing, library: {
        packageId: existing.library.packageId, ...(existing.library.version ? { version: existing.library.version } : {}) } } : existing
      return [id, !Object.hasOwn(project.definitions,id) || !ownsReboundReferences
        && equalComponentValue(existingComparable, comparable) ? id : allocate('definition')]
    }) as [string,string][],...missingDependencies.map(id=>[id,allocate('definition')] as [string,string])]),
    assets: new Map([...assetIds].map(id => [id, allocate('asset')])),
    components: new Map(Object.keys(entry.resources.components).map(id => [id, allocate('component')])),
    surfaces: new Map([...Object.entries(options.surfaceBindings ?? {}), ...(options.definitionsOnly ? [] : containers).map(surface => [surface.id, '' ] as [string, string])]),
  }
  for (const surface of containers) if (identities.instances.has(surface.id)) (identities.surfaces as Map<string, string>).set(surface.id, identities.instances.get(surface.id)!)
  // State and camera-frame identities are local to their copied container. Remap the container, retain its local IDs.
  const stateId = (id: string) => id
  const rules = new Map<string, string>(), actions = new Map<string, string>(), stateKeys = new Map<string, string>()
  const collectRules = (data: JsonValue) => {
    const copy = createComponentInteractionCopyIdentities(data)
    for (const [id, next] of copy.rules) if (!rules.has(id)) rules.set(id, next)
    for (const [id, next] of copy.actions) if (!actions.has(id)) actions.set(id, next)
  }
  for (const original of Object.values(entry.example.instances)) if (componentDefinitionBuiltinKey(entry.definitions[original.definitionId]) === 'guoling.interactions') {
    collectRules(original.data)
    for (const surface of containers) for (const state of surface.presentation?.states ?? []) if (state.overrides[original.id]?.data !== undefined) collectRules(state.overrides[original.id]!.data!)
  }
  // Managed inputs allocate their own scalar identities before other components consume the map.
  for (const original of Object.values(entry.example.instances)) if (componentDefinitionBuiltinKey(entry.definitions[original.definitionId]) === 'guoling.input') {
    const inputCopy = { fromInstanceId: original.id, toInstanceId: identities.instances.get(original.id)!, rules, stateKeys }
    remapComponentInputData(original.data, inputCopy)
    for (const surface of containers) for (const state of surface.presentation?.states ?? []) if (state.overrides[original.id]?.data !== undefined)
      remapComponentInputData(state.overrides[original.id]!.data!, inputCopy)
  }
  for (const declaration of entry.logic?.courseState ?? []) if (!stateKeys.has(declaration.key)) stateKeys.set(declaration.key,
    project.logic?.courseState.some(existing => existing.key === declaration.key) ? allocate('instance') : declaration.key)
  for (const original of Object.values(entry.example.instances)) for (const key of Object.values(original.stateBindings ?? {})) {
    if (stateKeys.has(key) || !project.logic?.courseState.some(existing => existing.key === key)) continue
    stateKeys.set(key, allocate('instance'))
    diagnostics.push({ code: 'state-binding-required', instanceId: original.id,
      message: `显式状态“${key}”没有随来源提供声明，已保留未绑定引用，未连接目标工程同名状态。` })
  }
  const implementation = (original: ComponentImplementation): ComponentImplementation => {
    if (original.kind === 'builtin') return structuredClone(original)
    if (original.workspace && !Object.hasOwn(entry.resources.components[original.workspace.ownerId] ?? {}, original.workspace.entry)) {
      throw new Error(`库条目缺少源码入口文件：${original.workspace.ownerId}/${original.workspace.entry}`)
    }
    return rebindComponentLibraryImplementation(original, identities, Object.keys(entry.assets))
  }
  const edits: ComponentEdit[] = [...usage?.edits ?? []]
  for (const [ownerId, files] of Object.entries(entry.resources.components)) edits.push({
    type: 'component.files.set', ownerId: identities.components.get(ownerId)!, expectedFiles: null,
    files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)])),
  })
  for (const original of Object.values(entry.definitions)) {
    const mappedImplementation = implementation(original.implementation)
    const mappedComponents = Object.fromEntries(Object.entries(entry.resources.components).map(([id, files]) => [identities.components.get(id)!, files]))
    const inheritedBaseline = original.library?.baseline
    const inheritedLibrary = inheritedBaseline ? { ...structuredClone(original.library!), baseline: { ...structuredClone(inheritedBaseline),
      implementation: inheritedBaseline.implementation.kind === 'source'
        ? rebindComponentLibraryImplementation(inheritedBaseline.implementation, identities, Object.keys(entry.assets), { retainUnmappedReferences: true })
        : structuredClone(inheritedBaseline.implementation) } } : undefined
    const definition = { ...structuredClone(original), id: identities.definitions.get(original.id)!, implementation: mappedImplementation,
      ...(inheritedLibrary ? { library: inheritedLibrary } : {}),
      ...(primaryDefinitionId===original.id ? {library:{...libraryIdentity(original),baseline:{implementation:structuredClone(mappedImplementation),
        ...(original.dataSchema ? {dataSchema:structuredClone(original.dataSchema)} : {}),sourceFiles:componentImplementationSourceFiles(mappedImplementation,mappedComponents)}}}:{}) }
    if (!equalComponentValue(project.definitions[definition.id], definition)) edits.push({ type: 'definition.set', definition })
  }
  for (const original of Object.values(entry.assets)) {
    const bytes = entry.resources.assets[original.id]
    // Keep the declared metadata in the library original. The inserted reference
    // stays unresolved under a fresh identity until its bytes can be repaired.
    if (!bytes) continue
    const id = identities.assets.get(original.id)!
    const extension = /\.[a-zA-Z0-9]+$/.exec(original.path)?.[0] ?? ''
    edits.push({ type: 'asset.add', asset: { ...structuredClone(original), id, path: `assets/${encodeURIComponent(id)}${extension}` }, bytes: Uint8Array.from(bytes) })
  }
  const instanceTarget = (id: string) => {
    const mapped = identities.instances.get(id) ?? options.targetBindings?.[id]
    if (!mapped || !identities.instances.has(id) && !project.instances[mapped]) throw new Error(`请绑定实际行为目标：${id}`)
    return mapped
  }
  const surfaceTarget = (id: string) => {
    const mapped = identities.surfaces.get(id)
    if (!mapped || !containers.some(surface => surface.id === id) && !componentSurface(project, mapped) && !project.rootIds.includes(mapped)) throw new Error(`请绑定实际表面目标：${id}`)
    return mapped
  }
  const surfaceAttachmentTarget = (id: string): ComponentTarget => {
    const mapped = surfaceTarget(id)
    return containers.some(surface => surface.id === id) || componentSurface(project, mapped)
      ? { kind: 'surface', surfaceId: mapped } : { kind: 'instance', instanceId: mapped }
  }
  const unresolvedInstances = new Map<string, string>(), unresolvedSurfaces = new Map<string, string>()
  const externalInstance = (id: string) => {
    if (!project.instances[id]) return id
    if (!unresolvedInstances.has(id)) unresolvedInstances.set(id, allocate('instance'))
    return unresolvedInstances.get(id)!
  }
  const externalSurface = (id: string) => {
    if (!componentSurface(project, id) && !project.rootIds.includes(id)) return id
    if (!unresolvedSurfaces.has(id)) unresolvedSurfaces.set(id, allocate('instance'))
    return unresolvedSurfaces.get(id)!
  }
  const rebindData = (original: ComponentInstance): JsonValue => {
    const key = componentDefinitionBuiltinKey(entry.definitions[original.definitionId])
    if (key === 'guoling.input') return remapComponentInputData(original.data, { fromInstanceId: original.id, toInstanceId: identities.instances.get(original.id)!, rules, stateKeys })
    if (key === 'guoling.navigation' && original.data && typeof original.data === 'object' && !Array.isArray(original.data) && Array.isArray(original.data.buttons)) {
      return { ...original.data, buttons: original.data.buttons.map(button => {
        if (!button || typeof button !== 'object' || Array.isArray(button) || !button.action || typeof button.action !== 'object' || Array.isArray(button.action)) return button
        const action = button.action
        const mappedAction = typeof action.containerId === 'string'
          ? { ...action, containerId: identities.surfaces.has(action.containerId) ? surfaceTarget(action.containerId) : externalSurface(action.containerId) } : action
        if (action.type !== 'scene.go' && action.type !== 'location.go') return { ...button, action: mappedAction }
        const field = action.type === 'scene.go' ? 'sceneId' : 'locationId', id = action[field]
        if (typeof id !== 'string') return button
        if (!identities.surfaces.has(id)) diagnostics.push({ code: 'surface-binding-required', message: `导航尚未绑定目标页面：${id}`, instanceId: original.id })
        return { ...button, action: { ...mappedAction, [field]: identities.surfaces.has(id) ? surfaceTarget(id) : externalSurface(id),
          ...(typeof action.targetStateId === 'string' ? { targetStateId: stateId(action.targetStateId) } : {}) } }
      }) }
    }
    return structuredClone(original.data)
  }
  const professionalCopy=createProfessionalDocumentIdentityCopy(identities.instances)
  for(const original of options.definitionsOnly ? [] : Object.values(entry.example.instances))professionalCopy(structuredClone(original.data),componentDefinitionBuiltinKey(entry.definitions[original.definitionId]),original.id,true)
  let destinationOwner = usage?.container ?? options.container
  while (destinationOwner.kind === 'instance' && !project.instances[destinationOwner.instanceId]?.container && !project.rootIds.includes(destinationOwner.instanceId)) {
    const parent = owningContainer(project, destinationOwner.instanceId)
    if (!parent) break
    destinationOwner = parent
  }
  const rootPlacement = options.placement === 'root' || options.placement !== 'local' && (entry.kind === 'page' || entry.kind === 'structure')
  const placementContainer = usage?.container ?? (rootPlacement ? { kind: 'project' as const } : options.container)
  let destinationRoot: string | undefined
  let currentOwnerId = placementContainer.kind === 'surface' ? placementContainer.surfaceId
    : placementContainer.kind === 'instance' ? placementContainer.instanceId : undefined
  while (currentOwnerId) {
    const owner = owningContainer(project, currentOwnerId)
    if (owner?.kind === 'project') { destinationRoot = currentOwnerId; break }
    currentOwnerId = owner?.kind === 'instance' ? owner.instanceId : undefined
  }
  const copyInstance = (original: ComponentInstance): ComponentInstance => {
    let instance: ComponentInstance = { ...structuredClone(original), data: rebindData(original), id: identities.instances.get(original.id)!, definitionId: identities.definitions.get(original.definitionId)! }
    if (original.stateBindings) instance.stateBindings = Object.fromEntries(Object.entries(original.stateBindings).map(([alias, key]) => [alias, stateKeys.get(key) ?? key]))
    if (!instance.definitionId) throw new Error(`库条目缺少定义：${original.definitionId}`)
    const key=componentDefinitionBuiltinKey(entry.definitions[original.definitionId])
    if(key)instance.data = rebindProfessionalAssets(instance.data, identities,key)
    instance.data=professionalCopy(instance.data,key,original.id)
    instance = rebindInteractionReferences(instance, entry.definitions[original.definitionId], id => {
      if (identities.instances.has(id) || options.targetBindings?.[id]) return instanceTarget(id)
      diagnostics.push({ code: 'target-binding-required', instanceId: instance.id, message: `互动尚未绑定目标对象：${id}` })
      return externalInstance(id)
    }, id => {
      if (identities.surfaces.has(id)) return surfaceTarget(id)
      diagnostics.push({ code: 'surface-binding-required', instanceId: instance.id, message: `互动尚未绑定目标页面：${id}` })
      return externalSurface(id)
    }, { rules, actions, stateKeys })
    if (key === 'guoling.interactions') {
      const data = componentInteractionDataSchema.parse(instance.data)
      for (const rule of data.rules) {
        if ('containerId' in rule.trigger && typeof rule.trigger.containerId === 'string') rule.trigger.containerId = identities.surfaces.has(rule.trigger.containerId) ? surfaceTarget(rule.trigger.containerId) : externalSurface(rule.trigger.containerId)
        if (rule.trigger.type === 'presentation.enter') rule.trigger.stateId = stateId(rule.trigger.stateId)
        for (const condition of rule.conditions) {
          if ('containerId' in condition && typeof condition.containerId === 'string') condition.containerId = identities.surfaces.has(condition.containerId) ? surfaceTarget(condition.containerId) : externalSurface(condition.containerId)
          if (condition.type === 'presentation.in') condition.stateIds = condition.stateIds.map(stateId)
        }
        for (const { action } of rule.actions) {
          if (action.type === 'presentation.set') action.stateId = stateId(action.stateId)
          if (action.type === 'scene.go' && action.targetStateId) action.targetStateId = stateId(action.targetStateId)
          if ('containerId' in action && typeof action.containerId === 'string') action.containerId = identities.surfaces.has(action.containerId) ? surfaceTarget(action.containerId) : externalSurface(action.containerId)
        }
      }
      instance.data = JSON.parse(JSON.stringify(data)) as JsonValue
    }
    instance = rebindWebAssets(instance, entry.definitions[original.definitionId], identities)
    const templateGlobal = (containers.length > 0 || entry.kind === 'page' || entry.kind === 'structure')
      && [...entry.global?.underlay ?? [], ...entry.global?.overlay ?? []].includes(original.id)
    if (original.visibility && !templateGlobal) instance.visibility = { ...original.visibility, surfaceIds: original.visibility.surfaceIds.map(id => {
      if (identities.surfaces.has(id)) return surfaceTarget(id)
      if (original.visibility!.mode !== 'all') diagnostics.push({ code: 'surface-binding-required', instanceId: instance.id,
        message: `可见范围尚未绑定目标页面：${id}` })
      return externalSurface(id)
    }) }
    // Template globals belong to the copied work roots, rather than becoming visible throughout the destination work.
    if (templateGlobal) {
      instance.visibility = placementContainer.kind === 'project'
        ? { mode: 'include', surfaceIds: entry.example.rootIds.filter(id => isComponentVisibleAtSurface(original, id)).map(instanceTarget) }
        : destinationRoot ? { mode: 'include', surfaceIds: entry.example.rootIds.some(id => isComponentVisibleAtSurface(original, id)) ? [destinationRoot] : [] } : undefined
    }
    const anchor = original.flowPlacement?.paragraphAnchor
    if (anchor) {
      if (identities.instances.has(anchor.blockId) || options.targetBindings?.[anchor.blockId]) {
        instance.flowPlacement = { ...original.flowPlacement!, paragraphAnchor: { ...anchor, blockId: instanceTarget(anchor.blockId) } }
      } else {
        diagnostics.push({ code: 'anchor-binding-required', instanceId: instance.id, message: `随段落对象尚未绑定目标段落：${anchor.blockId}` })
        instance.flowPlacement = { ...original.flowPlacement!, paragraphAnchor: { ...anchor, blockId: externalInstance(anchor.blockId) } }
      }
    }
    if (original.childIds) instance.childIds = original.childIds.map(id => {
      const mapped = identities.instances.get(id)
      if (!mapped) throw new Error(`库条目缺少子对象：${id}`)
      return mapped
    })
    if (original.container) {
      const container = structuredClone(original.container)
      const copyBackground = (background: typeof project.background) => background
        ? rebindComponentBackground(background, id => identities.assets.get(id) ?? id) : undefined
      if (container.background) container.background = copyBackground(container.background)
      if (container.presentation) {
        const presentation = container.presentation
        presentation.states = presentation.states.map(state => ({ ...state, background: copyBackground(state.background),
          overrides: Object.fromEntries(Object.entries(state.overrides).flatMap(([id, override]) => {
            const source = entry.example.instances[id]
            if (!source) { diagnostics.push({ code: 'target-binding-required', message: `展示状态目标未提炼：${id}` }); return [] }
            return [[instanceTarget(id), { ...override,
              ...(override.data === undefined ? {} : { data: copyInstance({ ...source, container: undefined, data: override.data }).data }),
              ...(override.authoring === undefined ? {} : { authoring: rebindAuthoringAssets(override.authoring, identities) }) }]]
          })), ...(state.order ? { order: state.order.map(instanceTarget) } : {}) }))
      }
      if (container.spatial) {
        const spatial = container.spatial, pathIds = new Map((spatial.paths ?? []).map(path => [path.id, allocate('instance')]))
        if (spatial.defaultPathId) spatial.defaultPathId = pathIds.get(spatial.defaultPathId)!
        spatial.frames = spatial.frames.map(frame => ({ ...frame, ...(frame.targetInstanceId ? { targetInstanceId: instanceTarget(frame.targetInstanceId) } : {}) }))
        spatial.paths = spatial.paths?.map(path => ({ ...path, id: pathIds.get(path.id)!,
          ...(path.instanceIds ? { instanceIds: path.instanceIds.map(instanceTarget) } : {}) }))
        spatial.relations = spatial.relations?.map(relation => ({ ...relation, id: allocate('instance'), sourceInstanceId: instanceTarget(relation.sourceInstanceId), targetInstanceId: instanceTarget(relation.targetInstanceId) }))
        spatial.semanticZoom = spatial.semanticZoom?.map(rule => ({ ...rule, id: allocate('instance'), instanceIds: rule.instanceIds.map(instanceTarget) }))
      }
      instance.container = container
    }
    if (original.implementationOverride) instance.implementationOverride = implementation(original.implementationOverride)
    if (original.attachments) instance.attachments = original.attachments.map(attachment => ({
      instanceId: instanceTarget(attachment.instanceId),
      target: attachment.target.kind === 'text-range' ? { ...attachment.target, instanceId: instanceTarget(attachment.target.instanceId), rangeId: professionalCopy.identity(attachment.target.rangeId), dataPath: professionalCopy.path(attachment.target.dataPath) } : attachment.target.kind === 'instance' ? { kind: 'instance', instanceId: instanceTarget(attachment.target.instanceId) }
        : attachment.target.kind === 'surface' ? (!identities.surfaces.has(attachment.target.surfaceId) && (entry.kind ?? 'objects') === 'objects' && componentDefinitionBuiltinKey(entry.definitions[original.definitionId]) === 'guoling.interactions'
          ? destinationOwner.kind === 'surface' ? { kind: 'surface', surfaceId: destinationOwner.surfaceId }
            : destinationOwner.kind === 'instance' ? { kind: 'instance', instanceId: destinationOwner.instanceId } : { kind: 'project' }
          : surfaceAttachmentTarget(attachment.target.surfaceId)) : { kind: 'project' },
    }))
    // Definition-specific source/data references remain under their real consumer's adapter.
    instance = options.adapters?.[original.definitionId]?.rebind(instance, identities) ?? instance
    for (const input of entry.inputs ?? []) if (input.instanceId === original.id && options.inputs && Object.hasOwn(options.inputs, input.role)) instance.data = setInput(instance.data, input.path, options.inputs[input.role])
    return instance
  }
  const instances: ComponentInstance[] = (options.definitionsOnly ? [] : Object.values(entry.example.instances)).map(copyInstance)
  const rootIds = (options.definitionsOnly ? [] : entry.example.rootIds).map(id => {
    const mapped = identities.instances.get(id)
    if (!mapped) throw new Error(`库条目缺少根对象：${id}`)
    return mapped
  })
  if (!options.definitionsOnly) {
    const globalRoots = new Set([...(entry.global?.underlay ?? []), ...(entry.global?.overlay ?? [])].map(instanceTarget))
    const localRoots = rootIds.filter(id => !globalRoots.has(id))
    const container = structuredClone(placementContainer)
    const index = usage?.index ?? (container.kind === 'project'
      ? options.surfaceIndex ?? (options.container.kind === 'surface' ? Math.max(0, project.rootIds.indexOf(options.container.surfaceId) + 1) : project.rootIds.length)
      : options.index)
    if (usage?.background) for (const instance of instances) if (localRoots.includes(instance.id)) {
      instance.style = { ...instance.style, pointerEvents: 'none' }
      if (usage.flowBackground) instance.flowPlacement = { space: 'paper', plane: entry.usage?.placement === 'overlay' ? 'overlay' : 'underlay' }
    }
    let remaining = instances
    if (localRoots.length || !globalRoots.size && instances.length) {
      edits.push({ type: 'instance.insert', container, index, instances: remaining, rootIds: localRoots })
      remaining = []
      if (container.kind === 'project' && !project.entry && !project.rootIds.length && localRoots[0]) {
        edits.push({ type: 'project.entry.set', entry: { rootInstanceId: localRoots[0] } })
      }
    }
    for (const plane of ['underlay', 'overlay'] as const) if (entry.global?.[plane].length) {
      edits.push({ type: 'instance.insert', container: { kind: 'global', plane }, index: project.global[plane].length,
        instances: remaining, rootIds: entry.global[plane].map(instanceTarget) })
      remaining = []
    }
  }
  if (!options.definitionsOnly && entry.logic) {
    const logic = structuredClone(project.logic ?? { courseState: [], navigationGuards: [] })
    logic.courseState.push(...entry.logic.courseState.map(declaration => ({ ...declaration, key: stateKeys.get(declaration.key)! })))
    for (const guard of entry.logic.navigationGuards) {
      if (!guard.toSurfaceIds.every(id => identities.surfaces.has(id)) || guard.fromSurfaceIds?.some(id => !identities.surfaces.has(id))) {
        diagnostics.push({ code: 'surface-binding-required', message: `导航条件“${guard.message}”包含未绑定页面，未将其指向目标工程同名页面。` }); continue
      }
      logic.navigationGuards.push({ ...guard, id: allocate('instance'), toSurfaceIds: guard.toSurfaceIds.map(surfaceTarget),
        ...(guard.fromSurfaceIds ? { fromSurfaceIds: guard.fromSurfaceIds.map(surfaceTarget) } : {}),
        conditions: guard.conditions.map(condition => ({ ...condition, key: stateKeys.get(condition.key) ?? condition.key })) })
    }
    if (entry.logic.network?.connectOrigins?.length) logic.network = { connectOrigins: [...new Set([...(logic.network?.connectOrigins ?? []), ...entry.logic.network.connectOrigins])] }
    edits.push({ type: 'project.logic.set', logic })
  }
  return { command: captureComponentOperation(project, edits), rootIds, identities, diagnostics }
}

/** Await the host's existing Session dispatch receipt; constructing a batch is not a commit. */
export async function insertComponentLibraryEntry<Receipt>(project: CourseProjectV10, entry: ComponentLibraryEntry,
  options: InsertLibraryOptions, dispatch: (command: ComponentOperationBatch) => Receipt | Promise<Receipt>): Promise<{ insertion: LibraryInsertion; receipt: Receipt }> {
  const insertion = prepareComponentLibraryInsertion(project, entry, options)
  return { insertion, receipt: await dispatch(insertion.command) }
}
