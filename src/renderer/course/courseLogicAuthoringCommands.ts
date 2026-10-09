export * from '../../core/course/courseLogicAuthoringCommands'
import { executeCourseLogicAuthoringCommand, type CourseLogicAuthoringCommand, type CourseLogicAuthoringResult } from '../../core/course/courseLogicAuthoringCommands'
import type { EditorStoreKernel } from '../store/editorStoreKernel'

export async function commitCourseLogicAuthoringCommand(kernel: EditorStoreKernel, documentId: string, command: CourseLogicAuthoringCommand): Promise<CourseLogicAuthoringResult> {
  try {
    const target = kernel.captureTarget(documentId), result = executeCourseLogicAuthoringCommand(target.project, command)
    if (!result.ok) return result
    await kernel.editCaptured(kernel.capture(result.edits, { ...target, activeStateId: null }))
    return { ...result, historyEntry: true }
  } catch (error) { return { ok: false, code: 'invalid-document', reason: error instanceof Error ? error.message : String(error), historyEntry: false } }
}
