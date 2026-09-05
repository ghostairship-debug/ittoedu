import {
  composePublishedCourseLocation,
  type CourseLayerComposition,
} from '../../../shared/courseLayerComposition'
import type {
  CourseLocation,
} from '../../../shared/courseProjectTypes'
import {
  isNativeRenderInput,
  type TeacherControllerAction,
  type TeacherControllerNode,
} from '../../../shared/contracts/native-v1/types'
import type {
  PlayerAuthoringContext,
  PlayerAuthoringErrorCode,
  PlayerAuthoringPatch,
} from '../../../shared/playerAuthoringProtocol'
import type { NodeMotionAction } from '../../../shared/interactionTypes'
import type {
  ComponentHostActions,
  ComponentAuthoringTargetUpdate,
  ComponentPackageData,
} from '../../../shared/componentTypes'
import type {
  CourseStateStore as CourseStateStoreContract,
  RuntimeAuthoringTargetUpdate,
  RuntimeHostActions,
  RuntimePresentationApi,
} from '../../../shared/runtimeTypes'
import type {
  PublishedComponentLayerItem,
  PublishedCourseV2Payload,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedRuntimeLayerItem,
  PublishedSlideScene,
  PublishedSlideSurface,
} from '../../../shared/publishedCourseTypes'
import { buildMixedDeepLink } from '../mixed/MixedCourseNavigator'
import type {
  SurfaceCapture,
  SurfaceCaptureRequest,
  SurfaceHost,
  SurfaceMountContext,
  SurfacePlayerServices,
  SurfaceResetScope,
} from '../SurfaceHost'
import {
  TeacherControllerDom,
  stageBoundsFromElement,
  teacherControllerDomNode,
  type TeacherControllerDomSession,
} from '../../teacherControllerDom'
import { TeacherControllerRuntimeSessionStore } from '../../teacherControllerRuntimeSession'
import {
  extractPublishedComponentManifest,
  findComponentPackageSource,
  mountPublishedComponent,
  type PublishedComponentPackageSource,
  type PublishedComponentMountHandle,
} from '../publishedComponentMount'
import { mountPublishedSlidePhaserComponent } from './publishedSlidePhaserComponentMount'
import {
  nativeMediaAssetIds,
  readonlyNativeRenderInputFromPublishedItem,
  paintPublishedNativeRenderInput,
  type PublishedNativeRenderInput,
  type PublishedTeacherControllerInput,
} from './publishedNativeRendering'
import {
  mountPublishedNativeVideo,
  type PublishedNativeVideoHandle,
  type PublishedVideoInput,
} from './publishedNativeVideoMount'
import {
  PublishedSlideInteractionSurfacePort,
} from './publishedSlideInteractionSurfacePort'
import type { AudioManager } from '../../AudioManager'
import {
  createPublishedSurfaceRuntimeSession,
  mountPublishedSurfaceRuntime,
  type PublishedSurfaceRuntimeSession,
  type PublishedSurfaceRuntimeMountHandle,
} from '../runtime/publishedSurfaceRuntimeMount'
import {
  mountPublishedCanvasRuntime,
  type PublishedCanvasRuntimeMountHandle,
} from '../runtime/publishedCanvasRuntimeMount'
import {
  isPublishedGlobalCanvasRuntimePointerItem,
  setPublishedGlobalCanvasRuntimeInteractionVisibility,
} from '../runtime/publishedGlobalCanvasRuntimePointer'
import {
  PublishedDomInteractionSurfacePort,
  PublishedInteractionVisibilityState,
  type PublishedInteractionNodeHandle,
  type PublishedInteractionNodeOwnership,
  type PublishedInteractionNodeSource,
  type PublishedInteractionNodeState,
} from '../../interactions/PublishedDomInteractionSurfacePort'
import type { PublishedInteractionSurfacePort } from '../../interactions/PublishedInteractionSurfacePort'
import type {
  PublishedAuthoringPatchIdentity,
  PublishedAuthoringPatchSurface,
} from '../publishedAuthoringSession'
import {
  applyPublishedSlideAuthoringItemPatch,
  publishedComponentAuthoringNode,
  publishedSlideAuthoringFrameOf,
  mapRuntimeAuthoringTargetsToLayer,
  validatePublishedSlideAuthoringIdentity,
  type PublishedSlideAuthoringIdentity,
  type PublishedSlideAuthoringOwner,
  type PublishedSlideAuthoringPatchResult,
  type PublishedSlideComponentAuthoringNode,
} from './publishedSlideAuthoringPatch'
import {
  capturePublishedSlidePng,
  type PublishedSlideCaptureLayer,
} from '../publishedCapture'
import type { CourseStateStore } from '../../CourseStateStore'
import {
  PublishedCarrierSideEffectGate,
  type PublishedCarrierSideEffects,
} from '../publishedCourseState'

export interface SlidePublishedAuthoringOptions {
  readonly stateId: string | null
  /** Surface-scoped items keep the V8-compatible local `scene` wire scope. */
  readonly scope: 'scene' | 'surface' | 'global'
  /**
   * Ephemeral editor-side packages retain the Component V4 editor schema.
   * They are never written into the Published V2 payload.
   */
  readonly componentPackages?: Readonly<Record<string, ComponentPackageData>>
  readonly onRuntimeTargetsChanged?: (
    update: Readonly<RuntimeAuthoringTargetUpdate>,
  ) => void
  readonly onComponentTargetsChanged?: (
    update: Readonly<ComponentAuthoringTargetUpdate>,
  ) => void
  readonly courseState?: CourseStateStoreContract
}

function clonePayload(payload: PublishedCourseV2Payload): PublishedCourseV2Payload {
  return structuredClone(payload)
}

function findSlideSurface(
  payload: PublishedCourseV2Payload,
  surfaceId: string,
): PublishedSlideSurface {
  const surface = payload.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'slide') {
    throw new Error(`找不到 Slide 表面：${surfaceId}`)
  }
  return surface
}

function firstSlideLocationId(payload: PublishedCourseV2Payload, surfaceId: string): string {
  const match = payload.locations.find((location) => (
    location.kind === 'slide-scene' && location.surfaceId === surfaceId
  ))
  if (match) return match.id
  const surface = findSlideSurface(payload, surfaceId)
  const scene = surface.scenes[0]
  if (!scene) throw new Error(`Slide 表面没有场景：${surfaceId}`)
  return scene.id
}

function resolveSlideLocation(
  payload: PublishedCourseV2Payload,
  surfaceId: string,
  locationId: string,
): Extract<CourseLocation, { kind: 'slide-scene' }> {
  const location = payload.locations.find((candidate) => candidate.id === locationId)
  if (location?.kind === 'slide-scene' && location.surfaceId === surfaceId) return location
  const surface = findSlideSurface(payload, surfaceId)
  const scene = surface.scenes.find((candidate) => candidate.id === locationId)
  if (scene) {
    return {
      id: locationId,
      label: scene.name,
      kind: 'slide-scene',
      surfaceId,
      sceneId: scene.id,
    }
  }
  throw new Error(`找不到 Slide 位置：${locationId}`)
}

/** Exact-state Published adapter; initial-state selection remains in navigation. */
export function composePublishedSlideLocation(input: {
  readonly payload: PublishedCourseV2Payload
  readonly locationId: string
  readonly stateId: string | null
}): CourseLayerComposition<PublishedLayerItem> {
  return composePublishedCourseLocation({
    course: input.payload,
    locationId: input.locationId,
    stateId: input.stateId,
  })
}

export type PublishedSlideLayerSource = 'scene' | 'surface' | 'global'

export interface PublishedSlideNativeRenderLayer {
  readonly kind: 'native'
  readonly source: PublishedSlideLayerSource
  readonly layerItemId: string
  readonly stackOrder: number
  readonly applicable: boolean
  readonly mounted: boolean
  readonly item: PublishedNativeLayerItem
  readonly renderInput: PublishedNativeRenderInput
}

export interface PublishedSlideComponentMountDescriptor {
  readonly kind: 'component'
  readonly source: PublishedSlideLayerSource
  readonly layerItemId: string
  readonly stackOrder: number
  readonly applicable: boolean
  readonly mounted: boolean
  readonly item: PublishedComponentLayerItem
  readonly hostNode: PublishedSlideComponentAuthoringNode
}

export interface PublishedSlideRuntimeMountDescriptor {
  readonly kind: 'runtime'
  readonly source: PublishedSlideLayerSource
  readonly layerItemId: string
  readonly stackOrder: number
  readonly applicable: boolean
  readonly mounted: boolean
  readonly item: PublishedRuntimeLayerItem
}

export type PublishedSlidePaintLayer =
  | PublishedSlideNativeRenderLayer
  | PublishedSlideComponentMountDescriptor
  | PublishedSlideRuntimeMountDescriptor

export interface PublishedSlideRenderPlan {
  readonly locationId: string
  readonly surfaceId: string
  readonly sceneId: string | null
  readonly stateId: string | null
  readonly background: CourseLayerComposition<PublishedLayerItem>['background']
  readonly layers: readonly PublishedSlidePaintLayer[]
}

function publishedSlideLayerSource(
  source: CourseLayerComposition<PublishedLayerItem>['entries'][number]['source'],
): PublishedSlideLayerSource {
  if (source === 'world') {
    throw new Error('Slide Published 合成不能包含 world 图层')
  }
  return source
}

/** Readonly Published Slide paint plan: Native render input + dynamic mount descriptors. */
export function publishedSlideRenderPlanFromComposition(
  composition: CourseLayerComposition<PublishedLayerItem>,
): PublishedSlideRenderPlan {
  return {
    locationId: composition.locationId,
    surfaceId: composition.surfaceId,
    sceneId: composition.sceneId,
    stateId: composition.stateId,
    background: composition.background,
    layers: composition.entries.map((entry): PublishedSlidePaintLayer => {
      const source = publishedSlideLayerSource(entry.source)
      const base = {
        source,
        layerItemId: entry.item.layerItemId,
        stackOrder: entry.stackOrder,
        applicable: entry.applicable,
        mounted: entry.mounted,
      }
      if (entry.item.kind === 'native') {
        return {
          ...base,
          kind: 'native',
          item: entry.item,
          renderInput: readonlyNativeRenderInputFromPublishedItem(entry.item),
        }
      }
      if (entry.item.kind === 'component') {
        return {
          ...base,
          kind: 'component',
          item: entry.item,
          hostNode: publishedComponentAuthoringNode(entry.item),
        }
      }
      return {
        ...base,
        kind: 'runtime',
        item: entry.item,
      }
    }),
  }
}

function firstKeyedString(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const direct = record[key]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }
  for (const nested of Object.values(record)) {
    const found = firstKeyedString(nested, keys)
    if (found) return found
  }
  return undefined
}

function firstAnyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const nestedValues = Array.isArray(value) ? value : Object.values(value)
  for (const nested of nestedValues) {
    const found = firstAnyString(nested)
    if (found) return found
  }
  return undefined
}

function firstVisibleText(value: unknown): string | undefined {
  return firstKeyedString(value, ['title', 'label', 'text', 'heading', 'name'])
    ?? firstAnyString(value)
}

function appendFallbackImage(wrap: HTMLElement, url: string, alt: string): void {
  const image = wrap.ownerDocument.createElement('img')
  image.src = url
  image.alt = alt
  image.style.width = '100%'
  image.style.height = '100%'
  image.style.objectFit = 'contain'
  wrap.appendChild(image)
}

function appendVisibleTextFallback(
  wrap: HTMLElement,
  instanceId: string,
  text: string,
): void {
  const fallback = wrap.ownerDocument.createElement('div')
  fallback.className = 'published-surface-runtime-fallback'
  fallback.dataset.runtimeInstanceId = instanceId
  fallback.dataset.runtimeFallback = 'true'
  fallback.textContent = text
  Object.assign(fallback.style, {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    padding: '12px 16px',
    overflow: 'hidden',
    pointerEvents: 'none',
    background: '#0f766e',
    color: '#ffffff',
    font: 'bold 22px "Microsoft YaHei", sans-serif',
    textAlign: 'center',
  })
  wrap.appendChild(fallback)
}

function isPublishedTeacherController(
  item: PublishedLayerItem,
): item is PublishedNativeLayerItem & {
  content: Extract<PublishedNativeLayerItem['content'], { nativeType: 'teacher-controller' }>
} {
  return item.kind === 'native' && item.content.nativeType === 'teacher-controller'
}

function isPublishedInteractiveLayer(item: PublishedLayerItem): boolean {
  return isPublishedTeacherController(item)
    || (item.kind === 'native' && item.content.nativeType === 'video')
}

function isPublishedSlideSurfaceRuntime(item: PublishedLayerItem): boolean {
  return item.kind === 'runtime'
    && item.runtime.enabled
    && item.runtime.protocol === 'surface-runtime'
    && item.runtime.runtimeApiVersion === 3
    && item.runtime.renderMode === 'dom'
}

function isPublishedSlideCanvasRuntime(item: PublishedLayerItem): boolean {
  return item.kind === 'runtime'
    && item.runtime.enabled
    && item.runtime.protocol === 'canvas-runtime'
    && item.runtime.runtimeApiVersion === 2
}

function isPublishedSlidePlayableRuntime(item: PublishedLayerItem): boolean {
  return isPublishedSlideSurfaceRuntime(item) || isPublishedSlideCanvasRuntime(item)
}

function publishedInteractionOwnership(
  item: PublishedLayerItem,
): PublishedInteractionNodeOwnership {
  if (item.kind === 'component') return 'component'
  if (item.kind === 'runtime') return 'runtime'
  if (item.content.nativeType === 'video') return 'media'
  if (item.content.nativeType === 'teacher-controller') return 'teacher-controller'
  return 'native'
}

function canBindPublishedNativeClick(item: PublishedLayerItem): boolean {
  if (item.kind !== 'native' || item.hitPolicy !== 'auto') return false
  return item.content.nativeType === 'text'
    || item.content.nativeType === 'image'
    || item.content.nativeType === 'formula'
    || item.content.nativeType === 'shape'
}

function appendLayerNode(
  dom: Document,
  parent: HTMLElement,
  item: PublishedLayerItem,
  source: 'scene' | 'surface' | 'global',
  resolveAsset: (assetId: string) => string | undefined,
  mountTeacherController?: (wrap: HTMLElement, input: PublishedTeacherControllerInput) => void,
  options?: {
    components?: Readonly<Record<string, PublishedComponentPackageSource>>
    interactive?: boolean
    includeInvisible?: boolean
    staticCapture?: boolean
    courseState?: CourseStateStoreContract
    componentActions?: Readonly<ComponentHostActions>
    presentation?: RuntimePresentationApi
    authoring?: SlidePublishedAuthoringOptions
    sceneId?: string
    mountComponent?: (handle: PublishedComponentMountHandle) => void
    registerComponentRemount?: (
      mount: (
        item: Extract<PublishedLayerItem, { kind: 'component' }>,
      ) => PublishedComponentMountHandle,
    ) => void
    deferComponentMount?: (mount: () => void) => void
    mountPhaserComponent?: (
      wrap: HTMLElement,
      item: Extract<PublishedLayerItem, { kind: 'component' }>,
    ) => void
    mountRuntime?: (wrap: HTMLElement, item: PublishedRuntimeLayerItem) => void
    renderInput?: PublishedNativeRenderInput
  },
): HTMLElement | null {
  if (!item.visible && !options?.includeInvisible) return null
  const wrap = dom.createElement('div')
  wrap.dataset.slideLayerItem = item.layerItemId
  wrap.dataset.layerSource = source
  if (source === 'global') wrap.dataset.globalLayerItem = item.layerItemId
  if (source !== 'scene') wrap.dataset.slideOverlayItem = item.layerItemId
  wrap.style.position = 'absolute'
  wrap.style.left = `${item.frame.x}px`
  wrap.style.top = `${item.frame.y}px`
  wrap.style.width = `${item.frame.width}px`
  wrap.style.height = `${item.frame.height}px`
  wrap.style.opacity = String(item.opacity)
  wrap.style.transform = `rotate(${item.rotation}deg)`
  wrap.style.transformOrigin = 'center center'
  wrap.style.pointerEvents = options?.interactive === false
    ? 'none'
    : isPublishedInteractiveLayer(item)
    || item.kind === 'component'
    || (
      source === 'scene'
      && item.hitPolicy !== 'pass-through'
      && isPublishedSlidePlayableRuntime(item)
    )
      ? 'auto'
      : 'none'
  wrap.style.zIndex = String(item.order)
  if (!item.visible) {
    wrap.style.visibility = 'hidden'
    wrap.style.pointerEvents = 'none'
    wrap.setAttribute('aria-hidden', 'true')
  }
  if (
    !options?.authoring
    && !options?.staticCapture
    && item.playbackInitialVisibility === 'hidden'
  ) {
    wrap.style.visibility = 'hidden'
    wrap.style.pointerEvents = 'none'
    wrap.setAttribute('aria-hidden', 'true')
  }
  if (item.kind === 'native') {
    paintPublishedNativeRenderInput(
      wrap,
      options?.renderInput ?? readonlyNativeRenderInputFromPublishedItem(item),
      {
        resolveAsset,
        ...(mountTeacherController
          ? { mountTeacherController }
          : {}),
      },
      { staticCapture: options?.staticCapture === true },
    )
  } else if (item.kind === 'component') {
    wrap.dataset.slideFallbackKind = 'component'
    const packageSource = findComponentPackageSource(
      options?.components,
      item.component.packageId,
      item.component.version,
    )
    const componentScope = source === 'global' ? 'global' : 'scene'
    let phaserOwnedComponent = false
    if (packageSource !== undefined) {
      const manifest = extractPublishedComponentManifest(packageSource)
      phaserOwnedComponent = (
        manifest.renderMode === 'phaser'
        || (manifest.renderMode === 'hybrid' && source === 'scene')
      )
        && manifest.supportedScopes.includes(componentScope)
    }
    if (phaserOwnedComponent && options?.mountPhaserComponent) {
      options.mountPhaserComponent(wrap, item)
    } else {
      const mountInstance = (
        nextItem: Extract<PublishedLayerItem, { kind: 'component' }> = item,
      ): PublishedComponentMountHandle => {
        const handle = mountPublishedComponent(wrap, {
          container: wrap,
          componentId: nextItem.component.packageId,
          version: nextItem.component.version,
          instanceId: nextItem.layerItemId,
          width: nextItem.frame.width,
          height: nextItem.frame.height,
          props: nextItem.props,
          staticFallbackAssetId: nextItem.staticFallbackAssetId,
          components: options?.components,
          resolveAsset,
          interactive: options?.interactive ?? true,
          ...(options?.courseState ? { courseState: options.courseState } : {}),
          ...(!options?.staticCapture && !options?.authoring && options?.componentActions
            ? { actions: options.componentActions }
            : {}),
          ...(!options?.staticCapture && !options?.authoring && options?.presentation
            ? { presentation: options.presentation }
            : {}),
          ...(options?.staticCapture
            ? {
                mode: 'capture' as const,
                scope: source === 'global' ? 'global' as const : 'scene' as const,
                ...(source !== 'global' && options.sceneId
                  ? { sceneId: options.sceneId }
                  : {}),
                interactive: false,
              }
            : options?.authoring && (
            source === 'global'
            || source === (options.authoring.scope === 'surface' ? 'surface' : 'scene')
          )
            ? {
                mode: 'edit' as const,
                scope: source === 'global' ? 'global' as const : 'scene' as const,
                ...(source !== 'global' && options.sceneId
                  ? { sceneId: options.sceneId }
                  : {}),
                ...(options.authoring.courseState
                  ? { courseState: options.authoring.courseState }
                  : {}),
                authoring: {
                  node: publishedComponentAuthoringNode(nextItem),
                  onTargetsChanged: options.authoring.onComponentTargetsChanged
                    ?? (() => undefined),
                },
              }
            : {}),
        })
        options?.mountComponent?.(handle)
        return handle
      }
      options?.registerComponentRemount?.(mountInstance)
      if (options?.deferComponentMount) options.deferComponentMount(() => mountInstance())
      else mountInstance()
    }
  } else if (item.kind === 'runtime') {
    wrap.dataset.slideRuntimeKind = item.runtime.protocol
    if (!item.runtime.enabled) {
      wrap.dataset.slideRuntimeState = 'disabled'
    } else if (
      isPublishedSlidePlayableRuntime(item)
      && options?.mountRuntime
      && (
        source === 'scene'
        || (source === 'surface' && options.authoring?.scope === 'surface')
      )
    ) {
      wrap.dataset.slideRuntimeState = 'playback'
      options.mountRuntime(wrap, item)
    } else {
      wrap.dataset.slideFallbackKind = 'runtime'
      wrap.dataset.slideRuntimeState = 'fallback'
      const url = item.runtime.staticFallback
        ? resolveAsset(item.runtime.staticFallback.assetId)
        : undefined
      if (url) {
        appendFallbackImage(wrap, url, 'runtime 后备')
      } else {
        appendVisibleTextFallback(
          wrap,
          item.layerItemId,
          firstVisibleText(item.runtime.content.values) ?? item.runtime.protocol,
        )
      }
    }
  }
  parent.appendChild(wrap)
  return wrap
}

