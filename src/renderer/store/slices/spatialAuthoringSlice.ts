import type { ComponentContainer, ComponentDefinition, ComponentEdit, ComponentSpatialAuthoring, ComponentSpatialPose, JsonValue } from '../../../shared/contracts/component-platform'
import { createTextData, createFormulaData, TEXT_DEFINITION, FORMULA_DEFINITION } from '../../../components/text'
import { defaultShapeData, SHAPE_DEFINITION, shapeDataSchema } from '../../../components/shape'
import { createTableData, TABLE_DEFINITION } from '../../../components/table'
import { createChartData, CHART_DEFINITION, chartDataSchema } from '../../../components/chart'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../editorStoreKernel'
import { fitSpatialComponentWorld } from '../../componentPlatform/surfaces/spatial/cameraCommands'
import { addSpatialCameraFrameEdit, deleteSpatialCameraFrameEdit, renameSpatialCameraFrameEdit, reorderSpatialCameraFramesEdit, setSpatialCameraHomeEdit,
  updateSpatialCameraFrameEdit, updateSpatialCameraFrameTargetEdit, addSpatialGraphItemEdit, updateSpatialGraphItemEdit, deleteSpatialGraphItemEdit } from '../../../core/course/courseSpatialEdits'
import { spatialFramePose } from '../../../player/surfaces/spatial/componentPlatform/graph'
import { spatialWorldTargets } from '../../componentPlatform/surfaces/spatial/targets'
import type { SpatialViewportRequest, SpatialViewportCapture } from '../../../shared/workbench/spatialViewport'

export type SpatialGraphSelection = { kind: 'path' | 'relation'; id: string } | null
export interface SpatialSurfaceViewState {
  camera: ComponentSpatialPose
  viewport?: { width: number; height: number }
  activeCameraFrameId: string | null
  showCameraFrames: boolean
  playbackPathId: string | null
  playbackStepIndex: number | null
  scope: 'world' | 'global' | 'surface'
  graphSelection: SpatialGraphSelection
}
export interface SpatialOwnedState { spatialViewStates: Record<string, Record<string, SpatialSurfaceViewState>> }
export function createInitialSpatialOwnedState(): SpatialOwnedState { return { spatialViewStates: {} } }
export function initialSpatialSurfaceView(home: ComponentSpatialPose = { x: 0, y: 0, zoom: 1 }): SpatialSurfaceViewState {
  return { camera: { ...home }, activeCameraFrameId: null, showCameraFrames: false, playbackPathId: null, playbackStepIndex: null, scope: 'world', graphSelection: null }
}

