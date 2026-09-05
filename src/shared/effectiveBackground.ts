import type {
  CourseProjectDocument,
  FlowSurfaceDocument,
  SlidePresentationState,
  SlideSceneDocument,
  SlideSurfaceDocument,
  SpatialSurfaceDocument,
} from './contracts/course-project-v9/types'

/** Absent color reads as white; absent or explicit `null` asset reads as no image. */
export const DEFAULT_EFFECTIVE_BACKGROUND_COLOR = '#ffffff'

export const EFFECTIVE_BACKGROUND_OWNERS = [
  'course',
  'slide-surface',
  'slide-scene',
  'slide-state',
  'flow-surface',
  'spatial-surface',
] as const

/** Every owner that can hold or resolve an effective background in the Course chain. */
export type EffectiveBackgroundOwner = typeof EFFECTIVE_BACKGROUND_OWNERS[number]

/**
 * Narrow, structural field picks off the real Course Project V9 contract
 * types. A real `CourseProjectDocument`/`SlideSurfaceDocument`/etc. (or its
 * Published Course V2 counterpart, whose background fields are additive
 * mirrors of these) satisfies these types as-is; callers never need to build
 * a separate projection just to call this resolver.
 */
export type CourseBackgroundFields = Pick<CourseProjectDocument, 'backgroundColor' | 'backgroundAssetId'>
export type SlideSurfaceBackgroundFields =
  Pick<SlideSurfaceDocument, 'backgroundMode' | 'backgroundColor' | 'backgroundAssetId'>
export type SlideSceneBackgroundFields =
  Pick<SlideSceneDocument, 'backgroundMode' | 'backgroundColor' | 'backgroundAssetId'>
export type SlideNamedStateBackgroundFields =
  Pick<SlidePresentationState, 'backgroundColor' | 'backgroundAssetId'>
export type FlowSurfaceBackgroundFields =
  Pick<FlowSurfaceDocument, 'backgroundMode' | 'backgroundColor' | 'backgroundAssetId'>
export type SpatialSurfaceBackgroundFields =
  Pick<SpatialSurfaceDocument, 'backgroundMode' | 'backgroundColor' | 'backgroundAssetId'>

/**
 * Resolved background for one owner: the effective paint that owner should
 * show right now. `sourceOwner` names the deepest owner whose own value
 * actually produced `color`/`assetId`. An owner that inherits (or, for Named
 * state, leaves both of its overrides `undefined`) is transparent and
 * forwards its parent's result unchanged, `sourceOwner` included.
 */
export interface EffectiveBackground {
  readonly color: string
  readonly assetId: string | null
  readonly sourceOwner: EffectiveBackgroundOwner
}

export type EffectiveBackgroundRequest =
  | {
      readonly owner: 'course'
      readonly course: CourseBackgroundFields
    }
  | {
      readonly owner: 'slide-surface'
      readonly course: CourseBackgroundFields
      readonly surface: SlideSurfaceBackgroundFields
    }
  | {
      readonly owner: 'slide-scene'
      readonly course: CourseBackgroundFields
      readonly surface: SlideSurfaceBackgroundFields
      readonly scene: SlideSceneBackgroundFields
    }
  | {
      readonly owner: 'slide-state'
      readonly course: CourseBackgroundFields
      readonly surface: SlideSurfaceBackgroundFields
      readonly scene: SlideSceneBackgroundFields
      readonly state: SlideNamedStateBackgroundFields
    }
  | {
      readonly owner: 'flow-surface'
      readonly course: CourseBackgroundFields
      readonly surface: FlowSurfaceBackgroundFields
    }
  | {
      readonly owner: 'spatial-surface'
      readonly course: CourseBackgroundFields
      readonly surface: SpatialSurfaceBackgroundFields
    }

function resolveCourseBackground(course: CourseBackgroundFields): EffectiveBackground {
  return {
    color: course.backgroundColor ?? DEFAULT_EFFECTIVE_BACKGROUND_COLOR,
    assetId: course.backgroundAssetId ?? null,
    sourceOwner: 'course',
  }
}

