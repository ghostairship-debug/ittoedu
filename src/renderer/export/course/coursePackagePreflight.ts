import type { ComponentPackageData } from '../../../shared/componentTypes'
import { courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import type {
  CourseAssetMeta,
  CourseProjectDocument,
} from '../../../shared/courseProjectTypes'
import { visitCourseProject } from '../../../shared/contracts/course-project-v9/references'
import { compareStableStrings } from '../../../shared/stableOrder'
import {
  collectPublishedCourseAssetIds,
  collectPublishedCourseComponentKeys,
  collectPublishedCourseSourceIssues,
  type PublishedCourseSourceIssue,
} from './buildPublishedCourse'
import {
  analyzeJavaScriptConnect,
  exactConnectOrigin,
  exactHttpsOrigin,
} from './coursePackageScriptAnalysis'

export type CoursePackageDelivery = 'standalone-html' | 'web-package'
export type SingleHtmlExportMode = 'offline-portable' | 'online-lightweight'

export interface CoursePackagePreflightOptions {
  singleHtmlMode?: SingleHtmlExportMode
}

export interface CoursePackageExportResources {
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
}

export interface CoursePackagePreflightItem {
  severity: 'error' | 'warning' | 'info'
  code:
    | PublishedCourseSourceIssue['code']
    | 'player-bundle-empty'
    | 'online-remote-asset'
    | 'online-remote-url-invalid'
    | 'online-connect-origin-undeclared'
    | 'online-connect-origin-unresolved'
  message: string
  path?: ReadonlyArray<string | number>
}

export interface CoursePackagePreflightReport {
  reportVersion: 1
  projectId: string
  schemaVersion: number
  delivery: CoursePackageDelivery
  generatedAt: string
  items: CoursePackagePreflightItem[]
  summary: {
    error: number
    warning: number
    info: number
    total: number
    canExport: boolean
  }
}

export interface OnlineRemoteAssetDependency {
  assetId: string
  recordKey: string
  metadata: CourseAssetMeta
  url: string
}

/**
 * Structured fail-closed error shared by every HTML/Web package producer.
 * The first blocking finding stays machine-addressable even for headless
 * callers that do not render the full preflight report.
 */
export class CoursePackagePreflightError extends Error {
  readonly code: CoursePackagePreflightItem['code']
  readonly path: ReadonlyArray<string | number>

  constructor(
    readonly item: CoursePackagePreflightItem,
    readonly report?: CoursePackagePreflightReport,
  ) {
    super(item.message)
    this.name = 'CoursePackagePreflightError'
    this.code = item.code
    this.path = item.path ?? []
  }
}

interface PublishedConnectSource {
  label: string
  source: string
  path: ReadonlyArray<string | number>
}

function summarize(items: readonly CoursePackagePreflightItem[]): CoursePackagePreflightReport['summary'] {
  const summary = { error: 0, warning: 0, info: 0, total: items.length, canExport: true }
  items.forEach(({ severity }) => { summary[severity] += 1 })
  summary.canExport = summary.error === 0
  return summary
}

function onlineRemoteDeliveryMessage(dependency: OnlineRemoteAssetDependency): string {
  return `素材“${dependency.metadata.filename}”的远程地址不能用于在线轻量单 HTML：请使用不含 wildcard 的精确 HTTPS 地址（${dependency.url}）。`
}

export class OnlineSingleHtmlDeliveryError extends CoursePackagePreflightError {
  readonly code = 'online-remote-url-invalid' as const

  constructor(
    dependencyOrItem: OnlineRemoteAssetDependency | CoursePackagePreflightItem,
    report?: CoursePackagePreflightReport,
  ) {
    const item: CoursePackagePreflightItem = 'severity' in dependencyOrItem
      ? dependencyOrItem
      : {
        severity: 'error',
        code: 'online-remote-url-invalid',
        path: ['assets', dependencyOrItem.recordKey, 'remote', 'url'],
        message: onlineRemoteDeliveryMessage(dependencyOrItem),
      }
    super(item, report)
    this.name = 'OnlineSingleHtmlDeliveryError'
  }
}

/** Raise the first stable blocking finding before any package bytes are emitted. */
export function assertCoursePackagePreflightCanExport(
  report: CoursePackagePreflightReport,
): void {
  const blocking = report.items.find(({ severity }) => severity === 'error')
  if (!blocking) return
  if (blocking.code === 'online-remote-url-invalid') {
    throw new OnlineSingleHtmlDeliveryError(blocking, report)
  }
  throw new CoursePackagePreflightError(blocking, report)
}

function findCourseAssetEntry(
  project: CourseProjectDocument,
  assetId: string,
): readonly [string, CourseAssetMeta] | undefined {
  const direct = project.assets[assetId]
  if (direct) return [assetId, direct]
  return Object.entries(project.assets).find(([, metadata]) => metadata.id === assetId)
}

export function collectOnlineRemoteAssetDependencies(
  project: CourseProjectDocument,
  components: CoursePackageExportResources['components'],
): OnlineRemoteAssetDependency[] | null {
  const parsed = courseProjectDocumentSchema.safeParse(project)
  if (!parsed.success) return null

  let assetIds: Set<string>
  try {
    assetIds = collectPublishedCourseAssetIds({
      project: parsed.data,
      components,
    })
  } catch {
    return null
  }

  const dependencies: OnlineRemoteAssetDependency[] = []
  for (const assetId of [...assetIds].sort(compareStableStrings)) {
    const entry = findCourseAssetEntry(parsed.data, assetId)
    if (!entry?.[1].remote) continue
    dependencies.push({
      assetId,
      recordKey: entry[0],
      metadata: entry[1],
      url: entry[1].remote.url,
    })
  }
  return dependencies.sort((left, right) => (
    compareStableStrings(left.url, right.url)
    || compareStableStrings(left.assetId, right.assetId)
  ))
}

function collectPublishedConnectSources(
  project: CourseProjectDocument,
  components: CoursePackageExportResources['components'],
): PublishedConnectSource[] {
  const parsed = courseProjectDocumentSchema.safeParse(project)
  if (!parsed.success) return []
  const sources: PublishedConnectSource[] = []
  visitCourseProject(parsed.data, {
    layerItem(item, path) {
      if (item.kind !== 'runtime' || !item.runtime.enabled) return
      sources.push({
        label: `Runtime“${item.layerItemId}”`,
        source: item.runtime.source,
        path: [...path, 'runtime', 'source'],
      })
    },
  })
  const referencedComponents = collectPublishedCourseComponentKeys(parsed.data)
  for (const [recordKey, metadata] of Object.entries(parsed.data.componentPackages)) {
    const key = `${metadata.packageId}@${metadata.version}`
    if (!referencedComponents.has(key)) continue
    const component = components[recordKey]
      ?? components[key]
      ?? components[metadata.packageId]
      ?? Object.values(components).find(({ manifest }) => (
        manifest.id === metadata.packageId && manifest.version === metadata.version
      ))
    if (!component) continue
    sources.push({
      label: `组件包“${key}”`,
      source: component.runtimeSource,
      path: ['componentPackages', recordKey, 'runtimePath'],
    })
  }
  return sources.sort((left, right) => (
    compareStableStrings(JSON.stringify(left.path), JSON.stringify(right.path))
    || compareStableStrings(left.label, right.label)
  ))
}

function collectOnlineConnectPreflightItems(
  project: CourseProjectDocument,
  components: CoursePackageExportResources['components'],
): CoursePackagePreflightItem[] {
  const declaredOrigins = new Set(
    (project.network?.connectOrigins ?? [])
      .map(exactConnectOrigin)
      .filter((origin): origin is string => origin !== null),
  )
  const items: CoursePackagePreflightItem[] = []
  for (const entry of collectPublishedConnectSources(project, components)) {
    const facts = analyzeJavaScriptConnect(entry.source)
    const missingOrigins = new Set<string>()
    let unresolved = facts.parseFailed || facts.hasDynamicExecution
    for (const site of facts.sites) {
      if (site.argument.kind === 'unresolved' || !site.argument.value) {
        unresolved = true
        continue
      }
      let parsed: URL
      try {
        parsed = new URL(site.argument.value)
      } catch {
        unresolved = true
        continue
      }
      if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') continue
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'wss:')
        && parsed.username === ''
        && parsed.password === ''
        && parsed.origin !== 'null'
      ) {
        if (!declaredOrigins.has(parsed.origin)) missingOrigins.add(parsed.origin)
        continue
      }
      missingOrigins.add(site.argument.value)
    }
    for (const origin of [...missingOrigins].sort(compareStableStrings)) {
      items.push({
        severity: 'error',
        code: 'online-connect-origin-undeclared',
        message: `${entry.label}使用了未声明或不可声明的网络地址“${origin}”；在线轻量单 HTML 只允许工程 network.connectOrigins 中精确声明的 HTTPS/WSS origin。`,
        path: entry.path,
      })
    }
    if (unresolved) {
      items.push({
        severity: 'warning',
        code: 'online-connect-origin-unresolved',
        message: `${entry.label}包含无法静态确定 origin 的网络调用；请确认运行时地址已在 network.connectOrigins 中精确声明。`,
        path: entry.path,
      })
    }
  }
  return items
}

