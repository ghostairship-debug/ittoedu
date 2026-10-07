import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, containerChildIds, owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentDefinition, type ComponentPresentation, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import { translateFrame, rotateFrame, reparentFrame, frameCorners, transformVector, invertMatrix, composeMatrices, IDENTITY_MATRIX, type AffineMatrix } from '../../core/components/geometry'
import type { EditorCanvasNodePatch } from '../phaser/editorCanvasNode'
import type { TextRun } from '../../shared/contracts/native-v1'
import type { EditorActionId, EditorFocusKind, EditorSelectionSnapshot } from '../course/editorActionTypes'
import type { createCourseLifecycleSlice } from '../store/slices/courseLifecycleSlice'
import type { createCourseStructureSlice } from '../store/slices/courseStructureSlice'
import type { DocumentResources } from '../../shared/workbench/document'
import { extractComponentLibraryEntry } from '../../core/components/library'
import { rebindComponentLibraryImplementation } from '../../core/components/library/rebindSource'
import { componentAssetIds, rebindDeclaredTargets, rebindProfessionalAssets, rebindWebAssets, sourceAssetIds, sourceModuleBindings } from '../../core/components/library/references'
import type { LibraryDiagnostic } from '../../core/components/library/types'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { componentRuleEdits, createComponentInteractionCopyIdentities, interactionBehavior, interactionRules, remapComponentInteractionData } from '../interactions/componentInteractionAuthoring'
import { remapComponentInputData } from '../../components/input/authoring'
import { inputDataSchema } from '../../components/input/data'
import type { InteractionRule } from '../../shared/interactionTypes'

