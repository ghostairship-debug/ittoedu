import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ComponentCompilationInput } from '../../../core/components/compilation/types'
import { buildPublishedCourseV3 } from '../../../core/publish/componentPlatform'
import { buildCompiledSingleHtml } from '../../../core/publish/componentPlatform/buildSingleHtml'
import { componentAssetDataUrl } from '../../../core/publish/componentPlatform/resourceUrl'
import { loadCompiledPlayerBundle } from '../loadCompiledPlayerBundle'
import {compileCoursePlayback} from '../../../core/publish/componentPlatform/compileCoursePlayback'
import {renderCompiledBuiltin} from './renderCompiledBuiltin'
import {beginDeliveryImageEncoding} from './encodeDeliveryImage'
import { zipSync, strToU8 } from 'fflate'
import type { SingleHtmlExportMode } from '../course/coursePackagePreflight'
import { prepareBundledFontEmbedding, resolveEmbeddedBundledFonts, bundledFontDataUrlCss, bundledFontRelativeUrlCss,
  bundledFontPackageFiles, bundledFontNoticeHtmlComment, bundledFontNoticeMarkdown, unavailableEmbeddedBundledFontFamilies } from '../bundledFontEmbedding'

export type ComponentCompilePort = (input: ComponentCompilationInput, signal?: AbortSignal, onProgress?: () => void) => ReturnType<import('../../../core/components/compilation/InMemoryComponentCompilation').InMemoryComponentCompilation['compile']>

const fontDiagnostics = (payload: unknown, fonts: ReturnType<typeof resolveEmbeddedBundledFonts>) => unavailableEmbeddedBundledFontFamilies(payload, fonts)
  .map(family => ({ code: 'bundled-font-unavailable', severity: 'warning' as const, path: ['fonts', family],
    message: `内置字体 ${family} 的实际字节未能读取；内容继续交付，该字体将使用本机后备，离线排版可能不同。` }))

/** Export from the captured Session snapshot; rendering never reads the live author store. */
export async function buildComponentPublished(snapshot: DocumentSnapshot, compile: ComponentCompilePort, assetUrl?: import('../../../core/publish/componentPlatform').ComponentPublishOptions['assetUrl'], singleHtmlMode: SingleHtmlExportMode = 'offline-portable', signal?: AbortSignal, onProgress?: () => void,imageDelivery=false) {
  signal?.throwIfAborted()
  if (snapshot.model.kind !== 'course-v10') throw new Error('此导出入口只支持果铃作品工程')
  const model = snapshot.model
  const images = imageDelivery ? beginDeliveryImageEncoding(document, snapshot) : undefined
  let success = false
  try {
    const result = await buildPublishedCourseV3({ project: model.project, assetBytes: model.resources.assets, componentFiles: model.resources.components }, {
      compilation: { compile }, assetUrl, singleHtmlMode, signal, onProgress,
      ...(images ? { deliveryAsset: (asset, bytes) => images.encode(asset, bytes, signal) } : {}),
    })
    success = true
    return result
  } finally { images?.finish(success) }
}

export async function buildComponentHtml(snapshot: DocumentSnapshot, compile: ComponentCompilePort, mode: SingleHtmlExportMode = 'offline-portable', signal?: AbortSignal, onProgress?: () => void) {
  const result = await buildComponentPublished(snapshot, compile, undefined, mode, signal, onProgress,true)
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
export async function buildComponentWebPackage(snapshot: DocumentSnapshot, compile: ComponentCompilePort, signal?: AbortSignal, onProgress?: () => void) {
  const files: Record<string, Uint8Array> = {}
  const preparedAssets: Record<string, string> = {}
  const result = await buildComponentPublished(snapshot, compile, (asset, bytes) => {
    signal?.throwIfAborted()
    const extension = /\.([a-zA-Z0-9]+)$/.exec(asset.filename ?? asset.path)?.[1]?.toLowerCase() ?? 'bin'
    const filename = `assets/${encodeURIComponent(asset.id)}.${extension}`
    files[filename] = bytes
    preparedAssets[asset.id] = componentAssetDataUrl(bytes,asset.mimeType).split(',')[1]!
    return filename
  }, undefined, signal, onProgress,true)
  signal?.throwIfAborted()
  await prepareBundledFontEmbedding(result.payload)
  signal?.throwIfAborted()
  const fonts = resolveEmbeddedBundledFonts(result.payload)
  Object.assign(files, bundledFontPackageFiles(fonts, 'fonts'))
  if (fonts.length) files['THIRD_PARTY_NOTICES.md'] = strToU8(bundledFontNoticeMarkdown(fonts, 'fonts'))
  // A classic script can load beside a file:// document, where fetch cannot read
  // package files. The player consumes these same captured bytes through its
  // existing resource preparation; binary entries remain usable by web hosts.
  const preparedAssetScriptUrl = Object.keys(preparedAssets).length ? './course-assets.js' : undefined
  if (preparedAssetScriptUrl) files['course-assets.js'] = strToU8(`window.CoursewarePreparedAssetBytes=Object.fromEntries(Object.entries(${JSON.stringify(preparedAssets).replace(/</g, '\\u003c')}).map(([id,encoded])=>[id,Uint8Array.from(atob(encoded),character=>character.charCodeAt(0))]));`)
  const compiled=await compileCoursePlayback(result.payload,{document,signal,renderBuiltin:(instance,key,project)=>renderCompiledBuiltin(instance,key,project,document)})
  const html = buildCompiledSingleHtml(compiled, loadCompiledPlayerBundle(), { preparedAssetScriptUrl, fontFaceCssElementId: fonts.length ? 'course-fonts' : undefined })
  files['index.html'] = strToU8(fonts.length ? html
    .replace('</head>', `<style>${bundledFontRelativeUrlCss(fonts, 'fonts')}</style><style id="course-fonts" media="not all">${bundledFontDataUrlCss(fonts)}</style></head>`) : html)
  const diagnostics = [...result.diagnostics,...compiled.diagnostics.map(issue=>({...issue,severity:'warning' as const,path:issue.instanceId?['instances',issue.instanceId]:['compilation']})), ...fontDiagnostics(result.payload, fonts)]
  return { bytes: zipSync(files), diagnostics, warnings: diagnostics.map(value => value.message), offlinePrepared: result.offlineComplete && !diagnostics.some(value => value.code === 'bundled-font-unavailable')&&!compiled.diagnostics.length }
}
