import { nanoid } from 'nanoid'
import { MAX_SCENE_NODES } from '../../shared/constants'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import type { CourseProjectDocument, LayerItem, SlideSceneDocument, SlideSurfaceDocument } from '../../shared/courseProjectTypes'
import { nativeLineGeometrySchema, type ShapeType } from '../../shared/contracts/native-v1'
import type { NativeLineGeometry } from '../../shared/contracts/native-v1/types'
import { createTextNode, createFormulaNode, createShapeNode, createImageNode, createVideoNode } from './nativeNodeFactories'
import { allocateCourseLayerOrder, sortScopedLayerList } from './layerOrder'
import { commitCourseProjectMutation } from './courseProjectMutation'
export interface SlideInsertionOwner { scope: string; selection: { locationId: string; stateId: string | null } }
function stableId(prefix: string, preferred?: string): string { return preferred ?? `${prefix}-${nanoid(10)}` }
export class SlideCommandError extends Error {
  readonly reason: string

  constructor(reason: string, message?: string) {
    super(message ?? reason)
    this.name = 'SlideCommandError'
    this.reason = reason
  }
}

export const SLIDE_DEFAULT_INSERTION_COLUMNS = 6
export const SLIDE_DEFAULT_INSERTION_OFFSET = 20
const SLIDE_DEFAULT_INSERTION_SLOTS = SLIDE_DEFAULT_INSERTION_COLUMNS * 4

export interface SlideInsertionPoint {
  readonly x: number
  readonly y: number
}

export function offsetDefaultSlideInsertion<T extends SlideInsertionPoint>(
  item: T,
  existingItemCount: number,
  hasExplicitPosition: boolean,
): T {
  if (hasExplicitPosition) return item
  const slot = existingItemCount % SLIDE_DEFAULT_INSERTION_SLOTS
  return {
    ...item,
    x: item.x + (slot % SLIDE_DEFAULT_INSERTION_COLUMNS) * SLIDE_DEFAULT_INSERTION_OFFSET,
    y: item.y + Math.floor(slot / SLIDE_DEFAULT_INSERTION_COLUMNS) * SLIDE_DEFAULT_INSERTION_OFFSET,
  }
}

export interface AddSlideTextLayerInput {
  readonly text?: string
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly label?: string
}

export interface AddSlideFormulaLayerInput {
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly label?: string
}

export interface AddSlideShapeLayerInput {
  readonly shapeType: ShapeType
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly label?: string
  /**
   * Direct-draw path: one pointerdown→pointerup gesture commits frame and
   * parameterized geometry together. Both must be present for line tools.
   */
  readonly frame?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly lineGeometry?: NativeLineGeometry
}

export interface AddSlideImageLayerInput {
  readonly assetId: string
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly label?: string
}

export interface AddSlideVideoLayerInput {
  readonly assetId: string
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly label?: string
}

export function slideSceneContext(
  project: CourseProjectDocument,
  session: SlideInsertionOwner,
): {
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'slide-scene' }>
  surface: SlideSurfaceDocument
  scene: SlideSceneDocument
} {
  const location = project.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError('wrong-owner', '当前位置不是幻灯片')
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('当前幻灯片已失效')
  return { location, surface, scene }
}

export function requireSceneScope(session: SlideInsertionOwner): void {
  if (session.scope !== 'scene') {
    throw new SlideCommandError('wrong-owner', '请先切换到场景层')
  }
}

function appendGlobalLayer(
  project: CourseProjectDocument,
  item: LayerItem,
): void {
  if (project.globalLayerItems.some((entry) => entry.item.layerItemId === item.layerItemId)) {
    throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  }
  const preferred = Math.max(-1, ...project.globalLayerItems.map((entry) => entry.item.order)) + 1
  item.order = allocateCourseLayerOrder(project, Math.max(0, preferred))
  project.globalLayerItems.push({
    item,
    plane: 'overlay',
    visibility: { mode: 'all', locationIds: [] },
  })
  sortScopedLayerList(project.globalLayerItems)
}

