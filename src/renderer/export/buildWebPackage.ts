import { strToU8, zip, zipSync } from 'fflate'
import type {
  ComponentPackageData,
  ExportPayload,
} from '../../shared/componentTypes'
import type { ProjectDocument } from '../../shared/projectTypes'
import type { PublishedLessonPayload } from '../../shared/publishedLessonTypes'
import { componentPackageKey } from '../project/archivePath'
import {
  bundledFontNoticeMarkdown,
  bundledFontPackageFiles,
  bundledFontRelativeUrlCss,
  resolveEmbeddedBundledFonts,
  withBundledFontCss,
} from './bundledFontEmbedding'
import {
  buildPublishedLessonPayload,
  collectPublishedComponentKeys,
  collectPublishedProjectAssetIds,
  isPublishedLessonPayload,
} from './buildPublishedLesson'

export interface WebPackageOptions {
  playerBundle: string
  lang?: string
}

export interface WebPackageProjectSources {
  project: ProjectDocument
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
}

const PLAYER_STYLES = `
:root {
  color-scheme: dark;
  font-family: Inter, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
  background: #111318;
}

* {
  box-sizing: border-box;
}

html,
body,
#lesson-root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

body {
  background: #111318;
}

.lesson-shell {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 280px;
  min-height: 180px;
  flex-direction: column;
  background: #111318;
}

.lesson-stage {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.lesson-canvas-host {
  width: 100%;
  height: 100%;
}

.lesson-canvas-host canvas {
  display: block;
}

.lesson-player-error {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  padding: 32px;
  color: #fecaca;
  background: #1b1114;
  font: 16px/1.6 Inter, "Microsoft YaHei", sans-serif;
  text-align: center;
}

`.trim()

/** Archive directory of the embedded faces, and its path seen from the CSS. */
const PLAYER_FONT_DIRECTORY = 'player/fonts'
const PLAYER_FONT_URL_PREFIX = './fonts'

const EXTENSIONS_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/json': 'json',
  'text/plain': 'txt',
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function normalizeOptions(
  playerBundleOrOptions: string | WebPackageOptions,
): Required<WebPackageOptions> {
  if (typeof playerBundleOrOptions === 'string') {
    return { playerBundle: playerBundleOrOptions, lang: 'zh-CN' }
  }

  return {
    playerBundle: playerBundleOrOptions.playerBundle,
    lang: playerBundleOrOptions.lang ?? 'zh-CN',
  }
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop() ?? value
}

function extensionFor(mimeType: string, sourceName: string): string {
  const normalizedMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const knownExtension = EXTENSIONS_BY_MIME_TYPE[normalizedMimeType]
  if (knownExtension) return knownExtension

  const sourceExtension = basename(sourceName).match(/\.([A-Za-z0-9]{1,10})$/)?.[1]
  return sourceExtension?.toLowerCase() ?? 'bin'
}

function mimeTypeForPath(path: string): string {
  const extension = basename(path).match(/\.([A-Za-z0-9]{1,10})$/)?.[1]?.toLowerCase()
  if (!extension) return 'application/octet-stream'
  if (extension === 'jpeg') return 'image/jpeg'
  if (extension === 'm4a') return 'audio/mp4'
  return Object.entries(EXTENSIONS_BY_MIME_TYPE).find(
    ([, candidate]) => candidate === extension,
  )?.[0] ?? 'application/octet-stream'
}

function decodeBase64(value: string, description: string): Uint8Array {
  const normalized = value.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error(`${description} 的 Base64 数据无效`)
  }

  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
  const padding = padded.endsWith('==') ? 2 : padded.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((padded.length / 4) * 3 - padding)
  const chunkSize = 32_768
  let byteOffset = 0

  for (let offset = 0; offset < padded.length; offset += chunkSize) {
    const binary = atob(padded.slice(offset, offset + chunkSize))
    for (let index = 0; index < binary.length; index += 1) {
      bytes[byteOffset] = binary.charCodeAt(index)
      byteOffset += 1
    }
  }

  return bytes
}

function decodePercentEncoded(value: string, description: string): Uint8Array {
  const output: number[] = []
  const encoder = new TextEncoder()
  let cursor = 0

  while (cursor < value.length) {
    const percentIndex = value.indexOf('%', cursor)
    const literalEnd = percentIndex < 0 ? value.length : percentIndex
    if (literalEnd > cursor) {
      for (const byte of encoder.encode(value.slice(cursor, literalEnd))) {
        output.push(byte)
      }
    }
    if (percentIndex < 0) break

    const hex = value.slice(percentIndex + 1, percentIndex + 3)
    if (!/^[\da-f]{2}$/i.test(hex)) {
      throw new Error(`${description} 的百分号编码无效`)
    }
    output.push(Number.parseInt(hex, 16))
    cursor = percentIndex + 3
  }

  return new Uint8Array(output)
}

