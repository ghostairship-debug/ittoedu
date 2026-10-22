import { createTestProjectFromLegacy, testContainerInstance } from '../helpers/glxWorkFixture'
import { afterEach, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createChartData } from '../../src/components/chart/data'
import { createTableData } from '../../src/components/table/data'
import { imageDataSchema } from '../../src/components/image/data'
import { outputTableHtml } from '../../src/components/table/output'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { buildComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { buildComponentPptx } from '../../src/renderer/export/componentPlatform/pptx'
import { buildFlowDocxFromPlan } from '../../src/renderer/export/docxAssembly'
import { resolveFlowDocxPageBox } from '../../src/renderer/export/flowPageBox'
import { affineOutputBounds } from '../../src/renderer/export/outputImage'
import { bytesToDataUrl } from '../../src/renderer/export/base64'
import { defaultShapeData } from '../../src/components/shape/data'
import type { FlowTextContent } from '../../src/shared/document/content'
import { auditExportPng as png } from '../fixtures/auditExportPng'

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const c = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const wp = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const text = (value: string): { content: FlowTextContent } => ({ content: { inlines: [{ type: 'text', text: value }] } })

function parse(bytes: Uint8Array) {
  const dom = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  expect(dom.getElementsByTagName('parsererror')).toHaveLength(0)
  return dom
}
function body(bytes: Uint8Array) { return parse(unzipSync(bytes)['word/document.xml']!) }
function project(instances: Record<string, unknown>, kind: 'flow' | 'slide' = 'flow', sourceIds: string[] = []) {
  const keys = ['text', 'document-block', 'table', 'chart', 'image', 'shape', 'group']
  const owned = new Set(Object.values(instances).flatMap(value => (value as { childIds?: string[] }).childIds ?? []))
  return courseProjectV10Schema.parse(createTestProjectFromLegacy({ schemaVersion: 10, id: 'export-audit', revision: 0, title: '正常正文',
    definitions: { ...Object.fromEntries(keys.map(key => [`guoling.${key}`, { id: `guoling.${key}`, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
      ...Object.fromEntries(sourceIds.map(id => [id, { id, role: 'content', implementation: { kind: 'source', language: 'typescript', workspace: { ownerId: id, entry: 'main.ts' } } }])) },
    instances, surfaces: [{ id: 'page', kind, title: '健康标题', childIds: Object.keys(instances).filter(id => !owned.has(id)), ...(kind === 'slide' ? { designSize: { width: 800, height: 600 } } : {}) }], global: { underlay: [], overlay: [] }, assets: {} }))
}
function pieData() {
  const data = createChartData()
  const { showCategoryAxis: _category, showValueAxis: _value, showGridLines: _grid, ...style } = data.style as Extract<typeof data, { chartType: 'bar' | 'line' | 'area' }>['style']
  return { ...data, chartType: 'pie' as const, series: [data.series[0]!] as [typeof data.series[number]], style }
}
const asset = { bytes: png(), mimeType: 'image/png' }
const frame = (width: number, height: number, transform: number[] = [1, 0, 0, 1, 10, 20]) => ({ width, height, transform })
function mockBitmapProjection() {
  const transforms: number[][] = [], draws: unknown[][] = []
  const context = { setTransform: (...args: number[]) => transforms.push(args), drawImage: (...args: unknown[]) => draws.push(args) }
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 100; naturalHeight = 100; async decode() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) { return bytesToDataUrl(png(this.width, this.height), 'image/png') })
  return { transforms, draws }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('CA147 gives each ordered list an independent restart while sharing abstract numbering', async () => {
  const list = (id: string) => ({ id, definitionId: 'guoling.document-block', data: { type: 'list', ordered: true, items: ['甲', '乙'].map((value, index) => ({ id: `${id}${index}`, content: text(value).content })) } })
  const source = project({ one: list('one'), two: list('two') })
  const result = await buildComponentDocx(source, { surfaceId: 'page' }), files = unzipSync(result.bytes)
  const ids = Array.from(body(result.bytes).getElementsByTagNameNS(w, 'numId')).map(item => item.getAttributeNS(w, 'val'))
  expect(ids).toEqual(['2', '2', '3', '3'])
  const numbering = parse(files['word/numbering.xml']!)
  expect(Array.from(numbering.getElementsByTagNameNS(w, 'startOverride')).map(item => item.getAttributeNS(w, 'val'))).toEqual(['1', '1'])
  expect(numbering.getElementsByTagNameNS(w, 'abstractNum')).toHaveLength(2)
})

it('CA180 replaces unrepresentable code characters only in target XML and diagnoses that block', async () => {
  const source = project({ code: { id: 'code', definitionId: 'guoling.document-block', data: { type: 'code', code: 'line1\u000bline2\ud800' } } })
  const before = structuredClone(source), result = await buildComponentDocx(source, { surfaceId: 'page' })
  for (const [name, bytes] of Object.entries(unzipSync(result.bytes))) if (name.endsWith('.xml') || name.endsWith('.rels')) parse(bytes)
  expect(body(result.bytes).documentElement.textContent).toContain('line1\ufffdline2\ufffd')
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ instanceId: 'code', code: 'word-xml-text-substitution' }))
  expect(result.fidelity).toBe('partial'); expect(source).toEqual(before)
})

it('CA224 and CA212 keep table caption before the table and code font unless explicitly authored', async () => {
  const table = createTableData({ rows: 1, columns: 1 }); table.caption = text('表前题注').content
  const { text: _text, ...cell } = table.rows[0]!.cells[0]!
  table.rows[0]!.cells[0] = { ...cell, content: { inlines: [{ type: 'text', text: 'default code', code: true }, { type: 'text', text: 'explicit code', code: true, style: { fontFamily: 'Courier New' } }] } }
  const source = project({ table: { id: 'table', definitionId: 'guoling.table', data: table } })
  const result = await buildComponentDocx(source, { surfaceId: 'page' }), dom = body(result.bytes)
  const caption = dom.getElementsByTagNameNS(w, 'tbl')[0]!.previousElementSibling!
  expect(caption.textContent).toBe('表前题注')
  expect(caption.getElementsByTagNameNS(w, 'pStyle')[0]!.getAttributeNS(w, 'val')).toBe('Caption')
  expect(caption.getElementsByTagNameNS(w, 'keepNext')).toHaveLength(1)
  const runs = Array.from(dom.getElementsByTagNameNS(w, 'r'))
  expect(runs.find(run => run.textContent === 'default code')!.getElementsByTagNameNS(w, 'rFonts')[0]!.getAttributeNS(w, 'ascii')).toBe('Consolas')
  expect(runs.find(run => run.textContent === 'explicit code')!.getElementsByTagNameNS(w, 'rFonts')[0]!.getAttributeNS(w, 'ascii')).toBe('Courier New')
})

it('CA168 delivers healthy DOCX and PDF body when one admitted image contains bad bytes', async () => {
  const source = project({ text: { id: 'text', definitionId: 'guoling.text', data: text('健康段落不能丢失') }, bad: { id: 'bad', definitionId: 'guoling.image', data: imageDataSchema.parse({ assetId: 'bad', originalAssetId: 'bad' }), frame: frame(100, 100) } })
  const before = structuredClone(source), resolveAsset = () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' })
  const word = await buildComponentDocx(source, { surfaceId: 'page', resolveAsset })
  expect(body(word.bytes).documentElement.textContent).toContain('健康段落不能丢失')
  expect(body(word.bytes).getElementsByTagNameNS('*', 'pic')).toHaveLength(0)
  const print = await buildComponentPrintHtml(source, { surfaceId: 'page', resolveAsset })
  expect(new DOMParser().parseFromString(print.html, 'text/html').body.textContent).toContain('健康段落不能丢失'); expect(print.html).not.toContain('data:image/png;base64,AQID')
  for (const result of [word, print]) {
    expect(result.fidelity).toBe('partial')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ instanceId: 'bad', assetId: 'bad', code: 'asset-decode-failed' }))
  }
  expect(source).toEqual(before)
})

