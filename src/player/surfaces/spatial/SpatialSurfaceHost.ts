import type { SpatialPathDash } from '../../../shared/courseProjectTypes'
import { resolveCourseSurfaceBackgroundColor } from '../../../shared/courseProjectModel'
import type { TeacherControllerAction } from '../../../shared/projectTypes'
import type { ComponentHostActions } from '../../../shared/componentTypes'
import type {
  CourseStateStore as CourseStateStoreContract,
  RuntimeHostActions,
} from '../../../shared/runtimeTypes'
import type { TeacherControllerSceneInfo } from '../../../shared/teacherControllerLayout'
import type {
  PublishedCourseV2Payload,
  PublishedLayerItem,
  PublishedNativeLayerItem,
} from '../../../shared/publishedCourseTypes'
import {
  TeacherControllerDom,
  stageBoundsFromElement,
  teacherControllerDomNode,
  type TeacherControllerDomSession,
} from '../../teacherControllerDom'
import { TeacherControllerRuntimeSessionStore } from '../../teacherControllerRuntimeSession'
import {
  collectSpatialPlaybackEntries,
  isSpatialTeacherControllerItem,
  isSpatialViewportPlaybackItem,
  publishedCameraSnapshot,
  publishedSpatialInputFromCourse,
  publishedSpatialPaths,
  publishedSpatialRelations,
  spatialWorldGroupTransform,
  worldItemWithinRuntimeCamera,
  type PublishedSpatialRuntimeInput,
  type SpatialPlaybackEntry,
  type SpatialRuntimeCamera,
  type SpatialRuntimeViewport,
} from './spatialModel'
import {
  enterSpatialRuntimeLocation,
  leaveSpatialRuntimeLocation,
  openSpatialRuntimeSession,
  reopenSpatialRuntimeSession,
  selectSpatialRuntimePlaybackPath,
  setSpatialRuntimeCamera,
  spatialRuntimeAtEnd,
  spatialRuntimeAtStart,
  spatialRuntimeGoNext,
  spatialRuntimeGoPrevious,
  type OpenSpatialRuntimeSessionOptions,
  type SpatialRuntimeSession,
} from './spatialRuntimeSession'
import { attachSpatialPlaybackCameraGestures, SPATIAL_GESTURE_OWNER_ATTR } from './spatialPlaybackGestures'
import {
  mountPublishedComponent,
  type PublishedComponentMountHandle,
  type PublishedComponentPackageSource,
} from '../publishedComponentMount'
import { paintPublishedFormula } from '../publishedFormula'
import {
  PublishedDomInteractionSurfacePort,
  PublishedInteractionVisibilityState,
  type PublishedInteractionNodeHandle,
  type PublishedInteractionNodeOwnership,
  type PublishedInteractionNodeState,
} from '../../interactions/PublishedDomInteractionSurfacePort'
import type { PublishedInteractionSurfacePort } from '../../interactions/PublishedInteractionSurfacePort'
import {
  isPublishedGlobalCanvasRuntimePointerItem,
  setPublishedGlobalCanvasRuntimeInteractionVisibility,
} from '../runtime/publishedGlobalCanvasRuntimePointer'
import {
  PublishedCarrierSideEffectGate,
  type PublishedCarrierSideEffects,
} from '../publishedCourseState'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFAULT_PATH_COLOR = '#64748b'
const DEFAULT_PATH_WIDTH = 2

export interface SpatialAudioChangeSource {
  on<T = unknown>(eventName: string, listener: (payload: T) => void | Promise<void>): () => void
}

export interface SpatialCourseProgressSource {
  getLocations(): TeacherControllerSceneInfo[]
  getCurrentLocationId(): string | null
  getStateLabel?(): string | null
}

export function createSpatialPlayerSessionSources(input: {
  audioChangeSource?: SpatialAudioChangeSource
  courseProgressSource?: SpatialCourseProgressSource
}): Pick<SpatialSurfaceHostOptions, 'audioChangeSource' | 'courseProgressSource'> {
  return {
    audioChangeSource: input.audioChangeSource,
    courseProgressSource: input.courseProgressSource,
  }
}

export interface SpatialSurfaceHostOptions {
  playbackControls?: 'canvas' | 'none'
  initialMuted?: boolean
  playbackPathId?: string | null
  locationId?: string
  audioChangeSource?: SpatialAudioChangeSource
  courseProgressSource?: SpatialCourseProgressSource
  teacherControllerSession?: TeacherControllerRuntimeSessionStore
  deferTeacherControllerCourseReset?: boolean
  resolveAsset?: (assetId: string) => string | undefined
  components?: Record<string, PublishedComponentPackageSource>
  /** Published playback session state shared across every surface host. */
  courseState?: CourseStateStoreContract
  /** Playback-only actions retained for the Spatial Runtime host boundary. */
  runtimeActions?: Readonly<RuntimeHostActions>
  /** Playback-only navigation actions exposed to Component API 4 instances. */
  componentActions?: Readonly<ComponentHostActions>
  executeTeacherControllerAction?: (
    action: TeacherControllerAction,
    item: PublishedNativeLayerItem,
  ) => boolean | void | Promise<boolean | void>
  /** Published-session only; shared by global LayerItem handles across surfaces. */
  globalInteractionVisibilityState?: PublishedInteractionVisibilityState
  /** Published-session generation hook fired before interaction records are invalidated. */
  onInteractionInvalidated?: () => void
  /** Published-session generation hook fired after an active interaction record set is ready. */
  onInteractionReady?: () => void
  reportActionError?: (action: TeacherControllerAction, error: Error) => void
}

type TeacherControllerNativeItem = PublishedNativeLayerItem & {
  content: Extract<PublishedNativeLayerItem['content'], { nativeType: 'teacher-controller' }>
}

interface SpatialHostRecord {
  entry: SpatialPlaybackEntry
  wrapper: HTMLElement | SVGGElement
  controllerDom: TeacherControllerDom | null
  componentHandle: PublishedComponentMountHandle | null
  componentEffects: PublishedCarrierSideEffects | null
  deferredComponentMount: (() => void) | null
}

function safeColor(value: string | undefined, fallback: string): string {
  return value && /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i.test(value)
    ? value
    : fallback
}