export function appendOwnedLayer(
  project: CourseProjectDocument,
  session: SlideInsertionOwner,
  item: LayerItem,
): void {
  if (session.scope === 'global') {
    appendGlobalLayer(project, item)
    return
  }
  requireSceneScope(session)
  const { scene } = slideSceneContext(project, session)
  appendSceneLayer(project, scene, structuredClone(item), session.selection.stateId)
}

function sortSceneLayers(scene: SlideSceneDocument): void {
  scene.layerItems.sort((left, right) =>
    left.order - right.order || left.layerItemId.localeCompare(right.layerItemId),
  )
}

function nextSceneLayerOrder(
  project: CourseProjectDocument,
  scene: SlideSceneDocument,
): number {
  const preferred = Math.max(-1, ...scene.layerItems.map((item) => item.order)) + 1
  return allocateCourseLayerOrder(project, Math.max(0, preferred))
}

export function appendSceneLayer(
  project: CourseProjectDocument,
  scene: SlideSceneDocument,
  item: LayerItem,
  stateId: string | null,
): void {
  if (scene.layerItems.length >= MAX_SCENE_NODES) {
    throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
  }
  if (scene.layerItems.some((candidate) => candidate.layerItemId === item.layerItemId)) {
    throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  }
  item.order = nextSceneLayerOrder(project, scene)
  if (stateId) {
    const presentationState = scene.presentation?.states.find(
      (candidate) => candidate.id === stateId,
    )
    if (!presentationState) throw new Error(`找不到命名状态：${stateId}`)
    item.visible = false
    presentationState.layerItemOverrides[item.layerItemId] = { visible: true }
  }
  scene.layerItems.push(item)
  sortSceneLayers(scene)
}

export function validateSlideLineFrame(
  frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): void {
  if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) {
    throw new SlideCommandError('invalid-target', '线条绘制框必须是有限数值')
  }
  if (frame.width <= 0 || frame.height <= 0) {
    throw new SlideCommandError('invalid-target', '线条绘制框尺寸必须大于 0')
  }
}

export function validateSlideLineGeometry(
  shapeType: ShapeType,
  lineGeometry: NativeLineGeometry,
): NativeLineGeometry {
  if (shapeType !== 'line' && shapeType !== 'elbow-arrow') {
    throw new SlideCommandError(
      'invalid-target',
      `只有直线和折线箭头支持线几何，${shapeType} 不支持`,
    )
  }
  const parsed = nativeLineGeometrySchema.safeParse(lineGeometry)
  if (!parsed.success) {
    throw new SlideCommandError(
      'invalid-target',
      `线几何无效：${parsed.error.issues[0]?.message ?? '未知原因'}`,
    )
  }
  if (shapeType === 'line' && parsed.data.kind !== 'straight') {
    throw new SlideCommandError('invalid-target', '直线只支持 straight 类型的线几何')
  }
  if (shapeType === 'elbow-arrow' && parsed.data.kind !== 'elbow') {
    throw new SlideCommandError('invalid-target', '折线箭头只支持 elbow 类型的线几何')
  }
  return structuredClone(parsed.data)
}

export function requireSlideAsset(
  project: CourseProjectDocument,
  assetId: string,
  kind?: 'image' | 'video',
): void {
  const asset = project.assets[assetId]
  if (!asset) throw new Error(`找不到素材：${assetId}`)
  if (kind && asset.kind !== kind) throw new Error(`素材类型必须是${kind === 'image' ? '图片' : '视频'}`)
}

