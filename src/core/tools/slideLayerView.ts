import {
  composeCourseProjectLocation,
  type CourseLayerComposition,
} from '../../shared/courseLayerComposition'
import type {
  CourseProjectDocument,
  LayerItem,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T :
    T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[] :
      T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } :
        T

export type SlideEditorLayerScope = 'global' | 'surface' | 'scene'

export interface SlideEditorLayerView {
  readonly source: SlideEditorLayerScope
  readonly scopedVisible: boolean
  readonly effectiveVisible: boolean
  readonly selectionId: string
  readonly item: DeepReadonly<LayerItem>
}

export interface SlideEditorPresentationStateView {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly initial: boolean
  readonly thumbnail: boolean
  readonly active: boolean
}

export interface SlideEditorPresentationView {
  readonly activeStateId: string | null
  readonly initialStateId: string
  readonly thumbnailStateId: string | null
  readonly states: readonly SlideEditorPresentationStateView[]
}

export interface SlideEditorView {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly surfaceTitle: string
  readonly sceneId: string
  readonly sceneName: string
  readonly canvas: { readonly width: 1280; readonly height: 720 }
  readonly backgroundColor: string
  readonly backgroundAssetId: string | null | undefined
  readonly presentation: SlideEditorPresentationView | null
  readonly layers: readonly SlideEditorLayerView[]
}

export interface BuildSlideEditorViewInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
  /** `undefined` follows the location; `null` deliberately shows the base scene. */
  readonly stateId?: string | null
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value as DeepReadonly<T>
  }
  if (!ArrayBuffer.isView(value)) {
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry))
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

function resolveSlide(
  project: CourseProjectDocument,
  locationId: string,
): {
    location: Extract<CourseProjectDocument['locations'][number], { kind: 'slide-scene' }>
    surface: SlideSurfaceDocument
    scene: SlideSurfaceDocument['scenes'][number]
  } {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  if (location.kind !== 'slide-scene') {
    throw new Error(`SlideEditorView 只接受 Slide 场景位置：${locationId}`)
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') {
    throw new Error(`找不到 Slide 表面：${location.surfaceId}`)
  }
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error(`找不到 Slide 场景：${location.sceneId}`)
  return { location, surface, scene }
}

function layerView(
  item: LayerItem,
  source: SlideEditorLayerScope,
  applicable: boolean,
  mounted: boolean,
): SlideEditorLayerView {
  const readonlyItem = deepFreeze(item)
  return {
    source,
    scopedVisible: applicable,
    effectiveVisible: mounted,
    selectionId: readonlyItem.layerItemId,
    item: readonlyItem,
  }
}

/** Exact-state adapter used by renderer read models and parity tests. */
export function composeSlideEditorLocation(input: {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly stateId: string | null
}): CourseLayerComposition<LayerItem> {
  return composeCourseProjectLocation(input)
}

/** Thumbnail state for a Slide location: authored thumbnail, else initial, else location. */
export function resolveSlideThumbnailStateId(
  project: CourseProjectDocument,
  locationId: string,
): string | null {
  const { location, scene } = resolveSlide(project, locationId)
  return scene.presentation?.thumbnailStateId
    ?? scene.presentation?.initialStateId
    ?? location.stateId
    ?? null
}

export function buildSlideEditorView(input: BuildSlideEditorViewInput): SlideEditorView {
  const { project, locationId } = input
  const { location, surface, scene } = resolveSlide(project, locationId)
  const stateId = input.stateId === undefined ? (location.stateId ?? null) : input.stateId
  const composition = composeSlideEditorLocation({ project, locationId, stateId })
  const layers = composition.entries.map((entry) => layerView(
    entry.item,
    entry.source as SlideEditorLayerScope,
    entry.applicable,
    entry.mounted,
  ))

  const presentation = scene.presentation
    ? {
        activeStateId: stateId,
        initialStateId: scene.presentation.initialStateId,
        thumbnailStateId: scene.presentation.thumbnailStateId ?? null,
        states: scene.presentation.states.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          ...(candidate.description === undefined ? {} : { description: candidate.description }),
          initial: candidate.id === scene.presentation!.initialStateId,
          thumbnail: candidate.id === scene.presentation!.thumbnailStateId,
          active: candidate.id === stateId,
        })),
      }
    : null

  return deepFreeze({
    projectId: project.id,
    revision: project.revision,
    locationId,
    surfaceId: surface.id,
    surfaceTitle: surface.title,
    sceneId: scene.id,
    sceneName: scene.name,
    canvas: { ...surface.canvas },
    backgroundColor: composition.background!.color,
    backgroundAssetId: composition.background!.assetId,
    presentation,
    layers,
  })
}
