import type { ComponentPackageData } from '../../shared/componentTypes'
import { collectCourseProjectHealth } from '../../shared/courseProjectHealth'
import type {
  CourseProjectHealthCode,
  CourseProjectHealthSeverity,
} from '../../shared/courseProjectHealth'
import type {
  CourseProjectDocument,
  FlowBlock,
} from '../../shared/courseProjectTypes'
import {
  resolveSchemaValidCourseProjectDiagnosticTarget,
  type DiagnosticTargetV1,
} from '../../shared/courseProjectValidationDiagnostics'
import type { ExportPreflightCode } from '../../shared/diagnosticCodes'
import { compareStableStrings } from '../../shared/stableOrder'
import { buildPublishedCourseV2Payload } from './course/buildPublishedCourse'
import { collectPublishedPptxSpatialNotices } from './course/buildCoursePptx'
import {
  collectCoursePackageExportPreflight,
  type CoursePackagePreflightItem,
  type SingleHtmlExportMode,
} from './course/coursePackagePreflight'
import {
  auditCourseExportAssets,
  buildCourseExportPageList,
  collectPublishedPdfProducerNotices,
  type CourseExportReportItem,
} from './course/buildCoursePrintArtifacts'
import { componentPackagesToArchiveFiles } from '../components/componentPackageStore'
import { collectCourseProjectSlideVisualPreflightItems } from './slideVisualPreflight'

export type ExportPreflightTarget =
  | 'single-html'
  | 'web-package'
  | 'pdf'
  | 'pptx'

export interface ExportPreflightResources {
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
}

export interface ExportPreflightItem {
  severity: CourseProjectHealthSeverity
  code:
    | ExportPreflightCode
    | `project-health:${CourseProjectHealthCode}`
    | CoursePackagePreflightItem['code']
    | 'static-export-preflight'
    | 'static-export-warning'
    | 'static-export-info'
  message: string
  target: ExportPreflightTarget
  diagnosticTarget?: DiagnosticTargetV1
  sceneId?: string
  stateId?: string
  nodeId?: string
  path?: ReadonlyArray<string | number>
}

export interface CourseProjectExportPreflightReportV1 {
  reportVersion: 1
  projectId: string
  schemaVersion: 9
  target: ExportPreflightTarget
  generatedAt: string
  items: ExportPreflightItem[]
  summary: {
    error: number
    warning: number
    info: number
    total: number
    canExport: boolean
  }
}

function stableItemKey(item: ExportPreflightItem): string {
  return [
    item.severity,
    item.code,
    item.sceneId ?? '',
    item.stateId ?? '',
    item.nodeId ?? '',
    JSON.stringify(item.diagnosticTarget ?? null),
    JSON.stringify(item.path ?? []),
    item.message,
  ].join('\0')
}

function summarize(
  items: readonly ExportPreflightItem[],
): CourseProjectExportPreflightReportV1['summary'] {
  const summary = { error: 0, warning: 0, info: 0, total: items.length, canExport: true }
  items.forEach(({ severity }) => { summary[severity] += 1 })
  summary.canExport = summary.error === 0
  return summary
}

export interface CourseProjectExportPreflightOptions {
  playerBundle?: string
  singleHtmlMode?: SingleHtmlExportMode
}

function courseSlideFindingTarget(
  project: CourseProjectDocument,
  finding: {
    path?: ReadonlyArray<string | number>
    sceneId?: string
    nodeId?: string
  },
): DiagnosticTargetV1 {
  const resolved = resolveSchemaValidCourseProjectDiagnosticTarget(project, {
    ...(finding.path ? { path: finding.path } : {}),
    ...(finding.nodeId ? { layerItemId: finding.nodeId } : {}),
  })
  if (resolved.kind !== 'project' || !finding.sceneId) return resolved
  const matches = project.surfaces.flatMap((surface) => (
    surface.type === 'slide' && surface.scenes.some((scene) => scene.id === finding.sceneId)
      ? [surface]
      : []
  ))
  if (matches.length !== 1) return resolved
  return {
    version: 1,
    kind: 'scene',
    projectId: project.id,
    surfaceId: matches[0]!.id,
    sceneId: finding.sceneId,
  }
}