function dataUrlToBytes(dataUrl: string, description: string): Uint8Array {
  if (!dataUrl.startsWith('data:')) {
    throw new Error(`${description} 不是可打包的 Data URL`)
  }

  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) {
    throw new Error(`${description} 的 Data URL 格式无效`)
  }

  const metadata = dataUrl.slice(5, commaIndex)
  const encodedData = dataUrl.slice(commaIndex + 1)
  const isBase64 = metadata
    .split(';')
    .some((part) => part.trim().toLowerCase() === 'base64')

  return isBase64
    ? decodeBase64(encodedData, description)
    : decodePercentEncoded(encodedData, description)
}

function assertSafePackagePath(archivePath: string): void {
  const segments = archivePath.split('/')
  if (
    archivePath.length === 0 ||
    archivePath.length > 1_024 ||
    archivePath.startsWith('/') ||
    archivePath.includes('\\') ||
    archivePath.includes('\0') ||
    /^[A-Za-z]:/.test(archivePath) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`网页包包含不安全路径：${archivePath}`)
  }
}

function addFile(
  files: Record<string, Uint8Array>,
  archivePath: string,
  bytes: Uint8Array,
): void {
  assertSafePackagePath(archivePath)
  if (Object.prototype.hasOwnProperty.call(files, archivePath)) {
    throw new Error(`网页包文件路径重复：${archivePath}`)
  }
  files[archivePath] = bytes
}

function paddedIndex(index: number): string {
  return String(index).padStart(3, '0')
}

function buildIndexHtml(payload: PublishedLessonPayload, lang: string): string {
  return `<!doctype html>
<html lang="${escapeHtmlText(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src blob:">
  <title>${escapeHtmlText(payload.title)}</title>
  <link rel="stylesheet" href="./player/player.css">
</head>
<body>
  <div id="lesson-root" aria-label="${escapeHtmlText(payload.title)}"></div>
  <script defer src="./course-data.js"></script>
  <script defer src="./player/player.iife.js"></script>
</body>
</html>
`
}

function finishWebPackageFiles(
  files: Record<string, Uint8Array>,
  packagedPayload: PublishedLessonPayload,
  playerBundle: string,
  lang: string,
): Record<string, Uint8Array> {
  const serialized = JSON.stringify(packagedPayload)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  const courseData = `window.__H5_LESSON_PAYLOAD__=${serialized};\n`

  // Only the bundled families this lesson declares, written as sibling files
  // next to the stylesheet that references them. `font-src 'self' data:` is
  // already in the package CSP.
  const fonts = resolveEmbeddedBundledFonts(packagedPayload)
  for (const [path, bytes] of Object.entries(
    bundledFontPackageFiles(fonts, PLAYER_FONT_DIRECTORY),
  )) {
    addFile(files, path, bytes)
  }

  // Keep one canonical payload. A JS data file works both over HTTP and when
  // teachers double-click index.html via file://, where fetch(course.json) is
  // commonly blocked by browser origin rules.
  addFile(files, 'course-data.js', strToU8(courseData))
  addFile(files, 'player/player.iife.js', strToU8(playerBundle))
  addFile(
    files,
    'player/player.css',
    strToU8(withBundledFontCss(
      PLAYER_STYLES,
      bundledFontRelativeUrlCss(fonts, PLAYER_FONT_URL_PREFIX),
    )),
  )
  addFile(files, 'index.html', strToU8(buildIndexHtml(packagedPayload, lang)))

  // OFL 1.1 only allows shipping the bytes together with their notices.
  const notices = bundledFontNoticeMarkdown(fonts, PLAYER_FONT_DIRECTORY)
  if (notices !== '') addFile(files, 'THIRD_PARTY_NOTICES.md', strToU8(notices))
  return files
}

