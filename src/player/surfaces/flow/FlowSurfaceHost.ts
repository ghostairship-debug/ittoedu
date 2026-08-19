import { resolveCourseSurfaceBackgroundColor } from '../../../shared/courseProjectModel'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../../shared/constants'
import type { TeacherControllerAction, TextRun } from '../../../shared/projectTypes'
import type { CourseAudioApi } from '../../AudioManager'
import type { FlowBlock } from '../../../shared/courseProjectTypes'
import { isGlobalLayerItemVisible } from '../../globalLayerVisibility'
import {
  TeacherControllerDom,
  stageBoundsFromElement,
  teacherControllerDomNode,
  type TeacherControllerDomSession,
} from '../../teacherControllerDom'
import type { TeacherControllerSceneInfo } from '../../../shared/teacherControllerLayout'
import type {
  PublishedFlowSurface,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedScopedLayerItem,
} from '../../../shared/publishedCourseTypes'
import {
  FLOW_LOGICAL_CANVAS,
  cloneJson,
  findPublishedFlowSurface,
  flowPageStartLocationId,
  flowRichTextSegments,
  flowSurfaceOrder,
  flowTableCellText,
  resolveFlowLocation,
  resolvePlaybackAssetUrl,
  toFlowPublishedPlayback,
  type FlowPublishedPlaybackDocument,
  type FlowPublishedPlaybackSource,
} from './flowModel'
import {
  FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX,
  FlowRuntimeTocChrome,
  buildFlowRuntimeToc,
  flowRuntimeTocAnchorId,
  flowRuntimeTocPageAnchorId,
  type FlowRuntimeTocEntry,
} from './flowRuntimeToc'
import {
  mountPublishedComponent,
  type PublishedComponentMountHandle,
  type PublishedComponentPackageSource,
} from '../publishedComponentMount'
import { fittedPublishedFormulaSize, paintPublishedFormula } from '../publishedFormula'

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
  components?: Record<string, PublishedComponentPackageSource>
  audio?: Pick<CourseAudioApi, 'muted' | 'setMuted' | 'toggleMuted'>
  executeTeacherControllerAction?: (
    action: TeacherControllerAction,
  ) => boolean | void | Promise<boolean | void>
  onNavigateLocation?: (locationId: string) => void
  courseProgressSource?: FlowCourseProgressSource
}

