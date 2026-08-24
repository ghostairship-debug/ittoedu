import { APP_COMPANY, APP_NAME } from '../../../shared/constants'
import type {
  PublishedCourseV2Payload,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedSlideScene,
  PublishedSlideSurface,
  PublishedSpatialSurface,
} from '../../../shared/publishedCourseTypes'
import type { LayerItemOverride } from '../../../shared/courseProjectTypes'
import type { SceneNode } from '../../../shared/projectTypes'
import {
  isPublishedScopedVisible,
} from '../../../player/surfaces/spatial/spatialModel'
import {
  pptxColor,
  pptxNodePosition,
  pptxRotation,
  pptxTransparency,
  WIDE_SLIDE_HEIGHT,
  WIDE_SLIDE_WIDTH,
  type CanvasScale,
  type PptxSlide,
} from '../pptxShared'
import { bytesToDataUrl } from '../base64'
import {
  addPptxFormulaNode,
  addPptxShapeNode,
  addPptxTextNode,
} from '../pptxTextAndShape'
import {
  auditCourseExportAssets,
  auditCourseExportFonts,
  buildCourseExportPageList,
  renderPublishedSpatialFrameSvg,
  shouldOmitPublishedItemFromStaticExport,
  SPATIAL_EXPORT_VIEWPORT,
  type CourseExportPage,
  type CourseExportReportItem,
} from './buildCoursePrintArtifacts'

export interface BuildCoursePptxOptions {
  captureDynamicItem?: (input: {
    published: PublishedCourseV2Payload
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    item: Extract<PublishedLayerItem, { kind: 'component' | 'runtime' }>
  }) => string | undefined | Promise<string | undefined>
  onWarning?(message: string): void
}

export interface CoursePptxResult {
  bytes: Uint8Array
  slideCount: number
  pages: CourseExportPage[]
  warnings: string[]
  report: CourseExportReportItem[]
}

function pushReport(
  report: CourseExportReportItem[],
  item: CourseExportReportItem,
): void {
  report.push(item)
}

function resolvePublishedAssetData(
  published: PublishedCourseV2Payload,
  assetId: string,
): string | undefined {
  const url = published.assets[assetId]?.url
  return url?.startsWith('data:') ? url : undefined
}

function applyPublishedOverride(
  item: PublishedLayerItem,
  overrides: Record<string, LayerItemOverride>,
): PublishedLayerItem {
  const override = overrides[item.layerItemId]
  if (!override) return structuredClone(item)
  const next = structuredClone(item)
  if (override.frame) next.frame = { ...next.frame, ...override.frame }
  if (override.visible !== undefined) next.visible = override.visible
  if (override.rotation !== undefined) next.rotation = override.rotation
  if (override.opacity !== undefined) next.opacity = override.opacity
  if (next.kind === 'component' && override.componentProps) {
    next.props = { ...next.props, ...override.componentProps }
  }
  return next
}

function slideSceneItems(
  published: PublishedCourseV2Payload,
  surface: PublishedSlideSurface,
  scene: PublishedSlideScene,
): PublishedLayerItem[] {
  const location = published.locations.find((candidate) => (
    candidate.kind === 'slide-scene' &&
    candidate.surfaceId === surface.id &&
    candidate.sceneId === scene.id
  ))
  const locationId = location?.id ?? scene.id
  const state = scene.presentation?.states.find(
    (candidate) => candidate.id === scene.presentation?.initialStateId,
  )
  const overrides = state?.layerItemOverrides ?? {}
  const items = [
    ...surface.surfaceLayerItems
      .filter((entry) => isPublishedScopedVisible(entry.visibility, locationId))
      .map((entry) => structuredClone(entry.item)),
    ...scene.layerItems.map((item) => applyPublishedOverride(item, overrides)),
  ]
    .filter((item) => !shouldOmitPublishedItemFromStaticExport(item))
    .sort((left, right) => left.order - right.order || left.layerItemId.localeCompare(right.layerItemId))
  if (state?.layerItemOrder) {
    const orderMap = new Map(state.layerItemOrder.map((id, index) => [id, index]))
    items.forEach((item) => {
      const order = orderMap.get(item.layerItemId)
      if (order !== undefined) item.order = order
    })
    items.sort((left, right) => left.order - right.order || left.layerItemId.localeCompare(right.layerItemId))
  }
  return items
}