function mapCourseExportAuditItem(item: CourseExportReportItem): {
  severity: CourseExportReportItem['severity']
  code: 'static-export-preflight' | 'static-export-warning' | 'static-export-info'
  message: string
  path?: ReadonlyArray<string | number>
} {
  const code = item.severity === 'error'
    ? 'static-export-preflight'
    : item.severity === 'warning'
      ? 'static-export-warning'
      : 'static-export-info'
  return {
    severity: item.severity,
    code,
    message: item.message,
    ...(item.assetId ? { path: ['assets', item.assetId] } : {}),
  }
}

export type CourseExportFormatFinding = Omit<ExportPreflightItem, 'target'>

/**
 * r11-043 contract. HTML/Web producer facts only; health rules stay in the
 * V9 catalog. Producer findings come from coursePackagePreflight; this adapter
 * only attaches diagnostic targets for the shared catalog.
 */
export function adaptCourseHtmlWebProducerFindings(
  project: CourseProjectDocument,
  target: ExportPreflightTarget,
  resources: ExportPreflightResources,
  now: Date,
  options: CourseProjectExportPreflightOptions = {},
): CourseExportFormatFinding[] {
  const delivery = target === 'web-package' ? 'web-package' : 'standalone-html'
  return collectCoursePackageExportPreflight(
    project,
    delivery,
    resources,
    options.playerBundle ?? '',
    now,
    target === 'single-html' && options.singleHtmlMode
      ? { singleHtmlMode: options.singleHtmlMode }
      : {},
  ).items.map((item) => ({
    severity: item.severity,
    code: item.code,
    message: item.message,
    ...(item.path ? { path: item.path } : {}),
    diagnosticTarget: resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      ...(item.path ? { path: item.path } : {}),
    }),
  }))
}