export function planSlideTextInsertion(document: CourseProjectDocument, owner: SlideInsertionOwner, input: AddSlideTextLayerInput, now?: string) {
    const existingCount = owner.scope === 'global'
      ? document.globalLayerItems.length
      : slideSceneContext(document, owner).scene.layerItems.length
    const node = offsetDefaultSlideInsertion(
      createTextNode({
        id: stableId('text', input.id),
        name: input.label ?? '文本',
        text: input.text ?? '双击编辑文字',
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitCourseProjectMutation(document, (draft) => {
      appendOwnedLayer(draft, owner, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSlideFormulaInsertion(document: CourseProjectDocument, owner: SlideInsertionOwner, input: AddSlideFormulaLayerInput, now?: string) {
    const existingCount = owner.scope === 'global'
      ? document.globalLayerItems.length
      : slideSceneContext(document, owner).scene.layerItems.length
    const node = offsetDefaultSlideInsertion(
      createFormulaNode({
        id: stableId('formula', input.id),
        name: input.label ?? '公式',
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitCourseProjectMutation(document, (draft) => {
      appendOwnedLayer(draft, owner, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSlideShapeInsertion(document: CourseProjectDocument, owner: SlideInsertionOwner, input: AddSlideShapeLayerInput, now?: string) {
    const lineGeometry = input.lineGeometry === undefined
      ? undefined
      : validateSlideLineGeometry(input.shapeType, input.lineGeometry)
    if (input.frame !== undefined) {
      validateSlideLineFrame(input.frame)
      if (!lineGeometry) {
        throw new SlideCommandError('invalid-target', '直接绘制的线条必须同时提供几何参数')
      }
    }
    if (lineGeometry && input.frame === undefined) {
      throw new SlideCommandError('invalid-target', '线条几何必须与绘制框同时提交')
    }
    const existingCount = owner.scope === 'global'
      ? document.globalLayerItems.length
      : slideSceneContext(document, owner).scene.layerItems.length
    const node = offsetDefaultSlideInsertion(
      (() => {
        const created = createShapeNode(input.shapeType, {
          id: stableId('shape', input.id),
          ...(input.label === undefined ? {} : { name: input.label }),
          x: input.frame?.x ?? input.x,
          y: input.frame?.y ?? input.y,
          ...(input.frame ? { width: input.frame.width, height: input.frame.height } : {}),
        })
        if (lineGeometry) created.lineGeometry = structuredClone(lineGeometry)
        return created
      })(),
      existingCount,
      input.frame !== undefined || input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitCourseProjectMutation(document, (draft) => {
      appendOwnedLayer(draft, owner, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSlideImageInsertion(document: CourseProjectDocument, owner: SlideInsertionOwner, input: AddSlideImageLayerInput, now?: string) {
    requireSceneScope(owner)
    requireSlideAsset(document, input.assetId, 'image')
    const existingCount = owner.scope === 'global'
      ? document.globalLayerItems.length
      : slideSceneContext(document, owner).scene.layerItems.length
    const asset = document.assets[input.assetId]!
    const sized = createImageNode(input.assetId, asset.width, asset.height, input.x, input.y)
    const node = offsetDefaultSlideInsertion(
      createImageNode({
        id: stableId('image', input.id),
        name: input.label ?? '图片',
        assetId: input.assetId,
        width: input.width ?? sized.width,
        height: input.height ?? sized.height,
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitCourseProjectMutation(document, (draft) => {
      appendOwnedLayer(draft, owner, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
export function planSlideVideoInsertion(document: CourseProjectDocument, owner: SlideInsertionOwner, input: AddSlideVideoLayerInput, now?: string) {
    requireSlideAsset(document, input.assetId, 'video')
    const existingCount = owner.scope === 'global'
      ? document.globalLayerItems.length
      : slideSceneContext(document, owner).scene.layerItems.length
    const asset = document.assets[input.assetId]!
    const node = offsetDefaultSlideInsertion(
      createVideoNode({
        id: stableId('video', input.id),
        name: input.label ?? '视频',
        assetId: input.assetId,
        width: input.width ?? asset.width ?? 640,
        height: input.height ?? asset.height ?? 360,
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitCourseProjectMutation(document, (draft) => {
      appendOwnedLayer(draft, owner, structuredClone(item))
    }, now)
    return { project, itemId: node.id }
}
