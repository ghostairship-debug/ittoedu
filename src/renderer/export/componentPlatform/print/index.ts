import { textOutputAdapter, formulaOutputAdapter } from '../../../../components/text/adapters'
import { outputTableHtml } from '../../../../components/table/output'
import { chartOutputAdapter } from '../../../../components/chart/output'
import { resolveNativeShapePath } from '../../../../shared/nativeShapePath'
import { nativePathData } from '../../../../shared/nativePathRendering'
import { cropGeometry } from '../../../editing/crop/imageCrop'
import { flowImageDimensions } from '../../imageDimensions'
import { buildPdfPrintHtml, pdfPrintPageName, type PdfPrintImage } from '../../course/pdfPrintHtml'
import { bytesToDataUrl } from '../../base64'
import { resolveFlowDocxPageBox, resolvePrintPageSize } from '../../flowPageBox'
import { buildComponentReadingProjection, escapeOutput as x, type ComponentExportDocument, type ComponentOutputDiagnostic, type ComponentReadingBlock } from '../document/reading'
import type { ComponentDocumentOutputOptions, ComponentCaptureRequest } from '../document/reading'
import { documentBlockOutputAdapter } from '../../../../components/document-block'
import { resolveComponentBackground, type ComponentFlowPlacement } from '../../../../shared/contracts/component-platform/project'
import { flowParagraphAnchoredFrame, type FlowParagraphBlockRect } from '../../../../shared/flowParagraphAnchors'
import { renderDocumentText } from '../../../../shared/document/render'
import { collectComponentAssetCredits, withCourseCreditsPage } from '../../course/courseCredits'

export interface ComponentPrintOutputOptions extends ComponentDocumentOutputOptions {
  resolveAssetUrl?: (assetId: string) => string | undefined
  /** Fixed surfaces retain real layout through the existing Player capture service. */
  captureSurface?: (request: Omit<ComponentCaptureRequest, 'instanceId'>) => Promise<readonly PdfPrintImage[]>
}

