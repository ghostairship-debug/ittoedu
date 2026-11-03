import type { OfficeCellValue } from '../../../shared/workbench/officeFiles'

export const XLSX_ROW_LIMIT = 1048576, XLSX_COLUMN_LIMIT = 16384, XLSX_DEFAULT_COLUMN_PIXELS = 128
export interface CellPosition { row: number; column: number }
export interface CellRange { first: CellPosition; last: CellPosition }
export function columnName(value: number): string { let result = ''; for (; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result; return result }
export function position(value: string): CellPosition | null {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/i.exec(value.trim())
  if (!match) return null
  const row = Number(match[2]), column = [...match[1].toUpperCase()].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0)
  return row <= XLSX_ROW_LIMIT && column <= XLSX_COLUMN_LIMIT ? { row, column } : null
}
export function cellName(value: CellPosition): string { return columnName(value.column) + value.row }
export function rangeBetween(a: string, b = a): CellRange {
  const first = position(a)!, last = position(b)!
  return { first: { row: Math.min(first.row, last.row), column: Math.min(first.column, last.column) }, last: { row: Math.max(first.row, last.row), column: Math.max(first.column, last.column) } }
}
export function rangeContains(range: CellRange, cell: CellPosition): boolean { return cell.row >= range.first.row && cell.row <= range.last.row && cell.column >= range.first.column && cell.column <= range.last.column }
export function parsedMergedRanges(ranges: readonly string[] = []): CellRange[] {
  return ranges.flatMap(value => { const [first, last = first] = value.replaceAll('$', '').split(':'); return position(first) && position(last) ? [rangeBetween(first, last)] : [] })
}
export function inputValue(value: string): OfficeCellValue {
  if (value.startsWith('=')) return { formula: value.slice(1) }
  if (value === '') return null
  if (value.startsWith("'")) return value.slice(1)
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  // Identifiers such as 00123 retain their visible spelling.
  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value))) return Number(value)
  return value
}
/** Excel's tab-separated clipboard quotes embedded tabs/newlines and doubles quotes. */
export function parseTsv(text: string): string[][] {
  const source = text.replace(/\r\n?/g, '\n'), rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false, invalid = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') { quoted = false; closed = true }
      else field += char
    } else if (char === '\t' || char === '\n') {
      row.push(field); field = ''; closed = false
      if (char === '\n') { rows.push(row); row = [] }
    } else if (char === '"' && !field && !closed) quoted = true
    else { if (closed) invalid = true; field += char }
  }
  if (quoted || invalid) return source.replace(/\n$/, '').split('\n').map(value => value.split('\t'))
  if (!source.endsWith('\n') || row.length || field) { row.push(field); rows.push(row) }
  return rows.length ? rows : [['']]
}
export function serializeTsv(rows: readonly (readonly string[])[]): string { return rows.map(row => row.map(value => /[\t\r\n"]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value).join('\t')).join('\r\n') }
// The grid uses a 7px digit and Excel's 5px cell padding; OOXML retains character units.
export function columnWidthPixels(width: number): number { return Math.max(0, Math.round(width * 7 + 5)) }
export function columnWidthCharacters(pixels: number): number { return Math.max(0, Math.min(255, Math.round((pixels - 5) / 7 * 256) / 256)) }
