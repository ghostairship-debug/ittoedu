import { strToU8, zip, zipSync } from 'fflate'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import { componentContentSha256 } from '../../../shared/componentContentIntegrity'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { PublishedCourseV2Payload } from '../../../shared/publishedCourseTypes'
import type { AssetMeta } from '../../../shared/projectTypes'
import { compareStableStrings } from '../../../shared/stableOrder'
import {
  buildPublishedCourseV2Payload,
  collectPublishedCourseAssetIds,
  collectPublishedCourseComponentKeys,
  type CoursePublishSources,
} from './buildPublishedCourse'

export interface PublishedCoursePackageOptions {
  /** IIFE bundle exposing/bootstrapping the Course Player. */
  playerBundle: string
  lang?: string
}

export type CoursePackageDelivery = 'standalone-html' | 'web-package'

export interface CoursePackageExportResources {
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
}

export interface CoursePackagePreflightItem {
  severity: 'error' | 'warning' | 'info'
  code:
    | 'asset-bytes-missing'
    | 'component-bytes-missing'
    | 'component-hash-mismatch'
    | 'player-bundle-empty'
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

export interface BuildCoursePackagesResult {
  /** Relative archive paths only; no absolute machine paths. */
  manifest: string[]
  files: Record<string, Uint8Array>
  payload: PublishedCourseV2Payload
}

export const COURSE_PLAYER_CSS = `
:root{color-scheme:light;font-family:Inter,"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;background:#f8fafc;color:#172033}
*{box-sizing:border-box}
html,body,#course-root{width:100%;height:100%;margin:0}
body{overflow:hidden;background:#f8fafc}
.course-shell{width:100%;height:100%}
.course-stage{position:relative;width:100%;height:100%;min-width:0;min-height:0;overflow:auto}
.course-surface-host{position:relative;width:100%;min-height:100%}
.flow-surface-stack{position:relative;min-height:100%;isolation:isolate}
.flow-surface{box-sizing:border-box;max-width:var(--flow-reading-width,760px);margin:0 auto;padding:48px 32px;line-height:1.75}
.flow-scoped-layer-mount{position:absolute;inset:0 auto auto 0;width:1280px;height:720px;pointer-events:none}
.flow-scoped-layer-surface{margin:0!important;background:transparent!important;pointer-events:none}
.flow-scoped-layer-surface>.slide-layer-item{pointer-events:auto}
.flow-surface img,.flow-surface video{max-width:100%;height:auto}
.flow-surface table{width:100%;border-collapse:collapse}
.flow-surface th,.flow-surface td{padding:.5rem;border:1px solid #cbd5e1;text-align:left}
.flow-surface aside{padding:.75rem 1rem;border-left:4px solid #3b82f6;background:#eff6ff}
.flow-runtime-article{pointer-events:auto;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.flow-runtime-overlay{pointer-events:none}
.spatial-surface{position:relative;display:grid;min-width:100%;min-height:100%;place-items:center;overflow:hidden;outline:none;touch-action:none;background:#f8fafc}
.spatial-surface>svg:not(.spatial-minimap){display:block;max-width:100%;max-height:100%}
.spatial-controls{position:absolute;z-index:2;left:12px;top:12px;display:flex;max-width:calc(100% - 24px);gap:6px;overflow-x:auto;padding:6px;border:1px solid #cbd5e1;border-radius:10px;background:rgba(255,255,255,.94);box-shadow:0 4px 14px rgba(15,23,42,.12)}
.spatial-controls button{flex:none;padding:6px 9px;border:1px solid #94a3b8;border-radius:7px;background:#fff;color:#172033;cursor:pointer}
.spatial-controls button:focus-visible{outline:3px solid #60a5fa;outline-offset:1px}
.spatial-minimap{position:absolute;z-index:2;right:12px;bottom:12px;border:1px solid #94a3b8;border-radius:8px;background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(15,23,42,.14)}
.slide-surface{position:relative;margin:auto;overflow:hidden;transform-origin:top left;background:#fff}
.course-player-error{display:grid;width:100%;height:100%;place-items:center;padding:32px;color:#991b1b;background:#fef2f2;text-align:center}
`.trim()

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'video/webm': 'webm', 'font/woff': 'woff',
  'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/json': 'json', 'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf',
  'text/plain': 'txt',
}

function componentKey(packageId: string, version: string): string {
  return `${packageId}@${version}`
}

function findAssetEntry(
  project: CourseProjectDocument,
  assetId: string,
): readonly [string, AssetMeta] | undefined {
  const direct = project.assets[assetId]
  if (direct) return [assetId, direct]
  return Object.entries(project.assets).find(([, metadata]) => metadata.id === assetId)
}

