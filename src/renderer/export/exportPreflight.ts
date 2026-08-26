import type { ComponentPackageData } from '../../shared/componentTypes'
import { collectCourseProjectHealth } from '../../shared/courseProjectHealth'
import type {
  CourseProjectDocument,
  FlowBlock,
} from '../../shared/courseProjectTypes'
import {
  resolveSchemaValidCourseProjectDiagnosticTarget,
  type DiagnosticTargetV1,
} from '../../shared/courseProjectValidationDiagnostics'
import type { ProjectDocument } from '../../shared/projectTypes'
import {
  collectProjectHealth,
  type ProjectHealthSeverity,
} from '../../shared/projectHealth'
import type { ExportPreflightCode } from '../../shared/diagnosticCodes'
import { collectUnusedProjectAssetIds } from '../../shared/assetReferences'
import { componentContentSha256 } from '../../shared/componentContentIntegrity'
import { compareStableStrings } from '../../shared/stableOrder'
import { buildPublishedCourseV2Payload } from './course/buildPublishedCourse'
import {
  collectCoursePackageExportPreflight,
  type CoursePackagePreflightItem,
  type SingleHtmlExportMode,
} from './course/buildCoursePackages'
import {
  auditCourseExportAssets,
  buildCourseExportPageList,
  type CourseExportReportItem,
} from './course/buildCoursePrintArtifacts'
import { componentPackagesToArchiveFiles } from '../components/componentPackageStore'
import { collectCourseProjectSlideVisualPreflightItems } from './slideVisualPreflight'
import { collectProjectDocumentSlideVisualPreflightItems } from './slideVisualPreflight'

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
  severity: ProjectHealthSeverity
  code:
    | ExportPreflightCode
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

