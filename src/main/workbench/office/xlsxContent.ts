import path from 'node:path'
import { strToU8 } from 'fflate'
import { children, descendants, NS, OfficePackage, textOf } from './officePackage'
import type { OfficeCalculation, OfficeCellValue, OfficeContentInspection, OfficeDiagnostic, OfficeRequest } from '../../../shared/workbench/officeFiles'

interface CalcCell { f?: string; v?: string | number | boolean; t?: string; w?: string }
interface CalcWorkbook { Sheets: Record<string, Record<string, CalcCell | string>> }
// xlsx-calc ships JavaScript without declarations. Keep its untyped boundary local.
const calculate = require('xlsx-calc') as ((workbook: CalcWorkbook) => void) & { set_fx: (name: string, fn: (...args: unknown[]) => number) => void }
// xlsx-calc uses Math.round directly, which rounds negative ties toward zero.
// Shift through decimal notation to avoid introducing a binary multiplication error
// before rounding values such as 1.475 at two decimal places.
calculate.set_fx('ROUND', (...args: unknown[]) => {
  if (args.length !== 2) throw new Error('#VALUE!')
  const value = Number(args[0]), places = Math.trunc(Number(args[1]))
  if (!Number.isFinite(value) || !Number.isFinite(places)) throw new Error('#VALUE!')
  const shift = (number: number, exponent: number) => {
    const [mantissa, current = '0'] = String(number).split('e')
    return Number(`${mantissa}e${Number(current) + exponent}`)
  }
  const shifted = shift(Math.abs(value), places)
  if (!Number.isFinite(shifted)) return value
  if (shifted === 0) return 0
  const result = shift(Math.round(shifted), -places)
  if (!Number.isFinite(result)) throw new Error('#NUM!')
  return value < 0 ? -result : result
})
const supportedFunctions = new Set(['SUM', 'MIN', 'MAX', 'AVERAGE', 'ROUND', 'ABS', 'SQRT', 'IF'])