export function buildWebPackageFiles(
  payload: ExportPayload | PublishedLessonPayload,
  playerBundle: string,
): Record<string, Uint8Array>
export function buildWebPackageFiles(
  payload: ExportPayload | PublishedLessonPayload,
  options: WebPackageOptions,
): Record<string, Uint8Array>
export function buildWebPackageFiles(
  payload: ExportPayload | PublishedLessonPayload,
  playerBundleOrOptions: string | WebPackageOptions,
): Record<string, Uint8Array> {
  const { playerBundle, lang } = normalizeOptions(playerBundleOrOptions)
  if (!playerBundle.trim()) {
    throw new Error('Player Runtime 为空，无法生成网页包')
  }
  const files = Object.create(null) as Record<string, Uint8Array>
  const packagedPayload = cloneJson(
    isPublishedLessonPayload(payload)
      ? payload
      : buildPublishedLessonPayload(payload),
  )

  let assetIndex = 0
  for (const [assetId, asset] of Object.entries(packagedPayload.assets)) {
    const prefix = paddedIndex(assetIndex)
    const filename = `${prefix}.${extensionFor(asset.mimeType, assetId)}`
    const archivePath = `assets/${filename}`
    addFile(
      files,
      archivePath,
      dataUrlToBytes(asset.url, `工程素材“${assetId}”`),
    )
    packagedPayload.assets[assetId] = {
      mimeType: asset.mimeType,
      url: `./${archivePath}`,
    }
    assetIndex += 1
  }

  let componentIndex = 0
  for (const [componentKey, component] of Object.entries(packagedPayload.components)) {
    const directory = `component-assets/${paddedIndex(componentIndex)}`

    let componentAssetIndex = 0
    for (const [assetKey, asset] of Object.entries(component.assets)) {
      const prefix = paddedIndex(componentAssetIndex)
      const filename = `${prefix}.${extensionFor(asset.mimeType, assetKey)}`
      const archivePath = `${directory}/${filename}`
      addFile(
        files,
        archivePath,
        dataUrlToBytes(
          asset.url,
          `组件“${component.name}”的素材“${assetKey}”`,
        ),
      )
      component.assets[assetKey] = {
        mimeType: asset.mimeType,
        url: `./${archivePath}`,
      }
      componentAssetIndex += 1
    }
    packagedPayload.components[componentKey] = component
    componentIndex += 1
  }

  return finishWebPackageFiles(files, packagedPayload, playerBundle, lang)
}

function findSourceComponent(
  components: Readonly<Record<string, ComponentPackageData>>,
  recordKey: string,
  packageId: string,
  version: string,
): ComponentPackageData | undefined {
  return (
    components[recordKey] ??
    components[componentPackageKey(packageId, version)] ??
    components[packageId] ??
    Object.values(components).find(
      ({ manifest }) => manifest.id === packageId && manifest.version === version,
    )
  )
}

function findProjectAssetEntry(
  project: ProjectDocument,
  assetId: string,
): readonly [string, ProjectDocument['assets'][string]] | undefined {
  const direct = project.assets[assetId]
  if (direct) return [assetId, direct]
  return Object.entries(project.assets).find(([, meta]) => meta.id === assetId)
}

