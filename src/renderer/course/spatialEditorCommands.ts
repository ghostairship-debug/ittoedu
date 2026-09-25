import { planSpatialTextInsertion, planSpatialShapeInsertion, planSpatialFormulaInsertion, planSpatialImageInsertion, planSpatialVideoInsertion, planSpatialChartInsertion, planSpatialTableInsertion, requireWorldScope, defaultWorldOrigin, appendWorldLayer, requireSpatialAsset as requireAsset, spatialSurfaceIn, type AddSpatialWorldLayerInput, type AddSpatialWorldTextLayerInput, type AddSpatialWorldShapeLayerInput, type AddSpatialWorldImageLayerInput, type AddSpatialWorldVideoLayerInput } from '../../core/tools/spatialInsertion'
export { offsetDefaultSpatialInsertion, spatialSurfaceIn, SPATIAL_DEFAULT_INSERTION_COLUMNS, SPATIAL_DEFAULT_INSERTION_OFFSET } from '../../core/tools/spatialInsertion'
export type { AddSpatialWorldLayerInput, AddSpatialWorldTextLayerInput, AddSpatialWorldShapeLayerInput, AddSpatialWorldImageLayerInput, AddSpatialWorldVideoLayerInput, SpatialInsertionPoint } from '../../core/tools/spatialInsertion'
import { updateBodySurfaceBackground } from '../../core/tools/courseBackground'
import { tableNativeContentObjectSchema, chartNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import type { NativeTableContent, NativeChartContent } from '../../shared/contracts/native-v1'
import type { ChartType } from './chartContentOperations'
import { nanoid } from 'nanoid'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import {
  type BackgroundMode,
  type CourseProjectDocument,
  type CourseRuntimeDefinition,
  type LayerItem,
  type NativeLayerItem,
  type RuntimeLayerItem,
  type SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import {
  createExternalComponentNode,
} from '../../core/tools/nativeNodeFactories'
import {
  bumpSpatialGeneration,
  catchSpatialCommand,
  commitSpatialAuthoringHistory,
  commitSpatialProjectMutation,
  createSpatialAuthoringHistory,
  freezeSpatialSelection,
  freezeSpatialSession,
  redoSpatialAuthoringHistory,
  rejectSpatialCommand,
  rejectSpatialIfStale,
  replaceSpatialSession,
  resetSpatialAuthoringGeneration,
  SPATIAL_REJECT_LOCKED,
  SPATIAL_REJECT_STALE_REVISION,
  SPATIAL_REJECT_WRONG_OWNER,
  SpatialCommandError,
  succeedSpatialCommand,
  undoSpatialAuthoringHistory,
  type SpatialAuthoringHistory,
  type SpatialAuthoringSelection,
  type SpatialAuthoringSession,
  type SpatialAuthoringTarget,
  type SpatialCommandOptions,
  type SpatialCommandResult,
} from './spatialAuthoringHistory'
import {
  buildSpatialEditorView,
  resolveSpatialSurface,
  spatialLayerAuthoringAddress,
  spatialSessionCameraFromPose,
  type SpatialEditorLayerScope,
  type SpatialEditorLayerView,
  type SpatialEditorView,
} from './spatialEditorView'
import { repairRemovedCourseReferences } from '../../core/tools/courseReferenceCleanup'

export {
  SPATIAL_REJECT_LOCKED,
  SPATIAL_REJECT_STALE_REVISION,
  SPATIAL_REJECT_WRONG_OWNER,
  SpatialCommandError,
  createSpatialAuthoringHistory,
  commitSpatialAuthoringHistory,
  undoSpatialAuthoringHistory,
  redoSpatialAuthoringHistory,
  commitSpatialProjectMutation,
  spatialAuthoringGeneration,
  type SpatialAuthoringHistory,
  type SpatialAuthoringSelection,
  type SpatialAuthoringSession,
  type SpatialAuthoringTarget,
  type SpatialCommandOptions,
  type SpatialCommandResult,
} from './spatialAuthoringHistory'

export {
  buildSpatialEditorView,
  createSpatialWorldViewTransform,
  createSpatialViewportOverlayTransform,
  spatialLayerAuthoringAddress,
  spatialLayerCoordinateSpace,
  spatialWorldPointerDeltaToWorld,
  isSpatialViewportLayer,
  type SpatialCoordinateSpace,
  type SpatialEditorLayerScope,
  type SpatialEditorView,
  type SpatialSessionCamera,
} from './spatialEditorView'

/** V8 stagger, in world units. Never clamped back to 1280×720. */
export interface SpatialAuthoringSnapshot {
  readonly sessionId: string
  readonly locationId: string
  readonly surfaceId: string
  readonly activeCameraFrameId: string
  readonly scope: SpatialEditorLayerScope
  readonly selection: SpatialAuthoringSelection
  readonly revision: number
  readonly sessionCamera: SpatialAuthoringSession['sessionCamera']
  readonly showCameraFrames: boolean
  readonly worldBoundsMode: 'infinite' | 'finite'
}

function firstSpatialLocation(
  project: CourseProjectDocument,
  preferredId?: string,
) {
  if (preferredId) {
    const preferred = project.locations.find((candidate) => candidate.id === preferredId)
    if (preferred?.kind === 'spatial-camera') return preferred
  }
  const start = project.locations.find((candidate) => candidate.id === project.startLocationId)
  if (start?.kind === 'spatial-camera') return start
  return project.locations.find((candidate) => candidate.kind === 'spatial-camera')
}

export interface SelectSpatialEditorLayersInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly selectionIds: readonly string[]
}

export function selectSpatialEditorLayers(
  input: SelectSpatialEditorLayersInput,
): SpatialAuthoringSelection {
  const view = buildSpatialEditorView({
    project: input.project,
    locationId: input.locationId,
    sessionCamera: spatialSessionCameraFromPose(
      resolveSpatialSurface(input.project, input.locationId).frame,
    ),
  })
  const selectionIds = [...input.selectionIds]
  if (new Set(selectionIds).size !== selectionIds.length) {
    throw new SpatialCommandError('invalid-selection', '选择中不能包含重复元素')
  }
  const availableIds = new Set(view.layers.map((layer) => layer.selectionId))
  const missingId = selectionIds.find((selectionId) => !availableIds.has(selectionId))
  if (missingId !== undefined) {
    throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
  }
  return freezeSpatialSelection({
    locationId: view.locationId,
    surfaceId: view.surfaceId,
    selectionIds,
  })
}

export function openSpatialAuthoringSession(
  project: CourseProjectDocument,
  options: { locationId?: string; sessionId?: string } = {},
): SpatialAuthoringSession {
  const parsed = courseProjectDocumentSchema.parse(structuredClone(project))
  const location = firstSpatialLocation(parsed, options.locationId)
  if (!location || location.kind !== 'spatial-camera') {
    throw new Error('找不到 Spatial 镜头位置')
  }
  const { frame } = resolveSpatialSurface(parsed, location.id)
  const selection = selectSpatialEditorLayers({
    project: parsed,
    locationId: location.id,
    selectionIds: [],
  })
  const sessionId = options.sessionId ?? `spatial-session-${nanoid(10)}`
  resetSpatialAuthoringGeneration(sessionId, 0)
  return freezeSpatialSession({
    sessionId,
    history: createSpatialAuthoringHistory(parsed),
    selection,
    scope: 'world',
    generation: 0,
    sessionCamera: spatialSessionCameraFromPose(frame),
    showCameraFrames: true,
  })
}

export function buildSpatialAuthoringSnapshot(
  session: SpatialAuthoringSession,
): SpatialAuthoringSnapshot {
  const view = buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    sessionCamera: session.sessionCamera,
  })
  return Object.freeze({
    sessionId: session.sessionId,
    locationId: view.locationId,
    surfaceId: view.surfaceId,
    activeCameraFrameId: view.camera.activeFrameId,
    scope: session.scope,
    selection: freezeSpatialSelection(session.selection),
    revision: view.revision,
    sessionCamera: session.sessionCamera,
    showCameraFrames: session.showCameraFrames,
    worldBoundsMode: view.worldBounds.mode,
  })
}

