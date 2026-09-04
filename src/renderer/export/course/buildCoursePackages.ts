import { strToU8, zip, zipSync } from 'fflate'
import type { PublishedCourseV2Payload } from '../../../shared/publishedCourseTypes'
import { createTimezoneStableZipMtime } from '../../../shared/archiveTimestamp'
import { compareStableStrings } from '../../../shared/stableOrder'
import {
  bundledFontDataUrlCss,
  bundledFontNoticeHtmlComment,
  bundledFontNoticeMarkdown,
  bundledFontPackageFiles,
  bundledFontRelativeUrlCss,
  resolveEmbeddedBundledFonts,
  withBundledFontCss,
} from '../bundledFontEmbedding'
import {
  buildPublishedCourseV2Payload,
  type CoursePublishSources,
} from './buildPublishedCourse'
import {
  assertCoursePackagePreflightCanExport,
  collectCoursePackageExportPreflight,
  type CoursePackageDelivery,
  type SingleHtmlExportMode,
} from './coursePackagePreflight'
import {
  exactConnectOrigin,
  exactHttpsOrigin,
} from './coursePackageScriptAnalysis'

export interface PublishedCoursePackageOptions {
  /** IIFE bundle exposing/bootstrapping the Course Player. */
  playerBundle: string
  lang?: string
  /** Defaults to the existing fully embedded, offline-portable output. */
  singleHtmlMode?: SingleHtmlExportMode
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
.flow-runtime-article{pointer-events:auto;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:transparent}
.flow-runtime-layer-plane,.flow-runtime-overlay{pointer-events:none}
.spatial-surface{position:relative;display:grid;min-width:100%;min-height:100%;place-items:center;overflow:hidden;outline:none;touch-action:none;background:#f8fafc}
.spatial-surface>svg:not(.spatial-minimap){display:block;max-width:100%;max-height:100%}
.spatial-controls{position:absolute;z-index:2;left:12px;top:12px;display:flex;max-width:calc(100% - 24px);gap:6px;overflow-x:auto;padding:6px;border:1px solid #cbd5e1;border-radius:10px;background:rgba(255,255,255,.94);box-shadow:0 4px 14px rgba(15,23,42,.12)}
.spatial-controls button{flex:none;padding:6px 9px;border:1px solid #94a3b8;border-radius:7px;background:#fff;color:#172033;cursor:pointer}
.spatial-controls button:focus-visible{outline:3px solid #60a5fa;outline-offset:1px}
.spatial-minimap{position:absolute;z-index:2;right:12px;bottom:12px;border:1px solid #94a3b8;border-radius:8px;background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(15,23,42,.14)}
.slide-surface{position:relative;margin:auto;overflow:hidden;transform-origin:top left;background:#fff}
.course-player-error{display:grid;width:100%;height:100%;place-items:center;padding:32px;color:#991b1b;background:#fef2f2;text-align:center}
`.trim()

/** Archive directory of the embedded faces, and its path seen from the CSS. */
const PLAYER_FONT_DIRECTORY = 'player/fonts'
const PLAYER_FONT_URL_PREFIX = './fonts'

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'video/webm': 'webm', 'font/woff': 'woff',
  'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/json': 'json', 'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf',
  'text/plain': 'txt',
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

function normalizeOptions(
  input: string | PublishedCoursePackageOptions,
): Required<PublishedCoursePackageOptions> {
  return typeof input === 'string'
    ? { playerBundle: input, lang: 'zh-CN', singleHtmlMode: 'offline-portable' as const }
    : {
      playerBundle: input.playerBundle,
      lang: input.lang ?? 'zh-CN',
      singleHtmlMode: input.singleHtmlMode ?? 'offline-portable',
    }
}

function buildStandalonePayload(
  sources: CoursePublishSources,
  mode: SingleHtmlExportMode,
): PublishedCourseV2Payload {
  if (mode === 'online-lightweight') {
    return buildPublishedCourseV2Payload(sources, {
      projectAssetUrl(_assetId, meta) {
        return meta.remote?.url
      },
    })
  }
  return buildPublishedCourseV2Payload(sources)
}

function assertPackagePreflight(
  sources: CoursePublishSources,
  delivery: CoursePackageDelivery,
  normalized: Required<PublishedCoursePackageOptions>,
): void {
  const report = collectCoursePackageExportPreflight(
    sources.project,
    delivery,
    {
      assetFiles: sources.assetFiles,
      components: sources.components,
    },
    normalized.playerBundle,
    new Date(),
    delivery === 'standalone-html'
      ? { singleHtmlMode: normalized.singleHtmlMode }
      : {},
  )
  assertCoursePackagePreflightCanExport(report)
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

const OFFLINE_STANDALONE_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src data: blob:; worker-src blob:"

function cspSources(
  fixed: readonly string[],
  origins: ReadonlySet<string>,
): string {
  return [...fixed, ...[...origins].sort(compareStableStrings)].join(' ')
}

function onlineStandaloneCsp(
  sources: CoursePublishSources,
  payload: PublishedCourseV2Payload,
): string {
  const imageOrigins = new Set<string>()
  const mediaOrigins = new Set<string>()
  const fontOrigins = new Set<string>()
  const connectOrigins = new Set(
    (sources.project.network?.connectOrigins ?? [])
      .map(exactConnectOrigin)
      .filter((origin): origin is string => origin !== null),
  )

  for (const [assetId, asset] of Object.entries(payload.assets)) {
    const origin = exactHttpsOrigin(asset.url)
    if (!origin) continue
    const metadata = sources.project.assets[assetId]
      ?? Object.values(sources.project.assets).find((candidate) => candidate.id === assetId)
    const mimeType = asset.mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (
      mimeType.startsWith('font/')
      || mimeType === 'application/font-woff'
      || mimeType === 'application/vnd.ms-fontobject'
    ) {
      fontOrigins.add(origin)
    }
    if (mimeType.startsWith('image/') || metadata?.kind === 'image') {
      imageOrigins.add(origin)
    }
    if (
      mimeType.startsWith('audio/')
      || mimeType.startsWith('video/')
      || metadata?.kind === 'audio'
      || metadata?.kind === 'video'
    ) {
      mediaOrigins.add(origin)
    }
  }

  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'unsafe-inline'",
    `img-src ${cspSources(['data:', 'blob:'], imageOrigins)}`,
    `media-src ${cspSources(['data:', 'blob:'], mediaOrigins)}`,
    `font-src ${cspSources(['data:'], fontOrigins)}`,
    `connect-src ${cspSources(['data:', 'blob:'], connectOrigins)}`,
    'worker-src blob:',
  ].join('; ')
}

function packageIndex(
  payload: PublishedCourseV2Payload,
  lang: string,
  connectOrigins: readonly string[],
): string {
  const connectSource = cspSources(["'self'"], new Set(connectOrigins))
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src ${connectSource}; worker-src blob:">
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

function emitPublishedCourseStandaloneHtml(
  sources: CoursePublishSources,
  payload: PublishedCourseV2Payload,
  normalized: Required<PublishedCoursePackageOptions>,
): string {
  const contentSecurityPolicy = normalized.singleHtmlMode === 'online-lightweight'
    ? onlineStandaloneCsp(sources, payload)
    : OFFLINE_STANDALONE_CSP
  // Only the bundled families this course declares, carried as `data:` URIs
  // because a single file has no sibling to point at. Both single-HTML modes
  // already allow `font-src data:`.
  const fonts = resolveEmbeddedBundledFonts(payload)
  return `<!doctype html>
<html lang="${escapeHtml(normalized.lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <title>${escapeHtml(payload.title)}</title>
  <style>${withBundledFontCss(COURSE_PLAYER_CSS, bundledFontDataUrlCss(fonts))}</style>${bundledFontNoticeHtmlComment(fonts)}
</head>
<body>
  <div id="course-root" aria-label="${escapeHtml(payload.title)}"></div>
  <script>${escapeScript(serializedAssignment(payload))}</script>
  <script>${escapeScript(normalized.playerBundle)}</script>
</body>
</html>
`
}

function buildStandaloneEmission(
  sources: CoursePublishSources,
  normalized: Required<PublishedCoursePackageOptions>,
): { html: string; payload: PublishedCourseV2Payload } {
  assertPackagePreflight(sources, 'standalone-html', normalized)
  const payload = buildStandalonePayload(sources, normalized.singleHtmlMode)
  return {
    html: emitPublishedCourseStandaloneHtml(sources, payload, normalized),
    payload,
  }
}

export function buildPublishedCourseStandaloneHtml(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): string {
  return buildStandaloneEmission(
    sources,
    normalizeOptions(playerBundleOrOptions),
  ).html
}

interface PublishedCourseWebPackageEmission {
  files: Record<string, Uint8Array>
  payload: PublishedCourseV2Payload
}

function buildPublishedCourseWebPayload(
  sources: CoursePublishSources,
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
  return { files, payload }
}

function emitPublishedCourseWebPackageFiles(
  emission: PublishedCourseWebPackageEmission,
  normalized: Required<PublishedCoursePackageOptions>,
  sources: CoursePublishSources,
): PublishedCourseWebPackageEmission {
  const { files, payload } = emission
  // Only the bundled families this course declares, written as sibling files
  // next to the stylesheet that references them. `font-src 'self' data:` is
  // already in the package CSP.
  const fonts = resolveEmbeddedBundledFonts(payload)
  for (const [path, bytes] of Object.entries(
    bundledFontPackageFiles(fonts, PLAYER_FONT_DIRECTORY),
  )) {
    addFile(files, path, bytes)
  }
  addFile(files, 'course-data.js', strToU8(`${serializedAssignment(payload)}\n`))
  addFile(files, 'player/player.iife.js', strToU8(normalized.playerBundle))
  addFile(
    files,
    'player/player.css',
    strToU8(withBundledFontCss(
      COURSE_PLAYER_CSS,
      bundledFontRelativeUrlCss(fonts, PLAYER_FONT_URL_PREFIX),
    )),
  )
  const connectOrigins = (sources.project.network?.connectOrigins ?? [])
    .map(exactConnectOrigin)
    .filter((origin): origin is string => origin !== null)
    .sort(compareStableStrings)
  addFile(
    files,
    'index.html',
    strToU8(packageIndex(payload, normalized.lang, connectOrigins)),
  )
  // OFL 1.1 only allows shipping the bytes together with their notices.
  const notices = bundledFontNoticeMarkdown(fonts, PLAYER_FONT_DIRECTORY)
  if (notices !== '') addFile(files, 'THIRD_PARTY_NOTICES.md', strToU8(notices))
  return { files, payload }
}

function buildWebPackageEmission(
  sources: CoursePublishSources,
  normalized: Required<PublishedCoursePackageOptions>,
): PublishedCourseWebPackageEmission {
  assertPackagePreflight(sources, 'web-package', normalized)
  return emitPublishedCourseWebPackageFiles(
    buildPublishedCourseWebPayload(sources),
    normalized,
    sources,
  )
}

const WEB_PACKAGE_ZIP_OPTIONS = {
  level: 6,
  mtime: createTimezoneStableZipMtime('1980-01-01T00:00:00.000Z'),
} as const

function emitPublishedCourseWebPackageZip(
  files: Record<string, Uint8Array>,
): Uint8Array {
  return zipSync(files, WEB_PACKAGE_ZIP_OPTIONS)
}

function emitPublishedCourseWebPackageZipAsync(
  files: Record<string, Uint8Array>,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, WEB_PACKAGE_ZIP_OPTIONS, (error, bytes) => {
      if (error) reject(error)
      else resolve(bytes)
    })
  })
}

/** Builds a file://-compatible package without a Base64 round-trip for binary assets. */
export function buildPublishedCourseWebPackageFiles(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Record<string, Uint8Array> {
  return buildWebPackageEmission(
    sources,
    normalizeOptions(playerBundleOrOptions),
  ).files
}

export function buildPublishedCourseWebPackage(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Uint8Array {
  const emission = buildWebPackageEmission(
    sources,
    normalizeOptions(playerBundleOrOptions),
  )
  return emitPublishedCourseWebPackageZip(emission.files)
}

export function buildPublishedCourseWebPackageAsync(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Promise<Uint8Array> {
  const emission = buildWebPackageEmission(
    sources,
    normalizeOptions(playerBundleOrOptions),
  )
  return emitPublishedCourseWebPackageZipAsync(emission.files)
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
  const normalized = normalizeOptions(playerBundleOrOptions)
  if (delivery === 'standalone-html') {
    const emission = buildStandaloneEmission(sources, normalized)
    const files = { 'index.html': strToU8(emission.html) }
    return {
      manifest: ['index.html'],
      files,
      payload: emission.payload,
    }
  }
  const bundle = buildWebPackageEmission(sources, normalized)
  return {
    manifest: manifestFromFiles(bundle.files),
    files: bundle.files,
    payload: bundle.payload,
  }
}
