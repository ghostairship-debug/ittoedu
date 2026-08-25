import { isGlobalLayerItemVisible } from '../../globalLayerVisibility'
import type {
  CourseLocation,
  LayerItemOverride,
  NativeElementContent,
} from '../../../shared/courseProjectTypes'
import { mergeCourseNativeData } from '../../../shared/courseProjectSchema'
import type { TeacherControllerAction } from '../../../shared/projectTypes'
import type {
  PublishedCourseV2Payload,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedRuntimeLayerItem,
  PublishedScopedLayerItem,
  PublishedSlidePresentationState,
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
  mountPublishedComponent,
  type PublishedComponentMountHandle,
} from '../publishedComponentMount'
import { paintPublishedNativeText } from '../publishedNativeText'
import { paintPublishedFormula } from '../publishedFormula'
import {
  createPublishedSurfaceRuntimeSession,
  mountPublishedSurfaceRuntime,
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

function clonePayload(payload: PublishedCourseV2Payload): PublishedCourseV2Payload {
  return structuredClone(payload)
}

function isScopedVisible(entry: PublishedScopedLayerItem, locationId: string): boolean {
  return isGlobalLayerItemVisible(
    { visibility: { mode: entry.visibility.mode, sceneIds: entry.visibility.locationIds } },
    locationId,
  )
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

function applyNativeTextStyle(
  wrap: HTMLElement,
  data: Extract<NativeElementContent, { nativeType: 'text' }>['data'],
): void {
  paintPublishedNativeText(wrap, data)
}

function applyVisibleTextFallback(wrap: HTMLElement, text: string): void {
  wrap.style.boxSizing = 'border-box'
  wrap.style.display = 'flex'
  wrap.style.alignItems = 'center'
  wrap.style.justifyContent = 'center'
  wrap.style.padding = '12px 16px'
  wrap.style.overflow = 'hidden'
  wrap.style.background = '#0f766e'
  wrap.style.color = '#ffffff'
  wrap.style.font = 'bold 22px "Microsoft YaHei", sans-serif'
  wrap.textContent = text
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeComponentProps(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key]
    result[key] = isPlainRecord(value) && isPlainRecord(previous)
      ? mergeComponentProps(previous, value)
      : structuredClone(value)
  }
  return result
}

function applyPublishedLayerOverride(
  source: PublishedLayerItem,
  override: LayerItemOverride | undefined,
): PublishedLayerItem {
  const item = structuredClone(source)
  if (!override) return item
  if (override.frame) item.frame = { ...item.frame, ...override.frame, mode: 'absolute' }
  if (override.order !== undefined) item.order = override.order
  if (override.visible !== undefined) item.visible = override.visible
  if (override.rotation !== undefined) item.rotation = override.rotation
  if (override.opacity !== undefined) item.opacity = override.opacity
  if (override.hitPolicy !== undefined) item.hitPolicy = override.hitPolicy
  if (override.playbackInitialVisibility !== undefined) {
    item.playbackInitialVisibility = override.playbackInitialVisibility
  }
  if (item.kind === 'native' && override.nativeData) {
    const content = item.content as typeof item.content & { data: Record<string, unknown> }
    content.data = mergeCourseNativeData(
      content.data,
      override.nativeData,
    ) as typeof content.data
  }
  if (item.kind === 'component' && override.componentProps) {
    item.props = mergeComponentProps(item.props, override.componentProps)
  }
  return item
}

function materializePublishedSceneItems(
  items: readonly PublishedLayerItem[],
  state: PublishedSlidePresentationState | undefined,
): PublishedLayerItem[] {
  const materialized = items.map((item) => (
    applyPublishedLayerOverride(item, state?.layerItemOverrides[item.layerItemId])
  ))
  if (!state?.layerItemOrder) return materialized

  const byId = new Map(materialized.map((item) => [item.layerItemId, item]))
  const seen = new Set<string>()
  const ordered: PublishedLayerItem[] = []
  for (const id of state.layerItemOrder) {
    const item = byId.get(id)
    if (!item || seen.has(id)) continue
    seen.add(id)
    ordered.push(item)
  }
  ordered.push(...materialized
    .filter((item) => !seen.has(item.layerItemId))
    .sort((left, right) => left.order - right.order
      || (left.layerItemId < right.layerItemId ? -1 : left.layerItemId > right.layerItemId ? 1 : 0)))
  const orderSlots = materialized.map((item) => item.order).sort((left, right) => left - right)
  ordered.forEach((item, index) => {
    item.order = orderSlots[index]!
  })
  return ordered
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
  mountTeacherController?: (wrap: HTMLElement, item: PublishedNativeLayerItem) => void,
  options?: {
    components?: PublishedCourseV2Payload['components']
    interactive?: boolean
    mountComponent?: (handle: PublishedComponentMountHandle) => void
    mountRuntime?: (wrap: HTMLElement, item: PublishedRuntimeLayerItem) => void
  },
): HTMLElement | null {
  if (!item.visible) return null
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
  wrap.style.pointerEvents = isPublishedInteractiveLayer(item)
    || item.kind === 'component'
    || (
      source === 'scene'
      && item.hitPolicy !== 'pass-through'
      && isPublishedSlidePlayableRuntime(item)
    )
    ? 'auto'
    : 'none'
  wrap.style.zIndex = String(item.order)
  if (item.playbackInitialVisibility === 'hidden') {
    wrap.style.visibility = 'hidden'
    wrap.style.pointerEvents = 'none'
    wrap.setAttribute('aria-hidden', 'true')
  }
  if (item.kind === 'native') wrap.dataset.nativeType = item.content.nativeType
  if (isPublishedTeacherController(item)) {
    mountTeacherController?.(wrap, item)
  } else if (item.kind === 'native' && item.content.nativeType === 'text') {
    applyNativeTextStyle(wrap, item.content.data)
  } else if (item.kind === 'native' && item.content.nativeType === 'video') {
    const url = resolveAsset(item.content.data.assetId)
    if (url) {
      const video = dom.createElement('video')
      video.controls = true
      video.src = url
      video.style.width = '100%'
      video.style.height = '100%'
      video.style.objectFit = 'contain'
      video.style.pointerEvents = 'auto'
      wrap.appendChild(video)
    }
  } else if (item.kind === 'native' && item.content.nativeType === 'formula') {
    wrap.style.boxSizing = 'border-box'
    wrap.style.overflow = 'hidden'
    paintPublishedFormula(wrap, {
      formulaId: item.content.data.formulaId,
      accessibleText: item.content.data.accessibleText,
      ast: item.content.data.ast,
      style: item.content.data.style,
      width: Math.max(1, item.frame.width),
      height: Math.max(1, item.frame.height),
    })
  } else if (item.kind === 'native' && item.content.nativeType === 'image') {
    const url = resolveAsset(item.content.data.assetId)
    if (url) {
      const image = dom.createElement('img')
      image.src = url
      image.alt = ''
      image.style.width = '100%'
      image.style.height = '100%'
      image.style.objectFit = 'contain'
      wrap.appendChild(image)
    }
  } else if (item.kind === 'component') {
    wrap.dataset.slideFallbackKind = 'component'
    const handle = mountPublishedComponent(wrap, {
      container: wrap,
      componentId: item.component.packageId,
      version: item.component.version,
      instanceId: item.layerItemId,
      width: item.frame.width,
      height: item.frame.height,
      props: item.props,
      staticFallbackAssetId: item.staticFallbackAssetId,
      components: options?.components,
      resolveAsset,
      interactive: options?.interactive ?? true,
    })
    options?.mountComponent?.(handle)
  } else if (item.kind === 'runtime') {
    wrap.dataset.slideRuntimeKind = item.runtime.protocol
    if (!item.runtime.enabled) {
      wrap.dataset.slideRuntimeState = 'disabled'
    } else if (source === 'scene' && isPublishedSlidePlayableRuntime(item) && options?.mountRuntime) {
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
        applyVisibleTextFallback(
          wrap,
          firstVisibleText(item.runtime.content.values) ?? item.runtime.protocol,
        )
      }
    }
  } else {
    wrap.dataset.slideFallbackKind = item.kind
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

/**
 * Minimal Published Course V2 Slide adapter. It is not PlayerApp and does not
 * project Flow/Spatial through buildStandaloneHtml.
 */
export class SlidePublishedAdapter implements SurfaceHost {
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
  readonly #deferTeacherControllerCourseReset: boolean
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
  #runtimeHandles: Array<
    PublishedSurfaceRuntimeMountHandle | PublishedCanvasRuntimeMountHandle
  > = []
  readonly #runtimeSession = createPublishedSurfaceRuntimeSession()
  #muted = false
  #interactionPort: PublishedDomInteractionSurfacePort | null = null
  #interactionGeneration = 0
  #interactionNodes = new Map<string, PublishedInteractionNodeHandle>()

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
      executeTeacherControllerAction?: (
        action: TeacherControllerAction,
      ) => boolean | void | Promise<boolean | void>
      deferTeacherControllerCourseReset?: boolean
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
    this.#executeTeacherControllerAction = options.executeTeacherControllerAction
    this.#deferTeacherControllerCourseReset = options.deferTeacherControllerCourseReset === true
    const location = resolveSlideLocation(this.#payload, this.id, this.#locationId)
    this.#presentationStateId = presentationStateIdForLocation(
      sceneOf(findSlideSurface(this.#payload, this.id), location),
      location,
    )
  }

  getLocationId(): string {
    return this.#locationId
  }

  /** Published navigator hint used to avoid resuming a stale scene before setLocationId(). */
  preparePublishedLocation(locationId: string, forced: boolean): void {
    resolveSlideLocation(this.#payload, this.id, locationId)
    this.#completedActiveResetLocationId = null
    this.#preparedRuntimeActivation = { locationId, forced }
  }

  getPublishedInteractionSurfacePort(): PublishedInteractionSurfacePort | null {
    return this.#interactionPort
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
    root.hidden = !this.#active
    context.container.appendChild(root)
    this.#root = root
    this.#services = context.services
    this.#interactionPort = new PublishedDomInteractionSurfacePort(root)
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
    if (wasInactive && this.#runtimeHandles.length > 0) {
      if (preparedActivation !== null) {
        this.#pendingRuntimeActivation = preparedActivation
      } else {
        for (const handle of this.#runtimeHandles) {
          handle.setVisible(true)
          handle.resume()
        }
      }
    }
    this.#restoreInteractionsIfActive()
  }

  async suspend(): Promise<void> {
    this.#invalidateInteractions()
    this.#active = false
    this.#preparedRuntimeActivation = null
    this.#pendingRuntimeActivation = null
    this.#completedActiveResetLocationId = null
    for (const handle of this.#runtimeHandles) {
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
    }
  }

  async capture(_request: SurfaceCaptureRequest): Promise<SurfaceCapture> {
    return {
      format: 'json',
      content: JSON.stringify({
        surfaceId: this.id,
        locationId: this.#locationId,
      }),
    }
  }

  async setLocationId(locationId: string): Promise<void> {
    const location = resolveSlideLocation(this.#payload, this.id, locationId)
    const scene = sceneOf(findSlideSurface(this.#payload, this.id), location)
    const completedResetLocationId = this.#completedActiveResetLocationId
    this.#completedActiveResetLocationId = null
    this.#preparedRuntimeActivation = null
    const presentationStateId = this.#preparedPresentationState?.locationId === locationId
      ? this.#preparedPresentationState.stateId
      : presentationStateIdForLocation(scene, location)
    this.#preparedPresentationState = null
    const sameLocation = locationId === this.#locationId
      && presentationStateId === this.#presentationStateId
    const pendingActivation = this.#pendingRuntimeActivation
    this.#pendingRuntimeActivation = null
    if (completedResetLocationId === locationId && sameLocation) return
    if (
      pendingActivation?.locationId === locationId
      && !pendingActivation.forced
      && sameLocation
    ) {
      for (const handle of this.#runtimeHandles) {
        handle.setVisible(true)
        handle.resume()
      }
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
    this.#invalidateInteractions()
    this.#interactionPort?.destroy()
    this.#interactionPort = null
    this.#interactionNodes.clear()
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

  #invalidateInteractions(): void {
    this.#onInteractionInvalidated?.()
    this.#interactionPort?.setActive(false)
  }

  #restoreInteractionsIfActive(): void {
    if (!this.#active || !this.#interactionPort || !this.#root) return
    this.#interactionPort.setActive(true)
    this.#onInteractionReady?.()
  }

  #destroyComponents(): void {
    for (const handle of this.#componentHandles) {
      try {
        handle.destroy()
      } catch (error) {
        console.error('Slide component destroy failed', error)
      }
    }
    this.#componentHandles = []
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

  #controllerSessionFor(item: PublishedLayerItem): TeacherControllerDomSession {
    const collapsed = isPublishedTeacherController(item)
      ? item.content.data.collapsible && item.content.data.defaultCollapsed
      : false
    return this.#teacherControllerSession.get({
      controllerId: item.layerItemId,
      surfaceSessionId: this.id,
      defaultCollapsed: collapsed,
    })
  }

  #mountTeacherController(wrap: HTMLElement, item: PublishedNativeLayerItem): void {
    if (!isPublishedTeacherController(item) || this.#payload.playback.controls === 'none') return
    const root = this.#root
    if (!root) return
    const session = this.#controllerSessionFor(item)
    wrap.style.left = `${item.frame.x + session.offset.dx}px`
    wrap.style.top = `${item.frame.y + session.offset.dy}px`
    const node = teacherControllerDomNode(item.frame, item.rotation, item.content.data)
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
        muted: this.#muted,
        fullscreen: Boolean(root.ownerDocument.fullscreenElement),
      }),
      getSession: () => this.#controllerSessionFor(item),
      onSessionChange: (next) => {
        this.#teacherControllerSession.set({
          controllerId: item.layerItemId,
          surfaceSessionId: this.id,
          defaultCollapsed: item.content.data.collapsible
            && item.content.data.defaultCollapsed,
        }, next)
        wrap.style.left = `${item.frame.x + next.offset.dx}px`
        wrap.style.top = `${item.frame.y + next.offset.dy}px`
      },
      onAction: (action) => {
        void this.#handleControllerAction(action)
      },
      getInteractive: () => this.#active,
    })
    this.#controllers.push(controller)
  }

  async #handleControllerAction(action: TeacherControllerAction): Promise<void> {
    if (this.#executeTeacherControllerAction) {
      const handled = await this.#executeTeacherControllerAction(action)
      if (handled !== false) {
        for (const controller of this.#controllers) controller.refreshStatus()
        return
      }
    }
    if (action.type === 'audio.toggle-mute') {
      this.#muted = !this.#muted
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
      const current = locations[index] ?? locations.find((location) => location.id === this.#locationId)
      if (current) await this.#navigateTo(current)
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

  #registerInteractionNode(
    wrap: HTMLElement,
    item: PublishedLayerItem,
    source: PublishedInteractionNodeSource,
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
      authoredVisible: () => item.playbackInitialVisibility !== 'hidden',
      applyInteractionState: (state: PublishedInteractionNodeState) => {
        const visible = state.visible
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
    this.#pendingRuntimeActivation = null
    this.#interactionPort?.refreshNodes([], ++this.#interactionGeneration)
    this.#interactionNodes.clear()
    this.#destroyRuntimes()
    this.#destroyComponents()
    this.#destroyControllers()
    const surface = findSlideSurface(this.#payload, this.id)
    const location = resolveSlideLocation(this.#payload, this.id, this.#locationId)
    const scene = sceneOf(surface, location)
    const presentationState = scene.presentation?.states.find(
      (state) => state.id === this.#presentationStateId,
    )
    const sceneItems = materializePublishedSceneItems(scene.layerItems, presentationState)
    const backgroundColor = presentationState?.backgroundColor ?? scene.backgroundColor
    const backgroundAssetId = presentationState?.backgroundAssetId !== undefined
      ? presentationState.backgroundAssetId
      : scene.backgroundAssetId
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
    const mountController = (wrap: HTMLElement, item: PublishedNativeLayerItem) => {
      this.#mountTeacherController(wrap, item)
    }
    const layerOptions = {
      components: this.#payload.components,
      interactive: this.#active,
      mountComponent: (handle: PublishedComponentMountHandle) => {
        this.#componentHandles.push(handle)
      },
      mountRuntime: (wrap: HTMLElement, item: PublishedRuntimeLayerItem) => {
        if (!this.#active) {
          wrap.dataset.slideRuntimeState = 'deferred'
          wrap.style.pointerEvents = 'none'
          return
        }
        const markFailure = () => {
          wrap.dataset.slideFallbackKind = 'runtime'
          wrap.dataset.slideRuntimeState = 'fallback'
          wrap.style.pointerEvents = 'none'
        }
        const mountOptions = {
          instanceId: item.layerItemId,
          runtime: item.runtime,
          width: item.frame.width,
          height: item.frame.height,
          visible: this.#active,
          resolveAsset: this.#resolveAsset,
          session: this.#runtimeSession,
          fallbackText: firstVisibleText(item.runtime.content.values)
            ?? item.runtime.protocol,
          reportError: (phase, error) => {
            markFailure()
            this.#services?.reportDiagnostic?.({
              surfaceId: this.id,
              phase: 'mount',
              severity: 'error',
              message: `Runtime“${item.layerItemId}”${phase}失败：${error.message}`,
              cause: error,
            })
          },
        } satisfies Parameters<typeof mountPublishedSurfaceRuntime>[1]
        const handle = isPublishedSlideCanvasRuntime(item)
          ? mountPublishedCanvasRuntime(wrap, {
              ...mountOptions,
              sceneId: scene.id,
            })
          : mountPublishedSurfaceRuntime(wrap, mountOptions)
        if (!handle.ok) markFailure()
        this.#runtimeHandles.push(handle)
      },
    }
    for (const item of sceneItems) {
      const wrap = appendLayerNode(
        root.ownerDocument,
        stage,
        item,
        'scene',
        this.#resolveAsset,
        mountController,
        layerOptions,
      )
      if (wrap) this.#registerInteractionNode(wrap, item, 'scene')
    }
    for (const entry of this.#payload.globalLayerItems) {
      if (!isScopedVisible(entry, location.id)) continue
      const wrap = appendLayerNode(
        root.ownerDocument,
        stage,
        entry.item,
        'global',
        this.#resolveAsset,
        mountController,
        layerOptions,
      )
      if (wrap) this.#registerInteractionNode(wrap, entry.item, 'global')
    }
    for (const entry of surface.surfaceLayerItems) {
      if (!isScopedVisible(entry, location.id)) continue
      const wrap = appendLayerNode(
        root.ownerDocument,
        stage,
        entry.item,
        'surface',
        this.#resolveAsset,
        mountController,
        layerOptions,
      )
      if (wrap) this.#registerInteractionNode(wrap, entry.item, 'surface')
    }
    this.#interactionPort?.refreshNodes(
      this.#interactionNodes.values(),
      ++this.#interactionGeneration,
    )
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
