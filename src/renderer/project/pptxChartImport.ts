import { nanoid } from 'nanoid'
import { createChartLayerItem, createChartNode } from './nativeNodeFactories'
import { chartNativeContentSchema } from '../../shared/contracts/native-v1/schema'
import { openPptxPackage, pptxReject, pptxRelationshipId, xmlAll, xmlChildren, xmlFirst, type PptxPackage, type PptxImportIssue } from './pptxPackage'

const child = (node: Element | undefined, name: string) => node && xmlChildren(node).find(value => value.localName === name)
const val = (node: Element | undefined) => node?.getAttribute('val') ?? undefined
const reject = (message: string): never => pptxReject('图表', message)

/** Read stored cell values only; never execute formulas, macros or external links. */
function workbookReader(pkg: PptxPackage, chart: Document, chartPath: string) {
  const externalData = xmlFirst(chart, 'externalData')
  if (!externalData) return undefined
  const relationship = pkg.relationships(chartPath).find(entry => entry.id === pptxRelationshipId(externalData))
  if (!relationship || relationship.external || !relationship.type.endsWith('/package') || !pkg.files[relationship.target]) return reject('内嵌工作簿关系缺失或指向外部，未导入此图表')
  const book = openPptxPackage(pkg.files[relationship.target], 'xl/workbook.xml')
  const workbook = book.xml('xl/workbook.xml')
  const strings = book.files['xl/sharedStrings.xml'] ? xmlAll(book.xml('xl/sharedStrings.xml'), 'si').map(si => xmlAll(si, 't').map(t => t.textContent ?? '').join('')) : []
  const sheets = new Map<string, Map<string, string>>()
  const column = (name: string) => [...name].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0)
  const address = (letters: string, row: number) => `${column(letters)}:${row}`
  return (formula: string): string[] => {
    const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(formula)
    if (!match || /[\[\]]/.test(match[1] ?? match[2])) return reject('图表数据引用不是受支持的单一工作表范围')
    const name = (match[1] ?? match[2]).replace(/''/g, "'")
    let cells = sheets.get(name)
    if (!cells) {
      const sheet = xmlAll(workbook, 'sheet').find(entry => entry.getAttribute('name') === name)
      const relation = sheet && book.relationships('xl/workbook.xml').find(entry => entry.id === pptxRelationshipId(sheet))
      if (!relation || relation.external || !relation.type.endsWith('/worksheet')) return reject('图表引用的内嵌工作表不存在')
      cells = new Map()
      for (const cell of xmlAll(book.xml(relation.target), 'c')) {
        const ref = /^([A-Z]+)(\d+)$/.exec(cell.getAttribute('r') ?? '')
        if (!ref) return reject('工作表单元格地址无效')
        const type = cell.getAttribute('t')
        const raw = child(cell, 'v')?.textContent
        const value = type === 'inlineStr' ? xmlAll(cell, 't').map(t => t.textContent ?? '').join('')
          : type === 's' && raw !== undefined && raw !== null && /^\d+$/.test(raw) ? strings[Number(raw)]
          : !type || type === 'n' || type === 'str' ? raw : undefined
        if (value !== undefined && value !== null) {
          const key = address(ref[1], Number(ref[2]))
          if (cells.has(key)) return reject('工作表包含重复的单元格地址')
          cells.set(key, value)
        }
      }
      sheets.set(name, cells)
    }
    const x1 = column(match[3]), y1 = Number(match[4]), x2 = column(match[5] ?? match[3]), y2 = Number(match[6] ?? match[4])
    if (x1 < 1 || y1 < 1 || x2 < x1 || y2 < y1 || x1 !== x2 && y1 !== y2 || (x2 - x1 + 1) * (y2 - y1 + 1) > 200) return reject('图表范围必须为最多 200 个单元格的连续行或列')
    const result: string[] = []
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
      const value = cells.get(`${x}:${y}`)
      if (value === undefined || value === '') return reject('内嵌工作簿的数据缺失，未猜测空白值')
      result.push(value)
    }
    return result
  }
}

function cachedValues(cache: Element | undefined, pointParent = cache): string[] | undefined {
  if (!cache) return undefined
  const count = Number(val(child(cache, 'ptCount')))
  if (!Number.isInteger(count) || count < 1 || count > 200) return reject('图表缓存点数无效')
  const points = xmlChildren(pointParent!).filter(point => point.localName === 'pt')
  const result: string[] = new Array(count)
  for (const point of points) {
    const index = Number(point.getAttribute('idx'))
    const value = child(point, 'v')?.textContent
    if (!Number.isInteger(index) || index < 0 || index >= count || result[index] !== undefined || !value) return reject('图表缓存包含重复、越界或缺失数据')
    result[index] = value
  }
  if (points.length !== count) return reject('图表缓存不完整，未猜测缺失值')
  return result
}

