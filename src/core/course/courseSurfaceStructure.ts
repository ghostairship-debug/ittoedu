import { componentContainerForInstance, componentContainers, componentSurface, componentSurfaces, containerChildIds, owningContainer } from '../../shared/contracts/component-platform/project'
import { createProfessionalDocumentIdentityCopy } from '../components/library/professionalCopy'
import type { ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'
import { associatedComponentInteractionRules, interactionRules, componentInteractionDataSchema, createComponentInteractionCopyIdentities, remapComponentInteractionData } from '../../shared/componentInteractionData'
import { remapComponentInputData } from '../../components/input/authoring'
import { rebindCourseContainerCopy } from './courseObjectEdits'

export const LAST_COURSE_PAGE_REASON = '这是最后一个页面，不能删除'

/** UI and Agent authoring share the same empty surface defaults. */
export function createCourseSurface(project: CourseProjectV10,
  input: { kind: ComponentSurface['kind']; title?: string; referenceSurfaceId?: string },
  createId: () => string = () => crypto.randomUUID()): ComponentSurface {
  const { kind } = input
  const reference = componentContainers(project).find(surface => surface.id === input.referenceSurfaceId)
  const design = reference?.designSize ?? componentContainers(project).find(surface => surface.kind === 'slide')?.designSize ?? { width: 1280, height: 720 }
  const title = input.title === undefined
    ? kind === 'slide' ? '第 ' + (componentSurfaces(project).filter(surface => surface.kind === 'slide').length + 1) + ' 页'
      : kind === 'flow' ? '新流式讲义' : '新无限画布'
    : input.title.trim()
  return { id: createId(), kind, title, childIds: [],
    designSize: structuredClone(design),
    ...(kind === 'flow' ? { flow: { layout: { widthMode: 'reading' as const, readingWidth: design.width, wideContentWidth: design.width } } } : {}),
    ...(kind === 'spatial' ? { spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } : {}) }
}

export function assertCourseSurfaceRemoval(project: CourseProjectV10, surfaceId?: string): void {
  if (surfaceId && !project.rootIds.includes(surfaceId)) return
  if (project.rootIds.length <= 1) throw new Error(LAST_COURSE_PAGE_REASON)
}

/** Copies the owned graph once. Definitions/assets remain shared; internal targets follow the copy. */
export function duplicateSurfaceEdits(project: CourseProjectV10, surfaceId: string, createId: () => string = () => crypto.randomUUID()): { edits: ComponentEdit[]; surface: ComponentSurface; surfaceId: string; ids: ReadonlyMap<string, string>; readPaths: string[][] } {
  const source = componentSurface(project, surfaceId)
  if (!source) throw new Error('页面已经不存在')
  const ids = new Map<string, string>()
  const visit = (id: string) => {
    if (ids.has(id)) return
    const instance = project.instances[id]
    if (!instance) throw new Error('页面包含不存在的对象')
    ids.set(id, createId())
    instance.childIds?.forEach(visit)
  }
  visit(surfaceId)
  const selected = new Set(ids.keys())
  const snapshots = [associatedComponentInteractionRules(project, selected), ...(source.presentation?.states ?? []).map(state =>
    associatedComponentInteractionRules(project, selected, new Set(), Object.fromEntries(Object.entries(state.overrides)
      .flatMap(([id, override]) => override.data === undefined ? [] : [[id, override.data]]))))]
  const external = new Map(snapshots.flat().filter(family => !selected.has(family.instance.id)).map(family => [family.instance.id, family]))
  // Project programs keep their real owner; local programs outside the tree join the copied page.
  const localExternalIds = [...external].filter(([, family]) => family.target.kind !== 'project').map(([id]) => id)
  for (const id of localExternalIds) ids.set(id, createId())
  const familyRules = (id: string, stateIndex = -1) => snapshots[stateIndex + 1].find(family => family.instance.id === id)?.rules ?? []
  const copiedSurfaceId = ids.get(surfaceId)!
  const copiedSurfaces = new Map([...ids].filter(([id]) => !!project.instances[id].container))
  const states = new Map((source.presentation?.states ?? []).map(state => [state.id, createId()]))
  const frames = new Map((source.spatial?.frames ?? []).map(frame => [frame.id, createId()]))
  const stateId = (id: string) => states.get(id) ?? frames.get(id) ?? id
  const stateIdAt = (scopeId: string | undefined, id: string) => scopeId === surfaceId ? stateId(id) : id
  const scopeFor = (instance: ComponentInstance) => {
    const attached = instance.attachments?.find(value => value.instanceId === instance.id)?.target
    return attached?.kind === 'surface' ? attached.surfaceId
      : attached?.kind === 'instance' && project.instances[attached.instanceId]?.container ? attached.instanceId
        : componentContainerForInstance(project, instance.id)?.id
  }
  const ownedStates = componentContainers(project).filter(surface => ids.has(surface.id)).flatMap(surface => surface.presentation?.states ?? [])
  const rules = new Map<string, string>(), actions = new Map<string, string>(), stateKeys = new Map<string, string>()
  const professionalKey = (instance: ComponentInstance) => componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  const ruleIdentities = (data: ComponentInstance['data']) => {
    const copy = createComponentInteractionCopyIdentities(data)
    for (const [from, to] of copy.rules) if (!rules.has(from)) rules.set(from, to)
    for (const [from, to] of copy.actions) if (!actions.has(from)) actions.set(from, to)
  }
  for (const id of ids.keys()) if (professionalKey(project.instances[id]!) === 'guoling.interactions') {
    ruleIdentities(external.has(id) ? { rules: familyRules(id) } as unknown as ComponentInstance['data'] : project.instances[id]!.data)
    for (const state of ownedStates) if (state.overrides[id]?.data !== undefined) ruleIdentities(state.overrides[id]!.data!)
    for (const [index] of (source.presentation?.states ?? []).entries()) if (external.has(id)) ruleIdentities({ rules: familyRules(id, index) } as unknown as ComponentInstance['data'])
  }
  for (const [id, family] of external) if (family.target.kind === 'project') {
    for (let index = -1; index < (source.presentation?.states.length ?? 0); index++) ruleIdentities({ rules: familyRules(id, index) } as unknown as ComponentInstance['data'])
  }
  const rebindInput = (instance: ComponentInstance) => remapComponentInputData(instance.data, {
    fromInstanceId: instance.id, toInstanceId: ids.get(instance.id) ?? instance.id, rules, stateKeys,
  })
  // Allocate managed state keys before rebinding any rule condition/action.
  for (const id of ids.keys()) if (professionalKey(project.instances[id]!) === 'guoling.input') {
    rebindInput(project.instances[id]!)
    for (const state of ownedStates) if (state.overrides[id]?.data !== undefined) rebindInput({ ...project.instances[id]!, data: state.overrides[id]!.data! })
  }
  const identities = { instances: ids, surfaces: copiedSurfaces, rules, actions, stateKeys }
  const rebindData = (instance: ComponentInstance) => {
    const key = professionalKey(instance)
    if (key === 'guoling.interactions') {
      const original = componentInteractionDataSchema.parse(instance.data)
      const data = componentInteractionDataSchema.parse(remapComponentInteractionData(instance.data, identities))
      for (const [index, rule] of data.rules.entries()) {
        const sourceRule = original.rules[index], conditionScope = sourceRule.conditions.find(condition => condition.type === 'scene.in' && condition.sceneIds.length === 1)
        const scope = scopeFor(instance) ?? (conditionScope?.type === 'scene.in' ? conditionScope.sceneIds[0] : undefined)
          ?? ('nodeId' in sourceRule.trigger ? componentContainerForInstance(project, sourceRule.trigger.nodeId)?.id : undefined)
        if (rule.trigger.type === 'presentation.enter') rule.trigger.stateId = stateIdAt(scope, rule.trigger.stateId)
        for (const condition of rule.conditions) if (condition.type === 'presentation.in') condition.stateIds = condition.stateIds.map(id => stateIdAt(scope, id))
        for (const { action } of rule.actions) {
          if (action.type === 'presentation.set') action.stateId = stateIdAt(action.containerId ?? scope, action.stateId)
          if (action.type === 'scene.go' && action.sceneId === copiedSurfaceId && action.targetStateId) action.targetStateId = stateId(action.targetStateId)
          if ('containerId' in action && action.containerId) action.containerId = copiedSurfaces.get(action.containerId) ?? action.containerId
        }
      }
      return JSON.parse(JSON.stringify(data)) as ComponentInstance['data']
    }
    if (key === 'guoling.input') return rebindInput(instance)
    const data = structuredClone(instance.data)
    if (key !== 'guoling.navigation' || !data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.buttons)) return data
    return { ...data, buttons: data.buttons.map(button => {
      if (!button || typeof button !== 'object' || Array.isArray(button)) return button
      const action = button.action
      if (!action || typeof action !== 'object' || Array.isArray(action)) return button
      const mapped = { ...action }
      if (typeof action.containerId === 'string') mapped.containerId = copiedSurfaces.get(action.containerId) ?? action.containerId
      if (action.type === 'scene.go' && typeof action.sceneId === 'string') {
        mapped.sceneId = copiedSurfaces.get(action.sceneId) ?? action.sceneId
        if (typeof action.targetStateId === 'string') mapped.targetStateId = stateIdAt(action.sceneId, action.targetStateId)
      }
      return { ...button, action: mapped }
    }) }
  }
  const professionalCopy = createProfessionalDocumentIdentityCopy(ids)
  for (const id of ids.keys()) { const instance = project.instances[id]; professionalCopy(structuredClone(instance.data), professionalKey(instance), id, true) }
  const frameIds = frames
  const instances: ComponentInstance[] = [...ids].map(([id, copiedId]) => {
    const copy = structuredClone(project.instances[id]!)
    if (external.has(id)) copy.data = { rules: familyRules(id) } as unknown as ComponentInstance['data']
    return { ...copy, id: copiedId, data: professionalCopy(rebindData(copy), professionalKey(copy), copy.id),
      ...(copy.container ? { container: rebindCourseContainerCopy(copy.container, ids, (id, data) => project.instances[id]
        ? professionalCopy(rebindData({ ...project.instances[id], data }), professionalKey(project.instances[id]), id) : structuredClone(data)) } : {}),
      ...(copy.stateBindings ? { stateBindings: Object.fromEntries(Object.entries(copy.stateBindings).map(([alias, key]) => [alias, stateKeys.get(key) ?? key])) } : {}),
      ...(copy.visibility ? { visibility: { ...copy.visibility,
        surfaceIds: copy.visibility.surfaceIds.map(id => copiedSurfaces.get(id) ?? id) } } : {}),
      ...(copy.flowPlacement?.paragraphAnchor ? { flowPlacement: { ...copy.flowPlacement, paragraphAnchor: { ...copy.flowPlacement.paragraphAnchor,
        blockId: ids.get(copy.flowPlacement.paragraphAnchor.blockId) ?? copy.flowPlacement.paragraphAnchor.blockId } } } : {}),
      ...(copy.childIds ? { childIds: copy.childIds.map(child => ids.get(child)!) } : {}),
      ...(copy.attachments ? { attachments: copy.attachments.map(attachment => ({ ...attachment,
        instanceId: ids.get(attachment.instanceId) ?? attachment.instanceId,
        target: attachment.target.kind === 'text-range' ? { ...attachment.target, instanceId: ids.get(attachment.target.instanceId) ?? attachment.target.instanceId, rangeId: professionalCopy.identity(attachment.target.rangeId), dataPath: professionalCopy.path(attachment.target.dataPath) } : attachment.target.kind === 'instance' ? { kind: 'instance' as const, instanceId: ids.get(attachment.target.instanceId) ?? attachment.target.instanceId }
          : attachment.target.kind === 'surface' ? { kind: 'instance' as const, instanceId: copiedSurfaces.get(attachment.target.surfaceId) ?? attachment.target.surfaceId } : attachment.target,
      })) } : {}),
    }
  })
  const surface: ComponentSurface = { ...structuredClone(source), id: copiedSurfaceId, title: source.title + ' 副本', childIds: [...source.childIds, ...localExternalIds].map(id => ids.get(id)!) }
  if (surface.presentation) surface.presentation = { ...surface.presentation,
    ...(surface.presentation.initialStateId ? { initialStateId: stateId(surface.presentation.initialStateId) } : {}),
    ...(surface.presentation.thumbnailStateId ? { thumbnailStateId: stateId(surface.presentation.thumbnailStateId) } : {}),
    states: surface.presentation.states.map((state, stateIndex) => ({ ...state, id: states.get(state.id)!,
      overrides: Object.fromEntries(Object.entries(state.overrides).map(([id, override]) => [ids.get(id) ?? id, { ...override,
        ...(override.data !== undefined ? { data: external.has(id)
          ? external.get(id)!.target.kind === 'project'
            ? JSON.parse(JSON.stringify({ rules: [...interactionRules({ ...project.instances[id], data: override.data }), ...interactionRules({ ...project.instances[id], data: rebindData({ ...project.instances[id], data: { rules: familyRules(id, stateIndex) } as unknown as ComponentInstance['data'] }) })] })) as ComponentInstance['data']
            : rebindData({ ...project.instances[id], data: { rules: familyRules(id, stateIndex) } as unknown as ComponentInstance['data'] })
          : professionalCopy(rebindData({ ...project.instances[id], data: override.data }), professionalKey(project.instances[id]), id) } : {}) }])),
      ...(state.order ? { order: state.order.map(id => ids.get(id) ?? id) } : {}),
    })) }
  for (const [stateIndex, state] of (source.presentation?.states ?? []).entries()) for (const [id, family] of external) {
    if (state.overrides[id]?.data !== undefined || JSON.stringify(familyRules(id, stateIndex)) === JSON.stringify(familyRules(id))) continue
    const rebound = interactionRules({ ...family.instance, data: rebindData({ ...family.instance,
      data: { rules: familyRules(id, stateIndex) } as unknown as ComponentInstance['data'] }) })
    const copiedState = surface.presentation!.states[stateIndex], targetId = ids.get(id) ?? id
    copiedState.overrides[targetId] = { ...copiedState.overrides[targetId], data: JSON.parse(JSON.stringify({ rules: family.target.kind === 'project'
      ? [...interactionRules(family.instance), ...rebound] : rebound })) as ComponentInstance['data'] }
  }
  if (surface.spatial) {
    const instanceId = (id: string) => ids.get(id) ?? id
    surface.spatial.frames = surface.spatial.frames.map(frame => ({ ...frame, id: frameIds.get(frame.id)!,
      ...(frame.targetInstanceId ? { targetInstanceId: instanceId(frame.targetInstanceId) } : {}) }))
    const pathIds = new Map((surface.spatial.paths ?? []).map(path => [path.id, createId()]))
    if (surface.spatial.defaultPathId) surface.spatial.defaultPathId = pathIds.get(surface.spatial.defaultPathId)!
    surface.spatial.paths = surface.spatial.paths?.map(path => ({ ...path, id: pathIds.get(path.id)!, frameIds: path.frameIds.map(id => frameIds.get(id) ?? id),
      ...(path.instanceIds ? { instanceIds: path.instanceIds.map(instanceId) } : {}) }))
    surface.spatial.relations = surface.spatial.relations?.map(relation => ({ ...relation, id: createId(), sourceInstanceId: instanceId(relation.sourceInstanceId), targetInstanceId: instanceId(relation.targetInstanceId) }))
    surface.spatial.semanticZoom = surface.spatial.semanticZoom?.map(rule => ({ ...rule, id: createId(), instanceIds: rule.instanceIds.map(instanceId) }))
  }
  const root = instances.find(instance => instance.id === copiedSurfaceId)!
  const { id: _id, title: _title, childIds: _children, ...configuration } = surface
  root.name = surface.title; root.childIds = surface.childIds; root.container = configuration
  const owner = owningContainer(project, surfaceId)
  if (!owner) throw new Error('容器归属已经不存在')
  const edits: ComponentEdit[] = [{ type: 'instance.insert', container: owner,
    index: containerChildIds(project, owner).indexOf(surfaceId) + 1, instances, rootIds: [copiedSurfaceId] }]
  for (const [id, family] of external) if (family.target.kind === 'project') {
    const rebound = interactionRules({ ...family.instance, data: rebindData({ ...family.instance, data: { rules: familyRules(id) } as unknown as ComponentInstance['data'] }) })
    edits.push({ type: 'data.set', instanceId: id, path: ['rules'], value: JSON.parse(JSON.stringify([...interactionRules(family.instance), ...rebound])) })
  }
  // Global decorations stay shared; the copied page inherits the source page's scope membership.
  const visitedGlobals = new Set<string>()
  const inheritGlobalScope = (id: string) => {
    if (visitedGlobals.has(id)) return
    visitedGlobals.add(id)
    const instance = project.instances[id]
    if (!instance) return
    const visibility = instance.visibility
    if (visibility && visibility.mode !== 'all' && visibility.surfaceIds.includes(surfaceId)) {
      edits.push({ type: 'instance.patch', instanceId: id, patch: { visibility: { ...visibility,
        surfaceIds: [...visibility.surfaceIds, copiedSurfaceId] } } })
    }
    instance.childIds?.forEach(inheritGlobalScope)
  }
  ;[...project.global.underlay, ...project.global.overlay].forEach(inheritGlobalScope)
  if (project.logic && stateKeys.size) {
    const logic = structuredClone(project.logic)
    for (const [from, to] of stateKeys) {
      const declaration = project.logic.courseState.find(state => state.key === from)
      if (declaration && !logic.courseState.some(state => state.key === to)) logic.courseState.push({ ...declaration, key: to })
    }
    edits.push({ type: 'project.logic.set', logic })
  }
  return { edits, surface, surfaceId: copiedSurfaceId, ids, readPaths: [['@surface', surfaceId],
    ...[...selected].map(id => ['instances', id]), ...[...external.keys()].flatMap(id => [['instances', id, 'data'], ['instances', id, 'attachments'], ['@owner', id]])] }
}
