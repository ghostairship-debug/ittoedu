import type {
  CourseEventBus,
  CourseStateStore,
  RuntimeCaptureContext,
  RuntimeEventDisposer,
  RuntimeHostActions,
  RuntimePresentationApi,
} from './types'

export const SURFACE_RUNTIME_API_VERSION = 3 as const
export type SurfaceRuntimeApiVersion = typeof SURFACE_RUNTIME_API_VERSION
export type SurfaceRuntimeMode = 'playback' | 'inspect' | 'capture'

export interface SurfaceRuntimeBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Optional, for compatibility (M15): the host recognises visible text and pictures on its own; nothing has to be registered. */
interface SurfaceRuntimeAuthoringRegionBase {
  /** Stable key in runtime.content.values or runtime.assets. */
  key: string
  label?: string
}

export type SurfaceRuntimeAuthoringRegion = SurfaceRuntimeAuthoringRegionBase & (
  | { element: HTMLElement; bounds?: never }
  | {
      element?: never
      bounds: SurfaceRuntimeBounds | (() => SurfaceRuntimeBounds)
    }
)

export interface SurfaceRuntimeAuthoring {
  registerText(region: SurfaceRuntimeAuthoringRegion): RuntimeEventDisposer
  registerAsset(region: SurfaceRuntimeAuthoringRegion): RuntimeEventDisposer
  /** Re-scans declarative DOM targets and remeasures explicit bounds. */
  invalidate(): void
}

export interface SurfaceRuntimeContentReader {
  get(key: string): string
  all(): Readonly<Record<string, string>>
}

export interface SurfaceRuntimeAssetResolver {
  url(bindingKey: string): string
  projectUrl(assetId: string): string
}

export interface SurfaceRuntimeCreateContext {
  runtimeApiVersion: SurfaceRuntimeApiVersion
  mode: SurfaceRuntimeMode
  width: number
  height: number
  content: SurfaceRuntimeContentReader
  assets: SurfaceRuntimeAssetResolver
  courseState: CourseStateStore
  presentation: RuntimePresentationApi
  actions: Readonly<RuntimeHostActions>
  events: CourseEventBus
  capture: RuntimeCaptureContext
  dom: { root: HTMLElement }
  /** Present in the player so current-frame inspection never needs a rebuild. */
  authoring: SurfaceRuntimeAuthoring
  emit(eventName: string, payload?: unknown): void
}

export interface SurfaceRuntimeInstanceLifecycle {
  setMode?(mode: SurfaceRuntimeMode): void
  resize?(width: number, height: number): void
  /** Hot authoring updates; implementations must preserve interaction state. */
  updateContent?(values: Readonly<Record<string, string>>): void
  updateAssets?(bindings: Readonly<Record<string, { assetId: string }>>): void
  setVisible?(visible: boolean): void
  suspend?(): void
  resume?(): void
  prepareCapture?(): void | Promise<void>
  /** See ComponentInstanceLifecycle: finite JSON + structured clone only. */
  exportAuthoringCheckpoint?(): unknown
  restoreAuthoringCheckpoint?(checkpoint: unknown): void
  destroy(): void
}

/** Official minimal DOM-only Surface Runtime V1 contract. */
export interface SurfaceRuntimeDefinition {
  runtimeApiVersion: SurfaceRuntimeApiVersion
  create(context: SurfaceRuntimeCreateContext): SurfaceRuntimeInstanceLifecycle
}