function resolveOwnBackground(
  surface: Readonly<{ backgroundColor?: string; backgroundAssetId?: string | null }>,
  sourceOwner: Extract<EffectiveBackgroundOwner, 'slide-surface' | 'flow-surface' | 'spatial-surface'>,
): EffectiveBackground {
  return {
    color: surface.backgroundColor ?? DEFAULT_EFFECTIVE_BACKGROUND_COLOR,
    assetId: surface.backgroundAssetId ?? null,
    sourceOwner,
  }
}

/**
 * Single authoring/publishing/export authority for "what background does
 * this owner actually show". Implements IMPLEMENTATION_CONTRACT.md §7.2
 * exactly:
 *
 * - Course is the resolution root: `color = course.backgroundColor ?? '#ffffff'`,
 *   `assetId = course.backgroundAssetId ?? null`.
 * - Slide surface reads its own optional `backgroundMode` (default `'inherit'`):
 *   `'inherit'` forwards Course's result; `'own'` resolves its own color/asset
 *   the same way Course does.
 * - Slide scene reads its own optional `backgroundMode` (default `'own'`):
 *   `'inherit'` forwards the resolved Slide surface result; `'own'` uses the
 *   scene's required `backgroundColor` (never defaulted) and optional asset.
 * - Named state has no mode. It independently overrides `color` when its own
 *   `backgroundColor` is defined, and independently overrides `assetId` when
 *   its own `backgroundAssetId` is `string` or `null` (i.e. anything but
 *   `undefined`). Whichever half is left `undefined` inherits the resolved
 *   Slide scene result for that half.
 * - Flow surface and Spatial surface each read their own optional
 *   `backgroundMode` (default `'own'` — unlike Slide surface, Flow/Spatial
 *   have always owned their background): `'inherit'` forwards Course's
 *   result; `'own'` resolves the same way Course does.
 *
 * Pure and total: no Date/Math.random, never throws, and never checks
 * whether `assetId` refers to an asset that actually exists in a catalog —
 * that is a consumer concern once it has one.
 */
export function resolveEffectiveBackground(request: EffectiveBackgroundRequest): EffectiveBackground {
  switch (request.owner) {
    case 'course':
      return resolveCourseBackground(request.course)

    case 'slide-surface': {
      const mode = request.surface.backgroundMode ?? 'inherit'
      return mode === 'own'
        ? resolveOwnBackground(request.surface, 'slide-surface')
        : resolveCourseBackground(request.course)
    }

    case 'slide-scene': {
      const surfaceResult = resolveEffectiveBackground({
        owner: 'slide-surface',
        course: request.course,
        surface: request.surface,
      })
      const mode = request.scene.backgroundMode ?? 'own'
      if (mode === 'inherit') return surfaceResult
      return {
        color: request.scene.backgroundColor,
        assetId: request.scene.backgroundAssetId ?? null,
        sourceOwner: 'slide-scene',
      }
    }

    case 'slide-state': {
      const sceneResult = resolveEffectiveBackground({
        owner: 'slide-scene',
        course: request.course,
        surface: request.surface,
        scene: request.scene,
      })
      const { state } = request
      if (state.backgroundColor === undefined && state.backgroundAssetId === undefined) {
        return sceneResult
      }
      return {
        color: state.backgroundColor === undefined ? sceneResult.color : state.backgroundColor,
        assetId: state.backgroundAssetId === undefined ? sceneResult.assetId : state.backgroundAssetId,
        sourceOwner: 'slide-state',
      }
    }

    case 'flow-surface': {
      const mode = request.surface.backgroundMode ?? 'own'
      return mode === 'own'
        ? resolveOwnBackground(request.surface, 'flow-surface')
        : resolveCourseBackground(request.course)
    }

    case 'spatial-surface': {
      const mode = request.surface.backgroundMode ?? 'own'
      return mode === 'own'
        ? resolveOwnBackground(request.surface, 'spatial-surface')
        : resolveCourseBackground(request.course)
    }

    default: {
      const exhaustive: never = request
      throw new Error(`Unknown effective background owner: ${JSON.stringify(exhaustive)}`)
    }
  }
}