function adaptCourseStaticFormatProducerFindings(
  project: CourseProjectDocument,
  target: Extract<ExportPreflightTarget, 'pdf' | 'pptx'>,
  resources: ExportPreflightResources,
  htmlWebItems: readonly CourseExportFormatFinding[],
): CourseExportFormatFinding[] {
  const items: CourseExportFormatFinding[] = []
  const projectDiagnosticTarget = resolveSchemaValidCourseProjectDiagnosticTarget(project, {})
  const sourceBlocked = htmlWebItems.some((item) => (
    item.severity === 'error' && item.code !== 'player-bundle-empty'
  ))
  if (!sourceBlocked) {
    try {
      const published = buildPublishedCourseV2Payload({ project, ...resources })
      const auditItems: CourseExportReportItem[] = []
      auditCourseExportAssets(published, auditItems, (assetId) => {
        const metadata = project.assets[assetId]
        const bytes = resources.assetFiles[assetId]
        return metadata && bytes
          ? { filename: metadata.filename, mimeType: metadata.mimeType, bytes }
          : undefined
      })
      auditItems.forEach((item) => {
        const mapped = mapCourseExportAuditItem(item)
        items.push({
          ...mapped,
          diagnosticTarget: resolveSchemaValidCourseProjectDiagnosticTarget(project, {
            ...(mapped.path ? { path: mapped.path } : {}),
          }),
        })
      })
      if (buildCourseExportPageList(published).length === 0) {
        items.push({
          severity: 'error',
          code: 'static-export-preflight',
          message: '当前 Course Project V9 没有可导出的 PDF/PPTX 页面。',
          diagnosticTarget: projectDiagnosticTarget,
        })
      }
    } catch (error) {
      items.push({
        severity: 'error',
        code: 'static-export-preflight',
        message: error instanceof Error ? error.message : 'Published Course V2 预检失败。',
        diagnosticTarget: projectDiagnosticTarget,
      })
    }
  }

  const interactionCount = project.globalInteractions.length
    + project.surfaces.reduce((count, surface) => (
      count + (surface.type === 'slide'
        ? surface.scenes.reduce((sceneCount, scene) => sceneCount + scene.interactions.length, 0)
        : 0)
    ), 0)
  if (interactionCount > 0) {
    items.push({
      severity: 'info',
      code: 'static-export-interactions-omitted',
      message: `${target.toUpperCase()} 为静态格式，${interactionCount} 条声明式交互不会保留。`,
      diagnosticTarget: projectDiagnosticTarget,
    })
  }

  const layerItems = [
    ...project.globalLayerItems.map(({ item }) => item),
    ...project.surfaces.flatMap((surface) => [
      ...surface.surfaceLayerItems.map(({ item }) => item),
      ...(surface.type === 'slide'
        ? surface.scenes.flatMap((scene) => scene.layerItems)
        : surface.type === 'spatial-2d'
          ? surface.world.layerItems
          : []),
    ]),
  ]
  const videoCount = layerItems.filter((item) => (
    item.kind === 'native' && item.content.nativeType === 'video'
  )).length
  const omittedControllerCount = layerItems.filter((item) => (
    item.kind === 'native'
    && item.content.nativeType === 'teacher-controller'
    && !item.content.data.includeInStaticExports
  )).length
  const flowMediaKinds: Array<'audio' | 'video'> = []
  const visitFlowBlocks = (blocks: readonly FlowBlock[]): void => {
    blocks.forEach((block) => {
      if (block.type === 'section') visitFlowBlocks(block.blocks)
      else if (block.type === 'media' && block.mediaKind !== 'image') {
        flowMediaKinds.push(block.mediaKind)
      }
    })
  }
  project.surfaces.forEach((surface) => {
    if (surface.type === 'flow') visitFlowBlocks(surface.blocks)
  })
  const staticVideoCount = videoCount
    + flowMediaKinds.filter((kind) => kind === 'video').length
  const staticAudioCount = Object.keys(project.media.audio.sounds).length
    + flowMediaKinds.filter((kind) => kind === 'audio').length
  if (staticAudioCount > 0) {
    items.push({
      severity: 'info',
      code: 'static-export-audio-omitted',
      message: `${target.toUpperCase()} 为静态格式，声音不会播放。`,
      diagnosticTarget: projectDiagnosticTarget,
    })
  }
  if (staticVideoCount > 0) {
    items.push({
      severity: 'info',
      code: 'static-export-video-poster',
      message: `${target.toUpperCase()} 中的 ${staticVideoCount} 个视频只保留封面或静态占位。`,
      diagnosticTarget: projectDiagnosticTarget,
    })
  }
  if (omittedControllerCount > 0) {
    items.push({
      severity: 'info',
      code: 'static-export-controller-omitted',
      message: `${omittedControllerCount} 个教师控制器按作者设置从静态导出中省略。`,
      diagnosticTarget: projectDiagnosticTarget,
    })
  }
  return items
}

/** r11-041 contract. PPTX producer facts only; do not copy health rules. */
/**
 * PPTX maps Slide scenes and Spatial cameras only. Flow content exports as
 * DOCX, so a Flow-only course has no PPTX target at all.
 */
export function coursePptxTargetApplicable(project: CourseProjectDocument): boolean {
  return project.locations.some((location) => (
    location.kind === 'slide-scene' || location.kind === 'spatial-camera'
  ))
}

