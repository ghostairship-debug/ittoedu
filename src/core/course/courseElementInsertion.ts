import { nanoid } from 'nanoid'
import type { ComponentContainer, ComponentDefinition, ComponentInstance, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import { containerChildIds, owningContainer } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { NativeLineGeometry } from '../../shared/contracts/native-v1/types'
import { TEXT_DEFINITION, FORMULA_DEFINITION } from '../../components/text/adapters'
import { createTextComponentData, createFormulaComponentData } from '../../components/text/data'
import { SHAPE_DEFINITION, defaultShapeData } from '../../components/shape/authoring'
import { shapeDataSchema, type ShapeData } from '../../components/shape/data'
import { TABLE_DEFINITION } from '../../components/table/adapters'
import { createTableData } from '../../components/table/data'
import { CHART_DEFINITION } from '../../components/chart'
import { createChartData, type ChartData } from '../../components/chart/data'
import { changeChartType } from '../../components/chart/contentOperations'
import { INPUT_DEFINITION, createInputData } from '../../components/input/data'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData, createTeacherControllerFrame } from '../../components/teacher-controller/data'

export type CourseElementKind = 'text' | 'formula' | 'shape' | 'table' | 'chart' | 'input'
export interface CourseInsertionOptions {
  x?: number; y?: number; width?: number; height?: number
  center?: { x: number; y: number }
  container?: ComponentContainer; afterInstanceId?: string | null; index?: number
  shapeType?: ShapeData['shapeType']; chartType?: ChartData['chartType']; text?: string
  lineGeometry?: NativeLineGeometry
  destination?: 'document' | 'paper'
  /** Existing UI default profile, prepared by the host rather than supplied by public intent. */
  origin?: 'slide-authoring'
}
interface CourseInsertionTarget { project: CourseProjectV10; surfaceId: string | null; instanceId?: string | null }

export function insertionContainer(target: CourseInsertionTarget, options: CourseInsertionOptions = {}): ComponentContainer {
  if (options.destination === 'paper' && options.container?.kind !== 'global'
    && target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind === 'flow') {
    if (!target.surfaceId) throw new Error('插入目标没有页面')
    return { kind: 'surface', surfaceId: target.surfaceId }
  }
  if (options.container) return options.container
  const selectedOwner = target.instanceId ? owningContainer(target.project, target.instanceId) : null
  if (selectedOwner?.kind === 'global') return selectedOwner
  if (selectedOwner?.kind === 'instance' && target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind === 'flow') return selectedOwner
  if (!target.surfaceId) throw new Error('插入目标没有页面')
  return { kind: 'surface', surfaceId: target.surfaceId }
}
export function insertionIndex(target: CourseInsertionTarget, container: ComponentContainer, options: CourseInsertionOptions = {}): number {
  const ids = containerChildIds(target.project, container)
  if (options.index !== undefined) return options.index
  if (options.origin === 'slide-authoring') return ids.length
  if (options.afterInstanceId === null) return 0
  const selected = options.afterInstanceId === undefined ? target.instanceId : options.afterInstanceId
  const index = selected ? ids.indexOf(selected) : -1
  return index < 0 ? ids.length : index + 1
}
export function definitionInsertionEdits(target: CourseInsertionTarget, definition: ComponentDefinition): ComponentEdit[] {
  return target.project.definitions[definition.id] ? [] : [{ type: 'definition.set', definition: structuredClone(definition) }]
}
/** Persist rich professional data, removing only absent optional JSON values. */
export function courseAuthorData(data: unknown): JsonValue { return JSON.parse(JSON.stringify(data)) as JsonValue }
/** Shared placement for professional instances, media and library roots. */
export function resolveCourseInsertionPlacement(target: CourseInsertionTarget, options: CourseInsertionOptions = {}, rootIds: readonly string[] = []) {
  const container = insertionContainer(target, options)
  const flowPaper = container.kind !== 'global' && target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind === 'flow' && options.destination === 'paper'
  const edits: ComponentEdit[] = flowPaper ? rootIds.map(instanceId => ({ type: 'instance.flowPlacement.set', instanceId,
    flowPlacement: { space: 'paper', plane: 'overlay' } })) : []
  return { container, index: insertionIndex(target, container, options), edits }
}
export function courseInsertionFrame(target: CourseInsertionTarget, width: number, height: number, options: CourseInsertionOptions): ComponentFrame {
  const surface = target.project.surfaces.find(value => value.id === target.surfaceId)!
  const size = surface.designSize ?? { width: 1280, height: 720 }
  const actualWidth = options.width ?? width, actualHeight = options.height ?? height
  return { width: actualWidth, height: actualHeight,
    transform: [1, 0, 0, 1, options.x ?? (options.center ? options.center.x - actualWidth / 2 : options.origin === 'slide-authoring' ? 80 : surface.kind === 'slide' ? (size.width - width) / 2 : 0),
      options.y ?? (options.center ? options.center.y - actualHeight / 2 : options.origin === 'slide-authoring' ? 80 : surface.kind === 'slide' ? (size.height - height) / 2 : 0)] }
}