function nativeSceneNode(item: PublishedNativeLayerItem): SceneNode {
  return {
    ...structuredClone(item.content.data),
    id: item.layerItemId,
    name: item.layerItemId,
    type: item.content.nativeType,
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    rotation: item.rotation,
    opacity: item.opacity,
    visible: item.visible,
    locked: false,
    playbackInitialVisibility: item.playbackInitialVisibility,
  } as SceneNode
}

function addImage(
  slide: PptxSlide,
  item: Pick<PublishedLayerItem, 'frame' | 'rotation' | 'opacity' | 'layerItemId'>,
  data: string,
  scale: CanvasScale,
  suffix: string,
): void {
  slide.addImage({
    data,
    x: item.frame.x * scale.x,
    y: item.frame.y * scale.y,
    w: item.frame.width * scale.x,
    h: item.frame.height * scale.y,
    rotate: pptxRotation(item.rotation),
    transparency: pptxTransparency(item.opacity),
    objectName: `${item.layerItemId} · ${suffix}`,
    altText: `${item.layerItemId}（${suffix}）`,
  })
}

function addPlaceholder(
  slide: PptxSlide,
  item: PublishedLayerItem,
  scale: CanvasScale,
  message: string,
): void {
  slide.addText(message, {
    x: item.frame.x * scale.x,
    y: item.frame.y * scale.y,
    w: item.frame.width * scale.x,
    h: item.frame.height * scale.y,
    rotate: pptxRotation(item.rotation),
    transparency: pptxTransparency(item.opacity),
    objectName: `${item.layerItemId} · 静态占位`,
    fill: { color: item.kind === 'runtime' ? 'F5F3FF' : 'EFF6FF' },
    line: { color: item.kind === 'runtime' ? '7C3AED' : '2563EB', width: 1.25, dashType: 'dash' },
    color: '334155',
    fontFace: 'Microsoft YaHei',
    fontSize: 13,
    align: 'center',
    valign: 'middle',
    margin: 5,
    fit: 'shrink',
  })
}

async function addNativeItem(
  slide: PptxSlide,
  item: PublishedNativeLayerItem,
  published: PublishedCourseV2Payload,
  scale: CanvasScale,
  sceneWarnings: string[],
): Promise<void> {
  const node = nativeSceneNode(item)
  if (!node.visible) return
  if (node.type === 'text') addPptxTextNode(slide, node, scale)
  else if (node.type === 'formula') addPptxFormulaNode(slide, node, scale)
  else if (node.type === 'shape') addPptxShapeNode(slide, node, scale)
  else if (node.type === 'image') {
    const data = resolvePublishedAssetData(published, node.assetId)
    if (data) addImage(slide, item, data, scale, '可编辑图片')
    else {
      addPlaceholder(slide, item, scale, `图片素材缺失\n${node.assetId}`)
      sceneWarnings.push(`图片“${item.layerItemId}”的素材 ${node.assetId} 缺失。`)
    }
  } else if (node.type === 'video') {
    addPlaceholder(slide, item, scale, `▶ 视频\n${item.layerItemId}`)
    sceneWarnings.push(`视频“${item.layerItemId}”在 PPTX 中使用可选择占位，不保留播放交互。`)
  } else if (node.type === 'teacher-controller') {
    if (!node.includeInStaticExports) return
    slide.addText(node.title, {
      ...pptxNodePosition(node, scale),
      rotate: pptxRotation(node.rotation),
      color: pptxColor(node.style.textColor, 'F8FAFC'),
      fill: {
        color: pptxColor(node.style.backgroundColor, '172033'),
        transparency: pptxTransparency(node.style.backgroundOpacity),
      },
      line: { color: pptxColor(node.style.accentColor, 'E7B85C'), width: 1 },
      fontFace: 'Microsoft YaHei',
      fontSize: 13,
      align: 'center',
      valign: 'middle',
      objectName: `${item.layerItemId} · 教师控制器`,
    })
  }
}

function addWarningNote(slide: PptxSlide, warnings: readonly string[]): void {
  if (warnings.length === 0) return
  const text = `静态导出提示：${[...new Set(warnings)].join(' ')}`
  slide.addText(text, {
    x: 0.15,
    y: WIDE_SLIDE_HEIGHT - 0.5,
    w: WIDE_SLIDE_WIDTH - 0.3,
    h: 0.42,
    objectName: '导出差异说明',
    margin: 3,
    fontFace: 'Microsoft YaHei',
    fontSize: 8.5,
    bold: true,
    color: '7C2D12',
    fill: { color: 'FEF3C7', transparency: 5 },
    line: { color: 'F59E0B', width: 0.75 },
    fit: 'shrink',
    valign: 'middle',
  })
  slide.addNotes(text)
}