function nativeLabel(item: PublishedLayerItem): string {
  if (item.kind === 'native' && item.content.nativeType === 'text') return item.content.data.text
  if (item.kind === 'native' && item.content.nativeType === 'formula') {
    return item.content.data.accessibleText
  }
  if (item.kind === 'native' && item.content.nativeType === 'teacher-controller') {
    return item.content.data.title
  }
  if (item.kind === 'component') return item.component.packageId
  if (item.kind === 'runtime') return 'runtime'
  return item.kind
}

function pathDashArray(dash: SpatialPathDash | undefined): string | undefined {
  if (dash === 'dashed') return '8 6'
  if (dash === 'dotted') return '2 5'
  return undefined
}

function layerCenter(item: PublishedLayerItem): { x: number; y: number } {
  return {
    x: item.frame.x + item.frame.width / 2,
    y: item.frame.y + item.frame.height / 2,
  }
}

function createWorldItem(
  dom: Document,
  item: PublishedLayerItem,
  resolveAsset: (assetId: string) => string | undefined,
  options?: {
    components?: Record<string, PublishedComponentPackageSource>
    interactive?: boolean
    courseState?: CourseStateStoreContract
    componentActions?: Readonly<ComponentHostActions>
    onMountComponent?: (handle: PublishedComponentMountHandle) => void
    deferComponentMount?: (mount: () => void) => void
  },
): SVGGElement {
  const group = dom.createElementNS(SVG_NS, 'g')
  const { frame } = item
  if (item.kind === 'native' && item.content.nativeType === 'image') {
    const url = resolveAsset(item.content.data.assetId)
    if (url) {
      const image = dom.createElementNS(SVG_NS, 'image')
      image.setAttribute('href', url)
      image.setAttribute('x', String(frame.x))
      image.setAttribute('y', String(frame.y))
      image.setAttribute('width', String(frame.width))
      image.setAttribute('height', String(frame.height))
      image.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      group.appendChild(image)
    }
  } else if (item.kind === 'native' && item.content.nativeType === 'video') {
    // World video is an HTML layer beside the SVG, not a transformed foreignObject.
  } else if (item.kind === 'native' && item.content.nativeType === 'text') {
    const text = dom.createElementNS(SVG_NS, 'text')
    text.textContent = item.content.data.text
    text.setAttribute('x', String(frame.x + Math.max(0, item.content.data.style.padding)))
    text.setAttribute('y', String(frame.y + Math.max(item.content.data.style.fontSize, 16)))
    text.setAttribute('fill', safeColor(item.content.data.style.color, '#172033'))
    text.setAttribute('font-size', String(item.content.data.style.fontSize))
    text.setAttribute('font-family', item.content.data.style.fontFamily)
    group.appendChild(text)
  } else if (item.kind === 'native' && item.content.nativeType === 'shape') {
    const rect = dom.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(frame.x))
    rect.setAttribute('y', String(frame.y))
    rect.setAttribute('width', String(frame.width))
    rect.setAttribute('height', String(frame.height))
    rect.setAttribute('fill', safeColor(item.content.data.style.fillColor, '#e2e8f0'))
    rect.setAttribute('stroke', safeColor(item.content.data.style.borderColor, '#64748b'))
    group.appendChild(rect)
  } else if (item.kind === 'native' && item.content.nativeType === 'formula') {
    const foreign = dom.createElementNS(SVG_NS, 'foreignObject')
    foreign.setAttribute('x', String(frame.x))
    foreign.setAttribute('y', String(frame.y))
    foreign.setAttribute('width', String(frame.width))
    foreign.setAttribute('height', String(frame.height))
    const holder = dom.createElement('div')
    holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    holder.style.width = '100%'
    holder.style.height = '100%'
    holder.style.overflow = 'hidden'
    paintPublishedFormula(holder, {
      formulaId: item.content.data.formulaId,
      accessibleText: item.content.data.accessibleText,
      ast: item.content.data.ast,
      style: item.content.data.style,
      width: Math.max(1, frame.width),
      height: Math.max(1, frame.height),
    })
    foreign.appendChild(holder)
    group.appendChild(foreign)
  } else if (item.kind === 'component') {
    const foreign = dom.createElementNS(SVG_NS, 'foreignObject')
    foreign.setAttribute('x', String(frame.x))
    foreign.setAttribute('y', String(frame.y))
    foreign.setAttribute('width', String(frame.width))
    foreign.setAttribute('height', String(frame.height))
    const holder = dom.createElement('div')
    holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    holder.style.width = '100%'
    holder.style.height = '100%'
    holder.style.position = 'relative'
    holder.style.pointerEvents = 'auto'
    holder.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, 'component')
    foreign.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, 'component')
    foreign.appendChild(holder)
    group.appendChild(foreign)
    group.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, 'component')
    const mountInstance = () => {
      const handle = mountPublishedComponent(holder, {
        container: holder,
        componentId: item.component.packageId,
        version: item.component.version,
        instanceId: item.layerItemId,
        width: frame.width,
        height: frame.height,
        props: item.props,
        staticFallbackAssetId: item.staticFallbackAssetId,
        components: options?.components,
        resolveAsset,
        interactive: options?.interactive ?? true,
        ...(options?.courseState ? { courseState: options.courseState } : {}),
        ...(options?.componentActions ? { actions: options.componentActions } : {}),
      })
      options?.onMountComponent?.(handle)
    }
    if (options?.deferComponentMount) options.deferComponentMount(mountInstance)
    else mountInstance()
  } else {
    if (item.kind === 'runtime') {
      group.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, 'runtime')
    }
    const rect = dom.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(frame.x))
    rect.setAttribute('y', String(frame.y))
    rect.setAttribute('width', String(frame.width))
    rect.setAttribute('height', String(frame.height))
    rect.setAttribute('fill', '#f8fafc')
    rect.setAttribute('stroke', '#64748b')
    group.appendChild(rect)
    const text = dom.createElementNS(SVG_NS, 'text')
    text.textContent = nativeLabel(item)
    text.setAttribute('x', String(frame.x + frame.width / 2))
    text.setAttribute('y', String(frame.y + frame.height / 2))
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('fill', '#172033')
    group.appendChild(text)
  }
  group.setAttribute('opacity', String(item.opacity))
  if (item.rotation !== 0) {
    group.setAttribute(
      'transform',
      `rotate(${item.rotation} ${frame.x + frame.width / 2} ${frame.y + frame.height / 2})`,
    )
  }
  return group
}

