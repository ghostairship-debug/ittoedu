import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ComponentCompilationInput } from '../../../core/components/compilation/types'
import { buildPublishedCourseV3 } from '../../../core/publish/componentPlatform'
import { buildCompiledSingleHtml } from '../../../core/publish/componentPlatform/buildSingleHtml'
import { componentAssetDataUrl } from '../../../core/publish/componentPlatform/resourceUrl'
import { createResourceContentIndex } from '../../../shared/resourceContent'
import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { mapSrcsetUrls } from '../../../shared/html/responsiveImage'
import type { CompiledCoursePlayback } from '../../../core/publish/componentPlatform/compiledContract'
import { loadCompiledPlayerBundle } from '../loadCompiledPlayerBundle'
import {compileCoursePlayback} from '../../../core/publish/componentPlatform/compileCoursePlayback'
import {renderCompiledBuiltin} from './renderCompiledBuiltin'
import {beginDeliveryImageEncoding} from './encodeDeliveryImage'
import { zipSync, strToU8 } from 'fflate'
import type { SingleHtmlExportMode } from '../course/coursePackagePreflight'
import { prepareBundledFontEmbedding, resolveEmbeddedBundledFonts, bundledFontDataUrlCss, bundledFontRelativeUrlCss,
  bundledFontPackageFiles, bundledFontNoticeHtmlComment, bundledFontNoticeMarkdown, unavailableEmbeddedBundledFontFamilies } from '../bundledFontEmbedding'

export type ComponentCompilePort = (input: ComponentCompilationInput, signal?: AbortSignal, onProgress?: () => void) => ReturnType<import('../../../core/components/compilation/InMemoryComponentCompilation').InMemoryComponentCompilation['compile']>
type DeliveryImageDemands = import('../../../core/publish/componentPlatform').ComponentPublishOptions['imageDemands']

const fontDiagnostics = (payload: unknown, fonts: ReturnType<typeof resolveEmbeddedBundledFonts>) => unavailableEmbeddedBundledFontFamilies(payload, fonts)
  .map(family => ({ code: 'bundled-font-unavailable', severity: 'warning' as const, path: ['fonts', family],
    message: `内置字体 ${family} 的实际字节未能读取；内容继续交付，该字体将使用本机后备，离线排版可能不同。` }))

/** Export from the captured Session snapshot; rendering never reads the live author store. */
export async function buildComponentPublished(snapshot: DocumentSnapshot, compile: ComponentCompilePort, assetUrl?: import('../../../core/publish/componentPlatform').ComponentPublishOptions['assetUrl'], singleHtmlMode: SingleHtmlExportMode = 'offline-portable', signal?: AbortSignal, onProgress?: () => void,imageDelivery=false,imageDemands?: DeliveryImageDemands) {
  signal?.throwIfAborted()
  if (snapshot.model.kind !== 'course-v10') throw new Error('此导出入口只支持果铃作品工程')
  const model = snapshot.model
  const images = imageDelivery ? beginDeliveryImageEncoding(document, snapshot) : undefined
  let success = false
  try {
    const result = await buildPublishedCourseV3({ project: model.project, assetBytes: model.resources.assets, componentFiles: model.resources.components }, {
      compilation: { compile }, assetUrl, singleHtmlMode, signal, onProgress, imageDemands,
      ...(images ? { deliveryAsset: (asset, bytes, demand) => images.encode(asset, bytes, signal, demand) } : {}),
    })
    success = true
    return result
  } finally { images?.finish(success) }
}

export async function buildComponentHtml(snapshot: DocumentSnapshot, compile: ComponentCompilePort, mode: SingleHtmlExportMode = 'offline-portable', signal?: AbortSignal, onProgress?: () => void,imageDemands?: DeliveryImageDemands) {
  const result = await buildComponentPublished(snapshot, compile, undefined, mode, signal, onProgress,true,imageDemands)
  signal?.throwIfAborted()
  await prepareBundledFontEmbedding(result.payload)
  signal?.throwIfAborted()
  const fonts = resolveEmbeddedBundledFonts(result.payload)
  const compiled=await compileCoursePlayback(result.payload,{document,signal,renderBuiltin:(instance,key,project)=>renderCompiledBuiltin(instance,key,project,document)})
  const plainHtml = buildCompiledSingleHtml(compiled, loadCompiledPlayerBundle(), { fontFaceCssElementId: fonts.length ? 'course-fonts' : undefined })
  const html = fonts.length ? plainHtml
    .replace('</head>', `<style id="course-fonts">${bundledFontDataUrlCss(fonts)}</style>${bundledFontNoticeHtmlComment(fonts)}</head>`) : plainHtml
  const diagnostics = [...result.diagnostics,...compiled.diagnostics.map(issue=>({...issue,severity:'warning' as const,path:issue.instanceId?['instances',issue.instanceId]:['compilation']})), ...fontDiagnostics(result.payload, fonts)]
  return { html, payload: result.payload,compiled,
    diagnostics, warnings: diagnostics.map(value => value.message), offlinePrepared: result.offlineComplete && !diagnostics.some(value => value.code === 'bundled-font-unavailable')&&!compiled.diagnostics.length }
}

