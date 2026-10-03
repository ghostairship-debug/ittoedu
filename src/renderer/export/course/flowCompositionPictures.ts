import type { PublishedCompositionLayerItem, PublishedCourseV2Payload, PublishedFlowSurface } from '../../../shared/publishedCourseTypes'
import { capturePublishedCourseV2Stage } from '../playerCapture'
import type { FlowPrintNode } from './flowPrintPlan'

export interface FlowCompositionPicture {
  assetId: string
  width: number
  height: number
  dataUrl: string
  bytes: Uint8Array
}
export interface FlowCompositionPictures {
  layerItemId: string
  scope: 'surface' | 'global'
  anchorBlockId: string
  pictures: readonly FlowCompositionPicture[]
  failure?: string
}

/** Crop an actual rendered region into readable page pictures; never shrink a long region to one page. */
export async function sliceFlowCompositionPicture(dataUrl: string, id: string, width: number, height: number): Promise<FlowCompositionPicture[]> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const scale = Math.min(1, width / image.naturalWidth)
  const sourceHeight = Math.max(1, Math.floor(height / scale))
  const pictures: FlowCompositionPicture[] = []
  for (let y = 0; y < image.naturalHeight; y += sourceHeight) {
    const pixels = Math.min(sourceHeight, image.naturalHeight - y)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(pixels * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建 Web 组合分页图片画布')
    context.drawImage(image, 0, y, image.naturalWidth, pixels, 0, 0, canvas.width, canvas.height)
    const picture = canvas.toDataURL('image/png')
    pictures.push({ assetId: `composition-print:${id}:${pictures.length}`, width: canvas.width, height: canvas.height,
      dataUrl: picture, bytes: Uint8Array.from(atob(picture.slice(picture.indexOf(',') + 1)), char => char.charCodeAt(0)) })
    canvas.width = 1; canvas.height = 1
  }
  return pictures
}

export async function captureFlowCompositionPictures(
  payload: PublishedCourseV2Payload,
  surface: PublishedFlowSurface,
  box: { maxContentWidthPx: number; maxContentHeightPx: number },
  onFailure: (layerItemId: string, error: unknown) => void,
): Promise<FlowCompositionPictures[]> {
  const groups: FlowCompositionPictures[] = []
  const entries = [
    ...surface.surfaceLayerItems.map(entry => ({ ...entry, scope: 'surface' as const })),
    ...payload.globalLayerItems.map(entry => ({ ...entry, scope: 'global' as const })),
  ].sort((a, b) => a.item.order - b.item.order)
  for (const entry of entries) {
    if (entry.item.kind !== 'composition' || !entry.item.visible) continue
    const item: PublishedCompositionLayerItem = entry.item
    const location = payload.locations.find(location => location.surfaceId === surface.id && location.kind === 'flow-block'
      && (entry.visibility.mode === 'all' || (entry.visibility.mode === 'include') === entry.visibility.locationIds.includes(location.id)))
    if (!location || location.kind !== 'flow-block') continue
    try {
      const captured = await capturePublishedCourseV2Stage({ payload, surfaceId: surface.id, locationId: location.id,
        layerItemId: item.layerItemId, includeGlobalLayerItems: entry.scope === 'global' })
      if (!captured.startsWith('data:image/')) throw new Error('Web 组合捕获没有返回图片')
      const pictures = await sliceFlowCompositionPicture(captured, item.layerItemId, box.maxContentWidthPx, box.maxContentHeightPx - 32)
      groups.push({ layerItemId: item.layerItemId, scope: entry.scope,
        anchorBlockId: 'paragraphAnchor' in entry && entry.paragraphAnchor ? entry.paragraphAnchor.blockId : location.blockId,
        pictures })
    } catch (error) {
      onFailure(item.layerItemId, error)
      groups.push({ layerItemId: item.layerItemId, scope: entry.scope,
        anchorBlockId: 'paragraphAnchor' in entry && entry.paragraphAnchor ? entry.paragraphAnchor.blockId : location.blockId,
        pictures: [], failure: error instanceof Error ? error.message : String(error) })
    }
  }
  return groups
}

export function flowCompositionPictureNodes(group: FlowCompositionPictures): FlowPrintNode[] {
  if (!group.pictures.length) return [{ type: 'callout', blockId: `${group.layerItemId}:capture-missing`, tone: 'warning',
    body: { inlines: [{ type: 'text', text: `Web 组合“${group.layerItemId}”实际图面导出失败：${group.failure ?? '尚未取得图面'}。` }] } }]
  return group.pictures.map((picture, index) => ({ type: 'media', mediaKind: 'image', blockId: `${group.layerItemId}:print:${index}`,
    assetId: picture.assetId, fallbackLabel: `Web 组合 ${group.layerItemId}，第 ${index + 1}/${group.pictures.length} 段`,
    width: picture.width, height: picture.height, ...(index ? { pageBreakBefore: true } : {}) }))
}

/** The ordinary Flow body stays semantic. Only the unsupported Web region gains its actual picture projection. */
export function appendFlowCompositionPictureNodes(nodes: readonly FlowPrintNode[], groups: readonly FlowCompositionPictures[]): FlowPrintNode[] {
  const output: FlowPrintNode[] = []
  const remaining = new Set(groups)
  for (const node of nodes) {
    output.push(node)
    for (const group of remaining) if ('blockId' in node && node.blockId === group.anchorBlockId) {
      output.push(...flowCompositionPictureNodes(group)); remaining.delete(group)
    }
  }
  for (const group of remaining) output.push(...flowCompositionPictureNodes(group))
  return output
}
