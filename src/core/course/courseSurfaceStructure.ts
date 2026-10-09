import type { ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'
import { rebindDeclaredTargets } from '../components/library/references'
import { componentInteractionDataSchema, createComponentInteractionCopyIdentities, remapComponentInteractionData } from '../../shared/componentInteractionData'
import { remapComponentInputData } from '../../components/input/authoring'

export const LAST_COURSE_PAGE_REASON = '这是最后一个页面，不能删除'

/** UI and Agent authoring share the same empty surface defaults. */
export function createCourseSurface(project: CourseProjectV10,
  input: { kind: ComponentSurface['kind']; title?: string; referenceSurfaceId?: string },
  createId: () => string = () => crypto.randomUUID()): ComponentSurface {
  const { kind } = input
  const reference = project.surfaces.find(surface => surface.id === input.referenceSurfaceId)
  const title = input.title === undefined
    ? kind === 'slide' ? '第 ' + (project.surfaces.filter(surface => surface.kind === 'slide').length + 1) + ' 页'
      : kind === 'flow' ? '新流式讲义' : '新无限画布'
    : input.title.trim()
  return { id: createId(), kind, title, childIds: [],
    ...(kind === 'slide' ? { designSize: structuredClone(reference?.designSize ?? { width: 1280, height: 720 }) } : {}),
    ...(kind === 'spatial' ? { spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } : {}) }
}

export function assertCourseSurfaceRemoval(project: CourseProjectV10): void {
  if (project.surfaces.length <= 1) throw new Error(LAST_COURSE_PAGE_REASON)
}

/** Copies the owned graph once. Definitions/assets remain shared; internal targets follow the copy. */
export function duplicateSurfaceEdits(project: CourseProjectV10, surfaceId: string, createId: () => string = () => crypto.randomUUID()): { edits: ComponentEdit[]; surfaceId: string; ids: ReadonlyMap<string, string> } {
  const source = project.surfaces.find(surface => surface.id === surfaceId)
  if (!source) throw new Error('页面已经不存在')
  const ids = new Map<string, string>()
  const visit = (id: string) => {
    if (ids.has(id)) return
    const instance = project.instances[id]
    if (!instance) throw new Error('页面包含不存在的对象')
    ids.set(id, createId())
    instance.childIds?.forEach(visit)
  }
  source.childIds.forEach(visit)
  const copiedSurfaceId = createId()
  const states = new Map((source.presentation?.states ?? []).map(state => [state.id, createId()]))
  const frames = new Map((source.spatial?.frames ?? []).map(frame => [frame.id, createId()]))
  const stateId = (id: string) => states.get(id) ?? frames.get(id) ?? id
  const rules = new Map<string, string>(), actions = new Map<string, string>(), stateKeys = new Map<string, string>()
  const professionalKey = (instance: ComponentInstance) => componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  const ruleIdentities = (data: ComponentInstance['data']) => {
    const copy = createComponentInteractionCopyIdentities(data)
    for (const [from, to] of copy.rules) if (!rules.has(from)) rules.set(from, to)
    for (const [from, to] of copy.actions) if (!actions.has(from)) actions.set(from, to)
  }
  for (const id of ids.keys()) if (professionalKey(project.instances[id]!) === 'guoling.interactions') {
    ruleIdentities(project.instances[id]!.data)
    for (const state of source.presentation?.states ?? []) if (state.overrides[id]?.data !== undefined) ruleIdentities(state.overrides[id]!.data!)
  }
  const rebindInput = (instance: ComponentInstance) => remapComponentInputData(instance.data, {
    fromInstanceId: instance.id, toInstanceId: ids.get(instance.id) ?? instance.id, rules, stateKeys,
  })
  // Allocate managed state keys before rebinding any rule condition/action.
  for (const id of ids.keys()) if (professionalKey(project.instances[id]!) === 'guoling.input') {
    rebindInput(project.instances[id]!)
    for (const state of source.presentation?.states ?? []) if (state.overrides[id]?.data !== undefined) rebindInput({ ...project.instances[id]!, data: state.overrides[id]!.data! })
  }
  const identities = { instances: ids, surfaces: new Map([[surfaceId, copiedSurfaceId]]), rules, actions, stateKeys }
  const rebindData = (instance: ComponentInstance) => {
    const key = professionalKey(instance)
    if (key === 'guoling.interactions') {
      const data = componentInteractionDataSchema.parse(remapComponentInteractionData(instance.data, identities))
      for (const rule of data.rules) {
        if (rule.trigger.type === 'presentation.enter') rule.trigger.stateId = stateId(rule.trigger.stateId)
        for (const condition of rule.conditions) if (condition.type === 'presentation.in') condition.stateIds = condition.stateIds.map(stateId)
        for (const { action } of rule.actions) {
          if (action.type === 'presentation.set') action.stateId = stateId(action.stateId)
          if (action.type === 'scene.go' && action.sceneId === copiedSurfaceId && action.targetStateId) action.targetStateId = stateId(action.targetStateId)
        }
      }
      return JSON.parse(JSON.stringify(data)) as ComponentInstance['data']
    }
    if (key === 'guoling.input') return rebindInput(instance)
    const data = rebindDeclaredTargets(instance.data, value => ids.get(value) ?? value, value => value === surfaceId ? copiedSurfaceId : value)
    if (key !== 'guoling.navigation' || !data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.buttons)) return data
    return { ...data, buttons: data.buttons.map(button => {
      if (!button || typeof button !== 'object' || Array.isArray(button)) return button
      const action = button.action
      if (!action || typeof action !== 'object' || Array.isArray(action) || action.type !== 'scene.go' || action.sceneId !== surfaceId) return button
      return { ...button, action: { ...action, sceneId: copiedSurfaceId,
        ...(typeof action.targetStateId === 'string' ? { targetStateId: stateId(action.targetStateId) } : {}) } }
    }) }
  }
  const frameIds = frames
  const instances: ComponentInstance[] = [...ids].map(([id, copiedId]) => {
    const copy = structuredClone(project.instances[id]!)
    return { ...copy, id: copiedId, data: rebindData(copy),
      ...(copy.visibility ? { visibility: { ...copy.visibility,
        surfaceIds: copy.visibility.surfaceIds.map(id => id === surfaceId ? copiedSurfaceId : id) } } : {}),
      ...(copy.flowPlacement?.paragraphAnchor ? { flowPlacement: { ...copy.flowPlacement, paragraphAnchor: { ...copy.flowPlacement.paragraphAnchor,
        blockId: ids.get(copy.flowPlacement.paragraphAnchor.blockId) ?? copy.flowPlacement.paragraphAnchor.blockId } } } : {}),
      ...(copy.childIds ? { childIds: copy.childIds.map(child => ids.get(child)!) } : {}),
      ...(copy.attachments ? { attachments: copy.attachments.map(attachment => ({ ...attachment,
        instanceId: ids.get(attachment.instanceId) ?? attachment.instanceId,
        target: attachment.target.kind === 'instance' ? { kind: 'instance' as const, instanceId: ids.get(attachment.target.instanceId) ?? attachment.target.instanceId }
          : attachment.target.kind === 'surface' ? { kind: 'surface' as const, surfaceId: attachment.target.surfaceId === surfaceId ? copiedSurfaceId : attachment.target.surfaceId } : attachment.target,
      })) } : {}),
    }
  })
  const surface: ComponentSurface = { ...structuredClone(source), id: copiedSurfaceId, title: source.title + ' 副本', childIds: [] }
  if (surface.presentation) surface.presentation = { ...surface.presentation,
    ...(surface.presentation.initialStateId ? { initialStateId: stateId(surface.presentation.initialStateId) } : {}),
    ...(surface.presentation.thumbnailStateId ? { thumbnailStateId: stateId(surface.presentation.thumbnailStateId) } : {}),
    states: surface.presentation.states.map(state => ({ ...state, id: states.get(state.id)!,
      overrides: Object.fromEntries(Object.entries(state.overrides).map(([id, override]) => [ids.get(id) ?? id, { ...override,
        ...(override.data !== undefined ? { data: rebindData({ ...project.instances[id], data: override.data }) } : {}) }])),
      ...(state.order ? { order: state.order.map(id => ids.get(id) ?? id) } : {}),
    })) }
  if (surface.spatial) {
    const instanceId = (id: string) => ids.get(id) ?? id
    surface.spatial.frames = surface.spatial.frames.map(frame => ({ ...frame, id: frameIds.get(frame.id)!,
      ...(frame.targetInstanceId ? { targetInstanceId: instanceId(frame.targetInstanceId) } : {}) }))
    surface.spatial.paths = surface.spatial.paths?.map(path => ({ ...path, id: createId(), frameIds: path.frameIds.map(id => frameIds.get(id) ?? id),
      ...(path.instanceIds ? { instanceIds: path.instanceIds.map(instanceId) } : {}) }))
    surface.spatial.relations = surface.spatial.relations?.map(relation => ({ ...relation, id: createId(), sourceInstanceId: instanceId(relation.sourceInstanceId), targetInstanceId: instanceId(relation.targetInstanceId) }))
    surface.spatial.semanticZoom = surface.spatial.semanticZoom?.map(rule => ({ ...rule, id: createId(), instanceIds: rule.instanceIds.map(instanceId) }))
  }
  const edits: ComponentEdit[] = [{ type: 'surface.insert', surface, index: project.surfaces.indexOf(source) + 1 }]
  if (instances.length) edits.push({ type: 'instance.insert', container: { kind: 'surface', surfaceId: copiedSurfaceId }, index: 0,
    instances, rootIds: source.childIds.map(id => ids.get(id)!) })
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
  return { edits, surfaceId: copiedSurfaceId, ids }
}
