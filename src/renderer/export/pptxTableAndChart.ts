import type PptxGenJS from 'pptxgenjs'
import {
  buildNativeTableLayout,
  type NativeTableEffectiveCellStyle,
  type NativeTableLayoutContent,
} from '../../shared/nativeTableLayout'
import {
  buildNativeChartView,
  type NativeChartViewContent,
} from '../../shared/nativeChartView'
import type {
  PublishedNativeChartInput,
  PublishedNativeTableInput,
} from '../../player/surfaces/slide/publishedNativeRendering'
import {
  PIXELS_TO_POINTS,
  pptxColor,
  pptxFontFace,
  pptxNodePosition,
  pptxObjectName,
  pptxTransparency,
  type CanvasScale,
  type PptxSlide,
} from './pptxShared'

export interface PptxNativeStaticWarningInput {
  readonly layerItemId: string
  readonly label: string
  readonly rotation: number
  readonly opacity: number
}

/** Pure warning rules shared by the PPTX producer and export preflight. */
export function pptxNativeTableWarnings(
  input: PptxNativeStaticWarningInput & { readonly content: NativeTableLayoutContent },
): string[] {
  const warnings: string[] = []
  const label = input.label || input.layerItemId
  if (Math.abs(input.rotation) > 0.001) {
    warnings.push(`表格“${label}”带旋转，PPTX 原生表格不支持旋转，已按未旋转导出。`)
  }
  if (input.opacity < 1) {
    warnings.push(`表格“${label}”带整体透明度，PPTX 原生表格不支持，已按不透明导出。`)
  }
  if (input.content.style.lineStyle === 'dotted') {
    warnings.push(`表格“${label}”的点线边框在 PPTX 中近似为虚线。`)
  }
  if (input.content.style.borderWidth > 0 && input.content.style.borderOpacity < 1) {
    warnings.push(`表格“${label}”的边框透明度在 PPTX 中不支持，已按不透明边框导出。`)
  }
  return warnings
}

/** Pure warning rules shared by the PPTX producer and export preflight. */
export function pptxNativeChartWarnings(
  input: PptxNativeStaticWarningInput & { readonly content: NativeChartViewContent },
): string[] {
  const warnings: string[] = []
  const label = input.label || input.layerItemId
  if (Math.abs(input.rotation) > 0.001) {
    warnings.push(`图表“${label}”带旋转，PPTX 原生图表不支持旋转，已按未旋转导出。`)
  }
  if (input.opacity < 1) {
    warnings.push(`图表“${label}”带整体透明度，PPTX 原生图表不支持，已按不透明导出。`)
  }
  return warnings
}

function pptxTableCellBorder(style: NativeTableEffectiveCellStyle): PptxGenJS.BorderProps {
  if (style.borderWidth <= 0) return { type: 'none' }
  return {
    type: style.lineStyle === 'solid' ? 'solid' : 'dash',
    color: pptxColor(style.borderColor, 'CBD5E1'),
    pt: Math.max(0.25, style.borderWidth * PIXELS_TO_POINTS),
  }
}

/** Projects a Published Native Table onto a real, editable PPTX table. */
export function addPptxTableNode(
  slide: PptxSlide,
  node: PublishedNativeTableInput,
  scale: CanvasScale,
): string[] {
  const layout = buildNativeTableLayout(node, { width: node.width, height: node.height })
  const rows: PptxGenJS.TableRow[] = layout.rows.map((row) => (
    row.cells.map((cell) => ({
      text: cell.text,
      options: {
        fill: {
          color: pptxColor(cell.style.fillColor, 'FFFFFF'),
          transparency: pptxTransparency(cell.style.fillOpacity),
        },
        color: pptxColor(cell.style.textColor),
        fontFace: pptxFontFace(cell.style.fontFamily),
        fontSize: Math.max(6, Math.round(cell.style.fontSize * PIXELS_TO_POINTS * 10) / 10),
        bold: cell.style.bold,
        italic: cell.style.italic,
        align: cell.style.horizontalAlign,
        valign: cell.style.verticalAlign,
        margin: Math.max(0, cell.style.cellPadding * scale.x),
        border: pptxTableCellBorder(cell.style),
      },
    }))
  ))
  slide.addTable(rows, {
    ...pptxNodePosition(node, scale),
    colW: layout.columns.map((column) => Math.max(0.05, column.width * scale.x)),
    rowH: layout.rows.map((row) => Math.max(0.05, row.height * scale.y)),
    autoPage: false,
    objectName: pptxObjectName(node),
  })
  return pptxNativeTableWarnings({
    layerItemId: node.id,
    label: node.name,
    rotation: node.rotation,
    opacity: node.opacity,
    content: node,
  })
}

