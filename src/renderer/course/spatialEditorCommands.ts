import { nanoid } from 'nanoid'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import {
  BACKGROUND_MODES,
  type BackgroundMode,
  type CourseProjectDocument,
  type CourseRuntimeDefinition,
  type LayerItem,
  type NativeLayerItem,
  type RuntimeLayerItem,
  type SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { ShapeType } from '../../shared/contracts/native-v1'
import {
  createExternalComponentNode,
  createFormulaNode,
  createImageNode,
  createShapeNode,
  createTextNode,
  createVideoNode,
} from '../project/nativeNodeFactories'
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
import { allocateCourseLayerOrder } from './globalLayerCommands'
import { repairRemovedCourseReferences } from './courseReferenceCleanup'

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
export const SPATIAL_DEFAULT_INSERTION_COLUMNS = 6
export const SPATIAL_DEFAULT_INSERTION_OFFSET = 20
const SPATIAL_DEFAULT_INSERTION_SLOTS = SPATIAL_DEFAULT_INSERTION_COLUMNS * 4

export interface SpatialInsertionPoint {
  readonly x: number
  readonly y: number
}

export function offsetDefaultSpatialInsertion<T extends SpatialInsertionPoint>(
  item: T,
  existingItemCount: number,
  hasExplicitPosition: boolean,
): T {
  if (hasExplicitPosition) return item
  const slot = existingItemCount % SPATIAL_DEFAULT_INSERTION_SLOTS
  return {
    ...item,
    x: item.x + (slot % SPATIAL_DEFAULT_INSERTION_COLUMNS) * SPATIAL_DEFAULT_INSERTION_OFFSET,
    y: item.y + Math.floor(slot / SPATIAL_DEFAULT_INSERTION_COLUMNS) * SPATIAL_DEFAULT_INSERTION_OFFSET,
  }
}

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

export function spatialSurfaceIn(
  project: CourseProjectDocument,
  surfaceId: string,
): SpatialSurfaceDocument {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'spatial-2d') throw new Error('目标不是 Spatial 表面')
  return surface
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

function requireWorldScope(session: SpatialAuthoringSession): void {
  if (session.scope !== 'world') {
    throw new SpatialCommandError(SPATIAL_REJECT_WRONG_OWNER, '当前选择不属于当前空间世界')
  }
}

function worldItemCount(project: CourseProjectDocument, surfaceId: string): number {
  return spatialSurfaceIn(project, surfaceId).world.layerItems.length
}

function defaultWorldOrigin(
  session: SpatialAuthoringSession,
  width: number,
  height: number,
  x?: number,
  y?: number,
): { x: number; y: number } {
  const hasExplicitPosition = x !== undefined || y !== undefined
  const camera = session.sessionCamera
  return offsetDefaultSpatialInsertion({
    x: x ?? camera.x - width / 2,
    y: y ?? camera.y - height / 2,
  }, worldItemCount(session.history.present, session.selection.surfaceId), hasExplicitPosition)
}

function appendWorldLayer(
  draft: CourseProjectDocument,
  surfaceId: string,
  item: LayerItem,
): void {
  const surface = spatialSurfaceIn(draft, surfaceId)
  if (surface.world.layerItems.some((candidate) => candidate.layerItemId === item.layerItemId)) {
    throw new Error('世界元素 ID 已存在，请重新生成后重试')
  }
  const preferredOrder = surface.world.layerItems.reduce(
    (highest, candidate) => Math.max(highest, candidate.order),
    -1,
  ) + 1
  item.order = allocateCourseLayerOrder(draft, preferredOrder)
  surface.world.layerItems.push(item)
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

function requireAsset(
  project: CourseProjectDocument,
  assetId: string,
  kind?: 'image' | 'video',
): void {
  const asset = project.assets[assetId]
  if (!asset) throw new Error(`找不到素材：${assetId}`)
  if (kind && asset.kind !== kind) {
    throw new Error(`素材类型必须是${kind === 'image' ? '图片' : '视频'}`)
  }
}

export interface AddSpatialWorldLayerInput {
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly label?: string
}

export interface AddSpatialWorldTextLayerInput extends AddSpatialWorldLayerInput {
  readonly text?: string
}

export interface AddSpatialWorldShapeLayerInput extends AddSpatialWorldLayerInput {
  readonly shapeType?: ShapeType
}

export interface AddSpatialWorldImageLayerInput extends AddSpatialWorldLayerInput {
  readonly assetId: string
  readonly width?: number
  readonly height?: number
}

export interface AddSpatialWorldVideoLayerInput extends AddSpatialWorldLayerInput {
  readonly assetId: string
  readonly width?: number
  readonly height?: number
  readonly asset?: AssetMeta
}

export interface AddSpatialWorldComponentLayerInput extends AddSpatialWorldLayerInput {
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
    requireWorldScope(session)
    const width = 400
    const height = 80
    const origin = defaultWorldOrigin(session, width, height, input.x, input.y)
    const node = createTextNode({
      id: input.id,
      name: input.label ?? '文本',
      text: input.text ?? '双击编辑文字',
      x: origin.x,
      y: origin.y,
      width,
      height,
    })
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function addSpatialWorldShapeLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldShapeLayerInput = {},
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const shapeType = input.shapeType ?? 'rounded-rectangle'
    const width = 320
    const height = 180
    const origin = defaultWorldOrigin(session, width, height, input.x, input.y)
    const node = createShapeNode(shapeType, {
      id: input.id,
      ...(input.label === undefined ? {} : { name: input.label }),
      x: origin.x,
      y: origin.y,
      width,
      height,
    })
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function addSpatialWorldFormulaLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldLayerInput = {},
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const width = 420
    const height = 160
    const origin = defaultWorldOrigin(session, width, height, input.x, input.y)
    const node = createFormulaNode({
      id: input.id,
      name: input.label ?? '公式',
      x: origin.x,
      y: origin.y,
      width,
      height,
    })
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function addSpatialWorldImageLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldImageLayerInput,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    requireAsset(session.history.present, input.assetId, 'image')
    const asset = session.history.present.assets[input.assetId]!
    const sized = createImageNode(input.assetId, asset.width, asset.height, input.x, input.y)
    const width = input.width ?? sized.width
    const height = input.height ?? sized.height
    const origin = defaultWorldOrigin(session, width, height, input.x, input.y)
    const node = createImageNode({
      id: input.id,
      name: input.label ?? '图片',
      assetId: input.assetId,
      width,
      height,
      x: origin.x,
      y: origin.y,
    })
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function addSpatialWorldVideoLayer(
  session: SpatialAuthoringSession,
  input: AddSpatialWorldVideoLayerInput,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireWorldScope(session)
    const existing = session.history.present.assets[input.assetId]
    if (!existing) {
      if (!input.asset) throw new Error(`找不到素材：${input.assetId}`)
      if (input.asset.kind !== 'video') throw new Error('素材类型必须是视频')
    } else {
      requireAsset(session.history.present, input.assetId, 'video')
    }
    const asset = existing ?? input.asset!
    const width = input.width ?? asset.width ?? 640
    const height = input.height ?? asset.height ?? 360
    const origin = defaultWorldOrigin(session, width, height, input.x, input.y)
    const node = createVideoNode({
      id: input.id,
      name: input.label ?? '视频',
      assetId: input.assetId,
      width,
      height,
      x: origin.x,
      y: origin.y,
    })
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      if (!draft.assets[input.assetId] && input.asset) {
        draft.assets[input.assetId] = structuredClone(input.asset)
      }
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
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
  if (patch.backgroundMode !== undefined && !BACKGROUND_MODES.includes(patch.backgroundMode)) {
    return rejectSpatialCommand(session, 'invalid-background-mode')
  }
  if (
    patch.backgroundColor !== undefined
    && (typeof patch.backgroundColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(patch.backgroundColor.trim()))
  ) {
    return rejectSpatialCommand(session, 'invalid-color')
  }
  const color = patch.backgroundColor !== undefined
    ? patch.backgroundColor.trim().toLowerCase()
    : undefined
  try {
    const currentSurface = spatialSurfaceIn(session.history.present, session.selection.surfaceId)
    const modeChanges = patch.backgroundMode !== undefined
      && patch.backgroundMode !== (currentSurface.backgroundMode ?? 'own')
    const colorChanges = color !== undefined && color !== currentSurface.backgroundColor
    const assetChanges = patch.backgroundAssetId !== undefined
      && patch.backgroundAssetId !== (currentSurface.backgroundAssetId ?? null)
    if (!modeChanges && !colorChanges && !assetChanges) {
      return succeedSpatialCommand(session, false)
    }
    const project = commitSpatialProjectMutation(session.history.present, (draft) => {
      const surface = spatialSurfaceIn(draft, session.selection.surfaceId)
      if (modeChanges) surface.backgroundMode = patch.backgroundMode
      if (colorChanges) surface.backgroundColor = color
      if (assetChanges) surface.backgroundAssetId = patch.backgroundAssetId ?? null
    }, options.now)
    return succeedSpatialCommand(replaceSpatialSession(session, {
      history: commitSpatialAuthoringHistory(session.history, project),
    }), true)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
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
