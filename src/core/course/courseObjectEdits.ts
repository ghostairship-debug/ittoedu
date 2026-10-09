import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, containerChildIds, owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentDefinition, type ComponentPresentation, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import type { DocumentResources } from '../../shared/workbench/document'
import { translateFrame, reparentFrame, composeMatrices, IDENTITY_MATRIX, type AffineMatrix } from '../components/geometry'
import { extractComponentLibraryEntry } from '../components/library'
import { rebindComponentLibraryImplementation } from '../components/library/rebindSource'
import { componentAssetIds, rebindDeclaredTargets, rebindProfessionalAssets, rebindWebAssets, sourceAssetIds, sourceModuleBindings } from '../components/library/references'
import type { LibraryDiagnostic } from '../components/library/types'
import { componentRuleEdits, createComponentInteractionCopyIdentities, interactionBehavior, interactionRules, remapComponentInteractionData } from '../../shared/componentInteractionData'
import { remapComponentInputData } from '../../components/input/authoring'
import { inputDataSchema } from '../../components/input/data'
import type { InteractionRule } from '../../shared/interactionTypes'
import { componentParentMatrix, equalComponentValue } from '../drivers/courseV10Operations'
import { globalVisibilityAtSurface } from './courseSemanticEdits'
import { courseSurfaceReference, prepareCourseVisibility, type CourseAuthoringReferences } from './courseAuthoringReferences'

export function courseObjectRemovalEdits(project: CourseProjectV10, ids: readonly string[]): ComponentEdit[] {
  const roots = selectedRoots(project, ids)
  if (roots.some(id => componentIsLocked(project, id))) throw new Error('锁定元素不能删除，请先解锁')
  return roots.map(instanceId => ({ type: 'instance.remove', instanceId }))
}

/** A displayed subset reorders only its members, retaining behavior/other-plane siblings. */
export function courseObjectOrderEdits(project: CourseProjectV10, ids: readonly string[]): ComponentEdit[] {
  if (!ids.length) return []
  const owner = owningContainer(project, ids[0])
  if (!owner || ids.some(id => !sameContainer(owningContainer(project, id), owner))) throw new Error('只能在同一归属内调整层级')
  const original = containerChildIds(project, owner), unique = new Set(ids)
  if (unique.size !== ids.length || ids.some(id => !original.includes(id))) throw new Error('图层列表已变化')
  let nextIndex = 0
  const ordered = original.map(id => unique.has(id) ? ids[nextIndex++]! : id), working = [...original], edits: ComponentEdit[] = []
  ordered.forEach((instanceId, index) => {
    const previous = working.indexOf(instanceId)
    if (previous === index) return
    edits.push({ type: 'instance.move', instanceId, container: owner, index })
    working.splice(previous, 1); working.splice(index, 0, instanceId)
  })
  return edits
}

export function courseObjectOrder(project: CourseProjectV10, id: string, move: 'front' | 'back' | 'forward' | 'backward'): string[] | null {
  if (componentIsLocked(project, id)) return null
  const owner = owningContainer(project, id)
  if (!owner) return null
  const ids = [...containerChildIds(project, owner)], index = ids.indexOf(id)
  const next = move === 'front' ? ids.length - 1 : move === 'back' ? 0 : index + (move === 'forward' ? 1 : -1)
  if (index < 0 || next < 0 || next >= ids.length || next === index) return null
  ids.splice(index, 1); ids.splice(next, 0, id)
  return ids
}

