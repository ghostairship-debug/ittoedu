import type { PublishedCourseV2Payload } from '../../../shared/publishedCourseTypes'
import { capturePublishedCourseV2Stage } from '../playerCapture'
import { publishedCourseV2Schema } from '../../../shared/contracts/published-course-v2/schema'
import { buildNativeChartSvg } from '../../../shared/nativeChartSvg'
import { buildFlowPrintPlan } from './flowPrintPlan'
import { buildFlowDocx, type FlowDocxAsset, type FlowDocxOptions, type FlowDocxResult } from './flowDocx'

async function svgPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('图表静态图面生成超时')), 10000)
      image.onload = () => { clearTimeout(timer); resolve() }
      image.onerror = () => { clearTimeout(timer); reject(new Error('图表静态图面无法加载')) }
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图表静态图面无法绘制')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图表 PNG 生成失败')), 'image/png'))
    return new Uint8Array(await blob.arrayBuffer())
  } finally { image.onload = null; image.onerror = null; URL.revokeObjectURL(url) }
}

/** Capture only new chart pictures; the DOCX writer remains synchronous and deterministic. */
export async function buildFlowDocxWithCharts(payload: PublishedCourseV2Payload, surfaceId: string, options: FlowDocxOptions = {}): Promise<FlowDocxResult> {
  const surface = payload.surfaces.find(surface => surface.id === surfaceId)
  if (!surface || surface.type !== 'flow') throw new Error('找不到流式讲义')
  const chartImages = new Map<string, FlowDocxAsset>(options.chartImages)
  for (const node of buildFlowPrintPlan(surface, options).nodes) {
    if (node.type !== 'chart' || chartImages.has(node.blockId)) continue
    const bytes = await svgPng(buildNativeChartSvg(node.chart, 656, node.height, node.blockId), 656, node.height)
    chartImages.set(node.blockId, { bytes, mimeType: 'image/png' })
  }
  const capturedAssets = new Map<string, FlowDocxAsset>()
  let output = payload
  for (const entry of payload.globalLayerItems) {
    const item = entry.item
    if (item.kind !== 'component' || item.role !== 'teacher-controller' || item.props.includeInStaticExports !== true || !item.visible) continue
    const location = payload.locations.find(l => l.surfaceId === surfaceId &&
      (entry.visibility.mode === 'all' || (entry.visibility.mode === 'include') === entry.visibility.locationIds.includes(l.id)))
    if (!location) continue
    // A static component picture uses the same isolated Slide capture carrier as PPTX.
    // It is a one-way Published projection, never an author document conversion.
    const capturePayload = publishedCourseV2Schema.parse({
      ...payload, mixedPrintPlan: undefined, navigationGuards: [], globalInteractions: [],
      locations: [{ id: location.id, label: location.label, kind: 'slide-scene', surfaceId, sceneId: 'controller-capture' }],
      startLocationId: location.id,
      surfaces: [{ id: surfaceId, title: surface.title, type: 'slide', canvas: { width: 1280, height: 720 }, surfaceLayerItems: [],
        scenes: [{ id: 'controller-capture', name: surface.title, backgroundColor: '#ffffff', layerItems: [], interactions: [] }] }],
      globalLayerItems: [{ ...entry, visibility: { mode: 'all', locationIds: [] }, item: { ...item, frame: { ...item.frame, x: 0, y: 0 }, props: { ...item.props, defaultCollapsed: false } } }],
    })
    const dataUrl = await capturePublishedCourseV2Stage({ payload: capturePayload, locationId: location.id, surfaceId, layerItemId: item.layerItemId, includeGlobalLayerItems: true })
    const assetId = 'controller-capture:' + item.layerItemId
    if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('控制台捕获未返回 PNG')
    capturedAssets.set(assetId, { bytes: Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), c => c.charCodeAt(0)), mimeType: 'image/png' })
    if (output === payload) output = structuredClone(payload)
    const target = output.globalLayerItems.find(e => e.item.layerItemId === item.layerItemId)!.item
    if (target.kind === 'component') target.staticFallbackAssetId = assetId
  }
  return buildFlowDocx(output, surfaceId, { ...options, chartImages, resolveAsset: id => capturedAssets.get(id) ?? options.resolveAsset?.(id) })
}
