import path from 'node:path'
import ExcelJS from 'exceljs'
import { children, descendants, NS, OfficePackage, textOf } from './officePackage'
import type { OfficeCalculation, OfficeCellValue, OfficeContentInspection, OfficeDiagnostic, OfficeRequest } from '../../../shared/workbench/officeFiles'

interface CalcCell { f?: string; v?: string | number | boolean; t?: string; w?: string }
interface CalcWorkbook { Sheets: Record<string, Record<string, CalcCell | string>> }
// xlsx-calc ships JavaScript without declarations. Keep its untyped boundary local.
const calculate = require('xlsx-calc') as (workbook: CalcWorkbook) => void
const supportedFunctions = new Set(['SUM', 'MIN', 'MAX', 'AVERAGE', 'ROUND', 'ABS', 'SQRT', 'IF'])

export async function createXlsx(request: OfficeRequest<'xlsx', 'create'>): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '果铃'
  for (const input of request.sheets) {
    const sheet = workbook.addWorksheet(input.name)
    for (const inputRow of input.rows) sheet.addRow(inputRow.map(value => isFormula(value) ? { formula: normalizeFormula(value.formula) } : value))
    input.columnWidths?.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    if (input.header && input.rows.length) {
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5EA8' } }
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
    }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

function isFormula(value: OfficeCellValue): value is { formula: string } { return typeof value === 'object' && value !== null }
function normalizeFormula(value: string) { return value.trim().replace(/^=/, '') }
function address(value: string): { name: string; row: number; column: number } {
  const name = value.toUpperCase()
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(name)
  if (!match) throw new Error(`Excel 单元格位置无效：${value}`)
  const row = Number(match[2])
  const column = [...match[1]].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0)
  if (column > 16384 || row > 1048576) throw new Error(`Excel 单元格超出格式范围：${value}`)
  return { name, row, column }
}
interface Sheet { name: string; part: string; xml: Document }
function sheets(pkg: OfficePackage): Sheet[] {
  const main = pkg.main(); const workbook = pkg.xml(main); const relationships = pkg.relationships(main)
  if (workbook.documentElement.namespaceURI !== NS.sheet) throw new Error('该文件不是支持的 XLSX 工作簿')
  return descendants(workbook, NS.sheet, 'sheet').map(sheet => {
    const part = relationships.get(sheet.getAttributeNS(NS.officeRelationship, 'id') ?? '')
    if (!part) throw new Error('Excel 工作表关系不存在')
    return { name: sheet.getAttribute('name') ?? '', part, xml: pkg.xml(part) }
  })
}
function sharedStrings(pkg: OfficePackage): string[] {
  const related = pkg.relationships(pkg.main())
  const name = [...related.values()].find(part => part.endsWith('/sharedStrings.xml'))
  return name ? descendants(pkg.xml(name), NS.sheet, 'si').map(value => textOf(value, NS.sheet)) : []
}
function cellScalar(cell: Element, strings: string[]): string | number | boolean | null {
  const type = cell.getAttribute('t')
  const value = children(cell, NS.sheet, 'v')[0]?.textContent
  if (type === 'inlineStr') return textOf(cell, NS.sheet)
  if (value === undefined || value === null) return null
  if (type === 's') return strings[Number(value)] ?? ''
  if (type === 'b') return value === '1'
  if (type === 'str' || type === 'e' || type === 'd') return value
  return value === '' ? null : Number(value)
}
function element(xml: Document, name: string, text?: string): Element {
  const node = xml.createElementNS(NS.sheet, name)
  if (text !== undefined) node.textContent = text
  return node
}
function clearCellValue(cell: Element, includeFormula: boolean) {
  for (const name of includeFormula ? ['f', 'v', 'is'] : ['v', 'is']) for (const node of children(cell, NS.sheet, name)) cell.removeChild(node)
  cell.removeAttribute('t')
}
function writeScalar(cell: Element, value: string | number | boolean | null, formulaResult = false, error = false) {
  if (value === null) return
  const xml = cell.ownerDocument
  if (typeof value === 'string' && !formulaResult && !error) {
    cell.setAttribute('t', 'inlineStr')
    const inline = element(xml, 'is'); const text = element(xml, 't', value); text.setAttribute('xml:space', 'preserve')
    inline.appendChild(text); cell.appendChild(inline)
  } else {
    if (error) cell.setAttribute('t', 'e')
    else if (typeof value === 'string') cell.setAttribute('t', 'str')
    else if (typeof value === 'boolean') cell.setAttribute('t', 'b')
    cell.appendChild(element(xml, 'v', typeof value === 'boolean' ? value ? '1' : '0' : String(value)))
  }
}
function cellAt(sheet: Sheet, input: string): Element {
  const target = address(input)
  const sheetData = descendants(sheet.xml, NS.sheet, 'sheetData')[0]
  if (!sheetData) throw new Error(`工作表不含普通单元格：${sheet.name}`)
  const rows = children(sheetData, NS.sheet, 'row')
  let row = rows.find(node => Number(node.getAttribute('r')) === target.row)
  if (!row) {
    row = element(sheet.xml, 'row'); row.setAttribute('r', String(target.row))
    sheetData.insertBefore(row, rows.find(node => Number(node.getAttribute('r')) > target.row) ?? null)
  }
  const cells = children(row, NS.sheet, 'c')
  let cell = cells.find(node => node.getAttribute('r') === target.name)
  if (!cell) {
    cell = element(sheet.xml, 'c'); cell.setAttribute('r', target.name)
    row.insertBefore(cell, cells.find(node => address(node.getAttribute('r') ?? '').column > target.column) ?? null)
  }
  return cell
}
function includesCell(range: string, target: string): boolean {
  const [from, to = from] = range.replaceAll('$', '').split(':').map(address)
  const cell = address(target)
  return cell.row >= from.row && cell.row <= to.row && cell.column >= from.column && cell.column <= to.column
}
function updateDimension(sheet: Sheet) {
  const refs = descendants(sheet.xml, NS.sheet, 'c').map(cell => address(cell.getAttribute('r') ?? ''))
  const dimension = descendants(sheet.xml, NS.sheet, 'dimension')[0]
  if (!dimension || !refs.length) return
  let minColumn = refs[0].column, maxColumn = minColumn, minRow = refs[0].row, maxRow = minRow
  for (const ref of refs) { minColumn = Math.min(minColumn, ref.column); maxColumn = Math.max(maxColumn, ref.column); minRow = Math.min(minRow, ref.row); maxRow = Math.max(maxRow, ref.row) }
  function columnName(value: number) { let text = ''; for (; value > 0; value = Math.floor((value - 1) / 26)) text = String.fromCharCode(65 + (value - 1) % 26) + text; return text }
  dimension.setAttribute('ref', `${columnName(minColumn)}${minRow}:${columnName(maxColumn)}${maxRow}`)
}

