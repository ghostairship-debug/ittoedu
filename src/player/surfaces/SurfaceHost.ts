import type { CourseSurfaceType } from '../../shared/courseProjectTypes'

export type SurfaceKind = CourseSurfaceType

export type SurfaceLifecyclePhase =
  | 'mount'
  | 'activate'
  | 'suspend'
  | 'resume'
  | 'reset'
  | 'capture'
  | 'destroy'
  /** Declarative interaction rule execution (navigation/state/motion failures). */
  | 'execute'

export type SurfaceStatus =
  | 'idle'
  | 'mounting'
  | 'mounted'
  | 'active'
  | 'suspended'
  | 'failed'
  | 'destroyed'

export type SurfaceResetScope = 'surface' | 'course'

export interface SurfaceCaptureRequest {
  purpose: 'thumbnail' | 'export' | 'authoring'
  /** Named camera/frame/state selected by the author. */
  frameId?: string
  /** Capture one authored layer at its unrotated frame size for staticization. */
  layerItemId?: string
  width?: number
  height?: number
}

export interface SurfaceCapture {
  format: 'html' | 'svg' | 'data-url' | 'json'
  content: string
  width?: number
  height?: number
  warnings?: readonly string[]
}

export interface SurfacePlayerServices {
  navigate(deepLink: string): void | Promise<void>
  getCourseState(key: string): unknown
  setCourseState(key: string, value: unknown): void
  resolveAsset(assetId: string): string | undefined
  reportDiagnostic?(diagnostic: SurfaceDiagnostic): void
}

export interface SurfaceDiagnostic {
  surfaceId: string
  phase: SurfaceLifecyclePhase
  severity: 'warning' | 'error'
  message: string
  cause?: unknown
}

export interface SurfaceMountContext {
  surfaceId: string
  container: HTMLElement
  services: SurfacePlayerServices
  signal: AbortSignal
}

/**
 * Runtime boundary shared by every course surface.
 *
 * Implementations own everything they append to `container` and must release
 * listeners, timers, observers, media and GPU resources from `destroy`.
 */
export interface SurfaceHost {
  readonly id: string
  readonly kind: SurfaceKind
  mount(context: SurfaceMountContext): void | Promise<void>
  activate(): void | Promise<void>
  suspend(): void | Promise<void>
  resume(): void | Promise<void>
  reset(scope: SurfaceResetScope): void | Promise<void>
  capture(request: SurfaceCaptureRequest): SurfaceCapture | Promise<SurfaceCapture>
  destroy(): void | Promise<void>
  /** Published V2 location. Optional so fake hosts in isolation tests stay thin. */
  setLocationId?(locationId: string): void | Promise<void>
  getLocationId?(): string | null
}

export interface SurfaceFailure {
  surfaceId: string
  kind: SurfaceKind
  phase: SurfaceLifecyclePhase
  error: Error
}

export interface SurfaceOperationResult<T = void> {
  ok: boolean
  value?: T
  failure?: SurfaceFailure
}

export function toSurfaceError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}