export function adaptCoursePptxProducerFindings(
  project: CourseProjectDocument,
  resources: ExportPreflightResources,
  htmlWebItems: readonly CourseExportFormatFinding[],
): CourseExportFormatFinding[] {
  const items = adaptCourseStaticFormatProducerFindings(
    project,
    'pptx',
    resources,
    htmlWebItems,
  )
  const projectDiagnosticTarget = resolveSchemaValidCourseProjectDiagnosticTarget(project, {})
  const pureSlide = project.locations.every((location) => location.kind === 'slide-scene')
    && project.surfaces.every((surface) => surface.type === 'slide')
  if (project.globalLayerItems.length > 0 && !pureSlide) {
    items.push({
      severity: 'info',
      code: 'static-export-info',
      message: '全局图层与教师控制器默认不写入 PPTX 文件。',
      diagnosticTarget: projectDiagnosticTarget,
    })
  }
  for (const surface of project.surfaces) {
    if (surface.type !== 'flow') continue
    items.push({
      severity: 'info',
      code: 'static-export-info',
      message: `Flow 表面“${surface.title}”没有 PPTX 映射，已按页列表跳过。`,
      diagnosticTarget: resolveSchemaValidCourseProjectDiagnosticTarget(project, {
        path: ['surfaces', project.surfaces.indexOf(surface)],
      }),
    })
  }
  project.surfaces.forEach((surface, surfaceIndex) => {
    if (surface.type !== 'slide') return
    surface.scenes.forEach((scene, sceneIndex) => {
      const located = project.locations.some((location) => (
        location.kind === 'slide-scene'
        && location.surfaceId === surface.id
        && location.sceneId === scene.id
      ))
      if (located) return
      const path: ReadonlyArray<string | number> = [
        'surfaces',
        surfaceIndex,
        'scenes',
        sceneIndex,
      ]
      items.push({
        severity: 'error',
        code: 'static-export-preflight',
        message: `Slide 场景“${scene.name}”没有课程位置，无法确定 PPTX 状态与图层可见性。`,
        path,
        diagnosticTarget: resolveSchemaValidCourseProjectDiagnosticTarget(project, { path }),
      })
    })
  })
  try {
    const published = buildPublishedCourseV2Payload({ project, ...resources })
    project.surfaces.forEach((surface, surfaceIndex) => {
      if (surface.type !== 'spatial-2d') return
      const publishedSurface = published.surfaces.find((candidate) => (
        candidate.id === surface.id && candidate.type === 'spatial-2d'
      ))
      if (!publishedSurface || publishedSurface.type !== 'spatial-2d') return
      const locationIds = project.locations
        .filter((location) => (
          location.kind === 'spatial-camera' && location.surfaceId === surface.id
        ))
        .map((location) => location.id)
      const noticeMap = new Map<string, ReturnType<typeof collectPublishedPptxSpatialNotices>[number]>()
      const inputs: Array<string | undefined> = locationIds.length > 0
        ? locationIds
        : [undefined]
      inputs.forEach((locationId) => {
        collectPublishedPptxSpatialNotices(
          publishedSurface,
          (assetId) => published.assets[assetId]?.url,
          locationId,
        ).forEach((notice) => {
          noticeMap.set(
            `${notice.source}:${notice.itemIndex}:${notice.message}`,
            notice,
          )
        })
      })
      noticeMap.forEach((notice) => {
        const path: ReadonlyArray<string | number> = notice.source === 'world'
          ? ['surfaces', surfaceIndex, 'world', 'layerItems', notice.itemIndex]
          : ['surfaces', surfaceIndex, 'surfaceLayerItems', notice.itemIndex, 'item']
        items.push({
          severity: notice.severity,
          code: notice.severity === 'warning'
            ? 'static-export-warning'
            : 'static-export-info',
          message: notice.message,
          path,
          diagnosticTarget: resolveSchemaValidCourseProjectDiagnosticTarget(project, {
            path,
            layerItemId: notice.layerItemId,
          }),
        })
      })
    })
  } catch {
    // Common static preflight already owns build/asset failures. Do not emit a
    // second, differently worded producer error from this PPTX-only adapter.
  }
  if (!coursePptxTargetApplicable(project)) {
    items.push({
      severity: 'error',
      code: 'static-export-preflight',
      message: '当前课程没有可映射到 PPTX 的 Slide 场景或 Spatial 镜头。',
      diagnosticTarget: projectDiagnosticTarget,
    })
  }
  return items
}

