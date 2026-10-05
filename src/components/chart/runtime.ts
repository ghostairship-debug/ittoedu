import type { ComponentInstance, ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { chartDataSchema, type ChartData } from './data'
import { renderChart } from './render'

/** Label/legend selection events can drive ordinary behavior attachments. */
export const CHART_CATEGORY_EVENT = 'chart.category.select'
export const CHART_SERIES_EVENT = 'chart.series.select'
export const chartRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance: initial, root, scope }) {
    let instance: ComponentInstance<ChartData> = { ...initial, data: chartDataSchema.parse(initial.data) }
    let element: HTMLElement | undefined, disposed = false
    const active = () => !disposed && scope.isActive() && !scope.signal.aborted
    const select = (event: Event) => {
      if (!active()) return
      const target = event.target as Element | null
      const categoryId = target?.closest('[data-chart-category-id]')?.getAttribute('data-chart-category-id')
      const seriesId = target?.closest('[data-chart-series-id]')?.getAttribute('data-chart-series-id')
      if (categoryId) scope.events.emit(CHART_CATEGORY_EVENT, { instanceId: instance.id, categoryId })
      if (seriesId) scope.events.emit(CHART_SERIES_EVENT, { instanceId: instance.id, seriesId })
    }
    const paint = () => {
      if (!root || !active()) return
      element?.removeEventListener('click', select)
      element = renderChart(root.ownerDocument, instance.data, instance.frame?.width ?? 640, instance.frame?.height ?? 400, instance.id)
      element.addEventListener('click', select); root.replaceChildren(element)
    }
    const dispose = () => { if (disposed) return; disposed = true; element?.removeEventListener('click', select); element?.remove(); element = undefined }
    scope.cleanup(dispose); paint()
    return {
      update(next) { if (!active()) return; instance = { ...next, data: chartDataSchema.parse(next.data) }; paint() },
      updatePlacement(frame) { if (!active()) return; instance = { ...instance, frame }; paint() },
      dispose,
    }
  },
}
