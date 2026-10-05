import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { buildFlowDocxFromPlan, wordDrawingAnchorXml, wordContentGraphicXml, type WordDrawingAnchor, type FlowDocxAsset, type FlowDocxOptions, type FlowDocxBlockReportItem } from '../../docxAssembly'
import { resolveFlowDocxPageBox } from '../../flowPageBox'
import type { FlowPrintNode, FlowPrintPlan } from '../../course/flowPrintPlan'
import { textOutputAdapter } from '../../../../components/text/adapters'
import { chartOutputAdapter } from '../../../../components/chart/output'
import { buildComponentReadingProjection, type ComponentExportDocument, type ComponentDocumentOutputOptions, type ComponentStaticCapture, type ComponentReadingBlock } from './reading'
import { wordChartDrawing, wordChartParts, wordShapeDrawing, wordTable } from './wordProfessional'
import { resolveFlowParagraphPresentation } from '../../../../shared/flowBodyPresentation'
import { resolveComponentBackground } from '../../../../shared/contracts/component-platform/project'
import { collectComponentAssetCredits } from '../../course/courseCredits'
import { transformPoint } from '../../../../core/components/geometry'

export type { ComponentExportDocument, ComponentOutputDiagnostic, ComponentOutputAsset, ComponentStaticCapture, ComponentCaptureRequest, ComponentDocumentOutputOptions } from './reading'
const content = (text: string) => ({ inlines: [{ type: 'text' as const, text }] })
const imageEffects = (block: Extract<ComponentReadingBlock, { kind: 'image' }>) => {
  const data = block.data
  return data.flipX || data.flipY || data.cornerRadius > 0 || data.feather.amount > 0
    || data.filters.brightness !== 1 || data.filters.contrast !== 1 || data.filters.saturation !== 1 || data.filters.grayscale !== 0 || data.filters.blur !== 0
}
export async function buildComponentDocx(document: ComponentExportDocument, options: ComponentDocumentOutputOptions) {
  const projection = buildComponentReadingProjection(document, options.surfaceId)
  const diagnostics = [...projection.diagnostics]
  const nodes: FlowPrintNode[] = [{ type: 'document-title', text: projection.title }]
  const patches: { marker: string; xml: string }[] = []
  const tableParagraphs: { marker: string; xml?: string }[] = []
  const professionalReport: FlowDocxBlockReportItem[] = []
  const assets = new Map<string, FlowDocxAsset>()
  const chartFiles: Record<string, Uint8Array> = {}
  const chartRelations: string[] = []
  const chartContentTypes: string[] = []
  const pageSize = options.pageSize ?? 'A4', orientation = options.orientation ?? 'portrait'
  const page = resolveFlowDocxPageBox(pageSize, orientation)
  const width = page.maxContentWidthPx
  let drawingId = 10000
  // A marker is software-owned and checked against authored JSON before substitution.
  let markerPrefix = '__guoling_word_output__'
  const authored = JSON.stringify(document)
  while (authored.includes(markerPrefix)) markerPrefix += '_'
  const blockSpans: { block: ComponentReadingBlock; start: string; end: string; xml?: string }[] = []
  const boundary = (marker: string) => nodes.push({ type: 'paragraph', blockId: marker, content: content(marker) })
  const patch = (xml: string, blockId: string, detail: string) => {
    const marker = `${markerPrefix}${patches.length}`
    patches.push({ marker, xml }); nodes.push({ type: 'paragraph', blockId: marker, content: content(marker) })
    professionalReport.push({ blockId, disposition: 'preserved', detail })
  }
  const note = (block: ComponentReadingBlock, code: string, message: string, assetId?: string) => {
    diagnostics.push({ surfaceId: options.surfaceId, instanceId: block.instance.id, code, message, ...(assetId ? { assetId } : {}) })
    nodes.push({ type: 'paragraph', blockId: `${block.instance.id}:diagnostic`, content: content(`[${block.instance.id}] ${message}`) })
  }
  const captured = async (block: ComponentReadingBlock): Promise<boolean> => {
    let capture: ComponentStaticCapture | undefined
    try { capture = await options.captureInstance?.({ document, surfaceId: options.surfaceId, instanceId: block.instance.id, state: 'author-initial' }) }
    catch (error) { note(block, 'capture-failed', `实际图面捕获失败：${error instanceof Error ? error.message : String(error)}`) }
    if (!capture) return false
    const id = `${markerPrefix}capture${assets.size}`
    assets.set(id, capture)
    nodes.push({ type: 'media', blockId: `${block.instance.id}:capture`, mediaKind: 'image', assetId: id,
      fallbackLabel: block.instance.id, width: capture.width, height: capture.height })
    diagnostics.push({ surfaceId: options.surfaceId, instanceId: block.instance.id, code: 'actual-static-capture', message: '实际初态图面为静态图片；源码和专业数据继续在工程中保留。' })
    return true
  }
  for (const block of projection.blocks) {
    const id = block.instance.id
    const span = { block, start: `${markerPrefix}start${blockSpans.length}`, end: `${markerPrefix}end${blockSpans.length}` }
    blockSpans.push(span)
    boundary(span.start)
    switch (block.kind) {
      case 'document-block': {
        const data = block.data
        switch (data.type) {
          case 'heading': nodes.push({ type: 'heading', blockId: id, level: data.level, content: data.content, paragraph: resolveFlowParagraphPresentation(data) }); break
          case 'quote': nodes.push({ type: 'quote', blockId: id, content: data.content, citation: data.citation, paragraph: resolveFlowParagraphPresentation(data) }); break
          case 'list': nodes.push({ type: 'list', blockId: id, ordered: data.ordered, items: data.items }); break
          case 'code': nodes.push({ type: 'code', blockId: id, code: data.code, language: data.language }); break
          case 'callout': nodes.push({ type: 'callout', blockId: id, tone: data.tone, title: data.title, body: data.body }); break
          case 'section': nodes.push({ type: 'section', blockId: id, title: data.title }); break
          case 'divider': nodes.push({ type: 'divider', blockId: id }); break
        }
        break
      }
      case 'media': {
        note(block, 'word-media-playback', `Word 静态文档不执行${block.mediaKind === 'audio' ? '音频' : '视频'}播放、音量、速率和背景音混合；请使用单 HTML 或网页包保留实际播放。`, block.data.assetId)
        nodes.push({ type: 'paragraph', blockId: id, content: content(block.data.title || `${block.mediaKind === 'audio' ? '音频' : '视频'} ${block.data.assetId}`) })
        if (block.mediaKind === 'video' && !await captured(block)) note(block, 'video-frame-missing', '视频缺少实际初态画面，素材和播放参数保留在工程。', block.data.assetId)
        break
      }
      case 'text': {
        const data = block.data
        const inlines = textOutputAdapter.inlines(data).map(inline => ({ ...inline,
          style: { fontFamily: data.appearance.fontFamily, fontSize: data.appearance.fontSize, color: data.appearance.color, ...inline.style } }))
        nodes.push({ type: 'paragraph', blockId: id, content: { inlines }, paragraph: { textAlign: data.appearance.align, lineHeight: data.appearance.lineHeight } }); break
      }
      case 'formula': nodes.push({ type: 'formula', blockId: id, latex: block.data.formula.latex, accessibleText: block.data.formula.accessibleText, style: { ...block.data.appearance, ...block.data.formula.style } }); break
      case 'table': {
        // Serialize every cell through this same Flow package, then move its paragraph
        // into the professional table. Math, runs and relationship ownership stay shared.
        const tableWidth = block.floatingPlacement ? block.instance.frame?.width ?? width : width
        const xml = wordTable(block.data, tableWidth, (rich, style) => {
          const marker = `${markerPrefix}cell${tableParagraphs.length}__`
          tableParagraphs.push({ marker })
          nodes.push({ type: 'paragraph', blockId: marker, content: { inlines: [
            { type: 'text', text: marker }, ...rich.inlines.map(inline => ({ ...inline, style: {
              ...(inline.type === 'text' ? { fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.textColor, bold: style.bold, italic: style.italic } : { fontSize: style.fontSize, color: style.textColor }),
              ...inline.style,
            } })),
          ] }, paragraph: { textAlign: style.horizontalAlign, lineHeight: 1.2 } })
          return marker
        })
        patch(xml, id, 'Native Word table with rich paragraphs, OMML, headers, merged cells and professional formatting')
        if (block.data.caption) nodes.push({ type: 'paragraph', blockId: `${id}:table-caption`, content: block.data.caption, paragraph: { textAlign: 'center', lineHeight: 1.2 } })
        break
      }
      case 'chart': {
        const number = chartRelations.length + 1
        const name = `componentChart${number}`
        const relationship = `rIdComponentChart${number}`
        const result = wordChartParts(block.data)
        chartFiles[`word/charts/${name}.xml`] = strToU8(result.chart)
        chartFiles[`word/embeddings/${name}.xlsx`] = result.workbook
        chartFiles[`word/charts/_rels/${name}.xml.rels`] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/${name}.xlsx"/></Relationships>`)
        chartRelations.push(`<Relationship Id="${relationship}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/${name}.xml"/>`)
        chartContentTypes.push(`<Override PartName="/word/charts/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)
        const aspect = (block.instance.frame?.height ?? 400) / (block.instance.frame?.width ?? 640)
        const chartWidth = block.floatingPlacement ? block.instance.frame?.width ?? width : width
        patch(wordChartDrawing(drawingId++, relationship, block.data.title, chartWidth, Math.min(page.maxContentHeightPx - 32, chartWidth * aspect)), id, 'Native Word chart with professional series and editable embedded workbook')
        chartOutputAdapter.semantic(block.data, block.instance.implementationOverride).diagnostics.forEach(message => note(block, 'chart-source-limitation', message))
        break
      }
      case 'shape': {
        const shapeWidth = Math.min(width, block.instance.frame?.width ?? 320), shapeHeight = Math.min(page.maxContentHeightPx - 32, block.instance.frame?.height ?? 160)
        const xml = wordShapeDrawing(block.data, drawingId++, shapeWidth, shapeHeight)
        if (xml) patch(xml, id, 'Native Word drawing with professional geometry')
        else if (!await captured(block)) note(block, 'shape-output-missing', '该形状尚无 Word 映射或实际图面，保留专业数据后补充输出。')
        break
      }
      case 'image': {
        if (imageEffects(block) && await captured(block)) break
        if (imageEffects(block)) note(block, 'image-display-limitation', 'Word 保留图片与裁切；翻转、圆角、羽化或滤镜需要实际图面。')
        let asset: FlowDocxAsset | undefined
        try { asset = await options.resolveAsset?.(block.data.assetId) }
        catch (error) { note(block, 'asset-read-failed', String(error), block.data.assetId) }
        if (!asset) note(block, 'asset-missing', `图片资源 ${block.data.assetId} 未提供实际字节。`, block.data.assetId)
        else if (!['image/png', 'image/jpeg', 'image/gif'].includes(asset.mimeType)) {
          if (await captured(block)) break
          note(block, 'asset-format-not-supported', `Word 图片格式 ${asset.mimeType} 需要实际光栅图面。`, block.data.assetId)
        } else assets.set(block.data.assetId, asset)
        nodes.push({ type: 'media', blockId: id, mediaKind: 'image', assetId: block.data.assetId, fallbackLabel: block.data.alt || `图片 ${block.data.assetId}`,
          crop: block.data.crop, cropX: block.data.cropX, cropY: block.data.cropY, ...(block.instance.frame ? { width: block.instance.frame.width, height: block.instance.frame.height } : {}) }); break
      }
      case 'static':
        if (block.captureRequired) {
          if (!await captured(block)) note(block, 'capture-missing', `${block.label} 缺少实际初态图面；源码和数据仍保留在工程。`)
        } else {
          nodes.push({ type: 'paragraph', blockId: id, content: content([block.label, ...block.lines].join('\n')) })
        }
        break
    }
    const definition = document.definitions[block.instance.definitionId]!
    const implementation = block.instance.implementationOverride ?? definition.implementation
    if (implementation.kind === 'source' && block.kind !== 'static') {
      if (!await captured(block)) note(block, 'custom-visual-missing', '自定义源码的图面尚未捕获；文件保留专业数据的默认输出，无法代表定制视觉与互动。')
    }
    if (block.instance.flowLayout?.caption) nodes.push({ type: 'paragraph', blockId: `${id}:caption`, content: block.instance.flowLayout.caption })
    if (block.instance.flowLayout?.wrap && block.instance.flowLayout.wrap !== 'none') note(block, 'word-text-wrap', '此对象的环绕方式尚不映射到 Word，保留专业内容与题注。')
    boundary(span.end)
  }
  const background = resolveComponentBackground(document, projection.surface)
  if (background.assetId) diagnostics.push({ surfaceId: options.surfaceId, instanceId: '', code: 'word-background-image', message: 'Word 语义分页尚不映射背景图片；背景引用保留在工程中。', assetId: background.assetId })
  const plan: FlowPrintPlan = { surfaceId: options.surfaceId, title: projection.title, backgroundColor: projection.surface.flow?.layout.paperBackgroundColor ?? background.color, pageSize, orientation, nodes,
    includesRuntimeToc: false, includesFloatingLayers: false, omittedFloatingLayerCount: 0 }
  const baseOptions: FlowDocxOptions = { resolveAsset: id => assets.get(id), credits: collectComponentAssetCredits(document.assets), ...(options.author ? { author: options.author } : {}), ...(options.createdAt ? { createdAt: options.createdAt } : {}) }
  const base = buildFlowDocxFromPlan(plan, baseOptions)
  const files = unzipSync(base.bytes)
  let word = strFromU8(files['word/document.xml']!)
  for (const cell of tableParagraphs) {
    const index = word.indexOf(cell.marker)
    const start = word.lastIndexOf('<w:p>', index), end = word.indexOf('</w:p>', index)
    if (index < 0 || start < 0 || end < 0) throw new Error('Word 表格正文装配位置不存在。')
    cell.xml = word.slice(start, end + 6).replace(`<w:r><w:t>${cell.marker}</w:t></w:r>`, '')
    word = word.slice(0, start) + word.slice(end + 6)
  }
  for (const replacement of patches) {
    const index = word.indexOf(replacement.marker)
    const start = word.lastIndexOf('<w:p>', index), end = word.indexOf('</w:p>', index)
    if (index < 0 || start < 0 || end < 0) throw new Error('Word 专业对象装配位置不存在。')
    let xml = replacement.xml
    for (const cell of tableParagraphs) xml = xml.replace(cell.marker, cell.xml!)
    word = word.slice(0, start) + xml + word.slice(end + 6)
  }
  // Boundaries identify serializer output; they never become authored identities.
  const markerParagraph = (marker: string) => {
    const index = word.indexOf(marker)
    const start = word.lastIndexOf('<w:p>', index), end = word.indexOf('</w:p>', index)
    if (index < 0 || start < 0 || end < 0) throw new Error('Word 正文装配位置不存在。')
    return { start, end: end + 6 }
  }
  let prefix = word, suffix = ''
  if (blockSpans.length) {
    prefix = word.slice(0, markerParagraph(blockSpans[0]!.start).start)
    suffix = word.slice(markerParagraph(blockSpans[blockSpans.length - 1]!.end).end)
    for (const span of blockSpans) span.xml = word.slice(markerParagraph(span.start).end, markerParagraph(span.end).start)
  }
  const appendDrawing = (body: string, drawing: string): string => {
    if (body.startsWith('<w:p>')) return body.replace(/^<w:p>(<w:pPr>[\s\S]*?<\/w:pPr>)?/, (_, properties = '') => `<w:p>${properties}${drawing}`)
    // Tables and media are anchored to their adjacent paragraph, as in the mature writer.
    return `<w:p>${drawing}</w:p>${body}`
  }
  const footerDrawings: string[] = []
  const bodySpans = new Map(blockSpans.filter(span => !span.block.floatingPlacement).map(span => [span.block.instance.id, span]))
  for (const span of blockSpans.filter(span => span.block.floatingPlacement)) {
    const block = span.block, placement = block.floatingPlacement!
    const sourceFrame = block.outputFrame ?? block.instance.frame
    if (!sourceFrame) {
      diagnostics.push({ surfaceId: options.surfaceId, instanceId: block.instance.id, code: 'floating-frame-missing', message: 'Word 浮层缺少正式 frame；专业内容保留在正文供修复。' })
      continue
    }
    const matrix = sourceFrame.transform, scaleX = Math.hypot(matrix[0], matrix[1]), scaleY = Math.hypot(matrix[2], matrix[3])
    const requestedAnchor = placement.space === 'paper' ? placement.paragraphAnchor : undefined
    const target = requestedAnchor ? bodySpans.get(requestedAnchor.blockId) : undefined
    const anchor = target ? requestedAnchor : undefined
    if (requestedAnchor && !target) diagnostics.push({ surfaceId: options.surfaceId, instanceId: block.instance.id,
      code: 'floating-anchor-unresolved', message: `DOCX 锚点正文组件 ${requestedAnchor.blockId} 不存在；按正式 frame 保留浮层于文首。` })
    const anchorFrame = block.floatingAnchorFrame ?? sourceFrame
    // Component matrices transform the local origin; Office rotates around the center.
    const center = transformPoint(matrix, { x: sourceFrame.width / 2, y: sourceFrame.height / 2 })
    const frameWidth = sourceFrame.width * scaleX, frameHeight = sourceFrame.height * scaleY
    const x = center.x - frameWidth / 2, y = center.y - frameHeight / 2
    const frame = { x: anchor ? width * anchor.xRatio + x - anchorFrame.transform[4] : x,
      y: anchor ? anchor.offsetY + y - anchorFrame.transform[5] : y, width: frameWidth, height: frameHeight }
    const position: WordDrawingAnchor = { id: block.instance.id, frame, paragraphRelative: Boolean(anchor),
      behindDoc: placement.plane === 'underlay', relativeHeight: placement.plane === 'underlay' ? blockSpans.indexOf(span) + 1 : 100_000 + blockSpans.indexOf(span),
      rotation: Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI, flipY: matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0 }
    // A bare drawing can use its native carrier directly. Captions, diagnostics and
    // any surrounding professional paragraphs stay together in the editable box.
    const inlineDrawing = span.xml!.match(/<wp:inline\b/g)?.length === 1
      ? span.xml!.match(/^<w:p>(?:<w:pPr>[\s\S]*?<\/w:pPr>)?<w:r><w:drawing>(<wp:inline\b[^>]*>[\s\S]*?<\/wp:inline>)<\/w:drawing><\/w:r><\/w:p>$/) : null
    const drawing = inlineDrawing ? (() => {
      const graphic = inlineDrawing[1]!.match(/<a:graphic\b[\s\S]*?<\/a:graphic>/)?.[0]
      if (!graphic) throw new Error('Word 浮层图元不存在。')
      return wordDrawingAnchorXml(drawingId++, position, position.rotation && !graphic.includes('<a:xfrm')
        ? wordContentGraphicXml(frame, span.xml!, position.rotation) : graphic)
    })() : wordDrawingAnchorXml(drawingId++, position,
      wordContentGraphicXml(frame, span.xml!, Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI))
    const definition = document.definitions[block.instance.definitionId]!
    const teacher = definition.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.teacher-controller'
    const footer = block.globalPlane && teacher && (!block.instance.visibility || block.instance.visibility.mode === 'all')
    if (footer) footerDrawings.push(drawing)
    else if (target) target.xml = appendDrawing(target.xml!, drawing)
    else prefix = prefix.replace(/<w:p>(<w:pPr>[\s\S]*?<\/w:pPr>)?/, (_, properties = '') => `<w:p>${properties}${drawing}`)
    span.xml = ''
  }
  if (blockSpans.length) word = prefix + blockSpans.map(span => span.xml).join('') + suffix
  if (footerDrawings.length) {
    const namespaces = word.match(/<w:document([^>]*)>/)![1]
    files['word/footer1.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr${namespaces}><w:p>${footerDrawings.join('')}</w:p></w:ftr>`)
    // The footer reuses image relationships already allocated by this writer.
    files['word/_rels/footer1.xml.rels'] = files['word/_rels/document.xml.rels']!
    const relationships = strFromU8(files['word/_rels/document.xml.rels']!)
    files['word/_rels/document.xml.rels'] = strToU8(relationships.replace('</Relationships>', '<Relationship Id="rIdComponentFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'))
    files['[Content_Types].xml'] = strToU8(strFromU8(files['[Content_Types].xml']!).replace('</Types>', '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'))
    word = word.replace('<w:sectPr>', '<w:sectPr><w:footerReference w:type="default" r:id="rIdComponentFooter"/>')
  }
  // The reused Flow writer emits portrait; this adapter owns target orientation.
  word = word.replace(/<w:pgSz\b[^>]*\/>/, `<w:pgSz w:w="${page.widthTwips}" w:h="${page.heightTwips}"${orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>`)
  files['word/document.xml'] = strToU8(word)
  Object.assign(files, chartFiles)
  if (chartRelations.length) {
    const relationships = strFromU8(files['word/_rels/document.xml.rels']!)
    files['word/_rels/document.xml.rels'] = strToU8(relationships.replace('</Relationships>', chartRelations.join('') + '</Relationships>'))
    const types = strFromU8(files['[Content_Types].xml']!)
    files['[Content_Types].xml'] = strToU8(types.replace('</Types>', '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>' + chartContentTypes.join('') + '</Types>'))
  }
  return { bytes: zipSync(files), diagnostics, warnings: base.warnings,
    report: [...base.report.filter(item => !('blockId' in item) || !(item.blockId ?? '').startsWith(markerPrefix)), ...professionalReport],
    fidelity: diagnostics.some(value => ['asset-missing', 'asset-read-failed', 'asset-format-not-supported', 'capture-missing', 'capture-failed', 'custom-visual-missing', 'shape-output-missing', 'professional-data-invalid', 'image-display-limitation', 'floating-frame-missing', 'floating-anchor-unresolved', 'global-reading-placement', 'word-background-image', 'word-text-wrap', 'word-media-playback', 'video-frame-missing'].includes(value.code)) ? 'partial' as const : 'complete' as const }
}