it('CA168 sync DOCX writer also isolates a malformed image without requiring an async adapter', () => {
  const result = buildFlowDocxFromPlan({ surfaceId: 'page', title: '可用', backgroundColor: '#fff', pageSize: 'A4', orientation: 'portrait', includesRuntimeToc: false, includesFloatingLayers: false, omittedFloatingLayerCount: 0,
    nodes: [{ type: 'paragraph', blockId: 'healthy', content: text('健康正文').content }, { type: 'media', blockId: 'bad', mediaKind: 'image', assetId: 'bad', fallbackLabel: '坏图', crop: { top: 0, right: 0, bottom: 0, left: 0 } }] }, { resolveAsset: () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }) })
  expect(body(result.bytes).documentElement.textContent).toContain('健康正文')
  expect(result.report).toContainEqual(expect.objectContaining({ blockId: 'bad', disposition: 'fallback' }))
})

it('CA148 keeps a 640×5000 capture readable through multiple native page pictures', async () => {
  const source = project({ long: { id: 'long', definitionId: 'program', data: {}, frame: frame(640, 5000) } }, 'flow', ['program'])
  const result = await buildComponentDocx(source, { surfaceId: 'page', captureInstance: async () => ({ bytes: png(640, 5000), mimeType: 'image/png', width: 640, height: 5000 }) }), dom = body(result.bytes)
  const pictures = Array.from(dom.getElementsByTagNameNS(wp, 'inline'))
  expect(pictures.length).toBeGreaterThan(4)
  for (const picture of pictures) {
    const extent = picture.getElementsByTagNameNS(wp, 'extent')[0]!
    expect(Number(extent.getAttribute('cx')) / 9525).toBe(560)
    expect(Number(extent.getAttribute('cy')) / 9525).toBeLessThanOrEqual(resolveFlowDocxPageBox().maxContentHeightPx - 32)
  }
  expect(Array.from(dom.getElementsByTagNameNS(w, 'br')).filter(item => item.getAttributeNS(w, 'type') === 'page')).toHaveLength(pictures.length - 1)
  const crops = Array.from(dom.getElementsByTagNameNS(a, 'srcRect'))
  expect(crops[0]!.getAttribute('t')).toBe('0'); expect(crops.at(-1)!.getAttribute('b')).toBe('0')
  for (let index = 1; index < crops.length; index++) expect(Number(crops[index]!.getAttribute('t'))).toBe(100000 - Number(crops[index - 1]!.getAttribute('b')))
})