function presentationStateIdForLocation(
  scene: PublishedSlideScene,
  location: Extract<CourseLocation, { kind: 'slide-scene' }>,
): string | undefined {
  const stateId = location.stateId ?? scene.presentation?.initialStateId
  if (stateId === undefined) return undefined
  if (!scene.presentation?.states.some((state) => state.id === stateId)) {
    throw new Error(`找不到 Slide 呈现状态：${stateId}`)
  }
  return stateId
}

function exactPresentationStateId(
  scene: PublishedSlideScene,
  stateId: string | undefined,
): string | undefined {
  if (stateId === undefined) return scene.presentation?.initialStateId
  if (!scene.presentation?.states.some((state) => state.id === stateId)) {
    throw new Error(`找不到 Slide 呈现状态：${stateId}`)
  }
  return stateId
}

type SlideRenderedLayerSource = 'scene' | 'surface' | 'global'

interface SlideRenderedLayerRecord {
  item: PublishedLayerItem
  stackOrder: number
  readonly source: SlideRenderedLayerSource
  readonly applicable: boolean
  readonly wrap: HTMLElement
  componentHandle?: PublishedComponentMountHandle
  runtimeHandle?: PublishedSurfaceRuntimeMountHandle | PublishedCanvasRuntimeMountHandle
  remountComponent?: (
    item: Extract<PublishedLayerItem, { kind: 'component' }>,
  ) => Promise<void>
  remountRuntime?: (item: PublishedRuntimeLayerItem) => Promise<void>
}

function renderedLayerKey(
  source: SlideRenderedLayerSource,
  layerItemId: string,
): string {
  return `${source}:${layerItemId}`
}

/**
 * Minimal Published Course V2 Slide adapter. It is not PlayerApp and does not
 * project Flow/Spatial through buildStandaloneHtml.
 */