export interface FlowHostAudioSession {
  muted(): boolean
  setMuted(value: boolean): void
  toggleMuted(): boolean
}

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
  #container: HTMLElement | null = null
  #root: HTMLElement | null = null
  #article: HTMLElement | null = null
  #overlay: HTMLElement | null = null
  #toc: FlowRuntimeTocChrome | null = null
  #controller: TeacherControllerDom | null = null
  #controllerSessions = new Map<string, TeacherControllerDomSession>()
  #componentHandles: PublishedComponentMountHandle[] = []
  #active = false
  #queue: Promise<void> = Promise.resolve()

  constructor(source: FlowPublishedPlaybackSource, options: FlowSurfaceHostOptions = {}) {
    this.#playback = toFlowPublishedPlayback(source)
    this.#components = ('components' in source && source.components
      ? source.components as Record<string, PublishedComponentPackageSource>
      : undefined) ?? options.components
    this.#options = { ...options }
    this.#audio = options.audio ?? createFlowHostAudioSession(
      this.#playback.media?.audio.defaultMuted === true,
    )
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

  setTocOpen(open: boolean): void {
    this.#toc?.setOpen(open)
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
      root.style.width = `${CANVAS_WIDTH}px`
      root.style.height = `${CANVAS_HEIGHT}px`
      root.style.minHeight = `${CANVAS_HEIGHT}px`
      root.style.overflow = 'hidden'
      root.style.setProperty('--flow-toc-inset', '0px')
      root.hidden = !this.#active

      const overlay = dom.createElement('div')
      overlay.className = 'flow-runtime-overlay'
      overlay.dataset.testid = 'flow-runtime-overlay'
      overlay.style.position = 'absolute'
      overlay.style.top = '0'
      overlay.style.right = '0'
      overlay.style.bottom = '0'
      overlay.style.left = '0'
      overlay.style.zIndex = '20'
      overlay.style.pointerEvents = 'none'
      overlay.style.overflow = 'hidden'
      root.appendChild(overlay)

      container.appendChild(root)
      this.#root = root
      this.#overlay = overlay
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
    })
  }

  async activate(): Promise<void> {
    this.#active = true
    if (this.#root) this.#root.hidden = false
  }

  async suspend(): Promise<void> {
    this.#active = false
    if (this.#root) this.#root.hidden = true
  }

  async resume(): Promise<void> {
    return this.activate()
  }

  setLocationId(locationId: string): Promise<void> {
    return this.#enqueue(async () => {
      const location = resolveFlowLocation(this.#playback, locationId)
      this.#locationId = location.id
      this.#surfaceId = location.surfaceId
      if (this.#root) this.#root.dataset.surfaceId = this.#surfaceId
      this.#render()
      this.#applyShellLayout()
      this.#scrollToAnchor(
        location.blockId
          ? flowRuntimeTocAnchorId(location.blockId)
          : flowRuntimeTocPageAnchorId(location.surfaceId),
      )
    })
  }

  updatePublishedCourse(source: FlowPublishedPlaybackSource): Promise<void> {
    return this.#enqueue(async () => {
      this.#playback = toFlowPublishedPlayback(source)
      if ('components' in source && source.components) {
        this.#components = source.components as Record<string, PublishedComponentPackageSource>
      }
      if (!this.#playback.surfaces.some((surface) => surface.id === this.#surfaceId)) {
        this.#surfaceId = this.#playback.surfaces[0]!.id
        this.#locationId = flowPageStartLocationId(this.#playback, this.#surfaceId)
      }
      if (this.#root) this.#root.dataset.surfaceId = this.#surfaceId
      this.#render()
      this.#toc?.sync()
      this.#applyShellLayout()
    })
  }

  destroy(): Promise<void> {
    return this.#enqueue(async () => {
      this.#destroyComponentHandles()
      this.#destroyController()
      this.#toc?.destroy()
      this.#toc = null
      this.#root?.remove()
      this.#root = null
      this.#article = null
      this.#overlay = null
      this.#container = null
      this.#active = false
    })
  }

  #destroyComponentHandles(): void {
    for (const handle of this.#componentHandles) {
      try {
        handle.destroy()
      } catch (error) {
        console.error('Flow 组件销毁失败', error)
      }
    }
    this.#componentHandles = []
  }

  #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(() => undefined, () => undefined)
    return result
  }

  #applyShellLayout(): void {
    const inset = this.tocOpen ? `${FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX}px` : '0px'
    if (this.#article) this.#article.style.marginLeft = inset
    if (this.#overlay) this.#overlay.style.left = inset
  }

  #render(): void {
    if (!this.#root || !this.#overlay) return
    this.#destroyComponentHandles()
    const surface = findPublishedFlowSurface(this.#playback, this.#surfaceId)
    const article = renderFlowArticle(surface, {
      playback: this.#playback,
      components: this.#components,
      resolveAsset: this.#options.resolveAsset,
      dom: this.#root.ownerDocument,
      interactive: this.#active,
      onMountComponent: (handle) => {
        this.#componentHandles.push(handle)
      },
    })
    this.#article?.remove()
    this.#root.insertBefore(article, this.#overlay)
    this.#article = article
    this.#toc?.sync()
    this.#renderOverlay(surface)
  }

  #renderOverlay(surface: PublishedFlowSurface): void {
    const overlay = this.#overlay
    if (!overlay) return
    this.#destroyController()
    overlay.replaceChildren()
    const entries = visibleOverlayEntries(this.#playback, surface, this.#locationId)
    for (const entry of entries) {
      if (isPublishedTeacherController(entry.item)) {
        this.#mountTeacherController(entry.item)
        continue
      }
      overlay.appendChild(renderStaticOverlayItem(
        overlay.ownerDocument,
        entry,
        (assetId) => resolvePlaybackAssetUrl(this.#playback, assetId, this.#options.resolveAsset),
        {
          components: this.#components,
          interactive: this.#active,
          onMountComponent: (handle) => {
            this.#componentHandles.push(handle)
          },
        },
      ))
    }
  }

  #mountTeacherController(item: PublishedNativeLayerItem): void {
    const overlay = this.#overlay
    if (!overlay || item.content.nativeType !== 'teacher-controller') return
    if (this.#playback.playback?.controls === 'none') return
    const data = item.content.data
    const frame = item.frame
    const dom = overlay.ownerDocument
    const frameEl = dom.createElement('div')
    frameEl.className = 'flow-runtime-teacher-controller-frame'
    frameEl.dataset.testid = 'flow-runtime-teacher-controller'
    frameEl.dataset.layerItemId = item.layerItemId
    frameEl.style.position = 'absolute'
    const session = this.#controllerSessions.get(item.layerItemId) ?? {
      offset: { dx: 0, dy: 0 },
      collapsed: data.defaultCollapsed === true,
    }
    if (!this.#controllerSessions.has(item.layerItemId)) {
      this.#controllerSessions.set(item.layerItemId, session)
    }
    frameEl.style.left = `${frame.x + session.offset.dx}px`
    frameEl.style.top = `${frame.y + session.offset.dy}px`
    frameEl.style.width = `${frame.width}px`
    frameEl.style.height = `${frame.height}px`
    frameEl.style.pointerEvents = 'auto'
    frameEl.style.zIndex = String(item.order)
    overlay.appendChild(frameEl)

    const node = teacherControllerDomNode(
      { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      item.rotation,
      {
        title: data.title,
        compact: data.compact,
        showSceneProgress: data.showSceneProgress,
        collapsible: data.collapsible,
        buttons: data.buttons,
        style: data.style,
      },
    )
    const scenes = this.#controllerScenes()
    this.#controller = new TeacherControllerDom({
      node,
      container: frameEl,
      canvas: { ...FLOW_LOGICAL_CANVAS },
      getRenderedStageBounds: () => stageBoundsFromElement(overlay, FLOW_LOGICAL_CANVAS),
      scenes,
      getCurrentSceneId: () => this.#options.courseProgressSource?.getCurrentLocationId()
        ?? this.#surfaceId,
      getStateLabel: () => this.#options.courseProgressSource?.getStateLabel() ?? null,
      getStatus: () => ({
        muted: this.#audio.muted(),
        fullscreen: Boolean(overlay.ownerDocument.fullscreenElement),
      }),
      getSession: () => this.#controllerSessions.get(item.layerItemId) ?? {
        offset: { dx: 0, dy: 0 },
        collapsed: false,
      },
      onSessionChange: (next) => {
        this.#controllerSessions.set(item.layerItemId, next)
        frameEl.style.left = `${frame.x + next.offset.dx}px`
        frameEl.style.top = `${frame.y + next.offset.dy}px`
      },
      onAction: (action) => {
        void this.#handleControllerAction(action)
      },
      getInteractive: () => this.#active,
    })
  }

  #destroyController(): void {
    this.#controller?.destroy()
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
    if (this.#options.executeTeacherControllerAction) {
      const handled = await this.#options.executeTeacherControllerAction(action)
      if (handled !== false) {
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
    if (action.type === 'course.restart' || action.type === 'scene.replay') {
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

function createFlowHostAudioSession(defaultMuted: boolean): FlowHostAudioSession {
  let muted = defaultMuted
  return {
    muted: () => muted,
    setMuted: (value) => {
      muted = value
    },
    toggleMuted: () => {
      muted = !muted
      return muted
    },
  }
}

function visibleOverlayEntries(
  playback: FlowPublishedPlaybackDocument,
  surface: PublishedFlowSurface,
  locationId: string,
): Array<{ item: PublishedLayerItem; source: 'global' | 'surface' }> {
  const entries: Array<{ item: PublishedLayerItem; source: 'global' | 'surface'; order: number }> = []
  const push = (list: readonly PublishedScopedLayerItem[], source: 'global' | 'surface') => {
    for (const entry of list) {
      if (!isPublishedScopedVisible(entry, locationId)) continue
      if (!entry.item.visible || entry.item.playbackInitialVisibility === 'hidden') continue
      entries.push({ item: entry.item, source, order: entry.item.order })
    }
  }
  push(playback.globalLayerItems, 'global')
  push(surface.surfaceLayerItems, 'surface')
  return entries
    .sort((left, right) => left.order - right.order || left.item.layerItemId.localeCompare(right.item.layerItemId))
    .map(({ item, source }) => ({ item, source }))
}

function isPublishedScopedVisible(entry: PublishedScopedLayerItem, locationId: string): boolean {
  return isGlobalLayerItemVisible(
    { visibility: { mode: entry.visibility.mode, sceneIds: entry.visibility.locationIds } },
    locationId,
  )
}

function isPublishedTeacherController(
  item: PublishedLayerItem,
): item is PublishedNativeLayerItem & {
  content: Extract<PublishedNativeLayerItem['content'], { nativeType: 'teacher-controller' }>
} {
  return item.kind === 'native' && item.content.nativeType === 'teacher-controller'
}

function renderStaticOverlayItem(
  dom: Document,
  entry: { item: PublishedLayerItem; source: 'global' | 'surface' },
  resolveAsset: (assetId: string) => string | undefined,
  options?: {
    components?: Record<string, PublishedComponentPackageSource>
    interactive?: boolean
    onMountComponent?: (handle: PublishedComponentMountHandle) => void
  },
): HTMLElement {
  const wrap = dom.createElement('div')
  wrap.dataset.flowOverlayItem = entry.item.layerItemId
  wrap.dataset.flowOverlaySource = entry.source
  wrap.style.position = 'absolute'
  wrap.style.left = `${entry.item.frame.x}px`
  wrap.style.top = `${entry.item.frame.y}px`
  wrap.style.width = `${entry.item.frame.width}px`
  wrap.style.height = `${entry.item.frame.height}px`
  wrap.style.opacity = String(entry.item.opacity)
  wrap.style.pointerEvents = (entry.item.kind === 'native' && entry.item.content.nativeType === 'video')
    || entry.item.kind === 'component'
    ? 'auto'
    : 'none'
  wrap.style.zIndex = String(entry.item.order)
  if (entry.item.kind === 'native' && entry.item.content.nativeType === 'image') {
    const url = resolveAsset(entry.item.content.data.assetId)
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
  if (entry.item.kind === 'native' && entry.item.content.nativeType === 'video') {
    const url = resolveAsset(entry.item.content.data.assetId)
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
    return wrap
  }
  if (entry.item.kind === 'native' && entry.item.content.nativeType === 'text') {
    wrap.textContent = entry.item.content.data.text
    return wrap
  }
  if (entry.item.kind === 'native' && entry.item.content.nativeType === 'formula') {
    wrap.style.boxSizing = 'border-box'
    wrap.style.overflow = 'hidden'
    paintPublishedFormula(wrap, {
      formulaId: entry.item.content.data.formulaId,
      accessibleText: entry.item.content.data.accessibleText,
      ast: entry.item.content.data.ast,
      style: entry.item.content.data.style,
      width: Math.max(1, entry.item.frame.width),
      height: Math.max(1, entry.item.frame.height),
    })
    return wrap
  }
  if (entry.item.kind === 'component') {
    const handle = mountPublishedComponent(wrap, {
      container: wrap,
      componentId: entry.item.component.packageId,
      version: entry.item.component.version,
      instanceId: entry.item.layerItemId,
      width: entry.item.frame.width,
      height: entry.item.frame.height,
      props: entry.item.props,
      staticFallbackAssetId: entry.item.staticFallbackAssetId,
      components: options?.components,
      resolveAsset,
      interactive: options?.interactive ?? true,
    })
    options?.onMountComponent?.(handle)
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
    }
  }
  return wrap
}

function renderFlowArticle(
  surface: PublishedFlowSurface,
  options: {
    playback: FlowPublishedPlaybackDocument
    components?: Record<string, PublishedComponentPackageSource>
    resolveAsset?: (assetId: string) => string | undefined
    dom: Document
    interactive?: boolean
    onMountComponent?: (handle: PublishedComponentMountHandle) => void
  },
): HTMLElement {
  const { dom } = options
  const article = dom.createElement('article')
  article.className = 'flow-runtime-article'
  article.dataset.testid = 'flow-runtime-article'
  article.dataset.flowPaperScroll = 'true'
  article.id = flowRuntimeTocPageAnchorId(surface.id)
  article.style.boxSizing = 'border-box'
  article.style.height = '100%'
  article.style.overflow = 'auto'
  article.style.pointerEvents = 'auto'
  article.style.overscrollBehavior = 'contain'
  article.style.background = resolveCourseSurfaceBackgroundColor(surface.backgroundColor)
  article.style.color = '#172033'

  article.addEventListener('wheel', (event: WheelEvent) => {
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

  article.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target && typeof target.closest === 'function') {
      if (target.closest('video, audio, button, a, input, textarea, [data-flow-interactive]')) {
        return
      }
    }
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
  reading.className = 'flow-runtime-reading'
  reading.style.maxWidth = `${surface.layout.readingWidth}px`
  reading.style.margin = '0 auto'
  reading.style.padding = '24px 32px 120px'
  article.appendChild(reading)

  for (const block of surface.blocks) {
    renderBlockDom(block, reading, {
      ...options,
      readingWidth: surface.layout.readingWidth,
      wideContentWidth: surface.layout.wideContentWidth,
    })
  }
  return article
}

function renderBlockDom(
  block: FlowBlock,
  parent: HTMLElement,
  options: {
    playback: FlowPublishedPlaybackDocument
    components?: Record<string, PublishedComponentPackageSource>
    resolveAsset?: (assetId: string) => string | undefined
    dom: Document
    readingWidth?: number
    wideContentWidth?: number
    interactive?: boolean
    onMountComponent?: (handle: PublishedComponentMountHandle) => void
  },
): void {
  const dom = parent.ownerDocument
  const assignBlock = (element: HTMLElement) => {
    element.dataset.flowBlockId = block.id
    element.dataset.flowBlockType = block.type
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
      figure.className = 'flow-block-media'
      figure.dataset.flowMediaLayout = block.layout
      const readingWidth = options.readingWidth ?? 760
      const wideContentWidth = options.wideContentWidth ?? 1120
      figure.style.width = '100%'
      figure.style.margin = '0 auto'
      if (block.layout === 'wide') {
        figure.style.maxWidth = `${wideContentWidth}px`
      } else if (block.layout === 'full-width') {
        figure.style.maxWidth = '100%'
      } else {
        figure.style.maxWidth = `${readingWidth}px`
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
          const cell = dom.createElement('td')
          cell.textContent = flowTableCellText(row.cells[column.id])
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
      wrap.style.maxWidth = `${readingWidth}px`
      wrap.style.height = `${size.height}px`
      wrap.style.overflow = 'hidden'
      paintPublishedFormula(wrap, { ...paint, height: size.height })
      parent.appendChild(wrap)
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
      const section = assignBlock(dom.createElement('section'))
      section.id = flowRuntimeTocAnchorId(block.id)
      section.dataset.flowTocAnchor = block.id
      const title = dom.createElement('h2')
      title.textContent = block.title
      section.appendChild(title)
      for (const child of block.blocks) renderBlockDom(child, section, options)
      parent.appendChild(section)
      return
    }
    case 'component': {
      const figure = assignBlock(dom.createElement('figure'))
      figure.className = 'flow-block-component'
      figure.style.position = 'relative'
      figure.style.width = '100%'
      figure.style.minHeight = '240px'
      const handle = mountPublishedComponent(figure, {
        container: figure,
        componentId: block.component.packageId,
        version: block.component.version,
        instanceId: block.id,
        width: options.readingWidth ?? 760,
        height: 320,
        props: block.props,
        staticFallbackAssetId: block.staticFallbackAssetId,
        components: options.components,
        resolveAsset: (assetId) => resolvePlaybackAssetUrl(options.playback, assetId, options.resolveAsset),
        interactive: options.interactive ?? true,
      })
      options.onMountComponent?.(handle)
      parent.appendChild(figure)
      return
    }
  }
}

function applyFlowBlockTypography(
  element: HTMLElement,
  block: { textAlign?: 'left' | 'center' | 'right'; lineSpacing?: number },
): void {
  if (block.textAlign) element.style.textAlign = block.textAlign
  element.style.lineHeight = block.lineSpacing === undefined ? '' : String(1.6 + block.lineSpacing / 16)
}

function appendRichText(
  element: HTMLElement,
  text: string,
  runs?: TextRun[],
): void {
  const segments = flowRichTextSegments(text, runs)
  if (segments.length === 0) {
    element.textContent = text
    return
  }
  const dom = element.ownerDocument
  for (const segment of segments) {
    const span = dom.createElement('span')
    span.textContent = segment.text
    if (segment.style.fontFamily) span.style.fontFamily = segment.style.fontFamily
    if (segment.style.fontSize !== undefined) span.style.fontSize = `${segment.style.fontSize}px`
    if (segment.style.bold) span.style.fontWeight = '700'
    if (segment.style.italic) span.style.fontStyle = 'italic'
    if (segment.style.underline) span.style.textDecoration = 'underline'
    if (segment.style.strike) {
      span.style.textDecoration = span.style.textDecoration
        ? `${span.style.textDecoration} line-through`
        : 'line-through'
    }
    if (segment.style.color) span.style.color = segment.style.color
    if (segment.style.highlightColor) span.style.backgroundColor = segment.style.highlightColor
    element.appendChild(span)
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1')
}