it('CA031 keeps the full author frame when a contained floating image has an editable caption', async () => {
  const source = project({ image: { id: 'image', definitionId: 'guoling.image', data: imageDataSchema.parse({ assetId: 'art', originalAssetId: 'art', fit: 'contain' }),
    frame: frame(200, 200), flowPlacement: { space: 'paper', plane: 'overlay' }, flowLayout: { width: 'content-width', caption: text('作者题注').content } } })
  const result = await buildComponentDocx(source, { surfaceId: 'page', resolveAsset: () => ({ bytes: png(4, 2), mimeType: 'image/png' }) })
  const dom = body(result.bytes), anchor = dom.getElementsByTagNameNS(wp, 'anchor')[0]!
  expect(anchor.getElementsByTagNameNS(wp, 'extent')[0]!.getAttribute('cy')).toBe(String(200 * 9525))
  expect(anchor.getElementsByTagNameNS(w, 'txbxContent')[0]!.textContent).toContain('作者题注')
})

it('CA031 maps image contain, cover and focal alignment into native Word crop and floating geometry', async () => {
  const source = project(Object.fromEntries(['contain', 'cover', 'stretch'].map(fit => [fit, { id: fit, definitionId: 'guoling.image', data: imageDataSchema.parse({ assetId: 'art', originalAssetId: 'art', fit, cropX: 0.75 }), frame: frame(100, 100), flowPlacement: { space: 'paper', plane: 'overlay' } }])))
  const before = structuredClone(source), result = await buildComponentDocx(source, { surfaceId: 'page', resolveAsset: () => asset }), dom = body(result.bytes)
  const anchor = (id: string) => Array.from(dom.getElementsByTagNameNS(wp, 'anchor')).find(item => item.getElementsByTagNameNS(wp, 'docPr')[0]!.getAttribute('name') === id)!
  const contain = anchor('contain'), cover = anchor('cover'), stretch = anchor('stretch')
  expect(contain.getElementsByTagNameNS(wp, 'extent')[0]!.getAttribute('cy')).toBe(String(50 * 9525))
  expect(contain.getElementsByTagNameNS(wp, 'positionV')[0]!.textContent).toBe(String(45 * 9525))
  expect(cover.getElementsByTagNameNS(a, 'srcRect')[0]!.getAttribute('l')).toBe('37500')
  expect(cover.getElementsByTagNameNS(a, 'srcRect')[0]!.getAttribute('r')).toBe('12500')
  expect(stretch.getElementsByTagNameNS(wp, 'extent')[0]!.getAttribute('cy')).toBe(String(100 * 9525))
  expect(stretch.getElementsByTagNameNS(a, 'srcRect')[0]!.getAttribute('l')).toBe('0')
  expect(source).toEqual(before)
})