function chartValues(node: Element | undefined, numeric: boolean, read?: (formula: string) => string[]): string[] | number[] {
  if (!node) return reject('图表缺少类别或数值')
  const reference = child(node, numeric ? 'numRef' : 'strRef') ?? child(node, 'numRef') ?? child(node, 'multiLvlStrRef')
  const multi = child(reference, 'multiLvlStrCache'), levels = multi && xmlChildren(multi).filter(entry => entry.localName === 'lvl')
  if (levels && levels.length !== 1) return reject('暂不支持多层类别')
  const cache = multi ? cachedValues(multi, levels![0]) : cachedValues(reference ? child(reference, 'strCache') ?? child(reference, 'numCache') : child(node, 'strLit') ?? child(node, 'numLit'))
  const formula = reference && child(reference, 'f')?.textContent
  const cells = read && formula ? read(formula) : undefined
  const normalize = (values: string[]) => values.map(value => {
    if (!numeric) return value
    if (!value.trim() || !Number.isFinite(Number(value))) return reject('图表包含不可表达的数值')
    return Number(value)
  })
  if (cache && cells && JSON.stringify(normalize(cache)) !== JSON.stringify(normalize(cells))) return reject('图表缓存与内嵌工作簿冲突，未导入此图表')
  const values = cells ?? cache
  if (!values) return reject('图表没有完整可用的数据缓存或内嵌工作簿')
  return normalize(values) as string[] | number[]
}

