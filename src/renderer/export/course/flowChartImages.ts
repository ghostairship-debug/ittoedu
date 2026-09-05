import type { PublishedCourseV2Payload } from '../../../shared/publishedCourseTypes'
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
  return buildFlowDocx(payload, surfaceId, { ...options, chartImages })
}