export interface ExportPreflightReport {
  reportVersion: 1
  projectId: string
  schemaVersion: 8 | 9
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

function componentKey(packageId: string, version: string): string {
  return `${packageId}@${version}`
}

type SourceNetworkFinding = 'network-use' | 'url-reference' | null

function inspectSourceNetworkUse(source: string): SourceNetworkFinding {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
  // XML/SVG namespace identifiers use an http-looking URI but do not trigger
  // a request. Treating every `//` token as a URL also blocks legitimate
  // authored strings such as the reading component's pause markup.
  const inertNamespaceUris = new Set([
    'http://www.w3.org/2000/svg',
    'http://www.w3.org/1999/xlink',
    'http://www.w3.org/XML/1998/namespace',
  ])
  const absoluteUrls = withoutComments.match(/\bhttps?:\/\/[^\s'"`<>)]+/gi) ?? []
  const hasExternalUrl = absoluteUrls.some(
    (url) => !inertNamespaceUris.has(url.replace(/[;,]+$/, '')),
  )
  const protocolRelativeHost = /(?<!:)\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|(?=['"`]))/i
  const hasProtocolRelativeUrl = protocolRelativeHost.test(withoutComments)
  const usesNetworkApi = /\bfetch\s*\(/.test(withoutComments) ||
    /\bXMLHttpRequest\b/.test(withoutComments) ||
    /\b(?:WebSocket|EventSource)\s*\(/.test(withoutComments) ||
    /\bnavigator\s*\.\s*sendBeacon\s*\(/.test(withoutComments)
  const usesExternalResourceSyntax =
    /@import\s+(?:url\()?\s*['"]?(?:https?:)?\/\//i.test(withoutComments) ||
    /\burl\(\s*['"]?(?:https?:)?\/\//i.test(withoutComments) ||
    /\bimport\s*(?:\(|[^;\n]*?\bfrom\s*)['"](?:https?:)?\/\//i.test(withoutComments) ||
    /<(?:img|script|link|iframe|video|audio|source)\b[^>]*\b(?:src|href|poster)\s*=\s*['"](?:https?:)?\/\//i.test(withoutComments) ||
    /\.\s*(?:src|href|poster)\s*=\s*['"](?:https?:)?\/\//i.test(withoutComments) ||
    /setAttribute\s*\(\s*['"](?:src|href|poster)['"]\s*,\s*['"](?:https?:)?\/\//i.test(withoutComments)

  if (usesNetworkApi || usesExternalResourceSyntax) return 'network-use'
  return hasExternalUrl || hasProtocolRelativeUrl ? 'url-reference' : null
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

function summarize(items: readonly ExportPreflightItem[]): ExportPreflightReport['summary'] {
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

/**
 * Current Course Project V9 GUI preflight. It consumes the same V9 document,
 * source bytes, semantic health collector and Published producer gates as the
 * headless validator; no Project V8 projection participates in this report.
 */
export function collectCourseProjectExportPreflight(
  project: CourseProjectDocument,
  target: ExportPreflightTarget,
  resources: ExportPreflightResources,
  now = new Date(),
  options: CourseProjectExportPreflightOptions = {},
): ExportPreflightReport {
  const itemMap = new Map<string, ExportPreflightItem>()
  const add = (item: Omit<ExportPreflightItem, 'target'>): void => {
    const complete = { ...item, target }
    itemMap.set(stableItemKey(complete), complete)
  }
  const projectDiagnosticTarget = resolveSchemaValidCourseProjectDiagnosticTarget(project, {})
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

  const delivery = target === 'web-package' ? 'web-package' : 'standalone-html'
  const packageReport = collectCoursePackageExportPreflight(
    project,
    delivery,
    resources,
    options.playerBundle ?? '',
    now,
    target === 'single-html' && options.singleHtmlMode
      ? { singleHtmlMode: options.singleHtmlMode }
      : {},
  )
  packageReport.items.forEach((item) => add({
    severity: item.severity,
    code: item.code,
    message: item.message,
    ...(item.path ? { path: item.path } : {}),
    diagnosticTarget: resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      ...(item.path ? { path: item.path } : {}),
    }),
  }))

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

  if (target === 'pdf' || target === 'pptx') {
    const sourceBlocked = packageReport.items.some((item) => (
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
          add({
            ...mapped,
            diagnosticTarget: resolveSchemaValidCourseProjectDiagnosticTarget(project, {
              ...(mapped.path ? { path: mapped.path } : {}),
            }),
          })
        })
        if (buildCourseExportPageList(published).length === 0) {
          add({
            severity: 'error',
            code: 'static-export-preflight',
            message: '当前 Course Project V9 没有可导出的 PDF/PPTX 页面。',
            diagnosticTarget: projectDiagnosticTarget,
          })
        }
      } catch (error) {
        add({
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
      add({
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
    if (staticAudioCount > 0) add({
      severity: 'info',
      code: 'static-export-audio-omitted',
      message: `${target.toUpperCase()} 为静态格式，声音不会播放。`,
      diagnosticTarget: projectDiagnosticTarget,
    })
    if (staticVideoCount > 0) add({
      severity: 'info',
      code: 'static-export-video-poster',
      message: `${target.toUpperCase()} 中的 ${staticVideoCount} 个视频只保留封面或静态占位。`,
      diagnosticTarget: projectDiagnosticTarget,
    })
    if (omittedControllerCount > 0) add({
      severity: 'info',
      code: 'static-export-controller-omitted',
      message: `${omittedControllerCount} 个教师控制器按作者设置从静态导出中省略。`,
      diagnosticTarget: projectDiagnosticTarget,
    })
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
    schemaVersion: project.schemaVersion,
    target,
    generatedAt: now.toISOString(),
    items,
    summary: summarize(items),
  }
}

export function collectExportPreflight(
  project: ProjectDocument,
  target: ExportPreflightTarget,
  resources: ExportPreflightResources,
  now = new Date(),
): ExportPreflightReport {
  const itemMap = new Map<string, ExportPreflightItem>()
  const add = (item: Omit<ExportPreflightItem, 'target'>): void => {
    const complete = { ...item, target }
    itemMap.set(stableItemKey(complete), complete)
  }

  collectProjectHealth(project, resources.components)
    .filter((diagnostic) => diagnostic.code !== 'asset-unused')
    .forEach((diagnostic) => add({
    severity: diagnostic.severity,
    code: `project-health:${diagnostic.code}` as const,
    message: diagnostic.message,
    path: diagnostic.path,
    ...(diagnostic.sceneId ? { sceneId: diagnostic.sceneId } : {}),
    ...(diagnostic.stateId ? { stateId: diagnostic.stateId } : {}),
    ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
    }))

  const unusedAssetIds = collectUnusedProjectAssetIds(project, {
    componentPackages: resources.components,
  })
  if (unusedAssetIds.size > 0) {
    const byteLength = Object.values(project.assets)
      .filter((asset) => unusedAssetIds.has(asset.id))
      .reduce((total, asset) => total + asset.byteLength, 0)
    add({
      severity: 'info',
      code: 'asset-unused-summary',
      message: `工程含 ${unusedAssetIds.size} 个未引用素材，共 ${byteLength} 字节；发布裁剪保持现有语义，工程归档不会被静默改写。`,
      path: ['assets'],
    })
  }

  for (const [assetKey, asset] of Object.entries(project.assets)) {
    if (!resources.assetFiles[assetKey] && !resources.assetFiles[asset.id]) {
      add({
        severity: 'error',
        code: 'asset-bytes-missing',
        message: `素材“${asset.filename}”只有工程元数据，没有可嵌入导出物的本地字节。`,
        path: ['assets', assetKey],
      })
    }
  }

  for (const [packageKey, embedded] of Object.entries(project.componentPackages)) {
    const component = Object.values(resources.components).find(
      ({ manifest }) => manifest.id === embedded.packageId &&
        manifest.version === embedded.version,
    )
    if (!component) {
      add({
        severity: 'error',
        code: 'component-bytes-missing',
        message: `组件包“${componentKey(embedded.packageId, embedded.version)}”没有可嵌入导出物的执行内容。`,
        path: ['componentPackages', packageKey],
      })
      continue
    }
    const actualContentSha256 = component.contentSha256 ??
      componentContentSha256(component.files)
    if (embedded.contentSha256 !== actualContentSha256) {
      add({
        severity: 'error',
        code: 'component-hash-mismatch',
        message: `组件包“${componentKey(embedded.packageId, embedded.version)}”的工程锁定内容哈希与当前执行内容不一致。`,
        path: ['componentPackages', packageKey, 'contentSha256'],
      })
    }
    const networkFinding = inspectSourceNetworkUse(component.runtimeSource)
    if (networkFinding === 'network-use') {
      add({
        severity: 'error',
        code: 'component-external-network',
        message: `组件包“${componentKey(embedded.packageId, embedded.version)}”包含网络请求 API 或外部资源引用，违反离线交付要求。`,
        path: ['componentPackages', packageKey],
      })
    } else if (networkFinding === 'url-reference') {
      add({
        severity: 'warning',
        code: 'component-external-url-reference',
        message: `组件包“${componentKey(embedded.packageId, embedded.version)}”含有外部 URL 文本，但预检未识别到网络请求或资源加载；请确认它只用于展示或归属说明。`,
        path: ['componentPackages', packageKey],
      })
    }
  }

  const runtimeEntries: Array<{
    source: string
    label: string
    path: Array<string | number>
    sceneId?: string
  }> = []
  if (project.globalRuntime?.enabled) {
    runtimeEntries.push({
      source: project.globalRuntime.source,
      label: '全局自由运行时',
      path: ['globalRuntime', 'source'],
    })
  }
  project.scenes.forEach((scene, sceneIndex) => {
    if (scene.runtime?.enabled) runtimeEntries.push({
      source: scene.runtime.source,
      label: `场景“${scene.name}”自由运行时`,
      path: ['scenes', sceneIndex, 'runtime', 'source'],
      sceneId: scene.id,
    })
  })
  runtimeEntries.forEach((runtime) => {
    const networkFinding = inspectSourceNetworkUse(runtime.source)
    if (networkFinding === 'network-use') {
      add({
        severity: 'error',
        code: 'runtime-external-network',
        message: `${runtime.label}包含网络请求 API 或外部资源引用，违反离线交付要求。`,
        path: runtime.path,
        ...(runtime.sceneId ? { sceneId: runtime.sceneId } : {}),
      })
    } else if (networkFinding === 'url-reference') {
      add({
        severity: 'warning',
        code: 'runtime-external-url-reference',
        message: `${runtime.label}含有外部 URL 文本，但预检未识别到网络请求或资源加载；请确认它只用于展示或归属说明。`,
        path: runtime.path,
        ...(runtime.sceneId ? { sceneId: runtime.sceneId } : {}),
      })
    }
  })

  collectProjectDocumentSlideVisualPreflightItems(project, target)
    .forEach(({ target: _target, ...item }) => add(item))

  if (target === 'pdf' || target === 'pptx') {
    const interactionCount = project.globalInteractions.length +
      project.scenes.reduce((count, scene) => count + scene.interactions.length, 0)
    const videoCount = project.globalLayer.filter(({ node }) => node.type === 'video').length +
      project.scenes.reduce(
        (count, scene) => count + scene.nodes.filter(({ type }) => type === 'video').length,
        0,
      )
    const omittedControllerCount = project.globalLayer.filter(
      ({ node }) => node.type === 'teacher-controller' && !node.includeInStaticExports,
    ).length + project.scenes.reduce(
      (count, scene) => count + scene.nodes.filter(
        (node) => node.type === 'teacher-controller' && !node.includeInStaticExports,
      ).length,
      0,
    )
    if (interactionCount > 0) add({
      severity: 'info',
      code: 'static-export-interactions-omitted',
      message: `${target.toUpperCase()} 为静态格式，${interactionCount} 条声明式交互不会保留。`,
    })
    if (Object.keys(project.media.audio.sounds).length > 0) add({
      severity: 'info',
      code: 'static-export-audio-omitted',
      message: `${target.toUpperCase()} 为静态格式，声音不会播放。`,
    })
    if (videoCount > 0) add({
      severity: 'info',
      code: 'static-export-video-poster',
      message: `${target.toUpperCase()} 中的 ${videoCount} 个视频只保留封面或静态占位。`,
    })
    if (omittedControllerCount > 0) add({
      severity: 'info',
      code: 'static-export-controller-omitted',
      message: `${omittedControllerCount} 个教师控制器按作者设置从静态导出中省略。`,
    })
  }

  const items = [...itemMap.values()].sort((left, right) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[left.severity] - severityOrder[right.severity] ||
      compareStableStrings(left.code, right.code) ||
      compareStableStrings(left.sceneId ?? '', right.sceneId ?? '')
  })
  return {
    reportVersion: 1,
    projectId: project.id,
    schemaVersion: project.schemaVersion,
    target,
    generatedAt: now.toISOString(),
    items,
    summary: summarize(items),
  }
}