export function parsePptxChart(object: Element, pkg: PptxPackage, sourcePath: string, scale: number, origin: { x: number; y: number },
  color: (node: Element | undefined, fallback: string) => string, page: number, issues: PptxImportIssue[]) {
  const reference = xmlFirst(object, 'chart')
  if (!reference) return null
  const relation = pkg.relationships(sourcePath).find(entry => entry.id === pptxRelationshipId(reference))
  if (!relation || relation.external || !relation.type.endsWith('/chart')) return reject('图表关系无效')
  const chart = pkg.xml(relation.target)
  const plot = xmlFirst(chart, 'plotArea')
  const types = plot && xmlChildren(plot).filter(entry => /Chart$/.test(entry.localName))
  if (!types || types.length !== 1 || !['barChart', 'lineChart', 'pieChart', 'doughnutChart'].includes(types[0].localName)) return reject('暂不支持组合图、三维图或此特殊图表类型')
  const type = types[0]
  const axisIds = new Set(xmlAll(type, 'axId').map(val))
  const axes = plot ? xmlChildren(plot).filter(entry => /^(cat|val|date|ser)Ax$/.test(entry.localName) && axisIds.has(val(child(entry, 'axId')))) : []
  if (axes.length > 2 || axes.filter(entry => entry.localName === 'valAx').length > 1) return reject('暂不支持次轴')
  const horizontal = type.localName === 'barChart' && val(child(type, 'barDir')) === 'bar'
  if (axes.some(entry => entry.localName === 'dateAx' || (val(xmlFirst(entry, 'orientation')) === 'maxMin' && !(horizontal && entry.localName === 'catAx')))) return reject('暂不支持日期轴或逆序数值轴')
  const grouping = val(child(type, 'grouping'))
  if (grouping && !['standard', 'clustered'].includes(grouping)) return reject('暂不支持堆叠或百分比图表')
  if (xmlAll(type, 'smooth').some(entry => val(entry) === '1') || xmlAll(chart, 'logBase').length || xmlAll(type, 'explosion').some(entry => Number(val(entry)) !== 0)) return reject('暂不支持平滑线、对数轴或分离饼图')
  const read = workbookReader(pkg, chart, relation.target)
  const sourceSeries = xmlChildren(type).filter(entry => entry.localName === 'ser')
  if (!sourceSeries.length || sourceSeries.length > 20) return reject('图表系列数量超出范围')
  const labels = chartValues(child(sourceSeries[0], 'cat'), false, read) as string[]
  const categories = labels.map(label => ({ id: nanoid(), label }))
  const palette = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2']
  const series = sourceSeries.map((source, index) => {
    if (JSON.stringify(chartValues(child(source, 'cat'), false, read)) !== JSON.stringify(labels)) return reject('系列之间的类别或顺序不一致')
    const values = chartValues(child(source, 'val'), true, read) as number[]
    if (values.length !== categories.length) return reject('图表类别与数值数量不一致')
    const tx = child(source, 'tx')
    const name = tx ? child(tx, 'v')?.textContent ?? chartValues(tx, false, read)[0] : ''
    return { id: nanoid(), name: String(name ?? ''), color: color(child(child(source, 'spPr'), 'solidFill'), palette[index % palette.length]),
      points: values.map((value, i) => ({ id: nanoid(), categoryId: categories[i].id, value })) }
  })
  const titleElement = xmlFirst(chart, 'title')
  const richTitle = titleElement && xmlAll(titleElement, 't').map(entry => entry.textContent ?? '').join('')
  const title = richTitle || (titleElement && child(titleElement, 'tx') ? String(chartValues(child(titleElement, 'tx'), false, read)[0] ?? '') : '')
  const chartType = type.localName === 'barChart' ? 'bar' : type.localName === 'lineChart' ? 'line' : type.localName === 'pieChart' ? 'pie' : 'donut'
  const legend = xmlFirst(chart, 'legend'), position = val(legend && child(legend, 'legendPos')) ?? 'r'
  const xfrm = child(object, 'xfrm'), off = child(xfrm, 'off'), ext = child(xfrm, 'ext')
  const number = (node: Element | undefined, attr: string) => {
    const raw = node?.getAttribute(attr), value = Number(raw)
    if (raw == null || !Number.isFinite(value)) return reject('图表几何缺失或无效')
    return value
  }
  const width = number(ext, 'cx') * scale, height = number(ext, 'cy') * scale
  if (width <= 0 || height <= 0) return reject('图表尺寸必须大于零')
  if (['flipH', 'flipV'].some(key => ['1', 'true'].includes(xfrm?.getAttribute(key) ?? ''))) return reject('暂不支持翻转的图表框')
  const valueAxis = axes.find(entry => entry.localName === 'valAx'), categoryAxis = axes.find(entry => entry.localName === 'catAx')
  if (horizontal && val(categoryAxis && xmlFirst(categoryAxis, 'orientation')) !== 'maxMin') {
    categories.reverse()
    for (const entry of series) entry.points.reverse()
  }
  const minimum = valueAxis && xmlFirst(valueAxis, 'min'), maximum = valueAxis && xmlFirst(valueAxis, 'max')
  const node = createChartNode({ chartType, title, name: xmlFirst(object, 'cNvPr')?.getAttribute('name') ?? '图表', categories, series,
    x: origin.x + number(off, 'x') * scale, y: origin.y + number(off, 'y') * scale, width, height,
    rotation: Number(xfrm?.getAttribute('rot') ?? 0) / 60000,
    style: { showLegend: !!legend, legendPosition: position === 't' ? 'top' : position === 'b' ? 'bottom' : position === 'l' ? 'left' : 'right',
      ...(horizontal ? { barDirection: 'horizontal' as const } : {}),
      showDataLabels: xmlAll(type, 'showVal').some(entry => ['1', 'true'].includes(val(entry) ?? '')),
      ...(chartType === 'bar' || chartType === 'line' ? { showCategoryAxis: val(child(categoryAxis, 'delete')) !== '1', showValueAxis: val(child(valueAxis, 'delete')) !== '1',
        showGridLines: !!child(valueAxis, 'majorGridlines'), ...(minimum ? { valueMin: number(minimum, 'val') } : {}), ...(maximum ? { valueMax: number(maximum, 'val') } : {}) } : {}),
      ...(chartType === 'donut' ? { holeSize: Number(val(child(type, 'holeSize')) ?? 50) } : {}) } })
  const item = createChartLayerItem(node)
  if (item.content.nativeType !== 'chart') return reject('图表工厂返回错误载体')
  const parsed = chartNativeContentSchema.safeParse(item.content.data)
  if (!parsed.success) return reject(`图表超出 Native Chart 表达范围：${parsed.error.issues[0]?.message}`)
  if (xmlAll(type, 'dLbls').length || xmlAll(type, 'dPt').length || xmlAll(chart, 'manualLayout').length) issues.push({ page, type: '图表样式', message: '已保留可编辑数据；数据点独立样式、标签布局与手动布局按 Native Chart 呈现' })
  return item
}
