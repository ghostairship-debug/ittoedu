import { APP_COMPANY, APP_NAME } from '../../../shared/constants'
import type { ImageNode } from '../../../shared/contracts/native-v1/types'
import { renderImageNodeCanvas } from '../../../shared/imageEffects'
import { nativeRenderInputFromPublishedItem } from '../../../player/surfaces/slide/publishedNativeRendering'
import type {
  PublishedCourseV2Payload,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedSlideScene,
  PublishedSlideSurface,
  PublishedSpatialSurface,
} from '../../../shared/publishedCourseTypes'
import {
  clamp,
  pptxColor,
  pptxNodePosition,
  pptxRotation,
  pptxTransparency,
  pptxComponentSnapshotKey,
  pptxGlobalComponentSnapshotKey,
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
  buildPublishedCourseV2Payload,
  type CoursePublishSources,
} from './buildPublishedCourse'
import { isParsedPublishedCourseV2 } from '../../../player/surfaces/CoursePlayer'
import {
  renderPublishedSpatialFrameSvg,
} from '../../../player/surfaces/spatial/publishedSpatialStaticRendering'
import {
  auditCourseExportAssets,
  auditCourseExportFonts,
  buildCourseExportPageList,
  composePublishedSlideStaticPage,
  isPureSlidePublishedCourse,
  type CourseExportPage,
  type CourseExportReportItem,
} from './buildCoursePrintArtifacts'
import { renderPptxComponentSnapshots } from '../renderPptxComponentSnapshots'
import {
  pptxRuntimeSnapshotKey,
  renderPptxRuntimeSnapshots,
} from '../renderPptxRuntimeSnapshots'

export interface BuildCoursePptxOptions {
  captureDynamicItem?: (input: {
    published: PublishedCourseV2Payload
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    locationId: string
    item: Extract<PublishedLayerItem, { kind: 'component' | 'runtime' }>
  }) => string | undefined | Promise<string | undefined>
  /** Test/host seam; production uses the formal Native image renderer. */
  renderNativeImage?: (input: {
    node: ImageNode
    assetDataUrl: string
  }) => string | Promise<string>
  onWarning?(message: string): void
}

export interface CoursePptxResult {
  bytes: Uint8Array
  slideCount: number
  pages: CourseExportPage[]
  warnings: string[]
  report: CourseExportReportItem[]
}

export type BuildCoursePptxInput = CoursePublishSources | PublishedCourseV2Payload

const MAX_IMAGE_RENDER_RESOLUTION = 4
const MAX_IMAGE_RENDER_PIXELS = 8_000_000

async function loadPublishedImage(
  assetDataUrl: string,
): Promise<HTMLImageElement> {
  const image = new Image()
  if (typeof image.decode === 'function') {
    image.src = assetDataUrl
    await image.decode()
    return image
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('图片素材无法解码'))
    image.src = assetDataUrl
  })
  return image
}

async function renderNativeImageForPptx(
  node: ImageNode,
  assetDataUrl: string,
  imageCache: Map<string, HTMLImageElement>,
  renderer?: BuildCoursePptxOptions['renderNativeImage'],
): Promise<string> {
  if (renderer) {
    const rendered = await renderer({ node, assetDataUrl })
    if (!rendered.startsWith('data:image/')) {
      throw new Error('Native 图片渲染器没有返回图片')
    }
    return rendered
  }

  let source = imageCache.get(node.assetId)
  if (!source) {
    source = await loadPublishedImage(assetDataUrl)
    imageCache.set(node.assetId, source)
  }
  const sourceWidth = source.naturalWidth || node.width
  const sourceHeight = source.naturalHeight || node.height
  const sourceResolution = Math.max(
    sourceWidth / Math.max(1, node.width),
    sourceHeight / Math.max(1, node.height),
  )
  const pixelLimitResolution = Math.sqrt(
    MAX_IMAGE_RENDER_PIXELS / Math.max(1, node.width * node.height),
  )
  const renderResolution = clamp(
    Math.min(sourceResolution, pixelLimitResolution),
    1,
    MAX_IMAGE_RENDER_RESOLUTION,
  )
  const canvas = renderImageNodeCanvas(
    source,
    sourceWidth,
    sourceHeight,
    node,
    node.width,
    node.height,
    renderResolution,
  )
  const data = canvas.toDataURL('image/png')
  canvas.width = 1
  canvas.height = 1
  return data
}

function isCoursePublishSources(input: object): input is CoursePublishSources {
  if (!('project' in input) || !('assetFiles' in input) || !('components' in input)) {
    return false
  }
  const project = (input as { project?: { schemaVersion?: unknown } }).project
  return project?.schemaVersion === 9
}