export class SlidePublishedAdapter implements SurfaceHost, PublishedAuthoringPatchSurface {
  readonly kind = 'slide' as const
  readonly id: string
  readonly #payload: PublishedCourseV2Payload
  readonly #startLocationId: string
  readonly #resolveAsset: (assetId: string) => string | undefined
  readonly #globalInteractionVisibilityState: PublishedInteractionVisibilityState
  readonly #onInteractionInvalidated?: () => void
  readonly #onInteractionReady?: () => void
  readonly #teacherControllerSession: TeacherControllerRuntimeSessionStore
  readonly #executeTeacherControllerAction?: (
    action: TeacherControllerAction,
  ) => boolean | void | Promise<boolean | void>
  readonly #replayScene?: () => Promise<boolean>
  readonly #deferTeacherControllerCourseReset: boolean
  readonly #authoring: SlidePublishedAuthoringOptions | null
  readonly #staticCapture: boolean
  readonly #includeGlobalLayerItemsForStaticCapture: boolean
  #authoringGeneration = 0
  #locationId: string
  #presentationStateId: string | undefined
  #preparedPresentationState: { locationId: string; stateId: string | undefined } | null = null
  #preparedRuntimeActivation: { locationId: string; forced: boolean } | null = null
  #pendingRuntimeActivation: { locationId: string; forced: boolean } | null = null
  #completedActiveResetLocationId: string | null = null
  #root: HTMLElement | null = null
  #active = false
  #services: SurfacePlayerServices | null = null
  #controllers: TeacherControllerDom[] = []
  #componentHandles: PublishedComponentMountHandle[] = []
  #phaserComponentHandles: PublishedComponentMountHandle[] = []
  #deferredCarrierMounts: Array<() => void> = []
  #runtimeHandles: Array<
    PublishedSurfaceRuntimeMountHandle | PublishedCanvasRuntimeMountHandle
  > = []
  readonly #runtimeSession: PublishedSurfaceRuntimeSession
  readonly #carrierSideEffects: PublishedCarrierSideEffectGate
  #carrierEffects: PublishedCarrierSideEffects
  readonly #runtimeActions?: Readonly<RuntimeHostActions>
  readonly #componentActions?: Readonly<ComponentHostActions>
  readonly #audio?: Pick<
    AudioManager,
    'muted' | 'toggleMuted' | 'registerVideo' | 'beginBackgroundAudioInterruption'
  >
  #muted = false
  #interactionPort: PublishedDomInteractionSurfacePort | null = null
  #slideInteractionPort: PublishedSlideInteractionSurfacePort | null = null
  /** Scene-local video registry: one lifecycle handle per mounted video node. */
  readonly #videoHandles = new Map<string, PublishedNativeVideoHandle>()
  #interactionGeneration = 0
  #interactionNodes = new Map<string, PublishedInteractionNodeHandle>()
  #renderedLayers = new Map<string, SlideRenderedLayerRecord>()
  #authoringMotionTimers = new Map<string, number>()
  #authoringMotionControllers = new Map<string, AbortController>()
  #authoringRuntimeGeneration = 0
  #authoringRuntimeRevision = 0
  #authoringRuntimeTargets = new Map<
    string,
    Readonly<{ order: number; update: RuntimeAuthoringTargetUpdate }>
  >()

  constructor(
    payload: PublishedCourseV2Payload,
    surfaceId: string,
    options: {
      locationId?: string
      resolveAsset?: (assetId: string) => string | undefined
      globalInteractionVisibilityState?: PublishedInteractionVisibilityState
      onInteractionInvalidated?: () => void
      onInteractionReady?: () => void
      teacherControllerSession?: TeacherControllerRuntimeSessionStore
      replayScene?: () => Promise<boolean>
      executeTeacherControllerAction?: (
        action: TeacherControllerAction,
      ) => boolean | void | Promise<boolean | void>
      deferTeacherControllerCourseReset?: boolean
      authoring?: SlidePublishedAuthoringOptions
      staticCapture?: boolean
      includeGlobalLayerItemsForStaticCapture?: boolean
      courseState?: CourseStateStore
      runtimeActions?: Readonly<RuntimeHostActions>
      componentActions?: Readonly<ComponentHostActions>
      audio?: Pick<
        AudioManager,
        'muted' | 'toggleMuted' | 'registerVideo' | 'beginBackgroundAudioInterruption'
      >
    } = {},
  ) {
    this.#payload = clonePayload(payload)
    this.id = surfaceId
    findSlideSurface(this.#payload, surfaceId)
    this.#startLocationId = options.locationId
      ?? firstSlideLocationId(this.#payload, surfaceId)
    this.#locationId = this.#startLocationId
    this.#resolveAsset = options.resolveAsset
      ?? ((assetId: string) => this.#payload.assets[assetId]?.url)
    this.#globalInteractionVisibilityState = options.globalInteractionVisibilityState
      ?? new PublishedInteractionVisibilityState()
    this.#onInteractionInvalidated = options.onInteractionInvalidated
    this.#onInteractionReady = options.onInteractionReady
    this.#teacherControllerSession = options.teacherControllerSession
      ?? new TeacherControllerRuntimeSessionStore()
    this.#replayScene = options.replayScene
    this.#executeTeacherControllerAction = options.executeTeacherControllerAction
    this.#deferTeacherControllerCourseReset = options.deferTeacherControllerCourseReset === true
    const location = resolveSlideLocation(this.#payload, this.id, this.#locationId)
    const scene = sceneOf(findSlideSurface(this.#payload, this.id), location)
    this.#authoring = options.authoring ?? null
    this.#staticCapture = options.staticCapture === true
    this.#runtimeSession = createPublishedSurfaceRuntimeSession(options.courseState)
    this.#runtimeActions = options.runtimeActions
    this.#componentActions = options.componentActions
    this.#audio = options.audio
    this.#carrierSideEffects = new PublishedCarrierSideEffectGate({
      courseState: this.#runtimeSession.courseState,
      runtimeActions: this.#runtimeActions,
      componentActions: this.#componentActions,
    })
    this.#carrierEffects = this.#carrierSideEffects.beginGeneration()
    this.#includeGlobalLayerItemsForStaticCapture =
      options.includeGlobalLayerItemsForStaticCapture === true
    this.#presentationStateId = this.#authoring
      ? this.#authoring.stateId === null
        ? undefined
        : exactPresentationStateId(scene, this.#authoring.stateId)
      : presentationStateIdForLocation(scene, location)
  }

  getLocationId(): string {
    return this.#locationId
  }

  /** Current Published Slide paint plan. Does not construct Scene/Project. */
  getPublishedSlideRenderPlan(): PublishedSlideRenderPlan {
    return publishedSlideRenderPlanFromComposition(composePublishedSlideLocation({
      payload: this.#payload,
      locationId: this.#locationId,
      stateId: this.#presentationStateId ?? null,
    }))
  }

  getAuthoringContext(): PlayerAuthoringContext {
    if (!this.#authoring) {
      throw new Error('当前 Slide Published 宿主不是作者模式。')
    }
    const location = resolveSlideLocation(this.#payload, this.id, this.#locationId)
    const scene = sceneOf(findSlideSurface(this.#payload, this.id), location)
    return {
      sceneId: scene.id,
      stateId: this.#presentationStateId ?? null,
    }
  }

  getAuthoringGeneration(): number {
    if (!this.#authoring) {
      throw new Error('当前 Slide Published 宿主不是作者模式。')
    }
    return this.#authoringGeneration
  }

  async applyAuthoringPatch(
    context: PlayerAuthoringContext,
    patch: PlayerAuthoringPatch,
    commandIdentity: PublishedAuthoringPatchIdentity,
  ): Promise<PublishedSlideAuthoringPatchResult> {
    if (!this.#authoring) {
      return this.#authoringFailure(
        'unsupported-host-mode',
        '当前 Slide Published 宿主不是统一画布编辑宿主。',
      )
    }
    const expected = this.getAuthoringContext()
    if (context.sceneId !== expected.sceneId) {
      return this.#authoringFailure('scene-mismatch', '编辑命令不属于当前 Slide 场景。')
    }
    if (context.stateId !== expected.stateId) {
      return this.#authoringFailure('state-mismatch', '编辑命令不属于当前 Slide 呈现状态。')
    }

    if (patch.kind === 'preview-node-motion') {
      if (patch.target.nodeId !== patch.action.nodeId) {
        return this.#authoringFailure('target-mismatch', '动画预览目标与动作节点不一致。')
      }
      const record = this.#authoringRecord(patch.target.scope, patch.target.nodeId)
      if (!record || !this.#previewAuthoringMotion(record, patch.action, patch.delayMs)) {
        return this.#authoringFailure(
          'target-not-found',
          `当前 Published 宿主中无法预览节点“${patch.target.nodeId}”的动画。`,
        )
      }
      return { ok: true, target: patch.target }
    }

    if (patch.kind === 'scene-background') {
      if (patch.backgroundAssetId && !this.#resolveAsset(patch.backgroundAssetId)) {
        return this.#authoringFailure(
          'asset-missing',
          `场景背景素材“${patch.backgroundAssetId}”无法解析。`,
        )
      }
      this.#applyBackground(patch.backgroundColor, patch.backgroundAssetId ?? null)
      return { ok: true, target: patch.target }
    }

    if (patch.kind === 'scene-order') {
      const records = [...this.#renderedLayers.values()]
        .filter((record) => (
          record.source === this.#localAuthoringSource()
          && (record.item.kind === 'native' || record.item.kind === 'component')
        ))
        .sort((left, right) => left.item.order - right.item.order)
      const expectedIds = records.map((record) => record.item.layerItemId)
      const provided = new Set(patch.nodeIds)
      if (
        patch.nodeIds.length !== expectedIds.length
        || provided.size !== patch.nodeIds.length
        || expectedIds.some((id) => !provided.has(id))
      ) {
        return this.#authoringFailure(
          'target-mismatch',
          '节点层级必须完整包含当前场景的全部可编辑节点，且不能重复。',
        )
      }
      const slots = records.map((record) => record.item.order)
      const stackSlots = records.map((record) => record.stackOrder)
        .sort((left, right) => left - right)
      const byId = new Map(records.map((record) => [record.item.layerItemId, record]))
      patch.nodeIds.forEach((id, index) => {
        const record = byId.get(id)!
        record.item = { ...record.item, order: slots[index]! }
        record.stackOrder = stackSlots[index]!
        record.wrap.style.zIndex = String(record.stackOrder)
      })
      return { ok: true, target: patch.target }
    }

    if (patch.kind === 'runtime-content') {
      const record = this.#authoringRecord(patch.target.scope, patch.target.nodeId)
      const captured = this.#captureAuthoringIdentity(
        patch.target,
        commandIdentity,
        patch.target.nodeId,
      )
      const identity = this.#validateCapturedAuthoringRecord(captured, record)
      if (!identity.ok) return identity
      if (!record || record.item.kind !== 'runtime') {
        return this.#authoringFailure(
          'target-not-found',
          `当前 Published 宿主中不存在 Runtime“${patch.target.nodeId}”。`,
        )
      }
      if (!Object.prototype.hasOwnProperty.call(
        record.item.runtime.content.values,
        patch.target.key,
      )) {
        return this.#authoringFailure(
          'target-mismatch',
          `Runtime“${patch.target.nodeId}”不再声明文字键“${patch.target.key}”。`,
        )
      }
      const item: PublishedRuntimeLayerItem = {
        ...record.item,
        runtime: {
          ...record.item.runtime,
          content: {
            ...record.item.runtime.content,
            values: {
              ...record.item.runtime.content.values,
              [patch.target.key]: patch.value,
            },
          },
        },
      }
      if (!record.remountRuntime) {
        return this.#authoringFailure(
          'update-failed',
          `Runtime“${patch.target.nodeId}”没有可重建的作者实例。`,
        )
      }
      // Runtime content is snapshotted into ctx.content during create(). ACK
      // only after this one carrier has rebuilt and completed its async boot.
      try {
        await record.remountRuntime(item)
      } catch (error) {
        const current = this.#validateCapturedAuthoringRecord(captured, record)
        if (!current.ok) return current
        throw error
      }
      const current = this.#validateCapturedAuthoringRecord(captured, record)
      if (!current.ok) return current
      record.item = item
      return { ok: true, target: patch.target }
    }

    const frame = publishedSlideAuthoringFrameOf(patch.node)
    if (!frame) {
      return this.#authoringFailure(
        'target-mismatch',
        'Published Slide 画面命令只接受 Native render input 或组件 mount descriptor。',
      )
    }
    if (patch.target.nodeId !== frame.id) {
      return this.#authoringFailure('target-mismatch', '编辑目标 ID 与完整节点 ID 不一致。')
    }
    const record = this.#authoringRecord(patch.target.scope, patch.target.nodeId)
    const captured = this.#captureAuthoringIdentity(
      patch.target,
      commandIdentity,
      patch.target.nodeId,
    )
    const merged = applyPublishedSlideAuthoringItemPatch({
      current: record?.item ?? null,
      next: frame,
      captured,
      currentIdentity: {
        revision: commandIdentity.revision,
        generation: this.#authoringGeneration,
        owner: record
          ? this.#recordAuthoringOwner(record)
          : this.#authoringOwner(patch.target.scope),
        itemId: record?.item.layerItemId ?? '',
      },
    })
    if (!merged.ok) return merged
    if (!record) {
      return this.#authoringFailure(
        'target-not-found',
        `当前 Published 宿主中不存在节点“${frame.id}”。`,
      )
    }
    if (isNativeRenderInput(frame)) {
      const assetFailure = this.#validateAuthoringNodeAssets(frame)
      if (assetFailure) return assetFailure
    }
    const updated = await this.#updateAuthoringRecord(record, merged.item, captured)
    if (!updated.ok) return updated
    return { ok: true, target: patch.target }
  }

  /** Published navigator hint used to avoid resuming a stale scene before setLocationId(). */
  preparePublishedLocation(locationId: string, forced: boolean): void {
    resolveSlideLocation(this.#payload, this.id, locationId)
    this.#completedActiveResetLocationId = null
    this.#preparedRuntimeActivation = { locationId, forced }
  }

  getPublishedInteractionSurfacePort(): PublishedInteractionSurfacePort | null {
    return this.#slideInteractionPort
  }

  getPublishedGlobalRuntimeMountTarget(itemId: string): HTMLElement | null {
    const root = this.#root
    if (!root) return null
    for (const candidate of root.querySelectorAll<HTMLElement>('[data-global-layer-item]')) {
      if (candidate.dataset.globalLayerItem === itemId) return candidate
    }
    return null
  }

  preparePublishedPresentationState(
    locationId: string,
    stateId: string | undefined,
  ): boolean {
    try {
      const location = resolveSlideLocation(this.#payload, this.id, locationId)
      const scene = sceneOf(findSlideSurface(this.#payload, this.id), location)
      this.#preparedPresentationState = {
        locationId,
        stateId: exactPresentationStateId(scene, stateId),
      }
      return true
    } catch {
      return false
    }
  }

  validatePublishedPresentationState(
    locationId: string,
    stateId: string | undefined,
  ): boolean {
    try {
      const location = resolveSlideLocation(this.#payload, this.id, locationId)
      const scene = sceneOf(findSlideSurface(this.#payload, this.id), location)
      exactPresentationStateId(scene, stateId)
      return true
    } catch {
      return false
    }
  }

  cancelPreparedPublishedPresentationState(locationId: string): void {
    if (this.#preparedPresentationState?.locationId === locationId) {
      this.#preparedPresentationState = null
    }
  }

  resetPublishedInteractionLocalState(): void {
    this.#invalidateInteractions()
    this.#interactionPort?.resetLocalVisibility()
    this.#restoreInteractionsIfActive()
  }

  async mount(context: SurfaceMountContext): Promise<void> {
    if (this.#root) throw new Error('Slide surface is already mounted')
    const root = context.container.ownerDocument.createElement('section')
    root.className = 'slide-published-adapter'
    root.dataset.surfaceId = this.id
    root.style.position = 'absolute'
    root.style.width = '1280px'
    root.style.height = '720px'
    root.style.overflow = 'hidden'
    root.style.transformOrigin = '0 0'
    if (this.#authoring || this.#staticCapture) {
      root.inert = true
      root.style.pointerEvents = 'none'
      root.dataset.hostMode = this.#authoring ? 'authoring' : 'capture'
    }
    root.hidden = !this.#active
    context.container.appendChild(root)
    this.#root = root
    this.#services = context.services
    this.#interactionPort = new PublishedDomInteractionSurfacePort(root)
    this.#slideInteractionPort = new PublishedSlideInteractionSurfacePort(
      this.#interactionPort,
      this.#videoHandles,
      {
        capture: this.#authoring !== null || this.#staticCapture,
        root,
        describeInput: nodeId => {
          const entry = this.getPublishedSlideRenderPlan().layers.find(layer =>
            layer.source === 'scene' && layer.kind === 'native' && layer.renderInput.id === nodeId)
          if (!entry || entry.kind !== 'native' || entry.renderInput.type !== 'input') return null
          const input = entry.renderInput
          const value = this.#payload.courseState.find(declaration => declaration.key === input.stateKey)
          const validity = this.#payload.courseState.find(declaration => declaration.key === input.validityKey)
          if (!value || value.valueType !== (input.answerType === 'text' ? 'string' : 'number') || validity?.valueType !== 'boolean') return null
          return { answerType: input.answerType, stateKey: input.stateKey, validityKey: input.validityKey,
            defaultValue: value.defaultValue as string | number }
        },
      },
    )
    this.#render()
    this.#restoreInteractionsIfActive()
  }

  async activate(): Promise<void> {
    const wasInactive = !this.#active
    const preparedActivation = this.#preparedRuntimeActivation
    this.#preparedRuntimeActivation = null
    this.#active = true
    if (this.#root) this.#root.hidden = false
    this.#pendingRuntimeActivation = null
    if (!(wasInactive && preparedActivation !== null)) {
      this.#carrierSideEffects.activate()
    }
    if (wasInactive) {
      if (preparedActivation !== null) {
        this.#pendingRuntimeActivation = preparedActivation
      } else {
        this.#mountDeferredCarriers()
        for (const handle of this.#runtimeHandles) {
          handle.setVisible(true)
          handle.resume()
        }
        for (const handle of this.#componentHandles) {
          handle.setVisible(true)
          handle.resume()
        }
      }
    }
    if (this.#pendingRuntimeActivation !== null) return
    this.#restoreInteractionsIfActive()
    this.#autoplayPublishedVideos()
  }

  async suspend(): Promise<void> {
    this.#invalidateInteractions()
    this.#active = false
    this.#pausePublishedVideos()
    this.#carrierSideEffects.suspend()
    this.#preparedRuntimeActivation = null
    this.#pendingRuntimeActivation = null
    this.#completedActiveResetLocationId = null
    for (const handle of this.#runtimeHandles) {
      handle.setVisible(false)
      handle.suspend()
    }
    for (const handle of this.#componentHandles) {
      handle.setVisible(false)
      handle.suspend()
    }
    if (this.#root) this.#root.hidden = true
  }

  async resume(): Promise<void> {
    return this.activate()
  }

  async reset(scope: SurfaceResetScope): Promise<void> {
    if (scope === 'course') {
      if (!this.#deferTeacherControllerCourseReset) {
        this.#teacherControllerSession.resetCourse()
      }
      this.#runtimeSession.resetCourse()
    } else this.#teacherControllerSession.resetSurface(this.id)
    this.#preparedPresentationState = null
    const preparedReset = this.#preparedRuntimeActivation
    const resetWasActive = this.#active
    await this.setLocationId(this.#startLocationId)
    if (
      resetWasActive
      && preparedReset?.forced
      && preparedReset.locationId === this.#startLocationId
    ) {
      this.#completedActiveResetLocationId = this.#startLocationId
    } else if (
      !resetWasActive
      && preparedReset?.forced
      && preparedReset.locationId === this.#startLocationId
    ) {
      // Mixed restart prepares the inactive start surface before reset. Keep
      // that forced hint so activate cannot materialize the reset generation
      // immediately before the navigator's authoritative setLocationId().
      this.#preparedRuntimeActivation = preparedReset
    }
  }

  async capture(request: SurfaceCaptureRequest): Promise<SurfaceCapture> {
    const root = this.#root
    if (!root) throw new Error('Slide Published 宿主尚未挂载')
    const allMatches = [...this.#renderedLayers.values()].filter((record) => (
      request.layerItemId === undefined
      || record.item.layerItemId === request.layerItemId
    ))
    if (request.layerItemId && allMatches.length === 0) {
      throw new Error(`当前 Published 位置中不存在图层“${request.layerItemId}”`)
    }
    if (request.layerItemId && allMatches.length > 1) {
      throw new Error(`当前 Published 位置中图层 ID“${request.layerItemId}”不唯一`)
    }
    const records = allMatches.filter((record) => this.#isStaticCaptureRecord(record))
    if (request.layerItemId && records.length === 0) {
      throw new Error(
        `图层“${request.layerItemId}”在当前位置不可见，或已被静态导出策略排除`,
      )
    }
    const ordered = records.sort((left, right) => (
      left.stackOrder - right.stackOrder
      || left.item.layerItemId.localeCompare(right.item.layerItemId)
    ))
    const itemCapture = request.layerItemId !== undefined
    const layers: PublishedSlideCaptureLayer[] = ordered.map((record) => ({
      element: record.wrap,
      x: itemCapture ? 0 : record.item.frame.x,
      y: itemCapture ? 0 : record.item.frame.y,
      width: record.item.frame.width,
      height: record.item.frame.height,
      rotation: itemCapture ? 0 : record.item.rotation,
      opacity: itemCapture ? 1 : record.item.opacity,
    }))
    const width = itemCapture ? ordered[0]!.item.frame.width : 1280
    const height = itemCapture ? ordered[0]!.item.frame.height : 720
    const content = await capturePublishedSlidePng({
      root,
      width,
      height,
      layers,
      transparentBackground: itemCapture,
    })
    return { format: 'data-url', content, width, height }
  }

  async setLocationId(locationId: string): Promise<void> {
    const location = resolveSlideLocation(this.#payload, this.id, locationId)
    const scene = sceneOf(findSlideSurface(this.#payload, this.id), location)
    const completedResetLocationId = this.#completedActiveResetLocationId
    this.#completedActiveResetLocationId = null
    this.#preparedRuntimeActivation = null
    const presentationStateId = this.#authoring
      ? this.#authoring.stateId === null
        ? undefined
        : exactPresentationStateId(scene, this.#authoring.stateId)
      : this.#preparedPresentationState?.locationId === locationId
        ? this.#preparedPresentationState.stateId
        : presentationStateIdForLocation(scene, location)
    this.#preparedPresentationState = null
    const sameLocation = locationId === this.#locationId
      && presentationStateId === this.#presentationStateId
    const pendingActivation = this.#pendingRuntimeActivation
    this.#pendingRuntimeActivation = null
    if (pendingActivation !== null) this.#carrierSideEffects.activate()
    if (completedResetLocationId === locationId && sameLocation) return
    if (
      pendingActivation?.locationId === locationId
      && !pendingActivation.forced
      && sameLocation
    ) {
      if (this.#deferredCarrierMounts.length > 0) {
        this.#mountDeferredCarriers()
      } else {
        for (const handle of this.#runtimeHandles) {
          handle.setVisible(true)
          handle.resume()
        }
        for (const handle of this.#componentHandles) {
          handle.setVisible(true)
          handle.resume()
        }
      }
      this.#restoreInteractionsIfActive()
      return
    }
    this.#invalidateInteractions()
    this.#interactionPort?.resetLocalVisibility()
    this.#locationId = locationId
    this.#presentationStateId = presentationStateId
    this.#render()
    this.#restoreInteractionsIfActive()
  }

  async destroy(): Promise<void> {
    if (this.#authoring) this.#authoringGeneration += 1
    this.#cancelAllAuthoringMotions()
    this.#invalidateInteractions()
    this.#carrierSideEffects.destroy()
    this.#destroyPublishedVideos()
    this.#slideInteractionPort?.clearVideoListeners()
    this.#slideInteractionPort = null
    this.#interactionPort?.destroy()
    this.#interactionPort = null
    this.#interactionNodes.clear()
    this.#renderedLayers.clear()
    this.#destroyRuntimes()
    this.#destroyComponents()
    this.#destroyControllers()
    this.#runtimeSession.destroy()
    this.#root?.remove()
    this.#root = null
    this.#active = false
    this.#preparedRuntimeActivation = null
    this.#pendingRuntimeActivation = null
    this.#completedActiveResetLocationId = null
    this.#services = null
  }

  #isStaticCaptureRecord(record: SlideRenderedLayerRecord): boolean {
    if (!record.applicable || !record.item.visible) return false
    if (
      record.source === 'global'
      && !this.#includeGlobalLayerItemsForStaticCapture
    ) return false
    if (isPublishedTeacherController(record.item)) {
      return record.item.content.data.includeInStaticExports
    }
    return true
  }

  #authoringFailure(
    code: PlayerAuthoringErrorCode,
    message: string,
  ): PublishedSlideAuthoringPatchResult {
    return { ok: false, code, message }
  }

  #authoringRecord(
    scope: 'scene' | 'global',
    nodeId: string,
  ): SlideRenderedLayerRecord | null {
    const source = scope === 'global' ? 'global' : this.#localAuthoringSource()
    return this.#renderedLayers.get(renderedLayerKey(source, nodeId)) ?? null
  }

  #localAuthoringSource(): Extract<SlideRenderedLayerSource, 'scene' | 'surface'> {
    return this.#authoring?.scope === 'surface' ? 'surface' : 'scene'
  }

  #authoringOwner(scope: 'scene' | 'global'): PublishedSlideAuthoringOwner {
    return scope === 'global' ? 'global' : this.#localAuthoringSource()
  }

  #recordAuthoringOwner(record: SlideRenderedLayerRecord): PublishedSlideAuthoringOwner {
    return record.source === 'global' ? 'global' : this.#localAuthoringSource()
  }

  #captureAuthoringIdentity(
    target: PublishedSlideAuthoringIdentity['target'],
    commandIdentity: PublishedAuthoringPatchIdentity,
    itemId: string,
  ): PublishedSlideAuthoringIdentity {
    return {
      target,
      revision: commandIdentity.revision,
      generation: commandIdentity.generation,
      owner: this.#authoringOwner(target.scope),
      itemId,
    }
  }

  #validateCapturedAuthoringRecord(
    captured: PublishedSlideAuthoringIdentity,
    expectedRecord: SlideRenderedLayerRecord | null,
  ): PublishedSlideAuthoringPatchResult {
    const currentRecord = this.#authoringRecord(captured.target.scope, captured.itemId)
    const validated = validatePublishedSlideAuthoringIdentity({
      captured,
      current: {
        // Command monotonicity is owned by PublishedAuthoringSessionCoordinator;
        // this value is its validated lease, while generation/owner/item are
        // re-read from the live Slide render before mutation and again before ACK.
        revision: captured.revision,
        generation: this.#authoringGeneration,
        owner: currentRecord
          ? this.#recordAuthoringOwner(currentRecord)
          : this.#authoringOwner(captured.target.scope),
        itemId: currentRecord?.item.layerItemId ?? '',
      },
      item: currentRecord?.item ?? null,
    })
    if (!validated.ok) return validated
    if (currentRecord !== expectedRecord) {
      return this.#authoringFailure(
        'stale-revision',
        `编辑目标“${captured.itemId}”所属的 Published 渲染世代已被替换。`,
      )
    }
    return validated
  }

  #validateAuthoringNodeAssets(
    input: PublishedNativeRenderInput,
  ): Extract<PublishedSlideAuthoringPatchResult, { ok: false }> | null {
    const missing = nativeMediaAssetIds(input).find((assetId) => !this.#resolveAsset(assetId))
    return missing
      ? {
          ok: false,
          code: 'asset-missing',
          message: `节点“${input.name}”的素材“${missing}”无法解析。`,
        }
      : null
  }

  #applyBackground(color: string, assetId: string | null): void {
    const root = this.#root
    if (!root) return
    const url = assetId ? this.#resolveAsset(assetId) : undefined
    root.style.backgroundColor = color
    root.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : 'none'
    root.style.backgroundPosition = 'center'
    root.style.backgroundRepeat = 'no-repeat'
    root.style.backgroundSize = 'cover'
  }

  #applyRecordFrame(record: SlideRenderedLayerRecord): void {
    const { item, wrap } = record
    wrap.style.left = `${item.frame.x}px`
    wrap.style.top = `${item.frame.y}px`
    wrap.style.width = `${item.frame.width}px`
    wrap.style.height = `${item.frame.height}px`
    wrap.style.opacity = String(item.opacity)
    wrap.style.transform = `rotate(${item.rotation}deg)`
    wrap.style.zIndex = String(record.stackOrder)
    const visible = this.#isRenderedLayerVisible(record)
    wrap.style.visibility = visible ? 'visible' : 'hidden'
    wrap.style.pointerEvents = this.#authoring ? 'none' : wrap.style.pointerEvents
    if (visible) wrap.removeAttribute('aria-hidden')
    else wrap.setAttribute('aria-hidden', 'true')
  }

  #isRenderedLayerVisible(record: SlideRenderedLayerRecord): boolean {
    if (!record.item.visible) return false
    if (
      this.#authoring
      && record.source === 'global'
      && this.#authoring.scope === 'global'
    ) return true
    return record.applicable
  }

  async #updateAuthoringRecord(
    record: SlideRenderedLayerRecord,
    item: PublishedLayerItem,
    captured: PublishedSlideAuthoringIdentity,
  ): Promise<PublishedSlideAuthoringPatchResult> {
    const before = this.#validateCapturedAuthoringRecord(captured, record)
    if (!before.ok) return before
    this.#cancelAuthoringMotion(item.layerItemId)
    if (item.kind === 'component') {
      if (!record.remountComponent) {
        throw new Error(`Component“${item.layerItemId}”没有可重建的作者实例。`)
      }
      try {
        await record.remountComponent(item)
      } catch (error) {
        const current = this.#validateCapturedAuthoringRecord(captured, record)
        if (!current.ok) return current
        throw error
      }
      const current = this.#validateCapturedAuthoringRecord(captured, record)
      if (!current.ok) return current
      record.item = item
      this.#applyRecordFrame(record)
    } else if (item.kind === 'native' && item.content.nativeType === 'teacher-controller') {
      record.item = item
      this.#applyRecordFrame(record)
      this.#remountAuthoringControllers()
    } else if (item.kind === 'native') {
      record.item = item
      this.#applyRecordFrame(record)
      record.wrap.replaceChildren()
      paintPublishedNativeRenderInput(
        record.wrap,
        readonlyNativeRenderInputFromPublishedItem(item),
        { resolveAsset: this.#resolveAsset },
      )
    } else {
      record.item = item
      this.#applyRecordFrame(record)
    }
    this.#refreshInteractionNodesFromRecords()
    return { ok: true, target: captured.target }
  }

  #remountAuthoringControllers(): void {
    this.#destroyControllers()
    for (const record of this.#renderedLayers.values()) {
      if (!isPublishedTeacherController(record.item)) continue
      record.wrap.replaceChildren()
      this.#mountTeacherController(
        record.wrap,
        readonlyNativeRenderInputFromPublishedItem(record.item),
      )
    }
  }

  #refreshInteractionNodesFromRecords(): void {
    this.#interactionNodes.clear()
    for (const record of this.#renderedLayers.values()) {
      this.#registerInteractionNode(
        record.wrap,
        record.item,
        record.source,
        record.applicable,
      )
    }
    this.#interactionPort?.refreshNodes(
      this.#interactionNodes.values(),
      ++this.#interactionGeneration,
    )
    if (this.#authoring) this.#interactionPort?.setActive(true)
  }

  #previewAuthoringMotion(
    record: SlideRenderedLayerRecord,
    action: NodeMotionAction,
    delayMs: number,
  ): boolean {
    const root = this.#root
    const port = this.#interactionPort
    const targetWindow = root?.ownerDocument.defaultView
    if (!root || !port || !targetWindow || !root.contains(record.wrap)) return false
    this.#cancelAuthoringMotion(action.nodeId)
    const start = () => {
      this.#authoringMotionTimers.delete(action.nodeId)
      if (!this.#root?.contains(record.wrap)) return
      const controller = new AbortController()
      this.#authoringMotionControllers.set(action.nodeId, controller)
      const result = port.executeNodeMotion(action, {
        ruleId: 'authoring-preview',
        stepId: `authoring-preview:${action.nodeId}`,
        signal: controller.signal,
        restartFromBeginning: true,
      })
      void Promise.resolve(result).then((completed) => {
        if (this.#authoringMotionControllers.get(action.nodeId) !== controller) return
        const restore = () => this.#cancelAuthoringMotion(action.nodeId)
        if (completed !== false && action.type === 'node.exit') {
          const timer = targetWindow.setTimeout(restore, 240)
          this.#authoringMotionTimers.set(action.nodeId, timer)
        } else restore()
      }, () => this.#cancelAuthoringMotion(action.nodeId))
    }
    const delay = Math.max(0, Math.min(60_000, delayMs))
    if (delay === 0) start()
    else {
      this.#authoringMotionTimers.set(action.nodeId, targetWindow.setTimeout(start, delay))
    }
    return true
  }

  #cancelAuthoringMotion(nodeId: string): void {
    const targetWindow = this.#root?.ownerDocument.defaultView
    const timer = this.#authoringMotionTimers.get(nodeId)
    if (timer !== undefined && targetWindow) targetWindow.clearTimeout(timer)
    this.#authoringMotionTimers.delete(nodeId)
    this.#authoringMotionControllers.get(nodeId)?.abort()
    this.#authoringMotionControllers.delete(nodeId)
    this.#interactionPort?.resetLocalVisibility()
  }

  #cancelAllAuthoringMotions(): void {
    const ids = new Set([
      ...this.#authoringMotionTimers.keys(),
      ...this.#authoringMotionControllers.keys(),
    ])
    ids.forEach((id) => this.#cancelAuthoringMotion(id))
  }

  #invalidateInteractions(): void {
    this.#onInteractionInvalidated?.()
    this.#interactionPort?.setActive(false)
  }

  #restoreInteractionsIfActive(): void {
    if (!this.#active || !this.#interactionPort || !this.#root) return
    if (this.#authoring) {
      this.#interactionPort.setActive(true)
      return
    }
    this.#interactionPort.setActive(true)
    this.#onInteractionReady?.()
  }

  #destroyComponents(): void {
    this.#deferredCarrierMounts = []
    for (const handle of this.#componentHandles) {
      try {
        handle.destroy()
      } catch (error) {
        console.error('Slide component destroy failed', error)
      }
    }
    this.#componentHandles = []
    this.#phaserComponentHandles = []
  }

  #mountDeferredCarriers(): void {
    const mounts = this.#deferredCarrierMounts
    this.#deferredCarrierMounts = []
    for (const mount of mounts) mount()
  }

  #publishAuthoringRuntimeTargets(sceneId: string): void {
    const publish = this.#authoring?.onRuntimeTargetsChanged
    if (!publish) return
    publish(Object.freeze({
      revision: ++this.#authoringRuntimeRevision,
      scope: 'scene' as const,
      sceneId,
      targets: Object.freeze(
        [...this.#authoringRuntimeTargets.entries()]
          .sort(([leftId, left], [rightId, right]) => (
            left.order - right.order || leftId.localeCompare(rightId, 'en')
          ))
          .flatMap(([, entry]) => entry.update.targets),
      ),
    }))
  }

  #destroyRuntimes(): void {
    for (const handle of this.#runtimeHandles) {
      try {
        handle.destroy()
      } catch (error) {
        console.error('Slide Surface Runtime destroy failed', error)
      }
    }
    this.#runtimeHandles = []
  }

  #destroyControllers(): void {
    for (const controller of this.#controllers) controller.destroy()
    this.#controllers = []
  }

  #destroyPublishedVideos(): void {
    for (const handle of this.#videoHandles.values()) {
      try {
        handle.destroy()
      } catch (error) {
        console.error('Slide video destroy failed', error)
      }
    }
    this.#videoHandles.clear()
  }

  #pausePublishedVideos(): void {
    for (const handle of this.#videoHandles.values()) {
      try {
        handle.pause()
      } catch (error) {
        console.error('Slide video pause failed', error)
      }
    }
  }

  #isPublishedVideoWrapVisible(nodeId: string): boolean {
    for (const record of this.#renderedLayers.values()) {
      if (record.item.layerItemId !== nodeId) continue
      if (!record.item.visible) return false
      try {
        if (!this.#root?.contains(record.wrap)) return false
      } catch {
        return false
      }
      return record.wrap.style.visibility !== 'hidden'
    }
    return false
  }

  #autoplayPublishedVideos(): void {
    if (this.#authoring || this.#staticCapture) return
    for (const handle of this.#videoHandles.values()) {
      if (!handle.autoplay) continue
      if (!this.#isPublishedVideoWrapVisible(handle.nodeId)) continue
      try {
        handle.execute({ type: 'video.play', nodeId: handle.nodeId })
      } catch (error) {
        console.error('Slide video autoplay failed', error)
      }
    }
  }

  #mountPublishedVideoHandle(wrap: HTMLElement, nodeId: string, input: PublishedVideoInput): void {
    if (this.#authoring || this.#staticCapture) return
    if (this.#videoHandles.has(nodeId)) return
    const video = wrap.querySelector('video')
    if (!video) return
    const handle = mountPublishedNativeVideo(video, input, { audio: this.#audio })
    if (!handle) return
    this.#videoHandles.set(nodeId, handle)
    handle.subscribe('started', () => {
      this.#slideInteractionPort?.dispatchVideoEvent(nodeId, 'started')
    })
    handle.subscribe('paused', () => {
      this.#slideInteractionPort?.dispatchVideoEvent(nodeId, 'paused')
    })
    handle.subscribe('ended', () => {
      this.#slideInteractionPort?.dispatchVideoEvent(nodeId, 'ended')
    })
    handle.subscribe('time', (seconds) => {
      this.#slideInteractionPort?.dispatchVideoEvent(nodeId, 'time', seconds)
    })
  }

  #controllerSessionFor(input: PublishedTeacherControllerInput): TeacherControllerDomSession {
    return this.#teacherControllerSession.get({
      controllerId: input.id,
      surfaceSessionId: this.id,
      defaultCollapsed: input.collapsible && input.defaultCollapsed,
    })
  }

  #mountTeacherController(wrap: HTMLElement, input: PublishedNativeRenderInput): void {
    if (input.type !== 'teacher-controller' || this.#payload.playback.controls === 'none') return
    const root = this.#root
    if (!root) return
    const session = this.#controllerSessionFor(input)
    wrap.style.left = `${input.x + session.offset.dx}px`
    wrap.style.top = `${input.y + session.offset.dy}px`
    const node = teacherControllerDomNode(
      { x: input.x, y: input.y, width: input.width, height: input.height },
      input.rotation,
      {
        title: input.title,
        compact: input.compact,
        showSceneProgress: input.showSceneProgress,
        collapsible: input.collapsible,
        buttons: structuredClone(input.buttons) as TeacherControllerNode['buttons'],
        style: structuredClone(input.style),
      },
    )
    const controller = new TeacherControllerDom({
      node,
      container: wrap,
      footprintElement: wrap,
      canvas: { width: 1280, height: 720 },
      getRenderedStageBounds: () => stageBoundsFromElement(root, { width: 1280, height: 720 }),
      scenes: this.#payload.locations.map((location) => ({
        id: location.id,
        name: location.label,
      })),
      getCurrentSceneId: () => this.#locationId,
      getStateLabel: () => null,
      getStatus: () => ({
        muted: this.#audio?.muted() ?? this.#muted,
        fullscreen: Boolean(root.ownerDocument.fullscreenElement),
      }),
      getSession: () => this.#controllerSessionFor(input),
      onSessionChange: (next) => {
        this.#teacherControllerSession.set({
          controllerId: input.id,
          surfaceSessionId: this.id,
          defaultCollapsed: input.collapsible && input.defaultCollapsed,
        }, next)
        wrap.style.left = `${input.x + next.offset.dx}px`
        wrap.style.top = `${input.y + next.offset.dy}px`
      },
      onAction: (action) => {
        void this.#handleControllerAction(action).catch((cause) => {
          const message = cause instanceof Error ? cause.message : String(cause)
          this.#services?.reportDiagnostic?.({
            surfaceId: this.id,
            phase: 'execute',
            severity: 'error',
            message: `教师控制器动作“${action.type}”执行失败：${message}`,
            cause,
          })
        })
      },
      getInteractive: () => this.#active && !this.#authoring && !this.#staticCapture,
    })
    this.#controllers.push(controller)
  }

  async #handleControllerAction(action: TeacherControllerAction): Promise<void> {
    if (this.#authoring) return
    if (this.#executeTeacherControllerAction) {
      const handled = await this.#executeTeacherControllerAction(action)
      if (handled !== false) {
        for (const controller of this.#controllers) controller.refreshStatus()
        return
      }
    }
    if (action.type === 'audio.toggle-mute') {
      if (this.#audio) this.#audio.toggleMuted()
      else this.#muted = !this.#muted
      for (const controller of this.#controllers) controller.refreshStatus()
      return
    }
    if (action.type === 'player.fullscreen.toggle') {
      const root = this.#root
      const dom = root?.ownerDocument
      if (!dom) return
      if (dom.fullscreenElement) await dom.exitFullscreen?.()
      else await root?.requestFullscreen?.()
      for (const controller of this.#controllers) controller.refreshStatus()
      return
    }
    const locations = this.#payload.locations
    const index = locations.findIndex((location) => location.id === this.#locationId)
    if (action.type === 'scene.next' && index >= 0 && index < locations.length - 1) {
      await this.#navigateTo(locations[index + 1]!)
      return
    }
    if (action.type === 'scene.previous' && index > 0) {
      await this.#navigateTo(locations[index - 1]!)
      return
    }
    if (action.type === 'course.restart') {
      this.#teacherControllerSession.resetCourse()
      const start = locations.find((location) => location.id === this.#payload.startLocationId)
        ?? locations[0]
      if (start?.surfaceId === this.id) await this.setLocationId(start.id)
      else if (start) await this.#navigateTo(start)
      else this.#render()
      return
    }
    if (action.type === 'scene.replay') {
      if (this.#replayScene) await this.#replayScene()
      else {
        const current = locations[index]
          ?? locations.find((location) => location.id === this.#locationId)
        if (current) await this.#navigateTo(current)
      }
      return
    }
    if (action.type === 'scene.go') {
      const target = locations.find((location) => (
        location.id === action.sceneId
        || (location.kind === 'slide-scene' && location.sceneId === action.sceneId)
      ))
      if (target) await this.#navigateTo(target)
    }
  }

  async #navigateTo(location: CourseLocation): Promise<void> {
    await this.#services?.navigate(buildMixedDeepLink({
      locationId: location.id,
      surfaceId: location.surfaceId,
    }))
  }

  #publishedPresentationApi(
    scene: PublishedSlideScene,
    actions: Readonly<RuntimeHostActions> | undefined = this.#runtimeActions,
  ): RuntimePresentationApi {
    return {
      current: () => this.#presentationStateId ?? null,
      states: () => Object.freeze((scene.presentation?.states ?? []).map((state) => (
        Object.freeze({ id: state.id, name: state.name })
      ))),
      setState: (stateId) => (
        actions?.goToScene(scene.id, stateId) ?? false
      ),
      transitionTo: (stateId) => (
        actions?.goToScene(scene.id, stateId) ?? false
      ),
    }
  }

  #registerInteractionNode(
    wrap: HTMLElement,
    item: PublishedLayerItem,
    source: PublishedInteractionNodeSource,
    applicable = true,
  ): void {
    if (this.#interactionNodes.has(item.layerItemId)) return
    const authoredPointerEvents = wrap.style.pointerEvents || 'none'
    let handle: PublishedInteractionNodeHandle
    handle = {
      nodeId: item.layerItemId,
      source,
      ownership: publishedInteractionOwnership(item),
      ...(source === 'global'
        ? { visibilityState: this.#globalInteractionVisibilityState }
        : {}),
      resolveElement: () => wrap,
      isInteractionAvailable: () => (
        this.#root?.contains(wrap) === true
        && this.#interactionNodes.get(item.layerItemId) === handle
      ),
      canBindClick: () => canBindPublishedNativeClick(item),
      canRunMotion: () => true,
      authoredVisible: () => item.visible && (
        this.#authoring
          ? source !== 'global' || applicable || this.#authoring.scope === 'global'
          : item.playbackInitialVisibility !== 'hidden'
      ),
      applyInteractionState: (state: PublishedInteractionNodeState) => {
        const visible = state.visible
        if (!visible && item.kind === 'native' && item.content.nativeType === 'video') {
          try {
            this.#videoHandles.get(item.layerItemId)?.pause()
          } catch {
            // Visibility propagation must never break playback teardown.
          }
        }
        wrap.dataset.interactionVisibility = visible ? 'visible' : 'hidden'
        wrap.style.visibility = visible ? 'visible' : 'hidden'
        if (source === 'global' && isPublishedGlobalCanvasRuntimePointerItem(item)) {
          setPublishedGlobalCanvasRuntimeInteractionVisibility(wrap, item, visible)
        } else {
          wrap.style.pointerEvents = visible
            ? state.clickBound ? 'auto' : authoredPointerEvents
            : 'none'
        }
        if (visible) wrap.removeAttribute('aria-hidden')
        else wrap.setAttribute('aria-hidden', 'true')
      },
      authoredMotionStyle: () => ({
        opacity: String(item.opacity),
        transform: `rotate(${item.rotation}deg)`,
      }),
    }
    this.#interactionNodes.set(item.layerItemId, handle)
  }

  #render(): void {
    const root = this.#root
    if (!root) return
    if (this.#authoring) this.#authoringGeneration += 1
    this.#carrierEffects = this.#carrierSideEffects.beginGeneration()
    const carrierEffects = this.#carrierEffects
    const authoringRuntimeGeneration = ++this.#authoringRuntimeGeneration
    this.#authoringRuntimeTargets.clear()
    this.#pendingRuntimeActivation = null
    this.#cancelAllAuthoringMotions()
    this.#interactionPort?.refreshNodes([], ++this.#interactionGeneration)
    this.#interactionNodes.clear()
    this.#renderedLayers.clear()
    this.#destroyPublishedVideos()
    this.#destroyRuntimes()
    this.#destroyComponents()
    this.#destroyControllers()
    const surface = findSlideSurface(this.#payload, this.id)
    const location = resolveSlideLocation(this.#payload, this.id, this.#locationId)
    const scene = sceneOf(surface, location)
    const composition = composePublishedSlideLocation({
      payload: this.#payload,
      locationId: location.id,
      stateId: this.#presentationStateId ?? null,
    })
    const plan = publishedSlideRenderPlanFromComposition(composition)
    const backgroundColor = plan.background!.color
    const backgroundAssetId = plan.background!.assetId
    const backgroundAssetUrl = backgroundAssetId
      ? this.#resolveAsset(backgroundAssetId)
      : undefined
    root.dataset.locationId = location.id
    root.dataset.sceneId = scene.id
    if (this.#presentationStateId) root.dataset.presentationStateId = this.#presentationStateId
    else delete root.dataset.presentationStateId
    root.style.backgroundColor = backgroundColor
    root.style.backgroundImage = backgroundAssetUrl
      ? `url(${JSON.stringify(backgroundAssetUrl)})`
      : 'none'
    root.style.backgroundPosition = 'center'
    root.style.backgroundRepeat = 'no-repeat'
    root.style.backgroundSize = 'cover'
    root.replaceChildren()
    const stage = root.ownerDocument.createElement('div')
    stage.dataset.slideSceneStage = 'true'
    stage.style.position = 'absolute'
    stage.style.inset = '0'
    root.appendChild(stage)
    const mountController = (wrap: HTMLElement, input: PublishedTeacherControllerInput) => {
      this.#mountTeacherController(wrap, input)
    }
    if (this.#authoring) this.#publishAuthoringRuntimeTargets(scene.id)
    for (const entry of plan.layers) {
      const source = entry.source
      const authoringSnapshotNode = this.#authoring !== null
        && (source === this.#localAuthoringSource() || source === 'global')
        && (entry.item.kind === 'native' || entry.item.kind === 'component')
      const localCarrierAuthoring = this.#authoring !== null
        && source === this.#localAuthoringSource()
      const authoringRuntime = this.#authoring !== null
        && entry.item.kind === 'runtime'
        && (
          source === this.#localAuthoringSource()
          || (
            source === 'global'
            && (entry.applicable || this.#authoring.scope === 'global')
          )
        )
      if (!entry.mounted && !authoringSnapshotNode && !authoringRuntime) continue

      const effectivelyVisible = entry.item.visible && (
        entry.applicable
        || (
          this.#authoring !== null
          && source === 'global'
          && this.#authoring.scope === 'global'
        )
      )
      const renderedItem: PublishedLayerItem = effectivelyVisible === entry.item.visible
        ? entry.item
        : { ...entry.item, visible: effectivelyVisible }
      let record: SlideRenderedLayerRecord | null = null
      let mountedComponentHandle: PublishedComponentMountHandle | undefined
      let mountedRuntimeHandle:
        | PublishedSurfaceRuntimeMountHandle
        | PublishedCanvasRuntimeMountHandle
        | undefined
      let registeredComponentMount: ((
        item: Extract<PublishedLayerItem, { kind: 'component' }>,
      ) => PublishedComponentMountHandle) | undefined
      let remountComponent: ((
        item: Extract<PublishedLayerItem, { kind: 'component' }>,
      ) => Promise<void>) | undefined
      let remountRuntime: ((item: PublishedRuntimeLayerItem) => Promise<void>) | undefined
      let runtimeMountRevision = 0
      const rememberComponentHandle = (
        handle: PublishedComponentMountHandle,
        phaser = false,
      ): void => {
        mountedComponentHandle = handle
        if (record) record.componentHandle = handle
        this.#componentHandles.push(handle)
        if (phaser) this.#phaserComponentHandles.push(handle)
      }
      const rememberRuntimeHandle = (
        handle: PublishedSurfaceRuntimeMountHandle | PublishedCanvasRuntimeMountHandle,
      ): void => {
        mountedRuntimeHandle = handle
        if (record) record.runtimeHandle = handle
        this.#runtimeHandles.push(handle)
      }
      const wrap = appendLayerNode(
        root.ownerDocument,
        stage,
        renderedItem,
        source,
        this.#resolveAsset,
        mountController,
        {
          components: this.#authoring?.componentPackages ?? this.#payload.components,
          interactive: !this.#authoring && !this.#staticCapture,
          includeInvisible: this.#authoring !== null,
          staticCapture: this.#staticCapture,
          ...(carrierEffects.courseState
            ? { courseState: carrierEffects.courseState }
            : {}),
          ...(!this.#authoring && !this.#staticCapture && carrierEffects.componentActions
            ? { componentActions: carrierEffects.componentActions }
            : {}),
          ...(!this.#authoring && !this.#staticCapture
            ? { presentation: this.#publishedPresentationApi(scene, carrierEffects.runtimeActions) }
            : {}),
          ...(this.#authoring
            ? { authoring: this.#authoring, sceneId: scene.id }
            : {}),
          ...(entry.kind === 'native' ? { renderInput: entry.renderInput } : {}),
          mountComponent: (handle) => rememberComponentHandle(handle),
          registerComponentRemount: (mount) => {
            registeredComponentMount = mount
          },
          ...(!this.#active && !this.#authoring && !this.#staticCapture
            ? {
                deferComponentMount: (mount: () => void) => {
                  this.#deferredCarrierMounts.push(mount)
                },
              }
            : {}),
          mountPhaserComponent: (componentWrap, item) => {
            const componentScope: 'scene' | 'global' = source === 'global' ? 'global' : 'scene'
            const componentCarrierAuthoring = this.#authoring !== null
              && (source === 'global' || localCarrierAuthoring)
            const mountInstance = (
              nextItem: Extract<PublishedLayerItem, { kind: 'component' }> = item,
            ): PublishedComponentMountHandle => {
              const markFailure = () => {
                componentWrap.dataset.slideFallbackKind = 'component'
                componentWrap.dataset.slideComponentState = 'fallback'
                componentWrap.style.pointerEvents = 'none'
              }
              componentWrap.dataset.slideComponentState = this.#authoring
                ? 'authoring'
                : 'playback'
              const handle = mountPublishedSlidePhaserComponent(componentWrap, {
                container: componentWrap,
                componentId: nextItem.component.packageId,
                version: nextItem.component.version,
                instanceId: nextItem.layerItemId,
                width: nextItem.frame.width,
                height: nextItem.frame.height,
                props: nextItem.props,
                staticFallbackAssetId: nextItem.staticFallbackAssetId,
                components: this.#authoring?.componentPackages ?? this.#payload.components,
                resolveAsset: this.#resolveAsset,
                mode: this.#authoring
                  ? componentCarrierAuthoring ? 'edit' : 'capture'
                  : this.#staticCapture ? 'capture' : 'preview',
                scope: componentScope,
                ...(componentScope === 'scene' ? { sceneId: scene.id } : {}),
                interactive: !this.#authoring && !this.#staticCapture,
                events: this.#runtimeSession.events,
                courseState: this.#authoring?.courseState
                  ?? carrierEffects.courseState,
                ...(!this.#authoring && !this.#staticCapture && carrierEffects.componentActions
                  ? { actions: carrierEffects.componentActions }
                  : {}),
                ...(!this.#authoring && !this.#staticCapture
                  ? { presentation: this.#publishedPresentationApi(scene, carrierEffects.runtimeActions) }
                  : {}),
                ...(componentCarrierAuthoring && this.#authoring
                  ? {
                      authoring: {
                        node: publishedComponentAuthoringNode(nextItem),
                        onTargetsChanged: this.#authoring.onComponentTargetsChanged
                          ?? (() => undefined),
                      },
                    }
                  : {}),
                reportError: (phase, error) => {
                  markFailure()
                  this.#services?.reportDiagnostic?.({
                    surfaceId: this.id,
                    phase: 'mount',
                    severity: 'error',
                    message: `Component“${nextItem.layerItemId}”${phase}失败：${error.message}`,
                    cause: error,
                  })
                },
              })
              if (!handle.ok) markFailure()
              rememberComponentHandle(handle, true)
              return handle
            }
            registeredComponentMount = mountInstance
            if (!this.#active && !this.#authoring) {
              componentWrap.dataset.slideComponentState = 'deferred'
              this.#deferredCarrierMounts.push(() => {
                if (this.#root?.contains(componentWrap) === true) mountInstance()
              })
              return
            }
            mountInstance()
          },
          mountRuntime: (runtimeWrap, item) => {
            const mountInstance = (
              nextItem: PublishedRuntimeLayerItem,
            ): PublishedSurfaceRuntimeMountHandle | PublishedCanvasRuntimeMountHandle => {
              const mountRevision = ++runtimeMountRevision
              const isCurrentMount = () => (
                authoringRuntimeGeneration === this.#authoringRuntimeGeneration
                && mountRevision === runtimeMountRevision
              )
              const markFailure = () => {
                runtimeWrap.dataset.slideFallbackKind = 'runtime'
                runtimeWrap.dataset.slideRuntimeState = 'fallback'
                runtimeWrap.style.pointerEvents = 'none'
              }
              const mountOptions = {
                instanceId: nextItem.layerItemId,
                runtime: nextItem.runtime,
                width: nextItem.frame.width,
                height: nextItem.frame.height,
                visible: this.#active || this.#authoring !== null,
                resolveAsset: this.#resolveAsset,
                session: this.#runtimeSession,
                fallbackText: firstVisibleText(nextItem.runtime.content.values)
                  ?? nextItem.runtime.protocol,
                ...(carrierEffects.courseState
                  ? { courseState: carrierEffects.courseState }
                  : {}),
                ...(!this.#authoring && !this.#staticCapture && carrierEffects.runtimeActions
                  ? { actions: carrierEffects.runtimeActions }
                  : {}),
                ...(!this.#authoring && !this.#staticCapture
                  ? { presentation: this.#publishedPresentationApi(scene, carrierEffects.runtimeActions) }
                  : {}),
                ...(localCarrierAuthoring && this.#authoring
                  ? {
                      mode: 'authoring' as const,
                      courseState: this.#authoring.courseState
                        ?? carrierEffects.courseState,
                      authoring: {
                        scope: 'scene' as const,
                        sceneId: scene.id,
                        onTargetsChanged: (
                          update: Readonly<RuntimeAuthoringTargetUpdate>,
                        ) => {
                          if (!isCurrentMount()) return
                          const mapped = mapRuntimeAuthoringTargetsToLayer(update, nextItem)
                          if (mapped.targets.length > 0) {
                            this.#authoringRuntimeTargets.set(nextItem.layerItemId, {
                              order: nextItem.order,
                              update: mapped,
                            })
                          } else this.#authoringRuntimeTargets.delete(nextItem.layerItemId)
                          this.#publishAuthoringRuntimeTargets(scene.id)
                        },
                      },
                    }
                  : this.#authoring || this.#staticCapture
                    ? { mode: 'capture' as const }
                    : {}),
                reportError: (phase, error) => {
                  if (!isCurrentMount()) return
                  if (phase !== 'destroy') {
                    markFailure()
                    if (this.#authoringRuntimeTargets.delete(nextItem.layerItemId)) {
                      this.#publishAuthoringRuntimeTargets(scene.id)
                    }
                  }
                  this.#services?.reportDiagnostic?.({
                    surfaceId: this.id,
                    phase: 'mount',
                    severity: 'error',
                    message: `Runtime“${nextItem.layerItemId}”${phase}失败：${error.message}`,
                    cause: error,
                  })
                },
              } satisfies Parameters<typeof mountPublishedSurfaceRuntime>[1]
              runtimeWrap.dataset.slideRuntimeState = localCarrierAuthoring
                ? 'authoring'
                : this.#authoring || this.#staticCapture ? 'capture' : 'playback'
              const handle = isPublishedSlideCanvasRuntime(nextItem)
                ? mountPublishedCanvasRuntime(runtimeWrap, {
                    ...mountOptions,
                    sceneId: scene.id,
                  })
                : mountPublishedSurfaceRuntime(runtimeWrap, mountOptions)
              if (!handle.ok) markFailure()
              rememberRuntimeHandle(handle)
              return handle
            }
            remountRuntime = async (nextItem) => {
              runtimeMountRevision += 1
              if (this.#authoringRuntimeTargets.delete(nextItem.layerItemId)) {
                this.#publishAuthoringRuntimeTargets(scene.id)
              }
              const previous = mountedRuntimeHandle
              if (previous) {
                const index = this.#runtimeHandles.indexOf(previous)
                if (index >= 0) this.#runtimeHandles.splice(index, 1)
                previous.destroy()
              }
              mountedRuntimeHandle = undefined
              if (record) delete record.runtimeHandle
              runtimeWrap.replaceChildren()
              const handle = mountInstance(nextItem)
              await handle.waitForReady()
            }
            if (!this.#active && !this.#authoring && !this.#staticCapture) {
              runtimeWrap.dataset.slideRuntimeState = 'deferred'
              this.#deferredCarrierMounts.push(() => {
                if (this.#root?.contains(runtimeWrap) === true) mountInstance(item)
              })
            } else mountInstance(item)
          },
        },
      )
      if (!wrap) continue
      wrap.style.zIndex = String(entry.stackOrder)
      if (registeredComponentMount) {
        const mountComponent = registeredComponentMount
        remountComponent = async (nextItem) => {
          const previous = mountedComponentHandle
          if (previous) {
            const index = this.#componentHandles.indexOf(previous)
            if (index >= 0) this.#componentHandles.splice(index, 1)
            const phaserIndex = this.#phaserComponentHandles.indexOf(previous)
            if (phaserIndex >= 0) this.#phaserComponentHandles.splice(phaserIndex, 1)
            previous.destroy()
          }
          mountedComponentHandle = undefined
          if (record) delete record.componentHandle
          wrap.replaceChildren()
          const handle = mountComponent(nextItem)
          await handle.waitForReady()
        }
      }
      record = {
        item: entry.item,
        stackOrder: entry.stackOrder,
        source,
        applicable: entry.applicable,
        wrap,
        ...(mountedComponentHandle ? { componentHandle: mountedComponentHandle } : {}),
        ...(mountedRuntimeHandle ? { runtimeHandle: mountedRuntimeHandle } : {}),
        ...(remountComponent ? { remountComponent } : {}),
        ...(remountRuntime ? { remountRuntime } : {}),
      }
      this.#renderedLayers.set(renderedLayerKey(source, entry.item.layerItemId), record)
      if (entry.kind === 'native' && entry.renderInput.type === 'video') {
        this.#mountPublishedVideoHandle(wrap, entry.item.layerItemId, entry.renderInput)
      }
    }
    this.#refreshInteractionNodesFromRecords()
    if (this.#active) this.#autoplayPublishedVideos()
  }
}

function sceneOf(
  surface: PublishedSlideSurface,
  location: Extract<CourseLocation, { kind: 'slide-scene' }>,
): PublishedSlideScene {
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error(`找不到 Slide 场景：${location.sceneId}`)
  return scene
}