const PPTX_CHART_TYPE: Record<PublishedNativeChartInput['chartType'], PptxGenJS.CHART_NAME> = {
  bar: 'bar',
  line: 'line',
  area: 'area',
  pie: 'pie',
  donut: 'doughnut',
}

const PPTX_LEGEND_POS: Record<'top' | 'right' | 'bottom' | 'left', 't' | 'r' | 'b' | 'l'> = {
  top: 't',
  right: 'r',
  bottom: 'b',
  left: 'l',
}

/** Projects a Published Native Chart onto a real, editable PPTX chart. */
export function addPptxChartNode(
  slide: PptxSlide,
  node: PublishedNativeChartInput,
  scale: CanvasScale,
): string[] {
  const view = buildNativeChartView(node, { width: node.width, height: node.height })
  const style = node.style
  const fontFace = pptxFontFace(style.fontFamily)
  const textColor = pptxColor(style.textColor, '1F2937')
  const fontSize = Math.max(6, Math.round(style.fontSize * PIXELS_TO_POINTS * 10) / 10)
  const labels = node.categories.map((category) => category.label)

  const circular = node.chartType === 'pie' || node.chartType === 'donut'
  const data: PptxGenJS.OptsChartData[] = circular
    ? [{
        name: node.series[0]?.name ?? '',
        labels,
        values: node.categories.map((category, index) => (
          view.circularSlices?.find((slice) => slice.categoryId === category.id)?.value
            ?? view.circularSlices?.[index]?.value
            ?? 0
        )),
      }]
    : (view.cartesianSeries ?? []).map((series) => ({
        name: series.name,
        labels,
        values: node.categories.map((category) => (
          series.points.find((point) => point.categoryId === category.id)?.value ?? 0
        )),
      }))
  const chartColors = circular
    ? (view.circularSlices ?? []).map((slice) => pptxColor(slice.color, '2563EB'))
    : (view.cartesianSeries ?? []).map((series) => pptxColor(series.color, '2563EB'))

  const options: PptxGenJS.IChartOpts = {
    ...pptxNodePosition(node, scale),
    objectName: pptxObjectName(node),
    altText: view.accessibleDescription,
    showTitle: node.title.trim().length > 0,
    title: node.title,
    titleColor: textColor,
    titleFontFace: fontFace,
    titleFontSize: fontSize + 2,
    showLegend: style.showLegend,
    legendPos: PPTX_LEGEND_POS[style.legendPosition],
    legendColor: textColor,
    legendFontFace: fontFace,
    legendFontSize: fontSize,
    showValue: style.showDataLabels,
    dataLabelColor: textColor,
    dataLabelFontFace: fontFace,
    dataLabelFontSize: fontSize,
    chartColors,
    chartArea: {
      fill: {
        color: pptxColor(style.backgroundColor, 'FFFFFF'),
        transparency: pptxTransparency(style.backgroundOpacity),
      },
    },
  }

  if (!circular && 'showCategoryAxis' in style) {
    options.catAxisHidden = !style.showCategoryAxis
    options.valAxisHidden = !style.showValueAxis
    options.catAxisLabelColor = textColor
    options.catAxisLabelFontFace = fontFace
    options.catAxisLabelFontSize = fontSize
    options.valAxisLabelColor = textColor
    options.valAxisLabelFontFace = fontFace
    options.valAxisLabelFontSize = fontSize
    options.valGridLine = {
      style: style.showGridLines ? 'solid' : 'none',
      color: 'E5E7EB',
      size: 1,
    }
    if (style.valueMin !== undefined) options.valAxisMinVal = style.valueMin
    if (style.valueMax !== undefined) options.valAxisMaxVal = style.valueMax
  }
  if (node.chartType === 'bar') {
    options.barDir = 'col'
    options.barGrouping = 'clustered'
  }
  if (node.chartType === 'area') {
    // The shared renderer paints area fills at 25% opacity; mirror that here.
    options.chartColorsOpacity = 25
  }
  if (node.chartType === 'donut' && 'holeSize' in style) {
    options.holeSize = style.holeSize
  }

  slide.addChart(PPTX_CHART_TYPE[node.chartType], data, options)
  return pptxNativeChartWarnings({
    layerItemId: node.id,
    label: node.name,
    rotation: node.rotation,
    opacity: node.opacity,
    content: node,
  })
}
