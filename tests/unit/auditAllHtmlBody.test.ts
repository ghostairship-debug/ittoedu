import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { createTestProjectFromLegacy, testContainerInstance } from '../helpers/glxWorkFixture'
import { describe, expect, it } from 'vitest'
import { parseFlowHtml, alignFlowBlocks, blockHtml } from '../../src/shared/document/html'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { flowDocumentEdits, projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createImageData, imageDataSchema, restoreImageOriginal } from '../../src/components/image/data'
import { IMAGE_DEFINITION } from '../../src/components/image'
import { createChartData } from '../../src/components/chart/data'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentBlock, FlowTextContent } from '../../src/shared/document/content'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { toEditorDocument, fromEditorDocument, renewEditorIdentities } from '../../src/renderer/document/documentAdapter'
import { EditorState, TextSelection } from 'prosemirror-state'
import { splitBlock } from 'prosemirror-commands'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { TABLE_DEFINITION } from '../../src/components/table/adapters'
import { flowInlineStyleDefaults } from '../../src/renderer/ui/flow/flowInlineStyleDefaults'

const text = (content: FlowTextContent) => content.inlines.map(inline => inline.type === 'text' ? inline.text : inline.type === 'math' ? inline.latex : inline.accessibleText).join('')
const project = (): CourseProjectV10 => (createTestProjectFromLegacy({ schemaVersion: 10, id: 'html', revision: 0, title: 'HTML', definitions: {}, instances: {},
  surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }], global: { underlay: [], overlay: [] }, assets: {} }))
const parsed = (html: string, assets: CourseProjectV10['assets'] = {}) => parseFlowHtml(html, { assets })
function apply(p: CourseProjectV10, html: string, instanceByPath?: (path: string) => string) {
  const result = parseFlowHtml(html, { assets: p.assets, instanceByPath })
  const aligned = alignFlowBlocks(result.blocks, projectFlowDocument(p, 'flow').content.blocks, { assets: p.assets, packageName: () => '', instanceHtml: id => `<guoling-instance path="${id}"></guoling-instance>` })
  return applyComponentOperation(p, captureComponentOperation(p, flowDocumentEdits(p, 'flow', aligned.blocks)))
}

