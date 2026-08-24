import type { MixedPrintEntry } from '../../../shared/courseProjectTypes'
import type {
  PublishedCourseSurface,
  PublishedCourseV2Payload,
  PublishedFlowSurface,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedSlideScene,
  PublishedSlideSurface,
  PublishedSpatialSurface,
} from '../../../shared/publishedCourseTypes'
import {
  isPublishedScopedVisible,
  spatialRuntimeCameraFromPose,
} from '../../../player/surfaces/spatial/spatialModel'
import { buildPdfPrintHtml } from '../buildPptx'
import {
  buildFlowDocx,
  uniqueFlowDocxFilename,
  type FlowDocxAsset,
} from './flowDocx'
import {
  buildFlowPrintPlan,
  flowPrintPlanHasRuntimeToc,
  renderFlowPrintBodyHtml,
} from './flowPrintPlan'

/** Camera viewport for Spatial print/PDF — not the Slide 1280×720 canvas. */
export const SPATIAL_EXPORT_VIEWPORT = { width: 1120, height: 760 } as const

export type CourseExportPageKind = 'slide-scene' | 'spatial-frame' | 'flow-document'

export interface CourseExportPage {
  id: string
  kind: CourseExportPageKind
  surfaceId: string
  title: string
  sceneId?: string
  cameraFrameId?: string
}

export interface CourseExportReportItem {
  severity: 'error' | 'warning' | 'info'
  message: string
  pageId?: string
  assetId?: string
}

export interface CoursePrintArtifactFile {
  filename: string
  mimeType: string
  bytes: Uint8Array
  kind: 'pdf-html' | 'docx' | 'flow-print-html'
  surfaceId?: string
  pageId?: string
}

export interface BuildCoursePrintArtifactsOptions {
  resolveAssetBytes?: (assetId: string) => FlowDocxAsset | undefined
  /** Optional slide scene raster/HTML capture for PDF pages. */
  captureSlideScene?: (input: {
    published: PublishedCourseV2Payload
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    page: CourseExportPage
  }) => string | Promise<string>
}

export interface CoursePrintArtifactsResult {
  pages: CourseExportPage[]
  files: CoursePrintArtifactFile[]
  report: CourseExportReportItem[]
  warnings: string[]
}

