import { PLAYBACK_VIEW_CHROME_GUTTER, PLAYBACK_VIEW_OVERFLOW_EPSILON, PLAYBACK_VIEW_MAX_ZOOM, playbackControllerInsets, type PlaybackChromeGeometry } from '../shared/playbackViewGeometry'

/** Session-only observation of already laid out content. No navigation or document writes. */
export interface ViewPoint { x: number; y: number }
export interface ViewBounds { x: number; y: number; width: number; height: number }
export interface PlaybackViewState {
  zoom: number
  pan: ViewPoint
  viewport: { width: number; height: number }
  bounds: ViewBounds
  generation: number
  chromeInsets?: { right: number; bottom: number }
}
export interface PlaybackViewHost {
  id: string
  kind: 'slide' | 'flow' | 'spatial'
  root: HTMLElement
  content: HTMLElement
  onObservationChange?(): void
}
export interface PlaybackViewPort {
  readonly state: PlaybackViewState
  readonly chrome?: PlaybackChromeGeometry
  subscribe(listener: () => void): () => void
  zoomTo(zoom: number, anchor?: ViewPoint): void
  panTo(pan: ViewPoint): void
  reset(): void
  openZoomPanel(button: HTMLButtonElement): void
  closeZoomPanel(button: HTMLButtonElement): void
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function playbackPanRange(state: PlaybackViewState) {
  const axis = (origin: number, size: number, viewport: number, inset = 0) => {
    const min = Math.min(0, viewport - (origin + size) * state.zoom)
    const max = Math.max(0, -origin * state.zoom)
    return max - min <= PLAYBACK_VIEW_OVERFLOW_EPSILON ? { min: 0, max: 0 }
      : { min: Math.min(0, viewport - inset - (origin + size) * state.zoom), max }
  }
  return { x: axis(state.bounds.x, state.bounds.width, state.viewport.width, state.chromeInsets?.right),
    y: axis(state.bounds.y, state.bounds.height, state.viewport.height, state.chromeInsets?.bottom) }
}
export function playbackZoomAt(state: PlaybackViewState, value: number, anchor: ViewPoint): PlaybackViewState {
  const zoom = clamp(value, .25, PLAYBACK_VIEW_MAX_ZOOM)
  const ratio = zoom / state.zoom
  const next = { ...state, zoom, generation: state.generation + 1,
    pan: { x: anchor.x - (anchor.x - state.pan.x) * ratio,
      y: anchor.y - (anchor.y - state.pan.y) * ratio } }
  const range = playbackPanRange(next)
  next.pan = { x: clamp(next.pan.x, range.x.min, range.x.max), y: clamp(next.pan.y, range.y.min, range.y.max) }
  return next
}
const occupiedSelector = [
  'iframe', 'input', 'textarea', 'select', 'button', 'a[href]', 'video', 'audio', 'summary',
  '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="slider"]', '[role="combobox"]',
  '[contenteditable]:not([contenteditable="false"])', '[data-playback-chrome]',
  '[data-spatial-gesture-owner]',
  '[data-layer-kind="runtime"]', '[data-layer-kind="component"]',
  '[data-kind="runtime"]', '[data-kind="component"]',
  '.flow-block-component', '[data-flow-interactive]', '[data-runtime-instance-id]',
  '[data-component-instance-id]', '[data-runtime-host]', '[data-component-host]',
].join(',')
export function playbackGestureOccupied(target: EventTarget | null, root: HTMLElement): boolean {
  const ElementClass = root.ownerDocument.defaultView?.Element
  if (!ElementClass || !(target instanceof ElementClass) || !root.contains(target)) return true
  return Boolean(target.closest(occupiedSelector))
}
export function createPlaybackContent(root: HTMLElement): HTMLElement {
  const content = root.ownerDocument.createElement('div')
  content.dataset.playbackContent = 'true'
  Object.assign(content.style, { position: 'absolute', inset: '0', transformOrigin: '0 0', overflow: 'visible' })
  root.appendChild(content)
  return content
}

export class PlaybackViewSession implements PlaybackViewPort {
  #state: PlaybackViewState = { zoom: 1, pan: { x: 0, y: 0 }, viewport: { width: 1280, height: 720 },
    bounds: { x: 0, y: 0, width: 1280, height: 720 }, generation: 0 }
  #hosts = new Map<string, PlaybackViewHost>()
  #active: string | null = null
  #listeners = new Set<() => void>()
  #viewport: HTMLElement | null = null
  #frame: HTMLElement | null = null
  #observer: ResizeObserver | null = null
  #cleanup: (() => void)[] = []
  #panel: HTMLElement | null = null
  #panelButton: HTMLButtonElement | null = null
  #anchor: ViewPoint | undefined
  #chrome: PlaybackChromeGeometry = { x: false, y: false, native: { right: 0, bottom: 0 }, insets: { right: 0, bottom: 0 }, controllerInsets: playbackControllerInsets({ right: 0, bottom: 0 }) }
  get state(): PlaybackViewState { return structuredClone(this.#state) }
  get chrome(): PlaybackChromeGeometry { return structuredClone(this.#chrome) }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  register(host: PlaybackViewHost): void {
    const previous = this.#hosts.get(host.id)
    if (previous && previous.content !== host.content) {
      this.#closePanel(false)
      this.#state = { ...this.#state, generation: this.#state.generation + 1 }
    }
    this.#hosts.set(host.id, host); this.#fit(host); this.#paint()
  }
  activate(id: string): void {
    if (this.#active === id) { this.refreshBounds(); return }
    this.#active = id
    this.#state = { ...this.#state, zoom: 1, pan: { x: 0, y: 0 }, generation: this.#state.generation + 1 }
    this.#closePanel(false)
    this.refreshBounds()
  }
  mount(container: HTMLElement): HTMLElement {
    const dom = container.ownerDocument
    const frame = dom.createElement('div')
    frame.dataset.playbackView = 'true'
    Object.assign(frame.style, { position: 'absolute', inset: '0', overflow: 'clip', isolation: 'isolate' })
    const viewport = dom.createElement('div')
    viewport.dataset.playbackViewport = 'true'
    viewport.tabIndex = 0
    viewport.setAttribute('aria-label', '课件播放视口')
    Object.assign(viewport.style, { position: 'absolute', inset: '0', overflow: 'clip' })
    frame.appendChild(viewport)
    container.appendChild(frame)
    this.#frame = frame
    this.#viewport = viewport
    this.#cleanup.push(attachPlaybackGestures(viewport, this))
    this.#cleanup.push(this.#mountBar('x'), this.#mountBar('y'))
    if (typeof ResizeObserver === 'function') {
      this.#observer = new ResizeObserver(() => this.resize())
      this.#observer.observe(viewport)
    }
    this.resize()
    return viewport
  }
  /** Fullscreen the viewport, retaining the stage fit and observation layers. */
  async toggleFullscreen(): Promise<boolean> {
    const frame = this.#frame
    if (!frame) return false
    const dom = frame.ownerDocument
    if (dom.fullscreenElement) await dom.exitFullscreen?.()
    else await frame.requestFullscreen?.()
    return true
  }
  resize(): void {
    this.#closePanel(true)
    const viewport = this.#viewport
    if (!viewport) return
    this.#state = { ...this.#state, viewport: { width: viewport.clientWidth || 1280, height: viewport.clientHeight || 720 },
      generation: this.#state.generation + 1 }
    for (const host of this.#hosts.values()) this.#fit(host)
    this.refreshBounds()
  }
  #fit(host: PlaybackViewHost): void {
    const { width, height } = this.#state.viewport
    const scale = host.kind === 'flow' ? 1 : Math.min(width / 1280, height / 720)
    Object.assign(host.root.style, { position: 'absolute', transformOrigin: '0 0', transform: `scale(${scale})`,
      width: host.kind === 'flow' ? '100%' : '1280px', height: host.kind === 'flow' ? '100%' : '720px', minWidth: '0', minHeight: '0',
      left: `${host.kind === 'flow' ? 0 : (width - 1280 * scale) / 2}px`,
      top: `${host.kind === 'flow' ? 0 : (height - 720 * scale) / 2}px`, overflow: 'visible' })
    host.root.dataset.stageFitScale = String(scale)
  }
  refreshBounds(): void {
    // Layout/host changes update the DOM matrix before inversely measuring its bounds.
    this.#paint()
    const { width, height } = this.#state.viewport
    // These bars describe the current baseline viewport, never Flow document length or infinite world extent.
    let left = 0, top = 0, right = width, bottom = height
    const host = this.#active ? this.#hosts.get(this.#active) : undefined
    if (host && this.#viewport) {
      const viewport = this.#viewport.getBoundingClientRect()
      for (const item of host.content.querySelectorAll<HTMLElement>('[data-playback-bounds]')) {
        if (item.hidden) continue
        const rect = item.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        const x = (rect.left - viewport.left - this.#state.pan.x) / this.#state.zoom
        const y = (rect.top - viewport.top - this.#state.pan.y) / this.#state.zoom
        left = Math.min(left, x); top = Math.min(top, y)
        right = Math.max(right, x + rect.width / this.#state.zoom)
        bottom = Math.max(bottom, y + rect.height / this.#state.zoom)
      }
    }
    this.#state = { ...this.#state, bounds: { x: left, y: top, width: right - left, height: bottom - top }, generation: this.#state.generation + 1 }
    this.panTo(this.#state.pan)
  }
  zoomTo(zoom: number, anchor = { x: this.#state.viewport.width / 2, y: this.#state.viewport.height / 2 }): void {
    if (!Number.isFinite(zoom)) return
    this.#anchor = anchor
    this.#state = playbackZoomAt(this.#state, zoom, anchor)
    this.#paint()
  }
  panTo(pan: ViewPoint): void {
    const range = playbackPanRange(this.#state)
    this.#state = { ...this.#state, pan: { x: clamp(pan.x, range.x.min, range.x.max), y: clamp(pan.y, range.y.min, range.y.max) } }
    this.#paint()
  }
  reset(): void {
    this.#state = { ...this.#state, zoom: 1, pan: { x: 0, y: 0 }, generation: this.#state.generation + 1 }
    this.#paint()
  }
  #paint(): void {
    this.#deriveChrome()
    const range = playbackPanRange(this.#state)
    this.#state.pan = { x: clamp(this.#state.pan.x, range.x.min, range.x.max), y: clamp(this.#state.pan.y, range.y.min, range.y.max) }
    const state = this.#state
    for (const host of this.#hosts.values()) {
      const scale = Number(host.root.dataset.stageFitScale) || 1
      const left = parseFloat(host.root.style.left) || 0
      const top = parseFloat(host.root.style.top) || 0
      // Base root fit remains fixed, so controller siblings never inherit observation.
      host.content.style.transform = `translate(${(state.pan.x + (state.zoom - 1) * left) / scale}px, ${(state.pan.y + (state.zoom - 1) * top) / scale}px) scale(${state.zoom})`
    }
    for (const host of this.#hosts.values()) host.onObservationChange?.()
    for (const listener of this.#listeners) listener()
  }
  #deriveChrome(): void {
    const range = playbackPanRange({ ...this.#state, chromeInsets: undefined })
    const x = range.x.max > range.x.min, y = range.y.max > range.y.min
    const native = { right: 0, bottom: 0 }
    const host = this.#active ? this.#hosts.get(this.#active) : undefined
    const scroll = host?.kind === 'flow' ? host.content.querySelector<HTMLElement>('[data-flow-paper-scroll]') : null
    if (scroll) {
      // Use layout scrollbar thickness, independent of pan. Otherwise reaching
      // an edge changes its exclusion strip and makes the pan endpoint oscillate.
      native.right = Math.max(0, scroll.offsetWidth - scroll.clientWidth) * this.#state.zoom
      native.bottom = Math.max(0, scroll.offsetHeight - scroll.clientHeight) * this.#state.zoom
    }
    this.#chrome = { x, y, native, controllerInsets: playbackControllerInsets({
      right: scroll ? Math.max(0, scroll.offsetWidth - scroll.clientWidth) : 0,
      bottom: scroll ? Math.max(0, scroll.offsetHeight - scroll.clientHeight) : 0,
    }), insets: {
      right: native.right + (y ? PLAYBACK_VIEW_CHROME_GUTTER : 0),
      bottom: native.bottom + (x ? PLAYBACK_VIEW_CHROME_GUTTER : 0),
    } }
    this.#state.chromeInsets = this.#chrome.insets
  }
  openZoomPanel(button: HTMLButtonElement): void {
    if (this.#panelButton === button) { this.#closePanel(true); return }
    this.#closePanel(false)
    if (!this.#frame) return
    this.#panelButton = button
    button.setAttribute('aria-expanded', 'true')
    const dom = button.ownerDocument
    const panel = dom.createElement('div')
    panel.dataset.playbackChrome = 'zoom-panel'
    panel.setAttribute('role', 'group')
    panel.setAttribute('aria-label', '课件观察缩放')
    Object.assign(panel.style, { position: 'absolute', zIndex: '2147483647', display: 'flex', gap: '8px', padding: '10px',
      background: '#10263c', color: 'white', border: '1px solid #7597b5', borderRadius: '10px', font: '14px sans-serif', boxShadow: '0 4px 18px #0005' })
    const anchor = this.#anchor ?? { x: this.#state.viewport.width / 2, y: this.#state.viewport.height / 2 }
    const make = (label: string, run: () => void) => {
      const control = dom.createElement('button'); control.type = 'button'; control.textContent = label
      control.setAttribute('aria-label', label)
      Object.assign(control.style, { minWidth: '34px', minHeight: '32px', cursor: 'pointer', color: 'white', background: '#294860', border: '0', borderRadius: '5px' })
      control.onclick = run; return control
    }
    const percent = dom.createElement('output')
    Object.assign(percent.style, { alignSelf: 'center', minWidth: '44px', textAlign: 'center' })
    const update = () => {
      percent.textContent = `${Math.round(this.#state.zoom * 100)}%`
      const frameRect = this.#frame!.getBoundingClientRect(), buttonRect = button.getBoundingClientRect()
      panel.style.left = `${clamp(buttonRect.left - frameRect.left, 4, Math.max(4, this.#state.viewport.width - this.#chrome.insets.right - (panel.offsetWidth || 310) - 4))}px`
      panel.style.top = `${clamp(buttonRect.bottom - frameRect.top + 6, 4, Math.max(4, this.#state.viewport.height - this.#chrome.insets.bottom - (panel.offsetHeight || 54) - 4))}px`
    }
    update()
    const unsubscribe = this.subscribe(update)
    panel.append(make('缩小', () => this.zoomTo(this.#state.zoom - .25, anchor)), percent,
      make('放大', () => this.zoomTo(this.#state.zoom + .25, anchor)), make('恢复视图', () => this.reset()), make('关闭', () => this.#closePanel(true)))
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); this.#closePanel(true) } })
    this.#frame.appendChild(panel)
    update()
    this.#panel = panel
    panel.addEventListener('playback-panel-close', unsubscribe, { once: true })
    panel.querySelector('button')?.focus({ preventScroll: true })
  }
  closeZoomPanel(button: HTMLButtonElement): void {
    if (this.#panelButton === button) this.#closePanel(true)
  }
  #closePanel(focus: boolean): void {
    if (this.#panel) this.#panel.dispatchEvent(new Event('playback-panel-close'))
    this.#panel?.remove(); this.#panel = null
    this.#panelButton?.setAttribute('aria-expanded', 'false')
    if (focus && this.#panelButton?.isConnected) this.#panelButton.focus({ preventScroll: true })
    this.#panelButton = null
  }
  #mountBar(axis: 'x' | 'y'): () => void {
    const frame = this.#frame!, dom = frame.ownerDocument
    const bar = dom.createElement('div'), thumb = dom.createElement('div')
    bar.dataset.playbackChrome = `${axis}-bar`; bar.tabIndex = 0
    bar.setAttribute('role', 'scrollbar'); bar.setAttribute('aria-label', axis === 'x' ? '左右移动视图' : '上下移动视图')
    bar.setAttribute('aria-orientation', axis === 'x' ? 'horizontal' : 'vertical')
    Object.assign(bar.style, { position: 'absolute', background: '#e2e8f0', zIndex: '2147483646', touchAction: 'none',
      ...(axis === 'x' ? { bottom: '0', left: '0', right: `${PLAYBACK_VIEW_CHROME_GUTTER}px`, height: `${PLAYBACK_VIEW_CHROME_GUTTER}px` } : { right: '0', top: '0', bottom: `${PLAYBACK_VIEW_CHROME_GUTTER}px`, width: `${PLAYBACK_VIEW_CHROME_GUTTER}px` }) })
    Object.assign(thumb.style, { position: 'absolute', background: '#64748b', border: '2px solid #e2e8f0', boxSizing: 'border-box', borderRadius: '7px',
      ...(axis === 'x' ? { height: `${PLAYBACK_VIEW_CHROME_GUTTER}px` } : { width: `${PLAYBACK_VIEW_CHROME_GUTTER}px` }) })
    bar.appendChild(thumb); frame.appendChild(bar)
    let drag: { id: number; start: number; pan: number; min: number; max: number; travel: number; generation: number } | null = null
    let shield: HTMLElement | null = null
    const stop = () => { const previous = drag; drag = null; if (previous && bar.hasPointerCapture?.(previous.id)) bar.releasePointerCapture(previous.id); shield?.remove(); shield = null }
    const metrics = () => {
      const range = playbackPanRange(this.#state)[axis]
      const length = axis === 'x' ? (bar.clientWidth || this.#state.viewport.width) : (bar.clientHeight || this.#state.viewport.height)
      const size = range.max === range.min ? length : Math.max(24, length * length / (length + range.max - range.min))
      return { ...range, length, size, travel: Math.max(1, length - size) }
    }
    const update = () => {
      if (drag && drag.generation !== this.#state.generation) stop()
      const enabled = this.#chrome[axis]
      if (!enabled) {
        stop()
        if (bar.contains(dom.activeElement)) this.#viewport?.focus({ preventScroll: true })
      }
      bar.hidden = !enabled
      bar.tabIndex = enabled ? 0 : -1
      bar.setAttribute('aria-hidden', String(!enabled))
      if (axis === 'x') {
        bar.style.bottom = `${this.#chrome.native.bottom}px`
        bar.style.right = `${this.#chrome.insets.right}px`
      } else {
        bar.style.right = `${this.#chrome.native.right}px`
        bar.style.bottom = `${this.#chrome.insets.bottom}px`
      }
      const { min, max, size, travel } = metrics()
      bar.setAttribute('aria-disabled', String(!enabled)); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(max - min)); bar.setAttribute('aria-valuenow', String(max - this.#state.pan[axis]))
      thumb.style.opacity = enabled ? '1' : '.25'
      thumb.style[axis === 'x' ? 'width' : 'height'] = `${size}px`
      thumb.style[axis === 'x' ? 'left' : 'top'] = `${enabled ? (max - this.#state.pan[axis]) / (max - min) * travel : 0}px`
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      const m = metrics(); if (m.max === m.min) return
      event.preventDefault(); bar.focus({ preventScroll: true })
      const client = axis === 'x' ? event.clientX : event.clientY
      if (event.target !== thumb) {
        const rect = bar.getBoundingClientRect()
        const position = client - (axis === 'x' ? rect.left : rect.top) - m.size / 2
        this.panTo({ ...this.#state.pan, [axis]: m.max - clamp(position / m.travel, 0, 1) * (m.max - m.min) })
      }
      drag = { id: event.pointerId, start: client, pan: this.#state.pan[axis], ...m, generation: this.#state.generation }
      try { bar.setPointerCapture(event.pointerId) } catch { /* synthetic events */ }
      shield = dom.createElement('div')
      Object.assign(shield.style, { position: 'absolute', inset: '0', zIndex: '2147483645', cursor: axis === 'x' ? 'ew-resize' : 'ns-resize' })
      frame.appendChild(shield)
    }
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      if (drag.generation !== this.#state.generation) { stop(); return }
      event.preventDefault()
      const delta = (axis === 'x' ? event.clientX : event.clientY) - drag.start
      this.panTo({ ...this.#state.pan, [axis]: drag.pan - delta / drag.travel * (drag.max - drag.min) })
    }
    const key = (event: KeyboardEvent) => {
      const range = playbackPanRange(this.#state)[axis]
      let pan = this.#state.pan[axis]
      if (event.key === 'Home') pan = range.max
      else if (event.key === 'End') pan = range.min
      else if (event.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp')) pan += 40
      else if (event.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown')) pan -= 40
      else return
      event.preventDefault(); this.panTo({ ...this.#state.pan, [axis]: pan })
    }
    bar.addEventListener('pointerdown', down); bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', stop); bar.addEventListener('pointercancel', stop); bar.addEventListener('lostpointercapture', stop); bar.addEventListener('keydown', key)
    update(); const unsubscribe = this.subscribe(update)
    return () => { stop(); unsubscribe(); bar.remove() }
  }
  destroy(): void {
    this.#closePanel(false); this.#observer?.disconnect()
    for (const cleanup of this.#cleanup.splice(0)) cleanup()
    this.#listeners.clear(); this.#hosts.clear(); this.#frame?.remove(); this.#frame = null; this.#viewport = null
  }
}

/** Start-area ownership stays fixed. Dynamic carriers never need to forward events. */
export function attachPlaybackGestures(root: HTMLElement, view: PlaybackViewPort): () => void {
  const dom = root.ownerDocument
  const point = (x: number, y: number) => { const rect = root.getBoundingClientRect(); return { x: x - rect.left, y: y - rect.top } }
  let mouse: { id: number; x: number; y: number; pan: ViewPoint; generation: number } | null = null
  const touchOwners = new Map<number, boolean>()
  let touch: { distance: number; center: ViewPoint; zoom: number; pan: ViewPoint; generation: number } | null = null
  let lastTouch = -Infinity
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey || playbackGestureOccupied(event.target, root) || touch || Date.now() - lastTouch < 100) return
    if (event.deltaY === 0) return
    event.preventDefault(); event.stopPropagation()
    view.zoomTo(view.state.zoom * Math.exp(-event.deltaY * .002), point(event.clientX, event.clientY))
  }
  const key = (event: KeyboardEvent) => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing || playbackGestureOccupied(dom.activeElement, root)) return
    if (!['+', '=', '-', '_', '0'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === '0') view.reset()
    else view.zoomTo(view.state.zoom + (event.key === '-' || event.key === '_' ? -.25 : .25))
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 1 || playbackGestureOccupied(event.target, root)) return
    event.preventDefault(); event.stopPropagation()
    mouse = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: view.state.pan, generation: view.state.generation }
    try { root.setPointerCapture(event.pointerId) } catch { /* synthetic events */ }
  }
  const move = (event: PointerEvent) => {
    if (touch && event.pointerType === 'touch') { event.preventDefault(); event.stopPropagation(); return }
    if (!mouse || mouse.id !== event.pointerId) return
    if (mouse.generation !== view.state.generation) { mouse = null; return }
    event.preventDefault(); event.stopPropagation()
    view.panTo({ x: mouse.pan.x + event.clientX - mouse.x, y: mouse.pan.y + event.clientY - mouse.y })
  }
  const up = () => { if (mouse && root.hasPointerCapture?.(mouse.id)) root.releasePointerCapture(mouse.id); mouse = null }
  const touchGeometry = (event: TouchEvent) => {
    const a = event.touches[0]!, b = event.touches[1]!
    return { distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), center: point((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2) }
  }
  const startTouch = (event: TouchEvent) => {
    for (const t of Array.from(event.changedTouches)) touchOwners.set(t.identifier, !playbackGestureOccupied(t.target, root))
    if (event.touches.length !== 2 || !Array.from(event.touches).every(t => touchOwners.get(t.identifier) === true)) { touch = null; return }
    const geometry = touchGeometry(event)
    touch = { ...geometry, zoom: view.state.zoom, pan: view.state.pan, generation: view.state.generation }
    // Native scroll owners see the second touch and cancel their one-finger drag.
    event.preventDefault()
  }
  const moveTouch = (event: TouchEvent) => {
    if (!touch || event.touches.length !== 2) return
    if (touch.generation !== view.state.generation) { touch = null; return }
    event.preventDefault(); event.stopPropagation(); lastTouch = Date.now()
    const geometry = touchGeometry(event)
    const zoom = clamp(touch.zoom * geometry.distance / touch.distance, .25, 4)
    view.zoomTo(zoom, touch.center)
    view.panTo({ x: geometry.center.x - (touch.center.x - touch.pan.x) * zoom / touch.zoom,
      y: geometry.center.y - (touch.center.y - touch.pan.y) * zoom / touch.zoom })
    touch.generation = view.state.generation
  }
  const endTouch = (event: TouchEvent) => { for (const t of Array.from(event.changedTouches)) touchOwners.delete(t.identifier); touch = null; lastTouch = Date.now() }
  root.addEventListener('wheel', wheel, { passive: false, capture: true }); root.addEventListener('keydown', key, true)
  root.addEventListener('pointerdown', down, true); root.addEventListener('pointermove', move, true)
  root.addEventListener('pointerup', up, true); root.addEventListener('pointercancel', up, true)
  root.addEventListener('touchstart', startTouch, { passive: false, capture: true }); root.addEventListener('touchmove', moveTouch, { passive: false, capture: true })
  root.addEventListener('touchend', endTouch, true); root.addEventListener('touchcancel', endTouch, true)
  return () => {
    up(); touchOwners.clear(); touch = null
    root.removeEventListener('wheel', wheel, true); root.removeEventListener('keydown', key, true)
    root.removeEventListener('pointerdown', down, true); root.removeEventListener('pointermove', move, true)
    root.removeEventListener('pointerup', up, true); root.removeEventListener('pointercancel', up, true)
    root.removeEventListener('touchstart', startTouch, true); root.removeEventListener('touchmove', moveTouch, true)
    root.removeEventListener('touchend', endTouch, true); root.removeEventListener('touchcancel', endTouch, true)
  }
}