/** Builds package files directly from editor bytes, without a Base64 round-trip. */
export function buildWebPackageFilesFromProject(
  sources: WebPackageProjectSources,
  playerBundleOrOptions: string | WebPackageOptions,
): Record<string, Uint8Array> {
  const { playerBundle, lang } = normalizeOptions(playerBundleOrOptions)
  if (!playerBundle.trim()) {
    throw new Error('Player Runtime 为空，无法生成网页包')
  }
  const files = Object.create(null) as Record<string, Uint8Array>
  const transientPayload: ExportPayload = {
    project: cloneJson(sources.project),
    assets: Object.create(null) as ExportPayload['assets'],
    components: Object.create(null) as ExportPayload['components'],
  }

  for (const usedKey of collectPublishedComponentKeys(transientPayload)) {
    const separator = usedKey.lastIndexOf('@')
    const packageId = usedKey.slice(0, separator)
    const version = usedKey.slice(separator + 1)
    const projectEntry = Object.entries(
      sources.project.componentPackages,
    ).find(([, meta]) =>
      meta.packageId === packageId && meta.version === version,
    )
    const recordKey = projectEntry?.[0] ?? usedKey
    const meta = projectEntry?.[1]
    const component = findSourceComponent(
      sources.components,
      recordKey,
      packageId,
      version,
    )
    const componentName = meta?.name ?? usedKey
    if (!component) throw new Error(`组件“${componentName}”缺少包内容，无法导出`)
    if (
      component.manifest.id !== packageId ||
      component.manifest.version !== version
    ) {
      throw new Error(`组件“${componentName}”的 ID 或版本与工程记录不一致`)
    }
    const packagedAssets: ExportPayload['components'][string]['assets'] = {}
    for (const [assetKey, assetPath] of Object.entries(component.manifest.assets)) {
      const bytes = component.files[assetPath]
      if (!bytes) {
        throw new Error(`组件“${componentName}”缺少素材“${assetPath}”`)
      }
      const mimeType = mimeTypeForPath(assetPath)
      packagedAssets[assetKey] = {
        mimeType,
        dataUrl: `data:${mimeType};base64,`,
      }
    }
    transientPayload.components[usedKey] = {
      manifest: cloneJson(component.manifest),
      runtimeSource: component.runtimeSource,
      assets: packagedAssets,
    }
  }

  const usedProjectAssets = collectPublishedProjectAssetIds(transientPayload)
  for (const assetId of usedProjectAssets) {
    const entry = findProjectAssetEntry(sources.project, assetId)
    if (!entry) throw new Error(`发布内容引用的工程素材“${assetId}”不存在`)
    const [recordKey, meta] = entry
    const bytes =
      sources.assetFiles[assetId] ??
      sources.assetFiles[recordKey] ??
      sources.assetFiles[meta.id]
    if (!bytes) throw new Error(`素材“${meta.filename}”缺少二进制数据，无法导出`)
    if (bytes.byteLength !== meta.byteLength) {
      throw new Error(`素材“${meta.filename}”的字节数与工程记录不一致`)
    }
    transientPayload.assets[assetId] = {
      mimeType: meta.mimeType,
      dataUrl: `data:${meta.mimeType};base64,`,
    }
  }

  const packagedPayload = buildPublishedLessonPayload(transientPayload)
  let assetIndex = 0
  for (const [assetId, asset] of Object.entries(packagedPayload.assets)) {
    const entry = findProjectAssetEntry(sources.project, assetId)
    const meta = entry?.[1]
    const bytes = entry
      ? sources.assetFiles[assetId] ??
        sources.assetFiles[entry[0]] ??
        sources.assetFiles[entry[1].id]
      : undefined
    if (!meta || !bytes) {
      throw new Error(`素材“${assetId}”缺少二进制数据，无法导出`)
    }
    const prefix = paddedIndex(assetIndex)
    const archivePath = `assets/${prefix}.${extensionFor(asset.mimeType, meta.filename)}`
    addFile(files, archivePath, bytes)
    packagedPayload.assets[assetId] = {
      mimeType: asset.mimeType,
      url: `./${archivePath}`,
    }
    assetIndex += 1
  }

  let componentIndex = 0
  for (const component of Object.values(packagedPayload.components)) {
    const source = Object.values(sources.components).find(
      (candidate) =>
        candidate.manifest.id === component.id &&
        candidate.manifest.version === component.version,
    )
    if (!source) {
      throw new Error(`组件“${component.name}”缺少包内容，无法导出`)
    }
    let componentAssetIndex = 0
    for (const [assetKey, asset] of Object.entries(component.assets)) {
      const sourcePath = source.manifest.assets[assetKey]
      const bytes = sourcePath ? source.files[sourcePath] : undefined
      if (!sourcePath || !bytes) {
        throw new Error(`组件“${component.name}”缺少素材“${assetKey}”`)
      }
      const prefix = paddedIndex(componentAssetIndex)
      const archivePath =
        `component-assets/${paddedIndex(componentIndex)}/${prefix}.` +
        extensionFor(asset.mimeType, sourcePath)
      addFile(files, archivePath, bytes)
      component.assets[assetKey] = {
        mimeType: asset.mimeType,
        url: `./${archivePath}`,
      }
      componentAssetIndex += 1
    }
    componentIndex += 1
  }
  return finishWebPackageFiles(files, packagedPayload, playerBundle, lang)
}

export function buildWebPackage(
  payload: ExportPayload | PublishedLessonPayload,
  playerBundle: string,
): Uint8Array
export function buildWebPackage(
  payload: ExportPayload | PublishedLessonPayload,
  options: WebPackageOptions,
): Uint8Array
export function buildWebPackage(
  payload: ExportPayload | PublishedLessonPayload,
  playerBundleOrOptions: string | WebPackageOptions,
): Uint8Array {
  return zipSync(buildWebPackageFiles(payload, playerBundleOrOptions as WebPackageOptions), {
    level: 6,
  })
}

export function buildWebPackageAsync(
  payload: ExportPayload | PublishedLessonPayload,
  playerBundle: string,
): Promise<Uint8Array>
export function buildWebPackageAsync(
  payload: ExportPayload | PublishedLessonPayload,
  options: WebPackageOptions,
): Promise<Uint8Array>
export function buildWebPackageAsync(
  payload: ExportPayload | PublishedLessonPayload,
  playerBundleOrOptions: string | WebPackageOptions,
): Promise<Uint8Array> {
  const files = buildWebPackageFiles(
    payload,
    playerBundleOrOptions as WebPackageOptions,
  )
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, bytes) => {
      if (error) reject(error)
      else resolve(bytes)
    })
  })
}

export function buildWebPackageFromProjectAsync(
  sources: WebPackageProjectSources,
  playerBundleOrOptions: string | WebPackageOptions,
): Promise<Uint8Array> {
  const files = buildWebPackageFilesFromProject(sources, playerBundleOrOptions)
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, bytes) => {
      if (error) reject(error)
      else resolve(bytes)
    })
  })
}
