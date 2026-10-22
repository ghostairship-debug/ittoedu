import type { CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { DocumentPoint } from '../../../shared/document/ports'
import { layoutTable } from '../../../components/table/render'
import type { TextRunStyle } from '../../../shared/contracts/native-v1/types'
import type { TableData } from '../../../components/table/data'
import type { DocumentBlock } from '../../../shared/document/content'
import { documentBlockChildren } from '../../../shared/document/content'
import { equalComponentValue } from '../../../core/drivers/courseV10Operations'

interface TableDefaults {
  revision: number
  data: unknown
  cells: Map<string, Map<string, TextRunStyle>>
  headers: Map<string, TextRunStyle>
}
// A formal project snapshot/revision is immutable. Keep its disposable table
// projection here instead of parsing and laying out that table per inline.
const tableDefaults = new WeakMap<CourseProjectV10, Map<string, TableDefaults>>()

function readTableDefaults(project: CourseProjectV10, blockId: string, data: unknown): TableDefaults {
  let tables = tableDefaults.get(project)
  if (!tables) { tables = new Map(); tableDefaults.set(project, tables) }
  const previous = tables.get(blockId)
  if (previous?.revision === project.revision && previous.data === data) return previous
  const next = { ...tableStyleLookup(data), revision: project.revision, data }
  tables.set(blockId, next)
  return next
}

function tableStyleLookup(data: unknown) {
  const next = { cells: new Map<string, Map<string, TextRunStyle>>(), headers: new Map<string, TextRunStyle>() }
  for (const cell of layoutTable(data as Parameters<typeof layoutTable>[0]).cells) {
    const style = { fontFamily: cell.style.fontFamily, fontSize: cell.style.fontSize, color: cell.style.textColor, bold: cell.style.bold, italic: cell.style.italic }
    if (cell.id === `flow_header_${cell.columnId}`) next.headers.set(cell.columnId, style)
    let row = next.cells.get(cell.rowId)
    if (!row) { row = new Map(); next.cells.set(cell.rowId, row) }
    row.set(cell.columnId, style)
  }
  return next
}

const textStyleNames = new Set(['fontFamily', 'fontSize', 'color', 'bold', 'italic', 'underline', 'strike', 'emphasis', 'highlightColor'])
const tableStyleNames = new Set(['fontFamily', 'fontSize', 'textColor', 'bold', 'italic'])
function styleFields(value: unknown, names: ReadonlySet<string>): TextRunStyle | undefined {
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([name]) => names.has(name))) : undefined
}
function tableStyleInput(data: TableData) {
  return { style: styleFields(data.style, tableStyleNames), headerRowCount: data.headerRowCount, headerEnabled: data.headerEnabled,
    columns: data.columns.map(column => ({ id: column.id, header: Boolean(column.header) })),
    rows: data.rows.map(row => ({ id: row.id, cells: row.cells.map(cell => ({ id: cell.id, columnId: cell.columnId,
      style: styleFields(cell.style, tableStyleNames) })) })), merges: data.merges }
}
function tableStyleAt(defaults: ReturnType<typeof tableStyleLookup>, point?: DocumentPoint | null): TextRunStyle | undefined {
  const slot = point?.slot
  const style = slot?.kind === 'cell' ? defaults.cells.get(slot.rowId)?.get(slot.columnId)
    : slot?.kind === 'header' ? defaults.headers.get(slot.columnId) : undefined
  return style && { ...style }
}

/** A Flow view's disposable defaults cache. Entries retain only style/identity
 * inputs and lookups, never the project or authored text snapshots. */
export function createFlowInlineStyleDefaults() {
  type Entry = { input: unknown; text?: TextRunStyle; table?: ReturnType<typeof tableStyleLookup> }
  let entries = new Map<string, Entry>()
  let result = (_blockId: string, _point?: DocumentPoint | null): TextRunStyle | undefined => undefined
  return (project: CourseProjectV10, blocks: readonly DocumentBlock[]) => {
    const next = new Map<string, Entry>()
    const visit = (blocks: readonly DocumentBlock[]) => {
      for (const block of blocks) {
        const instance = project.instances[block.id], implementation = instance && project.definitions[instance.definitionId]?.implementation
        if (implementation?.kind === 'builtin' && !instance.implementationOverride) {
          const key = implementation.key, previous = entries.get(block.id)
          if (key === 'guoling.text' || key === 'guoling.table') {
            const text = key === 'guoling.text' ? styleFields((instance.data as any).appearance, textStyleNames) : undefined
            const input = key === 'guoling.text' ? { key, text } : { key, table: tableStyleInput(instance.data as unknown as TableData) }
            next.set(block.id, previous && equalComponentValue(previous.input, input) ? previous
              : { input, ...(key === 'guoling.text' ? { text } : { table: tableStyleLookup(instance.data) }) })
          }
        }
        const children = documentBlockChildren(block)
        if (children) visit(children)
      }
    }
    visit(blocks)
    if (next.size === entries.size && [...next].every(([id, entry]) => entries.get(id) === entry)) return result
    entries = next
    const snapshot = next
    result = (blockId, point) => {
      const entry = snapshot.get(blockId)
      return entry?.table ? tableStyleAt(entry.table, point) : entry?.text && { ...entry.text }
    }
    return result
  }
}

/** The selected slot reads the same effective style as the visible table/text. */
export function flowInlineStyleDefaults(project: CourseProjectV10, blockId: string, point?: DocumentPoint): TextRunStyle | undefined {
  const instance = project.instances[blockId], key = instance && project.definitions[instance.definitionId]?.implementation
  if (key?.kind !== 'builtin' || instance.implementationOverride) return undefined
  if (key.key === 'guoling.text') {
    const appearance = (instance.data as any).appearance
    return styleFields(appearance, textStyleNames)
  }
  if (key.key === 'guoling.table' && point) {
    return tableStyleAt(readTableDefaults(project, blockId, instance.data), point)
  }
  return undefined
}
