import { MAX_SCENE_NODES } from '../../shared/constants'
import { chartNativeContentObjectSchema, tableNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import type { NativeChartCategory, NativeChartSeries, NativeChartContent, NativeTableColumn, NativeTableRow, NativeTableStyle } from '../../shared/contracts/native-v1/types'
import type { TableMergeRegion } from '../../shared/tableMerge'
import type { CourseProjectDocument, LayerItem, SlideSurfaceDocument } from '../../shared/courseProjectTypes'
import { createChartNode, createChartLayerItem, createTableNode, createTableLayerItem, type ChartFactoryNode } from './nativeNodeFactories'
import { appendSceneLayer, slideSceneContext, offsetDefaultSlideInsertion, SlideCommandError, type SlideInsertionOwner } from './slideInsertion'
import { allocateCourseLayerOrder } from './layerOrder'
import { commitCourseProjectMutation } from './courseProjectMutation'
export interface AddSlideChartLayerInput {
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly chartType?: 'bar' | 'line' | 'area' | 'pie' | 'donut'
  readonly title?: string
  readonly categories?: NativeChartCategory[]
  readonly series?: NativeChartSeries[]
  readonly style?: Partial<NativeChartContent['style']>
  readonly label?: string
}

export interface AddSlideTableLayerInput {
  readonly merges?: TableMergeRegion[]
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly columns?: NativeTableColumn[]
  readonly rows?: NativeTableRow[]
  readonly headerRowCount?: number
  readonly style?: Partial<NativeTableStyle>
  readonly label?: string
}

function nextSurfaceLayerOrder(
  project: CourseProjectDocument,
  surface: SlideSurfaceDocument,
): number {
  const preferred = Math.max(-1, ...surface.surfaceLayerItems.map((entry) => entry.item.order)) + 1
  return allocateCourseLayerOrder(project, Math.max(0, preferred))
}

export function appendSlideSurfaceLayer(
  project: CourseProjectDocument,
  surface: SlideSurfaceDocument,
  item: LayerItem,
): void {
  if (surface.surfaceLayerItems.length >= MAX_SCENE_NODES) {
    throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
  }
  if (surface.surfaceLayerItems.some((entry) => entry.item.layerItemId === item.layerItemId)) {
    throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  }
  item.order = nextSurfaceLayerOrder(project, surface)
  surface.surfaceLayerItems.push({
    item,
    visibility: { mode: 'all', locationIds: [] },
  })
  surface.surfaceLayerItems.sort((a, b) =>
    a.item.order - b.item.order || a.item.layerItemId.localeCompare(b.item.layerItemId),
  )
}

export function planSlideChartInsertion(document: CourseProjectDocument, owner: SlideInsertionOwner, input: AddSlideChartLayerInput, now?: string) {
    if (owner.scope !== 'scene' && owner.scope !== 'surface') {
      throw new SlideCommandError('wrong-owner', '图表只能在幻灯片场景或本页中使用')
    }
    const { surface, scene } = slideSceneContext(document, owner)
    const existingCount = owner.scope === 'surface'
      ? surface.surfaceLayerItems.length
      : scene.layerItems.length

    const chartNode = createChartNode({
      id: input.id,
      name: input.label,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      chartType: input.chartType,
      title: input.title,
      categories: input.categories,
      series: input.series,
      style: input.style,
    })

    // Validate against strict chart schema
    chartNativeContentObjectSchema.parse({
      chartType: chartNode.chartType,
      title: chartNode.title,
      categories: chartNode.categories,
      series: chartNode.series,
      style: chartNode.style,
    })

    const positioned = offsetDefaultSlideInsertion(
      chartNode,
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const layerItem = createChartLayerItem(positioned as ChartFactoryNode)

    const project = commitCourseProjectMutation(document, (draft) => {
      const { surface: draftSurface, scene: draftScene } = slideSceneContext(draft, owner)
      if (owner.scope === 'surface') {
        appendSlideSurfaceLayer(draft, draftSurface, layerItem)
      } else {
        appendSceneLayer(draft, draftScene, layerItem, owner.selection.stateId)
      }
    }, now)

    return { project, itemId: layerItem.layerItemId }
}
export function planSlideTableInsertion(document: CourseProjectDocument, owner: SlideInsertionOwner, input: AddSlideTableLayerInput, now?: string) {
    if (owner.scope !== 'scene' && owner.scope !== 'surface') {
      throw new SlideCommandError('wrong-owner', '表格只能在幻灯片场景或本页中使用')
    }
    const { surface, scene } = slideSceneContext(document, owner)
    const existingCount = owner.scope === 'surface'
      ? surface.surfaceLayerItems.length
      : scene.layerItems.length

    const tableNode = createTableNode({
      id: input.id,
      name: input.label ?? '表格',
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      columns: input.columns,
      rows: input.rows,
      headerRowCount: input.headerRowCount,
      merges: input.merges,
      style: input.style,
    })

    // Validate against strict table schema
    tableNativeContentObjectSchema.parse({
      columns: tableNode.columns,
      rows: tableNode.rows,
      headerRowCount: tableNode.headerRowCount,
      merges: tableNode.merges,
      style: tableNode.style,
    })

    const positioned = offsetDefaultSlideInsertion(
      tableNode,
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const layerItem = createTableLayerItem(positioned)

    const project = commitCourseProjectMutation(document, (draft) => {
      const { surface: draftSurface, scene: draftScene } = slideSceneContext(draft, owner)
      if (owner.scope === 'surface') {
        appendSlideSurfaceLayer(draft, draftSurface, layerItem)
      } else {
        appendSceneLayer(draft, draftScene, layerItem, owner.selection.stateId)
      }
    }, now)

    return { project, itemId: layerItem.layerItemId }
}
