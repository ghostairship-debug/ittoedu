import { CANVAS_WIDTH, CANVAS_HEIGHT, MAX_SCENE_NODES } from '../../shared/constants'
import type { CourseProjectDocument, LayerItem, NativeLayerItem } from '../../shared/courseProjectTypes'
import type { ShapeType } from '../../shared/contracts/native-v1'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import { createImageNode, createVideoNode, createTextNode, createShapeNode } from './nativeNodeFactories'
import { flowSurfaceIn, stableFlowId } from './flowDocumentModel'
import { allocateCourseLayerOrder, sortAllCourseLayerLists } from './layerOrder'
import { commitCourseProjectMutation } from './courseProjectMutation'
export interface FlowOverlayDestination { source: 'global' | 'surface'; surfaceId: string }
export function appendOverlayItem(
  draft: CourseProjectDocument,
  destination: { source: 'global' | 'surface'; surfaceId: string },
  item: LayerItem,
): void {
  const ownerCount = destination.source === 'global'
    ? draft.globalLayerItems.length
    : flowSurfaceIn(draft, destination.surfaceId).surfaceLayerItems.length
  if (ownerCount >= MAX_SCENE_NODES) {
    throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
  }
  item.order = allocateCourseLayerOrder(draft, item.order)
  const scoped = { item, visibility: { mode: 'all' as const, locationIds: [] } }
  if (destination.source === 'global') {
    draft.globalLayerItems.push({ ...scoped, plane: 'overlay' })
    sortAllCourseLayerLists(draft)
    return
  }
  flowSurfaceIn(draft, destination.surfaceId).surfaceLayerItems.push({
    ...scoped,
    bodyPlane: 'overlay',
  })
  sortAllCourseLayerLists(draft)
}

export function nativeMediaOverlay(
  document: CourseProjectDocument,
  input: { assetId: string; mediaKind: 'image' | 'video'; id?: string; label?: string },
): NativeLayerItem {
  const asset = document.assets[input.assetId]!
  if (input.mediaKind === 'image') {
    const node = createImageNode({
      id: stableFlowId('image', input.id),
      name: input.label ?? asset.filename ?? '图片',
      assetId: input.assetId,
      width: asset.width,
      height: asset.height,
      x: (CANVAS_WIDTH - (asset.width ?? 320)) / 2,
      y: (CANVAS_HEIGHT - (asset.height ?? 180)) / 2,
    })
    const item = sceneNodeToCourseLayerItem(node) as NativeLayerItem
    item.paperSpace = 'paper'
    return item
  }
  const node = createVideoNode({
    id: stableFlowId('video', input.id),
    name: input.label ?? asset.filename ?? '视频',
    assetId: input.assetId,
    width: asset.width ?? 640,
    height: asset.height ?? 360,
  })
  const item = sceneNodeToCourseLayerItem(node) as NativeLayerItem
  item.paperSpace = 'paper'
  return item
}

export function insertFlowOverlayShape(draft: CourseProjectDocument, destination: FlowOverlayDestination, request: { shapeType: ShapeType; id?: string; label?: string }): string[] {
    const node = createShapeNode(request.shapeType, {
      id: stableFlowId('shape', request.id),
      name: request.label,
    })
    const item = sceneNodeToCourseLayerItem(node)
    appendOverlayItem(draft, destination, item)
    return [item.layerItemId]
}
export function insertFlowOverlayText(draft: CourseProjectDocument, destination: FlowOverlayDestination, request: { text?: string; id?: string; label?: string }): string[] {
    const node = createTextNode({
      id: stableFlowId('text', request.id),
      name: request.label ?? '文本',
      text: request.text ?? '请输入文本',
    })
    const item = sceneNodeToCourseLayerItem(node)
    appendOverlayItem(draft, destination, item)
    return [item.layerItemId]
}

export function planFlowNativeInsertion(document: CourseProjectDocument, destination: FlowOverlayDestination,
  input: { id: string; nativeType: string; text?: string; shapeType?: ShapeType; assetId?: string; label?: string }) {
  flowSurfaceIn(document, destination.surfaceId)
  let itemId = ''
  const project = commitCourseProjectMutation(document, draft => {
    if (input.nativeType === 'text') itemId = insertFlowOverlayText(draft, destination, input)[0]
    else if (input.nativeType === 'shape' && input.shapeType) itemId = insertFlowOverlayShape(draft, destination, { ...input, shapeType: input.shapeType })[0]
    else if ((input.nativeType === 'image' || input.nativeType === 'video') && input.assetId) {
      if (draft.assets[input.assetId]?.kind !== input.nativeType) throw new Error('素材类型与 Native 请求不匹配')
      const item = nativeMediaOverlay(draft, { ...input, assetId: input.assetId, mediaKind: input.nativeType })
      appendOverlayItem(draft, destination, item); itemId = item.layerItemId
    } else throw new Error('Flow 浮层不支持该 Native 类型')
  })
  return { project, itemId }
}