it('CA090 clips discarded source edges before contain margins in the actual Print img style', async () => {
  const source = project({ image: { id: 'image', definitionId: 'guoling.image', data: imageDataSchema.parse({ assetId: 'art', originalAssetId: 'art', fit: 'contain', crop: { left: 0.25, right: 0.25, top: 0, bottom: 0 } }), frame: frame(200, 100) } })
  const result = await buildComponentPrintHtml(source, { surfaceId: 'page', resolveAsset: () => ({ bytes: png(4, 2), mimeType: 'image/png' }) })
  const dom = new DOMParser().parseFromString(result.html, 'text/html'), image = dom.querySelector('figure img') as HTMLImageElement
  expect(image.style.clipPath).toBe('inset(0% 25% 0% 25%)')
  expect(image.style.left).toBe('0px'); expect(image.style.width).toBe('200px')
})

it('CA029 and CA238 Word chart retains editable data, axis range, axis visibility and circular percentages', async () => {
  const chart = createChartData(); Object.assign(chart.style, { valueMin: 10, valueMax: 100, showCategoryAxis: false, showValueAxis: false, showDataLabels: true })
  const pie = pieData(); pie.style.showDataLabels = true
  const result = await buildComponentDocx(project({ chart: { id: 'chart', definitionId: 'guoling.chart', data: chart }, pie: { id: 'pie', definitionId: 'guoling.chart', data: pie } }), { surfaceId: 'page' }), files = unzipSync(result.bytes)
  const cartesian = parse(files['word/charts/componentChart1.xml']!), circular = parse(files['word/charts/componentChart2.xml']!)
  expect(cartesian.getElementsByTagNameNS(c, 'min')[0]!.getAttribute('val')).toBe('10')
  expect(cartesian.getElementsByTagNameNS(c, 'max')[0]!.getAttribute('val')).toBe('100')
  expect(Array.from(cartesian.getElementsByTagNameNS(c, 'delete')).map(item => item.getAttribute('val'))).toEqual(['1', '1'])
  expect(circular.getElementsByTagNameNS(c, 'showPercent')[0]!.getAttribute('val')).toBe('1')
  expect(files['word/embeddings/componentChart1.xlsx']).toBeDefined(); expect(files['word/embeddings/componentChart2.xlsx']).toBeDefined()
})

it('CA089 Word uses the formal short-hex and RGB colors instead of silent black', async () => {
  const shape = defaultShapeData(); shape.style.fillColor = '#fff'; shape.style.borderColor = 'rgb(255,0,0)'
  const result = await buildComponentDocx(project({ shape: { id: 'shape', definitionId: 'guoling.shape', data: shape } }), { surfaceId: 'page' }), dom = body(result.bytes)
  expect(dom.getElementsByTagNameNS(a, 'solidFill')[0]!.getElementsByTagNameNS(a, 'srgbClr')[0]!.getAttribute('val')).toBe('FFFFFF')
  expect(dom.getElementsByTagNameNS(a, 'ln')[0]!.getElementsByTagNameNS(a, 'srgbClr')[0]!.getAttribute('val')).toBe('FF0000')
  expect(result.diagnostics).toHaveLength(0)
})