export function courseObjectMoveEdits(project: CourseProjectV10, instanceId: string, container: ComponentContainer, index: number): ComponentEdit[] {
  const item = project.instances[instanceId]
  if (!item) throw new Error('目标图层已不存在')
  if (componentIsLocked(project, instanceId)) throw new Error('对象已锁定')
  const owner = owningContainer(project, instanceId)
  if (sameContainer(owner, container)) return [{ type: 'instance.move', instanceId, container, index }]
  const parentMatrix = (view: CourseProjectV10) => container.kind === 'instance' ? composeMatrices(componentParentMatrix(view, container.instanceId),
    view.instances[container.instanceId]?.frame?.transform ?? IDENTITY_MATRIX) : IDENTITY_MATRIX
  const frame = item.frame ? reparentFrame(item.frame, componentParentMatrix(project, instanceId), parentMatrix(project)) as ComponentFrame : undefined
  const edits: ComponentEdit[] = [{ type: 'instance.move', instanceId, container, index, ...(frame ? { frame } : {}) }]
  let root = owner
  while (root?.kind === 'instance') root = owningContainer(project, root.instanceId)
  const surface = root?.kind === 'surface' ? project.surfaces.find(value => value.id === root.surfaceId) : undefined
  if (surface?.presentation) {
    const presentation = structuredClone(surface.presentation)
    for (const state of presentation.states) {
      const view = resolveComponentPresentation(project, surface.id, state.id), current = view.instances[instanceId].frame
      if (!current) continue
      const next = reparentFrame(current, componentParentMatrix(view, instanceId), parentMatrix(view)) as ComponentFrame
      if (state.overrides[instanceId]?.frame !== undefined || !equalComponentValue(next, frame))
        (state.overrides[instanceId] ??= {}).frame = next
    }
    if (!equalComponentValue(presentation, surface.presentation)) edits.push({ type: 'surface.presentation.set', surfaceId: surface.id, presentation })
  }
  return edits
}

export function courseGlobalPlacementEdits(project: CourseProjectV10, instanceId: string, input: {
  plane?: 'underlay' | 'overlay'; visibility?: NonNullable<CourseProjectV10['instances'][string]['visibility']>;
  atSurface?: { surfaceId: string; visible: boolean }
}, references?: CourseAuthoringReferences): ComponentEdit[] {
  const instance = project.instances[instanceId]
  if (!instance) throw new Error('全局对象已不存在')
  let owner = owningContainer(project, instanceId)
  while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
  if (owner?.kind !== 'global') throw new Error('全局设置需要已在全局层的对象')
  const edits: ComponentEdit[] = []
  if (input.plane) edits.push(...courseObjectMoveEdits(project, instanceId, { kind: 'global', plane: input.plane },
    project.global[input.plane].filter(id => id !== instanceId).length))
  const visibility = input.atSurface ? globalVisibilityAtSurface(instance.visibility ?? { mode: 'all', surfaceIds: [] },
    courseSurfaceReference(project, input.atSurface.surfaceId, references), input.atSurface.visible) : input.visibility ? prepareCourseVisibility(project, input.visibility, references) : undefined
  if (visibility) edits.push({ type: 'instance.patch', instanceId, patch: { visibility } })
  return edits
}

