import type { ComponentLayerItem, CourseProjectDocument, LayerFrame, NativeLayerItem } from '../../shared/courseProjectTypes'
import { flowParagraphAnchorSchema, layerFrameSchema, layerItemSchema } from '../../shared/courseProjectSchema'
import { appendOverlayItem } from './flowNativeInsertion'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { flowSurfaceIn, stableFlowId, walkFlowBlocks } from './flowDocumentModel'

export type FlowMenuPaperItem = NativeLayerItem | ComponentLayerItem
export type FlowMenuParagraphAnchor = { blockId: string; offsetY: number; xRatio: number }
  | { kind: 'empty-body'; offsetY: number; xRatio: number }
export interface FlowMenuPaperInsertionInput {
  surfaceId: string
  item: FlowMenuPaperItem
  frame: LayerFrame
  paragraphAnchor: FlowMenuParagraphAnchor
}

/** Call on a canonical mutation draft; discard that draft if a later project validation fails. */
export function appendFlowMenuPaperItem(draft: CourseProjectDocument, input: FlowMenuPaperInsertionInput): { layerItemId: string; anchorBlockId: string } {
  const surface = flowSurfaceIn(draft, input.surfaceId)
  const frame = layerFrameSchema.parse(input.frame)
  const requested = input.paragraphAnchor
  if (!requested || !Number.isFinite(requested.offsetY) || !Number.isFinite(requested.xRatio)) throw new Error('纸面挂靠位置无效')
  let blockId: string
  if ('kind' in requested) {
    if (requested.kind !== 'empty-body' || surface.blocks.length !== 0) throw new Error('仅空正文可创建挂靠段落')
    blockId = stableFlowId('block')
  } else {
    blockId = requested.blockId
    let found = false
    walkFlowBlocks(surface.blocks, block => { if (block.id === blockId) found = true })
    if (!found) throw new Error('找不到当前页的挂靠段落')
  }
  const paragraphAnchor = flowParagraphAnchorSchema.parse({ blockId, offsetY: requested.offsetY, xRatio: requested.xRatio })
  const item = structuredClone(input.item)
  if (item.kind !== 'native' && item.kind !== 'component') throw new Error('纸面菜单不支持该图层类型')
  if (item.kind === 'native' && !['text', 'shape', 'image'].includes(item.content.nativeType)) throw new Error('纸面菜单不支持该 Native 类型')
  if (item.kind === 'component' && item.role) throw new Error('教师控制器不能作为纸面菜单对象')
  item.frame = frame
  item.paperSpace = 'paper'
  layerItemSchema.parse(item)
  if (item.kind === 'native' && item.content.nativeType === 'image' && draft.assets[item.content.data.assetId]?.kind !== 'image') throw new Error('纸面图片素材类型无效')
  if (item.kind === 'component') {
    const component = draft.componentPackages[item.component.packageId]
    if (!component || component.version !== item.component.version) throw new Error('组件包或版本无效')
    if (item.staticFallbackAssetId && draft.assets[item.staticFallbackAssetId]?.kind !== 'image') throw new Error('组件静态后备素材无效')
  }
  const duplicate = draft.globalLayerItems.some(entry => entry.item.layerItemId === item.layerItemId)
    || draft.surfaces.some(candidate => candidate.surfaceLayerItems.some(entry => entry.item.layerItemId === item.layerItemId)
      || (candidate.type === 'slide' && candidate.scenes.some(scene => scene.layerItems.some(layer => layer.layerItemId === item.layerItemId)))
      || (candidate.type === 'spatial-2d' && candidate.world.layerItems.some(layer => layer.layerItemId === item.layerItemId)))
  if (duplicate) throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  if ('kind' in requested) surface.blocks.push({ id: blockId, type: 'paragraph', content: { inlines: [] } })
  appendOverlayItem(draft, { source: 'surface', surfaceId: input.surfaceId }, item)
  const entry = surface.surfaceLayerItems.find(candidate => candidate.item.layerItemId === item.layerItemId)!
  entry.bodyPlane = 'overlay'
  entry.paragraphAnchor = paragraphAnchor
  return { layerItemId: item.layerItemId, anchorBlockId: blockId }
}

export function insertFlowMenuPaperItem(
  document: CourseProjectDocument,
  input: FlowMenuPaperInsertionInput & { expectedRevision?: number; now?: string },
): { nextDocument: CourseProjectDocument; layerItemId: string; anchorBlockId: string } {
  if (input.expectedRevision !== undefined && input.expectedRevision !== document.revision) throw new Error('stale-revision')
  let result!: { layerItemId: string; anchorBlockId: string }
  const nextDocument = commitCourseProjectMutation(document, draft => { result = appendFlowMenuPaperItem(draft, input) }, input.now)
  return { nextDocument, ...result }
}