it('CA211 rich Runtime/Print cell paint consumes fill and border alpha without dimming text; zero-alpha Word stays native', async () => {
  const table = createTableData({ rows: 1, columns: 1 }); Object.assign(table.style, { fillColor: '#ff0000', fillOpacity: 0, borderColor: '#0000ff', borderOpacity: 0, textColor: '#000000' }); table.rows[0]!.cells[0]!.text = '正常黑字'
  const source = project({ table: { id: 'table', definitionId: 'guoling.table', data: table } })
  const html = outputTableHtml(table), dom = new DOMParser().parseFromString(html, 'text/html'), cell = dom.querySelector('td')!
  expect(cell.style.backgroundColor).toBe('rgba(255, 0, 0, 0)'); expect(cell.style.borderColor).toBe('rgba(0, 0, 255, 0)'); expect(cell.style.opacity).toBe(''); expect(cell.style.color).toBe('rgb(0, 0, 0)')
  const print = await buildComponentPrintHtml(source, { surfaceId: 'page' }); expect(print.html).toContain('rgba(255,0,0,0)')
  const result = await buildComponentDocx(source, { surfaceId: 'page' }), word = body(result.bytes)
  expect(word.getElementsByTagNameNS(w, 'tbl')).toHaveLength(1)
  expect(word.getElementsByTagNameNS(w, 'shd')[0]!.getAttributeNS(w, 'val')).toBe('nil')
  expect(word.getElementsByTagNameNS(w, 'tcBorders')[0]!.children[0]!.getAttributeNS(w, 'val')).toBe('nil')
  expect(word.documentElement.textContent).toContain('正常黑字')
})

it('CA211 partial-alpha Word table stays editable with the actual target-format difference', async () => {
  const table = createTableData({ rows: 1, columns: 1 }); table.style.fillOpacity = 0.5
  const capture = vi.fn(async () => ({ ...asset, width: 200, height: 40 }))
  const result = await buildComponentDocx(project({ table: { id: 'table', definitionId: 'guoling.table', data: table } }), { surfaceId: 'page', captureInstance: capture })
  expect(capture).not.toHaveBeenCalled(); expect(body(result.bytes).getElementsByTagNameNS(w, 'tbl')).toHaveLength(1)
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ instanceId: 'table', code: 'word-table-alpha-limitation', message: expect.stringContaining('保留 RGB 与可编辑表格') })); expect(result.fidelity).toBe('partial')
})

it('CA352 preserves authored numbering starts alongside independent native list identities', async () => {
  const result = await buildComponentDocx(project({ list: { id: 'list', definitionId: 'guoling.document-block', data: { type: 'list', ordered: true, start: 5,
    items: ['五', '六'].map((value, index) => ({ id: `item${index}`, content: text(value).content })) } } }), { surfaceId: 'page' })
  const numbering = parse(unzipSync(result.bytes)['word/numbering.xml']!)
  expect(numbering.getElementsByTagNameNS(w, 'startOverride')[0]!.getAttributeNS(w, 'val')).toBe('5')
  expect(body(result.bytes).getElementsByTagNameNS(w, 'numPr')).toHaveLength(2)
})

it('CA030 missing opacity capture diagnoses the actual absence without claiming pixels were used', async () => {
  const result = await buildComponentDocx(project({ text: { id: 'text', definitionId: 'guoling.text', data: text('原文'), style: { opacity: 0.5 } } }), { surfaceId: 'page' })
  expect(result.diagnostics.find(value => value.code === 'word-opacity-capture')!.message).toContain('未取得实际图面')
  expect(result.diagnostics.some(value => value.message.includes('采用实际'))).toBe(false)
})

it('CA030 zero opacity emits no visible Word text and applies once to semantic Print text', async () => {
  const source = project({ invisible: { id: 'invisible', definitionId: 'guoling.text', data: text('此字不能显示'), style: { opacity: 0 } }, healthy: { id: 'healthy', definitionId: 'guoling.text', data: text('正常文字') } })
  const before = structuredClone(source), word = await buildComponentDocx(source, { surfaceId: 'page' })
  expect(body(word.bytes).documentElement.textContent).not.toContain('此字不能显示'); expect(body(word.bytes).documentElement.textContent).toContain('正常文字')
  const print = await buildComponentPrintHtml(source, { surfaceId: 'page' }), dom = new DOMParser().parseFromString(print.html, 'text/html')
  expect((dom.querySelector('[data-component-output="invisible"] > div') as HTMLElement).style.opacity).toBe('0')
  expect(source).toEqual(before)
})

