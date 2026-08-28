import type {
  NodeMotionAction,
} from '../../shared/contracts/interaction-v1/types'
import type { SurfaceDiagnostic } from '../surfaces/SurfaceHost'
import type { CourseStateStore } from '../../shared/runtimeTypes'

/** A port operation may complete synchronously or after host-owned work. */
export type PublishedInteractionPortResult =
  | boolean
  | void
  | PromiseLike<boolean | void>

export interface PublishedNodeMotionContext {
  readonly ruleId: string
  readonly stepId: string
  readonly signal: AbortSignal
  /** The same rule was triggered again before its previous run settled. */
  readonly restartFromBeginning: boolean
}

/**
 * The active Surface owns hit testing, gesture priority, authored visibility,
 * camera/location visibility and the concrete motion implementation. The
 * controller never queries or mutates arbitrary DOM nodes.
 */
export interface PublishedInteractionSurfacePort {
  bindNodeClick(nodeId: string, listener: () => void): (() => void) | null
  executeNodeMotion(
    action: NodeMotionAction,
    context: PublishedNodeMotionContext,
  ): PublishedInteractionPortResult
}

/** Published navigation boundary supplied by the whole-course session. */
export interface PublishedInteractionSessionPort {
  readonly courseState: Pick<CourseStateStore, 'get' | 'set'>
  currentSceneId(): string | null
  goToScene(
    sceneId: string,
    targetStateId: string | undefined,
    signal: AbortSignal,
  ): PublishedInteractionPortResult
  nextScene(signal: AbortSignal): PublishedInteractionPortResult
  previousScene(signal: AbortSignal): PublishedInteractionPortResult
  replayScene(signal: AbortSignal): PublishedInteractionPortResult
  restartCourse(signal: AbortSignal): PublishedInteractionPortResult
}

export type PublishedInteractionDiagnosticCode =
  | 'unsupported-trigger'
  | 'unsupported-condition'
  | 'unsupported-action'
  | 'bind-unavailable'
  | 'bind-failed'
  | 'session-failed'
  | 'motion-failed'
  | 'navigation-failed'
  | 'course-state-failed'
  | 'execution-failed'
  | 'dispose-failed'

export interface PublishedInteractionDiagnostic extends SurfaceDiagnostic {
  code: PublishedInteractionDiagnosticCode
  ruleId?: string
  stepId?: string
  nodeId?: string
  interactionType?: string
}