async function addSlideScenePage(
  pptx: InstanceType<(typeof import('pptxgenjs'))['default']>,
  published: PublishedCourseV2Payload,
  surface: PublishedSlideSurface,
  scene: PublishedSlideScene,
  options: BuildCoursePptxOptions,
  report: CourseExportReportItem[],
): Promise<string[]> {
  const scale: CanvasScale = {
    x: WIDE_SLIDE_WIDTH / surface.canvas.width,
    y: WIDE_SLIDE_HEIGHT / surface.canvas.height,
  }
  const slide = pptx.addSlide()
  const sceneWarnings: string[] = []
  const state = scene.presentation?.states.find(
    (candidate) => candidate.id === scene.presentation?.initialStateId,
  )
  slide.background = { color: pptxColor(state?.backgroundColor ?? scene.backgroundColor, 'FFFFFF') }
  const backgroundAssetId = state?.backgroundAssetId === undefined
    ? scene.backgroundAssetId
    : state.backgroundAssetId
  if (backgroundAssetId) {
    const background = resolvePublishedAssetData(published, backgroundAssetId)
    if (background) {
      slide.addImage({
        data: background,
        x: 0,
        y: 0,
        w: WIDE_SLIDE_WIDTH,
        h: WIDE_SLIDE_HEIGHT,
        objectName: `${scene.name} · 背景图片`,
      })
    } else {
      sceneWarnings.push(`场景“${scene.name}”背景素材缺失。`)
      pushReport(report, {
        severity: 'warning',
        message: `场景“${scene.name}”背景素材缺失。`,
        pageId: scene.id,
        assetId: backgroundAssetId,
      })
    }
  }
  for (const item of slideSceneItems(published, surface, scene)) {
    if (!item.visible) continue
    if (item.kind === 'native') {
      await addNativeItem(slide, item, published, scale, sceneWarnings)
      continue
    }
    let captured: string | undefined
    try {
      captured = await options.captureDynamicItem?.({ published, surface, scene, item })
    } catch (cause) {
      const message = `${item.kind} “${item.layerItemId}”实例快照失败：${cause instanceof Error ? cause.message : String(cause)}`
      sceneWarnings.push(message)
      pushReport(report, { severity: 'warning', message, pageId: scene.id })
    }
    if (captured?.startsWith('data:image/')) {
      addImage(slide, item, captured, scale, '实际运行快照')
      continue
    }
    const fallbackId = item.kind === 'component'
      ? item.staticFallbackAssetId
      : item.runtime.staticFallback?.assetId
    const fallback = fallbackId ? resolvePublishedAssetData(published, fallbackId) : undefined
    if (fallback) {
      addImage(slide, item, fallback, scale, '作者静态后备')
      sceneWarnings.push(`${item.kind} “${item.layerItemId}”在 PPTX 中使用作者静态后备。`)
    } else {
      addPlaceholder(slide, item, scale, `${item.kind === 'component' ? '互动组件' : '互动运行时'}\n${item.layerItemId}`)
      sceneWarnings.push(`${item.kind} “${item.layerItemId}”无快照或静态后备，已使用可选择占位，未静默省略。`)
    }
  }
  sceneWarnings.forEach((message) => options.onWarning?.(message))
  addWarningNote(slide, sceneWarnings)
  return sceneWarnings
}