export function editXlsx(pkg: OfficePackage, request: OfficeRequest<'xlsx', 'edit'>) {
  const allSheets = sheets(pkg)
  for (const edit of request.edits) {
    const sheet = allSheets.find(value => value.name === edit.sheet)
    if (!sheet) throw new Error(`Excel 工作表不存在：${edit.sheet}`)
    const cell = cellAt(sheet, edit.cell)
    if (children(cell, NS.sheet, 'f').some(formula => formula.hasAttribute('t') && formula.getAttribute('t') !== 'normal') ||
      descendants(sheet.xml, NS.sheet, 'f').some(formula => formula.getAttribute('ref') && includesCell(formula.getAttribute('ref')!, edit.cell))) {
      throw new Error(`目标位于共享或数组公式区域，须保持整组公式语义，不能单格改写：${edit.sheet}!${edit.cell}`)
    }
    const merge = descendants(sheet.xml, NS.sheet, 'mergeCell').find(node => includesCell(node.getAttribute('ref') ?? '', edit.cell))
    if (merge && address(merge.getAttribute('ref')!.split(':')[0]).name !== address(edit.cell).name) throw new Error('合并单元格请修改左上角主单元格')
    clearCellValue(cell, true)
    if (isFormula(edit.value)) cell.appendChild(element(sheet.xml, 'f', normalizeFormula(edit.value.formula)))
    else writeScalar(cell, edit.value)
    updateDimension(sheet); pkg.write(sheet.part)
  }
}

function removeCalculationChain(pkg: OfficePackage) {
  const main = pkg.main()
  const relationPart = path.posix.join(path.posix.dirname(main), '_rels', path.posix.basename(main) + '.rels')
  if (!pkg.parts[relationPart]) return
  for (const relation of descendants(pkg.xml(relationPart), NS.relationship, 'Relationship').filter(node => node.getAttribute('Type')?.endsWith('/calcChain'))) {
    const part = pkg.relationships(main).get(relation.getAttribute('Id') ?? '')
    relation.parentNode?.removeChild(relation); pkg.write(relationPart)
    if (part) {
      pkg.remove(part)
      const types = pkg.xml('[Content_Types].xml')
      for (const node of Array.from(types.documentElement.childNodes)) if (node.nodeType === 1 && (node as Element).getAttribute('PartName') === '/' + part) node.parentNode?.removeChild(node)
      pkg.write('[Content_Types].xml')
    }
  }
}

