import type { TeacherControllerAction } from '../../../shared/teacherControllerConfig'
import type { PlaybackNavigationViewPort } from '../../navigation/coursePlaybackSequence'
import { TeacherControllerComponentHost } from '../../teacherControllerComponentHost'
import { controllerGeometryItem, isControllerItem, type PublishedTeacherControllerItem } from '../../teacherControllerComponentGeometry'
import { projectFlowComponentControllerFrame } from '../../../shared/flowViewportGeometry'
import type { TeacherControllerHostOptions } from '../../teacherControllerHostContract'
import { createPlaybackContent, playbackGestureOccupied, type PlaybackViewSession } from '../../playbackViewSession'
import { buildFlowRichTextHtml } from '../../../shared/flowRichText'
import { buildNativeChartSvg } from '../../../shared/nativeChartSvg'
import { createFlowViewportGeometry, measureFlowPaperOrigin } from '../../../shared/flowViewportGeometry'
import { FLOW_BODY_CSS, FLOW_BODY_PAPER_PADDING, FLOW_BODY_SCROLL_PADDING, flowPaperMaxWidth, resolveFlowParagraphPresentation } from '../../../shared/flowBodyPresentation'
import { tableCellSpan } from '../../../shared/tableMerge'
import { resolveCourseSurfaceBackgroundColor } from '../../../shared/courseProjectModel'
import { resolveEffectiveBackground } from '../../../shared/effectiveBackground'
import {
  composePublishedCourseLocation,
  type CourseLayerComposition,
} from '../../../shared/courseLayerComposition'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../../shared/constants'
import {
  FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY,
  FLOW_MEDIA_INLINE_SIZE_REFERENCE,
  FLOW_MEDIA_QUERY_CONTAINER_TYPE,
  resolveFlowMediaLayoutProjection,
} from '../../../shared/flowMediaLayout'
import { ShapeNode,  TextRun } from '../../../shared/contracts/native-v1'


import { nativeRenderInputFromPublishedItem, paintPublishedNativeRenderInput } from '../native/publishedNativeRendering'
import type { ComponentHostActions } from '../../../shared/componentTypes'
import type {
  CourseStateStore as CourseStateStoreContract,
  RuntimeHostActions,
} from '../../../shared/runtimeTypes'
import { AudioManager } from '../../AudioManager'
import { CourseEventBus } from '../../CourseEventBus'
import { mountPublishedNativeVideo, type PublishedNativeVideoHandle } from '../publishedNativeVideoMount'
import type { CourseStateStore } from '../../CourseStateStore'
import type { FlowBlock, FlowBodyLayerPlane, GlobalLayerPlane } from '../../../shared/courseProjectTypes'
import {
  stageBoundsFromElement,
  teacherControllerHostNode,
  type TeacherControllerHostSession,
} from '../../teacherControllerHostContract'
import { TeacherControllerRuntimeSessionStore } from '../../teacherControllerRuntimeSession'
import type { TeacherControllerSceneInfo } from '../../teacherControllerHostContract'
import type {
  PublishedFlowSurface,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedRuntimeLayerItem,
} from '../../../shared/publishedCourseTypes'
import {
  FLOW_LOGICAL_CANVAS,
  cloneJson,
  findPublishedFlowSurface,
  flowPageStartLocationId,
  flowSurfaceOrder,
  flowTableCellText,
  resolveFlowLocation,
  resolvePlaybackAssetUrl,
  toFlowPublishedPlayback,
  type FlowPublishedPlaybackDocument,
  type FlowPublishedPlaybackSource,
} from './flowModel'
import {
  FlowRuntimeTocChrome,
  buildFlowRuntimeToc,
  flowRuntimeTocAnchorId,
  flowRuntimeTocPageAnchorId,
  flowRuntimeTocShellLayout,
  type FlowRuntimeTocEntry,
} from './flowRuntimeToc'
import {
  mountPublishedComponent,
  type PublishedComponentMountHandle,
  type PublishedComponentPackageSource,
} from '../publishedComponentMount'
import { fittedPublishedFormulaSize, paintPublishedFormula } from '../publishedFormula'
import {
  PublishedDomInteractionSurfacePort,
  PublishedInteractionVisibilityState,
  type PublishedInteractionNodeHandle,
  type PublishedInteractionNodeOwnership,
  type PublishedInteractionNodeState,
} from '../../interactions/PublishedDomInteractionSurfacePort'
import type { PublishedInteractionSurfacePort } from '../../interactions/PublishedInteractionSurfacePort'
import {
  createPublishedSurfaceRuntimeSession,
  mountPublishedSurfaceRuntime,
  type PublishedSurfaceRuntimeSession,
  type PublishedSurfaceRuntimeMountHandle,
} from '../runtime/publishedSurfaceRuntimeMount'
import {
  isPublishedGlobalCanvasRuntimePointerItem,
  setPublishedGlobalCanvasRuntimeInteractionVisibility,
} from '../runtime/publishedGlobalCanvasRuntimePointer'
import {
  PublishedCarrierSideEffectGate,
  type PublishedCarrierSideEffects,
} from '../publishedCourseState'

type FlowRuntimeFailurePhase = 'register' | 'create' | 'lifecycle' | 'destroy'

interface FlowRuntimeHandleRecord {
  handle: PublishedSurfaceRuntimeMountHandle | null
  wrap: HTMLElement
  item: PublishedRuntimeLayerItem
  retired: boolean
}

interface PublishedFlowOverlayEntry {
  readonly item: PublishedLayerItem
  readonly source: 'global' | 'surface'
  readonly globalPlane: GlobalLayerPlane | null
  readonly flowBodyPlane: FlowBodyLayerPlane | null
  readonly stackOrder: number
}

interface FlowOverlayRecord {
  wrap: HTMLElement
  effects: PublishedCarrierSideEffects
}

export interface FlowCourseProgressSource {
  getLocations(): readonly TeacherControllerSceneInfo[]
  getCurrentLocationId(): string | null
  getStateLabel(): string | null
}

export interface FlowSurfaceHostOptions {
  surfaceId?: string
  locationId?: string
  /** Runtime-session only. Default is collapsed (scheme 1). */
  initialTocOpen?: boolean
  resolveAsset?: (assetId: string) => string | undefined
  projectId?: string
  components?: Record<string, PublishedComponentPackageSource>
  /** Published playback session state shared across every surface host. */
  courseState?: CourseStateStore
  /** Playback-only navigation actions exposed to API 3 Runtime instances. */
  runtimeActions?: Readonly<RuntimeHostActions>
  /** Playback-only navigation actions exposed to Component API 4 instances. */
  componentActions?: Readonly<ComponentHostActions>
  audio?: FlowHostAudioSession
  executeTeacherControllerAction?: (
    action: TeacherControllerAction,
  ) => boolean | void | Promise<boolean | void>
  onNavigateLocation?: (locationId: string) => void
  courseProgressSource?: FlowCourseProgressSource
  teacherControllerSession?: TeacherControllerRuntimeSessionStore
  navigation?: PlaybackNavigationViewPort
  playbackView?: PlaybackViewSession
  deferTeacherControllerCourseReset?: boolean
  /** Published-session only; shared by global LayerItem handles across surfaces. */
  globalInteractionVisibilityState?: PublishedInteractionVisibilityState
  /** Published-session generation hook fired before interaction DOM is invalidated. */
  onInteractionInvalidated?: () => void
  /** Published-session generation hook fired after an active interaction DOM is ready. */
  onInteractionReady?: () => void
  /** Published-session diagnostic bridge; a failed Runtime never fails its Flow host. */
  reportRuntimeError?: (
    itemId: string,
    phase: FlowRuntimeFailurePhase,
    error: Error,
  ) => void
  reportActionError?: (action: TeacherControllerAction, error: Error) => void
}

export type FlowHostAudioSession = Pick<AudioManager,
  'muted' | 'setMuted' | 'toggleMuted' | 'registerVideo' | 'beginBackgroundAudioInterruption'>

/**
 * Playback host for Published Course V2 Flow surfaces. It never reads authoring
 * DOM as the document source. Overlay teacher-controller uses the shared DOM
 * controller; it is not a document footer. TOC chrome is session-only.
 */
export class FlowSurfaceHost {
  readonly kind = 'flow' as const
  #playback: FlowPublishedPlaybackDocument
  #components: Record<string, PublishedComponentPackageSource> | undefined
  #surfaceId: string
  #locationId: string
  #options: FlowSurfaceHostOptions
  #audio: FlowHostAudioSession
  #ownedAudio: AudioManager | null = null
  #videoHandles: PublishedNativeVideoHandle[] = []
  #overlayRecords = new Map<string, FlowOverlayRecord>()
  #container: HTMLElement | null = null
  #viewportObserver: ResizeObserver | null = null
  #root: HTMLElement | null = null
  #content: HTMLElement | null = null
  #controllerPlane: HTMLElement | null = null
  #article: HTMLElement | null = null
  #globalUnderlay: HTMLElement | null = null
  #surfaceUnderlay: HTMLElement | null = null
  #surfaceOverlay: HTMLElement | null = null
  /** Legacy overlay handle and the physical global Overlay plane. */
  #overlay: HTMLElement | null = null
  #toc: FlowRuntimeTocChrome | null = null
  #controller: TeacherControllerComponentHost | null = null
  readonly #teacherControllerSession: TeacherControllerRuntimeSessionStore
  #componentHandles: PublishedComponentMountHandle[] = []
  #bodyLayoutCleanups: Array<() => void> = []
  readonly #globalInteractionVisibilityState: PublishedInteractionVisibilityState
  #interactionPort: PublishedDomInteractionSurfacePort | null = null
  #interactionGeneration = 0
  #interactionNodes = new Map<string, PublishedInteractionNodeHandle>()
  #runtimeHandles: FlowRuntimeHandleRecord[] = []
  #deferredCarrierMounts: Array<() => void> = []
  readonly #runtimeSession: PublishedSurfaceRuntimeSession
  readonly #carrierSideEffects: PublishedCarrierSideEffectGate
  #carrierEffects: PublishedCarrierSideEffects
  #preparedRuntimeActivation: { locationId: string; forced: boolean } | null = null
  #pendingRuntimeActivation: { locationId: string; forced: boolean } | null = null
  #completedActiveResetLocationId: string | null = null
  #active = false
  #queue: Promise<void> = Promise.resolve()

