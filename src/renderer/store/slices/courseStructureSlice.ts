import type { EditorStoreKernel } from '../editorStoreKernel'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { rebindDeclaredTargets } from '../../../core/components/library/references'
import { createComponentInteractionCopyIdentities, remapComponentInteractionData } from '../../interactions/componentInteractionAuthoring'
import { remapComponentInputData } from '../../../components/input/authoring'
import type { CapturedComponentOperation } from '../../documents/CourseV10DocumentBridge'
import type { CourseEditorDropdownAction, CourseEditorPrimaryAction } from '../../course/courseEditorLayout'
import type { SlideCanvasSize } from '../../../shared/slideCanvas'
import { assertCourseSurfaceRemoval, createCourseSurface, LAST_COURSE_PAGE_REASON } from '../../../core/course/courseSurfaceStructure'

export type CourseStructureResult = { readonly ok: boolean; readonly reason?: string; readonly activatedLocationId?: string }
export type CourseStructurePorts = { readActiveLocationId(): string | null }
export { LAST_COURSE_PAGE_REASON } from '../../../core/course/courseSurfaceStructure'

/** Copies the owned graph once. Definitions/assets remain shared; internal targets follow the copy. */
export function duplicateSurfaceEdits(project: CourseProjectV10, surfaceId: string, createId = () => crypto.randomUUID()): { edits: ComponentEdit[]; surfaceId: string } {
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
  const rules = new Map<string, string>(), actions = new Map<string, string>(), stateKeys = new Map<string, string>()
  const ruleIdentities = (data: ComponentInstance['data']) => {
    const copy = createComponentInteractionCopyIdentities(data)
    for (const [from, to] of copy.rules) if (!rules.has(from)) rules.set(from, to)
    for (const [from, to] of copy.actions) if (!actions.has(from)) actions.set(from, to)
  }
  for (const id of ids.keys()) if (project.instances[id]!.definitionId === 'guoling.interactions') {
    ruleIdentities(project.instances[id]!.data)
    for (const state of source.presentation?.states ?? []) if (state.overrides[id]?.data !== undefined) ruleIdentities(state.overrides[id]!.data!)
  }
  const rebindInput = (instance: ComponentInstance) => remapComponentInputData(instance.data, {
    fromInstanceId: instance.id, toInstanceId: ids.get(instance.id) ?? instance.id, rules, stateKeys,
  })
  // Allocate managed state keys before rebinding any rule condition/action.
  for (const id of ids.keys()) if (project.instances[id]!.definitionId === 'guoling.input') {
    rebindInput(project.instances[id]!)
    for (const state of source.presentation?.states ?? []) if (state.overrides[id]?.data !== undefined) rebindInput({ ...project.instances[id]!, data: state.overrides[id]!.data! })
  }
  const identities = { instances: ids, surfaces: new Map([[surfaceId, copiedSurfaceId]]), rules, actions, stateKeys }
  const rebindData = (instance: ComponentInstance) => instance.definitionId === 'guoling.interactions'
    ? remapComponentInteractionData(instance.data, identities)
    : instance.definitionId === 'guoling.input' ? rebindInput(instance)
    : rebindDeclaredTargets(instance.data, value => ids.get(value) ?? value, value => value === surfaceId ? copiedSurfaceId : value)
  const frameIds = new Map((source.spatial?.frames ?? []).map(frame => [frame.id, createId()]))
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
  if (surface.presentation) surface.presentation.states = surface.presentation.states.map(state => ({ ...state,
    overrides: Object.fromEntries(Object.entries(state.overrides).map(([id, override]) => [ids.get(id) ?? id, { ...override,
      ...(override.data !== undefined ? { data: rebindData({ ...project.instances[id], data: override.data }) } : {}) }])),
    ...(state.order ? { order: state.order.map(id => ids.get(id) ?? id) } : {}),
  }))
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
  return { edits, surfaceId: copiedSurfaceId }
}