function findComponentSource(
  components: Readonly<Record<string, ComponentPackageData>>,
  packageId: string,
  version: string,
): ComponentPackageData | undefined {
  return components[componentKey(packageId, version)]
    ?? components[packageId]
    ?? Object.values(components).find(({ manifest }) => (
      manifest.id === packageId && manifest.version === version
    ))
}

function summarize(items: readonly CoursePackagePreflightItem[]): CoursePackagePreflightReport['summary'] {
  const summary = { error: 0, warning: 0, info: 0, total: items.length, canExport: true }
  items.forEach(({ severity }) => { summary[severity] += 1 })
  summary.canExport = summary.error === 0
  return summary
}

export function collectCoursePackageExportPreflight(
  project: CourseProjectDocument,
  delivery: CoursePackageDelivery,
  resources: CoursePackageExportResources,
  playerBundle = '',
  now = new Date(),
): CoursePackagePreflightReport {
  const items: CoursePackagePreflightItem[] = []
  if (!playerBundle.trim()) {
    items.push({
      severity: 'error',
      code: 'player-bundle-empty',
      message: 'Player Runtime 为空，无法生成课程导出物。',
    })
  }

  for (const assetId of [...collectPublishedCourseAssetIds({ project, components: resources.components })].sort()) {
    const entry = findAssetEntry(project, assetId)
    if (!entry) continue
    const [recordKey, meta] = entry
    const bytes = resources.assetFiles[meta.id]
      ?? resources.assetFiles[recordKey]
    if (!bytes) {
      items.push({
        severity: 'error',
        code: 'asset-bytes-missing',
        message: `素材“${meta.filename}”只有工程元数据，没有可嵌入导出物的本地字节。`,
        path: ['assets', recordKey],
      })
    }
  }

  for (const key of [...collectPublishedCourseComponentKeys(project)].sort()) {
    const separator = key.lastIndexOf('@')
    const packageId = key.slice(0, separator)
    const version = key.slice(separator + 1)
    const metadataEntry = Object.entries(project.componentPackages).find(([, metadata]) => (
      metadata.packageId === packageId && metadata.version === version
    ))
    const recordKey = metadataEntry?.[0] ?? key
    const embedded = metadataEntry?.[1]
    const component = findComponentSource(resources.components, packageId, version)
    if (!component) {
      items.push({
        severity: 'error',
        code: 'component-bytes-missing',
        message: `组件包“${key}”没有可嵌入导出物的执行内容。`,
        path: ['componentPackages', recordKey],
      })
      continue
    }
    if (embedded) {
      const actualHash = component.contentSha256 ?? componentContentSha256(component.files)
      if (embedded.contentSha256 !== actualHash) {
        items.push({
          severity: 'error',
          code: 'component-hash-mismatch',
          message: `组件包“${key}”的工程锁定内容哈希与当前执行内容不一致。`,
          path: ['componentPackages', recordKey, 'contentSha256'],
        })
      }
    }
  }

  const sorted = [...items].sort((left, right) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[left.severity] - severityOrder[right.severity] ||
      compareStableStrings(left.code, right.code) ||
      compareStableStrings(left.message, right.message)
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeScript(value: string): string {
  return value
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '\\x3C!--')
    .replaceAll('https://', 'https:\\x2F\\x2F')
    .replaceAll('http://', 'http:\\x2F\\x2F')
}

function options(input: string | PublishedCoursePackageOptions): Required<PublishedCoursePackageOptions> {
  const normalized = typeof input === 'string'
    ? { playerBundle: input, lang: 'zh-CN' }
    : { playerBundle: input.playerBundle, lang: input.lang ?? 'zh-CN' }
  if (!normalized.playerBundle.trim()) throw new Error('Player Runtime 为空，无法生成课程导出物')
  return normalized
}

function safeSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '')
  return normalized || 'resource'
}

function extension(mimeType: string): string {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return EXTENSIONS[normalized] ?? 'bin'
}

function addFile(
  files: Record<string, Uint8Array>,
  path: string,
  bytes: Uint8Array,
): void {
  const parts = path.split('/')
  if (
    !path || path.startsWith('/') || path.includes('\\') || path.includes('\0') ||
    /^[A-Za-z]:/.test(path) || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`网页包包含不安全路径：${path}`)
  }
  if (Object.hasOwn(files, path)) throw new Error(`网页包文件路径重复：${path}`)
  files[path] = bytes
}

