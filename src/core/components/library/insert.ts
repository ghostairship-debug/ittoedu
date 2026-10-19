import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentEdit, ComponentOperationBatch } from '../../../shared/contracts/component-platform/operations'
import type { ComponentContainer, ComponentImplementation, ComponentInstance, CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform/project'
import { componentDefinitionBuiltinKey, isComponentVisibleAtSurface, owningContainer } from '../../../shared/contracts/component-platform/project'
import { captureComponentOperation, equalComponentValue } from '../../drivers/courseV10Operations'
import { authoringAssetIds, componentAssetIds, rebindAuthoringAssets, rebindInteractionReferences, rebindProfessionalAssets, rebindWebAssets, sourceAssetIds, sourceModuleBindings } from './references'
import type { LibraryDiagnostic, LibraryIdentityMap, LibraryInputValues, LibraryReferenceAdapter } from './types'
import { rebindComponentLibraryImplementation } from './rebindSource'
import { createProfessionalDocumentIdentityCopy } from './professionalCopy'
import { extractComponentLibraryEntry } from './extract'
import { componentInteractionDataSchema, createComponentInteractionCopyIdentities } from '../../../shared/componentInteractionData'
import { remapComponentInputData } from '../../../components/input/authoring'
import { componentBackgroundAssetIds, rebindComponentBackground } from '../../../shared/componentBackgroundPaint'

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
export function prepareComponentLibraryInsertion(project: CourseProjectV10, entry: ComponentLibraryEntry, options: InsertLibraryOptions): LibraryInsertion {
  if (options.rootIds) {
    const source: CourseProjectV10 = { schemaVersion: 10, id: entry.id, title: entry.title, revision: 0, definitions: entry.definitions,
      instances: entry.example.instances, assets: entry.assets, surfaces: entry.surfaces ?? [{ id: 'library', kind: 'slide', title: entry.title, childIds: entry.example.rootIds }],
      global: entry.global ?? { underlay: [], overlay: [] }, ...(entry.logic ? { logic: entry.logic } : {}) }
    entry = extractComponentLibraryEntry(source, entry.resources, { id: entry.id, title: entry.title, rootIds: [...options.rootIds], adapters: options.adapters }).entry
  }
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
  if (!options.definitionsOnly) for (const surface of entry.surfaces ?? []) {
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
  const occupied = new Set([...Object.keys(project.instances), ...Object.keys(project.definitions), ...Object.keys(project.assets), ...project.surfaces.map(surface => surface.id),
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
      return [id, !Object.hasOwn(project.definitions,id) || !ownsReboundReferences
        && equalComponentValue(project.definitions[id], comparable) ? id : allocate('definition')]
    }) as [string,string][],...missingDependencies.map(id=>[id,allocate('definition')] as [string,string])]),
    assets: new Map([...assetIds].map(id => [id, allocate('asset')])),
    components: new Map(Object.keys(entry.resources.components).map(id => [id, allocate('component')])),
    surfaces: new Map([...Object.entries(options.surfaceBindings ?? {}), ...(options.definitionsOnly ? [] : entry.surfaces ?? []).map(surface => [surface.id, allocate('instance')] as [string, string])]),
  }
  const stateIds = new Map((entry.surfaces ?? []).flatMap(surface => [...surface.presentation?.states ?? [], ...surface.spatial?.frames ?? []]).map(state => [state.id, allocate('instance')]))
  const stateId = (id: string) => stateIds.get(id) ?? id
  const rules = new Map<string, string>(), actions = new Map<string, string>(), stateKeys = new Map<string, string>()
  const collectRules = (data: JsonValue) => {
    const copy = createComponentInteractionCopyIdentities(data)
    for (const [id, next] of copy.rules) if (!rules.has(id)) rules.set(id, next)
    for (const [id, next] of copy.actions) if (!actions.has(id)) actions.set(id, next)
  }
  for (const original of Object.values(entry.example.instances)) if (componentDefinitionBuiltinKey(entry.definitions[original.definitionId]) === 'guoling.interactions') {
    collectRules(original.data)
    for (const surface of entry.surfaces ?? []) for (const state of surface.presentation?.states ?? []) if (state.overrides[original.id]?.data !== undefined) collectRules(state.overrides[original.id]!.data!)
  }
  // Managed inputs allocate their own scalar identities before other components consume the map.
  for (const original of Object.values(entry.example.instances)) if (componentDefinitionBuiltinKey(entry.definitions[original.definitionId]) === 'guoling.input') {
    const inputCopy = { fromInstanceId: original.id, toInstanceId: identities.instances.get(original.id)!, rules, stateKeys }
    remapComponentInputData(original.data, inputCopy)
    for (const surface of entry.surfaces ?? []) for (const state of surface.presentation?.states ?? []) if (state.overrides[original.id]?.data !== undefined)
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
  const edits: ComponentEdit[] = []
  for (const [ownerId, files] of Object.entries(entry.resources.components)) edits.push({
    type: 'component.files.set', ownerId: identities.components.get(ownerId)!, expectedFiles: null,
    files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)])),
  })
  for (const original of Object.values(entry.definitions)) {
    const definition = { ...structuredClone(original), id: identities.definitions.get(original.id)!, implementation: implementation(original.implementation),
      ...(primaryDefinitionId===original.id ? {library:libraryIdentity(original)}:{}) }
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
    if (!mapped || !entry.surfaces?.some(surface => surface.id === id) && !project.surfaces.some(surface => surface.id === mapped)) throw new Error(`请绑定实际表面目标：${id}`)
    return mapped
  }
  const unresolvedInstances = new Map<string, string>(), unresolvedSurfaces = new Map<string, string>()
  const externalInstance = (id: string) => {
    if (!project.instances[id]) return id
    if (!unresolvedInstances.has(id)) unresolvedInstances.set(id, allocate('instance'))
    return unresolvedInstances.get(id)!
  }
  const externalSurface = (id: string) => {
    if (!project.surfaces.some(surface => surface.id === id)) return id
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
        if (action.type !== 'scene.go' && action.type !== 'location.go') return button
        const field = action.type === 'scene.go' ? 'sceneId' : 'locationId', id = action[field]
        if (typeof id !== 'string') return button
        if (!identities.surfaces.has(id)) diagnostics.push({ code: 'surface-binding-required', message: `导航尚未绑定目标页面：${id}`, instanceId: original.id })
        return { ...button, action: { ...action, [field]: identities.surfaces.has(id) ? surfaceTarget(id) : externalSurface(id),
          ...(typeof action.targetStateId === 'string' ? { targetStateId: stateId(action.targetStateId) } : {}) } }
      }) }
    }
    return structuredClone(original.data)
  }
  const professionalCopy=createProfessionalDocumentIdentityCopy(identities.instances)
  for(const original of options.definitionsOnly ? [] : Object.values(entry.example.instances))professionalCopy(structuredClone(original.data),componentDefinitionBuiltinKey(entry.definitions[original.definitionId]),original.id,true)
  let destinationOwner = options.container
  while (destinationOwner.kind === 'instance') {
    const parent = owningContainer(project, destinationOwner.instanceId)
    if (!parent) break
    destinationOwner = parent
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
        if (rule.trigger.type === 'presentation.enter') rule.trigger.stateId = stateId(rule.trigger.stateId)
        for (const condition of rule.conditions) if (condition.type === 'presentation.in') condition.stateIds = condition.stateIds.map(stateId)
        for (const { action } of rule.actions) {
          if (action.type === 'presentation.set') action.stateId = stateId(action.stateId)
          if (action.type === 'scene.go' && action.targetStateId) action.targetStateId = stateId(action.targetStateId)
        }
      }
      instance.data = JSON.parse(JSON.stringify(data)) as JsonValue
    }
    instance = rebindWebAssets(instance, entry.definitions[original.definitionId], identities)
    if (original.visibility) instance.visibility = { ...original.visibility, surfaceIds: original.visibility.surfaceIds.map(id => {
      if (identities.surfaces.has(id)) return surfaceTarget(id)
      if (original.visibility!.mode !== 'all') diagnostics.push({ code: 'surface-binding-required', instanceId: instance.id,
        message: `可见范围尚未绑定目标页面：${id}` })
      return externalSurface(id)
    }) }
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
    if (original.implementationOverride) instance.implementationOverride = implementation(original.implementationOverride)
    if (original.attachments) instance.attachments = original.attachments.map(attachment => ({
      instanceId: instanceTarget(attachment.instanceId),
      target: attachment.target.kind === 'text-range' ? { ...attachment.target, instanceId: instanceTarget(attachment.target.instanceId), rangeId: professionalCopy.identity(attachment.target.rangeId), dataPath: professionalCopy.path(attachment.target.dataPath) } : attachment.target.kind === 'instance' ? { kind: 'instance', instanceId: instanceTarget(attachment.target.instanceId) }
        : attachment.target.kind === 'surface' ? (!entry.surfaces?.length && componentDefinitionBuiltinKey(entry.definitions[original.definitionId]) === 'guoling.interactions'
          ? destinationOwner.kind === 'surface' ? { kind: 'surface', surfaceId: destinationOwner.surfaceId } : { kind: 'project' }
          : { kind: 'surface', surfaceId: surfaceTarget(attachment.target.surfaceId) }) : { kind: 'project' },
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
  if (!options.definitionsOnly && entry.surfaces?.length) {
    const copyBackground = (background: typeof project.background) => background
      ? rebindComponentBackground(background, id => identities.assets.get(id) ?? id) : undefined
    const destinationSurfaceId = options.container.kind === 'surface' ? options.container.surfaceId : undefined
    let surfaceIndex = options.surfaceIndex ?? (destinationSurfaceId
      ? project.surfaces.findIndex(surface => surface.id === destinationSurfaceId) + 1 : project.surfaces.length)
    const scopedRoots = new Set((entry.global?.underlay ?? []).concat(entry.global?.overlay ?? []))
    let remainingInstances = instances
    const insert = (container: ComponentContainer, index: number, originalRoots: string[]) => {
      if (!originalRoots.length && !remainingInstances.length) return
      edits.push({ type: 'instance.insert', container, index, instances: remainingInstances, rootIds: originalRoots.map(instanceTarget) })
      remainingInstances = []
    }
    for (const original of entry.surfaces) {
      const surface = { ...structuredClone(original), id: surfaceTarget(original.id), childIds: [], background: copyBackground(original.background) }
      if (surface.presentation) {
        surface.presentation.initialStateId = surface.presentation.initialStateId ? stateId(surface.presentation.initialStateId) : surface.presentation.initialStateId
        surface.presentation.thumbnailStateId = surface.presentation.thumbnailStateId ? stateId(surface.presentation.thumbnailStateId) : surface.presentation.thumbnailStateId
        surface.presentation.states = surface.presentation.states.map(state => ({ ...state, id: stateId(state.id), background: copyBackground(state.background),
          overrides: Object.fromEntries(Object.entries(state.overrides).map(([id, override]) => {
            const source = entry.example.instances[id]
            if (!source) { diagnostics.push({ code: 'target-binding-required', message: `展示状态目标未提炼：${id}` }); return [] }
            return [instanceTarget(id), { ...override, ...(override.data === undefined ? {} : { data: copyInstance({ ...source, data: override.data }).data }),
              ...(override.authoring === undefined ? {} : { authoring: rebindAuthoringAssets(override.authoring, identities) }) }]
          }).filter(value => value.length)), ...(state.order ? { order: state.order.map(instanceTarget) } : {}) }))
      }
      if (surface.spatial) {
        const spatial = surface.spatial, pathIds = new Map((spatial.paths ?? []).map(path => [path.id, allocate('instance')]))
        if (spatial.defaultPathId) spatial.defaultPathId = pathIds.get(spatial.defaultPathId)!
        spatial.frames = spatial.frames.map(frame => ({ ...frame, id: stateId(frame.id), ...(frame.targetInstanceId ? { targetInstanceId: instanceTarget(frame.targetInstanceId) } : {}) }))
        spatial.paths = spatial.paths?.map(path => ({ ...path, id: pathIds.get(path.id)!, frameIds: path.frameIds.map(stateId), ...(path.instanceIds ? { instanceIds: path.instanceIds.map(instanceTarget) } : {}) }))
        spatial.relations = spatial.relations?.map(relation => ({ ...relation, id: allocate('instance'), sourceInstanceId: instanceTarget(relation.sourceInstanceId), targetInstanceId: instanceTarget(relation.targetInstanceId) }))
        spatial.semanticZoom = spatial.semanticZoom?.map(rule => ({ ...rule, id: allocate('instance'), instanceIds: rule.instanceIds.map(instanceTarget) }))
      }
      edits.push({ type: 'surface.insert', surface, index: surfaceIndex++ })
      original.childIds.forEach(id => scopedRoots.add(id))
      insert({ kind: 'surface', surfaceId: surface.id }, 0, original.childIds)
    }
    for (const plane of ['underlay', 'overlay'] as const) {
      const roots = entry.global?.[plane] ?? []
      for (const id of roots) {
        const instance = instances.find(value => value.id === instanceTarget(id))
        if (instance) instance.visibility = { mode: 'include', surfaceIds: entry.surfaces
          .filter(surface => isComponentVisibleAtSurface({ ...entry.example.instances[id], visible: true }, surface.id)).map(surface => surfaceTarget(surface.id)) }
      }
      insert({ kind: 'global', plane }, project.global[plane].length, roots)
    }
    const extra = entry.example.rootIds.filter(id => !scopedRoots.has(id))
    insert({ kind: 'surface', surfaceId: surfaceTarget(entry.surfaces[0].id) }, entry.surfaces[0].childIds.length, extra)
  } else if (!options.definitionsOnly) {
    const globalRoots = new Set([...(entry.global?.underlay ?? []), ...(entry.global?.overlay ?? [])].map(instanceTarget))
    const localRoots = rootIds.filter(id => !globalRoots.has(id))
    let remaining = instances
    if (localRoots.length || !globalRoots.size) {
      edits.push({ type: 'instance.insert', container: structuredClone(options.container), index: options.index, instances: remaining, rootIds: localRoots })
      remaining = []
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
