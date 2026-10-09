import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import { captureComponentOperation, equalComponentValue, presentationComponentEdits } from '../../../core/drivers/courseV10Operations'
import { createCourseProductivityPreview, planCourseProductivityEdits } from '../../../core/course/courseProductivityEdits'
import type { CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { CapturedComponentOperation, CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { ProductivityRequest, ProductivityPreviewItem } from '../../../core/course/courseProductivityEdits'
export type { ProductivityScope, ColorProperty, ProductivityRequest, ProductivityPreviewItem } from '../../../core/course/courseProductivityEdits'

export interface ProductivityContext { document: CourseProjectV10; target: CapturedCourseTarget }
export type DesignProductionStep = CapturedComponentOperation & { createdSurfaceId?: string; originSurfaceId?: string | null }
export interface ProductivityPreview { projectId: string; revision: number; target: CapturedCourseTarget; request: ProductivityRequest; items: ProductivityPreviewItem[]; unsupported: string[] }
export type ProductivityApplyResult = { ok: true; step: DesignProductionStep | null } | { ok: false; reason: string }

export function createProductivityPreview(context: ProductivityContext, request: ProductivityRequest): ProductivityPreview {
  const { surfaceId: _surfaceId, ...preview } = createCourseProductivityPreview(context.document, context.target.surfaceId, request)
  return { ...preview, target: context.target }
}
export function createTextReplacePreview(context: ProductivityContext, request: Omit<Extract<ProductivityRequest, { kind: 'text' }>, 'kind'>) { return createProductivityPreview(context, { ...request, kind: 'text' }) }
export function createTokenApplyPreview(context: ProductivityContext, request: Omit<Extract<ProductivityRequest, { kind: 'color' }>, 'kind'>) { return createProductivityPreview(context, { ...request, kind: 'color' }) }

export function designProductionStep(context: ProductivityContext, edits: ComponentEdit[]): DesignProductionStep {
  const mapped = presentationComponentEdits(context.target.project, context.target.surfaceId, context.target.activeStateId, edits)
  return { ...captureComponentOperation(context.target.project, mapped), documentId: context.target.documentId, epoch: context.target.epoch, originSurfaceId: context.target.surfaceId }
}
export function applyProductivityPreview(context: ProductivityContext, preview: ProductivityPreview, selectedIds: readonly string[]): ProductivityApplyResult {
  try {
    if (context.target.documentId !== preview.target.documentId || context.target.epoch !== preview.target.epoch || context.target.surfaceId !== preview.target.surfaceId || context.target.activeStateId !== preview.target.activeStateId) throw new Error('预览目标已改变，请重新预览')
    const fresh = createProductivityPreview(context, preview.request)
    if (!equalComponentValue(fresh.items, preview.items)) throw new Error('内容已变化，请重新预览')
    const result = planCourseProductivityEdits(context.document, context.target.surfaceId, preview.request, { selectedIds })
    return { ok: true, step: result.edits.length ? designProductionStep(context, result.edits) : null }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '批量修改失败' } }
}