function addSpatialFramePage(
  pptx: InstanceType<(typeof import('pptxgenjs'))['default']>,
  published: PublishedCourseV2Payload,
  surface: PublishedSpatialSurface,
  page: CourseExportPage,
  report: CourseExportReportItem[],
): void {
  const { svg, viewport } = renderPublishedSpatialFrameSvg(
    surface,
    page.cameraFrameId,
    (assetId) => resolvePublishedAssetData(published, assetId),
  )
  if (viewport.width === 1280 && viewport.height === 720 && surface.world.bounds.mode === 'infinite') {
    pushReport(report, {
      severity: 'error',
      message: 'Spatial 无限画布被错误裁成 1280×720，已跳过该 PPTX 页。',
      pageId: page.id,
    })
    return
  }
  const slide = pptx.addSlide()
  slide.background = { color: 'FFFFFF' }
  const dataUrl = bytesToDataUrl(new TextEncoder().encode(svg), 'image/svg+xml')
  const aspect = viewport.width / viewport.height
  const wideAspect = WIDE_SLIDE_WIDTH / WIDE_SLIDE_HEIGHT
  let width = WIDE_SLIDE_WIDTH
  let height = WIDE_SLIDE_HEIGHT
  let x = 0
  let y = 0
  if (aspect > wideAspect) {
    height = WIDE_SLIDE_WIDTH / aspect
    y = (WIDE_SLIDE_HEIGHT - height) / 2
  } else {
    width = WIDE_SLIDE_HEIGHT * aspect
    x = (WIDE_SLIDE_WIDTH - width) / 2
  }
  slide.addImage({
    data: dataUrl,
    x,
    y,
    w: width,
    h: height,
    objectName: `${page.title} · Spatial 镜头`,
    altText: `${page.title}（Spatial 镜头 ${viewport.width}×${viewport.height}）`,
  })
  slide.addNotes(`Spatial 镜头 ${page.cameraFrameId ?? 'home'}，视口 ${viewport.width}×${viewport.height}，未把无限 world 裁成单张 1280×720。`)
}

/** Build PPTX bytes from Published Course V2 page list. Global/HUD layers stay out by default. */
export async function buildCoursePptx(
  published: PublishedCourseV2Payload,
  options: BuildCoursePptxOptions = {},
): Promise<CoursePptxResult> {
  const report: CourseExportReportItem[] = []
  const warnings: string[] = []
  const pages = buildCourseExportPageList(published)
  const slidePages = pages.filter((page) => page.kind === 'slide-scene')
  const spatialPages = pages.filter((page) => page.kind === 'spatial-frame')
  const flowPages = pages.filter((page) => page.kind === 'flow-document')

  if (slidePages.length === 0 && spatialPages.length === 0) {
    pushReport(report, {
      severity: 'error',
      message: '当前课程没有可映射到 PPTX 的 Slide 场景或 Spatial 镜头。',
    })
    return { bytes: new Uint8Array(), slideCount: 0, pages, warnings, report }
  }

  auditCourseExportFonts(published, report)
  auditCourseExportAssets(published, report)

  if (published.globalLayerItems.length > 0) {
    pushReport(report, {
      severity: 'info',
      message: '全局图层与教师控制器默认不写入 PPTX 文件。',
    })
  }

  for (const page of flowPages) {
    const message = `Flow 表面“${page.title}”没有 PPTX 映射，已按页列表跳过。`
    warnings.push(message)
    pushReport(report, { severity: 'info', message, pageId: page.id })
    options.onWarning?.(message)
  }

  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = APP_NAME
  pptx.company = APP_COMPANY
  pptx.title = published.title
  pptx.subject = 'Course Project V9 可编辑兼容导出'
  pptx.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei' }

  for (const page of slidePages) {
    const surface = published.surfaces.find((candidate): candidate is PublishedSlideSurface => (
      candidate.id === page.surfaceId && candidate.type === 'slide'
    ))
    if (!surface || !page.sceneId) continue
    const scene = surface.scenes.find((candidate) => candidate.id === page.sceneId)
    if (!scene) continue
    warnings.push(...await addSlideScenePage(pptx, published, surface, scene, options, report))
  }

  for (const page of spatialPages) {
    const surface = published.surfaces.find((candidate): candidate is PublishedSpatialSurface => (
      candidate.id === page.surfaceId && candidate.type === 'spatial-2d'
    ))
    if (!surface) continue
    addSpatialFramePage(pptx, published, surface, page, report)
  }

  const slideCount = slidePages.length + spatialPages.length
  if (slideCount === 0) {
    pushReport(report, {
      severity: 'error',
      message: '未能生成任何 PPTX 页面。',
    })
    return { bytes: new Uint8Array(), slideCount: 0, pages, warnings, report }
  }

  const output = await pptx.write({ outputType: 'arraybuffer', compression: true })
  const bytes = new Uint8Array(output as ArrayBuffer)
  if (bytes.byteLength / (1024 * 1024) > 48) {
    pushReport(report, {
      severity: 'warning',
      message: `PPTX 体积约 ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB，可能超出部分查看器限制。`,
    })
  }

  return { bytes, slideCount, pages, warnings, report }
}

export { SPATIAL_EXPORT_VIEWPORT }