it('CA030 PPTX captured instance opacity is baked once and ancestor opacity is applied once', async () => {
  const source = project({ group: { id: 'group', definitionId: 'guoling.group', data: {}, style: { opacity: 0.5 }, frame: frame(200, 200), childIds: ['source'] }, source: { id: 'source', definitionId: 'program', data: {}, style: { opacity: 0.5 }, frame: frame(100, 100) } }, 'slide', ['program'])
  testContainerInstance(source, 0).childIds = ['group']
  const result = await buildComponentPptx(source, { captureInstance: async () => bytesToDataUrl(asset.bytes, asset.mimeType) }), dom = parse(unzipSync(result.bytes)['ppt/slides/slide1.xml']!)
  expect(dom.getElementsByTagNameNS(a, 'alphaModFix')[0]!.getAttribute('amt')).toBe('50000')
})

it('CA030 ancestor opacity zero keeps nested native and captured children invisible without capture work', async () => {
  const source = project({ group: { id: 'group', definitionId: 'guoling.group', data: {}, style: { opacity: 0 }, frame: frame(200, 100), childIds: ['child'] },
    child: { id: 'child', definitionId: 'guoling.text', data: text('隐藏祖先中的文字'), frame: frame(100, 100) } })
  const word = await buildComponentDocx(source, { surfaceId: 'page' })
  expect(body(word.bytes).documentElement.textContent).not.toContain('隐藏祖先中的文字')
  const print = await buildComponentPrintHtml(source, { surfaceId: 'page' }), dom = new DOMParser().parseFromString(print.html, 'text/html')
  expect((dom.querySelector('[data-component-output="child"] > div') as HTMLElement).style.opacity).toBe('0')
  const capture = vi.fn(async () => bytesToDataUrl(asset.bytes, asset.mimeType))
  const slide = project({ group: { ...source.instances.group!, childIds: ['child'] }, child: { ...source.instances.child!, definitionId: 'program' } }, 'slide', ['program'])
  const result = await buildComponentPptx(slide, { captureInstance: capture })
  expect(capture).not.toHaveBeenCalled(); expect(parse(unzipSync(result.bytes)['ppt/slides/slide1.xml']!).getElementsByTagNameNS('*', 'pic')).toHaveLength(0)
})

it('CA238 PPTX pie keeps percent and decimal label format plus its editable workbook', async () => {
  const chart = pieData(); chart.style.showDataLabels = true; chart.series[0]!.points[0]!.value = 0.2; chart.series[0]!.points[1]!.value = 0.35
  const result = await buildComponentPptx(project({ chart: { id: 'chart', definitionId: 'guoling.chart', data: chart, frame: frame(400, 300) } }, 'slide')), files = unzipSync(result.bytes), dom = parse(files['ppt/charts/chart1.xml']!)
  expect(dom.getElementsByTagNameNS(c, 'showPercent')[0]!.getAttribute('val')).toBe('1')
  const formats = Array.from(dom.getElementsByTagNameNS(c, 'dLbls')).flatMap(item => Array.from(item.getElementsByTagNameNS(c, 'numFmt'))).map(item => item.getAttribute('formatCode'))
  expect(formats).toContain('General'); expect(formats).not.toContain('#,##0')
  expect(Object.keys(files).some(name => name.startsWith('ppt/embeddings/'))).toBe(true)
})

it('CA247 PPTX single-cell font scales with the same effective frame as global font', async () => {
  const table = createTableData({ rows: 1, columns: 2 }); table.rows[0]!.cells[0]!.text = '全局'; table.rows[0]!.cells[1]!.text = '单格'; table.rows[0]!.cells[1]!.style = { fontSize: 24 }
  const before = structuredClone(table), result = await buildComponentPptx(project({ table: { id: 'table', definitionId: 'guoling.table', data: table, frame: frame(400, 80, [2, 0, 0, 2, 0, 0]) } }, 'slide')), dom = parse(unzipSync(result.bytes)['ppt/slides/slide1.xml']!)
  const paragraph = (value: string) => Array.from(dom.getElementsByTagNameNS(a, 'p')).find(item => item.textContent === value)!
  expect(paragraph('全局').getElementsByTagNameNS(a, 'rPr')[0]!.getAttribute('sz')).toBe('2400')
  expect(paragraph('单格').getElementsByTagNameNS(a, 'rPr')[0]!.getAttribute('sz')).toBe('3600')
  expect(table).toEqual(before)
})