export function recalculateXlsx(pkg: OfficePackage): { calculation: OfficeCalculation; diagnostics: OfficeDiagnostic[] } {
  const allSheets = sheets(pkg), strings = sharedStrings(pkg)
  const workbook: CalcWorkbook = { Sheets: {} }
  const formulas: Array<{ sheet: Sheet; cell: Element; model: CalcCell; ref: string }> = []
  const diagnostics: OfficeDiagnostic[] = []
  for (const sheet of allSheets) {
    const calcSheet: Record<string, CalcCell | string> = {}
    workbook.Sheets[sheet.name] = calcSheet
    calcSheet['!ref'] = descendants(sheet.xml, NS.sheet, 'dimension')[0]?.getAttribute('ref') ?? 'A1'
    for (const cell of descendants(sheet.xml, NS.sheet, 'c')) {
      const ref = cell.getAttribute('r') ?? ''
      const value = cellScalar(cell, strings)
      const model: CalcCell = { ...(value !== null ? { v: value } : {}), t: cell.getAttribute('t') ?? 'n' }
      if (model.t === 'e') model.w = String(value)
      const formula = children(cell, NS.sheet, 'f')[0]
      if (formula) {
        model.f = formula.textContent ?? ''; delete model.v; delete model.w; delete model.t
        formulas.push({ sheet, cell, model, ref })
        const source = model.f.replace(/"(?:[^"]|"")*"/g, '""')
        const functions = [...source.matchAll(/([A-Za-z_][A-Za-z_0-9.]*)\s*\(/g)].map(match => match[1].toUpperCase())
        if ((formula.hasAttribute('t') && formula.getAttribute('t') !== 'normal') || /[\[\]{}]/.test(source) || functions.some(name => !supportedFunctions.has(name)) || !model.f) {
          diagnostics.push({ code: 'formula-not-supported', location: `${sheet.name}!${ref}`, message: '保留原公式；当前计算器不支持该公式或共享/数组/外部引用形式。' })
        }
      }
      calcSheet[ref] = model
    }
  }
  let complete = diagnostics.length === 0
  if (complete && formulas.length) {
    try {
      calculate(workbook)
      for (const { model, sheet, ref } of formulas) {
        if (model.t === 'e' && model.w) continue
        if (!['number', 'string', 'boolean'].includes(typeof model.v) || (typeof model.v === 'number' && !Number.isFinite(model.v))) throw new Error(`${sheet.name}!${ref} 未返回可用计算值`)
      }
    } catch (error) {
      complete = false
      diagnostics.push({ code: 'formula-calculation-incomplete', message: error instanceof Error ? error.message : String(error) })
    }
  }
  const values: OfficeCalculation['values'] = []
  for (const { sheet, cell, model, ref } of formulas) {
    clearCellValue(cell, false)
    if (complete) {
      const error = model.t === 'e'
      const value = error ? model.w! : model.v!
      writeScalar(cell, value, true, error)
      values.push({ sheet: sheet.name, cell: ref, value, ...(error ? { error: true } : {}) })
    }
    pkg.write(sheet.part)
  }
  if (!complete) diagnostics.push({ code: 'formula-caches-cleared', message: '修改与原公式已保留。为避免依赖链显示旧值，公式缓存已清除；本次未宣称完成重算，需在兼容 Office 软件中计算。' })
  removeCalculationChain(pkg)
  const main = pkg.main(); const root = pkg.xml(main).documentElement
  let calc = children(root, NS.sheet, 'calcPr')[0]
  if (!calc) { calc = element(root.ownerDocument, 'calcPr'); root.appendChild(calc) }
  calc.setAttribute('calcMode', 'auto'); calc.setAttribute('fullCalcOnLoad', '1'); calc.setAttribute('forceFullCalc', '1'); pkg.write(main)
  return { calculation: { engine: 'xlsx-calc', status: complete ? 'complete' : 'partial', values }, diagnostics }
}

export function inspectXlsx(pkg: OfficePackage): Extract<OfficeContentInspection, { format: 'xlsx' }> {
  const strings = sharedStrings(pkg)
  return { format: 'xlsx', sheets: sheets(pkg).map(sheet => ({ name: sheet.name, cells: descendants(sheet.xml, NS.sheet, 'c').map(cell => {
    const formula = children(cell, NS.sheet, 'f')[0]
    return { cell: cell.getAttribute('r') ?? '', value: cellScalar(cell, strings), ...(formula ? { formula: formula.textContent ?? '' } : {}) }
  }) })) }
}
