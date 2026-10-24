import { componentContainerForInstance, componentContainers, componentSurface } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, containerChildIds, owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentContainerAuthoring, type ComponentDefinition, type ComponentPresentation, type ComponentTarget, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import type { DocumentResources } from '../../shared/workbench/document'
import { translateFrame, reparentFrame, composeMatrices, IDENTITY_MATRIX, type AffineMatrix } from '../components/geometry'
import { extractComponentLibraryEntry, selectedRangePopoverAttachments } from '../components/library'
import { rebindComponentLibraryImplementation } from '../components/library/rebindSource'
import { createComponentReferenceCapture, rebindAuthoringAssets, rebindProfessionalAssets, rebindWebAssets, sourceAssetIds, sourceModuleBindings } from '../components/library/references'
import type { LibraryDiagnostic, LibraryExtractResult } from '../components/library/types'
import { associatedComponentInteractionRules, componentInteractionDataSchema, componentRuleEdits, createComponentInteractionCopyIdentities, interactionBehavior, interactionRules, remapComponentInteractionData } from '../../shared/componentInteractionData'
import { remapComponentInputData } from '../../components/input/authoring'
import { inputDataSchema } from '../../components/input/data'
import { componentParentMatrix } from '../drivers/courseV10Operations'
import { equalComponentValue } from '../../shared/componentValue'
import { globalVisibilityAtSurface } from './courseSemanticEdits'
import { courseSurfaceReference, prepareCourseVisibility, type CourseAuthoringReferences } from './courseAuthoringReferences'
import { courseInsertionFrame } from './courseInsertionGeometry'
import { createProfessionalDocumentIdentityCopy } from '../components/library/professionalCopy'
import { rebindComponentBackground } from '../../shared/componentBackgroundPaint'

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
    while (working[index] !== instanceId) {
      const moving = componentIsLocked(project, instanceId) ? working[index]! : instanceId
      if (componentIsLocked(project, moving)) throw new Error('锁定元素不能调整层级，请先解锁')
      const previous = working.indexOf(moving), destination = moving === instanceId ? index : ordered.indexOf(moving)
      edits.push({ type: 'instance.move', instanceId: moving, container: owner, index: destination })
      working.splice(previous, 1); working.splice(destination, 0, moving)
    }
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
  const destinationId = container.kind === 'instance' ? container.instanceId : container.kind === 'surface' ? container.surfaceId : undefined
  const parentMatrix = (view: CourseProjectV10) => destinationId ? composeMatrices(componentParentMatrix(view, destinationId),
    view.instances[destinationId]?.frame?.transform ?? IDENTITY_MATRIX) : IDENTITY_MATRIX
  const frame = item.frame ? reparentFrame(item.frame, componentParentMatrix(project, instanceId), parentMatrix(project)) as ComponentFrame : undefined
  const edits: ComponentEdit[] = [{ type: 'instance.move', instanceId, container, index, ...(frame ? { frame } : {}) }]
  const surface = componentContainerForInstance(project, instanceId)
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
  if (!left || !right) return left === right
  const id = (owner: ComponentContainer) => owner.kind === 'surface' ? owner.surfaceId : owner.kind === 'instance' ? owner.instanceId : undefined
  const leftId = id(left), rightId = id(right)
  return leftId !== undefined || rightId !== undefined ? leftId === rightId
    : left.kind === right.kind && (left.kind !== 'global' || right.kind === 'global' && left.plane === right.plane)
}

/** Container-local state/frame IDs remain local. Only declared graph/resource
 * references follow an object copy; the source snapshot is never edited. */
export function rebindCourseContainerCopy(container: ComponentContainerAuthoring, ids: ReadonlyMap<string, string>,
  data: (instanceId: string, value: JsonValue) => JsonValue, assets: ReadonlyMap<string, string> = new Map(),
  authoring?: (value: NonNullable<CourseProjectV10['instances'][string]['authoring']>) => NonNullable<CourseProjectV10['instances'][string]['authoring']>): ComponentContainerAuthoring {
  const copy = structuredClone(container), instanceId = (id: string) => ids.get(id) ?? id
  const background = (value: typeof copy.background) => value ? rebindComponentBackground(value, id => assets.get(id) ?? id) : undefined
  if (copy.background) copy.background = background(copy.background)
  if (copy.presentation) copy.presentation.states = copy.presentation.states.map(state => ({ ...state,
    ...(state.background ? { background: background(state.background) } : {}),
    overrides: Object.fromEntries(Object.entries(state.overrides).map(([id, override]) => [instanceId(id), { ...override,
      ...(override.data === undefined ? {} : { data: data(id, override.data) }),
      ...(override.authoring && authoring ? { authoring: authoring(override.authoring) } : {}) }])),
    ...(state.order ? { order: state.order.map(instanceId) } : {}) }))
  if (copy.spatial) {
    copy.spatial.frames = copy.spatial.frames.map(frame => ({ ...frame,
      ...(frame.targetInstanceId ? { targetInstanceId: instanceId(frame.targetInstanceId) } : {}) }))
    copy.spatial.paths = copy.spatial.paths?.map(path => ({ ...path, ...(path.instanceIds ? { instanceIds: path.instanceIds.map(instanceId) } : {}) }))
    copy.spatial.relations = copy.spatial.relations?.map(relation => ({ ...relation,
      sourceInstanceId: instanceId(relation.sourceInstanceId), targetInstanceId: instanceId(relation.targetInstanceId) }))
    copy.spatial.semanticZoom = copy.spatial.semanticZoom?.map(rule => ({ ...rule, instanceIds: rule.instanceIds.map(instanceId) }))
  }
  return copy
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
  anchors?:readonly {instanceId:string;placement:NonNullable<CourseProjectV10['instances'][string]['flowPlacement']>}[]
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
  readPaths: string[][]
  edits: ComponentEdit[]
  idMap: ReadonlyMap<string, string>
  professionalIdentities?: ReadonlyMap<string, string>
  assetIds: ReadonlyMap<string, string>
  rootIds: string[]
  diagnostics: LibraryDiagnostic[]
}
/** Derives one canonical clone batch; callers combine it with their own document edits. */
export function prepareCourseObjectPaste(source: CourseObjectClipboardSource, destination: CourseObjectPasteDestination): CourseObjectPastePlan {
  return prepareCourseObjectPasteWithExtraction(source, destination, extractCourseObjectPasteSource)
}

