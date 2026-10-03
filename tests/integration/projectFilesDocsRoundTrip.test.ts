// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { alignFlowBlocks, parseFlowHtml, serializeFlowHtml, type FlowHtmlContext } from '../../src/core/projectFiles/flowHtml'
import { walkFlowBlocks } from '../../src/core/tools/flowDocumentModel'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseAssetMeta, FlowBlock, FlowSurfaceDocument } from '../../src/shared/courseProjectTypes'
import type { DocumentModel } from '../../src/shared/workbench/document'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
const driver = new CourseV9Driver()
const fixture = () => driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/flow.h5lesson'))) as CourseModel
const flowOf = (model: CourseModel) => model.project.surfaces.find((surface): surface is FlowSurfaceDocument => surface.type === 'flow')!

const PHOTO: CourseAssetMeta = { id: 'photo', filename: '地球.png', mimeType: 'image/png', kind: 'image', path: 'assets/地球.png', byteLength: 10, width: 4, height: 3 }
const text = (value: string, style?: Record<string, unknown>) => ({ type: 'text' as const, text: value, ...(style ? { style } : {}) })

/** Every block type with the fields a stored handout can carry, styles and formulas included. */
const RICH: FlowBlock[] = [
  { id: 'flow-heading', type: 'heading', level: 1, content: { inlines: [text('四季的成因', { bold: true })] }, textAlign: 'center' },
  { id: 'p-1', type: 'paragraph', lineSpacing: 1.5, content: { inlines: [
    text('地轴倾斜约 '), { type: 'math', formulaId: 'f-tilt', latex: '\\theta\\approx 23.5', accessibleText: '约二十三点五度' },
    text('，', { color: '#B91C1C' }), text('太阳高度', { bold: true, italic: true }), text('随季节变化', { underline: true, highlightColor: '#fef08a' }),
    text('；着重', { emphasis: true }), text('不加粗', { bold: false, italic: false, underline: false }), text('上标', { baseline: 0.3, fontSize: 12 }),
    text('字体', { fontFamily: '"KaiTi", serif' }), text('无底色', { highlightColor: null }), text('代码', { strike: true }),
    { type: 'text', text: 'a < b && c', code: true }, { type: 'text', text: '链接', link: { href: 'https://example.org', title: '例' } },
    text('第一行\n第二行  两个空格 '),
    { type: 'math', formulaId: 'f-e', latex: 'E=mc^2', accessibleText: 'E 等于 m c 平方', style: { color: '#1d4ed8' } },
  ] } },
  { id: 'q-1', type: 'quote', content: { inlines: [text('地球公转一周约 365 天。')] }, citation: { inlines: [text('地理课本')] } },
  { id: 'l-1', type: 'list', ordered: false, items: [{ id: 'i-1', content: { inlines: [text('春分')] } }, { id: 'i-2', content: { inlines: [text('夏至 '), { type: 'math', formulaId: 'f-li', latex: 'x^2', accessibleText: 'x 的平方' }] } }] },
  { id: 'd-1', type: 'divider' },
  { id: 'm-1', type: 'media', assetId: 'photo', mediaKind: 'image', altText: '地球照片', caption: { inlines: [text('图 1 地球')] }, layout: 'wide', wrap: 'left', crop: { left: 0.1, top: 0, right: 0, bottom: 0.2 } },
  { id: 't-1', type: 'table', headerEnabled: true, caption: { inlines: [text('昼夜长短')] },
    columns: [{ id: 'c-1', header: { inlines: [text('节气')] } }, { id: 'c-2', header: { inlines: [text('北京')] } }, { id: 'c-3', header: { inlines: [text('悉尼')] } }],
    rows: [
      { id: 'r-1', cells: { 'c-1': { inlines: [text('夏至')] }, 'c-2': { inlines: [text('昼长')] }, 'c-3': { inlines: [text('昼短')] } } },
      { id: 'r-2', cells: { 'c-1': { inlines: [text('冬至')] }, 'c-2': { inlines: [text('昼短夜长，两地相反')] }, 'c-3': { inlines: [] } } },
    ],
    merges: [{ rowIds: ['r-2'], columnIds: ['c-2', 'c-3'] }] },
  { id: 'fm-1', type: 'formula', formulaId: 'f-block', latex: '\\frac{a}{b}', accessibleText: '分式（a）除以（b）', style: { fontSize: 24 } },
  { id: 'code-1', type: 'code', code: '\nconst tilt = 23.5\n  return tilt', language: 'js' },
  { id: 'co-1', type: 'callout', tone: 'warning', title: { inlines: [text('注意')] }, body: { inlines: [text('不要直视太阳。')] } },
  { id: 's-1', type: 'section', title: { inlines: [text('拓展阅读')] }, collapsedByDefault: true, blocks: [
    { id: 's-p', type: 'paragraph', content: { inlines: [] } },
    { id: 's-h', type: 'heading', level: 3, content: { inlines: [text('极昼')] } },
  ] },
]

