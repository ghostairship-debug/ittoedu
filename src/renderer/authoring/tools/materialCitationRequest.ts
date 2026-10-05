import { materialRecordV1Schema, type MaterialRecordV1 } from '../../../shared/materialContract'
import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import { captureCourseInsertionTarget } from '../../media/commitCourseMediaAuthoring'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'

/** Capture before material lookup or dialog completion; never reconstruct a V9 destination. */
export function createMaterialCitationRequest(input: { kernel: EditorStoreKernel; material: MaterialRecordV1; target?: CapturedCourseTarget }) {
  return { tool: 'material.citation' as const, target: input.target ?? captureCourseInsertionTarget(input.kernel),
    material: materialRecordV1Schema.parse(input.material) }
}
export type MaterialCitationRequest = ReturnType<typeof createMaterialCitationRequest>
