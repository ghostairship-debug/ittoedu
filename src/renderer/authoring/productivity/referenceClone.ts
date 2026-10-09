import { prepareCourseReferenceClone } from '../../../core/course/courseProductivityEdits'
import { designProductionStep, type ProductivityContext, type ProductivityApplyResult } from './index'

export function prepareReferenceClone(context: ProductivityContext, sourceSurfaceId: string) {
  return prepareCourseReferenceClone(context.document, sourceSurfaceId)
}
/** The common formal copy keeps project resources shared and all owned references rebound. */
export function cloneReferencePage(context: ProductivityContext, sourceSurfaceId: string, _assetFiles: Readonly<Record<string, Uint8Array>> = {}): ProductivityApplyResult {
  try {
    const clone = prepareReferenceClone(context, sourceSurfaceId)
    return { ok: true, step: { ...designProductionStep(context, clone.edits), createdSurfaceId: clone.surface.id } }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '参考页克隆失败' } }
}
