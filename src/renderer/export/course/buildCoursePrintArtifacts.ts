import type { MixedPrintEntry } from '../../../shared/courseProjectTypes'
import { composePublishedCourseLocation } from '../../../shared/courseLayerComposition'
import type {
  PublishedCourseSurface,
  PublishedCourseV2Payload,
  PublishedFlowSurface,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedSlideScene,
  PublishedSlidePresentationState,
  PublishedSlideSurface,
  PublishedSpatialSurface,
} from '../../../shared/publishedCourseTypes'
import { isParsedPublishedCourseV2 } from '../../../player/surfaces/CoursePlayer'
import type { SurfaceCapture } from '../../../player/surfaces/SurfaceHost'
import {
  collectSpatialPlaybackEntries,
  publishedSpatialInputFromCourse,
} from '../../../player/surfaces/spatial/spatialModel'
import { SPATIAL_EXPORT_VIEWPORT } from '../../../player/surfaces/spatial/publishedSpatialStaticRendering'
import { buildPdfPrintHtml } from './pdfPrintHtml'
import { createPublishedCourseV2PrintCaptureSession } from '../playerCapture'
import {
  buildPublishedCourseV2Payload,
  type CoursePublishSources,
} from './buildPublishedCourse'
import {
  buildFlowDocx,
  uniqueFlowDocxFilename,
  type FlowDocxAsset,
} from './flowDocx'
import {
  buildFlowPrintPlan,
  flowPrintOmittedOverlayMessage,
  flowPrintPlanHasRuntimeToc,
  renderFlowPrintBodyHtml,
} from './flowPrintPlan'

export type CourseExportPageKind = 'slide-scene' | 'spatial-frame' | 'flow-document'

export interface CourseExportPage {
  id: string
  kind: CourseExportPageKind
  surfaceId: string
  title: string
  sceneId?: string
  /** Concrete course-order location that supplies Slide state and visibility. */
  locationId?: string
  cameraFrameId?: string
}

export interface CourseExportReportItem {
  severity: 'error' | 'warning' | 'info'
  message: string
  pageId?: string
  assetId?: string
  layerItemId?: string
  path?: ReadonlyArray<string | number>
}

export interface CoursePrintArtifactFile {
  filename: string
  mimeType: string
  bytes: Uint8Array
  kind: 'pdf-html' | 'docx' | 'flow-print-html'
  surfaceId?: string
  pageId?: string
}

export type BuildCoursePrintArtifactsInput = CoursePublishSources | PublishedCourseV2Payload

function isCoursePublishSources(input: object): input is CoursePublishSources {
  if (!('project' in input) || !('assetFiles' in input) || !('components' in input)) {
    return false
  }
  const project = (input as { project?: { schemaVersion?: unknown } }).project
  return project?.schemaVersion === 9
}

function resolvePublishedCourseForPrint(input: BuildCoursePrintArtifactsInput): PublishedCourseV2Payload {
  if (isParsedPublishedCourseV2(input)) return input
  if (isCoursePublishSources(input)) return buildPublishedCourseV2Payload(input)
  throw new Error(
    'PDF 只接受 Course Project V9 发布源或已解析的 Published Course V2，不接受 Legacy Project/Scene。',
  )
}

function resolveAssetBytesFromSources(
  sources: CoursePublishSources,
  assetId: string,
): FlowDocxAsset | undefined {
  const meta = sources.project.assets[assetId]
  const bytes = sources.assetFiles[assetId]
  return meta && bytes
    ? { bytes, mimeType: meta.mimeType, filename: meta.filename }
    : undefined
}

export interface BuildCoursePrintArtifactsOptions {
  resolveAssetBytes?: (assetId: string) => FlowDocxAsset | undefined
  /** Optional slide scene raster/HTML capture for PDF pages. */
  captureSlideScene?: (input: {
    published: PublishedCourseV2Payload
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    page: CourseExportPage
    /** Stable location used for state and scoped-global visibility. */
    locationId: string
    /** True only for pure-Slide delivery; the capture host owns global compositing. */
    includeGlobalLayerItems: boolean
  }) => string | SurfaceCapture | Promise<string | SurfaceCapture>
}