export interface CourseObjectTarget { documentId: string; project: CourseProjectV10; resources: DocumentResources; surfaceId: string | null }
export function sameContainer(left: ComponentContainer | null, right: ComponentContainer | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function selectedRoots(project: CourseProjectV10, ids: readonly string[]): string[] {
  const selected = new Set(ids)
  return [...new Set(ids)].filter(id => {
    if (!project.instances[id]) return false
    let owner = owningContainer(project, id)
    while (owner?.kind === 'instance') {
      if (selected.has(owner.instanceId)) return false
      owner = owningContainer(project, owner.instanceId)
    }
    return true
  })
}
export function courseObjectDescendants(project: CourseProjectV10, roots: readonly string[], includeAttachments = true): string[] {
  const found = new Set<string>()
  const visit = (id: string) => {
    if (found.has(id) || !project.instances[id]) return
    found.add(id)
    for (const child of project.instances[id].childIds ?? []) visit(child)
    if (includeAttachments) for (const attachment of project.instances[id].attachments ?? []) visit(attachment.instanceId)
  }
  roots.forEach(visit)
  return [...found]
}
export interface CourseObjectClipboardSource {
  /** Software document identity; absent clipboard contexts receive imported resource identities. */
  documentId?: string
  project: CourseProjectV10
  roots: readonly string[]
  resources: DocumentResources
  matrices?: Record<string, AffineMatrix>
}
export interface CourseObjectPasteDestination {
  capturedTarget: CourseObjectTarget
  container: ComponentContainer
  index: number
  /** Existing same-editor cut token owns this decision; a move restores the formal IDs. */
  identity?: 'copy' | 'move'
  /** Canvas duplicate/paste explicitly requests its offset; document paste keeps layout. */
  offset?: { x: number; y: number }
  keepOwner?: boolean
}
export interface CourseObjectPastePlan {
  edits: ComponentEdit[]
  idMap: ReadonlyMap<string, string>
  assetIds: ReadonlyMap<string, string>
  rootIds: string[]
  diagnostics: LibraryDiagnostic[]
}
/** Derives one canonical clone batch; callers combine it with their own document edits. */
export function prepareCourseObjectPaste(source: CourseObjectClipboardSource, destination: CourseObjectPasteDestination): CourseObjectPastePlan {
  if (!source.roots.length) throw new Error('请先复制对象')
  const target = destination.capturedTarget, project = target.project
  const moving = destination.identity === 'move'
  const sameDocument = Boolean(source.documentId && source.documentId === target.documentId)
  const professionalKey = (id: string) => componentDefinitionBuiltinKey(source.project.definitions[source.project.instances[id].definitionId])
  const stateData = (id: string) => source.project.surfaces.flatMap(surface => (surface.presentation?.states ?? [])
    .flatMap(state => state.overrides[id]?.data === undefined ? [] : [state.overrides[id].data!]))
  const topOwner = (value: CourseProjectV10, owner: ComponentContainer | null): ComponentContainer | null => {
    while (owner?.kind === 'instance') owner = owningContainer(value, owner.instanceId)
    return owner
  }
  const behaviorIds = Object.keys(source.project.instances).filter(id => professionalKey(id) === 'guoling.interactions')
  const rulesAt = (id: string, data = source.project.instances[id].data) => interactionRules({ ...source.project.instances[id], data })
  const copied = new Set(courseObjectDescendants(source.project, source.roots)), copyRoots = [...source.roots]
  const familyIds = new Set<string>()
  // The managed input's local feedback is part of its semantic copy, even when
  // the feedback nodes are siblings instead of children of the input instance.
  let expanded = !(moving && sameDocument)
  while (expanded) {
    expanded = false
    const owners = new Map<string, ComponentContainer[]>()
    for (const id of copied) if (professionalKey(id) === 'guoling.input') {
      const owner = topOwner(source.project, owningContainer(source.project, id))
      for (const data of [source.project.instances[id].data, ...stateData(id)]) for (const ruleId of inputDataSchema.parse(data).answer?.ruleFamilyRuleIds ?? []) {
        familyIds.add(ruleId)
        if (owner) owners.set(ruleId, [...owners.get(ruleId) ?? [], owner])
      }
    }
    for (const id of behaviorIds) for (const data of [source.project.instances[id].data, ...stateData(id)]) for (const rule of rulesAt(id, data)) {
      const familyOwners = owners.get(rule.id)
      if (!familyOwners) continue
      for (const step of rule.actions) if (step.action.type === 'node.enter' || step.action.type === 'node.exit') {
        const feedbackId = step.action.nodeId, owner = topOwner(source.project, owningContainer(source.project, feedbackId))
        if (!owner || !(owner.kind === 'global' || familyOwners.some(value => sameContainer(owner, value))) || copied.has(feedbackId)) continue
        copyRoots.push(feedbackId)
        courseObjectDescendants(source.project, [feedbackId]).forEach(value => copied.add(value)); expanded = true
      }
    }
  }
  const copiedIds = [...copied], idMap = new Map(copiedIds.map(id => [id, moving ? id : crypto.randomUUID()]))
  // The library's existing extractor owns source-module/resource closure, including
  // private implementation workspaces. Clipboard does not infer bindings from code.
  const extracted = extractComponentLibraryEntry(source.project, source.resources, {
    id: `clipboard_${crypto.randomUUID()}`, title: '复制对象', rootIds: selectedRoots(source.project, copyRoots),
  })
  const entry = extracted.entry, diagnostics = extracted.diagnostics.filter(item => item.code === 'missing-asset')
  const components: DocumentResources['components'] = entry.resources.components
  const componentIds = new Map(Object.keys(components).map(ownerId => [ownerId, moving && sameDocument ? ownerId : `component_${crypto.randomUUID()}`]))
  const mapId = (id: string) => idMap.get(id) ?? id
  const surfaceIds = new Map<string, string>()
  const destinationOwner = topOwner(project, destination.container)
  const destinationSurfaceId = destinationOwner?.kind === 'surface' ? destinationOwner.surfaceId : target.surfaceId
  if (!sameDocument && destinationSurfaceId) for (const id of copiedIds) {
    const owner = topOwner(source.project, owningContainer(source.project, id))
    if (owner?.kind === 'surface') surfaceIds.set(owner.surfaceId, destinationSurfaceId)
  }
  const mapSurfaceId = (id: string) => surfaceIds.get(id) ?? id
  const rules = new Map<string, string>(), actions = new Map<string, string>(), stateKeys = new Map<string, string>()
  for (const id of copiedIds) if (professionalKey(id) === 'guoling.interactions') {
    for (const data of [source.project.instances[id].data, ...stateData(id)]) {
      const copy = createComponentInteractionCopyIdentities(data)
      copy.rules.forEach((value, key) => { if (!rules.has(key)) rules.set(key, moving ? key : value) })
      copy.actions.forEach((value, key) => { if (!actions.has(key)) actions.set(key, moving ? key : value) })
    }
  }
  // Ordinary object triggers and their completion chain have the same copy owner
  // as managed families. Other author rules on the shared behavior remain untouched.
  const selectRules = (values: readonly InteractionRule[]) => {
    const selected = new Set(values.filter(rule => familyIds.has(rule.id) || 'nodeId' in rule.trigger && copied.has(rule.trigger.nodeId)).map(rule => rule.id))
    let added = true
    while (added) {
      added = false
      const selectedActions = new Set(values.filter(rule => selected.has(rule.id)).flatMap(rule => rule.actions.map(step => step.id)))
      for (const rule of values) if (!selected.has(rule.id) && rule.trigger.type === 'animation.completed' && selectedActions.has(rule.trigger.actionId)) { selected.add(rule.id); added = true }
    }
    return values.filter(rule => selected.has(rule.id))
  }
  const externalBehaviors = moving && sameDocument ? [] : behaviorIds.filter(id => !copied.has(id)
    && [source.project.instances[id].data, ...stateData(id)].some(data => selectRules(rulesAt(id, data)).length))
  const family = externalBehaviors.flatMap(id => selectRules(rulesAt(id)))
  const familyData = JSON.parse(JSON.stringify({ rules: family })) as JsonValue
  for (const id of externalBehaviors) for (const data of [source.project.instances[id].data, ...stateData(id)]) {
    const copy = createComponentInteractionCopyIdentities({ rules: selectRules(rulesAt(id, data)) } as unknown as JsonValue)
    copy.rules.forEach((value, key) => { if (!rules.has(key)) rules.set(key, moving ? key : value) })
    copy.actions.forEach((value, key) => { if (!actions.has(key)) actions.set(key, moving ? key : value) })
  }
  const inputData = new Map<string, JsonValue>()
  for (const id of copiedIds) if (professionalKey(id) === 'guoling.input') inputData.set(id, remapComponentInputData(source.project.instances[id].data,
    { fromInstanceId: id, toInstanceId: mapId(id), rules, stateKeys }))
  for (const id of copiedIds) if (professionalKey(id) === 'guoling.input') for (const data of stateData(id))
    remapComponentInputData(data, { fromInstanceId: id, toInstanceId: mapId(id), rules, stateKeys })
  // As in page copy, references outside the copied graph remain explicit external targets.
  // Only declared identities are rebound; prose and arbitrary component strings stay authored.
  const rewrite = (value: JsonValue) => rebindDeclaredTargets(value, mapId, mapSurfaceId)
  const instances = copiedIds.map(id => {
    const item = structuredClone(source.project.instances[id])
    return { ...item, id: mapId(id), data: professionalKey(id) === 'guoling.interactions'
      ? remapComponentInteractionData(item.data, { instances: idMap, surfaces: surfaceIds, rules, actions, stateKeys })
      : inputData.get(id) ?? rewrite(item.data),
      ...(item.visibility ? { visibility: { ...item.visibility, surfaceIds: item.visibility.surfaceIds.map(mapSurfaceId) } } : {}),
      ...(item.flowPlacement?.paragraphAnchor ? { flowPlacement: { ...item.flowPlacement, paragraphAnchor: {
        ...item.flowPlacement.paragraphAnchor, blockId: mapId(item.flowPlacement.paragraphAnchor.blockId),
      } } } : {}),
      ...(item.style ? { style: rewrite(item.style) as typeof item.style } : {}),
      ...(item.childIds ? { childIds: item.childIds.map(mapId) } : {}),
      ...(item.attachments ? { attachments: item.attachments.map(attachment => ({ ...attachment,
        instanceId: mapId(attachment.instanceId), target: attachment.target.kind === 'instance' ? { kind: 'instance' as const, instanceId: mapId(attachment.target.instanceId) }
          : attachment.target.kind === 'surface' ? { kind: 'surface' as const, surfaceId: mapSurfaceId(attachment.target.surfaceId) } : attachment.target })) } : {}) }
  })
  const edits: ComponentEdit[] = []
  if (stateKeys.size) {
    const logic = structuredClone(project.logic ?? { courseState: [], navigationGuards: [] })
    for (const [from, to] of stateKeys) {
      const declaration = source.project.logic?.courseState.find(value => value.key === from)
      if (declaration && !logic.courseState.some(value => value.key === to)) logic.courseState.push({ ...declaration, key: to })
    }
    if (logic.courseState.length !== (project.logic?.courseState.length ?? 0)) edits.push({ type: 'project.logic.set', logic })
  }
  const defMap = new Map<string, string>()
  const definitions = Object.values(entry.definitions), assets = entry.assets
  const referencedAssets = new Set(Object.keys(assets))
  for (const instance of Object.values(entry.example.instances)) {
    for (const id of componentAssetIds(instance, entry.definitions[instance.definitionId])) referencedAssets.add(id)
  }
  for (const id of copiedIds) for (const data of stateData(id)) {
    const instance = source.project.instances[id]
    for (const assetId of componentAssetIds({ ...instance, data }, source.project.definitions[instance.definitionId])) {
      referencedAssets.add(assetId)
      if (source.project.assets[assetId]) assets[assetId] = structuredClone(source.project.assets[assetId])
    }
  }
  for (const definition of definitions) for (const id of sourceAssetIds(definition.implementation)) referencedAssets.add(id)
  const assetIds = new Map([...referencedAssets].map(id => [id, sameDocument ? id : `asset_${crypto.randomUUID()}`]))
  for (const original of definitions) {
    const implementation = original.implementation
    // Match the library insertion's ownership rule: rebinding a shared source
    // definition must not change the destination's existing instances.
    const ownsReboundReferences = implementation.kind === 'source' && (implementation.workspace
      || Object.keys(sourceModuleBindings(implementation)).length > 0 || referencedAssets.size > 0)
    const collision = !(moving && sameDocument) && project.definitions[original.id] && (ownsReboundReferences || JSON.stringify(project.definitions[original.id]) !== JSON.stringify(original))
    defMap.set(original.id, collision ? crypto.randomUUID() : original.id)
  }
  const identities = { instances: idMap, definitions: defMap, assets: assetIds, components: componentIds, surfaces: surfaceIds }
  const implementation = (value: ComponentDefinition['implementation']) => value.kind === 'source'
    ? rebindComponentLibraryImplementation(value, identities, Object.keys(assets)) : structuredClone(value)
  for (const [ownerId, files] of Object.entries(components)) {
    if (moving && sameDocument && target.resources.components[ownerId]) continue
    edits.push({ type: 'component.files.set', ownerId: componentIds.get(ownerId)!, expectedFiles: null,
      files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)])) })
  }
  for (const original of definitions) {
    const definition: ComponentDefinition = { ...structuredClone(original), id: defMap.get(original.id)!, implementation: implementation(original.implementation) }
    if (!project.definitions[definition.id]) edits.push({ type: 'definition.set', definition })
  }
  instances.forEach((item, index) => {
    item.data = rebindProfessionalAssets(item.data, identities)
    const rebound = rebindWebAssets(item, source.project.definitions[item.definitionId], identities)
    item.data = rebound.data
    item.definitionId = defMap.get(item.definitionId) ?? item.definitionId
    if (item.implementationOverride) item.implementationOverride = implementation(entry.example.instances[copiedIds[index]]!.implementationOverride!)
  })
  // Cross-document resources receive the library's software-owned identities. An
  // equal asset ID/metadata in another document does not identify the copied bytes.
  for (const asset of Object.values(assets)) {
    const id = assetIds.get(asset.id)!
    if (!project.assets[id]) {
      const bytes = entry.resources.assets[asset.id] ?? source.resources.assets[asset.id]
      if (!bytes) continue
      const extension = /\.[a-zA-Z0-9]+$/.exec(asset.path)?.[0] ?? ''
      edits.push({ type: 'asset.add', asset: { ...structuredClone(asset), id,
        path: sameDocument ? asset.path : `assets/${encodeURIComponent(id)}${extension}` }, bytes: Uint8Array.from(bytes) })
    }
  }
  const selected = source.roots.map(mapId)
  const groups = new Map<string, { owner: ComponentContainer; roots: string[] }>()
  // Attached behaviors may be independently owned; each cloned instance is inserted exactly once.
  const graphRoots = copiedIds.filter(id => { const owner = owningContainer(source.project,id); return owner?.kind !== 'instance' || !idMap.has(owner.instanceId) })
  for (const oldRoot of graphRoots) {
    const owner = destination.keepOwner ? owningContainer(project, oldRoot) ?? destination.container : destination.container
    const rootId = mapId(oldRoot), root = instances.find(item => item.id === rootId)!
    if (root.frame) {
      const parent = owner.kind === 'instance' ? composeMatrices(componentParentMatrix(project, owner.instanceId), project.instances[owner.instanceId].frame?.transform ?? IDENTITY_MATRIX) : IDENTITY_MATRIX
      root.frame = translateFrame(reparentFrame(root.frame, source.matrices?.[oldRoot] ?? componentParentMatrix(source.project,oldRoot), parent), (destination.offset ?? { x: 0, y: 0 })) as ComponentFrame
    }
    const key = JSON.stringify(owner), group = groups.get(key) ?? { owner, roots: [] }
    group.roots.push(rootId); groups.set(key,group)
  }
  let first = true
  for (const group of groups.values()) {
    edits.push({ type: 'instance.insert', container: group.owner, index: sameContainer(group.owner, destination.container) ? destination.index : containerChildIds(project, group.owner).length, instances: first ? instances : [], rootIds: group.roots })
    first = false
  }
  let copiedBehaviorId: string | undefined
  if (externalBehaviors.length) {
    let owner = destination.container
    while (owner.kind === 'instance') {
      const parent = owningContainer(project, owner.instanceId)
      if (!parent) throw new Error('粘贴目标归属已不存在')
      owner = parent
    }
    const ruleTarget = owner.kind === 'global' ? { kind: 'project' as const } : { kind: 'surface' as const, surfaceId: owner.surfaceId }
    const remapped = interactionRules({ id: 'clipboard-family', definitionId: 'guoling.interactions',
      data: remapComponentInteractionData(familyData, { instances: idMap, surfaces: surfaceIds, rules, actions, stateKeys }) })
    const existing = interactionBehavior(project, ruleTarget)
    const behaviorEdits = componentRuleEdits(project, ruleTarget, [...interactionRules(existing), ...remapped])
    copiedBehaviorId = existing?.id ?? behaviorEdits.find(edit => edit.type === 'instance.insert')?.rootIds[0]
    edits.push(...behaviorEdits)
  }
  // A normal copy keeps every named author state; the current render projection is never its source.
  const presentations = new Map<string, ComponentPresentation>()
  for (const sourceSurface of source.project.surfaces) for (const state of sourceSurface.presentation?.states ?? []) {
    const owned = copiedIds.filter(id => Object.hasOwn(state.overrides, id))
    const ordered = state.order?.filter(id => idMap.has(id)) ?? []
    const changesCopiedRules = externalBehaviors.some(id => state.overrides[id]?.data !== undefined
      && !equalComponentValue(selectRules(rulesAt(id, state.overrides[id].data!)), selectRules(rulesAt(id))))
    const ownsRuleState = copiedBehaviorId && (changesCopiedRules
      || copiedIds.some(id => { const owner = topOwner(source.project, owningContainer(source.project, id)); return owner?.kind === 'surface' && owner.surfaceId === sourceSurface.id }))
    if (!owned.length && !ordered.length && !ownsRuleState) continue
    const surfaceId = destination.keepOwner && sameDocument ? sourceSurface.id : destinationSurfaceId
    if (!surfaceId) continue
    const destinationSurface = project.surfaces.find(surface => surface.id === surfaceId)
    if (!destinationSurface) continue
    if (destinationSurface.kind !== 'slide') {
      const baseOrder = sourceSurface.childIds.filter(id => copied.has(id))
      const stateOrder = [...ordered, ...baseOrder.filter(id => !ordered.includes(id))]
      if (owned.length || changesCopiedRules || !equalComponentValue(stateOrder, baseOrder)) {
        throw new Error(`当前${destinationSurface.kind === 'flow' ? '连续文档' : '空间画布'}不支持展示状态，无法完整粘贴这些对象。请粘贴到幻灯片页面。`)
      }
      // Unrelated page states do not belong to these copied objects.
      continue
    }
    const presentation = presentations.get(surfaceId) ?? structuredClone(destinationSurface.presentation ?? { states: [] })
    let copiedState = presentation.states.find(value => value.id === state.id)
    if (!copiedState) {
      copiedState = { id: state.id, title: state.title, overrides: {} }
      presentation.states.push(copiedState)
    }
    for (const id of owned) {
      const original = source.project.instances[id], override = structuredClone(state.overrides[id])
      if (override.data !== undefined) {
        const data = professionalKey(id) === 'guoling.interactions'
          ? remapComponentInteractionData(override.data, { instances: idMap, surfaces: surfaceIds, rules, actions, stateKeys })
          : professionalKey(id) === 'guoling.input' ? remapComponentInputData(override.data, { fromInstanceId: id, toInstanceId: mapId(id), rules, stateKeys })
          : rewrite(override.data)
        override.data = rebindWebAssets({ ...original, data: rebindProfessionalAssets(data, identities) },
          source.project.definitions[original.definitionId], identities).data
      }
      if (override.style) override.style = rebindProfessionalAssets(rewrite(override.style), identities) as typeof override.style
      if (override.frame && graphRoots.includes(id)) {
        const sourceView = resolveComponentPresentation(source.project, sourceSurface.id, state.id)
        const owner = [...groups.values()].find(group => group.roots.includes(mapId(id)))?.owner ?? destination.container
        const targetView = resolveComponentPresentation(project, surfaceId, copiedState.id)
        const parent = owner.kind === 'instance' ? composeMatrices(componentParentMatrix(targetView, owner.instanceId), targetView.instances[owner.instanceId].frame?.transform ?? IDENTITY_MATRIX) : IDENTITY_MATRIX
        override.frame = translateFrame(reparentFrame(override.frame, componentParentMatrix(sourceView, id), parent), destination.offset ?? { x: 0, y: 0 }) as ComponentFrame
      }
      copiedState.overrides[mapId(id)] = override
    }
    if (copiedBehaviorId && ownsRuleState) {
      const currentData = copiedState.overrides[copiedBehaviorId]?.data ?? project.instances[copiedBehaviorId]?.data ?? { rules: [] }
      const currentRules = interactionRules({ id: copiedBehaviorId, definitionId: 'guoling.interactions', data: currentData })
      const effectiveRules = externalBehaviors.flatMap(id => selectRules(rulesAt(id, state.overrides[id]?.data ?? source.project.instances[id].data)))
      const rebound = interactionRules({ id: 'clipboard-state', definitionId: 'guoling.interactions', data: remapComponentInteractionData({ rules: effectiveRules } as unknown as JsonValue,
        { instances: idMap, surfaces: surfaceIds, rules, actions, stateKeys }) })
      copiedState.overrides[copiedBehaviorId] = { ...copiedState.overrides[copiedBehaviorId], data: { rules: [...currentRules, ...rebound] } as unknown as JsonValue }
    }
    if (state.order) {
      const existing = copiedState.order ?? [...destinationSurface.childIds]
      const newIds = ordered.map(mapId)
      const insertion = sameDocument && surfaceId === sourceSurface.id
        ? Math.max(-1, ...ordered.map(id => existing.indexOf(id))) + 1 : Math.min(destination.index, existing.length)
      copiedState.order = [...existing.slice(0, insertion), ...newIds.filter(id => !existing.includes(id)), ...existing.slice(insertion)]
    }
    presentations.set(surfaceId, presentation)
  }
  for (const [surfaceId, presentation] of presentations) edits.push({ type: 'surface.presentation.set', surfaceId, presentation })
  return { edits, idMap, assetIds, rootIds: selected, diagnostics }
}
