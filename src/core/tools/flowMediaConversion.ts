import type { CourseProjectDocument, FlowBlock, FlowMediaBlock, NativeLayerItem } from '../../shared/courseProjectTypes'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { findFlowBlockRecursive, flowSurfaceIn, stableFlowId, syncFlowCourseLocations } from './flowDocumentModel'
import { appendOverlayItem, nativeMediaOverlay } from './flowNativeInsertion'
import { reconcileFlowParagraphAnchors } from './flowParagraphPlacement'

export function floatFlowMediaBlock(
  document: CourseProjectDocument,
  input: { surfaceId: string; blockId: string; frame: NativeLayerItem['frame']; anchor?: { blockId: string; offsetY: number; xRatio: number }; layerItemId?: string; expectedRevision?: number; now?: string },
): { nextDocument: CourseProjectDocument; layerItemId: string; captionBlockId?: string } {
  if (input.expectedRevision !== undefined && input.expectedRevision !== document.revision) throw new Error('stale-revision')
  const surface = flowSurfaceIn(document, input.surfaceId)
  const source = findFlowBlockRecursive(surface.blocks, input.blockId)
  if (!source || source.block.type !== 'media') throw new Error('找不到正文媒体')
  if (source.block.mediaKind === 'audio') throw new Error('音频不支持转换为纸面 Native')
  if (!document.assets[source.block.assetId] || document.assets[source.block.assetId]?.kind !== source.block.mediaKind) throw new Error('正文媒体素材无效')
  const layerItemId = stableFlowId('media', input.layerItemId)
  const captionBlockId = source.block.caption ? stableFlowId('block') : undefined
  const nextDocument = commitCourseProjectMutation(document, draft => {
    const target = flowSurfaceIn(draft, input.surfaceId)
    const found = findFlowBlockRecursive(target.blocks, input.blockId)!
    const media = found.block as FlowMediaBlock
    const item = nativeMediaOverlay(draft, { assetId: media.assetId, mediaKind: media.mediaKind as 'image' | 'video', id: layerItemId, label: media.altText })
    item.frame = { ...input.frame }
    if (item.content.nativeType === 'image' && media.mediaKind === 'image') {
      if (media.crop) item.content.data.crop = { ...media.crop }
      if (media.cropX !== undefined) item.content.data.cropX = media.cropX
      if (media.cropY !== undefined) item.content.data.cropY = media.cropY
    }
    found.blocks.splice(found.index, 1)
    if (media.caption && captionBlockId) found.blocks.splice(found.index, 0, { id: captionBlockId, type: 'paragraph', content: structuredClone(media.caption) })
    appendOverlayItem(draft, { source: 'surface', surfaceId: input.surfaceId }, item)
    const entry = target.surfaceLayerItems.find(candidate => candidate.item.layerItemId === item.layerItemId)!
    if (input.anchor) entry.paragraphAnchor = { ...input.anchor }
    target.surfaceLayerItems = reconcileFlowParagraphAnchors(surface.blocks, target.blocks, target.surfaceLayerItems)
    syncFlowCourseLocations(draft, input.surfaceId)
  }, input.now)
  return { nextDocument, layerItemId, ...(captionBlockId ? { captionBlockId } : {}) }
}

export function embedFlowNativeMedia(
  document: CourseProjectDocument,
  input: { surfaceId: string; layerItemId: string; parentId: string | null; index: number; blockId?: string; layout?: FlowMediaBlock['layout']; wrap?: FlowMediaBlock['wrap']; altText?: string; expectedRevision?: number; now?: string },
): { nextDocument: CourseProjectDocument; blockId: string } {
  if (input.expectedRevision !== undefined && input.expectedRevision !== document.revision) throw new Error('stale-revision')
  const surface = flowSurfaceIn(document, input.surfaceId)
  const entry = surface.surfaceLayerItems.find(candidate => candidate.item.layerItemId === input.layerItemId)
  if (!entry || entry.item.kind !== 'native' || (entry.item.content.nativeType !== 'image' && entry.item.content.nativeType !== 'video')) throw new Error('所选对象不是纸面媒体')
  if (entry.item.paperSpace !== 'paper') throw new Error('只有纸面 Native 媒体可以改为正文')
  const assetId = entry.item.content.data.assetId
  const mediaKind = entry.item.content.nativeType
  if (document.assets[assetId]?.kind !== mediaKind) throw new Error('纸面媒体素材无效')
  const blockId = stableFlowId('block', input.blockId)
  const nextDocument = commitCourseProjectMutation(document, draft => {
    const target = flowSurfaceIn(draft, input.surfaceId)
    const source = target.surfaceLayerItems.find(candidate => candidate.item.layerItemId === input.layerItemId)!
    const blocks = input.parentId === null ? target.blocks : findFlowBlockRecursive(target.blocks, input.parentId)?.block
    const container = Array.isArray(blocks) ? blocks : blocks?.type === 'section' ? blocks.blocks : undefined
    if (!container || !Number.isInteger(input.index) || input.index < 0 || input.index > container.length) throw new Error('正文插入位置无效')
    const content = (source.item as NativeLayerItem).content
    if (content.nativeType !== 'image' && content.nativeType !== 'video') throw new Error('所选对象不是纸面媒体')
    const media: FlowMediaBlock = { id: blockId, type: 'media', mediaKind, assetId, layout: input.layout ?? 'content-width', ...(input.wrap ? { wrap: input.wrap } : {}), ...(input.altText ? { altText: input.altText } : {}) }
    if (content.nativeType === 'image') {
      media.crop = { ...content.data.crop }
      media.cropX = content.data.cropX
      media.cropY = content.data.cropY
    }
    container.splice(input.index, 0, media)
    target.surfaceLayerItems.splice(target.surfaceLayerItems.indexOf(source), 1)
    syncFlowCourseLocations(draft, input.surfaceId)
  }, input.now)
  return { nextDocument, blockId }
}