describe('R34–R36 HTML body counterexamples', () => {
  it('CA210 keeps every row of a multi-row header in the formal table', () => {
    const p = apply(project(), '<table><thead><tr><th>GROUP</th><th>VALUE</th></tr><tr><th>SUB-A</th><th>SUB-B</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>')
    const [table] = projectFlowDocument(p, 'flow').content.blocks
    expect(table.type).toBe('table')
    if (table.type !== 'table') throw new Error('table')
    expect(table.rows.map(row => table.columns.map(col => text(row.cells[col.id])))).toEqual([['GROUP', 'VALUE'], ['SUB-A', 'SUB-B'], ['A', 'B']])
  })
  it('CA298 preserves mixed quote and callout text in DOM order', () => {
    const [quote, callout] = parsed('<blockquote>开头<p>中间</p><span>结尾</span></blockquote><aside><header>提示</header>首字<p>中心</p><span>尾字</span></aside>').blocks
    expect(quote.type === 'quote' && text(quote.content)).toBe('开头\n中间\n结尾')
    expect(callout.type === 'callout' && text(callout.body)).toBe('首字\n中心\n尾字')
  })
  it('CA314 commits a valid image inside quote content', () => {
    const p = project(); p.assets.a = { id: 'a', path: 'assets/a.png', kind: 'image' }
    const next = apply(p, '<blockquote><p>正文<img src="assets/a.png"></p></blockquote>')
    expect(projectFlowDocument(next, 'flow').content.blocks.some(block => block.type === 'media' && block.assetId === 'a')).toBe(true)
  })
  it('CA334 carries a direct caption through a unique wrapped image', () => {
    const p = project(); p.assets.a = { id: 'a', path: 'assets/a.png', kind: 'image' }
    const next = apply(p, '<figure><div><img src="assets/a.png" alt="关系图"></div><figcaption>关键说明</figcaption></figure>')
    const [media] = projectFlowDocument(next, 'flow').content.blocks
    expect(media.type === 'media' && text(media.caption!)).toBe('关键说明')
  })
  it('CA334 preserves text before and after a captioned wrapped media in source order', () => {
    const p = project(); p.assets.a = { id: 'a', path: 'assets/a.png', kind: 'image' }
    const next = apply(p, '<figure><p>前文</p><div><img src="assets/a.png"></div><p>后文</p><figcaption>图注</figcaption></figure>')
    const blocks = projectFlowDocument(next, 'flow').content.blocks
    expect(blocks.map(block => block.type)).toEqual(['paragraph', 'media', 'paragraph'])
    expect(blocks[0].type === 'paragraph' && text(blocks[0].content)).toBe('前文')
    expect(blocks[1].type === 'media' && text(blocks[1].caption!)).toBe('图注')
    expect(blocks[2].type === 'paragraph' && text(blocks[2].content)).toBe('后文')
  })
  it('CA343 resolves rowspan zero only through the remaining row group', () => {
    const [table] = parsed('<table><tbody><tr><td rowspan="0">甲组</td><td>一</td></tr><tr><td>二</td></tr><tr><td>三</td></tr></tbody><tbody><tr><td>乙组</td><td>四</td></tr></tbody></table>').blocks
    if (table.type !== 'table') throw new Error('table')
    expect(table.rows.map(row => table.columns.map(col => text(row.cells[col.id])))).toEqual([['甲组', '一'], ['', '二'], ['', '三'], ['乙组', '四']])
    expect(table.merges?.[0].rowIds).toEqual(table.rows.slice(0, 3).map(row => row.id))
  })
  it('CA344 starts a new recoverable original only when the source changes', () => {
    const p = project(); p.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
    p.assets.a = { id: 'a', path: 'assets/a.png', kind: 'image' }; p.assets.b = { id: 'b', path: 'assets/b.png', kind: 'image' }
    p.instances.image = { id: 'image', definitionId: IMAGE_DEFINITION.id, data: createImageData('a') as any }; testContainerInstance(p, 0).childIds = ['image']
    const next = apply(p, '<img src="assets/b.png">')
    expect(restoreImageOriginal(imageDataSchema.parse(next.instances.image.data)).assetId).toBe('b')
  })
  it('CA357 changes paragraph to heading in place, retaining identity and click rules', () => {
    const p = project(); p.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    p.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('原文') as any, frame: { width: 220, height: 80, transform: [1, 0, 0, 1, 8, 9] } }
    testContainerInstance(p, 0).childIds = ['body']
    const target = { kind: 'surface' as const, surfaceId: 'flow' }
    const withRule = applyComponentOperation(p, captureComponentOperation(p, componentRuleEdits(p, target, [{ id: 'rule', enabled: true, trigger: { type: 'node.click', nodeId: 'body' }, conditions: [], actions: [{ id: 'action', start: 'after-previous', delayMs: 0, action: { type: 'location.go', locationId: 'flow' } }] }])))
    const next = apply(withRule, '<h2>原文</h2>')
    expect(componentSurfaces(next)[0].childIds[0]).toBe('body'); expect(next.instances.body.frame).toEqual(p.instances.body.frame)
    expect(interactionRules(interactionBehavior(next, target))).toEqual(interactionRules(interactionBehavior(withRule, target)))
    expect(projectFlowDocument(next, 'flow').content.blocks[0].type).toBe('heading')
  })
  it('CA365 submits framed opaque objects across a section parent with their frame', () => {
    const p = project(); p.definitions.custom = { id: 'custom', title: 'Object', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default ()=>{}' } }
    p.instances.object = { id: 'object', definitionId: 'custom', data: {}, frame: { width: 220, height: 140, transform: [1, 0, 0, 1, 0, 0] } }; testContainerInstance(p, 0).childIds = ['object']
    const next = apply(p, '<details open><summary>节</summary><guoling-instance path="object"></guoling-instance></details>', path => path)
    expect(next.instances[componentSurfaces(next)[0].childIds[0]].childIds).toEqual(['object']); expect(next.instances.object.frame).toEqual(p.instances.object.frame)
    const again = apply(next, '<guoling-instance path="object"></guoling-instance>', path => path)
    expect(componentSurfaces(again)[0].childIds).toEqual(['object'])
  })
  it('CA378 maintains chart height in the existing formal frame', () => {
    const block: DocumentBlock = { id: 'chart', type: 'chart', chart: createChartData(), height: 600 }
    const next = apply(project(), blockHtml(block, { assets: {}, packageName: () => '' }))
    const id = componentSurfaces(next)[0].childIds[0]
    expect(next.instances[id].frame?.height).toBe(600)
    expect(projectFlowDocument(next, 'flow').content.blocks[0]).toMatchObject({ type: 'chart', height: 600 })
  })
  it('CA282 maps CSS line height to the supported additional pixel gap and round trips zero', () => {
    const [block] = parsed('<p style="line-height:1.6">正文</p>').blocks
    expect(block).toMatchObject({ lineSpacing: 9.12 })
    for (const spacing of [0, 12, 20]) {
      const html = blockHtml({ id: 'p', type: 'paragraph', content: { inlines: [] }, lineSpacing: spacing }, { assets: {}, packageName: () => '' })
      expect(parsed(html).blocks[0]).toMatchObject({ lineSpacing: spacing })
    }
  })
  it('CA301 inherits paragraph font defaults and resolves child em against its parent', () => {
    const [block] = parsed('<p style="font-size:40px;color:red;font-weight:bold">甲<span style="font-size:0.5em;color:blue">乙</span></p>').blocks
    if (block.type !== 'paragraph') throw new Error('paragraph')
    expect(block.content.inlines).toMatchObject([{ text: '甲', style: { fontSize: 40, color: '#ff0000', bold: true } }, { text: '乙', style: { fontSize: 20, color: '#0000ff', bold: true } }])
  })
  it('CA315 explicit normal overrides strong and em defaults', () => {
    const [block] = parsed('<p><strong style="font-weight:normal">甲</strong><em style="font-style:normal">乙</em></p>').blocks
    if (block.type !== 'paragraph') throw new Error('paragraph')
    expect(block.content.inlines).toMatchObject([{ text: '甲', style: { bold: false } }, { text: '乙', style: { italic: false } }])
  })
  it('CA316 normalizes named foreground and highlight colors', () => {
    const [block] = parsed('<p><span style="color:red;background-color:yellow">红字黄底</span></p>').blocks
    if (block.type !== 'paragraph') throw new Error('paragraph')
    expect(block.content.inlines[0]).toMatchObject({ style: { color: '#ff0000', highlightColor: '#ffff00' } })
  })
  it('CA335 deleting observed alignment and gap clears only those presentation fields', () => {
    const p = project(); p.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const data = createTextComponentData('保留正文'); data.appearance.align = 'center'; data.appearance.lineSpacing = 20; data.appearance.fontSize = 37
    p.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: data as any }; testContainerInstance(p, 0).childIds = ['body']
    const next = apply(p, '<p>保留正文</p>')
    expect(textComponentDataSchema.parse(next.instances.body.data).appearance).toMatchObject({ align: 'left', fontSize: 37 })
    expect(textComponentDataSchema.parse(next.instances.body.data).appearance.lineSpacing).toBeUndefined()
  })
  it('CA379 formula inherits supported font size and color, including explicit overrides', () => {
    const [block] = parsed('<p><span style="font-size:40px;color:red">文字<span class="math">\\(x\\)</span><span class="math" style="font-size:20px;color:blue">\\(y\\)</span></span></p>').blocks
    if (block.type !== 'paragraph') throw new Error('paragraph')
    expect(block.content.inlines.filter(inline => inline.type === 'math')).toMatchObject([{ style: { fontSize: 40, color: '#ff0000' } }, { style: { fontSize: 20, color: '#0000ff' } }])
  })
  it('CA290 preserves text defaults through actual PM paragraph splitting and canonical creation', () => {
    const p = project(); p.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const data = createTextComponentData('ABCD'); data.appearance.fontSize = 37; data.appearance.color = '#123456'; data.appearance.bold = true
    p.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: data as any }; testContainerInstance(p, 0).childIds = ['body']
    const doc = toEditorDocument(projectFlowDocument(p, 'flow').content)
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) })
    expect(splitBlock(state, transaction => { state = state.apply(transaction) })).toBe(true)
    const split = fromEditorDocument(renewEditorIdentities(state.doc, () => 'right'))
    const next = applyComponentOperation(p, captureComponentOperation(p, flowDocumentEdits(p, 'flow', split.blocks)))
    expect(componentSurfaces(next)[0].childIds).toEqual(['body', 'right'])
    expect(textComponentDataSchema.parse(next.instances.right.data).appearance).toMatchObject({ fontSize: 37, color: '#123456', bold: true })
  })
  it('CA313 commits a default three-row table without a synthetic editable header', () => {
    const p = project(); p.definitions[TABLE_DEFINITION.id] = TABLE_DEFINITION
    p.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id, data: createTableData({ rows: 3, columns: 3 }) as any }; testContainerInstance(p, 0).childIds = ['table']
    const body = projectFlowDocument(p, 'flow').content, doc = toEditorDocument(body)
    let rows = 0; doc.descendants(node => { if (node.type.name === 'table_row') rows++ })
    expect(rows).toBe(3)
    let target = -1; doc.descendants((node, pos) => { if (target < 0 && node.type.name === 'slot') target = pos + 1 })
    let state = EditorState.create({ doc }); state = state.apply(state.tr.insertText('首行', target))
    const next = applyComponentOperation(p, captureComponentOperation(p, flowDocumentEdits(p, 'flow', fromEditorDocument(state.doc).blocks)))
    const table = parseTableData(next.instances.table.data)
    expect(table.rows).toHaveLength(3); expect(text(table.rows[0].cells[0].content!)).toBe('首行')
  })
  it('CA347 derives cell and header toggles from their actual effective table slots', () => {
    const p = project(); p.definitions[TABLE_DEFINITION.id] = TABLE_DEFINITION
    const data = createTableData({ rows: 1, columns: 1 }); data.rows[0].cells[0].style = { bold: true, italic: true, fontSize: 31, textColor: '#123456' }; data.columns[0].header = { inlines: [{ type: 'text', text: '表头' }] }
    p.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id, data: data as any }
    expect(flowInlineStyleDefaults(p, 'table', { blockId: 'table', slot: { kind: 'cell', rowId: data.rows[0].id, columnId: data.columns[0].id }, offset: 0, affinity: 'after' })).toMatchObject({ bold: true, italic: true, fontSize: 31, color: '#123456' })
    expect(flowInlineStyleDefaults(p, 'table', { blockId: 'table', slot: { kind: 'header', columnId: data.columns[0].id }, offset: 0, affinity: 'after' })).toMatchObject({ bold: true, fontSize: data.style.fontSize })
  })
})