  constructor(source: FlowPublishedPlaybackSource, options: FlowSurfaceHostOptions = {}) {
    this.#playback = toFlowPublishedPlayback(source)
    this.#components = ('components' in source && source.components
      ? source.components as Record<string, PublishedComponentPackageSource>
      : undefined) ?? options.components
    this.#options = { ...options }
    this.#runtimeSession = createPublishedSurfaceRuntimeSession(options.courseState)
    this.#carrierSideEffects = new PublishedCarrierSideEffectGate({
      courseState: this.#runtimeSession.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
    })
    this.#carrierEffects = this.#carrierSideEffects.beginGeneration()
    this.#teacherControllerSession = options.teacherControllerSession
      ?? new TeacherControllerRuntimeSessionStore()
    this.#globalInteractionVisibilityState = options.globalInteractionVisibilityState
      ?? new PublishedInteractionVisibilityState()
    this.#ownedAudio = options.audio ? null : new AudioManager(
      this.#playback,
      assetId => resolvePlaybackAssetUrl(this.#playback, assetId, this.#options.resolveAsset),
      new CourseEventBus(),
    )
    this.#audio = options.audio ?? this.#ownedAudio!
    const requestedLocation = options.locationId ?? this.#playback.startLocationId
    const resolved = tryResolveLocation(this.#playback, requestedLocation)
      ?? tryResolveLocation(this.#playback, this.#playback.startLocationId)
      ?? {
        id: flowPageStartLocationId(this.#playback, this.#playback.surfaces[0]!.id),
        surfaceId: this.#playback.surfaces[0]!.id,
      }
    this.#surfaceId = options.surfaceId
      ?? resolved.surfaceId
    this.#locationId = resolved.id
    findPublishedFlowSurface(this.#playback, this.#surfaceId)
  }

  get surfaceId(): string {
    return this.#surfaceId
  }

  get locationId(): string {
    return this.#locationId
  }

  get playbackDocument(): FlowPublishedPlaybackDocument {
    return cloneJson(this.#playback)
  }

  get surface(): PublishedFlowSurface {
    return cloneJson(findPublishedFlowSurface(this.#playback, this.#surfaceId))
  }

  get tocOpen(): boolean {
    return this.#toc?.open ?? false
  }

  get rootElement(): HTMLElement | null {
    return this.#root
  }

  readObservationState() {
    return {
      surfaceId: this.#surfaceId, locationId: this.#locationId, stateId: null,
      ready: this.#active && this.#pendingRuntimeActivation === null && this.#root?.isConnected === true,
      stateVersion: this.#interactionGeneration + this.#runtimeSession.courseState.version,
      publicState: { courseState: this.#runtimeSession.courseState.snapshot() },
    }
  }

  getPublishedInteractionSurfacePort(): PublishedInteractionSurfacePort | null {
    return this.#interactionPort
  }

  getPublishedGlobalRuntimeMountTarget(itemId: string): HTMLElement | null {
    for (const plane of [this.#globalUnderlay, this.#overlay]) {
      if (!plane) continue
      for (const candidate of plane.querySelectorAll<HTMLElement>('[data-flow-overlay-source="global"]')) {
        if (candidate.dataset.flowOverlayItem === itemId) return candidate
      }
    }
    return null
  }

  /** Published navigator hint used to avoid resuming a stale Flow generation. */
  preparePublishedLocation(locationId: string, forced: boolean): void {
    resolveFlowLocation(this.#playback, locationId)
    this.#completedActiveResetLocationId = null
    this.#preparedRuntimeActivation = { locationId, forced }
  }

  setTocOpen(open: boolean): void {
    this.#toc?.setOpen(open)
  }

  resetTeacherControllerSession(scope: 'surface' | 'course'): void {
    if (scope === 'course') {
      if (!this.#options.deferTeacherControllerCourseReset) {
        this.#teacherControllerSession.resetCourse()
      }
    } else this.#teacherControllerSession.resetSurface(this.#surfaceId)
  }

  mount(container: HTMLElement): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#container) throw new Error('Flow surface is already mounted')
      this.#container = container
      const dom = container.ownerDocument
      const root = dom.createElement('section')
      root.className = 'flow-surface-host'
      root.dataset.surfaceId = this.#surfaceId
      root.style.position = 'relative'
      root.style.isolation = 'isolate'
      root.style.width = '100%'
      root.style.height = '100%'
      root.style.minHeight = '0'
      root.style.overflow = 'hidden'
      root.style.setProperty('--flow-toc-inset', '0px')
      root.hidden = !this.#active

      const globalUnderlay = createFlowRuntimePlane(dom, 'global-underlay', 0)
      const surfaceUnderlay = createFlowRuntimePlane(dom, 'surface-underlay', 1)
      const surfaceOverlay = createFlowRuntimePlane(dom, 'surface-overlay', 3)
      const overlay = createFlowRuntimePlane(dom, 'global-overlay', 4, true)
      const content = this.#options.playbackView ? createPlaybackContent(root) : root
      content.append(globalUnderlay, surfaceUnderlay, surfaceOverlay, overlay)
      this.#content = content
      if (this.#options.playbackView) {
        this.#controllerPlane = createFlowRuntimePlane(dom, 'global-overlay', 5, true)
        this.#controllerPlane.dataset.playbackControllerPlane = 'true'
        root.appendChild(this.#controllerPlane)
        this.#options.playbackView.register({ id: this.#surfaceId, kind: 'flow', root, content,
          onObservationChange: () => this.#syncTeacherControllerSession(true) })
      }

      container.appendChild(root)
      this.#root = root
      this.#globalUnderlay = globalUnderlay
      this.#surfaceUnderlay = surfaceUnderlay
      this.#surfaceOverlay = surfaceOverlay
      this.#overlay = overlay
      this.#interactionPort = new PublishedDomInteractionSurfacePort(root)
      this.#toc = new FlowRuntimeTocChrome(root, {
        initialOpen: this.#options.initialTocOpen === true,
        getEntries: () => buildFlowRuntimeToc(this.#playback),
        onNavigate: (entry) => {
          void this.#navigateToc(entry)
        },
        onOpenChange: () => this.#applyShellLayout(),
      })
      this.#render()
      this.#applyShellLayout()
      if (typeof ResizeObserver === 'function') {
        this.#viewportObserver = new ResizeObserver(() => {
          this.#applyShellLayout()
          this.#syncTeacherControllerSession()
        })
        this.#viewportObserver.observe(root)
        if (this.#article) this.#viewportObserver.observe(this.#article)
      }
      this.#restoreInteractionsIfActive()
    })
  }

  async activate(): Promise<void> {
    const wasInactive = !this.#active
    const preparedActivation = this.#preparedRuntimeActivation
    this.#preparedRuntimeActivation = null
    this.#active = true
    if (this.#controller instanceof TeacherControllerComponentHost) this.#controller.resume()
    if (this.#root) this.#root.hidden = false
    this.#pendingRuntimeActivation = null
    if (!(wasInactive && preparedActivation !== null)) {
      this.#carrierSideEffects.activate()
    }
    if (wasInactive) {
      if (preparedActivation !== null) {
        this.#pendingRuntimeActivation = preparedActivation
      } else {
        if (this.#deferredCarrierMounts.length > 0) this.#mountDeferredCarriers()
        else {
          for (const record of [...this.#runtimeHandles]) {
            record.handle?.setVisible(true)
            if (!record.retired) record.handle?.resume()
          }
          for (const handle of this.#componentHandles) {
            handle.setVisible(true)
            handle.resume()
          }
        }
      }
    }
    if (this.#pendingRuntimeActivation !== null) return
    this.#syncTeacherControllerSession()
    this.#restoreInteractionsIfActive()
  }

  async suspend(): Promise<void> {
    this.#invalidateInteractions()
    this.#active = false
    if (this.#controller instanceof TeacherControllerComponentHost) this.#controller.suspend()
    this.#carrierSideEffects.suspend()
    this.#preparedRuntimeActivation = null
    this.#pendingRuntimeActivation = null
    this.#completedActiveResetLocationId = null
    for (const handle of this.#videoHandles) handle.pause()
    for (const record of [...this.#runtimeHandles]) {
      record.handle?.setVisible(false)
      if (!record.retired) record.handle?.suspend()
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

  setLocationId(locationId: string): Promise<void> {
    return this.#enqueue(async () => this.#applyLocation(locationId))
  }

  reset(scope: 'surface' | 'course', startLocationId: string): Promise<void> {
    return this.#enqueue(async () => {
      this.resetTeacherControllerSession(scope)
      if (scope === 'course') this.#runtimeSession.resetCourse()
      const preparedReset = this.#preparedRuntimeActivation
      const resetWasActive = this.#active
      this.#applyLocation(startLocationId, true)
      if (
        resetWasActive
        && preparedReset?.forced
        && preparedReset.locationId === startLocationId
      ) {
        this.#completedActiveResetLocationId = startLocationId
      } else if (!resetWasActive && preparedReset?.locationId === startLocationId) {
        // Course reset may rebuild the suspended start host before it is activated.
        // Keep the navigator hint so activation does not execute then rebuild it twice.
        this.#preparedRuntimeActivation = preparedReset
      }
    })
  }

  updatePublishedCourse(source: FlowPublishedPlaybackSource): Promise<void> {
    return this.#enqueue(async () => {
      // Validate and resolve the replacement before touching the live generation.
      // A rejected update must leave the current DOM port and controller usable.
      const nextPlayback = toFlowPublishedPlayback(source)
      const nextComponents = 'components' in source && source.components
        ? source.components as Record<string, PublishedComponentPackageSource>
        : this.#components
      const keepsCurrentSurface = nextPlayback.surfaces.some(
        (surface) => surface.id === this.#surfaceId,
      )
      const currentLocation = tryResolveLocation(nextPlayback, this.#locationId)
      const keepsCurrentLocation = currentLocation?.surfaceId === this.#surfaceId
      const nextSurfaceId = keepsCurrentSurface
        ? this.#surfaceId
        : nextPlayback.surfaces[0]!.id
      const nextLocationId = keepsCurrentSurface && keepsCurrentLocation
        ? currentLocation.id
        : flowPageStartLocationId(nextPlayback, nextSurfaceId)

      this.#invalidateInteractions()
      this.#interactionPort?.resetLocalVisibility()
      this.#playback = nextPlayback
      this.#components = nextComponents
      this.#surfaceId = nextSurfaceId
      this.#locationId = nextLocationId
      if (this.#root) this.#root.dataset.surfaceId = this.#surfaceId
      this.#render()
      this.#toc?.sync()
      this.#applyShellLayout()
      this.#restoreInteractionsIfActive()
    })
  }

  destroy(): Promise<void> {
    return this.#enqueue(async () => {
      this.#viewportObserver?.disconnect()
      this.#viewportObserver = null
      this.#invalidateInteractions()
      this.#carrierSideEffects.destroy()
      this.#interactionPort?.destroy()
      this.#interactionPort = null
      this.#interactionNodes.clear()
      this.#destroyRuntimeHandles()
      this.#destroyComponentHandles()
      this.#destroyVideoHandles()
      this.#clearOverlayRecords()
      this.#ownedAudio?.destroy()
      this.#destroyController()
      this.#runtimeSession.destroy()
      this.#toc?.destroy()
      this.#toc = null
      this.#root?.remove()
      this.#root = null
      this.#article = null
      this.#globalUnderlay = null
      this.#surfaceUnderlay = null
      this.#surfaceOverlay = null
      this.#overlay = null
      this.#container = null
      this.#active = false
      this.#preparedRuntimeActivation = null
      this.#pendingRuntimeActivation = null
      this.#completedActiveResetLocationId = null
    })
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

  #destroyComponentHandles(): void {
    for (const cleanup of this.#bodyLayoutCleanups.splice(0)) cleanup()
    this.#deferredCarrierMounts = []
    for (const handle of this.#componentHandles) {
      try {
        handle.destroy()
      } catch (error) {
        console.error('Flow 组件销毁失败', error)
      }
    }
    this.#componentHandles = []
  }

  #destroyVideoHandles(): void {
    for (const handle of this.#videoHandles) handle.destroy()
    this.#videoHandles = []
  }

  #clearOverlayRecords(): void {
    for (const record of this.#overlayRecords.values()) record.effects.retire()
    this.#overlayRecords.clear()
  }

  #removeOverlayRecord(id: string, record: FlowOverlayRecord): void {
    record.effects.retire()
    for (const runtime of [...this.#runtimeHandles]) {
      if (runtime.wrap === record.wrap) this.#retireRuntimeHandle(runtime)
    }
    this.#componentHandles = this.#componentHandles.filter(handle => {
      if (!record.wrap.contains(handle.element)) return true
      handle.destroy()
      return false
    })
    this.#videoHandles = this.#videoHandles.filter(handle => {
      if (!record.wrap.contains(handle.element)) return true
      handle.destroy()
      return false
    })
    record.wrap.remove()
    this.#overlayRecords.delete(id)
    this.#interactionNodes.delete(id)
  }

  #destroyRuntimeHandles(): void {
    const records = [...this.#runtimeHandles]
    this.#runtimeHandles = []
    for (const record of records) this.#retireRuntimeHandle(record)
  }

  #retireRuntimeHandle(record: FlowRuntimeHandleRecord): boolean {
    if (record.retired) return false
    record.retired = true
    const index = this.#runtimeHandles.indexOf(record)
    if (index >= 0) this.#runtimeHandles.splice(index, 1)
    try {
      record.handle?.destroy()
    } catch (error) {
      console.error('Flow Surface Runtime 销毁失败', error)
    }
    return true
  }

  #mountRuntime(wrap: HTMLElement, item: PublishedRuntimeLayerItem, effects = this.#carrierEffects): void {
    wrap.replaceChildren()
    wrap.dataset.flowRuntimeState = 'playback'
    wrap.style.pointerEvents = item.hitPolicy === 'auto' ? 'auto' : 'none'
    const record: FlowRuntimeHandleRecord = {
      handle: null,
      wrap,
      item,
      retired: false,
    }
    const handle = mountPublishedSurfaceRuntime(wrap, {
      instanceId: item.layerItemId,
      runtime: item.runtime,
      width: item.frame.width,
      height: item.frame.height,
      visible: this.#active,
      resolveAsset: (assetId) => resolvePlaybackAssetUrl(
        this.#playback,
        assetId,
        this.#options.resolveAsset,
      ),
      session: this.#runtimeSession,
      ...(effects.courseState
        ? { courseState: effects.courseState }
        : {}),
      ...(effects.runtimeActions
        ? { actions: effects.runtimeActions }
        : {}),
      fallbackText: firstVisibleRuntimeText(item.runtime.content.values)
        ?? item.runtime.protocol,
      reportError: (phase, error) => {
        if (phase === 'lifecycle' && this.#retireRuntimeHandle(record)) {
          this.#showRuntimeFallback(record.wrap, record.item)
        }
        this.#options.reportRuntimeError?.(item.layerItemId, phase, error)
      },
    })
    record.handle = handle
    if (!handle.ok) {
      wrap.dataset.flowRuntimeState = 'fallback'
      wrap.style.pointerEvents = 'none'
    }
    if (record.retired) handle.destroy()
    else this.#runtimeHandles.push(record)
  }

  #showRuntimeFallback(wrap: HTMLElement, item: PublishedRuntimeLayerItem): void {
    const fallbackWrap = renderStaticOverlayItem(
      wrap.ownerDocument,
      {
        item,
        source: 'surface',
        stackOrder: Number.parseInt(wrap.style.zIndex, 10) || 0,
      },
      (assetId) => resolvePlaybackAssetUrl(
        this.#playback,
        assetId,
        this.#options.resolveAsset,
      ),
      { interactive: false },
    )
    wrap.replaceChildren(...fallbackWrap.childNodes)
    wrap.dataset.flowRuntimeState = 'fallback'
    wrap.style.pointerEvents = 'none'
  }

  #mountDeferredCarriers(): void {
    const deferred = this.#deferredCarrierMounts
    this.#deferredCarrierMounts = []
    for (const mount of deferred) mount()
  }

  #applyLocation(locationId: string, force = false): void {
    const location = resolveFlowLocation(this.#playback, locationId)
    const completedResetLocationId = this.#completedActiveResetLocationId
    this.#completedActiveResetLocationId = null
    const preparedActivation = this.#preparedRuntimeActivation
    this.#preparedRuntimeActivation = null
    const sameLocation = location.id === this.#locationId
      && location.surfaceId === this.#surfaceId
    const pendingActivation = this.#pendingRuntimeActivation
    const forced = force || (pendingActivation ?? preparedActivation)?.forced === true
    this.#pendingRuntimeActivation = null
    if (pendingActivation !== null) this.#carrierSideEffects.activate()
    if (completedResetLocationId === location.id && sameLocation) return
    if (
      pendingActivation?.locationId === location.id
      && !forced
      && sameLocation
    ) {
      if (this.#deferredCarrierMounts.length > 0) {
        this.#mountDeferredCarriers()
      } else {
        for (const record of [...this.#runtimeHandles]) {
          record.handle?.setVisible(true)
          if (!record.retired) record.handle?.resume()
        }
        for (const handle of this.#componentHandles) {
          handle.setVisible(true)
          handle.resume()
        }
      }
      this.#syncTeacherControllerSession()
      this.#restoreInteractionsIfActive()
      return
    }
    this.#invalidateInteractions()
    this.#interactionPort?.resetLocalVisibility()
    const preserveDocument = !forced && location.surfaceId === this.#surfaceId && this.#article !== null
    this.#locationId = location.id
    this.#surfaceId = location.surfaceId
    if (this.#root) this.#root.dataset.surfaceId = this.#surfaceId
    if (preserveDocument) {
      this.#renderOverlay(findPublishedFlowSurface(this.#playback, this.#surfaceId), true)
      if (this.#active && pendingActivation !== null) {
        for (const record of [...this.#runtimeHandles]) {
          record.handle?.setVisible(true)
          if (!record.retired) record.handle?.resume()
        }
        for (const handle of this.#componentHandles) {
          handle.setVisible(true)
          handle.resume()
        }
      }
      if (this.#active) this.#mountDeferredCarriers()
      this.#interactionPort?.refreshNodes(this.#interactionNodes.values(), ++this.#interactionGeneration)
      this.#syncTeacherControllerSession()
    } else this.#render()
    this.#applyShellLayout()
    this.#scrollToAnchor(
      location.blockId
        ? flowRuntimeTocAnchorId(location.blockId)
        : flowRuntimeTocPageAnchorId(location.surfaceId),
    )
    this.#restoreInteractionsIfActive()
  }

  #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(() => undefined, () => undefined)
    return result
  }

  #applyShellLayout(): void {
    const shell = flowRuntimeTocShellLayout(this.tocOpen)
    if (this.#article) this.#article.style.marginLeft = `${shell.articleInsetPx}px`
    for (const plane of this.#layerPlanes()) {
      plane.style.left = '0px'
    }
    if (this.#article) {
      this.#syncPaperOverlayPositions(
        findPublishedFlowSurface(this.#playback, this.#surfaceId),
      )
    }
  }

  #registerInteractionNode(
    wrap: HTMLElement,
    item: PublishedLayerItem,
    source: 'global' | 'surface',
  ): void {
    if (this.#interactionNodes.has(item.layerItemId)) return
    const authoredPointerEvents = wrap.style.pointerEvents || 'none'
    const authoredTransform = wrap.style.transform || 'none'
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
        transform: authoredTransform,
      }),
    }
    this.#interactionNodes.set(item.layerItemId, handle)
  }

  #render(): void {
    if (
      !this.#root
      || !this.#globalUnderlay
      || !this.#surfaceUnderlay
      || !this.#surfaceOverlay
      || !this.#overlay
    ) return
    this.#carrierEffects = this.#carrierSideEffects.beginGeneration()
    this.#pendingRuntimeActivation = null
    this.#interactionPort?.refreshNodes([], ++this.#interactionGeneration)
    this.#interactionNodes.clear()
    this.#clearOverlayRecords()
    this.#destroyRuntimeHandles()
    this.#destroyComponentHandles()
    this.#destroyVideoHandles()
    const surface = findPublishedFlowSurface(this.#playback, this.#surfaceId)
    const article = renderFlowArticle(surface, {
      playback: this.#playback,
      projectId: this.#playback.courseId,
      components: this.#components,
      resolveAsset: this.#options.resolveAsset,
      dom: this.#root.ownerDocument,
      interactive: true,
      ...(this.#carrierEffects.courseState
        ? { courseState: this.#carrierEffects.courseState }
        : {}),
      ...(this.#carrierEffects.componentActions
        ? { componentActions: this.#carrierEffects.componentActions }
        : {}),
      ...(!this.#active
        ? {
            deferComponentMount: (mount: () => void) => {
              this.#deferredCarrierMounts.push(mount)
            },
          }
        : {}),
      onMountComponent: (handle) => {
        this.#componentHandles.push(handle)
      },
      onLayoutCleanup: cleanup => this.#bodyLayoutCleanups.push(cleanup),
    })
    const effectiveBg = resolveEffectiveBackground({
      owner: 'flow-surface',
      course: this.#playback,
      surface,
    })
    this.#root.style.backgroundColor = effectiveBg.color
    const bgUrl = effectiveBg.assetId
      ? resolvePlaybackAssetUrl(this.#playback, effectiveBg.assetId, this.#options.resolveAsset)
      : null
    if (bgUrl) {
      this.#root.style.backgroundImage = `url(${JSON.stringify(bgUrl)})`
      this.#root.style.backgroundPosition = 'center'
      this.#root.style.backgroundRepeat = 'no-repeat'
      this.#root.style.backgroundSize = 'cover'
    } else {
      this.#root.style.backgroundImage = 'none'
    }
    if (this.#options.playbackView && this.#content) {
      this.#content.style.backgroundColor = this.#root.style.backgroundColor
      this.#content.style.backgroundImage = this.#root.style.backgroundImage
      this.#content.style.backgroundSize = 'cover'
      this.#content.style.backgroundPosition = 'center'
      this.#content.style.backgroundRepeat = 'no-repeat'
      this.#root.style.backgroundImage = 'none'
      this.#root.style.backgroundColor = 'transparent'
    }
    article.addEventListener('scroll', () => {
      this.#syncPaperOverlayPositions(surface)
      this.#options.playbackView?.refreshBounds()
    })
    this.#article?.remove()
    this.#content!.insertBefore(article, this.#surfaceOverlay)
    this.#article = article
    this.#toc?.sync()
    this.#renderOverlay(surface)
    this.#interactionPort?.refreshNodes(
      this.#interactionNodes.values(),
      ++this.#interactionGeneration,
    )
  }

  #syncPaperOverlayPositions(surface: PublishedFlowSurface): void {
    const article = this.#article
    if (!article) return
    const entries = publishedFlowOverlayEntries(this.#playback, surface, this.#locationId)
    const geometry = this.#flowGeometry()
    for (const entry of entries) {
      if (isControllerItem(entry.item)) continue
      if (entry.item.paperSpace !== 'paper') continue
      const wrap = this.#layerPlaneForEntry(entry)?.querySelector<HTMLElement>(
        `[data-flow-overlay-item="${entry.item.layerItemId}"]`,
      )
      if (wrap) {
        const point = geometry.paperToViewport(entry.item.frame)
        wrap.style.left = `${point.x}px`
        wrap.style.top = `${point.y}px`
      }
    }
  }

  #flowGeometry() {
    const root = this.#root
    const article = this.#article
    const paper = article?.querySelector<HTMLElement>('.flow-runtime-reading')
    const size = {
      width: root?.clientWidth || CANVAS_WIDTH,
      height: root?.clientHeight || CANVAS_HEIGHT,
    }
    return createFlowViewportGeometry({
      viewportClientRect: { x: 0, y: 0, ...size },
      layoutViewportSize: size,
      paperOriginLayout: root && article && paper
        ? measureFlowPaperOrigin(root, article, paper, this.#options.playbackView?.state.zoom ?? 1, this.#options.playbackView?.state.pan)
        : { x: 0, y: 0 },
      paperScrollLayout: { x: article?.scrollLeft ?? 0, y: article?.scrollTop ?? 0 },
    })
  }

  #renderOverlay(surface: PublishedFlowSurface, preserve = false): void {
    const overlay = this.#overlay
    if (!overlay || !this.#globalUnderlay || !this.#surfaceUnderlay || !this.#surfaceOverlay) return
    this.#destroyController()
    if (!preserve) for (const plane of this.#layerPlanes()) plane.replaceChildren()
    else for (const plane of this.#layerPlanes()) {
      plane.querySelectorAll('.flow-runtime-teacher-controller-frame').forEach(element => element.remove())
    }
    const entries = publishedFlowOverlayEntries(this.#playback, surface, this.#locationId)
    const visibleIds = new Set(entries.map(entry => entry.item.layerItemId))
    for (const id of this.#interactionNodes.keys()) {
      if (!visibleIds.has(id)) this.#interactionNodes.delete(id)
    }
    for (const [id, record] of this.#overlayRecords) {
      if (!visibleIds.has(id)) this.#removeOverlayRecord(id, record)
    }
    const geometry = this.#flowGeometry()
    for (const entry of entries) {
      if (isControllerItem(entry.item)) {
        this.#interactionNodes.delete(entry.item.layerItemId)
        const wrap = this.#mountTeacherController(
          entry.item,
          entry.source,
          entry.stackOrder,
        )
        if (wrap) this.#registerInteractionNode(wrap, entry.item, entry.source)
        continue
      }
      const targetPlane = this.#layerPlaneForEntry(entry)
      if (!targetPlane) continue
      const existing = this.#overlayRecords.get(entry.item.layerItemId)
      if (existing) {
        existing.wrap.style.zIndex = String(entry.stackOrder)
        // Payload updates rebuild the host. Only location composition varies here.
        this.#registerInteractionNode(existing.wrap, entry.item, entry.source)
        continue
      }
      const effects = this.#carrierSideEffects.createScope()
      const wrap = renderStaticOverlayItem(
        targetPlane.ownerDocument,
        entry,
        (assetId) => resolvePlaybackAssetUrl(this.#playback, assetId, this.#options.resolveAsset),
        {
          projectId: this.#playback.courseId,
          components: this.#components,
          interactive: true,
          audio: this.#audio,
          onMountVideo: handle => this.#videoHandles.push(handle),
          ...(effects.courseState
            ? { courseState: effects.courseState }
            : {}),
          ...(effects.componentActions
            ? { componentActions: effects.componentActions }
            : {}),
          ...(!this.#active
            ? {
                deferComponentMount: (mount: () => void) => {
                  this.#deferredCarrierMounts.push(mount)
                },
              }
            : {}),
          geometry,
          onMountComponent: (handle) => {
            this.#componentHandles.push(handle)
          },
        },
      )
      targetPlane.appendChild(wrap)
      this.#overlayRecords.set(entry.item.layerItemId, { wrap, effects })
      if (isExecutableFlowSurfaceRuntime(entry)) {
        wrap.dataset.flowRuntimeKind = entry.item.runtime.protocol
        wrap.style.pointerEvents = entry.item.hitPolicy === 'auto' ? 'auto' : 'none'
        if (this.#active) this.#mountRuntime(wrap, entry.item, effects)
        else {
          wrap.dataset.flowRuntimeState = 'deferred'
          this.#deferredCarrierMounts.push(() => {
            if (this.#root?.contains(wrap) === true) this.#mountRuntime(wrap, entry.item, effects)
          })
        }
      } else if (entry.item.kind === 'runtime') {
        wrap.dataset.flowRuntimeKind = entry.item.runtime.protocol
        wrap.dataset.flowRuntimeState = entry.item.runtime.enabled ? 'fallback' : 'disabled'
      }
      this.#registerInteractionNode(wrap, entry.item, entry.source)
    }
  }

  #layerPlanes(): HTMLElement[] {
    return [this.#globalUnderlay, this.#surfaceUnderlay, this.#surfaceOverlay, this.#overlay]
      .filter((plane): plane is HTMLElement => plane !== null)
  }

  #layerPlaneForEntry(entry: PublishedFlowOverlayEntry): HTMLElement | null {
    if (isControllerItem(entry.item)) return this.#overlay
    if (entry.source === 'surface') {
      return entry.flowBodyPlane === 'underlay' ? this.#surfaceUnderlay : this.#surfaceOverlay
    }
    return entry.globalPlane === 'underlay' ? this.#globalUnderlay : this.#overlay
  }

  #mountTeacherController(
    item: PublishedTeacherControllerItem,
    source: 'global' | 'surface',
    stackOrder: number,
  ): HTMLElement | null {
    const overlay = this.#controllerPlane ?? this.#overlay
    if (!overlay) return null
    if (this.#playback.playback?.controls === 'none') return null
    const data = controllerGeometryItem(item).config
    const frame = this.#controllerFrame(item)
    const dom = overlay.ownerDocument
    const frameEl = dom.createElement('div')
    frameEl.className = 'flow-runtime-teacher-controller-frame'
    frameEl.dataset.testid = 'flow-runtime-teacher-controller'
    frameEl.dataset.layerItemId = item.layerItemId
    frameEl.dataset.flowOverlayItem = item.layerItemId
    frameEl.dataset.flowOverlaySource = source
    frameEl.style.position = 'absolute'
    const session = this.#controllerSessionFor(item)
    frameEl.style.left = `${frame.x + session.offset.dx}px`
    frameEl.style.top = `${frame.y + session.offset.dy}px`
    frameEl.style.width = `${frame.width}px`
    frameEl.style.height = `${frame.height}px`
    frameEl.style.pointerEvents = 'auto'
    frameEl.style.transform = item.rotation === 0 ? '' : `rotate(${item.rotation}deg)`
    frameEl.style.transformOrigin = 'center center'
    frameEl.style.zIndex = String(stackOrder)
    overlay.appendChild(frameEl)

    const node = teacherControllerHostNode({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, item.rotation)
    const scenes = this.#controllerScenes()
    const options: TeacherControllerHostOptions = {
      navigation: this.#options.navigation,
      playbackView: this.#options.playbackView,
      node: { ...node, flowViewport: true },
      container: frameEl,
      footprintElement: frameEl,
      get canvas() {
        return { width: overlay.clientWidth || CANVAS_WIDTH, height: overlay.clientHeight || CANVAS_HEIGHT }
      },
      getConstraintCanvas: () => {
        const chrome = this.#options.playbackView?.chrome?.controllerInsets
        return { width: (overlay.clientWidth || CANVAS_WIDTH) - (chrome?.right ?? 0),
          height: (overlay.clientHeight || CANVAS_HEIGHT) - (chrome?.bottom ?? 0) }
      },
      onPositionChange: (node, offset) => {
        Object.assign(frameEl.style, { left: `${node.x + offset.dx}px`, top: `${node.y + offset.dy}px`,
          width: `${node.width}px`, height: `${node.height}px` })
      },
      getRenderedStageBounds: () => stageBoundsFromElement(overlay, FLOW_LOGICAL_CANVAS),
      scenes,
      getCurrentSceneId: () => this.#options.courseProgressSource?.getCurrentLocationId()
        ?? this.#surfaceId,
      getStateLabel: () => this.#options.courseProgressSource?.getStateLabel() ?? null,
      getStatus: () => ({
        muted: this.#audio.muted(),
        fullscreen: Boolean(overlay.ownerDocument.fullscreenElement),
      }),
      getSession: () => this.#controllerSessionFor(item),
      onSessionChange: (next) => {
        this.#teacherControllerSession.set({
          controllerId: item.layerItemId,
          surfaceSessionId: this.#surfaceId,
          defaultCollapsed: data.collapsible && data.defaultCollapsed === true,
        }, next)
      },
      onAction: async action => {
      const accepted = await this.#options.executeTeacherControllerAction?.(action)
      if (accepted !== undefined) return accepted
      await this.#handleControllerAction(action)
      return true
      },
      onActionError: (action, error) => { this.#options.reportActionError?.(action, error) },
      getInteractive: () => this.#active,
    }
    this.#controller = new TeacherControllerComponentHost(options, {
      container: frameEl, componentId: item.component.packageId, version: item.component.version,
      instanceId: item.layerItemId, props: item.props, width: frame.width, height: frame.height,
      projectId: this.#playback.courseId, components: this.#components, scope: 'global',
      resolveAsset: id => resolvePlaybackAssetUrl(this.#playback, id, this.#options.resolveAsset),
      interactive: true, mode: 'preview',
    })
    return frameEl
  }

  #controllerSessionFor(item: PublishedTeacherControllerItem): TeacherControllerHostSession {
    const data = controllerGeometryItem(item).config
    return this.#teacherControllerSession.get({
      controllerId: item.layerItemId,
      surfaceSessionId: this.#surfaceId,
      defaultCollapsed: data?.collapsible === true && data.defaultCollapsed === true,
    })
  }

  #controllerFrame(item: PublishedTeacherControllerItem) {
    const overlay = this.#controllerPlane ?? this.#overlay
    return projectFlowComponentControllerFrame(item.frame,
      { width: overlay?.clientWidth || CANVAS_WIDTH, height: overlay?.clientHeight || CANVAS_HEIGHT }, this.#options.playbackView?.chrome?.controllerInsets)
  }

  #syncTeacherControllerSession(geometryOnly = false): void {
    const controller = this.#controller
    if (!controller) return
    const surface = findPublishedFlowSurface(this.#playback, this.#surfaceId)
    const original = publishedFlowOverlayEntries(this.#playback, surface, this.#locationId)
      .map((entry) => entry.item)
      .find(isControllerItem)
    const item = original
    if (!item) return
    const data = controllerGeometryItem(item).config
    const frame = this.#controllerFrame(item)
    const node = { ...teacherControllerHostNode({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, item.rotation), flowViewport: true }
    if (geometryOnly) controller.updateGeometry(node)
    else controller.update(node)
  }

  #destroyController(): void {
    const frame = this.#controller?.rootElement.parentElement
    this.#controller?.destroy()
    if (this.#controllerPlane?.contains(frame ?? null)) frame?.remove()
    this.#controller = null
  }

  #controllerScenes(): TeacherControllerSceneInfo[] {
    if (this.#options.courseProgressSource) {
      return [...this.#options.courseProgressSource.getLocations()]
    }
    return flowSurfaceOrder(this.#playback).map((surfaceId) => {
      const surface = findPublishedFlowSurface(this.#playback, surfaceId)
      return { id: surface.id, name: surface.title }
    })
  }

  async #handleControllerAction(action: TeacherControllerAction): Promise<void> {
    if (!this.#active) return
    if (this.#options.executeTeacherControllerAction) {
      const handled = await this.#options.executeTeacherControllerAction(action)
      if (handled !== undefined) {
        this.#controller?.refreshStatus()
        return
      }
    }
    if (action.type === 'audio.toggle-mute') {
      this.#audio.toggleMuted()
      this.#controller?.refreshStatus()
      return
    }
    if (action.type === 'player.fullscreen.toggle') {
      const dom = this.#root?.ownerDocument
      if (!dom) return
      if (dom.fullscreenElement) await dom.exitFullscreen?.()
      else await this.#root?.requestFullscreen?.()
      this.#controller?.refreshStatus()
      return
    }
    const order = flowSurfaceOrder(this.#playback)
    const index = order.indexOf(this.#surfaceId)
    if (action.type === 'scene.next' && index >= 0 && index < order.length - 1) {
      await this.#goToSurface(order[index + 1]!)
      return
    }
    if (action.type === 'scene.previous' && index > 0) {
      await this.#goToSurface(order[index - 1]!)
      return
    }
    if (action.type === 'scene.go') {
      try {
        const location = resolveFlowLocation(this.#playback, action.sceneId)
        this.#options.onNavigateLocation?.(location.id)
        await this.setLocationId(location.id)
      } catch {
        const match = this.#playback.locations.find((location) => location.id === action.sceneId)
        if (match) {
          this.#options.onNavigateLocation?.(match.id)
          await this.setLocationId(match.id)
        }
      }
      return
    }
    if (action.type === 'course.restart') {
      this.#teacherControllerSession.resetCourse()
      await this.setLocationId(this.#playback.startLocationId)
      return
    }
    if (action.type === 'scene.replay') {
      await this.setLocationId(this.#playback.startLocationId)
    }
  }

  async #goToSurface(surfaceId: string): Promise<void> {
    const locationId = flowPageStartLocationId(this.#playback, surfaceId)
    this.#options.onNavigateLocation?.(locationId)
    await this.setLocationId(locationId)
  }

  async #navigateToc(entry: FlowRuntimeTocEntry): Promise<void> {
    const locationId = entry.locationId ?? (
      entry.kind === 'page'
        ? flowPageStartLocationId(this.#playback, entry.surfaceId)
        : undefined
    )
    if (entry.surfaceId !== this.#surfaceId && locationId) {
      this.#options.onNavigateLocation?.(locationId)
      await this.setLocationId(locationId)
    }
    this.#scrollToAnchor(entry.anchorId)
  }

  #scrollToAnchor(anchorId: string): void {
    const target = this.#article?.querySelector<HTMLElement>(`#${cssEscape(anchorId)}`)
    for (let ancestor = target?.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'DETAILS') (ancestor as HTMLDetailsElement).open = true
    }
    target?.scrollIntoView({ block: 'start' })
  }
}

function tryResolveLocation(
  playback: FlowPublishedPlaybackDocument,
  locationId: string,
): { id: string; surfaceId: string } | null {
  try {
    const location = resolveFlowLocation(playback, locationId)
    return { id: location.id, surfaceId: location.surfaceId }
  } catch {
    return null
  }
}

function createFlowRuntimePlane(
  dom: Document,
  plane: 'global-underlay' | 'surface-underlay' | 'surface-overlay' | 'global-overlay',
  zIndex: number,
  legacyOverlay = false,
): HTMLElement {
  const element = dom.createElement('div')
  element.className = [
    'flow-runtime-layer-plane',
    `flow-runtime-layer-plane--${plane}`,
    legacyOverlay ? 'flow-runtime-overlay' : '',
  ].filter(Boolean).join(' ')
  element.dataset.flowLayerPlane = plane
  element.dataset.testid = legacyOverlay
    ? 'flow-runtime-overlay'
    : `flow-runtime-${plane}`
  Object.assign(element.style, {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    zIndex: String(zIndex),
    pointerEvents: 'none',
    overflow: 'hidden',
  })
  return element
}

export function composePublishedFlowLocation(input: {
  readonly playback: FlowPublishedPlaybackDocument
  readonly locationId: string
}): CourseLayerComposition<PublishedLayerItem> {
  return composePublishedCourseLocation({
    course: input.playback,
    locationId: input.locationId,
    stateId: null,
  })
}

export function publishedFlowOverlayEntries(
  playback: FlowPublishedPlaybackDocument,
  surface: PublishedFlowSurface,
  locationId: string,
): PublishedFlowOverlayEntry[] {
  const composition = composePublishedFlowLocation({ playback, locationId })
  if (composition.surfaceId !== surface.id) {
    throw new Error(`Flow composition surface mismatch: ${composition.surfaceId}`)
  }
  // Playback-hidden nodes stay mounted so Interaction V1 node.enter can reveal them.
  return composition.entries
    .filter((entry) => entry.mounted)
    .map((entry) => ({
      item: entry.item,
      source: entry.source as 'global' | 'surface',
      globalPlane: entry.globalPlane,
      flowBodyPlane: entry.flowBodyPlane,
      stackOrder: entry.stackOrder,
    }))
}


function publishedInteractionOwnership(
  item: PublishedLayerItem,
): PublishedInteractionNodeOwnership {
  if (item.kind === 'component') return 'component'
  if (item.kind === 'runtime') return 'runtime'
  if (item.content.nativeType === 'video') return 'media'
  
  return 'native'
}

function canBindPublishedNativeClick(item: PublishedLayerItem): boolean {
  if (item.kind !== 'native' || item.hitPolicy !== 'auto') return false
  return item.content.nativeType === 'text'
    || item.content.nativeType === 'image'
    || item.content.nativeType === 'formula'
    || item.content.nativeType === 'shape'
}

function isExecutableFlowSurfaceRuntime(
  entry: { item: PublishedLayerItem; source: 'global' | 'surface' },
): entry is { item: PublishedRuntimeLayerItem; source: 'surface' } {
  return entry.source === 'surface'
    && entry.item.kind === 'runtime'
    && entry.item.runtime.enabled
    && entry.item.runtime.protocol === 'surface-runtime'
    && entry.item.runtime.runtimeApiVersion === 3
    && entry.item.runtime.renderMode === 'dom'
}

function firstVisibleRuntimeText(values: Readonly<Record<string, string>>): string | undefined {
  const preferred = ['title', 'label', 'text', 'heading', 'name']
  for (const key of preferred) {
    const value = values[key]?.trim()
    if (value) return value
  }
  return Object.values(values).map((value) => value.trim()).find(Boolean)
}

function renderStaticOverlayItem(
  dom: Document,
  entry: {
    item: PublishedLayerItem
    source: 'global' | 'surface'
    flowBodyPlane?: FlowBodyLayerPlane | null
    stackOrder: number
  },
  resolveAsset: (assetId: string) => string | undefined,
  options?: {
    projectId?: string
    components?: Record<string, PublishedComponentPackageSource>
    interactive?: boolean
    courseState?: CourseStateStoreContract
    componentActions?: Readonly<ComponentHostActions>
    onMountComponent?: (handle: PublishedComponentMountHandle) => void
    onLayoutCleanup?: (cleanup: () => void) => void
    audio?: FlowHostAudioSession
    onMountVideo?: (handle: PublishedNativeVideoHandle) => void
    deferComponentMount?: (mount: () => void) => void
    geometry?: ReturnType<typeof createFlowViewportGeometry>
  },
): HTMLElement {
  const wrap = dom.createElement('div')
  wrap.dataset.flowOverlayItem = entry.item.layerItemId
  wrap.dataset.flowOverlaySource = entry.source
  if (entry.flowBodyPlane) wrap.dataset.flowBodyPlane = entry.flowBodyPlane
  if (entry.item.paperSpace === 'paper') {
    wrap.dataset.flowPaperSpace = 'paper'
  }
  wrap.style.position = 'absolute'
  const point = entry.item.paperSpace === 'paper' && options?.geometry
    ? options.geometry.paperToViewport(entry.item.frame)
    : entry.item.frame
  wrap.style.left = `${point.x}px`
  wrap.style.top = `${point.y}px`
  wrap.style.width = `${entry.item.frame.width}px`
  wrap.style.height = `${entry.item.frame.height}px`
  wrap.style.opacity = String(entry.item.opacity)
  // Paper annotations belong to document scrolling, not observation pan bounds.
  if (entry.item.paperSpace !== 'paper') wrap.dataset.playbackBounds = 'true'
  if (entry.item.kind === 'runtime' || entry.item.kind === 'component') wrap.dataset.layerKind = entry.item.kind
  wrap.style.transform = entry.item.rotation === 0 ? '' : `rotate(${entry.item.rotation}deg)`
  wrap.style.transformOrigin = 'center center'
  wrap.inert = entry.item.hitPolicy !== 'auto'
  const intrinsicallyInteractive = (
    entry.item.kind === 'native' && entry.item.content.nativeType === 'video'
  ) || entry.item.kind === 'component'
  wrap.style.pointerEvents = intrinsicallyInteractive && entry.item.hitPolicy === 'auto'
    ? 'auto'
    : 'none'
  wrap.style.zIndex = String(entry.stackOrder)
  if (entry.item.kind === 'native') {
    const input = nativeRenderInputFromPublishedItem(entry.item)
    paintPublishedNativeRenderInput(wrap, input, { resolveAsset })
    const video = wrap.querySelector('video')
    if (video && input.type === 'video') {
      video.style.pointerEvents = entry.item.hitPolicy === 'auto' ? 'auto' : 'none'
      if (options?.interactive) {
        const handle = mountPublishedNativeVideo(video, input, { audio: options.audio })
        if (handle) options.onMountVideo?.(handle)
      }
    }
    return wrap
  }
  if (entry.item.kind === 'component') {
    const componentItem = entry.item
    const mountInstance = () => {
      const handle = mountPublishedComponent(wrap, {
        container: wrap,
        componentId: componentItem.component.packageId,
        version: componentItem.component.version,
        instanceId: componentItem.layerItemId,
        width: componentItem.frame.width,
        height: componentItem.frame.height,
        props: componentItem.props,
        staticFallbackAssetId: componentItem.staticFallbackAssetId,
        projectId: options?.projectId,
        components: options?.components,
        resolveAsset,
        interactive: (options?.interactive ?? true) && componentItem.hitPolicy === 'auto',
        ...(options?.courseState ? { courseState: options.courseState } : {}),
        ...(options?.componentActions ? { actions: options.componentActions } : {}),
      })
      options?.onMountComponent?.(handle)
    }
    if (options?.deferComponentMount) options.deferComponentMount(() => {
      if (wrap.isConnected) mountInstance()
    })
    else mountInstance()
    return wrap
  }
  const fallback = entry.item.kind === 'runtime'
    ? entry.item.runtime.staticFallback?.assetId
    : undefined
  if (fallback) {
    const url = resolveAsset(fallback)
    if (url) {
      const image = dom.createElement('img')
      image.src = url
      image.alt = ''
      image.style.width = '100%'
      image.style.height = '100%'
      image.style.objectFit = 'contain'
      wrap.appendChild(image)
      return wrap
    }
  }
  if (entry.item.kind === 'runtime') {
    const label = dom.createElement('div')
    label.className = 'published-surface-runtime-fallback'
    label.dataset.runtimeInstanceId = entry.item.layerItemId
    label.dataset.runtimeFallback = 'true'
    label.textContent = firstVisibleRuntimeText(entry.item.runtime.content.values)
      ?? entry.item.runtime.protocol
    Object.assign(label.style, {
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      padding: '12px 16px',
      pointerEvents: 'none',
      background: '#0f766e',
      color: '#ffffff',
      font: 'bold 16px "Microsoft YaHei", sans-serif',
      textAlign: 'center',
    })
    wrap.appendChild(label)
  }
  return wrap
}

function renderFlowArticle(
  surface: PublishedFlowSurface,
  options: {
    playback: FlowPublishedPlaybackDocument
    projectId?: string
    components?: Record<string, PublishedComponentPackageSource>
    resolveAsset?: (assetId: string) => string | undefined
    dom: Document
    interactive?: boolean
    courseState?: CourseStateStoreContract
    componentActions?: Readonly<ComponentHostActions>
    onMountComponent?: (handle: PublishedComponentMountHandle) => void
    onLayoutCleanup?: (cleanup: () => void) => void
    deferComponentMount?: (mount: () => void) => void
  },
): HTMLElement {
  const { dom } = options
  const article = dom.createElement('article')
  article.className = 'flow-runtime-article flow-media-query-root'
  article.dataset.testid = 'flow-runtime-article'
  article.dataset.flowPaperScroll = 'true'
  article.dataset.flowMediaQueryRoot = 'true'
  article.id = flowRuntimeTocPageAnchorId(surface.id)
  article.style.boxSizing = 'border-box'
  article.style.position = 'relative'
  article.style.zIndex = '2'
  article.style.height = '100%'
  article.style.overflow = 'auto'
  article.style.pointerEvents = 'auto'
  article.style.overscrollBehavior = 'contain'
  article.style.setProperty('container-type', FLOW_MEDIA_QUERY_CONTAINER_TYPE)
  article.style.setProperty('container-name', 'flow-media-root')
  article.style.background = 'transparent'
  article.style.padding = FLOW_BODY_SCROLL_PADDING
  article.style.color = '#172033'

  article.addEventListener('wheel', (event: WheelEvent) => {
    if (event.ctrlKey || event.defaultPrevented || playbackGestureOccupied(event.target, article)) return
    const maxScroll = Math.max(0, article.scrollHeight - article.clientHeight)
    if (maxScroll <= 0) return
    const prevScroll = article.scrollTop
    const nextScroll = Math.min(Math.max(0, prevScroll + event.deltaY), maxScroll)
    if (nextScroll !== prevScroll) {
      article.scrollTop = nextScroll
      event.preventDefault()
    }
  }, { passive: false })

  let isDragging = false
  let dragStartY = 0
  let dragStartScroll = 0
  let activePointerId = -1

  article.addEventListener('touchstart', event => { if (event.touches.length > 1) isDragging = false }, { passive: true })

  article.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || event.defaultPrevented || playbackGestureOccupied(event.target, article)) return
    isDragging = true
    dragStartY = event.clientY
    dragStartScroll = article.scrollTop
    activePointerId = event.pointerId
    try {
      if (typeof article.setPointerCapture === 'function') {
        article.setPointerCapture(event.pointerId)
      }
    } catch {
      // ignore
    }
  })

  article.addEventListener('pointermove', (event: PointerEvent) => {
    if (!isDragging || event.pointerId !== activePointerId) return
    const maxScroll = Math.max(0, article.scrollHeight - article.clientHeight)
    const targetScroll = Math.min(Math.max(0, dragStartScroll - (event.clientY - dragStartY)), maxScroll)
    article.scrollTop = targetScroll
  })

  const endDrag = (event: PointerEvent) => {
    if (isDragging && event.pointerId === activePointerId) {
      isDragging = false
      activePointerId = -1
      try {
        if (typeof article.releasePointerCapture === 'function') {
          article.releasePointerCapture(event.pointerId)
        }
      } catch {
        // ignore
      }
    }
  }

  article.addEventListener('pointerup', endDrag)
  article.addEventListener('pointercancel', endDrag)

  const reading = dom.createElement('div')
  reading.className = 'flow-runtime-reading flow-body-content'
  reading.style.maxWidth = flowPaperMaxWidth(surface.layout)
  reading.style.width = '100%'
  reading.style.margin = '0 auto'
  reading.style.padding = FLOW_BODY_PAPER_PADDING
  const typography = dom.createElement('style')
  typography.textContent = FLOW_BODY_CSS
  article.appendChild(typography)
  article.appendChild(reading)

  for (const block of surface.blocks) {
    renderBlockDom(block, reading, {
      ...options,
      widthMode: surface.layout.widthMode,
      readingWidth: surface.layout.readingWidth,
      wideContentWidth: surface.layout.wideContentWidth,
    })
  }

  const clearEnd = dom.createElement('div')
  clearEnd.style.clear = 'both'
  clearEnd.setAttribute('aria-hidden', 'true')
  reading.appendChild(clearEnd)

  return article
}

/** Repaint only static content. Dynamic hosts receive resize without remounting. */
function observeFlowBlockWidth(element: HTMLElement, resize: (width: number) => void, register?: (cleanup: () => void) => void): void {
  if (typeof ResizeObserver !== 'function') return
  let previous = 0
  const observer = new ResizeObserver(() => {
    const width = element.clientWidth
    if (width <= 0 || width === previous) return
    previous = width
    resize(width)
  })
  observer.observe(element)
  register?.(() => observer.disconnect())
}

function renderBlockDom(
  block: FlowBlock,
  parent: HTMLElement,
  options: {
    playback: FlowPublishedPlaybackDocument
    projectId?: string
    components?: Record<string, PublishedComponentPackageSource>
    resolveAsset?: (assetId: string) => string | undefined
    dom: Document
    widthMode?: 'fluid' | 'reading'
    readingWidth?: number
    wideContentWidth?: number
    interactive?: boolean
    courseState?: CourseStateStoreContract
    componentActions?: Readonly<ComponentHostActions>
    onMountComponent?: (handle: PublishedComponentMountHandle) => void
    onLayoutCleanup?: (cleanup: () => void) => void
    deferComponentMount?: (mount: () => void) => void
  },
): void {
  const dom = parent.ownerDocument
  const assignBlock = <T extends HTMLElement>(element: T): T => {
    element.dataset.flowBlockId = block.id
    element.dataset.flowBlockType = block.type
    element.dataset.flowBodyBlock = block.type
    return element
  }

  switch (block.type) {
    case 'heading': {
      const heading = assignBlock(dom.createElement(`h${block.level}`))
      heading.id = flowRuntimeTocAnchorId(block.id)
      heading.dataset.flowTocAnchor = block.id
      applyFlowBlockTypography(heading, block)
      appendRichText(heading, block.text, block.runs)
      parent.appendChild(heading)
      return
    }
    case 'paragraph': {
      const paragraph = assignBlock(dom.createElement('p'))
      applyFlowBlockTypography(paragraph, block)
      appendRichText(paragraph, block.text, block.runs)
      parent.appendChild(paragraph)
      return
    }
    case 'quote': {
      const quote = assignBlock(dom.createElement('blockquote'))
      applyFlowBlockTypography(quote, block)
      const paragraph = dom.createElement('p')
      appendRichText(paragraph, block.text, block.runs)
      quote.appendChild(paragraph)
      if (block.citation) {
        const cite = dom.createElement('cite')
        cite.textContent = block.citation
        quote.appendChild(cite)
      }
      parent.appendChild(quote)
      return
    }
    case 'list': {
      const list = assignBlock(dom.createElement(block.ordered ? 'ol' : 'ul'))
      for (const item of block.items) {
        const listItem = dom.createElement('li')
        listItem.dataset.flowListItemId = item.id
        appendRichText(listItem, item.text, item.runs)
        list.appendChild(listItem)
      }
      parent.appendChild(list)
      return
    }
    case 'divider':
      parent.appendChild(assignBlock(dom.createElement('hr')))
      return
    case 'media': {
      const figure = assignBlock(dom.createElement('figure'))
      figure.dataset.flowMediaLayout = block.layout
      const readingWidth = options.readingWidth ?? 760
      const wideContentWidth = options.wideContentWidth ?? 1120
      const projection = resolveFlowMediaLayoutProjection(block.layout, {
        widthMode: options.widthMode,
        readingWidth,
        wideContentWidth,
      })
      figure.className = `flow-block-media ${projection.className}`
      figure.dataset.flowMediaWidthTier = projection.tier

      if (block.wrap === 'left') {
        figure.style.width = projection.wrappedOuterInlineSize
        figure.style.maxWidth = '100%'
        figure.style.inlineSize = projection.wrappedOuterInlineSize
        figure.style.maxInlineSize = '100%'
        figure.style.float = 'left'
        figure.style.margin = '0 16px 8px 0'
        figure.dataset.flowMediaInlineSize = projection.wrappedOuterInlineSize
      } else if (block.wrap === 'right') {
        figure.style.width = projection.wrappedOuterInlineSize
        figure.style.maxWidth = '100%'
        figure.style.inlineSize = projection.wrappedOuterInlineSize
        figure.style.maxInlineSize = '100%'
        figure.style.float = 'right'
        figure.style.margin = '0 0 8px 16px'
        figure.dataset.flowMediaInlineSize = projection.wrappedOuterInlineSize
      } else {
        figure.style.setProperty(FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY, projection.inlineSize)
        figure.style.width = FLOW_MEDIA_INLINE_SIZE_REFERENCE
        figure.style.maxWidth = FLOW_MEDIA_INLINE_SIZE_REFERENCE
        figure.style.float = 'none'
        figure.style.margin = '0'
        figure.style.position = 'relative'
        figure.style.left = '50%'
        figure.style.transform = 'translateX(-50%)'
        figure.style.inlineSize = FLOW_MEDIA_INLINE_SIZE_REFERENCE
        figure.style.maxInlineSize = FLOW_MEDIA_INLINE_SIZE_REFERENCE
        figure.dataset.flowMediaInlineSize = projection.inlineSize
      }

      const url = resolvePlaybackAssetUrl(options.playback, block.assetId, options.resolveAsset)
      if (block.mediaKind === 'image' && url) {
        const image = dom.createElement('img')
        image.src = url
        image.alt = block.altText ?? ''
        image.style.maxWidth = '100%'
        figure.appendChild(image)
      } else if (block.mediaKind === 'audio' && url) {
        const audio = dom.createElement('audio')
        audio.controls = true
        audio.src = url
        figure.appendChild(audio)
      } else if (block.mediaKind === 'video' && url) {
        const video = dom.createElement('video')
        video.controls = true
        video.src = url
        video.style.maxWidth = '100%'
        figure.appendChild(video)
      } else {
        const fallback = dom.createElement('p')
        fallback.textContent = `[媒体后备：${block.altText ?? block.caption ?? block.assetId}]`
        figure.appendChild(fallback)
      }
      if (block.caption) {
        const caption = dom.createElement('figcaption')
        caption.textContent = block.caption
        figure.appendChild(caption)
      }
      parent.appendChild(figure)
      return
    }
    case 'chart': {
      const figure = assignBlock(dom.createElement('figure'))
      figure.style.width = '100%'
      figure.style.height = `${block.height}px`
      const paint = (width: number) => {
        figure.innerHTML = buildNativeChartSvg(block.chart, Math.max(240, width), block.height, block.id)
      }
      paint((options.readingWidth ?? 760) - 72)
      parent.appendChild(figure)
      observeFlowBlockWidth(figure, paint, options.onLayoutCleanup)
      break
    }
    case 'table': {
      const figure = assignBlock(dom.createElement('figure'))
      if (block.caption) {
        const caption = dom.createElement('figcaption')
        caption.textContent = block.caption
        figure.appendChild(caption)
      }
      const table = dom.createElement('table')
      const thead = dom.createElement('thead')
      const headerRow = dom.createElement('tr')
      for (const column of block.columns) {
        const cell = dom.createElement('th')
        cell.dataset.flowColumnId = column.id
        cell.textContent = column.header
        headerRow.appendChild(cell)
      }
      thead.appendChild(headerRow)
      table.appendChild(thead)
      const tbody = dom.createElement('tbody')
      for (const row of block.rows) {
        const tr = dom.createElement('tr')
        tr.dataset.flowRowId = row.id
        for (const column of block.columns) {
          const span = tableCellSpan(block, row.id, column.id)
          if (span.covered) continue
          const cell = dom.createElement('td')
          cell.rowSpan = span.rowSpan
          cell.colSpan = span.columnSpan
          const content = row.cells[column.id]
          appendRichText(cell, flowTableCellText(content), typeof content === 'object' ? content.runs : undefined)
          tr.appendChild(cell)
        }
        tbody.appendChild(tr)
      }
      table.appendChild(tbody)
      figure.appendChild(table)
      parent.appendChild(figure)
      return
    }
    case 'formula': {
      const wrap = assignBlock(dom.createElement('div'))
      wrap.dataset.flowFormulaId = block.formulaId
      const readingWidth = Math.max(160, options.readingWidth ?? 760)
      const paint = {
        formulaId: block.formulaId,
        accessibleText: block.accessibleText,
        ast: block.ast,
        style: { fontSize: 32, color: '#1f2937', align: 'left' as const },
        width: readingWidth,
        height: 96,
      }
      const size = fittedPublishedFormulaSize(paint)
      wrap.style.width = '100%'
      wrap.style.height = `${size.height}px`
      wrap.style.overflow = 'hidden'
      paintPublishedFormula(wrap, { ...paint, height: size.height })
      parent.appendChild(wrap)
      observeFlowBlockWidth(wrap, width => {
        const next = { ...paint, width: Math.max(160, width) }
        const fitted = fittedPublishedFormulaSize(next)
        wrap.style.height = `${fitted.height}px`
        paintPublishedFormula(wrap, { ...next, height: fitted.height })
      }, options.onLayoutCleanup)
      return
    }
    case 'code': {
      const pre = assignBlock(dom.createElement('pre'))
      const code = dom.createElement('code')
      code.textContent = block.code
      pre.appendChild(code)
      parent.appendChild(pre)
      return
    }
    case 'callout': {
      const aside = assignBlock(dom.createElement('aside'))
      aside.dataset.flowCalloutTone = block.tone
      if (block.title) {
        const title = dom.createElement('strong')
        title.textContent = block.title
        aside.appendChild(title)
      }
      const body = dom.createElement('p')
      body.textContent = block.body
      aside.appendChild(body)
      parent.appendChild(aside)
      return
    }
    case 'section': {
      const section = assignBlock(dom.createElement('details'))
      section.open = !block.collapsedByDefault
      section.id = flowRuntimeTocAnchorId(block.id)
      section.dataset.flowTocAnchor = block.id
      const title = dom.createElement('summary')
      title.textContent = block.title
      section.appendChild(title)
      const contents = dom.createElement('div')
      contents.className = 'flow-section-content'
      for (const child of block.blocks) renderBlockDom(child, contents, options)
      section.appendChild(contents)
      parent.appendChild(section)
      return
    }
    case 'component': {
      const figure = assignBlock(dom.createElement('figure'))
      figure.className = 'flow-block-component'
      figure.style.position = 'relative'
      figure.style.minHeight = '240px'
      if (block.wrap === 'left') {
        figure.style.width = '48%'
        figure.style.float = 'left'
        figure.style.margin = '0 16px 8px 0'
      } else if (block.wrap === 'right') {
        figure.style.width = '48%'
        figure.style.float = 'right'
        figure.style.margin = '0 0 8px 16px'
      } else {
        figure.style.width = '100%'
        figure.style.float = 'none'
      }
      const mountInstance = () => {
        const handle = mountPublishedComponent(figure, {
          container: figure,
          componentId: block.component.packageId,
          version: block.component.version,
          instanceId: block.id,
          width: figure.clientWidth || options.readingWidth || 760,
          height: 320,
          props: block.props,
          staticFallbackAssetId: block.staticFallbackAssetId,
          projectId: options.projectId,
          components: options.components,
          resolveAsset: (assetId) => resolvePlaybackAssetUrl(options.playback, assetId, options.resolveAsset),
          interactive: options.interactive ?? true,
          ...(options.courseState ? { courseState: options.courseState } : {}),
          ...(options.componentActions ? { actions: options.componentActions } : {}),
        })
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
          if (figure.clientWidth > 0) handle.resize(figure.clientWidth, 320)
        }) : null
        observer?.observe(figure)
        const destroy = handle.destroy.bind(handle)
        handle.destroy = () => { observer?.disconnect(); destroy() }
        options.onMountComponent?.(handle)
      }
      if (options.deferComponentMount) options.deferComponentMount(mountInstance)
      else mountInstance()
      parent.appendChild(figure)
      return
    }
  }
}

function applyFlowBlockTypography(
  element: HTMLElement,
  block: { textAlign?: 'left' | 'center' | 'right'; lineSpacing?: number },
): void {
  const presentation = resolveFlowParagraphPresentation(block)
  element.style.textAlign = presentation.textAlign
  element.style.lineHeight = String(presentation.lineHeight)
}

function appendRichText(
  element: HTMLElement,
  text: string,
  runs?: TextRun[],
): void {
  const content = element.ownerDocument.createElement('span')
  content.dataset.flowPublishedRichText = 'true'
  content.innerHTML = buildFlowRichTextHtml(text, runs)
  element.appendChild(content)
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1')
}