function normalizeCapturedVisualPage(
  capture: string | SurfaceCapture | undefined,
  fallback: { width: number; height: number },
): CapturedVisualPage | null {
  if (typeof capture === 'string') {
    return capture.startsWith('data:image/')
      ? { dataUrl: capture, width: fallback.width, height: fallback.height, warnings: [] }
      : null
  }
  if (!capture || capture.format !== 'data-url' || !capture.content.startsWith('data:image/')) {
    return null
  }
  return {
    dataUrl: capture.content,
    width: Math.max(1, Math.round(capture.width ?? fallback.width)),
    height: Math.max(1, Math.round(capture.height ?? fallback.height)),
    warnings: capture.warnings ?? [],
  }
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
        const location = published.locations.find((candidate) => (
          candidate.kind === 'slide-scene'
          && candidate.surfaceId === surface.id
          && candidate.sceneId === scene.id
        ))
        pages.push({
          id: `${entry.id}:${sceneId}`,
          kind: 'slide-scene',
          surfaceId: surface.id,
          title: scene.name,
          sceneId,
          ...(location ? { locationId: location.id } : {}),
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
        const location = published.locations.find((candidate) => (
          candidate.kind === 'spatial-camera'
          && candidate.surfaceId === surface.id
          && candidate.cameraFrameId === frameId
        ))
        pages.push({
          id: `${entry.id}:${frameId}`,
          kind: 'spatial-frame',
          surfaceId: surface.id,
          title: frame?.name ?? surface.title,
          cameraFrameId: frameId,
          ...(location ? { locationId: location.id } : {}),
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

/** Teacher controllers stay out unless the author explicitly enables static export. */
export function shouldOmitPublishedItemFromStaticExport(item: PublishedLayerItem): boolean {
  if (isTeacherControllerPublishedItem(item)) {
    return !item.content.data.includeInStaticExports
  }
  return false
}

export function isPureSlidePublishedCourse(
  published: PublishedCourseV2Payload,
): boolean {
  return published.locations.every((location) => location.kind === 'slide-scene')
    && published.surfaces.every((surface) => surface.type === 'slide')
}

export interface PublishedSlideStaticComposition {
  locationId: string
  state?: PublishedSlidePresentationState
  items: PublishedLayerItem[]
}

/** Shared static composition for a Published Slide page. */
export function composePublishedSlideStaticPage(
  published: PublishedCourseV2Payload,
  surface: PublishedSlideSurface,
  scene: PublishedSlideScene,
  options: { includeGlobalLayerItems: boolean; locationId: string },
): PublishedSlideStaticComposition {
  const location = published.locations.find((candidate) => (
    candidate.id === options.locationId
    && candidate.kind === 'slide-scene'
    && candidate.surfaceId === surface.id
    && candidate.sceneId === scene.id
  ))
  if (!location || location.kind !== 'slide-scene') {
    throw new Error(`Published Slide 页“${scene.name}”找不到位置“${options.locationId}”`)
  }
  const locationId = location.id
  const stateId = location.stateId ?? scene.presentation?.initialStateId ?? null
  const state = scene.presentation?.states.find((candidate) => candidate.id === stateId)
  const composition = composePublishedCourseLocation({
    course: published,
    locationId,
    stateId,
  })
  const items = composition.entries
    .filter((entry) => (
      entry.applicable
      && entry.mounted
      && (options.includeGlobalLayerItems || entry.source !== 'global')
      && !shouldOmitPublishedItemFromStaticExport(entry.item)
    ))
    .map((entry) => entry.item)
  return {
    locationId,
    ...(state ? { state } : {}),
    items,
  }
}

function resolvePublishedAssetUrl(
  published: PublishedCourseV2Payload,
  assetId: string,
): string | undefined {
  return published.assets[assetId]?.url
}


interface MixedPrintPageLayout {
  readonly pageRule: string
  readonly width: string
  readonly height: string
}

interface CapturedVisualPage {
  readonly dataUrl: string
  readonly width: number
  readonly height: number
  readonly warnings: readonly string[]
}

function resolveMixedPrintPageLayout(
  published: PublishedCourseV2Payload,
  pages: readonly CourseExportPage[],
): MixedPrintPageLayout {
  const pageSize = published.mixedPrintPlan?.pageSize ?? 'A4'
  const configuredOrientation = published.mixedPrintPlan?.orientation ?? 'auto'
  const hasNativeVisualPage = pages.some((page) => page.kind !== 'flow-document')
  const nativeSize = pages.some((page) => page.kind === 'slide-scene')
    ? { widthPixels: 1280, heightPixels: 720 }
    : pages.some((page) => page.kind === 'spatial-frame')
      ? { widthPixels: SPATIAL_EXPORT_VIEWPORT.width, heightPixels: SPATIAL_EXPORT_VIEWPORT.height }
      : { widthPixels: 210 / 25.4 * 96, heightPixels: 297 / 25.4 * 96 }
  const orientation = configuredOrientation === 'auto'
    ? hasNativeVisualPage ? 'landscape' : 'portrait'
    : configuredOrientation
  const inches = (pixels: number) => `${Number((pixels / 96).toFixed(6))}in`
  const portrait = pageSize === 'surface-native'
    ? {
        width: inches(Math.min(nativeSize.widthPixels, nativeSize.heightPixels)),
        height: inches(Math.max(nativeSize.widthPixels, nativeSize.heightPixels)),
        widthPixels: Math.min(nativeSize.widthPixels, nativeSize.heightPixels),
        heightPixels: Math.max(nativeSize.widthPixels, nativeSize.heightPixels),
      }
    : pageSize === 'letter'
      ? { width: '8.5in', height: '11in', widthPixels: 8.5 * 96, heightPixels: 11 * 96 }
      : {
          width: '210mm',
          height: '297mm',
          widthPixels: 210 / 25.4 * 96,
          heightPixels: 297 / 25.4 * 96,
        }
  const oriented = orientation === 'landscape'
    ? {
        width: portrait.height,
        height: portrait.width,
        widthPixels: portrait.heightPixels,
        heightPixels: portrait.widthPixels,
      }
    : portrait
  return {
    pageRule: pageSize === 'surface-native'
      ? `${oriented.width} ${oriented.height}`
      : `${pageSize} ${orientation}`,
    width: oriented.width,
    height: oriented.height,
  }
}

function buildMixedPrintDocumentHtml(
  published: PublishedCourseV2Payload,
  pages: readonly CourseExportPage[],
  visualCaptures: ReadonlyMap<string, CapturedVisualPage>,
): string {
  const sections: string[] = []
  for (const page of pages) {
    const surface = surfaceById(published, page.surfaceId)
    if (!surface) continue
    if (page.kind === 'slide-scene' && surface.type === 'slide' && page.sceneId) {
      const scene = surface.scenes.find((candidate) => candidate.id === page.sceneId)
      if (!scene) continue
      const captured = visualCaptures.get(page.id)
      if (!captured) continue
      sections.push(`<section class="page course-visual-print-page course-slide-print-page" data-page-id="${escapeHtml(page.id)}" data-scene-id="${escapeHtml(scene.id)}" data-published-v2-capture="true"><div class="course-visual-print-canvas course-slide-print-canvas" data-capture-width="${captured.width}" data-capture-height="${captured.height}"><img class="course-visual-print-capture course-slide-print-capture" src="${escapeHtml(captured.dataUrl)}" alt="${escapeHtml(scene.name)}"/></div></section>`)
      continue
    }
    if (page.kind === 'spatial-frame' && surface.type === 'spatial-2d') {
      const captured = visualCaptures.get(page.id)
      if (!captured) continue
      sections.push(`<section class="page course-visual-print-page course-spatial-print-page" data-page-id="${escapeHtml(page.id)}" data-camera-frame="${escapeHtml(page.cameraFrameId ?? 'home')}" data-published-v2-capture="true"><div class="course-visual-print-canvas course-spatial-print-canvas" data-capture-width="${captured.width}" data-capture-height="${captured.height}"><img class="course-visual-print-capture course-spatial-print-capture" src="${escapeHtml(captured.dataUrl)}" alt="${escapeHtml(page.title)}"/></div></section>`)
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
      sections.push(`<section class="page flow-print-document" style="background:${escapeHtml(plan.backgroundColor)}" data-page-id="${escapeHtml(page.id)}" data-flow-print-surface="${escapeHtml(plan.surfaceId)}" data-flow-floating-layers="omitted" data-flow-omitted-floating-layer-count="${plan.omittedFloatingLayerCount}">${renderFlowPrintBodyHtml(plan, {
        resolveAssetUrl: (assetId) => published.assets[assetId]?.url,
      })}</section>`)
    }
  }
  const layout = resolveMixedPrintPageLayout(published, pages)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeHtml(published.title)}</title><style>@page{size:${layout.pageRule};margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff;font-family:"Microsoft YaHei","PingFang SC",sans-serif}.page{width:${layout.width};min-height:${layout.height};break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.course-visual-print-page{position:relative;height:${layout.height};overflow:hidden;display:flex;align-items:center;justify-content:center;background:#fff}.course-visual-print-canvas{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}.course-visual-print-capture{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}.flow-print-document{padding:12mm 15mm;overflow-wrap:anywhere;-webkit-print-color-adjust:exact;print-color-adjust:exact}.flow-print-document table{max-width:100%;border-collapse:collapse}.flow-print-document pre{white-space:pre-wrap}.flow-print-image{display:block;max-width:100%;height:auto;object-fit:contain}</style></head><body>${sections.join('')}</body></html>`
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

function publishedDynamicFallbackAssetId(item: PublishedLayerItem): string | undefined {
  if (item.kind === 'component') return item.staticFallbackAssetId
  if (item.kind === 'runtime') return item.runtime.staticFallback?.assetId
  return undefined
}

function flowPrintPlanOptions(
  published: PublishedCourseV2Payload,
): Parameters<typeof buildFlowPrintPlan>[1] {
  return {
    pageSize: published.mixedPrintPlan?.pageSize === 'letter' ? 'letter' : 'A4',
    orientation: published.mixedPrintPlan?.orientation === 'landscape'
      ? 'landscape'
      : published.mixedPrintPlan?.orientation === 'portrait'
        ? 'portrait'
        : undefined,
  }
}

function spatialPublishedItemPath(
  published: PublishedCourseV2Payload,
  surface: PublishedSpatialSurface,
  source: 'world' | 'surface' | 'global',
  layerItemId: string,
): ReadonlyArray<string | number> | undefined {
  if (source === 'global') {
    const index = published.globalLayerItems.findIndex((entry) => (
      entry.item.layerItemId === layerItemId
    ))
    return index >= 0 ? ['globalLayerItems', index, 'item'] : undefined
  }
  const surfaceIndex = published.surfaces.findIndex((candidate) => candidate.id === surface.id)
  if (surfaceIndex < 0) return undefined
  if (source === 'world') {
    const itemIndex = surface.world.layerItems.findIndex((item) => (
      item.layerItemId === layerItemId
    ))
    return itemIndex >= 0
      ? ['surfaces', surfaceIndex, 'world', 'layerItems', itemIndex]
      : undefined
  }
  const itemIndex = surface.surfaceLayerItems.findIndex((entry) => (
    entry.item.layerItemId === layerItemId
  ))
  return itemIndex >= 0
    ? ['surfaces', surfaceIndex, 'surfaceLayerItems', itemIndex, 'item']
    : undefined
}

/**
 * Single Published-V2 fact source for PDF builder, GUI preflight and headless
 * validation. It reports deliberate static reductions; health/schema rules stay
 * in their existing owners.
 */
export function collectPublishedPdfProducerNotices(
  published: PublishedCourseV2Payload,
  pages: readonly CourseExportPage[] = buildCourseExportPageList(published),
): CourseExportReportItem[] {
  const notices = new Map<string, CourseExportReportItem>()
  const add = (item: CourseExportReportItem): void => {
    const key = `${item.severity}:${JSON.stringify(item.path ?? [])}:${item.layerItemId ?? ''}:${item.message}`
    if (!notices.has(key)) notices.set(key, item)
  }
  const pureSlide = isPureSlidePublishedCourse(published)
  if (published.globalLayerItems.length > 0 && !pureSlide) {
    add({
      severity: 'info',
      message: '全局图层与教师控制器默认不写入 PDF/DOCX 文件。',
      path: ['globalLayerItems'],
    })
  }
  for (const page of pages) {
    const surface = surfaceById(published, page.surfaceId)
    if (!surface) continue
    const surfaceIndex = published.surfaces.findIndex((candidate) => candidate.id === surface.id)
    if (page.kind === 'slide-scene' && surface.type === 'slide') {
      if (!page.locationId) {
        const sceneIndex = surface.scenes.findIndex((scene) => scene.id === page.sceneId)
        add({
          severity: 'error',
          message: `Slide 场景“${page.title}”没有课程位置，无法确定导出状态与图层可见性。`,
          pageId: page.id,
          path: sceneIndex >= 0
            ? ['surfaces', surfaceIndex, 'scenes', sceneIndex]
            : ['surfaces', surfaceIndex],
        })
      }
      continue
    }
    if (page.kind === 'flow-document' && surface.type === 'flow') {
      const plan = buildFlowPrintPlan(surface, flowPrintPlanOptions(published))
      const omitted = flowPrintOmittedOverlayMessage(plan)
      if (omitted) {
        add({
          severity: 'info',
          message: omitted,
          pageId: page.id,
          path: ['surfaces', surfaceIndex, 'surfaceLayerItems'],
        })
      }
      for (const node of plan.nodes) {
        if (node.type === 'component') {
          add({
            severity: 'info',
            message: `Flow 组件块“${node.blockId}”将使用静态后备说明。`,
            pageId: page.id,
            path: ['surfaces', surfaceIndex, 'blocks'],
          })
        } else if (node.type === 'media' && node.mediaKind !== 'image') {
          add({
            severity: 'info',
            message: `Flow ${node.mediaKind === 'audio' ? '音频' : '视频'}块“${node.blockId}”将在 PDF 中使用文字后备说明。`,
            pageId: page.id,
            assetId: node.assetId,
            path: ['surfaces', surfaceIndex, 'blocks'],
          })
        }
      }
      continue
    }
    if (page.kind === 'spatial-frame' && surface.type === 'spatial-2d') {
      if (!page.locationId) {
        const frameIndex = surface.camera.frames.findIndex((frame) => frame.id === page.cameraFrameId)
        add({
          severity: 'error',
          message: `Spatial 镜头“${page.title}”没有课程位置，无法确定导出图层可见性。`,
          pageId: page.id,
          path: frameIndex >= 0
            ? ['surfaces', surfaceIndex, 'camera', 'frames', frameIndex]
            : ['surfaces', surfaceIndex, 'camera'],
        })
        continue
      }
      const entries = collectSpatialPlaybackEntries(
        publishedSpatialInputFromCourse(published, { surfaceId: surface.id }),
        page.locationId,
      ).filter((entry) => entry.source !== 'global')
      for (const entry of entries) {
        const item = entry.item
        if (shouldOmitPublishedItemFromStaticExport(item)) continue
        const path = spatialPublishedItemPath(published, surface, entry.source, item.layerItemId)
        if (item.kind === 'component' || item.kind === 'runtime') {
          const kindLabel = item.kind === 'component' ? '组件' : '运行时'
          const fallbackId = publishedDynamicFallbackAssetId(item)
          const href = fallbackId ? resolvePublishedAssetUrl(published, fallbackId) : undefined
          add({
            severity: href ? 'info' : 'warning',
            message: href
              ? `${kindLabel}“${item.layerItemId}”将在 Spatial PDF 中使用静态后备图。`
              : `${kindLabel}“${item.layerItemId}”缺少静态后备，Spatial PDF 将保留可见占位。`,
            pageId: page.id,
            layerItemId: item.layerItemId,
            ...(fallbackId ? { assetId: fallbackId } : {}),
            ...(path ? { path } : {}),
          })
          continue
        }
        if (item.content.nativeType === 'image') {
          const href = resolvePublishedAssetUrl(published, item.content.data.assetId)
          if (!href) {
            add({
              severity: 'warning',
              message: `图片“${item.layerItemId}”缺少素材，Spatial PDF 将保留可见占位。`,
              pageId: page.id,
              layerItemId: item.layerItemId,
              assetId: item.content.data.assetId,
              ...(path ? { path } : {}),
            })
          }
          continue
        }
        if (item.content.nativeType === 'video') {
          const posterId = item.content.data.poster.mode === 'image'
            ? item.content.data.poster.assetId
            : undefined
          const poster = posterId ? resolvePublishedAssetUrl(published, posterId) : undefined
          add({
            severity: poster ? 'info' : 'warning',
            message: poster
              ? `视频“${item.layerItemId}”将在 Spatial PDF 中使用静态封面。`
              : `视频“${item.layerItemId}”没有可用静态封面，Spatial PDF 将保留可见占位。`,
            pageId: page.id,
            layerItemId: item.layerItemId,
            ...(posterId ? { assetId: posterId } : {}),
            ...(path ? { path } : {}),
          })
        }
      }
    }
  }
  return [...notices.values()]
}

/**
 * Build printable/PDF/DOCX artifacts from Course Project V9 sources or an
 * already-parsed Published Course V2. Returns bytes and filenames only —
 * writing to disk is R7-Z.
 */
export async function buildCoursePrintArtifacts(
  input: BuildCoursePrintArtifactsInput,
  options: BuildCoursePrintArtifactsOptions = {},
): Promise<CoursePrintArtifactsResult> {
  const published = resolvePublishedCourseForPrint(input)
  const sources = isCoursePublishSources(input) ? input : undefined
  const resolveAssetBytes = options.resolveAssetBytes
    ?? (sources ? (assetId: string) => resolveAssetBytesFromSources(sources, assetId) : undefined)
  const report: CourseExportReportItem[] = []
  const warnings: string[] = []
  const files: CoursePrintArtifactFile[] = []
  const pages = buildCourseExportPageList(published)
  const pureSlide = isPureSlidePublishedCourse(published)
  let printCapture: Awaited<ReturnType<typeof createPublishedCourseV2PrintCaptureSession>> | null = null
  try {
    if (pages.length === 0) {
      pushReport(report, {
        severity: 'error',
        message: '当前 Published Course V2 没有可导出的页面。',
      })
      return { pages, files, report, warnings }
    }

    auditCourseExportFonts(published, report)
    auditCourseExportAssets(published, report, resolveAssetBytes)
    collectPublishedPdfProducerNotices(published, pages).forEach((item) => {
      pushReport(report, item)
    })

    const slidePages = pages.filter((page) => page.kind === 'slide-scene')
    const visualPages = pages.filter((page) => (
      page.kind === 'slide-scene' || page.kind === 'spatial-frame'
    ))
    const needsCaptureSession = visualPages.some((page) => (
      page.kind === 'spatial-frame' || !options.captureSlideScene
    ))
    if (needsCaptureSession) {
      try {
        printCapture = await createPublishedCourseV2PrintCaptureSession({
          payload: published,
          includeGlobalLayerItems: pureSlide,
        })
      } catch (cause) {
        pushReport(report, {
          severity: 'error',
          message: `Published Course V2 捕获无法启动：${cause instanceof Error ? cause.message : String(cause)}`,
        })
      }
    }
    const visualCaptures = new Map<string, CapturedVisualPage>()
    for (const page of pages) {
      const surface = surfaceById(published, page.surfaceId)
      if (!surface) continue
      if (page.kind === 'slide-scene' && surface.type === 'slide' && page.sceneId) {
        const scene = surface.scenes.find((candidate) => candidate.id === page.sceneId)
        if (!scene) continue
        if (!page.locationId) continue
        try {
          const rawCapture = options.captureSlideScene
            ? await options.captureSlideScene({
                published,
                surface,
                scene,
                page,
                locationId: page.locationId,
                includeGlobalLayerItems: pureSlide,
              })
            : await printCapture?.capturePage({
                locationId: page.locationId,
                surfaceId: surface.id,
                width: 1280,
                height: 720,
              })
          const captured = normalizeCapturedVisualPage(rawCapture, { width: 1280, height: 720 })
          if (captured) {
            visualCaptures.set(page.id, captured)
            for (const warning of captured.warnings) {
              pushReport(report, {
                severity: 'warning',
                message: `Slide 场景“${scene.name}”捕获提示：${warning}`,
                pageId: page.id,
              })
            }
          } else {
            pushReport(report, {
              severity: 'error',
              message: `Slide 场景“${scene.name}”未提供有效的 Published V2 PDF 快照。`,
              pageId: page.id,
            })
          }
        } catch (cause) {
          pushReport(report, {
            severity: 'error',
            message: `Slide 场景“${scene.name}”PDF 快照失败：${cause instanceof Error ? cause.message : String(cause)}`,
            pageId: page.id,
          })
        }
        continue
      }
      if (page.kind === 'spatial-frame' && surface.type === 'spatial-2d') {
        if (!page.locationId) continue
        try {
          const rawCapture = await printCapture?.capturePage({
            locationId: page.locationId,
            surfaceId: surface.id,
            ...(page.cameraFrameId ? { frameId: page.cameraFrameId } : {}),
            width: SPATIAL_EXPORT_VIEWPORT.width,
            height: SPATIAL_EXPORT_VIEWPORT.height,
          })
          const captured = normalizeCapturedVisualPage(rawCapture, SPATIAL_EXPORT_VIEWPORT)
          if (!captured) {
            pushReport(report, {
              severity: 'error',
              message: `Spatial 镜头“${page.title}”未提供有效的 Published V2 PDF 快照。`,
              pageId: page.id,
            })
            continue
          }
          visualCaptures.set(page.id, captured)
          for (const warning of captured.warnings) {
            pushReport(report, {
              severity: 'warning',
              message: `Spatial 镜头“${page.title}”捕获提示：${warning}`,
              pageId: page.id,
            })
          }
        } catch (cause) {
          pushReport(report, {
            severity: 'error',
            message: `Spatial 镜头“${page.title}”PDF 快照失败：${cause instanceof Error ? cause.message : String(cause)}`,
            pageId: page.id,
          })
        }
        continue
      }
    }

    const visualCoverageComplete = visualPages.every((page) => visualCaptures.has(page.id))
    const hasProducerError = report.some((item) => item.severity === 'error')
    if (visualCoverageComplete && !hasProducerError) {
      const mixedHtml = buildMixedPrintDocumentHtml(published, pages, visualCaptures)
      const mixedBytes = new TextEncoder().encode(mixedHtml)
      auditExportSize(mixedBytes, '混合打印 HTML', report)
      files.push({
        filename: `${published.title || 'course'}-print.html`,
        mimeType: 'text/html;charset=utf-8',
        bytes: mixedBytes,
        kind: 'flow-print-html',
      })
      const pdfHtml = pureSlide
        ? buildPdfPrintHtml(
            published.title,
            slidePages.map((page) => {
              const capture = visualCaptures.get(page.id)!
              return {
                dataUrl: capture.dataUrl,
                width: capture.width,
                height: capture.height,
              }
            }),
          )
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
      const plan = buildFlowPrintPlan(surface, flowPrintPlanOptions(published))
      if (flowPrintPlanHasRuntimeToc(plan)) {
        pushReport(report, {
          severity: 'error',
          message: 'Flow 打印计划意外包含运行态目录抽屉，已拒绝写入 DOCX。',
          pageId: page.id,
        })
        continue
      }
      const docx = buildFlowDocx(published, surface.id, {
        resolveAsset: resolveAssetBytes,
        pageSize: plan.pageSize,
        orientation: plan.orientation,
      })
      warnings.push(...docx.warnings)
      auditExportSize(docx.bytes, `Flow DOCX（${surface.title}）`, report)
      const filename = uniqueFlowDocxFilename(surface.title, usedDocxNames)
      usedDocxNames.add(filename)
      files.push({
        filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: docx.bytes,
        kind: 'docx',
        surfaceId: surface.id,
        pageId: page.id,
      })
    }

    for (const item of report) {
      if (item.severity === 'warning' && !warnings.includes(item.message)) {
        warnings.push(item.message)
      }
    }

    return { pages, files, report, warnings }
  } finally {
    await printCapture?.destroy()
  }
}

export function publishedFlowSurfaceFromCourse(
  published: PublishedCourseV2Payload,
  surfaceId: string,
): PublishedFlowSurface | undefined {
  const surface = surfaceById(published, surfaceId)
  return surface?.type === 'flow' ? surface : undefined
}