/** Compose host-generated fragments without rewriting CSS or losing named page sizes. */
export function composeComponentPrintHtml(title: string, fragments: readonly string[]): string {
  const styles: string[] = [], pages: string[] = []
  let credits = ''
  for (const html of fragments) {
    const dom = new DOMParser().parseFromString(html, 'text/html')
    for (const section of dom.body.querySelectorAll('.course-credits')) {
      credits ||= section.outerHTML
      section.remove()
    }
    styles.push(...Array.from(dom.head.querySelectorAll('style'), style => style.textContent ?? ''))
    pages.push(`<article class="component-print-fragment">${dom.body.innerHTML}</article>`)
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${x(title)}</title><style>html,body{margin:0;padding:0}.component-print-fragment{break-before:page}.component-print-fragment:first-child{break-before:auto}${styles.join('\n')}</style></head><body>${pages.join('')}${credits}</body></html>`
}

function flowPrintCss(name: string, width: number, cssSize: string): string {
  const scope = `[data-component-print-root="${name}"]`
  const rule = (selectors: string, declarations: string) => `${selectors.split(',').map(selector => `${scope} ${selector}`).join(',')}{${declarations}}`
  return `@page ${name}{size:${cssSize};margin:20mm}`
    + `${scope}{page:${name};box-sizing:border-box;max-width:${width}px;margin:0 auto;position:relative;color:#1f2937;background:#fff;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}`
    + rule('*', 'box-sizing:border-box')
    + rule('.component-output', 'margin:0 0 16px;overflow-wrap:anywhere;position:relative;z-index:1')
    + rule('.component-output p', 'white-space:pre-wrap;margin:0')
    + rule('.component-output img,.component-output svg', 'max-width:100%;height:auto')
    + rule('.component-output-chart,.component-output-image,.component-output-shape', 'break-inside:avoid')
    + rule('.component-output-table', 'break-inside:auto')
    + rule('table', 'border-collapse:collapse;width:100%;table-layout:fixed')
    + rule('thead', 'display:table-header-group')
    + rule('tr', 'break-inside:avoid')
    + rule('th,td', 'padding:8px;border:1px solid #d1d5db;text-align:left')
    + rule('.output-diagnostic', 'border:1px dashed #b45309;padding:8px;color:#92400e')
    + rule('h1', 'break-after:avoid;font-size:24px')
    + 'html,body{margin:0;padding:0}'
}
function shapeSvg(block: Extract<ComponentReadingBlock, { kind: 'shape' }>, width: number, height: number): string | undefined {
  const data = block.data, s = data.style
  const path = resolveNativeShapePath(data, width, height)
  const attr = `fill="${x(s.fillColor)}" fill-opacity="${s.fillOpacity}" stroke="${x(s.borderColor)}" stroke-opacity="${s.borderOpacity}" stroke-width="${s.borderWidth}"${s.lineStyle !== 'solid' ? ` stroke-dasharray="${s.lineStyle === 'dotted' ? '1 3' : '6 4'}"` : ''}`
  // Non-basic presets, endpoint arrows and gradients use a real capture instead of an approximate drawing.
  if (s.fillGradient || s.startArrow !== 'none' || s.endArrow !== 'none') return undefined
  let drawing: string
  if (path) drawing = path.paths.map(item => `<path d="${x(nativePathData(item.commands, width, height))}" ${attr.replace(`fill="${x(s.fillColor)}"`, `fill="${item.fill ? x(s.fillColor) : 'none'}"`).replace(`stroke="${x(s.borderColor)}"`, `stroke="${item.stroke ? x(s.borderColor) : 'none'}"`)}/>`).join('')
  else if (data.lineGeometry?.kind === 'straight') drawing = `<path d="M${data.lineGeometry.start[0] * width} ${data.lineGeometry.start[1] * height} L${data.lineGeometry.end[0] * width} ${data.lineGeometry.end[1] * height}" ${attr.replace(`fill="${x(s.fillColor)}"`, 'fill="none"')}/>`
  else if (data.shapeType === 'rectangle' || data.shapeType === 'rounded-rectangle') drawing = `<rect width="${width}" height="${height}" rx="${data.shapeType === 'rounded-rectangle' ? s.cornerRadius : 0}" ${attr}/>`
  else if (data.shapeType === 'ellipse' || data.shapeType === 'emphasis-dot') drawing = `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" ${attr}/>`
  else if (data.shapeType === 'triangle' || data.shapeType === 'emphasis-triangle') drawing = `<polygon points="${width / 2},0 ${width},${height} 0,${height}" ${attr}/>`
  else if (data.shapeType === 'diamond') drawing = `<polygon points="${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}" ${attr}/>`
  else return undefined
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${x(data.shapeType)}">${drawing}</svg>`
}
export async function buildComponentPrintHtml(document: ComponentExportDocument, options: ComponentPrintOutputOptions) {
  const surface = document.surfaces.find(item => item.id === options.surfaceId)
  if (!surface) throw new Error(`导出表面不存在：${options.surfaceId}`)
  if (surface.kind !== 'flow') {
    if (!options.captureSurface) throw new Error(`表面 ${surface.id} 需要实际 Player 页面／镜头捕获。`)
    const pages = await options.captureSurface({ document, surfaceId: surface.id, state: 'author-initial' })
    if (!pages.length) throw new Error(`表面 ${surface.id} 没有实际捕获页面。`)
    return { html: withCourseCreditsPage(buildPdfPrintHtml(document.title, pages, { pageName: surface.id, pageSize: options.pageSize, orientation: options.orientation }), collectComponentAssetCredits(document.assets)), diagnostics: [{ surfaceId: surface.id, instanceId: '', code: 'actual-static-surface', message: '固定表面按实际初态图面打印，PDF 不保留互动和专业编辑。' }] satisfies ComponentOutputDiagnostic[], fidelity: 'complete' as const }
  }
  const projection = buildComponentReadingProjection(document, surface.id)
  const diagnostics = [...projection.diagnostics]
  const pageSize = options.pageSize ?? 'A4', orientation = options.orientation ?? 'portrait'
  const page = resolveFlowDocxPageBox(pageSize, orientation)
  const width = page.maxContentWidthPx
  const name = pdfPrintPageName(surface.id)
  const css = flowPrintCss(name, width, resolvePrintPageSize(pageSize, orientation).cssSize)
  const blocks = new Map<string, HTMLElement>()
  const note = (block: ComponentReadingBlock, code: string, message: string, assetId?: string) => {
    diagnostics.push({ surfaceId: surface.id, instanceId: block.instance.id, code, message, ...(assetId ? { assetId } : {}) })
    return `<aside class="output-diagnostic" data-output-diagnostic="${x(code)}">[${x(block.instance.id)}] ${x(message)}</aside>`
  }
  const capture = async (block: ComponentReadingBlock): Promise<string | undefined> => {
    try {
      const image = await options.captureInstance?.({ document, surfaceId: surface.id, instanceId: block.instance.id, state: 'author-initial' })
      if (!image) return undefined
      diagnostics.push({ surfaceId: surface.id, instanceId: block.instance.id, code: 'actual-static-capture', message: '程序区域按实际初态图面打印；源码与数据保留在工程。' })
      return `<img src="${x(bytesToDataUrl(image.bytes, image.mimeType))}" width="${image.width}" height="${image.height}" alt="${x(block.instance.id)}"/>`
    } catch (error) { return note(block, 'capture-failed', `实际图面捕获失败：${error instanceof Error ? error.message : String(error)}`) }
  }
  for (const block of projection.blocks) {
    let html = ''
    switch (block.kind) {
      case 'document-block': html = documentBlockOutputAdapter.html(globalThis.document, block.instance.data, block.instance.id); break
      case 'media':
        html = `<p>${x(block.data.title || `${block.mediaKind === 'audio' ? '音频' : '视频'} ${block.data.assetId}`)}</p>`
          + note(block, 'print-media-playback', 'PDF 不执行媒体播放、音量、速率或混合；单 HTML 与网页包保留正式播放。', block.data.assetId)
        if (block.mediaKind === 'video') html += await capture(block) ?? note(block, 'video-frame-missing', '视频缺少实际初态画面，素材与播放参数仍保留。', block.data.assetId)
        break
      case 'text': {
        const a = block.data.appearance
        html = `<div style="font-family:${x(a.fontFamily)};font-size:${a.fontSize}px;color:${x(a.color)};text-align:${a.align};line-height:${a.lineHeight};white-space:pre-wrap">${textOutputAdapter.html(block.data)}</div>`; break
      }
      case 'formula': html = formulaOutputAdapter.html(block.data); break
      case 'table': html = outputTableHtml(block.data, { width }); break
      case 'chart': {
        const h = Math.min(page.maxContentHeightPx - 32, width * (block.instance.frame?.height ?? 400) / (block.instance.frame?.width ?? 640))
        const semantic = chartOutputAdapter.semantic(block.data)
        html = chartOutputAdapter.svg(block.data, width, h, block.instance.id)
          + `<table class="chart-data"><caption>图表数据</caption><thead><tr><th>分类</th>${semantic.series.map(s => `<th>${x(s.name)}</th>`).join('')}</tr></thead><tbody>${semantic.labels.map((label, i) => `<tr><th scope="row">${x(label)}</th>${semantic.series.map(s => `<td>${s.values[i]}</td>`).join('')}</tr>`).join('')}</tbody></table>`; break
      }
      case 'image': {
        const data = block.data
        if (data.feather.amount > 0) {
          html = await capture(block) ?? note(block, 'image-feather-capture-missing', '图片羽化需要实际图面，原图片和参数仍保留。', data.assetId)
          break
        }
        let asset
        try { asset = await options.resolveAsset?.(data.assetId) }
        catch (error) { html += note(block, 'asset-read-failed', String(error), data.assetId) }
        const url = asset ? bytesToDataUrl(asset.bytes, asset.mimeType) : options.resolveAssetUrl?.(data.assetId)
          ?? ('url' in (document.assets[data.assetId] ?? {}) ? (document.assets[data.assetId] as { url?: string }).url : undefined)
        if (!url) { html += note(block, 'asset-missing', `图片资源 ${data.assetId} 缺少字节或运行 URL。`, data.assetId); break }
        const source = asset ? flowImageDimensions(asset.bytes, asset.mimeType) : undefined
        const w = Math.min(width, block.instance.frame?.width ?? source?.width ?? width)
        const h = block.instance.frame ? w * block.instance.frame.height / block.instance.frame.width : source ? w * source.height / source.width : 320
        if (!source && [data.crop.left, data.crop.top, data.crop.right, data.crop.bottom].some(value => value !== 0)) {
          html += await capture(block) ?? note(block, 'image-crop-dimensions-missing', '裁切图片缺少原图尺寸或实际图面，原引用与裁切保留。', data.assetId); break
        }
        const geometry = source ? cropGeometry({ ...data, frame: { width: w, height: h }, source }).whole : { x: 0, y: 0, width: w, height: h }
        const f = data.filters
        html += `<figure style="width:${w}px;height:${h}px;overflow:hidden;position:relative;border-radius:${data.cornerRadius}px;filter:brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation}) grayscale(${f.grayscale}) blur(${f.blur}px)"><img src="${x(url)}" alt="${x(data.alt)}" style="position:absolute;max-width:none;left:${geometry.x}px;top:${geometry.y}px;width:${geometry.width}px;height:${geometry.height}px;object-fit:${data.fit === 'stretch' ? 'fill' : data.fit};transform-origin:0 0;transform:translate(${data.flipX ? '100%' : '0'},${data.flipY ? '100%' : '0'}) scale(${data.flipX ? -1 : 1},${data.flipY ? -1 : 1})"/></figure>`; break
      }
      case 'shape': {
        const w = Math.min(width, block.instance.frame?.width ?? 320), h = block.instance.frame?.height ?? 160
        html = shapeSvg(block, w, h) ?? await capture(block) ?? note(block, 'shape-capture-missing', '该形状需要实际图面，专业路径与样式仍保留。'); break
      }
      case 'static': html = block.captureRequired
        ? await capture(block) ?? note(block, 'capture-missing', `${block.label} 缺少实际初态图面；源码与数据保留在工程。`)
        : `<p>${x([block.label, ...block.lines].join('\n'))}</p>`; break
    }
    const implementation = block.instance.implementationOverride ?? document.definitions[block.instance.definitionId]!.implementation
    if (implementation.kind === 'source' && block.kind !== 'static') html += await capture(block)
      ?? note(block, 'custom-visual-missing', '定制源码图面尚未捕获；默认专业输出无法代表定制视觉与互动。')
    const element = globalThis.document.createElement('section')
    element.dataset.componentOutput = block.instance.id
    element.className = `component-output component-output-${block.kind}`
    element.innerHTML = html
    if (block.instance.flowLayout?.caption) {
      const caption = globalThis.document.createElement('figcaption'); caption.innerHTML = renderDocumentText(block.instance.flowLayout.caption); element.append(caption)
    }
    const layout = block.instance.flowLayout
    if (layout?.wrap && layout.wrap !== 'none') element.style.float = layout.wrap
    if (layout?.width) element.style.maxWidth = `${Math.min(width, layout.width === 'wide' ? projection.surface.flow?.layout.wideContentWidth ?? width : layout.width === 'full-width' ? width : projection.surface.flow?.layout.readingWidth ?? width)}px`
    blocks.set(block.instance.id, element)
  }
  const body = globalThis.document.createElement('main')
  body.dataset.componentPrintSurface = surface.id
  body.dataset.componentPrintRoot = name
  body.style.page = name
  const title = globalThis.document.createElement('h1'); title.textContent = projection.title; body.append(title)
  for (const block of projection.blocks) if (!block.floatingPlacement) body.append(blocks.get(block.instance.id)!)
  // Measure the same semantic print body to resolve paragraph anchors with the shared rule.
  let paragraphRects: FlowParagraphBlockRect[] = []
  if (projection.blocks.some(block => block.floatingPlacement?.space === 'paper' && block.floatingPlacement.paragraphAnchor)) {
  const measurement = globalThis.document.createElement('iframe')
  Object.assign(measurement.style, { position: 'absolute', left: '-100000px', top: '0', width: `${width}px`, visibility: 'hidden' })
  globalThis.document.body.append(measurement)
  const dom = measurement.contentDocument!
  const style = dom.createElement('style'); style.textContent = css; dom.head.append(style)
  const measuredBody = body.cloneNode(true) as HTMLElement; measuredBody.style.width = `${width}px`
  dom.body.append(measuredBody)
  try {
    await dom.fonts?.ready
    const paper = measuredBody.getBoundingClientRect()
    paragraphRects = [...measuredBody.querySelectorAll<HTMLElement>('[data-component-output]')].map(element => {
      const rect = element.getBoundingClientRect()
      return { blockId: element.dataset.componentOutput!, x: rect.left - paper.left, y: rect.top - paper.top, width: rect.width, height: rect.height, depth: 0 }
    })
  } finally { measurement.remove() }
  }
  for (const block of projection.blocks) {
    const element = blocks.get(block.instance.id)!, frame = block.outputFrame ?? block.instance.frame
    const placement: ComponentFlowPlacement | undefined = block.floatingPlacement
    if (!placement) continue
    if (!frame) { element.insertAdjacentHTML('afterbegin', note(block, 'floating-frame-missing', '浮层缺少正式 frame；专业内容保留供修复。')); body.append(element); continue }
    const anchor = placement.paragraphAnchor
    const matrix = [...frame.transform]
    const anchorFrame = block.floatingAnchorFrame ?? frame
    const anchored = anchor && placement.space === 'paper' ? flowParagraphAnchoredFrame(anchor,
      { x: anchorFrame.transform[4], y: anchorFrame.transform[5], width: anchorFrame.width, height: anchorFrame.height }, width, paragraphRects) : null
    if (anchored) { matrix[4] = matrix[4]! + anchored.x - anchorFrame.transform[4]; matrix[5] = matrix[5]! + anchored.y - anchorFrame.transform[5] }
    Object.assign(element.style, { position: 'absolute', left: '0', top: '0',
      width: `${frame.width}px`, height: `${frame.height}px`, transformOrigin: '0 0', transform: `matrix(${matrix.join(',')})`,
      zIndex: placement.plane === 'underlay' ? '0' : '2', margin: '0' })
    body.append(element)
    if (placement.space === 'viewport') diagnostics.push({ surfaceId: surface.id, instanceId: block.instance.id, code: 'viewport-print-placement', message: '视口浮层保留作者位置于本讲义首个页面；静态分页不执行随视口滚动。' })
    if (anchor && !anchored) element.insertAdjacentHTML('afterbegin', note(block, 'floating-anchor-unresolved', '段落锚点没有可靠排版位置，按正式 frame 保留浮层。'))
  }
  const background = resolveComponentBackground(document, projection.surface)
  const paperColor = projection.surface.flow?.layout.paperBackgroundColor ?? background.color
  if (background.assetId) {
    const asset = await options.resolveAsset?.(background.assetId)
    const url = asset ? bytesToDataUrl(asset.bytes, asset.mimeType) : options.resolveAssetUrl?.(background.assetId)
    if (url) { body.style.backgroundImage = `url(${JSON.stringify(url)})`; body.style.backgroundSize = background.fit === 'fill' ? '100% 100%' : background.fit; body.style.backgroundRepeat = 'no-repeat' }
    else diagnostics.push({ surfaceId: surface.id, instanceId: '', code: 'asset-missing', message: `背景资源 ${background.assetId} 缺少实际字节。`, assetId: background.assetId })
  }
  body.style.backgroundColor = paperColor
  body.style.setProperty('--component-reading-width', `${projection.surface.flow?.layout.readingWidth ?? width}px`)
  body.style.setProperty('--component-wide-width', `${projection.surface.flow?.layout.wideContentWidth ?? width}px`)
  return { html: withCourseCreditsPage(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${x(projection.title)}</title><style>${css}</style></head><body>${body.outerHTML}</body></html>`, collectComponentAssetCredits(document.assets)), diagnostics,
    fidelity: diagnostics.some(value => ['asset-missing', 'asset-read-failed', 'capture-missing', 'capture-failed', 'custom-visual-missing', 'professional-data-invalid', 'shape-capture-missing', 'image-feather-capture-missing', 'image-crop-dimensions-missing', 'floating-frame-missing', 'floating-anchor-unresolved', 'viewport-print-placement', 'print-media-playback', 'video-frame-missing'].includes(value.code)) ? 'partial' as const : 'complete' as const }
}
