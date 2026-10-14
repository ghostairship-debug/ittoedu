import { mountDocumentInlineComponents } from '../../shared/document/textInteraction'
import type { ComponentInstance, ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { parseTableData } from './data'
import { renderTableSvg } from './render'
import { outputTableHtml } from './output'

export const tableRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance: initial, scope, root, inline }) {
    let instance = initial, disposed = false, element: HTMLElement | undefined
    let releaseInline: (() => void) | undefined
    const paint = () => {
      if (disposed || !scope.isActive() || scope.signal.aborted || !root) return
      const data = parseTableData(instance.data)
      const width = instance.frame?.width ?? data.columns.reduce((sum, column) => sum + column.width, 0)
      const height = instance.frame?.height ?? data.rows.reduce((sum, row) => sum + row.height, 0)
      const next = root.ownerDocument.createElement('div')
      next.innerHTML = data.caption || data.columns.some(column=>column.header) || data.rows.some(row=>row.cells.some(cell=>cell.content))
        ? outputTableHtml(data,{width,height}) : renderTableSvg(data, width, height, instance.id)
      root.replaceChildren(next)
      const previous = releaseInline; releaseInline = mountDocumentInlineComponents(next, inline); previous?.()
      scope.events.emit('__runtime.text-ranges', { instanceId: instance.id })
      element = next
    }
    const dispose = () => { if (disposed) return; disposed = true; releaseInline?.(); element?.remove(); element = undefined }
    scope.cleanup(dispose)
    paint()
    return {
      update(next: ComponentInstance) { instance = next; paint() },
      updatePlacement(frame) { instance = { ...instance, frame }; paint() },
      dispose,
    }
  },
}