/** Surface-owned content commands; generic objects use the common canonical writer below. */
export interface CrossSurfaceContentPorts {
  addTextNode?(x?: number, y?: number): unknown
  addFormulaNode?(x?: number, y?: number): unknown
  addRectangleNode?(x?: number, y?: number): unknown
  addShapeNode?(shape: string, x?: number, y?: number): unknown
  addTableNode?(x?: number, y?: number): unknown
  addChartNode?(chart: 'bar' | 'line' | 'area' | 'pie' | 'donut', x?: number, y?: number): unknown
  beginTextEdit?(id: string, source?: 'canvas' | 'properties'): unknown
  updateTextEditDraft?(id: string, text: string, runs: TextRun[], height?: number, width?: number): unknown
  commitTextEdit?(): unknown
  cancelTextEdit?(): unknown
  ensureTeacherController?(): unknown
  setSpatialEditingScope?(scope: 'global' | 'world' | 'surface'): unknown
  readSpatialView?(): {scope: 'global'|'world'|'surface'}
}
export interface CrossSurfaceCommandPorts {
  kernel: EditorStoreKernel
  slide: CrossSurfaceContentPorts
  flow: CrossSurfaceContentPorts
  spatial: CrossSurfaceContentPorts
  shell: { read(): { canvasMode: 'edit' | 'run'; editingTextNodeId: string | null; editingScope?: 'scene' | 'global' }; patch(patch: Record<string, unknown>): void | Promise<void> }
  structure: ReturnType<typeof createCourseStructureSlice>
  lifecycle: ReturnType<typeof createCourseLifecycleSlice>
  /** Existing desktop editorClipboard bridge; commands and shortcuts share native events. */
  requestClipboard?(command: 'copy' | 'cut' | 'paste'): Promise<void> | void
}
function sameContainer(left: ComponentContainer | null, right: ComponentContainer | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
export function componentParentMatrix(project: CourseProjectV10, id: string): AffineMatrix {
  const owner = owningContainer(project, id)
  if (owner?.kind !== 'instance') return IDENTITY_MATRIX
  const parent = project.instances[owner.instanceId]
  return composeMatrices(componentParentMatrix(project, parent.id), parent.frame?.transform ?? IDENTITY_MATRIX)
}
export { componentIsLocked } from '../../shared/contracts/component-platform/project'
function selectedRoots(project: CourseProjectV10, ids: readonly string[]): string[] {
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
function descendants(project: CourseProjectV10, roots: readonly string[], includeAttachments = true): string[] {
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
interface ObjectClipboard extends CourseObjectClipboardSource {
  matrices: Record<string, AffineMatrix>
  moveAvailable?: boolean
  removal?: Promise<void>
}
export interface CourseObjectPasteDestination {
  capturedTarget: CapturedCourseTarget
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
  const copied = new Set(descendants(source.project, source.roots)), copyRoots = [...source.roots]
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
        if (!owner || !familyOwners.some(value => owner.kind === 'global' && value.kind === 'global' || sameContainer(owner, value)) || copied.has(feedbackId)) continue
        copyRoots.push(feedbackId)
        descendants(source.project, [feedbackId]).forEach(value => copied.add(value)); expanded = true
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
  const externalBehaviors = moving && sameDocument ? [] : behaviorIds.filter(id => !copied.has(id))
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
  if (externalBehaviors.some(id => [source.project.instances[id].data, ...stateData(id)].some(data => selectRules(rulesAt(id, data)).length))) {
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
    const ownsRuleState = copiedBehaviorId && (externalBehaviors.some(id => state.overrides[id]?.data !== undefined)
      || copiedIds.some(id => { const owner = topOwner(source.project, owningContainer(source.project, id)); return owner?.kind === 'surface' && owner.surfaceId === sourceSurface.id }))
    if (!owned.length && !ordered.length && !ownsRuleState) continue
    const surfaceId = destination.keepOwner && sameDocument ? sourceSurface.id : destinationSurfaceId
    if (!surfaceId) continue
    const destinationSurface = project.surfaces.find(surface => surface.id === surfaceId)
    if (!destinationSurface) continue
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

export const COURSE_OBJECT_CLIPBOARD_MIME = 'application/x-guoling-course-objects'
/** Clipboard is transient user input; selection/history remain solely in Bridge/Session. */
export function createCrossSurfaceCommands(ports: CrossSurfaceCommandPorts) {
  const { kernel } = ports
  let clipboard: ObjectClipboard | null = null
  let clipboardToken: string | null = null
  const report = (error: unknown) => kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : String(error), statusMessage: null })
  const current = () => kernel.readEditingDocument()
  const surface = () => current().surfaces.find(value => value.id === kernel.readView().surfaceId)
  const content = () => surface()?.kind === 'flow' ? ports.flow : surface()?.kind === 'spatial' ? ports.spatial : ports.slide
  const scope = () => surface()?.kind==='spatial' && ports.spatial.readSpatialView ? ports.spatial.readSpatialView().scope==='global'?'global':'scene' : ports.shell.read().editingScope??'scene'
  const delegate = <K extends keyof CrossSurfaceContentPorts>(name: K, ...args: Parameters<NonNullable<CrossSurfaceContentPorts[K]>>) => {
    const fn = content()[name]
    if (!fn) { report(new Error('当前表面尚未接入此操作')); return }
    try {
      const result = (fn as (...values: unknown[]) => unknown)(...args)
      void Promise.resolve(result).catch(report)
      return result
    } catch (error) { report(error) }
  }
  const write = async (edits: ComponentEdit[], target = kernel.captureTarget(), selectedIds?: readonly string[]) => {
    if (!edits.length) return
    await kernel.editCaptured(kernel.capture(edits, target))
    if (selectedIds) kernel.selectInstances(selectedIds, target.surfaceId, target.documentId)
  }
  const flush = () => content().commitTextEdit?.()
  const run = (operation: () => Promise<void> | void) => { try { void Promise.resolve(operation()).catch(report) } catch (error) { report(error) } }
  const navigateHistory = async (direction: 'undo' | 'redo'): Promise<boolean> => {
    // Local draft submission can await Main. Retain its document even if the
    // user browses another document while that ACK is pending.
    const documentId = kernel.readView().activeDocumentId
    if (!documentId) { report(new Error('当前会话没有课程工程')); return false }
    try {
      await flush()
      await kernel.bridge[direction](documentId)
      return true
    } catch (error) { report(error); return false }
  }
  const requestClipboard = (command: 'copy' | 'cut' | 'paste') => run(async () => {
    await flush()
    if (ports.requestClipboard) await ports.requestClipboard(command)
    else if (!document.execCommand(command)) throw new Error('当前环境无法执行系统剪贴板命令，请使用画布快捷键')
  })
  const remove = async (ids: readonly string[]) => {
    const target = kernel.captureTarget(), roots = selectedRoots(target.project, ids)
    if (roots.some(id => componentIsLocked(target.project,id))) throw new Error('锁定元素不能删除，请先解锁')
    await write(roots.map(instanceId => ({ type: 'instance.remove', instanceId })), target, target.instanceIds.filter(id => !descendants(target.project, roots, false).includes(id)))
  }
  const captureClipboard = (ids: readonly string[]): ObjectClipboard => {
    const project = structuredClone(kernel.readDocument()), roots = selectedRoots(project, ids)
    return { documentId: kernel.readView().activeDocumentId ?? undefined, project, roots, resources: structuredClone(kernel.readResources()), matrices: Object.fromEntries(roots.map(id => [id, componentParentMatrix(project, id)])) }
  }
  const paste = async (source: ObjectClipboard, keepOwner: boolean) => {
    if (!source.roots.length) throw new Error('请先复制对象')
    const target = kernel.captureTarget(), project = target.editingProject
    const sourceOwner=owningContainer(source.project,source.roots[0])
    const selectedOwner=target.instanceId?owningContainer(project,target.instanceId):null
    const destination: ComponentContainer = scope()==='global' ? {kind:'global',plane:selectedOwner?.kind==='global'?selectedOwner.plane:sourceOwner?.kind==='global'?sourceOwner.plane:'overlay'} : { kind: 'surface', surfaceId: target.surfaceId ?? project.surfaces[0]?.id ?? '' }
    const moving = Boolean(source.moveAvailable)
    if (moving) source.moveAvailable = false
    try {
      // Freeze the destination before the cut ACK; a later tab switch cannot
      // retarget paste. Only the first successful paste restores cut IDs.
      await source.removal
      const { edits, rootIds: selected, diagnostics } = prepareCourseObjectPaste(source, { capturedTarget: target, container: destination,
        index: containerChildIds(project, destination).length, offset: { x: 20, y: 20 }, keepOwner, identity: moving ? 'move' : 'copy' })
      await write(edits, { ...target, activeStateId: null, editingProject: target.project }, selected)
      if (diagnostics.length) kernel.setFeedback({ errorMessage: [...new Set(diagnostics.map(item => item.message))].join('\n') })
    } catch (error) { if (moving) source.moveAvailable = true; throw error }
  }
  const layout = async (kind: 'left'|'center'|'right'|'top'|'middle'|'bottom'|'horizontal'|'vertical') => {
    const target = kernel.captureTarget(), project = target.editingProject
    const ids = selectedRoots(project,target.instanceIds).filter(id=>!componentIsLocked(project,id)&&project.instances[id].frame)
    const distribution = kind==='horizontal'||kind==='vertical'
    if(ids.length<(distribution?3:2)) throw new Error(distribution?'至少需要 3 个未锁定对象':'至少需要 2 个未锁定对象')
    const rootOwner=(id:string):ComponentContainer|null=>{let owner=owningContainer(project,id);while(owner?.kind==='instance')owner=owningContainer(project,owner.instanceId);return owner}
    const firstOwner=rootOwner(ids[0])
    if(ids.some(id=>!sameContainer(rootOwner(id),firstOwner))) throw new Error('不同归属的对象需要分别对齐')
    const boxes=ids.map(id=>{const points=frameCorners(project.instances[id].frame!,componentParentMatrix(project,id));const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {id,left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)}})
    const left=Math.min(...boxes.map(box=>box.left)),right=Math.max(...boxes.map(box=>box.right)),top=Math.min(...boxes.map(box=>box.top)),bottom=Math.max(...boxes.map(box=>box.bottom))
    const deltas = new Map<string,{x:number;y:number}>()
    if(distribution) {
      const horizontal=kind==='horizontal',ordered=boxes.slice().sort((a,b)=>horizontal?a.left-b.left:a.top-b.top)
      const start=horizontal?ordered[0].left:ordered[0].top,end=horizontal?ordered[ordered.length-1].right:ordered[ordered.length-1].bottom
      const sizes=ordered.map(box=>horizontal?box.right-box.left:box.bottom-box.top),gap=(end-start-sizes.reduce((a,b)=>a+b,0))/(ordered.length-1)
      let cursor=start
      ordered.forEach((box,index)=>{deltas.set(box.id,{x:horizontal?cursor-box.left:0,y:horizontal?0:cursor-box.top});cursor+=sizes[index]+gap})
    } else boxes.forEach(box=>deltas.set(box.id,{x:kind==='left'?left-box.left:kind==='right'?right-box.right:kind==='center'?(left+right-box.left-box.right)/2:0,y:kind==='top'?top-box.top:kind==='bottom'?bottom-box.bottom:kind==='middle'?(top+bottom-box.top-box.bottom)/2:0}))
    await write(boxes.flatMap(box=>{const delta=deltas.get(box.id)!;return delta.x===0&&delta.y===0?[]:[{type:'frame.set' as const,instanceId:box.id,frame:translateFrame(project.instances[box.id].frame!,transformVector(invertMatrix(componentParentMatrix(project,box.id)),delta)) as ComponentFrame}]}),target)
  }
  const commands = {
    setCanvasMode(canvasMode: 'edit' | 'run') { run(async () => { await flush(); ports.shell.patch({ canvasMode, editingTextNodeId: null }) }) },
    setEditingScope(editingScope: 'scene' | 'global') { if(surface()?.kind==='spatial' && ports.spatial.setSpatialEditingScope) ports.spatial.setSpatialEditingScope(editingScope==='global'?'global':'world'); else ports.shell.patch({ editingScope }); kernel.selectInstances([]) },
    activateCourseLocation(id: string) { run(async () => { await flush(); kernel.selectSurface(id); kernel.selectInstances([], id) }) },
    setActiveScene(id: string) { commands.activateCourseLocation(id) },
    async addCourseContent(...args: Parameters<typeof ports.structure.addCourseContent>) { const result = await ports.structure.addCourseContent(...args); if (result.ok && result.activatedLocationId) kernel.selectSurface(result.activatedLocationId); return result },
    async addScene() { const result = await ports.structure.addScene(); if (result.ok && result.activatedLocationId) kernel.selectSurface(result.activatedLocationId); return result },
    reorderCourseSurfaces(ids: string[]) { return ports.structure.reorderCourseSurfaces(ids) },
    deleteCourseSurface(...args: Parameters<typeof ports.structure.deleteCourseSurface>) { return ports.structure.deleteCourseSurface(...args) },

    deleteScene(id: string) { return ports.structure.deleteCourseSurface(id) },
    undo() { return navigateHistory('undo') },
    redo() { return navigateHistory('redo') },
    setEditingTextNode(id: string | null) { ports.shell.patch({ editingTextNodeId: id }) },
    beginTextEdit(id: string, source: 'canvas' | 'properties' = 'canvas') { delegate('beginTextEdit', id, source) },
    updateTextEditDraft(id: string, text: string, runs: TextRun[], height?: number, width?: number) { delegate('updateTextEditDraft', id, text, runs, height, width) },
    async commitTextEdit() { await flush() }, cancelTextEdit() { return delegate('cancelTextEdit') },
    renameProject(title: string) { run(() => kernel.edit([{ type: 'project.title.set', title }]).then(() => {})) },
    addTextNode(x?: number, y?: number) { return delegate('addTextNode', x, y) },
    addFormulaNode(x?: number, y?: number) { return delegate('addFormulaNode', x, y) },
    addRectangleNode(x?: number, y?: number) { return delegate('addRectangleNode', x, y) },
    addShapeNode(shape: string, x?: number, y?: number) { return delegate('addShapeNode', shape, x, y) },
    addTableNode(x?: number, y?: number) { return delegate('addTableNode', x, y) },
    addChartNode(chart: 'bar' | 'line' | 'area' | 'pie' | 'donut', x?: number, y?: number) { return delegate('addChartNode', chart, x, y) },
    ensureTeacherController() { return delegate('ensureTeacherController') },
    selectNode(id: string | null, additive = false) {
      const ids = kernel.readView().selectedInstanceIds
      kernel.selectInstances(id === null ? [] : additive ? ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] : [id])
      if (id) ports.shell.patch({ activeTab: 'properties' })
    },
    selectNodes(ids: string[]) { kernel.selectInstances(ids); if (ids.length) ports.shell.patch({ activeTab: 'properties' }) },
    selectAllNodes() { commands.selectNodes(scope()==='global'?[...current().global.underlay,...current().global.overlay]:surface()?.childIds??[]) },
    updateNodes(patches: Array<{ nodeId: string; patch: EditorCanvasNodePatch }>) { run(async () => {
      const target = kernel.captureTarget(), edits: ComponentEdit[] = []
      for (const { nodeId, patch } of patches) {
        const item = target.editingProject.instances[nodeId]
        if (!item) throw new Error('对象已不存在')
        const statePatch = { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.visible !== undefined ? { visible: patch.visible } : {}), ...(patch.locked !== undefined ? { locked: patch.locked } : {}) }
        if (Object.keys(statePatch).length) edits.push({ type: 'instance.patch', instanceId: nodeId, patch: statePatch })
        const geometry = patch.frame !== undefined || ['x','y','width','height','rotation'].some(key => patch[key] !== undefined)
        if (geometry && componentIsLocked(target.editingProject,nodeId)) continue
        if (geometry && (item.frame || patch.frame)) {
          let frame = structuredClone(((patch.frame as ComponentFrame | undefined) ?? item.frame)!)
          if (patch.x !== undefined || patch.y !== undefined) frame = translateFrame(frame, { x: (patch.x ?? frame.transform[4]) - frame.transform[4], y: (patch.y ?? frame.transform[5]) - frame.transform[5] }) as ComponentFrame
          if (patch.width !== undefined) frame.width = patch.width
          if (patch.height !== undefined) frame.height = patch.height
          if (patch.rotation !== undefined) frame = rotateFrame(frame, (patch.rotation - Math.atan2(frame.transform[1], frame.transform[0]) * 180 / Math.PI) * Math.PI / 180, { x: 0, y: 0 }) as ComponentFrame
          edits.push({ type: 'frame.set', instanceId: nodeId, frame })
        }
        if (componentIsLocked(target.editingProject,nodeId)) continue
        if (patch.data !== undefined) edits.push({ type: 'data.set', instanceId: nodeId, path: [], value: structuredClone(patch.data) as JsonValue })
        if (patch.opacity !== undefined) edits.push({ type: 'style.set', instanceId: nodeId, path: ['opacity'], value: patch.opacity })
        if (patch.style && typeof patch.style === 'object') for (const [key,value] of Object.entries(patch.style)) edits.push({ type: 'style.set', instanceId: nodeId, path: [key], value: value as JsonValue })
      }
      await write(edits, target)
    }) },
    updateNode(nodeId: string, patch: EditorCanvasNodePatch) { commands.updateNodes([{ nodeId, patch }]) },
    nudgeSelection(dx: number, dy: number) { run(async () => {
      const target = kernel.captureTarget()
      await write(selectedRoots(target.editingProject, target.instanceIds).filter(id => !componentIsLocked(target.editingProject,id) && target.editingProject.instances[id].frame).map(instanceId => {
        const delta = transformVector(invertMatrix(componentParentMatrix(target.editingProject, instanceId)), { x: dx, y: dy })
        return { type: 'frame.set', instanceId, frame: translateFrame(target.editingProject.instances[instanceId].frame!, delta) as ComponentFrame }
      }), target)
    }) },
    alignSelectedNodes(mode: 'left'|'center'|'right'|'top'|'middle'|'bottom') { run(() => layout(mode)) },
    distributeSelectedNodes(direction: 'horizontal'|'vertical') { run(() => layout(direction)) },
    copySelectedNodes() { requestClipboard('copy') },
    cutSelectedNodes() { requestClipboard('cut') },
    pasteNodes() { requestClipboard('paste') },
    copyCourseClipboard(data: DataTransfer | null, cut = false): boolean {
      if (!data) return false
      const ids = kernel.readView().selectedInstanceIds
      if (!ids.length) return false
      if (cut && ids.some(id => componentIsLocked(current(), id))) { report(new Error('锁定元素不能剪切')); return true }
      try {
        const copied = captureClipboard(ids)
        if (!copied.roots.length) return false
        const token = crypto.randomUUID()
        data.clearData()
        data.setData(COURSE_OBJECT_CLIPBOARD_MIME, token)
        clipboard = copied; clipboardToken = token
        if (cut) {
          copied.moveAvailable = true
          copied.removal = remove(ids)
          // ClipboardEvent is synchronous; retain the ACK for paste and report
          // a rejection without leaving an unhandled promise.
          void copied.removal.catch(report)
        }
        return true
      } catch (error) { report(error); return true }
    },
    pasteCourseClipboard(data: DataTransfer | null): boolean {
      if (!data || !clipboard || !clipboardToken || data.getData(COURSE_OBJECT_CLIPBOARD_MIME) !== clipboardToken) return false
      run(() => paste(clipboard!, false))
      return true
    },
    duplicateSelectedNodes() { run(() => paste(captureClipboard(kernel.readView().selectedInstanceIds), true)) },
    duplicateNode(id: string) { run(() => paste(captureClipboard([id]), true)) },
    deleteNode(id: string) { run(() => remove([id])) }, deleteSelectedNodes() { run(() => remove(kernel.readView().selectedInstanceIds)) },
    reorderNodes(ids: string[]) { run(async () => {
      const target = kernel.captureTarget(), owner = owningContainer(target.editingProject, ids[0])
      if (!owner || ids.some(id => !sameContainer(owningContainer(target.editingProject,id),owner))) throw new Error('只能在同一归属内调整层级')
      const original = containerChildIds(target.editingProject,owner), unique = new Set(ids)
      if (unique.size !== ids.length || ids.some(id => !original.includes(id))) throw new Error('图层列表已变化')
      let index = 0
      const ordered = original.map(id => unique.has(id) ? ids[index++]! : id)
      const working=[...original],edits:ComponentEdit[]=[]
      ordered.forEach((instanceId,index)=>{const previous=working.indexOf(instanceId);if(previous===index)return;edits.push({type:'instance.move',instanceId,container:owner,index});working.splice(previous,1);working.splice(index,0,instanceId)})
      await write(edits, target)
    }) },
    moveCandidateLayerOwner(id: string, targetId: string) { run(async () => {
      const target = kernel.captureTarget(), item = target.project.instances[id], owner = owningContainer(target.project,targetId)
      if (!item || !owner) throw new Error('目标图层已不存在')
      if (item.locked) throw new Error('对象已锁定')
      const targetFrame = owner.kind === 'instance' ? composeMatrices(componentParentMatrix(target.project, owner.instanceId), target.project.instances[owner.instanceId].frame?.transform ?? IDENTITY_MATRIX) : IDENTITY_MATRIX
      await write([{type:'instance.move',instanceId:id,container:owner,index:containerChildIds(target.project,owner).indexOf(targetId), ...(item.frame ? {frame: reparentFrame(item.frame,componentParentMatrix(target.project,id),targetFrame) as ComponentFrame} : {})}], target)
    }) },
    createLiveEditorSelectionSnapshot(focus?: EditorFocusKind | EventTarget | null): EditorSelectionSnapshot | null {
      const view=kernel.readView(), project=view.editingProject, active=project?.surfaces.find(value=>value.id===view.surfaceId)
      if (!project || !active) return null
      return { locationId:active.id,revision:project.revision,sessionGeneration:view.activation,documentId:view.activeDocumentId ?? undefined,epoch:view.snapshot?.epoch,surfaceId:active.id,surfaceKind:active.kind,stateId:view.activeStateId,scope:scope()==='global'?'global':'location', focus:typeof focus==='string'?focus:ports.shell.read().editingTextNodeId?'text':view.selectedInstanceIds.length?'layer':'none', itemIds:[...view.selectedInstanceIds],items:view.selectedInstanceIds.map(itemId=>({itemId,locked:componentIsLocked(project,itemId)})) }
    },
    routeEditorAction(actionId: EditorActionId, snapshot?: EditorSelectionSnapshot | null) {
      const live=commands.createLiveEditorSelectionSnapshot()
      if (!live || (snapshot && (snapshot.documentId!==live.documentId || snapshot.epoch!==live.epoch || snapshot.locationId!==live.locationId || snapshot.revision!==live.revision || snapshot.sessionGeneration!==live.sessionGeneration || snapshot.stateId!==live.stateId || snapshot.scope!==live.scope || JSON.stringify(snapshot.itemIds)!==JSON.stringify(live.itemIds)))) return {actionId,ok:false,reason:'选择或文档已改变',adapter:'none' as const}
      if (live.focus==='text') return {actionId,ok:false,reason:'文字编辑中由正文处理此操作',adapter:'none' as const}
      if (['cut','delete'].includes(actionId) && live.items?.some(item=>item.locked)) return {actionId,ok:false,reason:'锁定元素不能删除，请先解锁',adapter:'none' as const}
      switch(actionId) {
        case 'select-all': commands.selectAllNodes();break
        case 'copy':commands.copySelectedNodes();break
        case 'cut':commands.cutSelectedNodes();break
        case 'paste':commands.pasteNodes();break
        case 'duplicate':commands.duplicateSelectedNodes();break
        case 'delete':commands.deleteSelectedNodes();break
        case 'undo':commands.undo();break
        case 'redo':commands.redo();break
      }
      return {actionId,ok:true,reason:'已受理编辑操作',adapter:live.surfaceKind}
    },
    prepareCourseProjectPersistence() { return ports.lifecycle.prepareCourseProjectPersistence() },
    captureCourseProjectRecoverySnapshot() { return ports.lifecycle.captureCourseProjectRecoverySnapshot() },
    acknowledgeCourseProjectSaved(path: string, token: Parameters<typeof ports.lifecycle.acknowledgeCourseProjectSaved>[1]) { return ports.lifecycle.acknowledgeCourseProjectSaved(path, token) },
  }
  return commands
}
export type CrossSurfaceCommands = ReturnType<typeof createCrossSurfaceCommands>