interface CourseObjectPasteSourceClosure {
  extracted: LibraryExtractResult
  assets: LibraryExtractResult['entry']['assets']
  referencedAssets: string[]
}

function extractCourseObjectPasteSource(source: CourseObjectClipboardSource, rootIds: string[], copiedIds: string[]): CourseObjectPasteSourceClosure {
  const references = createComponentReferenceCapture(source.project, source.resources)
  const extracted = extractComponentLibraryEntry(source.project, source.resources, { id: `clipboard_${crypto.randomUUID()}`, title: '复制对象', rootIds }, references)
  const { entry } = extracted, assets = { ...entry.assets }, referencedAssets = new Set(Object.keys(assets))
  for (const instance of Object.values(entry.example.instances)) {
    for (const id of references.componentAssetIds(instance, entry.definitions[instance.definitionId])) referencedAssets.add(id)
  }
  for (const surface of componentContainers(source.project)) for (const state of surface.presentation?.states ?? []) {
    const effective = resolveComponentPresentation(source.project, surface.id, state.id)
    for (const id of copiedIds) if (Object.hasOwn(state.overrides, id)) {
      const instance = effective.instances[id]
      for (const assetId of references.componentAssetIds(instance, effective.definitions[instance.definitionId], effective)) {
        referencedAssets.add(assetId)
        if (source.project.assets[assetId]) assets[assetId] = structuredClone(source.project.assets[assetId])
      }
    }
  }
  for (const definition of Object.values(entry.definitions)) for (const id of sourceAssetIds(definition.implementation)) referencedAssets.add(id)
  return { extracted, assets, referencedAssets: [...referencedAssets] }
}

/** One canonical planning batch owns this cache and reports each successfully
 * applied command. Only unrelated additions retain a captured source closure. */
export function createCourseObjectPastePlanningBatch() {
  const captured = new Map<string, { closure: CourseObjectPasteSourceClosure; project: CourseProjectV10 }>()
  return {
    prepare(source: CourseObjectClipboardSource, destination: CourseObjectPasteDestination): CourseObjectPastePlan {
      return prepareCourseObjectPasteWithExtraction(source, destination, (source, rootIds, copiedIds) => {
        const key = JSON.stringify([source.documentId, source.project.id, rootIds])
        let value = captured.get(key)
        if (!value) {
          value = { closure: extractCourseObjectPasteSource(source, rootIds, copiedIds), project: source.project }
          captured.set(key, value)
        }
        return value.closure
      })
    },
    applied(edits: readonly ComponentEdit[]): void {
      for (const [key, { closure: { extracted: { entry } }, project }] of captured) {
        const definitions = new Set(Object.keys(entry.definitions))
        const owners = new Set(Object.keys(entry.resources.components))
        for (const implementation of [...Object.values(entry.definitions).map(value => value.implementation),
          ...Object.values(entry.example.instances).map(value => value.implementationOverride)]) {
          if (implementation?.kind === 'source') {
            Object.values(sourceModuleBindings(implementation)).forEach(id => definitions.add(id))
            if (implementation.workspace) owners.add(implementation.workspace.ownerId)
          }
        }
        const changedDefinitions = new Map(edits.flatMap(edit => edit.type === 'definition.set' ? [[edit.definition.id, edit.definition] as const] : []))
        const unrelated = edits.every(edit => {
          if (edit.type === 'definition.set') return !definitions.has(edit.definition.id)
          if (edit.type === 'component.files.set') return !owners.has(edit.ownerId)
          if (edit.type === 'instance.insert') return !(edit.container.kind === 'instance' && Object.hasOwn(entry.example.instances, edit.container.instanceId))
            && edit.instances.every(instance => componentDefinitionBuiltinKey(changedDefinitions.get(instance.definitionId) ?? project.definitions[instance.definitionId]) !== 'guoling.interactions')
          return false
        })
        if (!unrelated) captured.delete(key)
      }
    },
  }
}