/** View state only. Document, selection and history stay in Kernel/Bridge/Session. */
export function createSpatialAuthoringSlice(kernel: EditorStoreKernel, ports: {
  read(): SpatialOwnedState
  patch(patch: Partial<SpatialOwnedState>): void
  openPropertiesTab?(): void
  content?: { begin(instanceId: string, source?: 'canvas' | 'properties'): unknown; commit(): Promise<void>; cancel(): void }
}) {
  const target = (captured?: CapturedCourseTarget) => captured ?? kernel.captureTarget()
  const surfaceId = (id?: string) => id ?? kernel.readView().surfaceId ?? ''
  const read = (id = surfaceId(), documentId = kernel.readView().activeDocumentId ?? ''): SpatialSurfaceViewState => {
    return ports.read().spatialViewStates[documentId]?.[id] ?? initialSpatialSurfaceView(kernel.readView().views.find(view => view.documentId === documentId)?.model.project.surfaces.find(surface => surface.id === id)?.spatial?.home)
  }
  const patchView = (id: string, patch: Partial<SpatialSurfaceViewState>, documentId = kernel.readView().activeDocumentId ?? '') => {
    const old = ports.read().spatialViewStates
    ports.patch({ spatialViewStates: { ...old, [documentId]: { ...old[documentId], [id]: { ...read(id, documentId), ...patch } } } })
  }
  const apply = (edits: ComponentEdit[], captured: CapturedCourseTarget, message: string) => kernel.editCaptured(kernel.capture(edits, captured)).then(result => {
    kernel.setFeedback({ errorMessage: null, statusMessage: message }); return result
  }).catch(error => {
    kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : String(error), statusMessage: null }); throw error
  })
  const insert = async (definition: ComponentDefinition, data: unknown, width: number, height: number, x?: number, y?: number) => {
    const frozen = target(), surface = frozen.project.surfaces.find(value => value.id === frozen.surfaceId && value.kind === 'spatial')
    if (!surface) throw new Error('请先选择一个空间页面')
    const view = read(surface.id, frozen.documentId), global = view.scope === 'global'
    const container: ComponentContainer = global ? { kind: 'global', plane: 'overlay' } : { kind: 'surface', surfaceId: surface.id }
    const children = global ? frozen.project.global.overlay : surface.childIds
    const design = surface.designSize ?? { width: 1280, height: 720 }
    const center = global ? { x: design.width / 2, y: design.height / 2 } : view.camera
    // Preserve mature Spatial's staggered placement around the observed camera.
    const slot = x === undefined && y === undefined ? children.length % 24 : 0
    const frame = { width, height, transform: [1, 0, 0, 1, x ?? center.x - width / 2 + slot % 6 * 20,
      y ?? center.y - height / 2 + Math.floor(slot / 6) * 20] as [number, number, number, number, number, number] }
    const id = crypto.randomUUID(), edits: ComponentEdit[] = []
    if (!frozen.project.definitions[definition.id]) edits.push({ type: 'definition.set', definition })
    edits.push({ type: 'instance.insert', container, index: children.length, rootIds: [id],
      instances: [{ id, definitionId: definition.id, data: JSON.parse(JSON.stringify(data)) as JsonValue, frame }] })
    await ports.content?.commit()
    await apply(edits, frozen, '已添加内容')
    kernel.selectInstances([id], surface.id, frozen.documentId)
    return id
  }
  const addShapeNode = (type: string, x?: number, y?: number) =>
    insert(SHAPE_DEFINITION, shapeDataSchema.parse(defaultShapeData(type as Parameters<typeof defaultShapeData>[0])), 320, 180, x, y)
  const actions = {
    addTextNode: (x?: number, y?: number) => insert(TEXT_DEFINITION, createTextData('双击编辑文字'), 320, 80, x, y),
    addFormulaNode: (x?: number, y?: number) => insert(FORMULA_DEFINITION, createFormulaData(crypto.randomUUID(), 'x^2'), 420, 160, x, y),
    addRectangleNode: (x?: number, y?: number) => addShapeNode('rectangle', x, y),
    addShapeNode,
    addTableNode: (x?: number, y?: number) => insert(TABLE_DEFINITION, createTableData(), 560, 360, x, y),
    addChartNode(type: 'bar' | 'line' | 'area' | 'pie' | 'donut' = 'bar', x?: number, y?: number) {
      const initial = createChartData()
      const style = type === 'pie' || type === 'donut'
        ? { backgroundColor: initial.style.backgroundColor, backgroundOpacity: initial.style.backgroundOpacity,
          fontFamily: initial.style.fontFamily, fontSize: initial.style.fontSize, textColor: initial.style.textColor,
          showLegend: initial.style.showLegend, legendPosition: initial.style.legendPosition, showDataLabels: initial.style.showDataLabels,
          ...(type === 'donut' ? { holeSize: 50 } : {}) } : initial.style
      return insert(CHART_DEFINITION, chartDataSchema.parse({ ...initial, chartType: type, style }), 560, 360, x, y)
    },
    beginTextEdit: (instanceId: string, source?: 'canvas' | 'properties') => ports.content?.begin(instanceId, source),
    commitTextEdit: () => ports.content?.commit() ?? Promise.resolve(),
    cancelTextEdit: () => ports.content?.cancel(),
    readSpatialView: read,
    captureSpatialViewport(input: SpatialViewportRequest): SpatialViewportCapture {
      const visible = kernel.readView(), frozen = kernel.captureTarget(input.documentId)
      const view = ports.read().spatialViewStates[input.documentId]?.[input.surfaceId]
      if (frozen.epoch !== input.epoch) throw new Error('原空间文档身份已变化，请重新观察。')
      if (visible.activeDocumentId !== input.documentId || visible.surfaceId !== input.surfaceId
        || !frozen.project.surfaces.some(surface => surface.id === input.surfaceId && surface.kind === 'spatial') || !view?.viewport)
        throw new Error('当前空间视口尚未运行，请打开原空间视口后重试。')
      return { ...input, revision: frozen.project.revision, pose: structuredClone(view.camera),
        viewport: { ...view.viewport }, source: 'spatial-view-state' }
    },
    captureSpatialTarget: () => target(),
    initializeSpatialView(id: string, documentId?: string) { patchView(id, {}, documentId) },
    setSpatialViewport(viewport: { width: number; height: number }, id = surfaceId(), documentId?: string) {
      const previous = read(id, documentId).viewport
      if (previous?.width === viewport.width && previous.height === viewport.height) return
      patchView(id, { viewport: { ...viewport } }, documentId)
    },
    setSpatialSessionCamera(camera: ComponentSpatialPose, id = surfaceId(), documentId?: string) {
      if (![camera.x, camera.y, camera.zoom, camera.rotation ?? 0].every(Number.isFinite) || camera.zoom <= 0) throw new Error('镜头位置和倍率无效')
      patchView(id, { camera: { ...camera } }, documentId)
    },
    setSpatialActiveCameraFrameId(frameId: string | null, id = surfaceId(), documentId?: string) {
      patchView(id, { activeCameraFrameId: frameId, graphSelection: null }, documentId)
    },
    setSpatialPlaybackStepIndex(playbackStepIndex: number | null, id = surfaceId(), documentId?: string) { patchView(id, { playbackStepIndex }, documentId) },
    setSpatialShowCameraFrames(show: boolean, id = surfaceId()) { patchView(id, { showCameraFrames: show }) },
    setSpatialPlaybackPathId(pathId: string | null, id = surfaceId()) { patchView(id, { playbackPathId: pathId, playbackStepIndex: null }) },
    setSpatialEditingScope(scope: SpatialSurfaceViewState['scope'], id = surfaceId()) { patchView(id, { scope }); kernel.selectInstances([], id) },
    setSpatialGraphSelection(selection: SpatialGraphSelection, id = surfaceId()) {
      patchView(id, { graphSelection: selection }); if (selection) { kernel.selectInstances([], id); ports.openPropertiesTab?.() }
    },
    activateSpatialCameraFrame(id: string, frameId: string | null) {
      const frozen = target(), surface = frozen.project.surfaces.find(surface => surface.id === id && surface.kind === 'spatial'), spatial = surface?.spatial
      const frame = frameId === null ? undefined : spatial?.frames.find(value => value.id === frameId)
      if (frameId && !frame) throw new Error('镜头已不存在')
      kernel.selectSurface(id, frozen.documentId)
      const viewport = read(id, frozen.documentId).viewport ?? surface?.designSize ?? { width: 1280, height: 720 }
      const pose = frame ? spatialFramePose(frame, viewport, spatialWorldTargets(frozen.project, id)) : spatial?.home ?? { x: 0, y: 0, zoom: 1 }
      patchView(id, { activeCameraFrameId: frameId, camera: { ...pose }, playbackStepIndex: null, graphSelection: null }, frozen.documentId)
    },
    activateCameraFrame(frameId: string) { actions.activateSpatialCameraFrame(surfaceId(), frameId) },
    addSpatialCameraFrameFromSession(id = surfaceId(), captured?: CapturedCourseTarget) {
      const frozen = target(captured); return apply([addSpatialCameraFrameEdit(frozen.project, id, read(id, frozen.documentId).camera)], frozen, '已添加镜头')
    },
    renameSpatialCameraFrame(id: string, frameId: string, title: string, captured?: CapturedCourseTarget) {
      const frozen = target(captured); return apply([renameSpatialCameraFrameEdit(frozen.project, id, frameId, title)], frozen, '镜头名称已更新')
    },
    reorderSpatialCameraFrames(id: string, frameIds: readonly string[], captured?: CapturedCourseTarget) {
      const frozen = target(captured); return apply([reorderSpatialCameraFramesEdit(frozen.project, id, frameIds)], frozen, '镜头顺序已更新')
    },
    deleteSpatialCameraFrame(id: string, frameId: string, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([deleteSpatialCameraFrameEdit(frozen.project, id, frameId)], frozen, '已删除镜头').then(result => {
        if (read(id, frozen.documentId).activeCameraFrameId === frameId) patchView(id, { activeCameraFrameId: null }, frozen.documentId)
        return result
      })
    },
    setSpatialCameraHomeFromSession(id = surfaceId(), captured?: CapturedCourseTarget) {
      const frozen = target(captured); return apply([setSpatialCameraHomeEdit(frozen.project, id, read(id, frozen.documentId).camera)], frozen, '首页镜头已更新')
    },
    updateActiveSpatialCameraFrameFromSession(id = surfaceId(), captured?: CapturedCourseTarget) {
      const frozen = target(captured), view = read(id, frozen.documentId)
      if (!view.activeCameraFrameId) throw new Error('请先选择镜头')
      return apply([updateSpatialCameraFrameEdit(frozen.project, id, view.activeCameraFrameId, view.camera)], frozen, '镜头画面已更新')
    },
    updateSpatialCameraFrameTarget(id: string, frameId: string, instanceId: string | null, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([updateSpatialCameraFrameTargetEdit(frozen.project, id, frameId, instanceId)], frozen, '镜头跟随对象已更新')
    },
    fitSpatialSessionToWorldContent(viewport?: { width: number; height: number }, id = surfaceId(), scope: 'visible' | 'all' = 'visible') {
      const project = kernel.readEditingDocument(), view = read(id)
      const size = view.viewport ?? viewport ?? project.surfaces.find(surface => surface.id === id)?.designSize ?? { width: 1280, height: 720 }
      patchView(id, { camera: fitSpatialComponentWorld(project, id, size, { scope, zoom: view.camera.zoom }) })
    },
    addSpatialPath(id: string, input: Omit<NonNullable<ComponentSpatialAuthoring['paths']>[number], 'id' | 'frameIds'> & { frameIds?: string[] }, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([addSpatialGraphItemEdit(frozen.project, id, 'paths', { ...input, frameIds: input.frameIds ?? [] })], frozen, '已添加路径')
    },
    updateSpatialPath(id: string, pathId: string, patch: Partial<Omit<NonNullable<ComponentSpatialAuthoring['paths']>[number], 'id'>>, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([updateSpatialGraphItemEdit(frozen.project, id, 'paths', pathId, patch)], frozen, '路径已更新')
    },
    deleteSpatialPath(id: string, pathId: string, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([deleteSpatialGraphItemEdit(frozen.project, id, 'paths', pathId)], frozen, '已删除路径')
    },
    addSpatialRelation(id: string, input: Omit<NonNullable<ComponentSpatialAuthoring['relations']>[number], 'id'>, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([addSpatialGraphItemEdit(frozen.project, id, 'relations', input)], frozen, '已添加关系')
    },
    updateSpatialRelation(id: string, relationId: string, patch: Partial<Omit<NonNullable<ComponentSpatialAuthoring['relations']>[number], 'id'>>, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([updateSpatialGraphItemEdit(frozen.project, id, 'relations', relationId, patch)], frozen, '关系已更新')
    },
    deleteSpatialRelation(id: string, relationId: string, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([deleteSpatialGraphItemEdit(frozen.project, id, 'relations', relationId)], frozen, '已删除关系')
    },
    addSpatialSemanticZoomRule(id: string, input: Omit<NonNullable<ComponentSpatialAuthoring['semanticZoom']>[number], 'id'>, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([addSpatialGraphItemEdit(frozen.project, id, 'semanticZoom', input)], frozen, '已添加语义缩放规则')
    },
    updateSpatialSemanticZoomRule(id: string, ruleId: string, patch: Partial<Omit<NonNullable<ComponentSpatialAuthoring['semanticZoom']>[number], 'id'>>, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([updateSpatialGraphItemEdit(frozen.project, id, 'semanticZoom', ruleId, patch)], frozen, '规则已更新')
    },
    deleteSpatialSemanticZoomRule(id: string, ruleId: string, captured?: CapturedCourseTarget) {
      const frozen = target(captured)
      return apply([deleteSpatialGraphItemEdit(frozen.project, id, 'semanticZoom', ruleId)], frozen, '已删除语义缩放规则')
    },
  }
  return actions
}
