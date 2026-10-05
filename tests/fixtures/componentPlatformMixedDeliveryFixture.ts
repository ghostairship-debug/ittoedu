import { createTextComponentData, createFormulaComponentData } from '../../src/components/text/data'
import { createTableData } from '../../src/components/table/data'
import { createChartData } from '../../src/components/chart/data'
import { createImageData } from '../../src/components/image/data'
import { createInputData } from '../../src/components/input'
import { createChoiceData } from '../../src/components/choice'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import type { ComponentInstance, CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { DocumentResources, DocumentSnapshot } from '../../src/shared/workbench/document'
import { courseDeliverySnapshot } from '../../src/renderer/app/courseDeliverySnapshot'
import { createCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'

/** The one author sample shared by Player, capture, HTML and Office/PDF verification. */
export function createComponentPlatformMixedDeliveryFixture() {
  const bytes = (text: string) => new TextEncoder().encode(text)
  const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
  const instances: Record<string, ComponentInstance> = {}
  const definitions: CourseProjectV10['definitions'] = {}
  const add = (id: string, key: string, data: unknown, x: number, y: number, width: number, height: number) => {
    definitions[key] ??= { id: key, role: 'content', implementation: { kind: 'builtin', key } }
    instances[id] = { id, definitionId: key, data: json(data), frame: { width, height, transform: [1, 0, 0, 1, x, y] } }
    return id
  }
  const title = (label: string) => createTextComponentData({ inlines: [
    { type: 'text', text: label, style: { bold: true, color: '#173b65' } },
    { type: 'text', text: ' · 可编辑😀', style: { italic: true } },
    { type: 'math', formulaId: `${label}-inline`, latex: 'I_1=I_2', accessibleText: '电流相等' },
  ] })
  let cell = 0
  const table = createTableData({ rows: 3, columns: 3, idFactory: () => `mixed-cell-${++cell}` })
  table.rows[0]!.cells[0]!.text = '串联电路观测'
  table.rows[0]!.cells[0]!.style = { fillColor: '#fef3c7', fontSize: 18 }
  table.merges = [{ rowIds: [table.rows[0]!.id], columnIds: table.columns.map(column => column.id) }]
  table.rows[1]!.cells[0]!.text = '电流 A'; table.rows[1]!.cells[1]!.text = '电流 B'; table.rows[1]!.cells[2]!.text = '结论'
  table.rows[2]!.cells[0]!.text = '0.20'; table.rows[2]!.cells[1]!.text = '0.20'; table.rows[2]!.cells[2]!.text = '相等'
  const chart = createChartData()
  const slide = [
    add('slide-title', 'guoling.text', title('串联电路观察'), 35, 25, 920, 68),
    add('slide-formula', 'guoling.formula', createFormulaComponentData('slide-ohm', 'V=IR'), 40, 104, 380, 75),
    add('slide-table', 'guoling.table', table, 40, 190, 420, 190),
    add('slide-chart', 'guoling.chart', chart, 510, 125, 410, 290),
    add('slide-image', 'guoling.image', createImageData('circuit-image', '串联电路示意图'), 45, 402, 265, 160),
    add('slide-input', 'guoling.input', createInputData({ label: '填写电流关系', placeholder: '输入相等', acceptedAnswers: ['相等'] }), 330, 590, 360, 110),
    add('slide-choice', 'guoling.choice', createChoiceData({ label: '断开开关后', options: [{ id: 'off', label: '灯泡熄灭' }, { id: 'on', label: '灯泡更亮' }], correctOptionIds: ['off'] }), 860, 480, 140, 110),
  ]
  add('slide-group', 'guoling.group', {}, 0, 0, 1000, 700)
  const styled = createTextComponentData('原生专业样式：粗体 斜体 下划线 删除线')
  Object.assign(styled.appearance, { bold: true, italic: true, underline: true, strike: true, padding: 14,
    backgroundColor: '#dbeafe', backgroundOpacity: 1, borderColor: '#1d4ed8', borderOpacity: 1, borderWidth: 2, verticalAlign: 'middle' })
  add('slide-styled-text', 'guoling.text', styled, 45, 590, 280, 70)
  add('slide-data-group', 'guoling.group', {}, 65, 180, 870, 280)
  instances['slide-data-group']!.frame!.transform = [0.9659258, 0.258819, -0.258819, 0.9659258, 65, 160]
  instances['slide-data-group']!.childIds = ['slide-table', 'slide-chart']
  instances['slide-table']!.frame!.transform = [1, 0, 0, 1, 0, 0]
  instances['slide-chart']!.frame!.transform = [1, 0, 0, 1, 470, -250]
  instances['slide-group']!.childIds = [...slide.filter(id => !['slide-table', 'slide-chart'].includes(id)), 'slide-data-group', 'slide-styled-text']
  // A slight rotation exercises native group geometry rather than a flattened screenshot.
  instances['slide-image']!.frame!.transform = [0.9961947, 0.0871557, -0.0871557, 0.9961947, 45, 402]
  const flow = [add('flow-title', 'guoling.text', title('串联电路讲义'), 0, 0, 660, 75)]
  for (let index = 1; index <= 14; index++) flow.push(add(`flow-paragraph-${index}`, 'guoling.text', createTextComponentData(
    `观察步骤 ${index}：连接电源、开关与两只灯泡，在不同位置测量电流。记录仪表读数，比较前后变化，并用完整句子解释证据。保持电路连接顺序，分析开关断开后电流与灯泡亮度的关系。`), 0, 0, 660, 90))
  flow.splice(3, 0, add('flow-formula', 'guoling.formula', createFormulaComponentData('flow-ohm', 'V=IR'), 0, 0, 660, 90))
  flow.splice(6, 0, add('flow-table', 'guoling.table', table, 0, 0, 660, 190))
  flow.splice(9, 0, add('flow-chart', 'guoling.chart', chart, 0, 0, 660, 300))
  flow.push(add('flow-image', 'guoling.image', createImageData('circuit-image', '可保存的电路图片'), 0, 0, 420, 250))
  definitions['mixed-program'] = { id: 'mixed-program', role: 'content', implementation: {
    kind: 'source', language: 'typescript', workspace: { ownerId: 'mixed-program', entry: 'main.ts' }, resourceBindings: { circuit: 'circuit-image' },
  } }
  instances['flow-program'] = { id: 'flow-program', definitionId: 'mixed-program', data: {}, childIds: ['flow-program-child'], frame: { width: 620, height: 150, transform: [1, 0, 0, 1, 0, 0] } }
  add('flow-program-child', 'guoling.text', createTextComponentData('源码组的专业文字子对象保持独立可编辑'), 0, 90, 620, 50)
  flow.push('flow-program')
  const spatial = [add('spatial-title', 'guoling.text', title('空间电路图'), 50, 70, 800, 70),
    add('spatial-image', 'guoling.image', createImageData('circuit-image', '空间电路图片'), 110, 170, 420, 260),
    add('spatial-table', 'guoling.table', table, 1040, 120, 450, 230),
    add('spatial-chart', 'guoling.chart', chart, 1060, 390, 440, 260)]
  const image = bytes('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="250" viewBox="0 0 420 250"><rect width="420" height="250" rx="18" fill="#e0f2fe"/><path d="M75 170V70H345V170Z" fill="none" stroke="#173b65" stroke-width="8"/><circle cx="160" cy="70" r="26" fill="#facc15" stroke="#173b65" stroke-width="5"/><circle cx="275" cy="70" r="26" fill="#facc15" stroke="#173b65" stroke-width="5"/><path d="M185 150V190M210 140V200" stroke="#173b65" stroke-width="7"/><rect x="168" y="163" width="65" height="14" fill="#e0f2fe"/><text x="210" y="230" text-anchor="middle" font-size="20" fill="#173b65">Series circuit</text></svg>')
  const resources: DocumentResources = { assets: { 'circuit-image': image }, components: { 'mixed-program': {
    'labels.ts': bytes('export const label = "点击切换开关";'),
    'main.ts': bytes('import { label } from "./labels"; export default { mount({root,scope}) { const button=root.ownerDocument.createElement("button"); button.textContent=label; const status=root.ownerDocument.createElement("span"); status.textContent="开关闭合"; const click=()=>{status.textContent=status.textContent==="开关闭合"?"开关断开":"开关闭合";scope.state.set("switch",status.textContent);}; button.addEventListener("click",click);root.append(button,status);return {update(){},dispose(){button.removeEventListener("click",click);button.remove();status.remove();}};} };'),
  } } }
  const project = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'component-platform-mixed-delivery', revision: 0, title: '三表面串联电路交付样本', definitions, instances,
    surfaces: [{ id: 'mixed-slide', kind: 'slide', title: '演示与作答', childIds: ['slide-group'], designSize: { width: 1000, height: 700 } },
      { id: 'mixed-flow', kind: 'flow', title: '完整观察讲义', childIds: flow, flow: { layout: { readingWidth: 660, wideContentWidth: 900, widthMode: 'reading', paperBackgroundColor: '#ffffff' } } },
      { id: 'mixed-spatial', kind: 'spatial', title: '空间观察', childIds: spatial, designSize: { width: 1000, height: 700 }, spatial: {
        home: { x: 500, y: 350, zoom: 1 }, frames: [{ id: 'circuit-view', title: '电路', pose: { x: 500, y: 350, zoom: 1 } }, { id: 'results-view', title: '测量结果', pose: { x: 1250, y: 350, zoom: 1 } }],
      } }], global: { underlay: [], overlay: [] }, assets: { 'circuit-image': { id: 'circuit-image', path: 'assets/circuit.svg', mimeType: 'image/svg+xml', kind: 'image', width: 420, height: 250,
        remote: { url: 'https://mixed-delivery.test/circuit.svg' },
        source: { kind: 'user-material', title: '本地测试电路示意图', url: 'https://mixed-delivery.test/credit', author: '果铃工程测试', license: { id: 'CC0' } } } } })
  const snapshot: DocumentSnapshot = { documentId: 'mixed-delivery-document', epoch: 'mixed-delivery-epoch', revision: project.revision,
    binding: { kind: 'untitled', suggestedName: `${project.title}.h5lesson` }, model: { kind: 'course-v10', project, resources }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  return { project, resources, snapshot, delivery: courseDeliverySnapshot(snapshot)!, archive: () => createCourseProjectV10Archive({ project, resources }) }
}
