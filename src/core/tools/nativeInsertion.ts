import { planSlideInputInsertion } from './inputInsertion'
import { resolveNativeOwner } from './nativeOwner'
import { planFlowNativeInsertion } from './flowNativeInsertion'
import { planSpatialTextInsertion, planSpatialShapeInsertion, planSpatialFormulaInsertion, planSpatialImageInsertion, planSpatialVideoInsertion, planSpatialChartInsertion, planSpatialTableInsertion } from './spatialInsertion'
import { planSlideChartInsertion, planSlideTableInsertion } from './slideStructuredInsertion'
import { rebuildChartItemIds } from './chartIdentity'
import { rebuildTableItemIds } from './nativeNodeFactories'
import type { z } from 'zod'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ToolTarget } from '../../shared/workbench/tools'
import { courseProjectDocumentSchema, nativeElementContentSchema, mergeCourseNativeData } from '../../shared/courseProjectSchema'
import { locateCourseLayer } from '../drivers/course/layerProperties'
import { basicNativeTemplateSchema } from './nativeInsertionSchema'
import { planSlideTextInsertion, planSlideFormulaInsertion, planSlideShapeInsertion, planSlideImageInsertion, planSlideVideoInsertion } from './slideInsertion'

export function planNativeInsertion(document: CourseProjectDocument, target: Extract<ToolTarget, { kind: 'course-owner' }>, raw: z.infer<typeof basicNativeTemplateSchema>, createId: () => string) {
  const input = basicNativeTemplateSchema.parse(raw)
  const owner = { scope: target.owner, selection: { locationId: target.locationId, stateId: target.stateId ?? null } }
  const context = resolveNativeOwner(document, target)
  if (input.paperSpace !== undefined && context.surface.type !== 'flow') throw new Error('paperSpace 仅适用于 Flow 浮层')
  const value = { ...input, id: `${input.nativeType}-${createId()}` }
  let planned
  if (value.nativeType === 'input') {
    if (context.surface.type !== 'slide') throw new Error('填空题只允许演示页场景')
    planned = planSlideInputInsertion(document, owner, value, createId)
  } else if (context.surface.type === 'flow') {
    if (target.owner !== 'global' && target.owner !== 'surface') throw new Error('Flow 浮层 owner 无效')
    planned = planFlowNativeInsertion(document, { source: target.owner, surfaceId: context.surface.id }, value)
  } else if (context.surface.type === 'spatial-2d') {
    const spatial = { scope: target.owner, selection: { surfaceId: context.surface.id }, sessionCamera: context.center!, history: { present: document } }
    planned = value.nativeType === 'text' ? planSpatialTextInsertion(spatial, value)
      : value.nativeType === 'formula' ? planSpatialFormulaInsertion(spatial, value)
      : value.nativeType === 'shape' ? planSpatialShapeInsertion(spatial, value)
      : value.nativeType === 'image' ? planSpatialImageInsertion(spatial, value)
      : value.nativeType === 'video' ? planSpatialVideoInsertion(spatial, value)
      : value.nativeType === 'chart' ? planSpatialChartInsertion(spatial, value)
      : planSpatialTableInsertion(spatial, value)
  } else {
    planned = value.nativeType === 'text' ? planSlideTextInsertion(document, owner, value)
      : value.nativeType === 'formula' ? planSlideFormulaInsertion(document, owner, value)
      : value.nativeType === 'shape' ? planSlideShapeInsertion(document, owner, value)
      : value.nativeType === 'image' ? planSlideImageInsertion(document, owner, value)
      : value.nativeType === 'video' ? planSlideVideoInsertion(document, owner, value)
      : value.nativeType === 'chart' ? planSlideChartInsertion(document, owner, value)
      : planSlideTableInsertion(document, owner, value)
  }
  const item = locateCourseLayer(planned.project, planned.itemId)?.item
  if (!item || item.kind !== 'native') throw new Error('Native 工厂没有返回创建对象')
  const initial = Object.fromEntries(Object.entries(input).filter(([key]) => ['style', 'ast', 'accessibleText', 'chartType', 'title', 'categories', 'series', 'columns', 'rows', 'headerRowCount', 'merges'].includes(key)))
  if (input.nativeType === 'image' && input.fit !== undefined) Object.assign(initial, { fit: input.fit, preserveAspectRatio: input.fit !== 'stretch' })
  if (Object.keys(initial).length) item.content = nativeElementContentSchema.parse({ ...item.content, data: mergeCourseNativeData({ ...item.content.data }, initial) })
  if (input.x !== undefined) item.frame.x = input.x
  if (input.y !== undefined) item.frame.y = input.y
  if (input.paperSpace === 'paper') item.paperSpace = 'paper'
  else if (input.paperSpace === 'viewport') delete item.paperSpace
  if (item.content.nativeType === 'chart') item.content.data = rebuildChartItemIds(item.content.data, createId)
  if (item.content.nativeType === 'table') item.content.data = rebuildTableItemIds(item.content.data, createId)
  if (input.width !== undefined) item.frame.width = input.width
  if (input.height !== undefined) item.frame.height = input.height
  return { project: courseProjectDocumentSchema.parse(planned.project), itemId: planned.itemId }
}