function serializedAssignment(payload: PublishedCourseV2Payload): string {
  const serialized = JSON.stringify(payload)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `window.__H5_COURSE_PAYLOAD__=${serialized};`
}

function packageIndex(payload: PublishedCourseV2Payload, lang: string): string {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src blob:">
  <title>${escapeHtml(payload.title)}</title>
  <link rel="stylesheet" href="./player/player.css">
</head>
<body>
  <div id="course-root" aria-label="${escapeHtml(payload.title)}"></div>
  <script defer src="./course-data.js"></script>
  <script defer src="./player/player.iife.js"></script>
</body>
</html>
`
}

export function buildPublishedCourseStandaloneHtml(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): string {
  const normalized = options(playerBundleOrOptions)
  const payload = buildPublishedCourseV2Payload(sources)
  return `<!doctype html>
<html lang="${escapeHtml(normalized.lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src data: blob:; worker-src blob:">
  <title>${escapeHtml(payload.title)}</title>
  <style>${COURSE_PLAYER_CSS}</style>
</head>
<body>
  <div id="course-root" aria-label="${escapeHtml(payload.title)}"></div>
  <script>${escapeScript(serializedAssignment(payload))}</script>
  <script>${escapeScript(normalized.playerBundle)}</script>
</body>
</html>
`
}

function buildPublishedCourseWebPackageBundle(
  sources: CoursePublishSources,
  normalized: Required<PublishedCoursePackageOptions>,
): { files: Record<string, Uint8Array>; payload: PublishedCourseV2Payload } {
  const files = Object.create(null) as Record<string, Uint8Array>
  const payload = buildPublishedCourseV2Payload(sources, {
    projectAssetUrl(assetId, meta, bytes) {
      const path = `assets/${String(Object.keys(files).filter((key) => key.startsWith('assets/')).length).padStart(3, '0')}-${safeSegment(assetId)}.${extension(meta.mimeType)}`
      addFile(files, path, bytes)
      return `./${path}`
    },
    componentAssetUrl(componentKey, assetKey, mimeType, bytes) {
      const directory = `component-assets/${safeSegment(componentKey)}`
      const prefix = `${directory}/`
      const path = `${prefix}${String(Object.keys(files).filter((key) => key.startsWith(prefix)).length).padStart(3, '0')}-${safeSegment(assetKey)}.${extension(mimeType)}`
      addFile(files, path, bytes)
      return `./${path}`
    },
  })
  addFile(files, 'course-data.js', strToU8(`${serializedAssignment(payload)}\n`))
  addFile(files, 'player/player.iife.js', strToU8(normalized.playerBundle))
  addFile(files, 'player/player.css', strToU8(COURSE_PLAYER_CSS))
  addFile(files, 'index.html', strToU8(packageIndex(payload, normalized.lang)))
  return { files, payload }
}

/** Builds a file://-compatible package without a Base64 round-trip for binary assets. */
export function buildPublishedCourseWebPackageFiles(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Record<string, Uint8Array> {
  const normalized = options(playerBundleOrOptions)
  return buildPublishedCourseWebPackageBundle(sources, normalized).files
}

export function buildPublishedCourseWebPackage(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Uint8Array {
  return zipSync(buildPublishedCourseWebPackageFiles(sources, playerBundleOrOptions), {
    level: 6,
    mtime: new Date('1980-01-01T00:00:00.000Z'),
  })
}

export function buildPublishedCourseWebPackageAsync(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Promise<Uint8Array> {
  const files = buildPublishedCourseWebPackageFiles(sources, playerBundleOrOptions)
  return new Promise((resolve, reject) => {
    zip(files, { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') }, (error, bytes) => {
      if (error) reject(error)
      else resolve(bytes)
    })
  })
}

function manifestFromFiles(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).sort(compareStableStrings)
}

/** Unified V2 export entry returning a relative-path file manifest. */
export function buildCoursePackages(
  sources: CoursePublishSources,
  delivery: CoursePackageDelivery,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): BuildCoursePackagesResult {
  const normalized = options(playerBundleOrOptions)
  if (delivery === 'standalone-html') {
    const payload = buildPublishedCourseV2Payload(sources)
    const html = buildPublishedCourseStandaloneHtml(sources, normalized)
    const files = { 'index.html': strToU8(html) }
    return {
      manifest: ['index.html'],
      files,
      payload,
    }
  }
  const bundle = buildPublishedCourseWebPackageBundle(sources, normalized)
  return {
    manifest: manifestFromFiles(bundle.files),
    files: bundle.files,
    payload: bundle.payload,
  }
}
