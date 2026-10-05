import type { NodeMotionAction } from '../../shared/interactionTypes'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'

export interface ComponentMotionPreviewRequest { target: CapturedCourseTarget; action: NodeMotionAction; delayMs: number }
const listeners = new Set<(request: ComponentMotionPreviewRequest) => void>()
export function previewComponentMotion(request: ComponentMotionPreviewRequest): void {
  for (const listener of listeners) listener(structuredClone(request))
}
/** The existing document world handles only requests for its actual document/epoch. */
export function onComponentMotionPreview(listener: (request: ComponentMotionPreviewRequest) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