function spatialWorldHtmlTransform(camera: SpatialRuntimeCamera): string {
  return `translate(${camera.viewportWidth / 2}px, ${camera.viewportHeight / 2}px) scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`
}

function createWorldVideoHtml(
  dom: Document,
  item: PublishedLayerItem,
  url: string | undefined,
): HTMLElement {
  const wrapper = dom.createElement('div')
  wrapper.className = 'spatial-world-html-item'
  wrapper.dataset.spatialLayerRecord = 'true'
  wrapper.dataset.layerItemId = item.layerItemId
  wrapper.dataset.layerKind = item.kind
  wrapper.dataset.layerSource = 'world'
  wrapper.dataset.coordinateSpace = 'world'
  wrapper.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, 'media')
  Object.assign(wrapper.style, {
    position: 'absolute',
    left: `${item.frame.x}px`,
    top: `${item.frame.y}px`,
    width: `${item.frame.width}px`,
    height: `${item.frame.height}px`,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    opacity: String(item.opacity),
    transform: item.rotation === 0 ? '' : `rotate(${item.rotation}deg)`,
    transformOrigin: 'center center',
    zIndex: String(item.order),
  })
  if (url) {
    const video = dom.createElement('video')
    video.controls = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    video.setAttribute('playsinline', '')
    video.style.width = '100%'
    video.style.height = '100%'
    video.style.objectFit = 'contain'
    video.style.display = 'block'
    video.style.pointerEvents = 'auto'
    wrapper.appendChild(video)
  }
  return wrapper
}

function isHtmlWorldWrapper(wrapper: HTMLElement | SVGGElement): wrapper is HTMLElement {
  return !(wrapper instanceof SVGElement)
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

function spatialGestureOwner(item: PublishedLayerItem): string | null {
  const ownership = publishedInteractionOwnership(item)
  return ownership === 'native' ? null : ownership
}

function createViewportHud(
  dom: Document,
  item: PublishedLayerItem,
  options?: {
    components?: Record<string, PublishedComponentPackageSource>
    resolveAsset?: (assetId: string) => string | undefined
    interactive?: boolean
    courseState?: CourseStateStoreContract
    componentActions?: Readonly<ComponentHostActions>
    onMountComponent?: (handle: PublishedComponentMountHandle) => void
    deferComponentMount?: (mount: () => void) => void
  },
): HTMLElement {
  const root = dom.createElement('div')
  root.className = 'spatial-viewport-hud'
  Object.assign(root.style, {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    pointerEvents: 'auto',
  })
  if (item.kind === 'component') {
    const mountInstance = () => {
      const handle = mountPublishedComponent(root, {
        container: root,
        componentId: item.component.packageId,
        version: item.component.version,
        instanceId: item.layerItemId,
        width: item.frame.width,
        height: item.frame.height,
        props: item.props,
        staticFallbackAssetId: item.staticFallbackAssetId,
        components: options?.components,
        resolveAsset: options?.resolveAsset,
        interactive: options?.interactive ?? true,
        ...(options?.courseState ? { courseState: options.courseState } : {}),
        ...(options?.componentActions ? { actions: options.componentActions } : {}),
      })
      options?.onMountComponent?.(handle)
    }
    if (options?.deferComponentMount) options.deferComponentMount(mountInstance)
    else mountInstance()
    root.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, 'component')
    return root
  }
  if (item.kind === 'native' && item.content.nativeType === 'formula') {
    Object.assign(root.style, {
      background: 'transparent',
      border: '0',
      padding: '0',
      overflow: 'hidden',
    })
    paintPublishedFormula(root, {
      formulaId: item.content.data.formulaId,
      accessibleText: item.content.data.accessibleText,
      ast: item.content.data.ast,
      style: item.content.data.style,
      width: Math.max(1, item.frame.width),
      height: Math.max(1, item.frame.height),
    })
    return root
  }
  Object.assign(root.style, {
    color: '#172033',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    padding: '8px',
  })
  root.textContent = nativeLabel(item)
  return root
}

/**
 * Independent Spatial Player host. Reads Published Course V2 world/camera/path/relation
 * fields. Runtime camera is session-only and never writes the published document:
 * free pan/zoom plus authored camera-frame / playback-path tours. Interactive
 * runtime, component, media and teacher-controller targets occupy their gestures.
 * Global HUD, teacher controller, audio chrome and course UI stay on the viewport.
 */
export class SpatialSurfaceHost {
  readonly kind = 'spatial-2d' as const
  readonly id: string
  #session: SpatialRuntimeSession
  #options: SpatialSurfaceHostOptions
  #components: Record<string, PublishedComponentPackageSource> | undefined
  #root: HTMLElement | null = null
  #svg: SVGSVGElement | null = null
  #world: SVGGElement | null = null
  #worldHtml: HTMLElement | null = null
  #screenLayer: HTMLElement | null = null
  #records = new Map<string, SpatialHostRecord>()
  readonly #teacherControllerSession: TeacherControllerRuntimeSessionStore
  #gestureDisposer: (() => void) | null = null
  #muted: boolean
  #audioDisposer: (() => void) | null = null
  #destroyed = false
  #publishedAssets: PublishedCourseV2Payload['assets'] | undefined
  readonly #globalInteractionVisibilityState: PublishedInteractionVisibilityState
  #interactionPort: PublishedDomInteractionSurfacePort | null = null
  #interactionGeneration = 0
  #interactionNodes = new Map<string, PublishedInteractionNodeHandle>()
  #active = false
  readonly #carrierSideEffects: PublishedCarrierSideEffectGate
  #preparedRuntimeActivation: { locationId: string; forced: boolean } | null = null
  #pendingRuntimeActivation: { locationId: string; forced: boolean } | null = null

  static fromPublishedCourse(
    course: PublishedCourseV2Payload,
    viewport: SpatialRuntimeViewport,
    options: SpatialSurfaceHostOptions & OpenSpatialRuntimeSessionOptions = {},
  ): SpatialSurfaceHost {
    const host = new SpatialSurfaceHost(
      publishedSpatialInputFromCourse(course, {
        surfaceId: options.surfaceId,
        playbackPathId: options.playbackPathId ?? null,
      }),
      viewport,
      {
        ...options,
        components: course.components,
        resolveAsset: options.resolveAsset ?? ((assetId) => course.assets[assetId]?.url),
      },
    )
    host.#publishedAssets = course.assets
    return host
  }

