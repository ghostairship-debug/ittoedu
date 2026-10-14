import { z } from 'zod'
import { componentCameraMotionSchema, componentCameraPoseSchema, componentNavigationTransitionSchema, type ComponentCameraPose, type ComponentNavigationMotion, type ComponentCameraMotion } from './navigationMotion'

type TeacherNavigationAction =
  | { type: 'step.previous' }
  | { type: 'step.next' }
  | { type: 'scene.previous' }
  | { type: 'scene.next' }
  | { type: 'scene.replay' }
  | { type: 'course.restart' }
  | { type: 'scene.go'; sceneId: string; targetStateId?: string; targetInstanceId?: string }

export type TeacherControllerAction =
  | (TeacherNavigationAction & ComponentNavigationMotion)
  | { type: 'scene.open-picker' | 'audio.toggle-mute' | 'player.fullscreen.toggle' }
  | { type: 'camera.present'; pose: ComponentCameraPose; motion?: ComponentCameraMotion }

const navigationMotion = { transition: componentNavigationTransitionSchema.optional(), camera: componentCameraMotionSchema.optional() }
export const teacherControllerActionSchema: z.ZodType<TeacherControllerAction> = z.union([
  z.object({ type: z.enum(['step.previous', 'step.next', 'scene.previous', 'scene.next', 'scene.replay', 'course.restart']), ...navigationMotion }).strict(),
  z.object({ type: z.enum(['scene.open-picker', 'audio.toggle-mute', 'player.fullscreen.toggle']) }).strict(),
  z.object({ type: z.literal('scene.go'), sceneId: z.string().min(1), targetStateId: z.string().optional(), targetInstanceId: z.string().min(1).optional(), ...navigationMotion }).strict(),
  z.object({ type: z.literal('camera.present'), pose: componentCameraPoseSchema, motion: componentCameraMotionSchema.optional() }).strict(),
])
export interface TeacherControllerSnapshot {
  locationId: string | null
  /** Live host interaction mode; the author's component data and frame are unchanged. */
  interactive?: boolean
  scenes: readonly { id: string; name: string; targets?: readonly {
    id: string; name: string; kind: 'state' | 'camera' | 'heading'; depth?: number
    action: Extract<TeacherControllerAction, { type: 'scene.go' }>
  }[] }[]
  progress: { sceneIndex: number; sceneCount: number; stepIndex: number; stepCount: number; sceneName: string; stepName: string } | null
  /** Unset until the session overrides the authored initial state. */
  collapsed?: boolean
  zoom: number
  /** Current session pose, never an authored frame or path mutation. */
  camera?: ComponentCameraPose
  muted: boolean
  fullscreen: boolean
}
/** One navigation/view owner is shared by the builtin and source proxy. */
export interface TeacherControllerPort {
  /** Host binds view state to the mounted instance; course navigation stays shared. */
  forInstance?(instanceId: string): TeacherControllerPort
  placement?(): { x: number; y: number }
  subscribePlacement?(listener: () => void): () => void
  read(): TeacherControllerSnapshot
  /** Current owner fact without building the course directory. */
  readLocation(): string | null
  subscribe(listener: () => void): () => void
  /** Actual playback region in the owning document's viewport CSS pixels. */
  viewportBounds?(): { left: number; top: number; right: number; bottom: number } | undefined
  canExecute(action: TeacherControllerAction): boolean
  /**
   * Navigation snapshots are captured/cleaned by the host; only the destination stays live.
   * transition supports code-generated old/new keyframes, duration, delay and CSS easing.
   * camera.present and navigation.camera share the mounted camera owner; pan/Stop/new navigation cancels them.
   * The third argument is a host lifecycle hook at the actual fact commit, never serialized to a source realm.
   */
  execute(action: TeacherControllerAction, signal?: AbortSignal, onCommit?: () => void): Promise<boolean>
  /** Host Stop/lifecycle hook; source callers cancel their request with AbortSignal. */
  cancel?(): void
  setCollapsed(value: boolean): void
  moveBy(dx: number, dy: number): void
  setZoom(value: number): void
  resetView(): void
}
