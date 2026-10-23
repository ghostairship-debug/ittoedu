import { nanoid } from 'nanoid'
import type { ComponentDefinition, JsonValue } from '../../shared/contracts/component-platform/project'
import type { NativeLineGeometry } from '../../shared/contracts/native-v1/types'
import { TEXT_DEFINITION, FORMULA_DEFINITION } from '../../components/text/adapters'
import { createTextComponentData, createFormulaComponentData } from '../../components/text/data'
import { SHAPE_DEFINITION, defaultShapeData } from '../../components/shape/authoring'
import { shapeDataSchema, type ShapeData } from '../../components/shape/data'
import { TABLE_DEFINITION } from '../../components/table/adapters'
import { createTableData, type TableContentInput } from '../../components/table/data'
import { createTableContentData } from '../../components/table/content'
import { CHART_DEFINITION } from '../../components/chart'
import { chartTableDataSchema, createChartData, type ChartData } from '../../components/chart/data'
import { changeChartType, replaceChartTableData, type ChartCandidateData } from '../../components/chart/contentOperations'
import { INPUT_DEFINITION, createInputData } from '../../components/input/data'

export type CourseElementKind = 'text' | 'formula' | 'shape' | 'table' | 'chart' | 'input'
export type ProfessionalElementOrigin = 'slide-authoring' | 'spatial-authoring'
export interface ProfessionalElementOptions {
  origin?: ProfessionalElementOrigin
  shapeType?: ShapeData['shapeType']
  chartType?: ChartData['chartType']
  text?: string
  table?: TableContentInput
  chart?: ChartCandidateData
  lineGeometry?: NativeLineGeometry
}

/** Existing carrier profiles share content defaults while retaining their authored size choices. */
export function professionalElementDefaultSize(kind: CourseElementKind, origin?: ProfessionalElementOrigin): { width: number; height: number } {
  const slide = origin === 'slide-authoring'
  if (origin === 'spatial-authoring') {
    if (kind === 'text') return { width: 320, height: 80 }
    if (kind === 'formula') return { width: 420, height: 160 }
    if (kind === 'shape') return { width: 320, height: 180 }
    if (kind === 'table' || kind === 'chart') return { width: 560, height: 360 }
  }
  if (kind === 'formula') return { width: slide ? 240 : 400, height: slide ? 100 : 90 }
  if (kind === 'shape') return { width: slide ? 200 : 220, height: 140 }
  if (kind === 'table') return { width: 600, height: slide ? 120 : 220 }
  if (kind === 'chart') return { width: slide ? 560 : 520, height: slide ? 360 : 320 }
  return { width: slide ? 320 : 400, height: kind === 'input' ? 120 : slide ? 80 : 70 }
}

export function professionalElementKind(builtinKey: string): CourseElementKind | undefined {
  const kinds: Readonly<Record<string, CourseElementKind>> = { 'guoling.text': 'text', 'guoling.formula': 'formula', 'guoling.shape': 'shape',
    'guoling.table': 'table', 'guoling.chart': 'chart', 'guoling.input': 'input' }
  return kinds[builtinKey]
}

/** No instance identity, placement, transaction or history is allocated here. */
export function prepareProfessionalElement(kind: CourseElementKind, options: ProfessionalElementOptions = {}): {
  definition: ComponentDefinition; data: JsonValue; width: number; height: number
} {
  let definition: ComponentDefinition, data: unknown
  if (kind === 'text') { definition = TEXT_DEFINITION; data = createTextComponentData(options.text ?? '双击编辑文字') }
  else if (kind === 'formula') {
    definition = FORMULA_DEFINITION
    data = createFormulaComponentData(`formula_${nanoid()}`, options.text ?? (options.origin ? 'x^2' : 'x^2+y^2=r^2'))
  } else if (kind === 'shape') {
    definition = SHAPE_DEFINITION
    data = shapeDataSchema.parse({ ...defaultShapeData(options.shapeType), ...(options.lineGeometry ? { lineGeometry: options.lineGeometry } : {}) })
  } else if (kind === 'table') { definition = TABLE_DEFINITION; data = options.table ? createTableContentData(options.table) : createTableData() }
  else if (kind === 'input') { definition = INPUT_DEFINITION; data = createInputData() }
  else {
    definition = CHART_DEFINITION
    const chart = createChartData(), type = options.chartType ?? chart.chartType
    data = options.chart ? replaceChartTableData(chart, chartTableDataSchema.parse(options.chart), nanoid, type) : changeChartType(chart, type)
  }
  return { definition, data: JSON.parse(JSON.stringify(data)) as JsonValue, ...professionalElementDefaultSize(kind, options.origin) }
}