  constructor(
    source: PublishedCourseV2Payload | PublishedSpatialRuntimeInput,
    viewport: SpatialRuntimeViewport,
    options: SpatialSurfaceHostOptions & OpenSpatialRuntimeSessionOptions = {},
  ) {
    this.#options = options
    this.#teacherControllerSession = options.teacherControllerSession
      ?? new TeacherControllerRuntimeSessionStore()
    this.#components = ('components' in source && source.components
      ? source.components as Record<string, PublishedComponentPackageSource>
      : undefined) ?? options.components
    if ('assets' in source && source.assets) {
      this.#publishedAssets = source.assets
    }
    this.#session = openSpatialRuntimeSession(source, viewport, {
      surfaceId: options.surfaceId,
      playbackPathId: options.playbackPathId ?? (
        'playbackPathId' in source ? source.playbackPathId : null
      ),
      locationId: options.locationId,
    })
    this.id = this.#session.input.surface.id
    this.#muted = options.initialMuted ?? false
    this.#globalInteractionVisibilityState = options.globalInteractionVisibilityState
      ?? new PublishedInteractionVisibilityState()
    this.#carrierSideEffects = new PublishedCarrierSideEffectGate({
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
    })
  }

  get camera(): SpatialRuntimeCamera | null {
    return this.#session.camera ? { ...this.#session.camera } : null
  }

  get locationId(): string {
    return this.#session.locationId
  }

  get playbackPathId(): string | null {
    return this.#session.playbackPathId
  }

  get atTourStart(): boolean {
    return spatialRuntimeAtStart(this.#session)
  }

  get atTourEnd(): boolean {
    return spatialRuntimeAtEnd(this.#session)
  }

  get rootElement(): HTMLElement | null {
    return this.#root
  }

  getPublishedInteractionSurfacePort(): PublishedInteractionSurfacePort | null {
    return this.#interactionPort
  }

  getPublishedGlobalRuntimeMountTarget(itemId: string): HTMLElement | null {
    const record = this.#records.get(itemId)
    if (
      record?.entry.source !== 'global'
      || record.wrapper.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    ) return null
    return record.wrapper as HTMLElement
  }

  /** Published navigator hint used to avoid resuming a stale Spatial generation. */
  preparePublishedLocation(locationId: string, forced: boolean): void {
    // Resolve before the navigator releases the current surface so an invalid
    // target cannot mutate either host.
    enterSpatialRuntimeLocation(this.#session, locationId)
    this.#preparedRuntimeActivation = { locationId, forced }
  }

  resetTeacherControllerSession(scope: 'surface' | 'course'): void {
    if (scope === 'course') {
      if (!this.#options.deferTeacherControllerCourseReset) {
        this.#teacherControllerSession.resetCourse()
      }
    } else this.#teacherControllerSession.resetSurface(this.id)
  }

  publishedCameraSnapshot() {
    return publishedCameraSnapshot(this.#session.input.surface)
  }

  publishedPaths() {
    return publishedSpatialPaths(this.#session.input.surface)
  }

  publishedRelations() {
    return publishedSpatialRelations(this.#session.input.surface)
  }

  getRenderedStageBounds(): { width: number; height: number; left: number; top: number } {
    const camera = this.#session.camera
    const fallback = {
      width: camera?.viewportWidth ?? this.#session.viewport.width,
      height: camera?.viewportHeight ?? this.#session.viewport.height,
    }
    return stageBoundsFromElement(this.#root, fallback)
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.#destroyed) throw new Error('Cannot mount a destroyed Spatial surface')
    if (this.#root) throw new Error('Spatial surface is already mounted')
    const camera = this.#requireCamera()
    const dom = container.ownerDocument
    const root = dom.createElement('section')
    root.className = 'spatial-surface'
    root.dataset.surfaceId = this.id
    root.dataset.spatialViewportWidth = String(camera.viewportWidth)
    root.dataset.spatialViewportHeight = String(camera.viewportHeight)
    root.dataset.worldBoundsMode = this.#session.input.surface.world.bounds.mode
    root.tabIndex = 0
    root.hidden = !this.#active
    root.setAttribute('role', 'region')
    root.setAttribute('aria-label', `${this.#session.input.surface.title} 空间探索`)
    const bg = resolveCourseSurfaceBackgroundColor(this.#session.input.surface.backgroundColor)
    Object.assign(root.style, {
      position: 'relative',
      width: `${camera.viewportWidth}px`,
      height: `${camera.viewportHeight}px`,
      overflow: 'hidden',
      isolation: 'isolate',
      backgroundColor: bg,
      touchAction: 'none',
      overscrollBehavior: 'contain',
    })
    const svg = dom.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', String(camera.viewportWidth))
    svg.setAttribute('height', String(camera.viewportHeight))
    svg.setAttribute('viewBox', `0 0 ${camera.viewportWidth} ${camera.viewportHeight}`)
    svg.setAttribute('aria-label', this.#session.input.surface.title)
    svg.dataset.spatialWorldCanvas = 'true'
    svg.style.backgroundColor = bg
    const world = dom.createElementNS(SVG_NS, 'g')
    world.dataset.spatialWorld = 'true'
    world.dataset.coordinateSpace = 'world'
    svg.appendChild(world)
    root.appendChild(svg)
    const worldHtml = dom.createElement('div')
    worldHtml.className = 'spatial-world-html'
    worldHtml.setAttribute('data-testid', 'spatial-world-html')
    Object.assign(worldHtml.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'visible',
      pointerEvents: 'none',
      transformOrigin: '0 0',
    })
    root.appendChild(worldHtml)
    const screenLayer = dom.createElement('div')
    screenLayer.className = 'spatial-screen-layer'
    screenLayer.dataset.coordinateSpace = 'viewport'
    screenLayer.dataset.spatialChrome = 'viewport'
    Object.assign(screenLayer.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'visible',
      pointerEvents: 'none',
    })
    root.appendChild(screenLayer)
    container.appendChild(root)
    this.#root = root
    this.#svg = svg
    this.#world = world
    this.#worldHtml = worldHtml
    this.#screenLayer = screenLayer
    this.#interactionPort = new PublishedDomInteractionSurfacePort(root)
    this.#gestureDisposer = attachSpatialPlaybackCameraGestures({
      root,
      isActive: () => this.#active && this.#session.active && !this.#destroyed,
      getCamera: () => this.#session.camera,
      setCamera: (camera) => {
        void this.setRuntimeCamera(camera)
      },
    })
    this.#subscribeAudio()
    this.#renderWorldDecorations()
    this.#updateWorldTransform()
    this.#reconcileRecords()
  }

  async activate(): Promise<void> {
    const wasInactive = !this.#active
    const preparedActivation = this.#preparedRuntimeActivation
    this.#preparedRuntimeActivation = null
    this.#active = true
    if (this.#root) this.#root.hidden = false
    this.#pendingRuntimeActivation = null
    if (wasInactive && preparedActivation !== null) {
      // The navigator activates a surface before assigning its target
      // location. Keep the suspended generation inert until that assignment.
      this.#pendingRuntimeActivation = preparedActivation
      return
    }
    this.#carrierSideEffects.activate()
    if (!this.#session.active) {
      this.#session = reopenSpatialRuntimeSession(this.#session)
    }
    this.#updateWorldTransform()
    this.#reconcileRecords()
    this.#resumeComponentCarriers()
    this.#restoreInteractionsIfActive()
  }

  async suspend(): Promise<void> {
    this.#invalidateInteractions()
    this.#active = false
    this.#carrierSideEffects.suspend()
    this.#preparedRuntimeActivation = null
    this.#pendingRuntimeActivation = null
    this.#session = leaveSpatialRuntimeLocation(this.#session)
    for (const record of this.#records.values()) {
      record.componentHandle?.setVisible(false)
      record.componentHandle?.suspend()
    }
    if (this.#root) this.#root.hidden = true
  }

  async resume(): Promise<void> {
    return this.activate()
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return
    this.#invalidateInteractions()
    this.#active = false
    this.#carrierSideEffects.destroy()
    this.#preparedRuntimeActivation = null
    this.#pendingRuntimeActivation = null
    this.#interactionPort?.destroy()
    this.#interactionPort = null
    this.#interactionNodes.clear()
    this.#destroyed = true
    this.#gestureDisposer?.()
    this.#gestureDisposer = null
    this.#audioDisposer?.()
    this.#audioDisposer = null
    for (const record of this.#records.values()) {
      record.componentEffects?.retire()
      record.controllerDom?.destroy()
      record.componentHandle?.destroy()
    }
    this.#records.clear()
    this.#root?.remove()
    this.#root = null
    this.#svg = null
    this.#world = null
    this.#worldHtml = null
    this.#screenLayer = null
    this.#session = leaveSpatialRuntimeLocation(this.#session)
  }

  async goNext(): Promise<{ atBoundary: boolean }> {
    const previousLocationId = this.#session.locationId
    const result = spatialRuntimeGoNext(this.#session)
    if (result.session.locationId !== previousLocationId) {
      this.#commitLocationGeneration(result.session)
    } else {
      this.#session = result.session
      this.#updateWorldTransform()
      this.#reconcileWorldVisibility()
      this.#refreshControllers()
    }
    return { atBoundary: result.atBoundary }
  }

  async goPrevious(): Promise<{ atBoundary: boolean }> {
    const previousLocationId = this.#session.locationId
    const result = spatialRuntimeGoPrevious(this.#session)
    if (result.session.locationId !== previousLocationId) {
      this.#commitLocationGeneration(result.session)
    } else {
      this.#session = result.session
      this.#updateWorldTransform()
      this.#reconcileWorldVisibility()
      this.#refreshControllers()
    }
    return { atBoundary: result.atBoundary }
  }

  async setLocationId(locationId: string): Promise<void> {
    const preparedActivation = this.#preparedRuntimeActivation
    const pendingActivation = this.#pendingRuntimeActivation
    this.#preparedRuntimeActivation = null
    this.#pendingRuntimeActivation = null
    const activation = pendingActivation?.locationId === locationId
      ? pendingActivation
      : preparedActivation?.locationId === locationId
        ? preparedActivation
        : null
    const nextSession = enterSpatialRuntimeLocation(this.#session, locationId)
    if (pendingActivation !== null) this.#carrierSideEffects.activate()
    this.#commitLocationGeneration(
      nextSession,
      activation?.forced === true,
      pendingActivation !== null,
    )
  }

  async setPlaybackPath(playbackPathId: string | null): Promise<void> {
    this.#session = selectSpatialRuntimePlaybackPath(this.#session, playbackPathId)
    this.#updateWorldTransform()
    this.#reconcileWorldVisibility()
    this.#refreshControllers()
  }

  async setRuntimeCamera(camera: SpatialRuntimeCamera): Promise<void> {
    this.#session = setSpatialRuntimeCamera(this.#session, camera)
    this.#updateWorldTransform()
    this.#reconcileWorldVisibility()
  }

  #invalidateInteractions(): void {
    this.#options.onInteractionInvalidated?.()
    this.#interactionPort?.setActive(false)
  }

  #restoreInteractionsIfActive(): void {
    if (!this.#active || !this.#interactionPort || !this.#root) return
    this.#interactionPort.setActive(true)
    this.#options.onInteractionReady?.()
  }

  #resumeComponentCarriers(): void {
    for (const record of this.#records.values()) {
      const mount = record.deferredComponentMount
      record.deferredComponentMount = null
      if (mount) mount()
      record.componentHandle?.setVisible(true)
      record.componentHandle?.resume()
    }
  }

  #commitLocationGeneration(
    nextSession: SpatialRuntimeSession,
    replaceCarriers = false,
    resumeCarriers = false,
  ): void {
    this.#invalidateInteractions()
    this.#interactionPort?.resetLocalVisibility()
    if (replaceCarriers) this.#destroyRecords()
    this.#session = nextSession
    this.#updateWorldTransform()
    this.#reconcileRecords()
    if (resumeCarriers) this.#resumeComponentCarriers()
    this.#refreshControllers()
    this.#restoreInteractionsIfActive()
  }

  #destroyRecords(): void {
    for (const record of this.#records.values()) {
      record.componentEffects?.retire()
      record.controllerDom?.destroy()
      record.componentHandle?.destroy()
      record.wrapper.remove()
    }
    this.#records.clear()
  }

  #requireCamera(): SpatialRuntimeCamera {
    if (!this.#session.camera) {
      throw new Error('Spatial runtime camera is not active')
    }
    return this.#session.camera
  }

  #resolveAsset = (assetId: string): string | undefined =>
    this.#options.resolveAsset?.(assetId) ?? this.#publishedAssets?.[assetId]?.url

  #updateWorldTransform(): void {
    if (!this.#world || !this.#svg || !this.#root || !this.#session.camera) return
    const camera = this.#session.camera
    this.#world.setAttribute('transform', spatialWorldGroupTransform(camera))
    if (this.#worldHtml) {
      this.#worldHtml.style.transform = spatialWorldHtmlTransform(camera)
      this.#worldHtml.style.transformOrigin = '0 0'
    }
    this.#svg.setAttribute('width', String(camera.viewportWidth))
    this.#svg.setAttribute('height', String(camera.viewportHeight))
    this.#svg.setAttribute('viewBox', `0 0 ${camera.viewportWidth} ${camera.viewportHeight}`)
    this.#root.style.width = `${camera.viewportWidth}px`
    this.#root.style.height = `${camera.viewportHeight}px`
  }

  #renderWorldDecorations(): void {
    if (!this.#world) return
    const existing = this.#world.querySelector('[data-spatial-paths-relations]')
    existing?.remove()
    const surface = this.#session.input.surface
    const items = new Map(surface.world.layerItems.map((item) => [item.layerItemId, item]))
    const dom = this.#world.ownerDocument
    const group = dom.createElementNS(SVG_NS, 'g')
    group.dataset.spatialPathsRelations = 'true'
    group.style.pointerEvents = 'none'
    for (const path of publishedSpatialPaths(surface)) {
      const points = path.layerItemIds
        .map((id) => items.get(id))
        .filter((item): item is PublishedLayerItem => Boolean(item))
        .map(layerCenter)
      if (points.length === 0) continue
      const polyline = dom.createElementNS(SVG_NS, 'polyline')
      polyline.dataset.spatialPathId = path.id
      polyline.setAttribute('fill', 'none')
      polyline.setAttribute('stroke', safeColor(path.style?.color, DEFAULT_PATH_COLOR))
      polyline.setAttribute('stroke-width', String(Math.max(0.5, path.style?.width ?? DEFAULT_PATH_WIDTH)))
      polyline.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '))
      const dash = pathDashArray(path.style?.dash)
      if (dash) polyline.setAttribute('stroke-dasharray', dash)
      group.appendChild(polyline)
    }
    for (const relation of publishedSpatialRelations(surface)) {
      const source = items.get(relation.sourceLayerItemId)
      const target = items.get(relation.targetLayerItemId)
      if (!source || !target) continue
      const from = layerCenter(source)
      const to = layerCenter(target)
      const line = dom.createElementNS(SVG_NS, 'line')
      line.dataset.spatialRelationId = relation.id
      line.setAttribute('x1', String(from.x))
      line.setAttribute('y1', String(from.y))
      line.setAttribute('x2', String(to.x))
      line.setAttribute('y2', String(to.y))
      line.setAttribute('stroke', DEFAULT_PATH_COLOR)
      line.setAttribute('stroke-width', String(DEFAULT_PATH_WIDTH))
      group.appendChild(line)
      if (relation.label) {
        const text = dom.createElementNS(SVG_NS, 'text')
        text.dataset.spatialRelationLabel = relation.id
        text.setAttribute('x', String((from.x + to.x) / 2))
        text.setAttribute('y', String((from.y + to.y) / 2))
        text.setAttribute('fill', '#334155')
        text.setAttribute('font-size', '12')
        text.setAttribute('text-anchor', 'middle')
        text.textContent = relation.label
        group.appendChild(text)
      }
    }
    if (group.childNodes.length > 0) this.#world.insertBefore(group, this.#world.firstChild)
  }

  #reconcileRecords(): void {
    if (!this.#world || !this.#worldHtml || !this.#screenLayer) return
    this.#interactionPort?.refreshNodes([], ++this.#interactionGeneration)
    this.#interactionNodes.clear()
    const entries = collectSpatialPlaybackEntries(this.#session.input, this.#session.locationId)
    const nextIds = new Set(entries.map((entry) => entry.item.layerItemId))
    for (const [id, record] of [...this.#records.entries()]) {
      if (nextIds.has(id)) continue
      record.componentEffects?.retire()
      record.controllerDom?.destroy()
      record.componentHandle?.destroy()
      record.wrapper.remove()
      this.#records.delete(id)
    }
    for (const entry of entries) {
      let record = this.#records.get(entry.item.layerItemId)
      if (!record) {
        record = this.#createRecord(entry)
        this.#records.set(entry.item.layerItemId, record)
      } else {
        record.entry = entry
      }
      this.#applyRecord(record)
    }
    this.#reconcileWorldVisibility()
    for (const record of this.#records.values()) this.#registerInteractionNode(record)
    this.#interactionPort?.refreshNodes(
      this.#interactionNodes.values(),
      ++this.#interactionGeneration,
    )
  }

  #reconcileWorldVisibility(): void {
    if (!this.#world || !this.#worldHtml || !this.#screenLayer || !this.#session.camera) return
    const camera = this.#session.camera
    const rules = this.#session.input.surface.semanticZoom
    for (const record of this.#records.values()) {
      const { item, coordinateSpace } = record.entry
      if (coordinateSpace === 'viewport') {
        if (!this.#screenLayer.contains(record.wrapper)) this.#screenLayer.appendChild(record.wrapper)
        record.wrapper.style.display = ''
        continue
      }
      const withinCamera = worldItemWithinRuntimeCamera(item, camera, rules)
      const parent = isHtmlWorldWrapper(record.wrapper) ? this.#worldHtml : this.#world
      if (!parent.contains(record.wrapper)) parent.appendChild(record.wrapper)
      // Camera/semantic culling stays outside transient Interaction visibility.
      // Stable wrappers let an off-camera click binding become live after a pan
      // without remounting the one session-global controller.
      record.wrapper.style.display = withinCamera ? '' : 'none'
    }
  }

  #registerInteractionNode(record: SpatialHostRecord): void {
    const { item, source } = record.entry
    if (this.#interactionNodes.has(item.layerItemId)) return
    if (
      isSpatialTeacherControllerItem(item)
      && (this.#options.playbackControls ?? 'canvas') === 'none'
    ) return
    const wrap = record.wrapper
    const authoredPointerEvents = wrap.style.pointerEvents
    const authoredTransform = isHtmlWorldWrapper(wrap)
      ? wrap.style.transform || 'none'
      : item.rotation === 0 ? 'none' : `rotate(${item.rotation}deg)`
    if (!isHtmlWorldWrapper(wrap)) {
      wrap.style.setProperty('transform-box', 'fill-box')
      wrap.style.transformOrigin = 'center'
    }
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
        && this.#records.get(item.layerItemId) === record
        && this.#interactionNodes.get(item.layerItemId) === handle
      ),
      canBindClick: () => canBindPublishedNativeClick(item),
      canRunMotion: () => (
        record.entry.coordinateSpace === 'viewport'
        || this.#recordWithinRuntimeCamera(record)
      ),
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
        transform: authoredTransform,
      }),
    }
    this.#interactionNodes.set(item.layerItemId, handle)
  }

  #recordWithinRuntimeCamera(record: SpatialHostRecord): boolean {
    const camera = this.#session.camera
    if (!camera) return false
    return worldItemWithinRuntimeCamera(
      record.entry.item,
      camera,
      this.#session.input.surface.semanticZoom,
    )
  }

  #createRecord(entry: SpatialPlaybackEntry): SpatialHostRecord {
    const dom = this.#world!.ownerDocument
    const viewport = isSpatialViewportPlaybackItem(entry.source, entry.item)
    let record: SpatialHostRecord | null = null
    let componentHandle: PublishedComponentMountHandle | null = null
    let deferredComponentMount: (() => void) | null = null
    const componentEffects = entry.item.kind === 'component'
      ? this.#carrierSideEffects.createScope(() => (
          record === null
          || this.#records.get(entry.item.layerItemId) === record
        ))
      : null
    const onMountComponent = (handle: PublishedComponentMountHandle) => {
      if (record) record.componentHandle = handle
      else componentHandle = handle
    }
    const deferComponent = !this.#active && componentEffects
      ? (mount: () => void) => {
          const deferred = () => {
            if (componentEffects.active()) mount()
          }
          if (record) record.deferredComponentMount = deferred
          else deferredComponentMount = deferred
        }
      : undefined
    const finish = (
      wrapper: HTMLElement | SVGGElement,
      controllerDom: TeacherControllerDom | null,
    ): SpatialHostRecord => {
      record = {
        entry,
        wrapper,
        controllerDom,
        componentHandle,
        componentEffects,
        deferredComponentMount,
      }
      return record
    }
    if (viewport) {
      const wrapper = dom.createElement('div')
      wrapper.className = 'spatial-viewport-item'
      wrapper.dataset.spatialLayerRecord = 'true'
      wrapper.dataset.layerItemId = entry.item.layerItemId
      wrapper.dataset.layerKind = entry.item.kind
      wrapper.dataset.layerSource = entry.source
      wrapper.dataset.coordinateSpace = 'viewport'
      Object.assign(wrapper.style, {
        position: 'absolute',
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: 'auto',
      })
      const gestureOwner = spatialGestureOwner(entry.item)
      if (gestureOwner) wrapper.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, gestureOwner)
      let controllerDom: TeacherControllerDom | null = null
      if (isSpatialTeacherControllerItem(entry.item)) {
        const content = dom.createElement('div')
        content.className = 'spatial-screen-teacher-controller-content'
        Object.assign(content.style, {
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          boxSizing: 'border-box',
        })
        wrapper.classList.add('spatial-screen-teacher-controller')
        wrapper.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, 'controller')
        wrapper.appendChild(content)
        controllerDom = this.#mountTeacherController(entry.item, content, wrapper)
      } else {
        wrapper.appendChild(createViewportHud(dom, entry.item, {
          components: this.#components,
          resolveAsset: this.#resolveAsset,
          interactive: true,
          ...(componentEffects?.courseState
            ? { courseState: componentEffects.courseState }
            : {}),
          ...(componentEffects?.componentActions
            ? { componentActions: componentEffects.componentActions }
            : {}),
          onMountComponent,
          ...(deferComponent ? { deferComponentMount: deferComponent } : {}),
        }))
      }
      return finish(wrapper, controllerDom)
    }
    if (entry.item.kind === 'native' && entry.item.content.nativeType === 'video') {
      const url = this.#resolveAsset(entry.item.content.data.assetId)
      const wrapper = createWorldVideoHtml(dom, entry.item, url)
      wrapper.dataset.layerSource = entry.source
      const gestureOwner = spatialGestureOwner(entry.item)
      if (gestureOwner) wrapper.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, gestureOwner)
      return finish(wrapper, null)
    }
    const wrapper = createWorldItem(dom, entry.item, this.#resolveAsset, {
      components: this.#components,
      interactive: true,
      ...(componentEffects?.courseState
        ? { courseState: componentEffects.courseState }
        : {}),
      ...(componentEffects?.componentActions
        ? { componentActions: componentEffects.componentActions }
        : {}),
      onMountComponent,
      ...(deferComponent ? { deferComponentMount: deferComponent } : {}),
    })
    wrapper.dataset.spatialLayerRecord = 'true'
    wrapper.dataset.layerItemId = entry.item.layerItemId
    wrapper.dataset.layerKind = entry.item.kind
    wrapper.dataset.layerSource = entry.source
    wrapper.dataset.coordinateSpace = 'world'
    const gestureOwner = spatialGestureOwner(entry.item)
    if (gestureOwner) wrapper.setAttribute(SPATIAL_GESTURE_OWNER_ATTR, gestureOwner)
    return finish(wrapper, null)
  }

  #applyRecord(record: SpatialHostRecord): void {
    const { item, source } = record.entry
    record.wrapper.dataset.layerItemId = item.layerItemId
    record.wrapper.dataset.layerSource = source
    if (!isSpatialViewportPlaybackItem(source, item) && !isHtmlWorldWrapper(record.wrapper)) return
    const html = record.wrapper as HTMLElement
    const session = this.#controllerSessionFor(item)
    const offset = session?.offset ?? { dx: 0, dy: 0 }
    html.style.left = `${item.frame.x + offset.dx}px`
    html.style.top = `${item.frame.y + offset.dy}px`
    html.style.width = `${item.frame.width}px`
    html.style.height = `${item.frame.height}px`
    html.style.opacity = String(item.opacity)
    html.style.transform = item.rotation === 0 ? '' : `rotate(${item.rotation}deg)`
    html.style.zIndex = String(item.order)
    if (isSpatialTeacherControllerItem(item)) {
      html.hidden = (this.#options.playbackControls ?? 'canvas') === 'none'
    }
  }

  #controllerSessionFor(item: PublishedLayerItem): TeacherControllerDomSession | undefined {
    if (!isSpatialTeacherControllerItem(item)) return undefined
    return this.#teacherControllerSession.get({
      controllerId: item.layerItemId,
      surfaceSessionId: this.id,
      defaultCollapsed: item.content.data.collapsible && item.content.data.defaultCollapsed,
    })
  }

  #mountTeacherController(
    item: TeacherControllerNativeItem,
    container: HTMLElement,
    footprintElement: HTMLElement,
  ): TeacherControllerDom {
    const node = teacherControllerDomNode(item.frame, item.rotation, item.content.data)
    return new TeacherControllerDom({
      node,
      container,
      footprintElement,
      canvas: {
        width: this.#session.viewport.width,
        height: this.#session.viewport.height,
      },
      getRenderedStageBounds: () => this.getRenderedStageBounds(),
      scenes: this.#progressLocations(),
      getCurrentSceneId: () => this.#currentProgressId(),
      getStateLabel: () => this.#options.courseProgressSource?.getStateLabel?.() ?? null,
      getStatus: () => ({
        muted: this.#muted,
        fullscreen: Boolean(this.#root?.ownerDocument.fullscreenElement),
      }),
      getSession: () => this.#controllerSessionFor(item) ?? { offset: { dx: 0, dy: 0 }, collapsed: false },
      onSessionChange: (next) => {
        this.#teacherControllerSession.set({
          controllerId: item.layerItemId,
          surfaceSessionId: this.id,
          defaultCollapsed: item.content.data.collapsible && item.content.data.defaultCollapsed,
        }, {
          offset: { ...next.offset },
          collapsed: next.collapsed,
        })
        const record = this.#records.get(item.layerItemId)
        if (record) this.#applyRecord(record)
      },
      onAction: (action) => {
        void this.#handleTeacherControllerAction(action, item).catch((cause) => {
          const error = cause instanceof Error ? cause : new Error(String(cause))
          this.#options.reportActionError?.(action, error)
        })
      },
      getInteractive: () => this.#session.active && (this.#options.playbackControls ?? 'canvas') === 'canvas',
    })
  }

  #progressLocations(): TeacherControllerSceneInfo[] {
    if (this.#options.courseProgressSource) return this.#options.courseProgressSource.getLocations()
    return this.#session.input.locations.map((location) => ({
      id: location.id,
      name: location.label,
    }))
  }

  #currentProgressId(): string | null {
    if (this.#options.courseProgressSource) {
      return this.#options.courseProgressSource.getCurrentLocationId()
    }
    return this.#session.locationId
  }

  #refreshControllers(): void {
    for (const record of this.#records.values()) {
      if (!record.controllerDom || !isSpatialTeacherControllerItem(record.entry.item)) continue
      record.controllerDom.update(teacherControllerDomNode(
        record.entry.item.frame,
        record.entry.item.rotation,
        record.entry.item.content.data,
      ))
    }
  }

  #subscribeAudio(): void {
    this.#audioDisposer?.()
    this.#audioDisposer = null
    const source = this.#options.audioChangeSource
    if (!source) return
    this.#audioDisposer = source.on<{ muted?: boolean }>('audio:change', (event) => {
      if (typeof event?.muted !== 'boolean') return
      this.#muted = event.muted
      this.#refreshControllers()
    })
  }

  async #handleTeacherControllerAction(
    action: TeacherControllerAction,
    item: PublishedNativeLayerItem,
  ): Promise<void> {
    if (!this.#active) return
    if (this.#options.executeTeacherControllerAction) {
      const handled = await this.#options.executeTeacherControllerAction(action, item)
      if (handled !== false) {
        const CustomEventConstructor = this.#root?.ownerDocument.defaultView?.CustomEvent
        if (CustomEventConstructor && this.#root) {
          this.#root.dispatchEvent(new CustomEventConstructor('courseware:teacher-controller-action', {
            detail: action,
          }))
        }
        return
      }
    }
    if (action.type === 'scene.next') {
      await this.goNext()
    } else if (action.type === 'scene.previous') {
      await this.goPrevious()
    } else if (action.type === 'scene.replay') {
      this.#commitLocationGeneration(reopenSpatialRuntimeSession(this.#session), true)
    } else if (action.type === 'course.restart') {
      this.#teacherControllerSession.resetCourse()
      this.preparePublishedLocation(this.#session.input.startLocationId, true)
      await this.setLocationId(this.#session.input.startLocationId)
    } else if (action.type === 'audio.toggle-mute') {
      this.#muted = !this.#muted
      this.#refreshControllers()
    }
    const CustomEventConstructor = this.#root?.ownerDocument.defaultView?.CustomEvent
    if (!CustomEventConstructor || !this.#root) return
    this.#root.dispatchEvent(new CustomEventConstructor('courseware:teacher-controller-action', {
      detail: action,
    }))
  }
}

export type { PublishedSpatialRuntimeInput, SpatialRuntimeCamera } from './spatialModel'
export {
  publishedSpatialInputFromCourse,
  spatialWorldGroupTransform,
} from './spatialModel'
export {
  openSpatialRuntimeSession,
  spatialRuntimeGoNext,
  spatialRuntimeGoPrevious,
  enterSpatialRuntimeLocation,
  leaveSpatialRuntimeLocation,
  reopenSpatialRuntimeSession,
} from './spatialRuntimeSession'
