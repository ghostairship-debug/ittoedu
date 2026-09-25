import type { CourseProjectDocument, LayerItem, SpatialSurfaceDocument, SpatialCameraFrame } from '../../shared/courseProjectTypes'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { NativeChartContent, ShapeType } from '../../shared/contracts/native-v1'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import { createTextNode, createShapeNode, createFormulaNode, createImageNode, createVideoNode, createChartNode, createChartLayerItem, createTableNode, createTableLayerItem } from './nativeNodeFactories'
import { allocateCourseLayerOrder } from './layerOrder'
import { commitCourseProjectMutation } from './courseProjectMutation'
type ChartType = NativeChartContent['chartType']
export interface SpatialInsertionContext { scope: string; selection: { surfaceId: string }; sessionCamera: { x: number; y: number }; history: { present: CourseProjectDocument } }
export class SpatialCommandError extends Error {
  readonly reason: string

  constructor(reason: string, message?: string) {
    super(message ?? reason)
    this.name = 'SpatialCommandError'
    this.reason = reason
  }
}

export function resolveSpatialSurface(
  project: CourseProjectDocument,
  locationId: string,
): {
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'spatial-camera' }>
  surface: SpatialSurfaceDocument
  frame: SpatialCameraFrame
} {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  if (location.kind !== 'spatial-camera') {
    throw new Error(`SpatialEditorView 只接受 Spatial 镜头位置：${locationId}`)
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'spatial-2d') {
    throw new Error(`找不到 Spatial 表面：${location.surfaceId}`)
  }
  const frame = surface.camera.frames.find((candidate) => candidate.id === location.cameraFrameId)
  if (!frame) throw new Error(`找不到 Spatial 镜头帧：${location.cameraFrameId}`)
  return { location, surface, frame }
}

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

export function spatialSurfaceIn(
  project: CourseProjectDocument,
  surfaceId: string,
): SpatialSurfaceDocument {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'spatial-2d') throw new Error('目标不是 Spatial 表面')
  return surface
}

export function requireWorldScope(session: SpatialInsertionContext): void {
  if (session.scope !== 'world') {
    throw new SpatialCommandError('wrong-owner', '当前选择不属于当前空间世界')
  }
}

function worldItemCount(project: CourseProjectDocument, surfaceId: string): number {
  return spatialSurfaceIn(project, surfaceId).world.layerItems.length
}

export function defaultWorldOrigin(
  session: SpatialInsertionContext,
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

export function appendWorldLayer(
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

export function requireSpatialAsset(
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

export function planSpatialTextInsertion(session: SpatialInsertionContext, input: AddSpatialWorldTextLayerInput, now?: string) {
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
    const project = commitCourseProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSpatialShapeInsertion(session: SpatialInsertionContext, input: AddSpatialWorldShapeLayerInput, now?: string) {
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
    const project = commitCourseProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSpatialFormulaInsertion(session: SpatialInsertionContext, input: AddSpatialWorldLayerInput, now?: string) {
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
    const project = commitCourseProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSpatialImageInsertion(session: SpatialInsertionContext, input: AddSpatialWorldImageLayerInput, now?: string) {
    requireWorldScope(session)
    requireSpatialAsset(session.history.present, input.assetId, 'image')
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
    const project = commitCourseProjectMutation(session.history.present, (draft) => {
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSpatialVideoInsertion(session: SpatialInsertionContext, input: AddSpatialWorldVideoLayerInput, now?: string) {
    requireWorldScope(session)
    const existing = session.history.present.assets[input.assetId]
    if (!existing) {
      if (!input.asset) throw new Error(`找不到素材：${input.assetId}`)
      if (input.asset.kind !== 'video') throw new Error('素材类型必须是视频')
    } else {
      requireSpatialAsset(session.history.present, input.assetId, 'video')
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
    const project = commitCourseProjectMutation(session.history.present, (draft) => {
      if (!draft.assets[input.assetId] && input.asset) {
        draft.assets[input.assetId] = structuredClone(input.asset)
      }
      appendWorldLayer(draft, session.selection.surfaceId, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSpatialChartInsertion(session: SpatialInsertionContext, input: AddSpatialWorldLayerInput & { chartType?: ChartType }, now?: string) {
    requireWorldScope(session)
    const origin = defaultWorldOrigin(session, 560, 360, input.x, input.y)
    const node = createChartNode({ id: input.id, chartType: input.chartType, x: origin.x, y: origin.y, width: 560, height: 360 })
    const item = createChartLayerItem(node)
    const project = commitCourseProjectMutation(session.history.present, draft => {
      appendWorldLayer(draft, session.selection.surfaceId, item)
    }, now)
    return { project, itemId: node.id }
}
export function planSpatialTableInsertion(session: SpatialInsertionContext, input: AddSpatialWorldLayerInput, now?: string) {
    requireWorldScope(session)
    const origin = defaultWorldOrigin(session, 560, 360, input.x, input.y)
    const node = createTableNode({ id: input.id, x: origin.x, y: origin.y, width: 560, height: 360 })
    const item = createTableLayerItem(node)
    const project = commitCourseProjectMutation(session.history.present, draft => {
      appendWorldLayer(draft, session.selection.surfaceId, item)
    }, now)
    return { project, itemId: node.id }
}