function prepareCourseObjectPasteWithExtraction(source: CourseObjectClipboardSource, destination: CourseObjectPasteDestination,
  extract: typeof extractCourseObjectPasteSource): CourseObjectPastePlan {
  if (!source.roots.length) throw new Error('请先复制对象')
  const target = destination.capturedTarget, project = target.project
  const moving = destination.identity === 'move'
  const sameDocument = Boolean(source.documentId && source.documentId === target.documentId)
  const professionalKey = (id: string) => componentDefinitionBuiltinKey(source.project.definitions[source.project.instances[id].definitionId])
  const stateData = (id: string) => componentContainers(source.project).flatMap(surface => (surface.presentation?.states ?? [])
    .flatMap(state => state.overrides[id]?.data === undefined ? [] : [state.overrides[id].data!]))
  const localScope = (value: CourseProjectV10, id: string) => !!value.instances[id]?.container || value.rootIds.includes(id)
  const topOwner = (value: CourseProjectV10, owner: ComponentContainer | null): ComponentContainer | null => {
    while (owner?.kind === 'instance' && !localScope(value, owner.instanceId)) owner = owningContainer(value, owner.instanceId)
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
  // Shared range annotations are owned by the Flow rather than either text child.
  // Their selected-text closure must also receive clipboard instance identities.
  let rangePopovers = new Map<string, NonNullable<CourseProjectV10['instances'][string]['attachments']>>()
  for (;;) {
    rangePopovers = selectedRangePopoverAttachments(source.project, copied)
    const count = copied.size
    for (const id of rangePopovers.keys()) if (!copied.has(id)) {
      copyRoots.push(id)
      courseObjectDescendants(source.project, [id]).forEach(value => copied.add(value))
    }
    if (copied.size === count) break
  }
  const copiedIds = [...copied], idMap = new Map(copiedIds.map(id => [id, moving && !Object.hasOwn(project.instances,id) ? id : crypto.randomUUID()]))
  // The library's existing extractor owns source-module/resource closure, including
  // private implementation workspaces. Clipboard does not infer bindings from code.
  const sourceClosure = extract(source, selectedRoots(source.project, copyRoots), copiedIds), extracted = sourceClosure.extracted
  const entry = extracted.entry, diagnostics = extracted.diagnostics.filter(item => item.code === 'missing-asset' || item.code === 'dynamic-resource-scope-retained')
  const components: DocumentResources['components'] = entry.resources.components
  const componentIds = new Map(Object.keys(components).map(ownerId => [ownerId, moving && sameDocument ? ownerId : `component_${crypto.randomUUID()}`]))
  const mapId = (id: string) => idMap.get(id) ?? id
  const surfaceIds = new Map<string, string>()
  const destinationOwner = topOwner(project, destination.container)
  const ownerSurfaceId = (owner: ComponentContainer | null) => owner?.kind === 'surface' ? owner.surfaceId : owner?.kind === 'instance' && project.instances[owner.instanceId]?.container ? owner.instanceId : undefined
  const sourceOwnerSurfaceId = (owner: ComponentContainer | null) => owner?.kind === 'surface' ? owner.surfaceId : owner?.kind === 'instance' && source.project.instances[owner.instanceId]?.container ? owner.instanceId : undefined
  const sourceScopeId = (id: string) => {
    const owner = topOwner(source.project, owningContainer(source.project, id))
    return owner?.kind === 'surface' ? owner.surfaceId : owner?.kind === 'instance' && localScope(source.project, owner.instanceId) ? owner.instanceId : undefined
  }
  const destinationSurfaceId = ownerSurfaceId(destinationOwner)
  const destinationScopeId = destinationOwner?.kind === 'surface' ? destinationOwner.surfaceId
    : destinationOwner?.kind === 'instance' && localScope(project, destinationOwner.instanceId) ? destinationOwner.instanceId : undefined
  const localScopeIds = new Map<string, string>()
  if (destinationScopeId && !(destination.keepOwner && sameDocument)) for (const id of copiedIds) {
    const scopeId = sourceScopeId(id)
    if (scopeId) localScopeIds.set(scopeId, destinationScopeId)
  }
  if (!sameDocument && destinationSurfaceId) for (const id of copiedIds) {
    const owner = topOwner(source.project, owningContainer(source.project, id))
    const sourceSurfaceId = sourceOwnerSurfaceId(owner)
    if (sourceSurfaceId) surfaceIds.set(sourceSurfaceId, destinationSurfaceId)
    else if(owner?.kind==='global' && source.project.instances[id].visibility?.mode==='include')
      for(const surfaceId of source.project.instances[id].visibility!.surfaceIds)surfaceIds.set(surfaceId,destinationSurfaceId)
  }
  for (const id of copiedIds) if (localScope(source.project, id)) surfaceIds.set(id, mapId(id))
  const mapSurfaceId = (id: string) => surfaceIds.get(id) ?? id
  const mapLocalScopeId = (id: string) => idMap.get(id) ?? localScopeIds.get(id) ?? mapSurfaceId(id)
  const scopedStates = new Map<string, Map<string, string>>()
  const reservedStates = new Map<string, Set<string>>()
  for (const scope of componentContainers(source.project)) {
    if (idMap.has(scope.id)) continue // Its payload retains its own local IDs.
    const targetId = destination.keepOwner && sameDocument ? scope.id : destinationSurfaceId
    if (!targetId) continue
    const occupied = reservedStates.get(targetId) ?? new Set(componentSurface(project, targetId)?.presentation?.states.map(state => state.id))
    const mapping = new Map<string, string>()
    for (const state of scope.presentation?.states ?? []) {
      const id = sameDocument && scope.id === targetId || !occupied.has(state.id) ? state.id : crypto.randomUUID()
      mapping.set(state.id, id); occupied.add(id)
    }
    scopedStates.set(scope.id, mapping); reservedStates.set(targetId, occupied)
  }
  const stateTarget = (scopeId: string | undefined, stateId: string) => scopeId ? scopedStates.get(scopeId)?.get(stateId) ?? stateId : stateId
  const occupied = createProfessionalDocumentIdentityCopy(new Map(), true)
  if (moving) for (const instance of Object.values(project.instances)) {
    const key = componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
    occupied(structuredClone(instance.data), key, instance.id, true)
    for (const surface of componentContainers(project)) for (const state of surface.presentation?.states ?? []) if (state.overrides[instance.id]?.data !== undefined) occupied(structuredClone(state.overrides[instance.id].data!), key, instance.id, true)
  }
  const professionalCopy=createProfessionalDocumentIdentityCopy(idMap, moving ? id => !occupied.sourceIdentities.has(id) : false)
  const professionalData=(id:string,data:JsonValue,collect=false)=>professionalCopy(data,professionalKey(id),id,collect)
  for(const id of copiedIds)for(const data of [source.project.instances[id].data,...stateData(id)])professionalData(id,structuredClone(data),true)
  const rules = new Map<string, string>(), actions = new Map<string, string>(), stateKeys = new Map<string, string>()
  for (const id of copiedIds) if (professionalKey(id) === 'guoling.interactions') {
    for (const data of [source.project.instances[id].data, ...stateData(id)]) {
      const copy = createComponentInteractionCopyIdentities(data)
      copy.rules.forEach((value, key) => { if (!rules.has(key)) rules.set(key, moving ? key : value) })
      copy.actions.forEach((value, key) => { if (!actions.has(key)) actions.set(key, moving ? key : value) })
    }
  }
  // One interaction-domain relation supplies every owner and named-state variant.
  const familySnapshots = [associatedComponentInteractionRules(source.project, copied, familyIds),
    ...componentContainers(source.project).flatMap(surface => (surface.presentation?.states ?? []).map(state =>
      associatedComponentInteractionRules(source.project, copied, familyIds, Object.fromEntries(Object.entries(state.overrides)
        .flatMap(([id, override]) => override.data === undefined ? [] : [[id, override.data]])))))]
  const baseFamilies = familySnapshots[0]
  const stateFamilies = new Map(componentContainers(source.project).flatMap(surface => surface.presentation?.states ?? [])
    .map((state, index) => [state, familySnapshots[index + 1]] as const))
  const selectedRules = (id: string, state?: ComponentPresentation['states'][number]) =>
    (state ? stateFamilies.get(state) : baseFamilies)?.find(family => family.instance.id === id)?.rules ?? []
  const externalBehaviors = behaviorIds.filter(id => !copied.has(id)
    && familySnapshots.some(families => families.some(family => family.instance.id === id)))
  for (const families of familySnapshots) for (const family of families) if (externalBehaviors.includes(family.instance.id)) {
    const copy = createComponentInteractionCopyIdentities({ rules: family.rules } as unknown as JsonValue)
    copy.rules.forEach((value, key) => { if (!rules.has(key)) rules.set(key, moving ? key : value) })
    copy.actions.forEach((value, key) => { if (!actions.has(key)) actions.set(key, moving ? key : value) })
  }
  const inputData = new Map<string, JsonValue>()
  for (const id of copiedIds) if (professionalKey(id) === 'guoling.input') inputData.set(id, remapComponentInputData(source.project.instances[id].data,
    { fromInstanceId: id, toInstanceId: mapId(id), rules, stateKeys }))
  for (const id of copiedIds) if (professionalKey(id) === 'guoling.input') for (const data of stateData(id))
    remapComponentInputData(data, { fromInstanceId: id, toInstanceId: mapId(id), rules, stateKeys })
  if (!sameDocument) {
    for (const declaration of entry.logic?.courseState ?? []) if (!stateKeys.has(declaration.key)) stateKeys.set(declaration.key,
      project.logic?.courseState.some(existing => existing.key === declaration.key) ? `state_${crypto.randomUUID()}` : declaration.key)
    for (const id of copiedIds) for (const key of Object.values(source.project.instances[id].stateBindings ?? {})) {
      if (stateKeys.has(key) || !project.logic?.courseState.some(existing => existing.key === key)) continue
      stateKeys.set(key, `state_${crypto.randomUUID()}`)
      diagnostics.push({ code: 'state-binding-required', instanceId: id,
        message: `显式状态“${key}”没有随来源提供声明，已保留未绑定引用，未连接目标工程同名状态。` })
    }
    for (const id of copiedIds) if (professionalKey(id) === 'guoling.input') inputData.set(id, remapComponentInputData(source.project.instances[id].data,
      { fromInstanceId: id, toInstanceId: mapId(id), rules, stateKeys }))
  }
  // As in page copy, references outside the copied graph remain explicit external targets.
  // Only declared identities are rebound; prose and arbitrary component strings stay authored.
  const rewrite = (value: JsonValue) => structuredClone(value)
  const rebindRules = (data: JsonValue, instanceId?: string, scopeId?: string) => {
    const parsed = componentInteractionDataSchema.parse(data)
    const mapped = componentInteractionDataSchema.parse(remapComponentInteractionData(data, { instances: idMap, surfaces: surfaceIds, rules, actions, stateKeys }))
    for (const [index, rule] of mapped.rules.entries()) {
      const original = parsed.rules[index]
      const conditionScope = original.conditions.find(condition => condition.type === 'scene.in' && condition.sceneIds.length === 1)
      const scope = scopeId ?? (instanceId ? sourceScopeId(instanceId) : undefined)
        ?? (conditionScope?.type === 'scene.in' ? conditionScope.sceneIds[0] : undefined)
        ?? ('nodeId' in original.trigger ? sourceScopeId(original.trigger.nodeId) : undefined)
      if (rule.trigger.type === 'presentation.enter') rule.trigger.stateId = stateTarget(scope, rule.trigger.stateId)
      for (const condition of rule.conditions) if (condition.type === 'presentation.in') condition.stateIds = condition.stateIds.map(id => stateTarget(scope, id))
      for (const [actionIndex, step] of rule.actions.entries()) {
        const action = step.action, originalAction = original.actions[actionIndex].action
        if (action.type === 'presentation.set') action.stateId = stateTarget(action.containerId ?? scope, action.stateId)
        if (action.type === 'scene.go' && action.targetStateId && originalAction.type === 'scene.go') action.targetStateId = stateTarget(originalAction.sceneId, action.targetStateId)
        if ('containerId' in action && action.containerId) action.containerId = mapLocalScopeId(action.containerId)
      }
    }
    return JSON.parse(JSON.stringify(mapped)) as JsonValue
  }
  const rebindNavigation = (id: string, value: JsonValue): JsonValue => {
    if (professionalKey(id) !== 'guoling.navigation' || !value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.buttons)) return value
    return { ...value, buttons: value.buttons.map(button => {
      if (!button || typeof button !== 'object' || Array.isArray(button)) return button
      const original = button.action
      if (!original || typeof original !== 'object' || Array.isArray(original)) return button
      const action = { ...original }
      if (typeof original.containerId === 'string') action.containerId = mapLocalScopeId(original.containerId)
      if (original.type === 'scene.go' && typeof original.sceneId === 'string') {
        action.sceneId = mapSurfaceId(original.sceneId)
        if (typeof original.targetStateId === 'string') action.targetStateId = stateTarget(original.sceneId, original.targetStateId)
      }
      if (original.type === 'location.go' && typeof original.locationId === 'string') action.locationId = mapSurfaceId(original.locationId)
      return { ...button, action }
    }) }
  }
  const rebindAttachmentTarget = (value: ComponentTarget): ComponentTarget => {
    if (value.kind === 'project') return value
    if (value.kind === 'text-range') return { ...value, instanceId: mapId(value.instanceId), rangeId: professionalCopy.identity(value.rangeId), dataPath: professionalCopy.path(value.dataPath) }
    const id = value.kind === 'instance' ? value.instanceId : value.surfaceId
    if (idMap.has(id) || value.kind === 'instance' && !localScope(source.project, id)) return { kind: 'instance', instanceId: mapId(id) }
    if (destination.keepOwner && sameDocument && localScope(project, id)) return { kind: 'instance', instanceId: id }
    return destinationScopeId ? { kind: 'instance', instanceId: destinationScopeId } : { kind: 'project' }
  }
  const instances = copiedIds.map(id => {
    const item = structuredClone(source.project.instances[id])
    if (rangePopovers.has(id)) item.attachments = structuredClone(rangePopovers.get(id)!)
    return { ...item, id: mapId(id), data: professionalKey(id) === 'guoling.interactions'
      ? rebindRules(item.data, id)
      : rebindNavigation(id, professionalData(id,inputData.get(id) ?? rewrite(item.data))),
      ...(item.stateBindings ? { stateBindings: Object.fromEntries(Object.entries(item.stateBindings).map(([alias, key]) => [alias, stateKeys.get(key) ?? key])) } : {}),
      ...(item.visibility ? { visibility: { ...item.visibility, surfaceIds: [...new Set(item.visibility.surfaceIds.map(mapSurfaceId))] } } : {}),
      ...(item.flowPlacement?.paragraphAnchor ? { flowPlacement: { ...item.flowPlacement, paragraphAnchor: {
        ...item.flowPlacement.paragraphAnchor, blockId: mapId(item.flowPlacement.paragraphAnchor.blockId),
      } } } : {}),
      ...(item.style ? { style: rewrite(item.style) as typeof item.style } : {}),
      ...(item.childIds ? { childIds: item.childIds.map(mapId) } : {}),
      ...(item.attachments ? { attachments: item.attachments.map(attachment => ({ ...attachment,
        instanceId: mapId(attachment.instanceId), target: rebindAttachmentTarget(attachment.target) })) } : {}) }
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
  const definitions = Object.values(entry.definitions), assets = sourceClosure.assets, referencedAssets = new Set(sourceClosure.referencedAssets)
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
  for(const value of [...definitions.map(value=>value.implementation),...instances.map(value=>value.implementationOverride)])if(value?.kind==='source')
    for(const id of Object.values(sourceModuleBindings(value)))if(!defMap.has(id))defMap.set(id,`unresolved_${crypto.randomUUID()}`)
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
    const key=professionalKey(copiedIds[index]!)
    if(key)item.data = rebindProfessionalAssets(item.data, identities,key)
    const rebound = rebindWebAssets(item, source.project.definitions[item.definitionId], identities)
    item.data = rebound.data
    if (rebound.authoring) item.authoring = rebound.authoring
    item.definitionId = defMap.get(item.definitionId) ?? item.definitionId
    if (item.implementationOverride) item.implementationOverride = implementation(entry.example.instances[copiedIds[index]]!.implementationOverride!)
    if (item.container) item.container = rebindCourseContainerCopy(item.container, idMap, (id, data) => {
      const original = source.project.instances[id]
      if (!original) return structuredClone(data)
      const builtin = professionalKey(id)
      const reboundData = builtin === 'guoling.interactions' ? rebindRules(data, id)
        : builtin === 'guoling.input' ? remapComponentInputData(data, { fromInstanceId: id, toInstanceId: mapId(id), rules, stateKeys })
          : rebindNavigation(id, professionalData(id, structuredClone(data)))
      return rebindWebAssets({ ...original, data: builtin ? rebindProfessionalAssets(reboundData, identities, builtin) : reboundData },
        source.project.definitions[original.definitionId], identities).data
    }, assetIds, value => rebindAuthoringAssets(value, identities)!)
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
    const surface=componentContainers(project).find(value=>value.id===destinationSurfaceId)
    if(!root.frame && surface && surface.kind!=='flow') {
      const key=professionalKey(oldRoot),size=key==='guoling.table' ? [600,220] : key==='guoling.formula' ? [400,90] : key==='guoling.text' ? [400,70] : [400,300]
      root.frame=courseInsertionFrame({project,surfaceId:surface.id},size[0]!,size[1]!,{})
      delete root.flowPlacement;delete root.flowLayout
    }
    if (root.frame) {
      const parentId = owner.kind === 'instance' ? owner.instanceId : owner.kind === 'surface' ? owner.surfaceId : undefined
      const parent = parentId ? composeMatrices(componentParentMatrix(project, parentId), project.instances[parentId].frame?.transform ?? IDENTITY_MATRIX) : IDENTITY_MATRIX
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
  if(moving && sameDocument) {
    const exists=(id:string)=>Object.hasOwn(project.instances,id) || copied.has(id)
    const mergeIds=(current:readonly string[],original:readonly string[])=>{const result=[...current];for(const [index,id] of original.entries())if(copied.has(id) && exists(id) && !result.includes(id)) {
      const next=original.slice(index+1).find(value=>result.includes(value)),previous=original.slice(0,index).reverse().find(value=>result.includes(value))
      result.splice(next ? result.indexOf(next) : previous ? result.indexOf(previous)+1 : result.length,0,id)
    };return result}
    for(const original of componentContainers(source.project)){const current=componentContainers(project).find(surface=>surface.id===original.id)
      if(original.kind!=='spatial' || current?.kind!=='spatial' || !original.spatial || !current.spatial || destinationSurfaceId!==original.id)continue
      const spatial=structuredClone(current.spatial)
      for(const frame of spatial.frames){const old=original.spatial.frames.find(value=>value.id===frame.id);if(!frame.targetInstanceId && old?.targetInstanceId && copied.has(old.targetInstanceId))frame.targetInstanceId=old.targetInstanceId}
      for(const path of spatial.paths ?? []){const old=original.spatial.paths?.find(value=>value.id===path.id);if(old?.instanceIds)path.instanceIds=mergeIds(path.instanceIds ?? [],old.instanceIds)}
      for(const relation of original.spatial.relations ?? [])if((copied.has(relation.sourceInstanceId)||copied.has(relation.targetInstanceId)) && exists(relation.sourceInstanceId)&&exists(relation.targetInstanceId) && !spatial.relations?.some(value=>value.id===relation.id))(spatial.relations ??=[]).push(structuredClone(relation))
      for(const old of original.spatial.semanticZoom ?? [])if(old.instanceIds.some(id=>copied.has(id))) {
        const rule=spatial.semanticZoom?.find(value=>value.id===old.id)
        if(rule)rule.instanceIds=mergeIds(rule.instanceIds,old.instanceIds)
        else if(old.instanceIds.every(id=>copied.has(id)))(spatial.semanticZoom ??=[]).push({...structuredClone(old),instanceIds:old.instanceIds.filter(exists)})
      }
      if(!equalComponentValue(spatial,current.spatial))edits.push({type:'spatial.set',surfaceId:current.id,spatial})
    }
    const anchors=[...source.anchors ?? [],...Object.values(source.project.instances).flatMap(instance=>instance.flowPlacement?.paragraphAnchor ? [{instanceId:instance.id,placement:instance.flowPlacement}]:[])]
    const restored=new Set<string>()
    for(const {instanceId,placement} of anchors){const anchor=placement.paragraphAnchor,current=project.instances[instanceId];if(!anchor || !copied.has(anchor.blockId) || !current?.flowPlacement || current.flowPlacement.paragraphAnchor || restored.has(instanceId))continue
      const {paragraphAnchor:_anchor,...plain}=placement
      if(equalComponentValue(plain,current.flowPlacement)){edits.push({type:'instance.flowPlacement.set',instanceId,flowPlacement:structuredClone(placement)});restored.add(instanceId)}
    }
  }
  // A same-world copy includes only relationships inside the selected graph.
  // Paths, camera frames and zoom policies remain owned by the original world.
  const destinationSurface = componentContainers(project).find(surface => surface.id === destinationSurfaceId)
  const sourceSurface = componentContainers(source.project).find(surface => surface.id === destinationSurfaceId)
  if (!moving && sameDocument && !!ownerSurfaceId(destinationOwner) && destinationSurface?.kind === 'spatial' && sourceSurface?.kind === 'spatial'
    && destinationSurface.spatial && sourceSurface.spatial) {
    const relations = sourceSurface.spatial.relations?.filter(relation => idMap.has(relation.sourceInstanceId) && idMap.has(relation.targetInstanceId))
      .map(relation => ({ ...structuredClone(relation), id: crypto.randomUUID(),
        sourceInstanceId: mapId(relation.sourceInstanceId), targetInstanceId: mapId(relation.targetInstanceId) })) ?? []
    if (relations.length) edits.push({ type: 'spatial.set', surfaceId: destinationSurface.id,
      spatial: { ...structuredClone(destinationSurface.spatial), relations: [...destinationSurface.spatial.relations ?? [], ...relations] } })
  }
  const mergeCopiedRules = (current: ReturnType<typeof interactionRules>, additions: ReturnType<typeof interactionRules>) => {
    if (!moving) return [...current, ...additions]
    const restored = new Map(additions.map(rule => [rule.id, rule]))
    return [...current.map(rule => restored.get(rule.id) ?? rule), ...additions.filter(rule => !current.some(existing => existing.id === rule.id))]
  }
  const copiedBehaviorGroups: Array<{ sourceIds: string[]; instanceId: string }> = []
  if (externalBehaviors.length) {
    let owner = destination.container
    while (owner.kind === 'instance' && !localScope(project, owner.instanceId)) {
      const parent = owningContainer(project, owner.instanceId)
      if (!parent) throw new Error('粘贴目标归属已不存在')
      owner = parent
    }
    const destinationTarget: ComponentTarget = owner.kind === 'surface' ? { kind: 'instance', instanceId: owner.surfaceId }
      : owner.kind === 'instance' ? { kind: 'instance', instanceId: owner.instanceId } : { kind: 'project' }
    const groups = new Map<string, { target: ComponentTarget; sourceIds: string[]; behaviorId?: string }>()
    for (const id of externalBehaviors) {
      const family = familySnapshots.flat().find(family => family.instance.id === id)!
      const ruleTarget: ComponentTarget = family.target.kind === 'project' ? { kind: 'project' }
        : family.target.kind === 'surface' || family.target.kind === 'instance' && localScope(source.project, family.target.instanceId) && !idMap.has(family.target.instanceId) ? destinationTarget
        : family.target.kind === 'text-range' ? { ...family.target, instanceId: mapId(family.target.instanceId),
          rangeId: professionalCopy.identity(family.target.rangeId), dataPath: professionalCopy.path(family.target.dataPath) }
        : { ...family.target, instanceId: mapId(family.target.instanceId) }
      const localContainerTarget = family.target.kind === 'surface' || family.target.kind === 'instance' && localScope(source.project, family.target.instanceId)
      const behaviorId = sameDocument && (family.target.kind === 'project' || moving && !localContainerTarget) && project.instances[id] ? id : undefined
      const key = behaviorId ?? JSON.stringify(ruleTarget), group = groups.get(key) ?? { target: ruleTarget, sourceIds: [], behaviorId }
      group.sourceIds.push(id); groups.set(key, group)
    }
    for (const group of groups.values()) {
      const familyData = { rules: group.sourceIds.flatMap(id => selectedRules(id)) } as unknown as JsonValue
      const remapped = interactionRules({ id: 'clipboard-family', definitionId: 'guoling.interactions',
        data: rebindRules(familyData, group.sourceIds[0]) })
      const existing = group.behaviorId ? project.instances[group.behaviorId] : interactionBehavior(project, group.target)
      const behaviorEdits = componentRuleEdits(project, group.target, mergeCopiedRules(interactionRules(existing), remapped), undefined, existing?.id)
      if (moving && sameDocument && existing && group.target.kind !== 'project'
        && !existing.attachments?.some(attachment => attachment.instanceId === existing.id && equalComponentValue(attachment.target, group.target)))
        behaviorEdits.push({ type: 'attachments.set', instanceId: existing.id,
          attachments: [...existing.attachments ?? [], { instanceId: existing.id, target: group.target }] })
      const instanceId = existing?.id ?? behaviorEdits.find(edit => edit.type === 'instance.insert')?.rootIds[0]
      if (instanceId) copiedBehaviorGroups.push({ sourceIds: group.sourceIds, instanceId })
      edits.push(...behaviorEdits)
    }
  }
  // A normal copy keeps every named author state; the current render projection is never its source.
  const presentations = new Map<string, ComponentPresentation>()
  for (const sourceSurface of componentContainers(source.project)) for (const state of sourceSurface.presentation?.states ?? []) {
    // A copied container keeps its own local states in its canonical payload.
    if (idMap.has(sourceSurface.id)) continue
    const owned = copiedIds.filter(id => Object.hasOwn(state.overrides, id))
    const ordered = state.order?.filter(id => idMap.has(id)) ?? []
    const changesCopiedRules = externalBehaviors.some(id => state.overrides[id]?.data !== undefined
      && !equalComponentValue(selectedRules(id, state), selectedRules(id)))
    const ownsRuleState = copiedBehaviorGroups.length > 0 && (changesCopiedRules
      || copiedIds.some(id => { const owner = topOwner(source.project, owningContainer(source.project, id)); return sourceOwnerSurfaceId(owner) === sourceSurface.id }))
    if (!owned.length && !ordered.length && !ownsRuleState) continue
    const surfaceId = destination.keepOwner && sameDocument ? sourceSurface.id : destinationSurfaceId
    if (!surfaceId) throw new Error('这些对象包含局部展示状态，请选择能够承载这些状态的容器，或复制整个原容器。')
    const destinationSurface = componentContainers(project).find(surface => surface.id === surfaceId)
    if (!destinationSurface) continue
    if (destinationSurface.kind !== 'slide') {
      const baseOrder = sourceSurface.childIds.filter(id => copied.has(id))
      const stateOrder = [...ordered, ...baseOrder.filter(id => !ordered.includes(id))]
      if (owned.length || changesCopiedRules || !equalComponentValue(stateOrder, baseOrder)) {
        throw new Error('场景状态仅属于Slide，无法把这些状态并入当前容器。请粘贴到演示页面，或复制整个原容器。')
      }
      // Unrelated page states do not belong to these copied objects.
      continue
    }
    const presentation = presentations.get(surfaceId) ?? structuredClone(destinationSurface.presentation ?? { states: [] })
    const copiedStateId = stateTarget(sourceSurface.id, state.id)
    let copiedState = presentation.states.find(value => value.id === copiedStateId)
    if (!copiedState) {
      copiedState = { id: copiedStateId, title: state.title, overrides: {} }
      presentation.states.push(copiedState)
    }
    for (const id of owned) {
      const original = source.project.instances[id], override = structuredClone(state.overrides[id])
      if (override.authoring) override.authoring = rebindAuthoringAssets(override.authoring, identities)
      if (override.data !== undefined) {
        const data = professionalKey(id) === 'guoling.interactions'
          ? rebindRules(override.data, id, sourceSurface.id)
          : professionalKey(id) === 'guoling.input' ? remapComponentInputData(override.data, { fromInstanceId: id, toInstanceId: mapId(id), rules, stateKeys })
          : rebindNavigation(id, professionalData(id,rewrite(override.data)))
        const key=professionalKey(id)
        override.data = rebindWebAssets({ ...original, data: key ? rebindProfessionalAssets(data, identities,key):data },
          source.project.definitions[original.definitionId], identities).data
      }
      if (override.style) override.style = rewrite(override.style) as typeof override.style
      if (override.frame && graphRoots.includes(id)) {
        const sourceView = resolveComponentPresentation(source.project, sourceSurface.id, state.id)
        const owner = [...groups.values()].find(group => group.roots.includes(mapId(id)))?.owner ?? destination.container
        const targetView = resolveComponentPresentation(project, surfaceId, copiedState.id)
        const parentId = owner.kind === 'instance' ? owner.instanceId : owner.kind === 'surface' ? owner.surfaceId : undefined
        const parent = parentId ? composeMatrices(componentParentMatrix(targetView, parentId), targetView.instances[parentId].frame?.transform ?? IDENTITY_MATRIX) : IDENTITY_MATRIX
        override.frame = translateFrame(reparentFrame(override.frame, componentParentMatrix(sourceView, id), parent), destination.offset ?? { x: 0, y: 0 }) as ComponentFrame
      }
      copiedState.overrides[mapId(id)] = override
    }
    if (ownsRuleState) for (const group of copiedBehaviorGroups) {
      const copiedBehaviorId = group.instanceId
      const currentData = copiedState.overrides[copiedBehaviorId]?.data ?? project.instances[copiedBehaviorId]?.data ?? { rules: [] }
      const currentRules = interactionRules({ id: copiedBehaviorId, definitionId: 'guoling.interactions', data: currentData })
      const effectiveRules = group.sourceIds.flatMap(id => selectedRules(id, state))
      const rebound = interactionRules({ id: 'clipboard-state', definitionId: 'guoling.interactions', data: rebindRules({ rules: effectiveRules } as unknown as JsonValue,
        group.sourceIds[0], sourceSurface.id) })
      copiedState.overrides[copiedBehaviorId] = { ...copiedState.overrides[copiedBehaviorId], data: { rules: mergeCopiedRules(currentRules, rebound) } as unknown as JsonValue }
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
  return { edits, idMap, professionalIdentities: professionalCopy.identities, assetIds, rootIds: selected, diagnostics,
    readPaths: sameDocument ? [...copiedIds.map(id => ['instances', id]),
      ...externalBehaviors.flatMap(id => [['instances', id, 'data'], ['instances', id, 'attachments'], ['@owner', id]]),
      ...componentContainers(source.project).filter(surface => surface.presentation?.states.some(state =>
        [...copiedIds, ...externalBehaviors].some(id => Object.hasOwn(state.overrides, id)))).map(surface => ['@surface', surface.id, 'presentation'])] : [] }
}