function pushReport(
  report: CourseExportReportItem[],
  item: CourseExportReportItem,
): void {
  report.push(item)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeXml(value: string): string {
  return escapeHtml(value).replace(/'/g, '&apos;')
}

function surfaceById(
  published: PublishedCourseV2Payload,
  surfaceId: string,
): PublishedCourseSurface | undefined {
  return published.surfaces.find((candidate) => candidate.id === surfaceId)
}

function defaultMixedPrintEntries(published: PublishedCourseV2Payload): MixedPrintEntry[] {
  return published.surfaces.map((surface): MixedPrintEntry => {
    if (surface.type === 'slide') {
      return {
        id: `print:${surface.id}`,
        kind: 'slide-scenes',
        surfaceId: surface.id,
        sceneIds: surface.scenes.map((scene) => scene.id),
      }
    }
    if (surface.type === 'flow') {
      return { id: `print:${surface.id}`, kind: 'flow-document', surfaceId: surface.id }
    }
    return {
      id: `print:${surface.id}`,
      kind: 'spatial-frames',
      surfaceId: surface.id,
      cameraFrameIds: surface.camera.frames.map((frame) => frame.id),
    }
  })
}

/**
 * Page list for PPTX / print / DOCX from Published Course V2.
 * Slide → one page per scene; Spatial → one page per camera frame; Flow → print-plan document.
 */
export function buildCourseExportPageList(
  published: PublishedCourseV2Payload,
): CourseExportPage[] {
  const entries = published.mixedPrintPlan?.entries ?? defaultMixedPrintEntries(published)
  const pages: CourseExportPage[] = []
  for (const entry of entries) {
    const surface = surfaceById(published, entry.surfaceId)
    if (!surface) continue
    if (entry.kind === 'slide-scenes' && surface.type === 'slide') {
      for (const sceneId of entry.sceneIds) {
        const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
        if (!scene) continue
        pages.push({
          id: `${entry.id}:${sceneId}`,
          kind: 'slide-scene',
          surfaceId: surface.id,
          title: scene.name,
          sceneId,
        })
      }
      continue
    }
    if (entry.kind === 'flow-document' && surface.type === 'flow') {
      pages.push({
        id: entry.id,
        kind: 'flow-document',
        surfaceId: surface.id,
        title: surface.title,
      })
      continue
    }
    if (entry.kind === 'spatial-frames' && surface.type === 'spatial-2d') {
      const frameIds = entry.cameraFrameIds.length > 0
        ? entry.cameraFrameIds
        : surface.camera.frames.map((frame) => frame.id)
      for (const frameId of frameIds) {
        const frame = surface.camera.frames.find((candidate) => candidate.id === frameId)
        pages.push({
          id: `${entry.id}:${frameId}`,
          kind: 'spatial-frame',
          surfaceId: surface.id,
          title: frame?.name ?? surface.title,
          cameraFrameId: frameId,
        })
      }
    }
  }
  return pages
}

export function isTeacherControllerPublishedItem(
  item: PublishedLayerItem,
): item is PublishedNativeLayerItem & {
  content: Extract<PublishedNativeLayerItem['content'], { nativeType: 'teacher-controller' }>
} {
  return item.kind === 'native' && item.content.nativeType === 'teacher-controller'
}

/** Global layers and teacher controllers are viewport HUD by default and stay out of files. */
export function shouldOmitPublishedItemFromStaticExport(item: PublishedLayerItem): boolean {
  if (isTeacherControllerPublishedItem(item)) {
    return !item.content.data.includeInStaticExports
  }
  return false
}

function resolvePublishedAssetUrl(
  published: PublishedCourseV2Payload,
  assetId: string,
): string | undefined {
  return published.assets[assetId]?.url
}

function nativeTextFromItem(item: PublishedNativeLayerItem): string | undefined {
  if (item.content.nativeType !== 'text') return undefined
  return item.content.data.text
}

function renderSpatialWorldItemMarkup(
  item: PublishedLayerItem,
  resolveAsset: (assetId: string) => string | undefined,
): string {
  if (!item.visible || shouldOmitPublishedItemFromStaticExport(item)) return ''
  if (item.kind === 'native' && item.content.nativeType === 'text') {
    const text = escapeXml(nativeTextFromItem(item) ?? '')
    const { x, y, width, height } = item.frame
    return `<g data-layer-item-id="${escapeXml(item.layerItemId)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/><text x="${x + 8}" y="${y + 24}" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="18" fill="#172033">${text}</text></g>`
  }
  if (item.kind === 'native' && item.content.nativeType === 'image') {
    const href = resolveAsset(item.content.data.assetId)
    const { x, y, width, height } = item.frame
    if (href) {
      return `<image data-layer-item-id="${escapeXml(item.layerItemId)}" href="${escapeXml(href)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`
    }
    return `<g data-layer-item-id="${escapeXml(item.layerItemId)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="4 3"/><text x="${x + 8}" y="${y + 20}" font-size="12" fill="#64748b">图片素材缺失</text></g>`
  }
  if (item.kind === 'component' || item.kind === 'runtime') {
    const { x, y, width, height } = item.frame
    const fallbackId = item.kind === 'component'
      ? item.staticFallbackAssetId
      : item.runtime.staticFallback?.assetId
    const href = fallbackId ? resolveAsset(fallbackId) : undefined
    if (href) {
      return `<image data-layer-item-id="${escapeXml(item.layerItemId)}" href="${escapeXml(href)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`
    }
    return `<g data-layer-item-id="${escapeXml(item.layerItemId)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#eff6ff" stroke="#2563eb" stroke-dasharray="4 3"/><text x="${x + 8}" y="${y + 20}" font-size="12" fill="#1d4ed8">${item.kind === 'component' ? '组件静态后备缺失' : '运行时静态后备缺失'}</text></g>`
  }
  return ''
}

export function renderPublishedSpatialFrameSvg(
  surface: PublishedSpatialSurface,
  frameId: string | undefined,
  resolveAsset: (assetId: string) => string | undefined,
): { svg: string; viewport: { width: number; height: number } } {
  const frame = frameId
    ? surface.camera.frames.find((candidate) => candidate.id === frameId)
    : undefined
  const pose = frame ?? surface.camera.home
  const camera = spatialRuntimeCameraFromPose(pose, SPATIAL_EXPORT_VIEWPORT)
  const worldItems = surface.world.layerItems
    .filter((item) => !shouldOmitPublishedItemFromStaticExport(item))
    .map((item) => renderSpatialWorldItemMarkup(item, resolveAsset))
    .join('')
  const transform = `translate(${camera.viewportWidth / 2} ${camera.viewportHeight / 2}) scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${camera.viewportWidth}" height="${camera.viewportHeight}" viewBox="0 0 ${camera.viewportWidth} ${camera.viewportHeight}" data-spatial-frame="${escapeXml(frameId ?? 'home')}" data-spatial-viewport="${camera.viewportWidth}x${camera.viewportHeight}"><rect width="100%" height="100%" fill="#ffffff"/><g transform="${transform}">${worldItems}</g></svg>`
  return { svg, viewport: SPATIAL_EXPORT_VIEWPORT }
}

function buildSlideScenePrintHtml(
  published: PublishedCourseV2Payload,
  surface: PublishedSlideSurface,
  scene: PublishedSlideScene,
): string {
  const location = published.locations.find((candidate) => (
    candidate.kind === 'slide-scene' &&
    candidate.surfaceId === surface.id &&
    candidate.sceneId === scene.id
  ))
  const locationId = location?.id ?? scene.id
  const state = scene.presentation?.states.find(
    (candidate) => candidate.id === scene.presentation?.initialStateId,
  )
  const items = [
    ...surface.surfaceLayerItems
      .filter((entry) => isPublishedScopedVisible(entry.visibility, locationId))
      .map((entry) => entry.item),
    ...scene.layerItems,
  ]
    .filter((item) => item.visible && !shouldOmitPublishedItemFromStaticExport(item))
    .sort((left, right) => left.order - right.order || left.layerItemId.localeCompare(right.layerItemId))
  const body = items.map((item) => {
    if (item.kind === 'native' && item.content.nativeType === 'text') {
      return `<p data-layer-item-id="${escapeHtml(item.layerItemId)}" style="position:absolute;left:${item.frame.x}px;top:${item.frame.y}px;width:${item.frame.width}px;height:${item.frame.height}px;margin:0">${escapeHtml(item.content.data.text)}</p>`
    }
    return `<p data-layer-item-id="${escapeHtml(item.layerItemId)}" style="position:absolute;left:${item.frame.x}px;top:${item.frame.y}px;width:${item.frame.width}px;height:${item.frame.height}px;margin:0;color:#64748b">[${escapeHtml(item.layerItemId)}]</p>`
  }).join('')
  const background = state?.backgroundColor ?? scene.backgroundColor
  return `<section class="page course-slide-print-page" data-scene-id="${escapeHtml(scene.id)}" style="position:relative;width:1280px;height:720px;background:${escapeHtml(background)}">${body}</section>`
}

function buildMixedPrintDocumentHtml(
  published: PublishedCourseV2Payload,
  pages: readonly CourseExportPage[],
  options: BuildCoursePrintArtifactsOptions,
): string {
  const resolveAsset = (assetId: string) => resolvePublishedAssetUrl(published, assetId)
  const sections: string[] = []
  for (const page of pages) {
    const surface = surfaceById(published, page.surfaceId)
    if (!surface) continue
    if (page.kind === 'slide-scene' && surface.type === 'slide' && page.sceneId) {
      const scene = surface.scenes.find((candidate) => candidate.id === page.sceneId)
      if (!scene) continue
      sections.push(buildSlideScenePrintHtml(published, surface, scene))
      continue
    }
    if (page.kind === 'spatial-frame' && surface.type === 'spatial-2d') {
      const { svg } = renderPublishedSpatialFrameSvg(surface, page.cameraFrameId, resolveAsset)
      sections.push(`<section class="page course-spatial-print-page" data-page-id="${escapeHtml(page.id)}" data-camera-frame="${escapeHtml(page.cameraFrameId ?? 'home')}"><h2>${escapeHtml(page.title)}</h2>${svg}</section>`)
      continue
    }
    if (page.kind === 'flow-document' && surface.type === 'flow') {
      const plan = buildFlowPrintPlan(surface, {
        pageSize: published.mixedPrintPlan?.pageSize === 'letter' ? 'letter' : 'A4',
        orientation: published.mixedPrintPlan?.orientation === 'landscape'
          ? 'landscape'
          : published.mixedPrintPlan?.orientation === 'portrait'
            ? 'portrait'
            : undefined,
      })
      sections.push(`<section class="page flow-print-document" data-page-id="${escapeHtml(page.id)}" data-flow-print-surface="${escapeHtml(plan.surfaceId)}">${renderFlowPrintBodyHtml(plan)}</section>`)
    }
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeHtml(published.title)}</title><style>@page{margin:0}html,body{margin:0;background:#fff;font-family:"Microsoft YaHei","PingFang SC",sans-serif}.page{break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.course-spatial-print-page h2{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style></head><body>${sections.join('')}</body></html>`
}

export function auditCourseExportFonts(
  published: PublishedCourseV2Payload,
  report: CourseExportReportItem[],
): void {
  const fonts = published.designTokens.fonts.map((entry) => entry.fontFamily.trim()).filter(Boolean)
  if (fonts.length === 0) {
    pushReport(report, {
      severity: 'warning',
      message: '课程未声明设计字体，静态导出将回退到 Microsoft YaHei。',
    })
    return
  }
  for (const fontFamily of fonts) {
    if (!/YaHei|PingFang|SimSun|SimHei|Arial|sans-serif/i.test(fontFamily)) {
      pushReport(report, {
        severity: 'warning',
        message: `字体“${fontFamily.split(',')[0]?.trim() ?? fontFamily}”可能未安装，导出结果可能回退到系统字体。`,
      })
    }
  }
}

export function auditCourseExportAssets(
  published: PublishedCourseV2Payload,
  report: CourseExportReportItem[],
  resolveAssetBytes?: BuildCoursePrintArtifactsOptions['resolveAssetBytes'],
): void {
  for (const [assetId, asset] of Object.entries(published.assets)) {
    if (!asset.url?.trim()) {
      pushReport(report, {
        severity: 'error',
        message: `素材 ${assetId} 缺少可离线引用的 URL。`,
        assetId,
      })
    }
    if (resolveAssetBytes && !resolveAssetBytes(assetId)) {
      pushReport(report, {
        severity: 'warning',
        message: `素材 ${assetId} 未提供二进制内容，DOCX/嵌入媒体可能使用后备说明。`,
        assetId,
      })
    }
  }
}

function auditExportSize(bytes: Uint8Array, label: string, report: CourseExportReportItem[]): void {
  const megabytes = bytes.byteLength / (1024 * 1024)
  if (megabytes > 48) {
    pushReport(report, {
      severity: 'warning',
      message: `${label} 体积约 ${megabytes.toFixed(1)} MB，可能超出部分查看器或邮件大小限制。`,
    })
  }
}

/**
 * Build printable/PDF/DOCX artifacts from Published Course V2. Returns bytes and
 * filenames only — writing to disk is R7-Z.
 */
export async function buildCoursePrintArtifacts(
  published: PublishedCourseV2Payload,
  options: BuildCoursePrintArtifactsOptions = {},
): Promise<CoursePrintArtifactsResult> {
  const report: CourseExportReportItem[] = []
  const warnings: string[] = []
  const files: CoursePrintArtifactFile[] = []
  const pages = buildCourseExportPageList(published)
  if (pages.length === 0) {
    pushReport(report, {
      severity: 'error',
      message: '当前 Published Course V2 没有可导出的页面。',
    })
    return { pages, files, report, warnings }
  }

  auditCourseExportFonts(published, report)
  auditCourseExportAssets(published, report, options.resolveAssetBytes)

  if (published.globalLayerItems.length > 0) {
    pushReport(report, {
      severity: 'info',
      message: '全局图层与教师控制器默认不写入 PDF/DOCX 文件。',
    })
  }

  const pdfImages: string[] = []
  const pdfImagePageIds: string[] = []
  for (const page of pages) {
    const surface = surfaceById(published, page.surfaceId)
    if (!surface) continue
    if (page.kind === 'slide-scene' && surface.type === 'slide' && page.sceneId) {
      const scene = surface.scenes.find((candidate) => candidate.id === page.sceneId)
      if (!scene) continue
      try {
        const captured = options.captureSlideScene
          ? await options.captureSlideScene({ published, surface, scene, page })
          : undefined
        if (captured?.startsWith('data:image/')) {
          pdfImages.push(captured)
          pdfImagePageIds.push(page.id)
        } else {
          pushReport(report, {
            severity: 'warning',
            message: `Slide 场景“${scene.name}”未提供 PDF 快照，已跳过该页图像。`,
            pageId: page.id,
          })
        }
      } catch (cause) {
        pushReport(report, {
          severity: 'warning',
          message: `Slide 场景“${scene.name}”PDF 快照失败：${cause instanceof Error ? cause.message : String(cause)}`,
          pageId: page.id,
        })
      }
      continue
    }
    if (page.kind === 'spatial-frame' && surface.type === 'spatial-2d') {
      const { svg, viewport } = renderPublishedSpatialFrameSvg(
        surface,
        page.cameraFrameId,
        (assetId) => resolvePublishedAssetUrl(published, assetId),
      )
      if (viewport.width === 1280 && viewport.height === 720 && surface.world.bounds.mode === 'infinite') {
        pushReport(report, {
          severity: 'error',
          message: 'Spatial 无限画布被错误裁成 1280×720，已中止该页。',
          pageId: page.id,
        })
        continue
      }
      const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      pdfImages.push(encoded)
      pdfImagePageIds.push(page.id)
      continue
    }
  }

  const mixedHtml = buildMixedPrintDocumentHtml(published, pages, options)
  const mixedBytes = new TextEncoder().encode(mixedHtml)
  auditExportSize(mixedBytes, '混合打印 HTML', report)
  files.push({
    filename: `${published.title || 'course'}-print.html`,
    mimeType: 'text/html;charset=utf-8',
    bytes: mixedBytes,
    kind: 'flow-print-html',
  })

  const imageCoverageComplete = pdfImagePageIds.length === pages.length
    && pages.every((page, index) => pdfImagePageIds[index] === page.id)
  const pureSlide = published.locations.every((location) => location.kind === 'slide-scene')
    && published.surfaces.every((surface) => surface.type === 'slide')
  if (imageCoverageComplete || !pureSlide) {
    const pdfHtml = imageCoverageComplete
      ? buildPdfPrintHtml(published.title, pdfImages)
      : mixedHtml
    const pdfBytes = new TextEncoder().encode(pdfHtml)
    auditExportSize(pdfBytes, 'PDF 打印 HTML', report)
    files.push({
      filename: `${published.title || 'course'}-print.pdf-html`,
      mimeType: 'text/html;charset=utf-8',
      bytes: pdfBytes,
      kind: 'pdf-html',
    })
  }

  const usedDocxNames = new Set<string>()
  for (const page of pages.filter((candidate) => candidate.kind === 'flow-document')) {
    const surface = surfaceById(published, page.surfaceId)
    if (!surface || surface.type !== 'flow') continue
    const plan = buildFlowPrintPlan(surface, {
      pageSize: published.mixedPrintPlan?.pageSize === 'letter' ? 'letter' : 'A4',
      orientation: published.mixedPrintPlan?.orientation === 'landscape'
        ? 'landscape'
        : published.mixedPrintPlan?.orientation === 'portrait'
          ? 'portrait'
          : undefined,
    })
    if (flowPrintPlanHasRuntimeToc(plan)) {
      pushReport(report, {
        severity: 'error',
        message: 'Flow 打印计划意外包含运行态目录抽屉，已拒绝写入 DOCX。',
        pageId: page.id,
      })
      continue
    }
    const docx = buildFlowDocx(surface, {
      resolveAsset: options.resolveAssetBytes,
      pageSize: plan.pageSize,
      orientation: plan.orientation,
    })
    warnings.push(...docx.warnings)
    auditExportSize(docx.bytes, `Flow DOCX（${surface.title}）`, report)
    files.push({
      filename: uniqueFlowDocxFilename(surface.title, usedDocxNames),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docx.bytes,
      kind: 'docx',
      surfaceId: surface.id,
      pageId: page.id,
    })
  }

  return { pages, files, report, warnings }
}

export function publishedFlowSurfaceFromCourse(
  published: PublishedCourseV2Payload,
  surfaceId: string,
): PublishedFlowSurface | undefined {
  const surface = surfaceById(published, surfaceId)
  return surface?.type === 'flow' ? surface : undefined
}
