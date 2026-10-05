import { z } from 'zod'

export type TeacherControllerAction =
  | { type: 'step.previous' }
  | { type: 'step.next' }
  | { type: 'scene.previous' }
  | { type: 'scene.next' }
  | { type: 'scene.replay' }
  | { type: 'course.restart' }
  | { type: 'scene.open-picker' }
  | { type: 'audio.toggle-mute' }
  | { type: 'player.fullscreen.toggle' }
  | { type: 'scene.go'; sceneId: string; targetStateId?: string }

export const teacherControllerActionSchema: z.ZodType<TeacherControllerAction> = z.union([
  z.object({ type: z.enum(['step.previous', 'step.next', 'scene.previous', 'scene.next', 'scene.replay', 'course.restart', 'scene.open-picker', 'audio.toggle-mute', 'player.fullscreen.toggle']) }).strict(),
  z.object({ type: z.literal('scene.go'), sceneId: z.string().min(1), targetStateId: z.string().optional() }).strict(),
])
export interface TeacherControllerSnapshot {
  locationId: string | null
  /** Live host interaction mode; the author's component data and frame are unchanged. */
  interactive?: boolean
  scenes: readonly { id: string; name: string }[]
  progress: { sceneIndex: number; sceneCount: number; stepIndex: number; stepCount: number; sceneName: string; stepName: string } | null
  /** Unset until the session overrides the authored initial state. */
  collapsed?: boolean
  zoom: number
  muted: boolean
  fullscreen: boolean
}
/** One navigation/view owner is shared by the builtin and source proxy. */
export interface TeacherControllerPort {
  read(): TeacherControllerSnapshot
  subscribe(listener: () => void): () => void
  /** Actual playback region in the owning document's viewport CSS pixels. */
  viewportBounds?(): { left: number; top: number; right: number; bottom: number } | undefined
  canExecute(action: TeacherControllerAction): boolean
  execute(action: TeacherControllerAction): Promise<boolean>
  setCollapsed(value: boolean): void
  moveBy(dx: number, dy: number): void
  setZoom(value: number): void
  resetView(): void
}
