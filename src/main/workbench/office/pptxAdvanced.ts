import { children, descendants, NS, OfficePackage } from './officePackage'
import { editXlsx, inspectXlsx } from './xlsxContent'
import type { PptxAdvancedEdit, PptxAnimationInspection, PptxChartInspection } from '../../../shared/workbench/officeFiles'

const CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const behaviorKinds = new Set(['anim', 'animClr', 'animEffect', 'animMotion', 'animRot', 'animScale', 'set'])
const behaviorOf = (node: Element) => {
  const parent = node.parentNode as Element | null, owner = parent?.parentNode as Element | null
  return parent?.namespaceURI === NS.slide && parent.localName === 'cBhvr' && owner?.namespaceURI === NS.slide && behaviorKinds.has(owner.localName) ? owner : null
}
export function inspectAnimations(pkg: OfficePackage, part: string): PptxAnimationInspection[] {
  return descendants(pkg.xml(part), NS.slide, 'cTn').map(node => {
    const owner = behaviorOf(node)
    return { id: node.getAttribute('id') ?? '', duration: node.getAttribute('dur') ?? '', kind: owner?.localName ?? 'container',
      shapeIds: owner ? descendants(owner, NS.slide, 'spTgt').map(target => target.getAttribute('spid') ?? '') : [],
      editable: Boolean(owner && node.getAttribute('id')) }
  })
}
export function editAnimationTiming(pkg: OfficePackage, part: string, edit: Extract<PptxAdvancedEdit, { type: 'animationTiming' }>) {
  const nodes = descendants(pkg.xml(part), NS.slide, 'cTn').filter(node => node.getAttribute('id') === edit.timingId)
  if (nodes.length !== 1 || !behaviorOf(nodes[0])) throw new Error('动画目标不是唯一的可修改行为；请沿用 inspect 中 editable 的 timingId')
  if (nodes[0].getAttribute('dur') !== String(edit.durationMs)) {
    nodes[0].setAttribute('dur', String(edit.durationMs)); pkg.write(part)
  }
}
function chartPart(pkg: OfficePackage, slidePart: string, object: Element): string | undefined {
  const refs = descendants(object, CHART, 'chart')
  if (refs.length !== 1) return undefined
  return pkg.relationships(slidePart).get(refs[0].getAttributeNS(NS.officeRelationship, 'id') ?? '')
}
function workbookPart(pkg: OfficePackage, part: string): string | undefined {
  const data = descendants(pkg.xml(part), CHART, 'externalData')[0]
  return data ? pkg.relationships(part).get(data.getAttributeNS(NS.officeRelationship, 'id') ?? '') : undefined
}
function seriesValue(series: Element): Element | undefined { return children(series, CHART, 'val')[0] }
export function inspectChart(pkg: OfficePackage, slidePart: string, object: Element): PptxChartInspection | undefined {
  const part = chartPart(pkg, slidePart, object)
  if (!part || !pkg.parts[part]) return undefined
  const xml = pkg.xml(part)
  return { part, partVersion: pkg.partVersion(part), embeddedWorkbook: workbookPart(pkg, part),
    series: descendants(xml, CHART, 'ser').map(series => ({
      index: Number(children(series, CHART, 'idx')[0]?.getAttribute('val')),
      name: descendants(children(series, CHART, 'tx')[0] ?? series, CHART, 'v')[0]?.textContent ?? '',
      values: (seriesValue(series) ? descendants(seriesValue(series)!, CHART, 'pt') : []).map(point => ({
        index: Number(point.getAttribute('idx')), value: Number(children(point, CHART, 'v')[0]?.textContent),
      })).filter(point => Number.isInteger(point.index) && Number.isFinite(point.value)),
    })).filter(series => Number.isInteger(series.index)) }
}
function rangeCell(formula: string, index: number): { sheet: string; cell: string } {
  const match = /^(?:'((?:[^']|'')+)'|([^'!\[\]]+))!\$?([A-Z]{1,3})\$?([1-9]\d*)(?::\$?([A-Z]{1,3})\$?([1-9]\d*))?$/i.exec(formula.trim())
  if (!match) throw new Error('图表数据引用不是本地连续单行或单列范围，原件未修改')
  const col = (text: string) => [...text.toUpperCase()].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0)
  const firstCol = col(match[3]), firstRow = Number(match[4]), lastCol = col(match[5] ?? match[3]), lastRow = Number(match[6] ?? match[4])
  if (lastCol < firstCol || lastRow < firstRow || firstCol !== lastCol && firstRow !== lastRow
    || lastCol > 16384 || lastRow > 1048576 || index > Math.max(lastCol - firstCol, lastRow - firstRow))
    throw new Error('图表数据点超出可安全定位的范围，原件未修改')
  let column = firstCol + (firstCol === lastCol ? 0 : index), name = ''
  for (; column > 0; column = Math.floor((column - 1) / 26)) name = String.fromCharCode(65 + (column - 1) % 26) + name
  return { sheet: (match[1] ?? match[2]).replace(/''/g, "'"), cell: name + (firstRow + (firstRow === lastRow ? 0 : index)) }
}
export function editChartValue(pkg: OfficePackage, slidePart: string, object: Element, edit: Extract<PptxAdvancedEdit, { type: 'chartValue' }>) {
  const part = chartPart(pkg, slidePart, object)
  if (!part || part !== edit.chartPart || pkg.partVersion(part) !== edit.chartVersion) throw new Error('图表身份或版本已改变，请重新读取原件')
  const xml = pkg.xml(part)
  const matches = descendants(xml, CHART, 'ser').filter(series => Number(children(series, CHART, 'idx')[0]?.getAttribute('val')) === edit.series)
  const value = matches.length === 1 ? seriesValue(matches[0]) : undefined
  if (!value) throw new Error('该图表系列不是可修改的普通数值系列')
  const points = descendants(value, CHART, 'pt').filter(point => Number(point.getAttribute('idx')) === edit.point)
  const number = points.length === 1 ? children(points[0], CHART, 'v')[0] : undefined
  if (!number) throw new Error('图表数值点须已存在且唯一')
  const reference = children(value, CHART, 'numRef')[0]
  if (reference) {
    const formula = children(reference, CHART, 'f')[0]?.textContent ?? ''
    const target = rangeCell(formula, edit.point), embedded = workbookPart(pkg, part)
    if (!embedded || !pkg.parts[embedded] || !/\.xlsx$/i.test(embedded)) throw new Error('图表数据来自外链或不支持的工作簿，原件未修改')
    // Sharing a workbook or source cell needs a dependency-aware operation, not a partial cache update.
    for (const other of Object.keys(pkg.parts).filter(name => /^ppt\/charts\/[^/]+\.xml$/i.test(name) && name !== part)) {
      if (workbookPart(pkg, other) === embedded) throw new Error('多个图表共享该工作簿，当前单点操作不会只更新其中一个缓存')
    }
    for (const ref of [...descendants(xml, CHART, 'numRef'), ...descendants(xml, CHART, 'strRef')]) {
      if (ref === reference) continue
      const otherFormula = children(ref, CHART, 'f')[0]?.textContent ?? ''
      let first: ReturnType<typeof rangeCell>, last: ReturnType<typeof rangeCell>
      try {
        first = rangeCell(otherFormula, 0)
        const count = Number(descendants(ref, CHART, 'ptCount')[0]?.getAttribute('val') ?? 1)
        last = rangeCell(otherFormula, Math.max(0, count - 1))
      } catch { throw new Error('图表含无法核对的其他数据引用，原件未修改') }
      if (first.sheet === target.sheet) {
        const position = /^([A-Z]+)(\d+)$/.exec(target.cell)!, from = /^([A-Z]+)(\d+)$/.exec(first.cell)!, to = /^([A-Z]+)(\d+)$/.exec(last.cell)!
        const colNumber = (text: string) => [...text].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
        if (Number(position[2]) >= Number(from[2]) && Number(position[2]) <= Number(to[2])
          && colNumber(position[1]) >= colNumber(from[1]) && colNumber(position[1]) <= colNumber(to[1]))
          throw new Error('该数据单元格被多个图表区域引用，当前单点操作不会遗漏其他缓存')
      }
    }
    const book = new OfficePackage(pkg.parts[embedded]), inspection = inspectXlsx(book)
    if (inspection.sheets.some(sheet => sheet.cells.some(cell => cell.formula !== undefined))
      || Object.keys(book.parts).some(name => /\/externalLinks\//.test(name))) throw new Error('内嵌数据含公式或外链依赖，当前操作保留原件并停止')
    editXlsx(book, { format: 'xlsx', operation: 'edit', edits: [{ sheet: target.sheet, cell: target.cell, value: edit.value }] })
    pkg.setBinary(embedded, book.save())
  } else if (!children(value, CHART, 'numLit').length) throw new Error('图表数值存储形式暂不支持')
  number.textContent = String(edit.value); pkg.write(part)
}
