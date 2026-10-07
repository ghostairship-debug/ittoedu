import type { ComponentInstance, ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { chartDataSchema, type ChartData } from './data'
import { renderChart } from './render'

/** Label/legend selection events can drive ordinary behavior attachments. */
export const CHART_CATEGORY_EVENT = 'chart.category.select'
export const CHART_SERIES_EVENT = 'chart.series.select'
export const chartRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance: initial, root, scope, authoring }) {
    let instance: ComponentInstance<ChartData> = { ...initial, data: chartDataSchema.parse(initial.data) }
    let element: HTMLElement | undefined, disposed = false
    let authorFields: (() => void)[] = []
    const active = () => !disposed && scope.isActive() && !scope.signal.aborted
    const releaseAuthorFields = () => { authorFields.forEach(release => release()); authorFields = [] }
    const registerAuthorFields = () => {
      releaseAuthorFields()
      if (!root || !element || !authoring || !active()) return
      for (const label of element.querySelectorAll<SVGTextElement>('text[data-chart-text="title"], text[data-chart-category-id], text[data-chart-series-id]')) {
        const category = instance.data.categories.findIndex(value => value.id === label.dataset.chartCategoryId)
        const series = instance.data.series.findIndex(value => value.id === label.dataset.chartSeriesId)
        const dataPath = label.dataset.chartText === 'title' ? ['title'] : category >= 0 ? ['categories', String(category), 'label'] : series >= 0 ? ['series', String(series), 'name'] : null
        if (!dataPath) continue
        const initialValue = dataPath[0] === 'title' ? instance.data.title : category >= 0 ? instance.data.categories[category].label : instance.data.series[series].name
        const bounds = label.getBBox(), matrix = label.getCTM()
        if (!matrix || bounds.width <= 0 || bounds.height <= 0) continue
        authorFields.push(authoring.register({ kind: 'text', dataPath, initialValue,
          // SVG's CTM is local to its viewport; screen bounds would apply the
          // workspace zoom/instance transform a second time in the host.
          localBounds: { width: bounds.width, height: bounds.height,
            transform: [matrix.a, matrix.b, matrix.c, matrix.d,
              matrix.a * bounds.x + matrix.c * bounds.y + matrix.e,
              matrix.b * bounds.x + matrix.d * bounds.y + matrix.f] } }))
      }
    }
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
      registerAuthorFields()
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(registerAuthorFields)
    if (root) observer?.observe(root)
    const dispose = () => { if (disposed) return; disposed = true; observer?.disconnect(); releaseAuthorFields(); element?.removeEventListener('click', select); element?.remove(); element = undefined }
    scope.cleanup(dispose); paint()
    void root?.ownerDocument.fonts?.ready.then(() => { if (active()) registerAuthorFields() })
    return {
      update(next) { if (!active()) return; instance = { ...next, data: chartDataSchema.parse(next.data) }; paint() },
      updatePlacement(frame) { if (!active()) return; instance = { ...instance, frame }; paint() },
      dispose,
    }
  },
}