function richModel(): CourseModel {
  const model = fixture()
  const surface = flowOf(model)
  surface.blocks = structuredClone(RICH)
  model.project.assets.photo = PHOTO
  model.resources.assets.photo = new Uint8Array(10)
  return { ...model, project: courseProjectDocumentSchema.parse(model.project) }
}
const context = (model: CourseModel): FlowHtmlContext => ({ assets: model.project.assets, packageName: id => model.project.componentPackages[id]?.name ?? id })
function roundTrip(model: CourseModel, html: string) {
  const surface = flowOf(model)
  const parsed = parseFlowHtml(html, { parse: parseWebComposition, assets: model.project.assets })
  return { ...alignFlowBlocks(parsed.blocks, surface.blocks, context(model)), diagnostics: parsed.diagnostics }
}
const ids = (blocks: readonly FlowBlock[]) => {
  const found: string[] = []
  walkFlowBlocks(blocks, block => {
    found.push(block.id)
    if (block.type === 'list') found.push(...block.items.map(item => item.id))
    if (block.type === 'table') found.push(...block.columns.map(column => column.id), ...block.rows.map(row => row.id))
    if (block.type === 'formula') found.push(block.formulaId)
  })
  return found
}

describe('handout file round trip', () => {
  it('reads the stored Flow fixture back with zero changes', () => {
    const model = fixture(), surface = flowOf(model)
    const html = serializeFlowHtml(surface, context(model))
    const result = roundTrip(model, html)
    expect(result.diagnostics).toEqual([])
    expect(result.blocks).toEqual(surface.blocks)
  })

  it('round-trips every block type, style and formula without identities in the file', () => {
    const model = richModel(), surface = flowOf(model)
    const html = serializeFlowHtml(surface, context(model))
    expect(html).not.toMatch(/"(?:h|p|q|l|i|t|c|r|s|f|m|d|co|fm|code)-[\w-]+"|f-tilt|formulaId/)
    expect(html).toContain('\\(\\theta\\approx 23.5\\)')
    expect(html).toContain('src="../assets/地球.png"')
    expect(html).toContain('colspan="2"')
    expect(html).toContain('<details>')
    const result = roundTrip(model, html)
    expect(result.diagnostics).toEqual([])
    expect(result.blocks).toEqual(surface.blocks)
    expect(result.blocks[0]).toBe(surface.blocks[0])
    expect(serializeFlowHtml({ ...surface, blocks: result.blocks }, context(model))).toBe(html)
  })

  it('keeps every block, item, row, column and formula identity through local edits', () => {
    const model = richModel(), surface = flowOf(model)
    const html = serializeFlowHtml(surface, context(model))
    const edited = html.replace('地球公转一周约 365 天。', '地球公转一周约 365.25 天。').replace('<li>春分</li>', '<li>春分（3 月）</li>')
      .replace('<td>昼长</td>', '<td>昼最长</td>').replace('\\(x^2\\)', '\\(x^3\\)').replace('<h3>极昼</h3>', '<h3>极昼与极夜</h3>')
    const result = roundTrip(model, edited)
    expect(ids(result.blocks)).toEqual(ids(surface.blocks))
    const list = result.blocks.find(block => block.id === 'l-1')
    expect(list?.type === 'list' && list.items[1]!.content.inlines.find(inline => inline.type === 'math')).toMatchObject({ formulaId: 'f-li', latex: 'x^3' })
    const unchanged = surface.blocks.filter(block => ['flow-heading', 'p-1', 'd-1', 'm-1', 'fm-1', 'code-1', 'co-1'].includes(block.id))
    for (const block of unchanged) expect(result.blocks.find(value => value.id === block.id)).toBe(block)
  })

  it('reads natural model HTML as Flow blocks', () => {
    const model = richModel()
    const html = `<!doctype html><html><head><style>p { color: red }</style></head><body><main>
      <h1>地球公转</h1>
      <p>
        太阳直射点在 <strong>南北回归线</strong> 之间移动，
        角度约为 \\(\\theta\\approx 23.5\\)。
      </p>
      <p><img src="../assets/地球.png" alt="地球"></p>
      <ol><li>春分</li><li>夏至<ul><li>北半球昼最长</li></ul></li></ol>
      <table><tr><th>节气</th><th>日期</th></tr><tr><td rowspan="2">二分</td><td>3 月</td></tr><tr><td>9 月</td></tr></table>
      <aside data-tone="example"><header>例题</header><p>估算正午太阳高度。</p></aside>
      <details open><summary>拓展</summary><p>极昼现象。</p></details>
      <p>\\[a^2+b^2=c^2\\]</p>
      <figure><img src="../assets/不存在.svg" alt="缺图"></figure>
      <svg><circle r="3"/></svg>
    </main></body></html>`
    const parsed = parseFlowHtml(html, { parse: parseWebComposition, assets: model.project.assets })
    expect(parsed.blocks.map(block => block.type)).toEqual(['heading', 'paragraph', 'media', 'list', 'table', 'callout', 'section', 'formula'])
    const paragraph = parsed.blocks[1]!
    expect(paragraph.type === 'paragraph' && paragraph.content.inlines).toMatchObject([
      { type: 'text', text: '太阳直射点在 ' }, { type: 'text', text: '南北回归线', style: { bold: true } }, { type: 'text', text: ' 之间移动，角度约为 ' },
      { type: 'math', latex: '\\theta\\approx 23.5' }, { type: 'text', text: '。' }])
    const list = parsed.blocks[3]!
    expect(list.type === 'list' && list.items.map(item => item.content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join(''))).toEqual(['春分', '夏至', '北半球昼最长'])
    const table = parsed.blocks[4]!
    expect(table.type === 'table' && table.merges).toEqual([{ rowIds: [table.type === 'table' ? table.rows[0]!.id : '', table.type === 'table' ? table.rows[1]!.id : ''], columnIds: [table.type === 'table' ? table.columns[0]!.id : ''] }])
    expect(parsed.diagnostics.map(item => item.code).sort()).toEqual(['flow-missing-asset', 'flow-nested-list', 'flow-style', 'flow-unsupported'])
  })
})