export async function createXlsx(request: OfficeRequest<'xlsx', 'create'>): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs')
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
export function address(value: string): { name: string; row: number; column: number } {
  const name = value.toUpperCase()
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(name)
  if (!match) throw new Error(`Excel 单元格位置无效：${value}`)
  const row = Number(match[2])
  const column = [...match[1]].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0)
  if (column > 16384 || row > 1048576) throw new Error(`Excel 单元格超出格式范围：${value}`)
  return { name, row, column }
}
interface Sheet { name: string; part: string; xml: Document; node: Element; sheetId: string }
export function sheets(pkg: OfficePackage): Sheet[] {
  const main = pkg.main(); const workbook = pkg.xml(main); const relationships = pkg.relationships(main)
  if (workbook.documentElement.namespaceURI !== NS.sheet) throw new Error('该文件不是支持的 XLSX 工作簿')
  return descendants(workbook, NS.sheet, 'sheet').map(sheet => {
    const part = relationships.get(sheet.getAttributeNS(NS.officeRelationship, 'id') ?? '')
    if (!part) throw new Error('Excel 工作表关系不存在')
    return { name: sheet.getAttribute('name') ?? '', part, xml: pkg.xml(part), node: sheet, sheetId: sheet.getAttribute('sheetId') ?? '' }
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
export function cellAt(sheet: Sheet, input: string): Element {
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
export function updateDimension(sheet: Sheet) {
  const refs = descendants(sheet.xml, NS.sheet, 'c').map(cell => address(cell.getAttribute('r') ?? ''))
  const dimension = descendants(sheet.xml, NS.sheet, 'dimension')[0]
  if (!dimension || !refs.length) return
  let minColumn = refs[0].column, maxColumn = minColumn, minRow = refs[0].row, maxRow = minRow
  for (const ref of refs) { minColumn = Math.min(minColumn, ref.column); maxColumn = Math.max(maxColumn, ref.column); minRow = Math.min(minRow, ref.row); maxRow = Math.max(maxRow, ref.row) }
  function columnName(value: number) { let text = ''; for (; value > 0; value = Math.floor((value - 1) / 26)) text = String.fromCharCode(65 + (value - 1) % 26) + text; return text }
  dimension.setAttribute('ref', `${columnName(minColumn)}${minRow}:${columnName(maxColumn)}${maxRow}`)
}

function relationPart(main: string): string { return path.posix.join(path.posix.dirname(main), '_rels', path.posix.basename(main) + '.rels') }
export function xlsxStylePart(pkg: OfficePackage): string | undefined {
  const main = pkg.main(), relation = relationPart(main)
  if (!pkg.parts[relation]) return undefined
  const style = descendants(pkg.xml(relation), NS.relationship, 'Relationship').find(node => node.getAttribute('Type')?.endsWith('/styles'))
  return style ? pkg.relationships(main).get(style.getAttribute('Id') ?? '') : undefined
}
function validateSheetName(allSheets: Sheet[], name: string, previous?: string) {
  if (!name.trim() || name.length > 31 || /[\\/?*\[\]:\x00-\x1f]/.test(name) || name.startsWith("'") || name.endsWith("'")) throw new Error('工作表名须为 1—31 个字符，不能包含 \\ / ? * [ ] : 或首尾单引号。')
  if (allSheets.some(sheet => sheet.name !== previous && sheet.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`工作表名称已存在：${name}`)
}
function assertWorkbookStructureEditable(pkg: OfficePackage) {
  const protection = descendants(pkg.xml(pkg.main()), NS.sheet, 'workbookProtection')[0]
  if (protection && ['1', 'true', 'on'].includes(protection.getAttribute('lockStructure') ?? '')) throw new Error('工作簿结构受保护，请先在原软件中解除结构保护。')
}
/** Refuse unsupported dependency changes rather than silently breaking names, charts or formulas. */
function assertSheetReferencesEditable(pkg: OfficePackage, target: Sheet, operation: 'rename' | 'delete' | 'move') {
  const deleting = operation === 'delete', moving = operation === 'move'
  const action = deleting ? '删除' : moving ? '移动' : '改名'
  const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = target.name.replaceAll("'", "''").replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reference = new RegExp(`(?:'${quoted}'|(?:^|[^A-Za-z0-9_.])${escaped})\\s*!`, 'i')
  const index = sheets(pkg).findIndex(sheet => sheet.part === target.part)
  for (const part of Object.keys(pkg.parts).filter(name => name.endsWith('.xml'))) {
    if (deleting && part === target.part) continue
    const xml = pkg.xml(part)
    for (const node of Array.from(xml.getElementsByTagName('*'))) {
      const name = node.localName ?? node.nodeName.split(':').pop()
      if (name === 'definedName' && deleting && Number(node.getAttribute('localSheetId')) === index && node.hasAttribute('localSheetId')) continue
      if (['f', 'formula', 'formula1', 'formula2', 'definedName', 'calculatedColumnFormula', 'totalsRowFormula'].includes(name ?? '')) {
        const formula = node.textContent ?? ''
        // 3-D and external references require a dedicated dependency-aware operation.
        // MS-XLSX 2.2.2 excludes operators and delimiters, not Unicode or symbols, from unquoted sheet names.
        if ((!moving && reference.test(formula)) || /(?:'[^']*'|[^ :'\[\]\\?^*\/+&=<>%,-]+):(?:'[^']*'|[^ :'\[\]\\?^*\/+&=<>%,-]+)!/.test(formula) || /'(?:[^']|'')*:(?:[^']|'')*'\s*!/.test(formula)) throw new Error(`工作表 ${target.name} 被公式、名称或图表引用；当前简单${action}不能可靠维护该依赖，请使用专业格式操作。`)
      }
      if (!moving && node.getAttribute('sheet')?.toLocaleLowerCase() === target.name.toLocaleLowerCase()) throw new Error(`工作表 ${target.name} 被透视表或其他结构引用；请先处理依赖。`)
    }
  }
}
function remapSheetPositions(pkg: OfficePackage, previous: Sheet[], current: Sheet[], deleted?: Sheet) {
  const xml = pkg.xml(pkg.main())
  for (const name of descendants(xml, NS.sheet, 'definedName')) {
    if (!name.hasAttribute('localSheetId')) continue
    const owner = previous[Number(name.getAttribute('localSheetId'))]
    if (!owner) throw new Error('工作簿包含无效的局部名称范围，不能安全调整工作表顺序。')
    const next = current.findIndex(sheet => sheet.part === owner.part)
    if (next < 0 && owner.part === deleted?.part) name.parentNode?.removeChild(name)
    else if (next < 0) throw new Error('工作表名称范围无法重定位。')
    else name.setAttribute('localSheetId', String(next))
  }
  for (const view of descendants(xml, NS.sheet, 'workbookView')) for (const attribute of ['activeTab', 'firstSheet']) {
    if (!view.hasAttribute(attribute)) continue
    const owner = previous[Number(view.getAttribute(attribute))]
    const next = owner ? current.findIndex(sheet => sheet.part === owner.part) : -1
    const fallback = current.findIndex(sheet => !['hidden', 'veryHidden'].includes(sheet.node.getAttribute('state') ?? ''))
    view.setAttribute(attribute, String(next < 0 ? Math.max(0, fallback) : next))
  }
}
function addSheet(pkg: OfficePackage, name: string) {
  const main = pkg.main(), workbook = pkg.xml(main), existing = sheets(pkg)
  validateSheetName(existing, name)
  const container = children(workbook.documentElement, NS.sheet, 'sheets')[0]
  if (!container) throw new Error('工作簿缺少工作表列表。')
  let ordinal = 1, part = ''
  do { part = path.posix.join(path.posix.dirname(main), 'worksheets', `sheet${ordinal++}.xml`) } while (pkg.parts[part])
  const relationsName = relationPart(main)
  if (!pkg.parts[relationsName]) pkg.setBinary(relationsName, strToU8(`<Relationships xmlns="${NS.relationship}"/>`))
  const relations = pkg.xml(relationsName), usedIds = new Set(descendants(relations, NS.relationship, 'Relationship').map(value => value.getAttribute('Id')))
  let relationshipId = 1
  while (usedIds.has(`rId${relationshipId}`)) relationshipId++
  const relation = relations.createElementNS(NS.relationship, 'Relationship')
  relation.setAttribute('Id', `rId${relationshipId}`); relation.setAttribute('Type', `${NS.officeRelationship}/worksheet`); relation.setAttribute('Target', path.posix.relative(path.posix.dirname(main), part))
  relations.documentElement.appendChild(relation); pkg.write(relationsName)
  const node = element(workbook, 'sheet'); node.setAttribute('name', name)
  node.setAttribute('sheetId', String(Math.max(0, ...existing.map(sheet => Number(sheet.sheetId) || 0)) + 1)); node.setAttributeNS(NS.officeRelationship, 'r:id', `rId${relationshipId}`)
  container.appendChild(node); pkg.write(main)
  pkg.setBinary(part, strToU8(`<worksheet xmlns="${NS.sheet}"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/></worksheet>`))
  const types = pkg.xml('[Content_Types].xml'), type = types.createElementNS(types.documentElement.namespaceURI!, 'Override')
  type.setAttribute('PartName', '/' + part); type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
  types.documentElement.appendChild(type); pkg.write('[Content_Types].xml')
}

/** Split only the touched column interval; retain styles, outline and unrelated parts. */
function setColumnWidth(sheet: Sheet, column: number, width: number) {
  const root = sheet.xml.documentElement, protection = children(root, NS.sheet, 'sheetProtection')[0]
  if (protection && ['1', 'true', 'on'].includes(protection.getAttribute('sheet') ?? '') && !['0', 'false', 'off'].includes(protection.getAttribute('formatColumns') ?? '')) throw new Error('工作表受保护，当前不能调整列宽。')
  let cols = children(root, NS.sheet, 'cols')[0]
  if (!cols) { cols = element(sheet.xml, 'cols'); root.insertBefore(cols, children(root, NS.sheet, 'sheetData')[0] ?? null) }
  const existing = children(cols, NS.sheet, 'col'), matches = existing.filter(node => column >= Number(node.getAttribute('min')) && column <= Number(node.getAttribute('max')))
  if (matches.length > 1) throw new Error('该列含重叠列格式范围，当前不能可靠调整列宽。')
  const previous = matches[0], target = previous ? previous.cloneNode(true) as Element : element(sheet.xml, 'col')
  target.setAttribute('min', String(column)); target.setAttribute('max', String(column)); target.setAttribute('width', String(width)); target.setAttribute('customWidth', '1'); target.removeAttribute('bestFit')
  if (previous) {
    const first = Number(previous.getAttribute('min')), last = Number(previous.getAttribute('max'))
    if (first < column) { const before = previous.cloneNode(true) as Element; before.setAttribute('max', String(column - 1)); cols.insertBefore(before, previous) }
    cols.insertBefore(target, previous)
    if (last > column) { const after = previous.cloneNode(true) as Element; after.setAttribute('min', String(column + 1)); cols.insertBefore(after, previous) }
    cols.removeChild(previous)
  } else cols.insertBefore(target, existing.find(node => Number(node.getAttribute('min')) > column) ?? null)
}

export function editXlsx(pkg: OfficePackage, request: OfficeRequest<'xlsx', 'edit'>) {
  for (const edit of request.edits) {
    const allSheets = sheets(pkg)
    if ('type' in edit) {
      if (edit.type === 'columnWidth') {
        const sheet = allSheets.find(value => value.name === edit.sheet)
        if (!sheet) throw new Error(`Excel 工作表不存在：${edit.sheet}`)
        setColumnWidth(sheet, edit.column, edit.width); pkg.write(sheet.part); continue
      }
      assertWorkbookStructureEditable(pkg)
      if (edit.type === 'sheetAdd') { addSheet(pkg, edit.name); continue }
      const sheet = allSheets.find(value => value.name === edit.sheet)
      if (!sheet) throw new Error(`Excel 工作表不存在：${edit.sheet}`)
      if (edit.type === 'sheetRename') {
        validateSheetName(allSheets, edit.name, sheet.name)
        if (sheet.name !== edit.name) assertSheetReferencesEditable(pkg, sheet, 'rename')
        sheet.node.setAttribute('name', edit.name)
      } else if (edit.type === 'sheetMove') {
        if (edit.index >= allSheets.length) throw new Error('工作表排序位置超出范围。')
        // Reversing 3-D endpoints can require rewriting the reference itself.
        // Preserve the original formula by refusing moves we cannot maintain.
        assertSheetReferencesEditable(pkg, sheet, 'move')
        const container = sheet.node.parentNode!, remaining = allSheets.filter(value => value !== sheet)
        container.removeChild(sheet.node); container.insertBefore(sheet.node, remaining[edit.index]?.node ?? null)
        remapSheetPositions(pkg, allSheets, sheets(pkg))
      } else {
        if (allSheets.length <= 1 || (!['hidden', 'veryHidden'].includes(sheet.node.getAttribute('state') ?? '') && allSheets.filter(value => !['hidden', 'veryHidden'].includes(value.node.getAttribute('state') ?? '')).length <= 1)) throw new Error('工作簿必须保留至少一张可见工作表。')
        assertSheetReferencesEditable(pkg, sheet, 'delete')
        const id = sheet.node.getAttributeNS(NS.officeRelationship, 'id')
        sheet.node.parentNode?.removeChild(sheet.node)
        const relationsName = relationPart(pkg.main()), relations = pkg.xml(relationsName)
        for (const relation of descendants(relations, NS.relationship, 'Relationship')) if (relation.getAttribute('Id') === id) relation.parentNode?.removeChild(relation)
        pkg.write(relationsName)
        const types = pkg.xml('[Content_Types].xml')
        for (const type of Array.from(types.documentElement.childNodes)) if (type.nodeType === 1 && (type as Element).getAttribute('PartName') === '/' + sheet.part) type.parentNode?.removeChild(type)
        pkg.write('[Content_Types].xml'); pkg.remove(sheet.part)
        const sheetRelations = relationPart(sheet.part); if (pkg.parts[sheetRelations]) pkg.remove(sheetRelations)
        remapSheetPositions(pkg, allSheets, sheets(pkg), sheet)
      }
      pkg.write(pkg.main()); continue
    }
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

function basicNumberDisplay(value: number, code: string): string | undefined {
  // Keep complex native format codes intact and show the raw value when the preview cannot represent them.
  const match = /^(0|#,##0)(?:\.(0{1,20}))?(%)?$/.exec(code)
  if (!match) return undefined
  const decimals = match[2]?.length ?? 0
  return value.toLocaleString('en-US', { style: match[3] ? 'percent' : 'decimal', useGrouping: match[1] === '#,##0', minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function inspectXlsx(pkg: OfficePackage): Extract<OfficeContentInspection, { format: 'xlsx' }> {
  const strings = sharedStrings(pkg)
  const styles = xlsxStylePart(pkg)
  const styleRoot = styles && pkg.parts[styles] ? pkg.xml(styles).documentElement : undefined
  const formats = styleRoot && children(styleRoot, NS.sheet, 'cellXfs')[0]
  const numberFormats = new Map(styleRoot ? descendants(styleRoot, NS.sheet, 'numFmt').map(node => [node.getAttribute('numFmtId'), node.getAttribute('formatCode')]) : [])
  const styleCodes = formats ? children(formats, NS.sheet, 'xf').map(node => numberFormats.get(node.getAttribute('numFmtId'))) : []
  return { format: 'xlsx', sheets: sheets(pkg).map(sheet => ({ name: sheet.name, part: sheet.part, sheetId: sheet.sheetId,
    columnWidths: descendants(sheet.xml, NS.sheet, 'col').filter(node => node.hasAttribute('width')).map(node => ({ min: Number(node.getAttribute('min')), max: Number(node.getAttribute('max')), width: Number(node.getAttribute('width')) })).filter(value => Number.isInteger(value.min) && Number.isInteger(value.max) && value.min >= 1 && value.max <= 16384 && value.max >= value.min && Number.isFinite(value.width) && value.width >= 0),
    mergedRanges: descendants(sheet.xml, NS.sheet, 'mergeCell').map(node => node.getAttribute('ref') ?? '').filter(Boolean),
    cells: descendants(sheet.xml, NS.sheet, 'c').map(cell => {
    const formula = children(cell, NS.sheet, 'f')[0]
    const value = cellScalar(cell, strings), numberFormat = styleCodes[Number(cell.getAttribute('s') || 0)]
    const display = typeof value === 'number' && numberFormat ? basicNumberDisplay(value, numberFormat) : undefined
    return { cell: cell.getAttribute('r') ?? '', value, ...(formula ? { formula: formula.textContent ?? '' } : {}),
      ...(numberFormat ? { numberFormat } : {}), ...(display !== undefined ? { display } : {}) }
  }) })) }
}
