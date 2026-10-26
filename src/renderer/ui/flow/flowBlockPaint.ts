import type { ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { componentPaintStyle } from '../../../shared/componentPaintStyle'
import { applyComponentPaintStyle } from '../../../player/components/componentPlacementStyle'
import { isNativeFlowLayoutGroup, nativeFlowItemStyle, flowStickyStyle } from '../../../shared/flowNativeLayout'
import { equalComponentValue } from '../../../shared/componentValue'
import { textAppearanceSchema, textSizingSchema } from '../../../components/text/data'
import { textAppearanceStyles } from '../../../components/text/render'
import { layoutTable } from '../../../components/table/render'
import type { TableData } from '../../../components/table/data'
import { courseInstanceSlotPath } from '../../../core/tools/ToolTargets'

function slotShape(data: any) {
  return { items: Array.isArray(data?.items) ? data.items.map((item: any) => item.id) : undefined,
    columns: Array.isArray(data?.columns) ? data.columns.map((column: any) => column.id) : undefined,
    rows: Array.isArray(data?.rows) ? data.rows.map((row: any) => ({ id: row.id, cells: Array.isArray(row.cells)
      ? row.cells.map((cell: any) => ({ columnId: cell.columnId, rich: Object.hasOwn(cell, 'content') })) : Object.keys(row.cells ?? {}) })) : undefined }
}
function tableInput(data: TableData) {
  return { style: data.style, headerRowCount: data.headerRowCount, headerEnabled: data.headerEnabled, merges: data.merges,
    columns: data.columns.map(column => ({ id: column.id, width: column.width, header: Boolean(column.header) })),
    rows: data.rows.map(row => ({ id: row.id, height: row.height, cells: row.cells.map(cell => ({ id: cell.id, columnId: cell.columnId, style: cell.style })) })) }
}
function implementation(value: ComponentInstance['implementationOverride']) {
  return value && { kind: value.kind, key: value.kind === 'builtin' ? value.key : undefined }
}

/** Projection paint is independent of paragraph reflow. Cache only its actual
 * style/slot inputs; ordinary body ACKs do not parse text or lay out tables. */
export function createFlowBlockPaint(paper: HTMLElement, surfaceId: string, readProject: () => CourseProjectV10,
  notify: (instanceId: string, element: HTMLElement) => void, mutate: (paint: () => void) => void) {
  const entries = new Map<HTMLElement, { input: unknown; textInput?: unknown; tableInput?: unknown; text?: Record<string, string>; table?: ReturnType<typeof tablePaint>; native: Record<string, string>; display?: string }>()
  const probe = paper.ownerDocument.createElement('div').style
  const style = (element: HTMLElement, values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) if (value !== undefined) {
      ;(probe as any)[key] = value
      const normalized = (probe as any)[key]
      if ((element.style as any)[key] !== normalized) (element.style as any)[key] = normalized
    }
  }
  function tablePaint(data: TableData) {
    const measured = layoutTable(data), effective = new Map(measured.cells.map(cell => [cell.id, cell.style]))
    const columns = new Map(data.columns.map(column => [column.id, column.width])), cells = new Map<string, Record<string, string>>()
    for (const row of data.rows) for (const cell of row.cells) {
      const value = effective.get(cell.id)
      if (value) cells.set(`cell:${JSON.stringify([row.id, cell.columnId])}`, { width: `${columns.get(cell.columnId) ?? 200}px`, height: `${row.height}px`,
        padding: `${value.cellPadding}px`, backgroundColor: value.fillColor, color: value.textColor, fontFamily: value.fontFamily,
        fontSize: `${value.fontSize}px`, fontWeight: value.bold ? '700' : '400', fontStyle: value.italic ? 'italic' : 'normal',
        textAlign: value.horizontalAlign, verticalAlign: value.verticalAlign, border: `${value.borderWidth}px ${value.lineStyle} ${value.borderColor}` })
    }
    return { width: measured.width, cells }
  }
  const update = (element: HTMLElement, domChanged: boolean) => {
    if (!paper.contains(element)) { entries.delete(element); return false }
    const project = readProject(), instance = project.instances[element.dataset.flowBlockId!]
    if (!instance) { entries.delete(element); element.dataset.componentFlowId = ''; return false }
    if (element.hasAttribute('data-flow-reading-group')) { entries.delete(element); return false }
    const definition = project.definitions[instance.definitionId], key = definition?.implementation
    const builtin = key?.kind === 'builtin' && !instance.implementationOverride ? key.key : undefined
    const parentElement = element.parentElement?.closest<HTMLElement>('[data-flow-block-id]')
    const parent = project.instances[parentElement?.dataset.flowBlockId ?? surfaceId]
    const nativeParent = Boolean(parent && isNativeFlowLayoutGroup(parent, project.definitions[parent.definitionId]))
    const data = instance.data as any, previous = entries.get(element)
    const input = { id: instance.id, definitionId: instance.definitionId, definition: implementation(key), override: implementation(instance.implementationOverride),
      style: instance.style, frame: Boolean(instance.frame), children: Boolean(instance.childIds?.length), visible: instance.visible,
      html: typeof data?.html === 'string' ? data.html : undefined, nativeParent, kind: element.dataset.flowBodyBlock,
      slots: slotShape(data), text: builtin === 'guoling.text' ? { appearance: data.appearance, sizing: data.sizing } : undefined,
      table: builtin === 'guoling.table' ? tableInput(data) : undefined }
    const changed = !previous || !equalComponentValue(previous.input, input)
    if (!changed && !domChanged) return false
    let entry = previous
    if (changed) {
      let text = previous?.text
      if (builtin !== 'guoling.text') text = undefined
      else if (!previous || !equalComponentValue(previous.textInput, input.text)) {
        const presentation = textAppearanceStyles(textAppearanceSchema.parse(data.appearance ?? {}), textSizingSchema.parse(data.sizing ?? {}))
        const { height: _height, display: _display, flexDirection: _direction, justifyContent: _justify, ...box } = presentation.box
        const { height: _contentHeight, ...content } = presentation.content
        text = { ...box, ...content }
      }
      const display = componentPaintStyle(instance, definition).display
      entry = { input, textInput: input.text, tableInput: input.table, text,
        table: builtin === 'guoling.table' ? previous?.table && equalComponentValue(previous.tableInput, input.table) ? previous.table : tablePaint(data) : undefined,
        display: typeof display === 'string' ? display : undefined,
        native: element.dataset.flowBodyBlock !== 'course-instance'
          ? { ...(nativeParent ? { display: 'block', minWidth: '0px', boxSizing: 'border-box', margin: '0px', ...nativeFlowItemStyle(instance) } : {}),
            ...flowStickyStyle(instance) } : {} }
      entries.set(element, entry)
    }
    mutate(() => {
      element.dataset.componentFlowId = instance.id
      if (changed) applyComponentPaintStyle(element, instance, definition)
      if (entry!.text) style(element, entry!.text)
      if (element.dataset.flowBodyBlock !== 'course-instance') {
        for (const name of Object.keys(previous?.native ?? {})) if (!(name in entry!.native)) element.style.removeProperty(name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`))
        style(element, entry!.native)
      }
      style(element, { display: instance.visible === false ? 'none' : entry!.display ?? entry!.native.display ?? '' })
      if (element.matches('p,h1,h2,h3,h4,h5,h6')) element.dataset.documentPath = JSON.stringify(['content'])
      const slots = new Map([...element.querySelectorAll<HTMLElement>('[data-document-slot]')]
        .filter(slot => slot.closest('[data-flow-block-id]') === element).map(slot => [slot.dataset.documentSlot!, slot]))
      if (entry!.table) {
        const table = element.querySelector<HTMLTableElement>('table')
        if (table) style(table, { width: `${entry!.table.width}px`, maxWidth: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' })
        for (const [key, values] of entry!.table.cells) { const owner = slots.get(key)?.closest<HTMLElement>('td,th'); if (owner) style(owner, values) }
      }
      for (const [key, slot] of slots) {
        const field = key.startsWith('item:') ? { kind: 'item' as const, itemId: key.slice(5) }
          : key.startsWith('column:') ? { kind: 'header' as const, columnId: key.slice(7) }
            : key.startsWith('cell:') ? (() => { const [rowId, columnId] = JSON.parse(key.slice(5)); return { kind: 'cell' as const, rowId, columnId } })()
              : { kind: 'field' as const, field: key as 'content' }
        const path = JSON.stringify(courseInstanceSlotPath(instance.data, field))
        if (slot.dataset.documentPath !== path) slot.dataset.documentPath = path
      }
      if (!instance.container) notify(instance.id, element)
    })
    return true
  }
  return {
    paint(elements: readonly HTMLElement[]) { return elements.filter(element => update(element, true)) },
    retire(elements: readonly HTMLElement[]) { elements.forEach(element => entries.delete(element)) },
    refresh() { return [...entries.keys()].filter(element => update(element, false)) },
    destroy() { entries.clear() },
  }
}