/** r11-042 contract. PDF producer facts only; do not copy health rules. */
export function adaptCoursePdfProducerFindings(
  project: CourseProjectDocument,
  resources: ExportPreflightResources,
  htmlWebItems: readonly CourseExportFormatFinding[],
): CourseExportFormatFinding[] {
  const items = adaptCourseStaticFormatProducerFindings(
    project,
    'pdf',
    resources,
    htmlWebItems,
  )
  try {
    const published = buildPublishedCourseV2Payload({ project, ...resources })
    collectPublishedPdfProducerNotices(published).forEach((notice) => {
      const path = notice.path ?? (notice.assetId ? ['assets', notice.assetId] : undefined)
      items.push({
        severity: notice.severity,
        code: notice.severity === 'error'
          ? 'static-export-preflight'
          : notice.severity === 'warning'
            ? 'static-export-warning'
            : 'static-export-info',
        message: notice.message,
        ...(path ? { path } : {}),
        diagnosticTarget: resolveSchemaValidCourseProjectDiagnosticTarget(project, {
          ...(path ? { path } : {}),
          ...(notice.layerItemId ? { layerItemId: notice.layerItemId } : {}),
        }),
      })
    })
  } catch {
    // Common static preflight already owns build/asset failures. Keep the PDF
    // adapter limited to producer facts so it cannot create a second truth.
  }
  return items
}

/**
 * Current Course Project V9 GUI/saved-report preflight. Common items come from
 * the V9 finding catalog; format producers attach through the 041–043 adapters.
 */
export function collectCourseProjectExportPreflight(
  project: CourseProjectDocument,
  target: ExportPreflightTarget,
  resources: ExportPreflightResources,
  now = new Date(),
  options: CourseProjectExportPreflightOptions = {},
): CourseProjectExportPreflightReportV1 {
  const itemMap = new Map<string, ExportPreflightItem>()
  const add = (item: Omit<ExportPreflightItem, 'target'>): void => {
    const complete = { ...item, target }
    itemMap.set(stableItemKey(complete), complete)
  }
  const health = collectCourseProjectHealth(project, {
    assetFiles: resources.assetFiles,
    componentFiles: componentPackagesToArchiveFiles(resources.components),
  })
  health.forEach((finding) => add({
    severity: finding.severity,
    code: `project-health:${finding.code}` as const,
    message: finding.message,
    path: finding.path,
    diagnosticTarget: finding.target,
  }))

  const htmlWebItems = adaptCourseHtmlWebProducerFindings(
    project,
    target,
    resources,
    now,
    options,
  )
  htmlWebItems.forEach(add)

  collectCourseProjectSlideVisualPreflightItems(project, target).forEach((item) => add({
    severity: item.severity,
    code: item.code,
    message: item.message,
    ...(item.path ? { path: item.path } : {}),
    ...(item.sceneId ? { sceneId: item.sceneId } : {}),
    ...(item.stateId ? { stateId: item.stateId } : {}),
    ...(item.nodeId ? { nodeId: item.nodeId } : {}),
    diagnosticTarget: courseSlideFindingTarget(project, {
      ...(item.path ? { path: item.path } : {}),
      ...(item.sceneId ? { sceneId: item.sceneId } : {}),
      ...(item.nodeId ? { nodeId: item.nodeId } : {}),
    }),
  }))

  if (target === 'pptx') {
    adaptCoursePptxProducerFindings(project, resources, htmlWebItems).forEach(add)
  } else if (target === 'pdf') {
    adaptCoursePdfProducerFindings(project, resources, htmlWebItems).forEach(add)
  }

  const items = [...itemMap.values()].sort((left, right) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[left.severity] - severityOrder[right.severity]
      || compareStableStrings(left.code, right.code)
      || compareStableStrings(JSON.stringify(left.diagnosticTarget ?? null), JSON.stringify(right.diagnosticTarget ?? null))
      || compareStableStrings(left.message, right.message)
  })
  return {
    reportVersion: 1,
    projectId: project.id,
    schemaVersion: 9,
    target,
    generatedAt: now.toISOString(),
    items,
    summary: summarize(items),
  }
}
