import type { DocumentBlock, FlowTextContent } from '../../../src/shared/document/content'
import type { MarkdownDocument } from '../../../src/shared/document/markdown'
export const body = (text: string): FlowTextContent => ({ inlines: text ? [{ type: 'text', text }] : [] })
export function sharedDocumentFixture(): MarkdownDocument {
  const blocks: DocumentBlock[] = [
    { id: 'title', type: 'heading', level: 2, textAlign: 'center', lineSpacing: 1.5, content: body('欧姆定律') },
    { id: 'paragraph', type: 'paragraph', content: { inlines: [
      { type: 'text', text: '电流😀', style: { fontSize: 20, color: '#b91c1c', fontFamily: 'Noto Sans SC', baseline: 0.2, bold: true, italic: false, underline: true, strike: false, emphasis: true, highlightColor: '#ffff00' } },
      { type: 'math', formulaId: 'inline-ohm', latex: String.raw`I=\frac{U}{R}`, accessibleText: '电流等于电压除以电阻', style: { fontSize: 24, color: '#333333' }, link: { href: 'https://example.org/ohm', title: '公式' } },
      { type: 'text', text: '价格 $5、\\、[方括号]、<!--cw:block -->。\n下一行。' },
      { type: 'text', text: 'x = `$`', code: true, style: { bold: true }, link: { href: 'notes.md', title: '代码 "示例"' } },
    ] } },
    { id: 'quote', type: 'quote', content: body('电压与电流'), citation: body('实验记录') },
    { id: 'steps', type: 'list', ordered: false, items: [{ id: 'step-1', content: body('测量电压') }, { id: 'step-2', content: body('计算电流') }] },
    { id: 'simple-table', type: 'table', columns: [{ id: 'c-u', header: body('电压') }, { id: 'c-i', header: body('电流') }], rows: [{ id: 'r-1', cells: { 'c-u': body('6 V'), 'c-i': body('0.3 A') } }] },
    { id: 'merged-table', type: 'table', caption: body('合并表与多行'), columns: [{ id: 'c-m1', header: body('观察') }, { id: 'c-m2', header: body('结论') }], rows: [{ id: 'r-m1', cells: { 'c-m1': body('第一行\n第二行'), 'c-m2': body('') } }], merges: [{ rowIds: ['r-m1'], columnIds: ['c-m1', 'c-m2'] }] },
    { id: 'photo', type: 'media', assetId: 'a-photo', mediaKind: 'image', altText: '实验电路照片', caption: body('电压表的连接'), layout: 'wide', wrap: 'left' },
    { id: 'chart', type: 'chart', height: 320, chart: { chartType: 'line', title: '电压与电流', categories: [{ id: 'point-1', label: '6 V' }], series: [{ id: 'series-1', name: '电流', color: '#336699', points: [{ id: 'value-1', categoryId: 'point-1', value: 0.3 }] }], style: { backgroundColor: '#ffffff', backgroundOpacity: 1, fontFamily: 'Noto Sans SC', fontSize: 18, textColor: '#333333', showLegend: true, legendPosition: 'bottom', showDataLabels: true, showCategoryAxis: true, showValueAxis: true, showGridLines: true } } },
    { id: 'equation', type: 'formula', formulaId: 'formula-power', latex: 'P=UI', accessibleText: '功率等于电压乘电流', style: { color: '#663399', fontSize: 28 } },
    { id: 'source', type: 'code', code: 'const price = "$5"\n```\n<!--cw:block not metadata-->\n', language: 'javascript' },
    { id: 'warning', type: 'callout', tone: 'warning', title: body('连接提醒'), body: body('闭合开关前检查接线') },
    { id: 'section', type: 'section', title: body('验证结论'), collapsedByDefault: false, blocks: [{ id: 'nested-paragraph', type: 'paragraph', content: body('保持电阻不变') }] },
    { id: 'interactive', type: 'component', component: { packageId: 'ohm-lab', version: '1.0.0' }, props: { voltage: 6, resistance: 20, labels: ['电流', '电压'], settings: { editable: true } }, staticFallbackAssetId: 'a-fallback', wrap: 'none' },
    { id: 'divider', type: 'divider' },
    { id: 'empty', type: 'paragraph', content: body('') },
  ]
  return { content: { blocks }, resources: { assets: [{ assetId: 'a-photo', source: { kind: 'relative', path: 'assets/photo.png' } }, { assetId: 'a-fallback', source: { kind: 'relative', path: 'assets/fallback.png' } }], components: [{ packageId: 'ohm-lab', version: '1.0.0', source: { kind: 'relative', path: 'assets/ohm-lab.zip' } }] } }
}
