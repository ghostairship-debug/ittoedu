import type { CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { DocumentPoint } from '../../../shared/document/ports'
import { parseTableData } from '../../../components/table/data'
import { layoutTable } from '../../../components/table/render'
import type { TextRunStyle } from '../../../shared/contracts/native-v1/types'

/** The selected slot reads the same effective style as the visible table/text. */
export function flowInlineStyleDefaults(project: CourseProjectV10, blockId: string, point?: DocumentPoint): TextRunStyle | undefined {
  const instance = project.instances[blockId], key = instance && project.definitions[instance.definitionId]?.implementation
  if (key?.kind !== 'builtin' || instance.implementationOverride) return undefined
  if (key.key === 'guoling.text') {
    const appearance = (instance.data as any).appearance
    return appearance ? Object.fromEntries(Object.entries(appearance).filter(([name]) => ['fontFamily','fontSize','color','bold','italic','underline','strike','emphasis','highlightColor'].includes(name))) : undefined
  }
  if (key.key === 'guoling.table' && point) {
    const slot = point.slot, measured = layoutTable(parseTableData(instance.data))
    const cell = slot.kind === 'cell' ? measured.cells.find(cell => cell.rowId === slot.rowId && cell.columnId === slot.columnId)
      : slot.kind === 'header' ? measured.cells.find(cell => cell.id === `flow_header_${slot.columnId}`) : undefined
    if (cell) return { fontFamily: cell.style.fontFamily, fontSize: cell.style.fontSize, color: cell.style.textColor, bold: cell.style.bold, italic: cell.style.italic }
  }
  return undefined
}