export function makeSpatialAuthoringTarget(
  session: SpatialAuthoringSession,
  layerItemId: string,
  field?: string,
): SpatialAuthoringTarget {
  const view = buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    sessionCamera: session.sessionCamera,
  })
  const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer) throw new Error('所选元素已失效，请重新选择')
  return Object.freeze({
    sessionId: session.sessionId,
    revision: session.history.present.revision,
    generation: session.generation,
    authoringAddress: spatialLayerAuthoringAddress(view, layer, field),
    scope: layer.source,
    coordinateSpace: layer.coordinateSpace,
    layerItemId,
  })
}

function selectableLayers(
  session: SpatialAuthoringSession,
): Map<string, SpatialEditorLayerView> {
  const view = buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    sessionCamera: session.sessionCamera,
  })
  return new Map(view.layers.flatMap((layer) => {
    if (layer.source !== session.scope) return []
    return [[layer.selectionId, layer] as const]
  }))
}

function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function selectSpatialLayers(
  session: SpatialAuthoringSession,
  input: { readonly layerItemIds: readonly string[]; readonly additive?: boolean },
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  if (new Set(input.layerItemIds).size !== input.layerItemIds.length) {
    return rejectSpatialCommand(session, 'invalid-selection')
  }
  const selectable = selectableLayers(session)
  if (input.layerItemIds.some((layerItemId) => !selectable.has(layerItemId))) {
    return rejectSpatialCommand(session, 'invalid-selection')
  }
  let nextSelectionIds: string[]
  if (input.additive) {
    nextSelectionIds = [...session.selection.selectionIds]
    for (const layerItemId of input.layerItemIds) {
      const index = nextSelectionIds.indexOf(layerItemId)
      if (index >= 0) nextSelectionIds.splice(index, 1)
      else nextSelectionIds.push(layerItemId)
    }
  } else {
    nextSelectionIds = [...input.layerItemIds]
  }
  if (sameSelection(nextSelectionIds, session.selection.selectionIds)) {
    return succeedSpatialCommand(session, false)
  }
  try {
    const selection = selectSpatialEditorLayers({
      project: session.history.present,
      locationId: session.selection.locationId,
      selectionIds: nextSelectionIds,
    })
    return succeedSpatialCommand(replaceSpatialSession(session, { selection }), false)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function setSpatialEditingScope(
  session: SpatialAuthoringSession,
  scope: SpatialEditorLayerScope,
): SpatialCommandResult {
  if (session.scope === scope) return succeedSpatialCommand(session, false)
  const selection = freezeSpatialSelection({
    locationId: session.selection.locationId,
    surfaceId: session.selection.surfaceId,
    selectionIds: [],
  })
  return succeedSpatialCommand(replaceSpatialSession(session, {
    scope,
    selection,
    generation: bumpSpatialGeneration(session),
  }), false)
}

export function setSpatialSessionCamera(
  session: SpatialAuthoringSession,
  camera: SpatialAuthoringSession['sessionCamera'],
): SpatialCommandResult {
  const nextCamera = { x: camera.x, y: camera.y, zoom: camera.zoom }
  if (
    session.sessionCamera.x === nextCamera.x &&
    session.sessionCamera.y === nextCamera.y &&
    session.sessionCamera.zoom === nextCamera.zoom
  ) {
    return succeedSpatialCommand(session, false)
  }
  try {
    return succeedSpatialCommand(replaceSpatialSession(session, {
      sessionCamera: nextCamera,
    }), false)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function panSpatialSessionCamera(
  session: SpatialAuthoringSession,
  delta: { readonly x: number; readonly y: number },
): SpatialCommandResult {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return rejectSpatialCommand(session, '会话平移必须是有效数字')
  }
  return setSpatialSessionCamera(session, {
    x: session.sessionCamera.x + delta.x,
    y: session.sessionCamera.y + delta.y,
    zoom: session.sessionCamera.zoom,
  })
}

export function zoomSpatialSessionCamera(
  session: SpatialAuthoringSession,
  zoom: number,
): SpatialCommandResult {
  return setSpatialSessionCamera(session, {
    x: session.sessionCamera.x,
    y: session.sessionCamera.y,
    zoom,
  })
}

export function undoSpatialAuthoring(
  session: SpatialAuthoringSession,
): SpatialCommandResult {
  const history = undoSpatialAuthoringHistory(session.history)
  if (history === session.history) return succeedSpatialCommand(session, false)
  const locationStillExists = history.present.locations.some(
    (location) => location.id === session.selection.locationId && location.kind === 'spatial-camera',
  )
  const locationId = locationStillExists
    ? session.selection.locationId
    : firstSpatialLocation(history.present)?.id
  if (!locationId) return rejectSpatialCommand(session, '找不到 Spatial 镜头位置')
  try {
    const selection = selectSpatialEditorLayers({
      project: history.present,
      locationId,
      selectionIds: [],
    })
    return succeedSpatialCommand(replaceSpatialSession(session, {
      history,
      selection,
      generation: bumpSpatialGeneration(session),
    }), false)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function redoSpatialAuthoring(
  session: SpatialAuthoringSession,
): SpatialCommandResult {
  const history = redoSpatialAuthoringHistory(session.history)
  if (history === session.history) return succeedSpatialCommand(session, false)
  const locationStillExists = history.present.locations.some(
    (location) => location.id === session.selection.locationId && location.kind === 'spatial-camera',
  )
  const locationId = locationStillExists
    ? session.selection.locationId
    : firstSpatialLocation(history.present)?.id
  if (!locationId) return rejectSpatialCommand(session, '找不到 Spatial 镜头位置')
  try {
    const selection = selectSpatialEditorLayers({
      project: history.present,
      locationId,
      selectionIds: [],
    })
    return succeedSpatialCommand(replaceSpatialSession(session, {
      history,
      selection,
      generation: bumpSpatialGeneration(session),
    }), false)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

function commitAdded(
  session: SpatialAuthoringSession,
  project: CourseProjectDocument,
  layerItemId: string,
): SpatialCommandResult {
  const selection = selectSpatialEditorLayers({
    project,
    locationId: session.selection.locationId,
    selectionIds: [layerItemId],
  })
  return succeedSpatialCommand(replaceSpatialSession(session, {
    history: commitSpatialAuthoringHistory(session.history, project),
    selection,
  }), true)
}

export interface AddSpatialWorldComponentLayerInput extends AddSpatialWorldLayerInput {
  readonly staticFallbackAssetId?: string
  readonly packageId: string
  readonly version?: string
  readonly props?: Record<string, unknown>
  readonly width?: number
  readonly height?: number
}

export interface AddSpatialWorldRuntimeLayerInput extends AddSpatialWorldLayerInput {
  readonly width?: number
  readonly height?: number
  readonly runtime?: CourseRuntimeDefinition
}

function defaultSurfaceRuntime(): CourseRuntimeDefinition {
  return {
    protocol: 'surface-runtime',
    runtimeApiVersion: 3,
    enabled: true,
    renderMode: 'dom',
    source: 'CoursewareRuntime.define({ runtimeApiVersion: 3, protocol: "surface-runtime" })',
    content: { values: {} },
    assets: {},
  }
}

export function addSpatialWorldTextLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldTextLayerInput = {},
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = planSpatialTextInsertion(session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function addSpatialWorldShapeLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldShapeLayerInput = {},
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = planSpatialShapeInsertion(session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function addSpatialWorldFormulaLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldLayerInput = {},
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = planSpatialFormulaInsertion(session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function addSpatialWorldImageLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldImageLayerInput,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = planSpatialImageInsertion(session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function addSpatialWorldVideoLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldVideoLayerInput,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = planSpatialVideoInsertion(session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function addSpatialWorldComponentLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldComponentLayerInput,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const embedded = session.history.present.componentPackages[input.packageId]
    if (!embedded) throw new Error(`组件包未嵌入工程：${input.packageId}`)
    const width = input.width ?? 480
    const height = input.height ?? 280
    const origin = defaultWorldOrigin(session, width, height, input.x, input.y)
    const node = createExternalComponentNode({
      id: input.id,
      name: input.label ?? embedded.name,
      component: {
        packageId: embedded.packageId,
        version: input.version ?? embedded.version,
      },
      props: structuredClone(input.props ?? {}),
      width,
      height,
      x: origin.x,
      y: origin.y,
    })
    const item = sceneNodeToCourseLayerItem(node)
    if (item.kind === 'component' && input.staticFallbackAssetId) {
      if (session.history.present.assets[input.staticFallbackAssetId]?.kind !== 'image') throw new Error('组件后备需要工程图片')
      item.staticFallbackAssetId = input.staticFallbackAssetId
    }
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function addSpatialWorldRuntimeLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldRuntimeLayerInput = {},
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const width = input.width ?? 640
    const height = input.height ?? 360
    const origin = defaultWorldOrigin(session, width, height, input.x, input.y)
    const item: RuntimeLayerItem = {
      layerItemId: input.id ?? `runtime-${nanoid(10)}`,
      label: input.label ?? '动态内容',
      kind: 'runtime',
      frame: { mode: 'absolute', x: origin.x, y: origin.y, width, height },
      order: 0,
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      runtime: structuredClone(input.runtime ?? defaultSurfaceRuntime()),
    }
    Object.values(item.runtime.assets).forEach((binding) => {
      requireAsset(session.history.present, binding.assetId)
    })
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, item.layerItemId)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export interface SpatialEditorWorldTransform {
  readonly layerItemId: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation: number
}

export interface SpatialEditorTransformInput {
  readonly nodes?: readonly SpatialEditorWorldTransform[]
  readonly layers?: readonly SpatialEditorWorldTransform[]
}

function validateWorldTransform(transform: SpatialEditorWorldTransform): void {
  if (
    !Number.isFinite(transform.x) ||
    !Number.isFinite(transform.y) ||
    !Number.isFinite(transform.width) ||
    !Number.isFinite(transform.height) ||
    !Number.isFinite(transform.rotation)
  ) {
    throw new SpatialCommandError('invalid-target', '元素位置和尺寸必须是有效数字')
  }
  if (transform.width <= 0 || transform.height <= 0) {
    throw new SpatialCommandError('invalid-target', '元素宽高必须大于零')
  }
  if (transform.rotation < -36_000 || transform.rotation > 36_000) {
    throw new SpatialCommandError('invalid-target', '元素旋转角度超出允许范围')
  }
}

/**
 * One completed world-space gesture. Session camera is not written.
 * Coordinates are not clamped to 1280×720.
 */
export function transformSpatialWorldLayers(
  history: SpatialAuthoringHistory,
  selection: SpatialAuthoringSelection,
  input: SpatialEditorTransformInput,
  now?: string,
): SpatialAuthoringHistory {
  const transforms = [...(input.nodes ?? input.layers ?? [])]
  if (transforms.length === 0) return history
  const layerItemIds = transforms.map((transform) => transform.layerItemId)
  if (new Set(layerItemIds).size !== layerItemIds.length) {
    throw new SpatialCommandError('invalid-selection', '一次变换不能包含重复元素')
  }
  transforms.forEach(validateWorldTransform)

  const selectedIds = new Set(selection.selectionIds)
  const unselectedId = layerItemIds.find((layerItemId) => !selectedIds.has(layerItemId))
  if (unselectedId !== undefined) {
    throw new SpatialCommandError('invalid-selection', '变换目标不在当前选择中')
  }

  const view = buildSpatialEditorView({
    project: history.present,
    locationId: selection.locationId,
    sessionCamera: spatialSessionCameraFromPose(
      resolveSpatialSurface(history.present, selection.locationId).frame,
    ),
  })
  if (view.surfaceId !== selection.surfaceId) {
    throw new Error('所选空间表面已失效，请重新选择')
  }

  const layerById = new Map(view.layers.map((layer) => [layer.selectionId, layer]))
  const plans = transforms.map((transform) => {
    const layer = layerById.get(transform.layerItemId)
    if (!layer) throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
    if (layer.source !== 'world') {
      throw new SpatialCommandError(SPATIAL_REJECT_WRONG_OWNER, '当前选择不属于当前空间世界')
    }
    if (layer.coordinateSpace !== 'world') {
      throw new SpatialCommandError(SPATIAL_REJECT_WRONG_OWNER, '视口元素不能写入世界坐标')
    }
    if (layer.item.locked) {
      throw new SpatialCommandError(SPATIAL_REJECT_LOCKED, '当前元素已锁定')
    }
    const changed =
      layer.item.frame.x !== transform.x ||
      layer.item.frame.y !== transform.y ||
      layer.item.frame.width !== transform.width ||
      layer.item.frame.height !== transform.height ||
      layer.item.rotation !== transform.rotation
    return { transform, changed }
  })
  if (!plans.some((plan) => plan.changed)) return history

  const next = commitSpatialProjectMutation(history.present, (draft) => {
    const surface = spatialSurfaceIn(draft, selection.surfaceId)
    const worldById = new Map(surface.world.layerItems.map((item) => [item.layerItemId, item]))
    for (const { transform, changed } of plans) {
      if (!changed) continue
      const item = worldById.get(transform.layerItemId)
      if (!item) throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
      item.frame.x = transform.x
      item.frame.y = transform.y
      item.frame.width = transform.width
      item.frame.height = transform.height
      item.rotation = transform.rotation
    }
  }, now)

  return commitSpatialAuthoringHistory(history, next)
}

export function transformSpatialWorldLayersInSession(
  session: SpatialAuthoringSession,
  input: SpatialEditorTransformInput,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const history = transformSpatialWorldLayers(
      session.history,
      session.selection,
      input,
      options.now,
    )
    if (history === session.history) return succeedSpatialCommand(session, false)
    return succeedSpatialCommand(replaceSpatialSession(session, { history }), true)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

/**
 * One completed viewport/HUD gesture. Writes global frames only; world items
 * stay on `transformSpatialWorldLayers`. Teacher controller cannot sink.
 */
export function transformSpatialViewportLayers(
  history: SpatialAuthoringHistory,
  selection: SpatialAuthoringSelection,
  input: SpatialEditorTransformInput,
  now?: string,
): SpatialAuthoringHistory {
  const transforms = [...(input.nodes ?? input.layers ?? [])]
  if (transforms.length === 0) return history
  const layerItemIds = transforms.map((transform) => transform.layerItemId)
  if (new Set(layerItemIds).size !== layerItemIds.length) {
    throw new SpatialCommandError('invalid-selection', '一次变换不能包含重复元素')
  }
  transforms.forEach(validateWorldTransform)

  const selectedIds = new Set(selection.selectionIds)
  const unselectedId = layerItemIds.find((layerItemId) => !selectedIds.has(layerItemId))
  if (unselectedId !== undefined) {
    throw new SpatialCommandError('invalid-selection', '变换目标不在当前选择中')
  }

  const view = buildSpatialEditorView({
    project: history.present,
    locationId: selection.locationId,
    sessionCamera: spatialSessionCameraFromPose(
      resolveSpatialSurface(history.present, selection.locationId).frame,
    ),
  })
  if (view.surfaceId !== selection.surfaceId) {
    throw new Error('所选空间表面已失效，请重新选择')
  }

  const layerById = new Map(view.layers.map((layer) => [layer.selectionId, layer]))
  const plans = transforms.map((transform) => {
    const layer = layerById.get(transform.layerItemId)
    if (!layer) throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
    if (layer.source !== 'global' || layer.coordinateSpace !== 'viewport') {
      throw new SpatialCommandError(SPATIAL_REJECT_WRONG_OWNER, '视口元素必须留在全局层')
    }
    if (layer.item.locked) {
      throw new SpatialCommandError(SPATIAL_REJECT_LOCKED, '当前元素已锁定')
    }
    const changed =
      layer.item.frame.x !== transform.x ||
      layer.item.frame.y !== transform.y ||
      layer.item.frame.width !== transform.width ||
      layer.item.frame.height !== transform.height ||
      layer.item.rotation !== transform.rotation
    return { transform, changed }
  })
  if (!plans.some((plan) => plan.changed)) return history

  const next = commitSpatialProjectMutation(history.present, (draft) => {
    const globalById = new Map(draft.globalLayerItems.map((entry) => [entry.item.layerItemId, entry.item]))
    for (const { transform, changed } of plans) {
      if (!changed) continue
      const item = globalById.get(transform.layerItemId)
      if (!item) throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
      item.frame.x = transform.x
      item.frame.y = transform.y
      item.frame.width = transform.width
      item.frame.height = transform.height
      item.rotation = transform.rotation
    }
  }, now)

  return commitSpatialAuthoringHistory(history, next)
}

export function transformSpatialViewportLayersInSession(
  session: SpatialAuthoringSession,
  input: SpatialEditorTransformInput,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const history = transformSpatialViewportLayers(
      session.history,
      session.selection,
      input,
      options.now,
    )
    if (history === session.history) return succeedSpatialCommand(session, false)
    return succeedSpatialCommand(replaceSpatialSession(session, { history }), true)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

function requireWorldSelection(
  history: SpatialAuthoringHistory,
  selection: SpatialAuthoringSelection,
): {
  view: SpatialEditorView
  worldIds: string[]
} {
  const view = buildSpatialEditorView({
    project: history.present,
    locationId: selection.locationId,
    sessionCamera: spatialSessionCameraFromPose(
      resolveSpatialSurface(history.present, selection.locationId).frame,
    ),
  })
  if (view.surfaceId !== selection.surfaceId) {
    throw new Error('所选空间表面已失效，请重新选择')
  }
  const layerById = new Map(view.layers.map((layer) => [layer.selectionId, layer]))
  const worldIds: string[] = []
  for (const layerItemId of selection.selectionIds) {
    const layer = layerById.get(layerItemId)
    if (!layer) throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
    if (layer.source !== 'world') {
      throw new SpatialCommandError(SPATIAL_REJECT_WRONG_OWNER, '当前选择不属于当前空间世界')
    }
    worldIds.push(layerItemId)
  }
  return { view, worldIds }
}

function refuseLockedWorldWrites(
  history: SpatialAuthoringHistory,
  selection: SpatialAuthoringSelection,
): void {
  const { view, worldIds } = requireWorldSelection(history, selection)
  const layerById = new Map(view.layers.map((layer) => [layer.selectionId, layer]))
  for (const layerItemId of worldIds) {
    if (layerById.get(layerItemId)?.item.locked) {
      throw new SpatialCommandError(SPATIAL_REJECT_LOCKED, '当前元素已锁定')
    }
  }
}

function cascadeWorldReferences(surface: SpatialSurfaceDocument): void {
  const remaining = new Set(surface.world.layerItems.map((item) => item.layerItemId))
  if (surface.world.paths) {
    surface.world.paths = surface.world.paths.flatMap((path) => {
      const layerItemIds = path.layerItemIds.filter((layerItemId) => remaining.has(layerItemId))
      return layerItemIds.length === 0 ? [] : [{ ...path, layerItemIds }]
    })
  }
  if (surface.world.relations) {
    surface.world.relations = surface.world.relations.filter((relation) => (
      remaining.has(relation.sourceLayerItemId) && remaining.has(relation.targetLayerItemId)
    ))
  }
  surface.semanticZoom = surface.semanticZoom.flatMap((rule) => {
    const layerItemIds = rule.layerItemIds.filter((layerItemId) => remaining.has(layerItemId))
    return layerItemIds.length === 0 ? [] : [{ ...rule, layerItemIds }]
  })
}

export function deleteSpatialWorldLayers(
  history: SpatialAuthoringHistory,
  selection: SpatialAuthoringSelection,
  now?: string,
): SpatialAuthoringHistory {
  refuseLockedWorldWrites(history, selection)
  const { worldIds } = requireWorldSelection(history, selection)
  if (worldIds.length === 0) return history
  const removedIds = new Set(worldIds)
  const next = commitSpatialProjectMutation(history.present, (draft) => {
    const surface = spatialSurfaceIn(draft, selection.surfaceId)
    surface.world.layerItems = surface.world.layerItems.filter(
      (item) => !removedIds.has(item.layerItemId),
    )
    cascadeWorldReferences(surface)
    repairRemovedCourseReferences(draft, {
      removedLocationIds: new Set(),
      removedLayerItemIds: removedIds,
    })
  }, now)
  return commitSpatialAuthoringHistory(history, next)
}

export function deleteSpatialWorldLayersInSession(
  session: SpatialAuthoringSession,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const history = deleteSpatialWorldLayers(session.history, session.selection, options.now)
    if (history === session.history) return succeedSpatialCommand(session, false)
    const selection = freezeSpatialSelection({
      locationId: session.selection.locationId,
      surfaceId: session.selection.surfaceId,
      selectionIds: [],
    })
    return succeedSpatialCommand(replaceSpatialSession(session, { history, selection }), true)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function updateSpatialWorldText(
  session: SpatialAuthoringSession,
  text: string,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    refuseLockedWorldWrites(session.history, session.selection)
    const { view, worldIds } = requireWorldSelection(session.history, session.selection)
    if (worldIds.length !== 1) throw new Error('请选择一个文字元素后编辑')
    const layer = view.layers.find((candidate) => candidate.selectionId === worldIds[0])
    if (!layer || layer.item.kind !== 'native' || layer.item.content.nativeType !== 'text') {
      throw new Error('请选择一个文字元素后编辑')
    }
    const current = layer.item as DeepNativeText
    if (current.content.data.text === text) return succeedSpatialCommand(session, false)
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      const surface = spatialSurfaceIn(draft, session.selection.surfaceId)
      const item = surface.world.layerItems.find((candidate) => candidate.layerItemId === worldIds[0])
      if (!item || item.kind !== 'native' || item.content.nativeType !== 'text') {
        throw new Error('请选择一个文字元素后编辑')
      }
      item.content.data.text = text
    }, options.now)
    return succeedSpatialCommand(replaceSpatialSession(session, {
      history: commitSpatialAuthoringHistory(session.history, project),
    }), true)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

type DeepNativeText = NativeLayerItem & {
  content: Extract<NativeLayerItem['content'], { nativeType: 'text' }>
}

export interface SpatialSurfaceBackgroundPatch {
  readonly backgroundMode?: BackgroundMode
  readonly backgroundColor?: string
  readonly backgroundAssetId?: string | null
}

/**
 * Typed, validated write for a Spatial surface's background mode/color/asset.
 * One commit per call; a stale revision, an invalid mode/color, or a patch
 * that changes nothing writes zero history entries. Switching only
 * `backgroundMode` (an isolated single-field patch) never touches the
 * dormant `backgroundColor`/`backgroundAssetId` fields.
 */
export function updateSpatialSurfaceBackground(
  session: SpatialAuthoringSession,
  patch: SpatialSurfaceBackgroundPatch,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = updateBodySurfaceBackground(session.history.present, session.selection.surfaceId, 'spatial-2d', patch, options)
    if (!planned.ok) return rejectSpatialCommand(session, planned.reason)
    if (!planned.historyEntry) return succeedSpatialCommand(session, false)
    return succeedSpatialCommand(replaceSpatialSession(session, {
      history: commitSpatialAuthoringHistory(session.history, planned.project),
    }), true)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function updateSpatialSurfaceBackgroundColor(
  session: SpatialAuthoringSession,
  backgroundColor: string,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  return updateSpatialSurfaceBackground(session, { backgroundColor }, options)
}

export function worldLayerItem(
  project: CourseProjectDocument,
  surfaceId: string,
  layerItemId: string,
): LayerItem {
  const item = spatialSurfaceIn(project, surfaceId).world.layerItems.find(
    (candidate) => candidate.layerItemId === layerItemId,
  )
  if (!item) throw new Error(`找不到世界元素：${layerItemId}`)
  return item
}


export function addSpatialWorldChartLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldLayerInput & { chartType?: ChartType } = {},
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = planSpatialChartInsertion(session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function replaceSpatialWorldChart(
  session: SpatialAuthoringSession,
  layerItemId: string,
  chart: NativeChartContent,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const next = chartNativeContentObjectSchema.parse(chart)
    const project = commitSpatialProjectMutation(session.history.present, draft => {
      const item = spatialSurfaceIn(draft, session.selection.surfaceId).world.layerItems.find(item => item.layerItemId === layerItemId)
      if (!item || item.kind !== 'native' || item.content.nativeType !== 'chart') throw new Error('图表目标已失效')
      if (item.locked) throw new Error('locked')
      item.content.data = next
    }, options.now)
    if (project === session.history.present) return succeedSpatialCommand(session, false)
    return succeedSpatialCommand(replaceSpatialSession(session, { history: commitSpatialAuthoringHistory(session.history, project) }), true)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function addSpatialWorldTableLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldLayerInput = {},
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = planSpatialTableInsertion(session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchSpatialCommand(session, error) }
}

export function replaceSpatialWorldTable(
  session: SpatialAuthoringSession,
  layerItemId: string,
  table: NativeTableContent,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const next = tableNativeContentObjectSchema.parse(table)
    const project = commitSpatialProjectMutation(session.history.present, draft => {
      const item = spatialSurfaceIn(draft, session.selection.surfaceId).world.layerItems.find(item => item.layerItemId === layerItemId)
      if (!item || item.kind !== 'native' || item.content.nativeType !== 'table') throw new Error('表格目标已失效')
      if (item.locked) throw new Error('locked')
      item.content.data = next
    }, options.now)
    if (project === session.history.present) return succeedSpatialCommand(session, false)
    return succeedSpatialCommand(replaceSpatialSession(session, { history: commitSpatialAuthoringHistory(session.history, project) }), true)
  } catch (error) { return catchSpatialCommand(session, error) }
}
