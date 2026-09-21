import type { DocumentSelection } from '../../../shared/document/ports'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import type { CourseAuthoringSessionToken } from '../../authoring/courseAuthoringSession'

export const CONTEXTUAL_COURSE_COMMAND = 'courseware:contextual-command'
export interface ContextualCourseCommand { projectId: string; sessionToken: CourseAuthoringSessionToken; instruction: string; documentSelection?: DocumentSelection; error?: string }
/** A synchronous UI command relay. The existing chat freezes and runs the task. */
export function requestContextualCourseCommand(command: ContextualCourseCommand) {
  const event = new CustomEvent(CONTEXTUAL_COURSE_COMMAND, { cancelable: true, detail: command })
  window.dispatchEvent(event)
  if (command.error) throw new Error(command.error)
  if (!event.defaultPrevented) throw new Error('请先打开课件的创作助手，再发送编辑要求。')
}

/** Card and ordinary chat must freeze the same existing Flow session selection. */
export function validateContextualCourseCommand(command: ContextualCourseCommand, currentFlowSelection: FlowEditorSelection | null | undefined): void {
  if (!command.documentSelection) return
  if (command.documentSelection.revision !== String(command.sessionToken.revision)
    || JSON.stringify(command.documentSelection) !== JSON.stringify(currentFlowSelection?.documentSelection)) throw new Error('当前正文选区已改变，请重新选择。')
}
