import type { PlaybackNavigationViewPort } from './navigation/coursePlaybackSequence'
import type { PlaybackViewPort } from './playbackViewSession'
import type { TeacherControllerAction } from '../shared/teacherControllerConfig'
export interface TeacherControllerSceneInfo { id: string; name: string }
export interface TeacherControllerViewStatus { muted: boolean; fullscreen: boolean }
import type { TeacherControllerRuntimeNode, TeacherControllerSessionOffset } from './teacherControllerRuntimeSession'

export interface TeacherControllerHostSession {
  offset: TeacherControllerSessionOffset
  collapsed: boolean
}

export interface TeacherControllerHostOptions {
  playbackView?: PlaybackViewPort
  navigation?: PlaybackNavigationViewPort
  /** Frame + layout source composed by the surface host from the layer item. */
  node: TeacherControllerRuntimeNode
  /** Already positioned by the compositor; the controller fills it 1:1. */
  container: HTMLElement
  /** Host wrapper whose compositor hit region follows the visible chrome. */
  footprintElement?: HTMLElement
  /** Logical course canvas used to constrain session offsets. */
  canvas: { width: number; height: number }
  /**
   * CSS size of the 1280×720 stage (not the controller frame). Pointer deltas
   * map through this the same way `clientDeltaToWorld` maps through
   * `stageViewportTransform`.
   *
   * Optional `left`/`top` are the stage's viewport origin. Playback hosts pass
   * them so button hit-testing uses the logical canvas instead of a CSS-scaled
   * controller client box, which misses buttons after `transform: scale()`.
   */
  getRenderedStageBounds(): { width: number; height: number; left?: number; top?: number }
  scenes: readonly TeacherControllerSceneInfo[]
  getCurrentSceneId(): string | null
  getStateLabel(): string | null
  /** Live mute/fullscreen labels; reads `document.fullscreenElement` itself. */
  getStatus(): TeacherControllerViewStatus
  /** Canonical session persisted by the surface host (defaults after restart). */
  getSession(): TeacherControllerHostSession
  onSessionChange(next: TeacherControllerHostSession): void
  /** Flow projects automatic clamping without persisting it as a teacher drag. */
  onPositionChange?(node: TeacherControllerRuntimeNode, offset: TeacherControllerSessionOffset): void
  getConstraintCanvas?(): { width: number; height: number }
  onAction(action: TeacherControllerAction): void | boolean | Promise<void | boolean>
  onActionError?(action: TeacherControllerAction, error: Error): void
  /** Playback-only gate: false in inspect frames or when controls are none. */
  getInteractive(): boolean
}

export function stageBoundsFromElement(
  element: HTMLElement | null | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number; left: number; top: number } {
  if (!element) return { ...fallback, left: 0, top: 0 }
  const bounds = element.getBoundingClientRect()
  const sized = bounds.width > 1 && bounds.height > 1
  return {
    left: sized ? bounds.left : 0,
    top: sized ? bounds.top : 0,
    width: sized ? bounds.width : fallback.width,
    height: sized ? bounds.height : fallback.height,
  }
}
export function teacherControllerHostNode(frame: { x: number; y: number; width: number; height: number }, rotation: number): TeacherControllerRuntimeNode {
  return { ...frame, rotation }
}