export function createCourseStructureSlice(kernel: EditorStoreKernel, ports: CourseStructurePorts) {
  const failure = (reason: string): CourseStructureResult => {
    kernel.setFeedback({ errorMessage: reason, statusMessage: null })
    return { ok: false, reason }
  }
  const commit = async (edits: ComponentEdit[], message: string, activatedLocationId?: string, captured?: CapturedComponentOperation): Promise<CourseStructureResult> => {
    try {
      if (edits.length) {
        if (captured) await kernel.editCaptured(captured)
        else await kernel.edit(edits)
      }
      kernel.setFeedback({ errorMessage: null, statusMessage: message })
      return { ok: true, activatedLocationId }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '页面操作失败'
      return failure(reason)
    }
  }
  return {
    async addCourseContent(action: CourseEditorPrimaryAction | CourseEditorDropdownAction, options: { surfaceId?: string } = {}): Promise<CourseStructureResult> {
      const project = kernel.readDocument()
      const kind = action === 'flow-page' ? 'flow' : action === 'spatial-page' ? 'spatial' : 'slide'
      const current = project.surfaces.find(surface => surface.id === options.surfaceId)
      const surface = createCourseSurface(project, { kind, referenceSurfaceId: current?.id })
      const index = action === 'scene' && current ? project.surfaces.indexOf(current) + 1 : project.surfaces.length
      return commit([{ type: 'surface.insert', surface, index }], '已新增页面', surface.id)
    },
    addScene(): Promise<CourseStructureResult> {
      const project = kernel.readDocument()
      const surface = project.surfaces.find(value => value.id === ports.readActiveLocationId())
      return this.addCourseContent(surface?.kind === 'flow' ? 'flow-page' : surface?.kind === 'spatial' ? 'spatial-page' : 'scene', { surfaceId: surface?.id })
    },
    reorderCourseSurfaces(surfaceIds: string[]): Promise<CourseStructureResult> {
      const project = kernel.readDocument()
      if (surfaceIds.length !== project.surfaces.length || new Set(surfaceIds).size !== surfaceIds.length || surfaceIds.some(id => !project.surfaces.some(s => s.id === id))) return Promise.resolve(failure('页面顺序已改变，请重新拖动'))
      const order = project.surfaces.map(surface => surface.id)
      const edits: ComponentEdit[] = []
      surfaceIds.forEach((id, index) => { const previous = order.indexOf(id); if (previous !== index) { edits.push({ type: 'surface.move', surfaceId: id, index }); order.splice(previous, 1); order.splice(index, 0, id) } })
      return commit(edits, '已调整页面顺序')
    },
    captureCourseSurfaceDelete(surfaceId: string): CapturedComponentOperation {
      const target = kernel.captureTarget()
      assertCourseSurfaceRemoval(target.project)
      return kernel.capture([{ type: 'surface.remove', surfaceId }], target)
    },
    deleteCourseSurface(surfaceId: string, captured?: CapturedComponentOperation): Promise<CourseStructureResult> {
      if (!captured) {
        try { assertCourseSurfaceRemoval(kernel.readDocument()) }
        catch { return Promise.resolve(failure(LAST_COURSE_PAGE_REASON)) }
      }
      return commit([{ type: 'surface.remove', surfaceId }], '已删除页面', undefined, captured)
    },
    deleteCourseLocation(surfaceId: string, captured?: CapturedComponentOperation): Promise<CourseStructureResult> { return this.deleteCourseSurface(surfaceId, captured) },
    async duplicateCourseLocation(surfaceId: string): Promise<CourseStructureResult> {
      try {
        const copy = duplicateSurfaceEdits(kernel.readDocument(), surfaceId)
        return await commit(copy.edits, '已复制页面', copy.surfaceId)
      } catch (error) { return failure(error instanceof Error ? error.message : '页面复制失败') }
    },
    renameCourseLocation(surfaceId: string, title: string): Promise<CourseStructureResult> { return this.renameCourseSurface(surfaceId, title) },
    renameCourseSurface(surfaceId: string, title: string): Promise<CourseStructureResult> {
      return commit([{ type: 'surface.title.set', surfaceId, title: title.trim() }], '已重命名')
    },
    resizeSlideCanvas(designSize: SlideCanvasSize): Promise<CourseStructureResult> {
      const edits: ComponentEdit[] = kernel.readDocument().surfaces.filter(surface => surface.kind === 'slide').map(surface => ({ type: 'surface.designSize.set', surfaceId: surface.id, designSize }))
      return commit(edits, '已修改画布尺寸')
    },
    resizeSlideSceneCanvas(surfaceId: string, _sceneId: string, designSize: SlideCanvasSize | null): Promise<CourseStructureResult> {
      return commit([{ type: 'surface.designSize.set', surfaceId, designSize }], designSize ? '已修改本页尺寸' : '已恢复默认尺寸')
    },
  }
}
