import type { TeacherControllerAction } from '../../teacherControllerConfig'


export interface ComponentTeacherControllerSnapshot {
  locationId: string | null
  stateLabel: string | null
  scenes: readonly { id: string; name: string }[]
  progress: { sceneIndex: number; sceneCount: number; stepIndex: number; stepCount: number; sceneName: string; stepName: string } | null
  muted: boolean
  fullscreen: boolean
  zoom: number
  collapsed: boolean
  offset: { dx: number; dy: number }
}

/** Only supplied by the host to the single global controller role. */
export interface ComponentTeacherControllerPort {
  read(): ComponentTeacherControllerSnapshot
  subscribe(listener: () => void): () => void
  /** Current course availability for rendering; execution is still gated by host mode. */
  canExecute(action: TeacherControllerAction): boolean
  execute(action: TeacherControllerAction): Promise<boolean>
  setCollapsed(value: boolean): void
  moveBy(dx: number, dy: number): void
  setZoom(value: number): void
  resetView(): void
}