/** The original professional insertion algorithm; the caller retains capture, CAS and History. */
export function prepareCourseElementEdits(project: CourseProjectV10, surfaceId: string | null, selectedInstanceId: string | null,
  kind: CourseElementKind, options: CourseInsertionOptions = {}): { edits: ComponentEdit[]; instanceIds: string[] } {
  if (!project.surfaces.some(surface => surface.id === surfaceId)) throw new Error('插入的原页面已不存在')
  const target = { project, surfaceId, instanceId: selectedInstanceId }, slide = options.origin === 'slide-authoring'
  let definition: ComponentDefinition, data: unknown, width = slide ? 320 : 400, height = slide ? 80 : 70
  if (kind === 'text') { definition = TEXT_DEFINITION; data = createTextComponentData(options.text ?? '双击编辑文字') }
  else if (kind === 'formula') {
    definition = FORMULA_DEFINITION; data = createFormulaComponentData(`formula_${nanoid()}`, options.text ?? (slide ? 'x^2' : 'x^2+y^2=r^2'))
    width = slide ? 240 : 400; height = slide ? 100 : 90
  } else if (kind === 'shape') {
    definition = SHAPE_DEFINITION; data = shapeDataSchema.parse({ ...defaultShapeData(options.shapeType), ...(options.lineGeometry ? { lineGeometry: options.lineGeometry } : {}) })
    width = slide ? 200 : 220; height = 140
  } else if (kind === 'table') { definition = TABLE_DEFINITION; data = createTableData(); width = 600; height = slide ? 120 : 220 }
  else if (kind === 'input') { definition = INPUT_DEFINITION; data = createInputData(); height = 120 }
  else { definition = CHART_DEFINITION; const chart = createChartData(); data = changeChartType(chart, options.chartType ?? chart.chartType); width = slide ? 560 : 520; height = slide ? 360 : 320 }
  const instance: ComponentInstance = { id: `instance_${nanoid()}`, definitionId: definition.id,
    ...(!slide ? { name: definition.title } : {}), data: courseAuthorData(data), frame: courseInsertionFrame(target, width, height, options) }
  const instanceIds = [instance.id], placement = resolveCourseInsertionPlacement(target, options, instanceIds)
  return { instanceIds, edits: [...definitionInsertionEdits(target, definition),
    { type: 'instance.insert', container: placement.container, index: placement.index, instances: [instance], rootIds: instanceIds }, ...placement.edits] }
}

/** Existing controller reuse and both supported UI defaults share one preparation owner. */
export function prepareCourseTeacherControllerEdits(project: CourseProjectV10, surfaceId: string | null,
  origin?: 'slide-authoring', selectedInstanceId?: string | null): { edits: ComponentEdit[]; instanceIds: string[] } {
  const existing = Object.values(project.instances).find(instance => instance.definitionId === TEACHER_CONTROLLER_DEFINITION.id)
  if (existing) return { edits: [], instanceIds: [existing.id] }
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (!surface) throw new Error('插入的原页面已不存在')
  const canvas = origin === 'slide-authoring' ? surface.designSize ?? { width: 1280, height: 720 } : undefined
  const instance: ComponentInstance = { id: `instance_${nanoid()}`, definitionId: TEACHER_CONTROLLER_DEFINITION.id,
    ...(origin ? {} : { name: '教师控制台' }), data: courseAuthorData(createTeacherControllerData(canvas)),
    frame: origin ? createTeacherControllerFrame(canvas) : { width: 720, height: 80, transform: [1, 0, 0, 1, 20, 20] } }
  return { instanceIds: [instance.id], edits: [...definitionInsertionEdits({ project, surfaceId }, TEACHER_CONTROLLER_DEFINITION),
    { type: 'instance.insert', container: { kind: 'global', plane: 'overlay' },
      index: insertionIndex({ project, surfaceId, instanceId: selectedInstanceId }, { kind: 'global', plane: 'overlay' }, { origin }),
      instances: [instance], rootIds: [instance.id] }] }
}