/** Save the same P0 into a package; actual resource bytes are separate ZIP entries. */
export async function buildComponentWebPackage(snapshot: DocumentSnapshot, compile: ComponentCompilePort, signal?: AbortSignal, onProgress?: () => void,imageDemands?: DeliveryImageDemands) {
  const files: Record<string, Uint8Array> = {}
  const content = createResourceContentIndex(), preparedAssets: Record<string, string> = {}, preparedContent: Record<string, string> = {}
  const addresses = new Map<string, string>()
  const writeAsset = (id: string, bytes: Uint8Array, mimeType = 'application/octet-stream', sourceName = '') => {
    const stored = content.add(bytes), mime = mimeType.toLowerCase().split(';', 1)[0]!, key = `${stored.sha256}:${mime}`
    let filename = addresses.get(key)
    if (!filename) {
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'video/mp4': 'mp4', 'video/webm': 'webm', 'text/css': 'css', 'text/javascript': 'js', 'application/javascript': 'js' } as Record<string, string>)[mime]
        ?? /\.([a-zA-Z0-9]+)$/.exec(sourceName)?.[1]?.toLowerCase() ?? 'bin'
      // MIME participates only in the transport address. Logical IDs still
      // share the same content bytes, without serving CSS/JS as the wrong type.
      filename = `assets/${stored.sha256}.${mime.replace(/[^a-z0-9]/g, '_')}.${extension}`
      files[filename] = stored.bytes; addresses.set(key, filename)
    }
    preparedAssets[id] = stored.sha256
    preparedContent[stored.sha256] ??= componentAssetDataUrl(stored.bytes).split(',')[1]!
    return filename
  }
  const result = await buildComponentPublished(snapshot, compile, (asset, bytes) => {
    signal?.throwIfAborted()
    return writeAsset(asset.id, bytes, asset.mimeType, asset.filename ?? asset.path)
  }, undefined, signal, onProgress,true,imageDemands)
  signal?.throwIfAborted()
  await prepareBundledFontEmbedding(result.payload)
  signal?.throwIfAborted()
  const fonts = resolveEmbeddedBundledFonts(result.payload)
  Object.assign(files, bundledFontPackageFiles(fonts, 'fonts'))
  if (fonts.length) files['THIRD_PARTY_NOTICES.md'] = strToU8(bundledFontNoticeMarkdown(fonts, 'fonts'))
  const compiled=await compileCoursePlayback(result.payload,{document,signal,renderBuiltin:(instance,key,project)=>renderCompiledBuiltin(instance,key,project,document)})
  externalizeCompiledMedia(compiled, (_url, mimeType, bytes) => {
    signal?.throwIfAborted()
    const digest = content.add(bytes).sha256
    let id = `delivery-${digest}`
    let suffix = 0
    while (compiled.course.assets[id]) id = `delivery-${digest}-${++suffix}`
    compiled.course.assets[id] = { id, mimeType, url: writeAsset(id, bytes, mimeType) }
    return `cw-delivery:${encodeURIComponent(id)}`
  })
  // Classic scripts work beside file:// documents, where fetch cannot read
  // package files. HTTP never loads this fallback. Each binary is encoded and
  // decoded once even when several logical IDs refer to it.
  const preparedAssetScriptUrl = Object.keys(preparedAssets).length ? './course-assets.js' : undefined
  if (preparedAssetScriptUrl) files['course-assets.js'] = strToU8(`(function(){var content=${JSON.stringify(preparedContent)},ids=${JSON.stringify(preparedAssets).replace(/</g, '\\u003c')},cache={},assets={};Object.keys(ids).forEach(function(id){Object.defineProperty(assets,id,{enumerable:true,get:function(){var hash=ids[id];return cache[hash]||(cache[hash]=Uint8Array.from(atob(content[hash]),function(character){return character.charCodeAt(0);}));}});});window.CoursewarePreparedAssetBytes=assets;})();`)
  // Opaque content documents cannot fetch host fonts on an ordinary static
  // server without CORS. Keep their existing portable face CSS in one cacheable
  // classic script, separate from the file:// asset fallback and main HTML.
  const preparedFontScriptUrl = fonts.length ? './course-fonts.js' : undefined
  if (preparedFontScriptUrl) files['course-fonts.js'] = strToU8(`window.CoursewarePreparedFontFaceCss=${JSON.stringify(bundledFontDataUrlCss(fonts)).replace(/</g, '\\u003c')};`)
  const html = buildCompiledSingleHtml(compiled, loadCompiledPlayerBundle(), { preparedAssetScriptUrl, preparedFontScriptUrl, fontFaceCssElementId: fonts.length ? 'course-fonts' : undefined })
  files['index.html'] = strToU8(fonts.length ? html
    .replace('</head>', `<style id="course-fonts">${bundledFontRelativeUrlCss(fonts, 'fonts')}</style></head>`) : html)
  const diagnostics = [...result.diagnostics,...compiled.diagnostics.map(issue=>({...issue,severity:'warning' as const,path:issue.instanceId?['instances',issue.instanceId]:['compilation']})), ...fontDiagnostics(result.payload, fonts)]
  return { bytes: zipSync(files), diagnostics, warnings: diagnostics.map(value => value.message), offlinePrepared: result.offlineComplete && !diagnostics.some(value => value.code === 'bundled-font-unavailable')&&!compiled.diagnostics.length }
}