function resolvePublishedCourseForPptx(input: BuildCoursePptxInput): PublishedCourseV2Payload {
  if (isParsedPublishedCourseV2(input)) return input
  if (isCoursePublishSources(input)) return buildPublishedCourseV2Payload(input)
  throw new Error(
    'PPTX 只接受 Course Project V9 发布源或已解析的 Published Course V2，不接受旧版导出包。',
  )
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

function isGlobalPublishedItem(
  published: PublishedCourseV2Payload,
  layerItemId: string,
): boolean {
  return published.globalLayerItems.some((entry) => entry.item.layerItemId === layerItemId)
}

function publishedDynamicSnapshotKey(
  published: PublishedCourseV2Payload,
  scene: PublishedSlideScene,
  item: Extract<PublishedLayerItem, { kind: 'component' | 'runtime' }>,
): string {
  const global = isGlobalPublishedItem(published, item.layerItemId)
  if (item.kind === 'component') {
    return global
      ? pptxGlobalComponentSnapshotKey(scene.id, item.layerItemId)
      : pptxComponentSnapshotKey(scene.id, item.layerItemId)
  }
  return pptxRuntimeSnapshotKey(scene.id, item.layerItemId, global)
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
  imageCache: Map<string, HTMLImageElement>,
  options: BuildCoursePptxOptions,
  report: CourseExportReportItem[],
  pageId: string,
): Promise<void> {
  const node = nativeRenderInputFromPublishedItem(item)
  if (!node.visible) return
  if (node.type === 'text') addPptxTextNode(slide, node, scale)
  else if (node.type === 'formula') addPptxFormulaNode(slide, node, scale)
  else if (node.type === 'shape') addPptxShapeNode(slide, node, scale)
  else if (node.type === 'image') {
    const assetDataUrl = resolvePublishedAssetData(published, node.assetId)
    if (!assetDataUrl) {
      addPlaceholder(slide, item, scale, `图片素材缺失\n${node.assetId}`)
      sceneWarnings.push(`图片“${item.layerItemId}”的素材 ${node.assetId} 缺失。`)
      return
    }
    try {
      const rendered = await renderNativeImageForPptx(
        node,
        assetDataUrl,
        imageCache,
        options.renderNativeImage,
      )
      addImage(slide, item, rendered, scale, '可编辑图片')
    } catch (cause) {
      const message = `图片“${item.layerItemId}”无法保留裁剪与效果：${cause instanceof Error ? cause.message : String(cause)}`
      addPlaceholder(slide, item, scale, `图片处理失败\n${item.layerItemId}`)
      sceneWarnings.push(message)
      pushReport(report, {
        severity: 'warning',
        message,
        pageId,
        assetId: node.assetId,
      })
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
  } else {
    addPlaceholder(slide, item, scale, `不受支持的原生对象\n${item.layerItemId}`)
    sceneWarnings.push(
      `原生对象“${item.layerItemId}”没有 PPTX 原生映射，已使用可选择占位，未静默省略。`,
    )
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

export interface CoursePptxSpatialNotice {
  severity: 'warning' | 'info'
  source: 'world' | 'surface'
  itemIndex: number
  layerItemId: string
  assetId?: string
  message: string
}

function locationVisibilityApplies(
  visibility: PublishedSpatialSurface['surfaceLayerItems'][number]['visibility'],
  locationId: string | undefined,
): boolean {
  if (!locationId || visibility.mode === 'all') return true
  const listed = visibility.locationIds.includes(locationId)
  return visibility.mode === 'include' ? listed : !listed
}

function omittedFromStaticPptx(item: PublishedLayerItem): boolean {
  return item.kind === 'native'
    && item.content.nativeType === 'teacher-controller'
    && !item.content.data.includeInStaticExports
}

function publishedSpatialWorldNotice(
  item: PublishedLayerItem,
  itemIndex: number,
  resolveAsset: (assetId: string) => string | undefined,
): CoursePptxSpatialNotice | null {
  if (!item.visible || omittedFromStaticPptx(item)) return null
  const base = {
    source: 'world' as const,
    itemIndex,
    layerItemId: item.layerItemId,
  }
  if (item.kind === 'component' || item.kind === 'runtime') {
    const fallbackId = item.kind === 'component'
      ? item.staticFallbackAssetId
      : item.runtime.staticFallback?.assetId
    if (fallbackId && resolveAsset(fallbackId)) {
      return {
        ...base,
        severity: 'info',
        assetId: fallbackId,
        message: `Spatial ${item.kind === 'component' ? '组件' : '运行时'}“${item.layerItemId}”在 PPTX 镜头中使用作者静态后备。`,
      }
    }
    return {
      ...base,
      severity: 'warning',
      ...(fallbackId ? { assetId: fallbackId } : {}),
      message: `Spatial ${item.kind === 'component' ? '组件' : '运行时'}“${item.layerItemId}”缺少可用静态后备，PPTX 镜头使用可见占位。`,
    }
  }
  if (item.content.nativeType === 'text') {
    return {
      ...base,
      severity: 'info',
      message: `Spatial 文字“${item.layerItemId}”在 PPTX 镜头中按静态简化样式呈现。`,
    }
  }
  if (item.content.nativeType === 'image') {
    const image = item.content.data
    if (!resolveAsset(image.assetId)) {
      return {
        ...base,
        severity: 'warning',
        assetId: image.assetId,
        message: `Spatial 图片“${item.layerItemId}”的素材 ${image.assetId} 缺失，PPTX 镜头使用可见占位。`,
      }
    }
    const simplified = image.fit !== 'contain'
      || image.crop.left !== 0
      || image.crop.top !== 0
      || image.crop.right !== 0
      || image.crop.bottom !== 0
      || image.cropX !== 0.5
      || image.cropY !== 0.5
      || image.flipX
      || image.flipY
      || image.cornerRadius !== 0
      || image.feather.amount !== 0
    return simplified
      ? {
          ...base,
          severity: 'warning',
          assetId: image.assetId,
          message: `Spatial 图片“${item.layerItemId}”在 PPTX 镜头中按 contain 静态图呈现，裁剪、翻转、圆角或羽化效果不会完整保留。`,
        }
      : null
  }
  return {
    ...base,
    severity: 'warning',
    message: `Spatial 原生对象“${item.layerItemId}”（${item.content.nativeType}）没有 PPTX 镜头映射，已明确省略。`,
  }
}

/** Producer facts shared by the PPTX builder and its V9 preflight adapter. */
export function collectPublishedPptxSpatialNotices(
  surface: PublishedSpatialSurface,
  resolveAsset: (assetId: string) => string | undefined,
  locationId?: string,
): CoursePptxSpatialNotice[] {
  const notices = surface.world.layerItems.flatMap((item, itemIndex) => {
    const notice = publishedSpatialWorldNotice(item, itemIndex, resolveAsset)
    return notice ? [notice] : []
  })
  surface.surfaceLayerItems.forEach((entry, itemIndex) => {
    if (
      !entry.item.visible
      || omittedFromStaticPptx(entry.item)
      || !locationVisibilityApplies(entry.visibility, locationId)
    ) return
    notices.push({
      severity: 'warning',
      source: 'surface',
      itemIndex,
      layerItemId: entry.item.layerItemId,
      message: `Spatial 表面浮层“${entry.item.layerItemId}”没有 PPTX 镜头映射，已明确省略。`,
    })
  })
  return notices
}

async function addSlideScenePage(
  pptx: InstanceType<(typeof import('pptxgenjs'))['default']>,
  published: PublishedCourseV2Payload,
  surface: PublishedSlideSurface,
  scene: PublishedSlideScene,
  page: CourseExportPage & { locationId: string },
  includeGlobalLayerItems: boolean,
  options: BuildCoursePptxOptions,
  report: CourseExportReportItem[],
  precomputedSnapshots: ReadonlyMap<string, string>,
  imageCache: Map<string, HTMLImageElement>,
): Promise<string[]> {
  const scale: CanvasScale = {
    x: WIDE_SLIDE_WIDTH / surface.canvas.width,
    y: WIDE_SLIDE_HEIGHT / surface.canvas.height,
  }
  const slide = pptx.addSlide()
  const sceneWarnings: string[] = []
  const composition = composePublishedSlideStaticPage(
    published,
    surface,
    scene,
    { includeGlobalLayerItems, locationId: page.locationId },
  )
  const { state } = composition
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
        pageId: page.id,
        assetId: backgroundAssetId,
      })
    }
  }
  for (const item of composition.items) {
    if (item.kind === 'native') {
      await addNativeItem(
        slide,
        item,
        published,
        scale,
        sceneWarnings,
        imageCache,
        options,
        report,
        page.id,
      )
      continue
    }
    let captured: string | undefined
    try {
      if (options.captureDynamicItem) {
        captured = await options.captureDynamicItem({
          published,
          surface,
          scene,
          locationId: page.locationId,
          item,
        })
      } else {
        captured = precomputedSnapshots.get(
          publishedDynamicSnapshotKey(published, scene, item),
        )
      }
    } catch (cause) {
      const message = `${item.kind} “${item.layerItemId}”实例快照失败：${cause instanceof Error ? cause.message : String(cause)}`
      sceneWarnings.push(message)
      pushReport(report, { severity: 'warning', message, pageId: page.id })
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
  warnings: string[],
  options: BuildCoursePptxOptions,
): boolean {
  const notices = collectPublishedPptxSpatialNotices(
    surface,
    (assetId) => resolvePublishedAssetData(published, assetId),
    page.locationId,
  )
  notices.forEach((notice) => {
    warnings.push(notice.message)
    options.onWarning?.(notice.message)
    pushReport(report, {
      severity: notice.severity,
      message: notice.message,
      pageId: page.id,
      ...(notice.assetId ? { assetId: notice.assetId } : {}),
    })
  })
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
    return false
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
  slide.addNotes([
    `Spatial 镜头 ${page.cameraFrameId ?? 'home'}，视口 ${viewport.width}×${viewport.height}，未把无限 world 裁成单张 1280×720。`,
    ...notices.map((notice) => `静态导出提示：${notice.message}`),
  ].join('\n'))
  return true
}

async function collectPublishedDynamicSnapshots(
  published: PublishedCourseV2Payload,
  includeGlobalLayerItems: boolean,
  report: CourseExportReportItem[],
  warnings: string[],
  onWarning?: (message: string) => void,
): Promise<Map<string, string>> {
  const snapshots = new Map<string, string>()
  const recordFailure = (kind: 'component' | 'runtime', id: string, error: unknown): void => {
    const message = `${kind} “${id}”实例快照失败：${error instanceof Error ? error.message : String(error)}`
    warnings.push(message)
    pushReport(report, { severity: 'warning', message })
    onWarning?.(message)
  }
  const componentSnapshots = await renderPptxComponentSnapshots(published, {
    includeGlobalLayerItems,
    onFailure(failure) {
      recordFailure('component', failure.nodeId, failure.error)
    },
  })
  const runtimeSnapshots = await renderPptxRuntimeSnapshots(published, {
    includeGlobalLayerItems,
    onFailure(failure) {
      recordFailure('runtime', failure.layerItemId, failure.error)
    },
  })
  componentSnapshots.forEach((value, key) => snapshots.set(key, value))
  runtimeSnapshots.forEach((value, key) => snapshots.set(key, value))
  return snapshots
}

/** Build PPTX bytes from Course Project V9 sources, or an already-parsed Published V2. */
export async function buildCoursePptx(
  input: BuildCoursePptxInput,
  options: BuildCoursePptxOptions = {},
): Promise<CoursePptxResult> {
  const published = resolvePublishedCourseForPptx(input)
  const report: CourseExportReportItem[] = []
  const warnings: string[] = []
  const pages = buildCourseExportPageList(published)
  const pureSlide = isPureSlidePublishedCourse(published)
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

  if (published.globalLayerItems.length > 0 && !pureSlide) {
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

  const precomputedSnapshots = options.captureDynamicItem
    ? new Map<string, string>()
    : await collectPublishedDynamicSnapshots(
      published,
      pureSlide,
      report,
      warnings,
      options.onWarning,
    )
  const imageCache = new Map<string, HTMLImageElement>()

  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = APP_NAME
  pptx.company = APP_COMPANY
  pptx.title = published.title
  pptx.subject = 'Course Project V9 可编辑兼容导出'
  pptx.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei' }
  let slideCount = 0

  for (const page of slidePages) {
    const surface = published.surfaces.find((candidate): candidate is PublishedSlideSurface => (
      candidate.id === page.surfaceId && candidate.type === 'slide'
    ))
    if (!surface || !page.sceneId) continue
    const scene = surface.scenes.find((candidate) => candidate.id === page.sceneId)
    if (!scene) continue
    if (!page.locationId) {
      pushReport(report, {
        severity: 'error',
        message: `Slide 场景“${scene.name}”没有课程位置，无法确定 PPTX 状态与图层可见性。`,
        pageId: page.id,
      })
      continue
    }
    warnings.push(...await addSlideScenePage(
      pptx,
      published,
      surface,
      scene,
      { ...page, locationId: page.locationId },
      pureSlide,
      options,
      report,
      precomputedSnapshots,
      imageCache,
    ))
    slideCount += 1
  }

  for (const page of spatialPages) {
    const surface = published.surfaces.find((candidate): candidate is PublishedSpatialSurface => (
      candidate.id === page.surfaceId && candidate.type === 'spatial-2d'
    ))
    if (!surface) continue
    if (addSpatialFramePage(
      pptx,
      published,
      surface,
      page,
      report,
      warnings,
      options,
    )) slideCount += 1
  }

  if (report.some((item) => item.severity === 'error')) {
    return {
      bytes: new Uint8Array(),
      slideCount: 0,
      pages,
      warnings,
      report,
    }
  }

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