export function collectCoursePackageExportPreflight(
  project: CourseProjectDocument,
  delivery: CoursePackageDelivery,
  resources: CoursePackageExportResources,
  playerBundle = '',
  now = new Date(),
  options: CoursePackagePreflightOptions = {},
): CoursePackagePreflightReport {
  const items: CoursePackagePreflightItem[] = []
  if (!playerBundle.trim()) {
    items.push({
      severity: 'error',
      code: 'player-bundle-empty',
      message: 'Player Runtime 为空，无法生成课程导出物。',
    })
  }

  const sourceIssues = collectPublishedCourseSourceIssues({ project, ...resources })
  for (const issue of sourceIssues) {
    items.push({ severity: 'error', ...issue })
  }

  const onlineStandalone = delivery === 'standalone-html'
    && options.singleHtmlMode === 'online-lightweight'
  if (onlineStandalone) {
    const dependencies = collectOnlineRemoteAssetDependencies(project, resources.components) ?? []
    for (const dependency of dependencies) {
      if (exactHttpsOrigin(dependency.url)) continue
      const error = new OnlineSingleHtmlDeliveryError(dependency)
      items.push({
        severity: 'error',
        code: error.code,
        path: error.path,
        message: error.message,
      })
    }
    const urls = [...new Set(dependencies.map((dependency) => dependency.url))]
      .sort(compareStableStrings)
    for (const url of urls) {
      items.push({
        severity: 'info',
        code: 'online-remote-asset',
        message: `在线轻量单 HTML 将依赖远程素材：${url}`,
      })
    }
  }
  if (delivery === 'web-package' || onlineStandalone) {
    items.push(...collectOnlineConnectPreflightItems(project, resources.components))
  }

  const sorted = [...items].sort((left, right) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[left.severity] - severityOrder[right.severity] ||
      compareStableStrings(left.code, right.code) ||
      compareStableStrings(left.message, right.message) ||
      compareStableStrings(JSON.stringify(left.path ?? []), JSON.stringify(right.path ?? []))
  })

  return {
    reportVersion: 1,
    projectId: project.id,
    schemaVersion: project.schemaVersion,
    delivery,
    generatedAt: now.toISOString(),
    items: sorted,
    summary: summarize(sorted),
  }
}