/** Compiled passive markup has real URL consumers. Externalize those carriers,
 * while keeping authored script/data literals intact (they may inspect a data URI).
 * Runtime's existing delivery tokens resolve in the consuming iframe's realm. */
function externalizeCompiledMedia(artifact: CompiledCoursePlayback, register: (url: string, mimeType: string, bytes: Uint8Array) => string) {
  const urls = new Map<string, string>()
  const resource = (url: string): string | undefined => {
    if (urls.has(url)) return urls.get(url)
    const match = /^data:((?:image|audio|video|font)\/[^;,]+|application\/(?:font-woff|vnd\.ms-fontobject))(;[^,]*)?,([\s\S]*)$/i.exec(url)
    if (!match) return
    let bytes: Uint8Array
    try {
      bytes = /;base64(?:;|$)/i.test(match[2] ?? '') ? Uint8Array.from(atob(match[3]!), character => character.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(match[3]!))
    } catch { return undefined }
    const projected = register(url, match[1]!.toLowerCase(), bytes)
    urls.set(url, projected); return projected
  }
  const css = (source: string) => source.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi, (all, double, single, bare) => {
    const projected = resource(double ?? single ?? bare)
    return projected ? `url("${projected}")` : all
  })
  const escape = (value: string, quote: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&#39;' : '&quot;')
  const html = (source: string): string => {
    const edits: Array<{ start: number; end: number; text: string }> = []
    for (const token of scanHtmlSource(source).tokens) {
      if (token.kind === 'raw-text' && token.rawKind === 'style') {
        const original = source.slice(token.span.start, token.span.end), next = css(original)
        if (next !== original) edits.push({ ...token.span, text: next })
      }
      for (const attribute of token.attributes ?? []) {
        if (!attribute.valueSpan || attribute.decodedValue === undefined) continue
        const original = attribute.decodedValue
        const next = attribute.name === 'style' ? css(original) : attribute.name === 'srcdoc' ? html(original)
          : attribute.name === 'srcset' ? mapSrcsetUrls(original, resource)
          : ['src', 'poster', 'href', 'xlink:href', 'data'].includes(attribute.name) ? resource(original) ?? original : original
        if (next !== original) edits.push({ ...attribute.valueSpan, text: attribute.quote ? escape(next, attribute.quote) : `"${escape(next, '"')}"` })
      }
    }
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
    return source
  }
  artifact.html = html(artifact.html)
  for (const views of Object.values(artifact.staticViews)) for (const view of views) view.html = html(view.html)
  for (const [key, source] of Object.entries(artifact.sourceStyles)) artifact.sourceStyles[key] = css(source)
  for (const programs of Object.values(artifact.webPrograms)) for (const { program } of programs) {
    program.html = html(program.html); program.css = css(program.css)
    if (program.declarations) program.declarations = program.declarations.map(css)
    for (const data of [program.semanticData?.data, program.nativeData]) if (data) { data.html = html(data.html); if (data.css) data.css = css(data.css) }
    if (program.semanticData?.declarations) program.semanticData.declarations = program.semanticData.declarations.map(css)
  }
  for (const [key, source] of Object.entries(artifact.nativeSources ?? {})) artifact.nativeSources![key] = { ...source, css: css(source.css) }
}