it('CA252 Word floating text retains editable text, fill, border and padding', async () => {
  const source = project({ text: { id: 'text', definitionId: 'guoling.text', data: { ...text('可编辑文字'), appearance: { backgroundColor: '#ff0000', backgroundOpacity: 1, borderColor: '#0000ff', borderWidth: 4, borderOpacity: 1, padding: 20 } }, frame: frame(180, 80), flowPlacement: { space: 'paper', plane: 'overlay' } } })
  const result = await buildComponentDocx(source, { surfaceId: 'page' }), dom = body(result.bytes), shape = dom.getElementsByTagNameNS('*', 'wsp')[0]!
  expect(shape.getElementsByTagNameNS(a, 'srgbClr')[0]!.getAttribute('val')).toBe('FF0000')
  expect(shape.getElementsByTagNameNS(a, 'ln')[0]!.getAttribute('w')).toBe(String(4 * 9525))
  expect(shape.getElementsByTagNameNS(a, 'ln')[0]!.getElementsByTagNameNS(a, 'srgbClr')[0]!.getAttribute('val')).toBe('0000FF')
  expect(shape.getElementsByTagNameNS('*', 'bodyPr')[0]!.getAttribute('lIns')).toBe(String(20 * 9525))
  expect(shape.getElementsByTagNameNS(w, 't')[0]!.textContent).toBe('可编辑文字')
})

it('CA032 and CA179 project shear captures into the authored AABB rather than a wrong Office rectangle', async () => {
  const drawing = mockBitmapProjection(), matrix: [number, number, number, number, number, number] = [1, 0, 0.5, 1, 10, 20]
  const instance = { id: 'source', definitionId: 'program', data: {}, frame: frame(100, 100, matrix) }
  const pptxCapture = vi.fn(async () => bytesToDataUrl(png(100, 100), 'image/png'))
  const presentation = await buildComponentPptx(project({ source: instance }, 'slide', ['program']), { captureInstance: pptxCapture }), slide = parse(unzipSync(presentation.bytes)['ppt/slides/slide1.xml']!)
  expect(pptxCapture).toHaveBeenCalledOnce(); expect(slide.getElementsByTagNameNS('*', 'pic')).toHaveLength(1)
  const pictureFrame = slide.getElementsByTagNameNS('*', 'pic')[0]!.getElementsByTagNameNS(a, 'xfrm')[0]!
  expect(pictureFrame.getElementsByTagNameNS(a, 'ext')[0]!.getAttribute('cx')).toBe(String(150 * 9525))
  expect(pictureFrame.getElementsByTagNameNS(a, 'off')[0]!.getAttribute('x')).toBe(String(10 * 9525))
  const wordCapture = vi.fn(async () => ({ bytes: png(100, 100), mimeType: 'image/png', width: 100, height: 100 }))
  const document = await buildComponentDocx(project({ source: { ...instance, flowPlacement: { space: 'paper', plane: 'overlay' } } }, 'flow', ['program']), { surfaceId: 'page', captureInstance: wordCapture }), word = body(document.bytes)
  expect(wordCapture).toHaveBeenCalledOnce()
  expect(word.getElementsByTagNameNS(wp, 'anchor')[0]!.getElementsByTagNameNS(wp, 'extent')[0]!.getAttribute('cx')).toBe(String(150 * 9525))
  expect(word.getElementsByTagNameNS(wp, 'positionH')[0]!.textContent).toBe(String(10 * 9525))
  expect(drawing.transforms).toEqual([[1, 0, 0.5, 1, 0, 0], [1, 0, 0.5, 1, 0, 0]])
  expect(drawing.draws).toHaveLength(2)
  expect(affineOutputBounds({ width: 100, height: 100 }, matrix)).toEqual({ x: 10, y: 20, width: 150, height: 100 })
})
