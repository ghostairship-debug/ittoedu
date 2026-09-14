import type { ComponentTeacherControllerPort } from '../shared/contracts/component-v4/teacherController'
import type { TeacherControllerHostOptions } from './teacherControllerHostContract'
import type { TeacherControllerRuntimeNode } from './teacherControllerRuntimeSession'
import { mountPublishedComponent, type PublishedComponentMountHandle, type PublishedComponentMountOptions } from './surfaces/publishedComponentMount'

/** Role-specific adapter. Rendering belongs exclusively to the embedded component. */
export class TeacherControllerComponentHost {
  #options: TeacherControllerHostOptions
  #handle: PublishedComponentMountHandle
  #disposed = false
  #shift = { x: 0, y: 0 }
  #anchorShift = { x: 0, y: 0 }
  #authoringId: string | undefined
  #listeners = new Set<() => void>()
  #cleanup: (() => void)[] = []
  #reportError: PublishedComponentMountOptions['reportError']
  #sizeObserver: ResizeObserver | undefined
  constructor(options: TeacherControllerHostOptions, component: PublishedComponentMountOptions) {
    this.#options = options
    this.#authoringId = component.mode === 'edit' ? component.instanceId : undefined
    this.#reportError = component.reportError
    options.container.style.pointerEvents = 'none'
    if (options.footprintElement) options.footprintElement.style.pointerEvents = 'none'
    const active = () => !this.#disposed && options.getInteractive()
    const port: ComponentTeacherControllerPort = {
      read: () => structuredClone({
        locationId: options.getCurrentSceneId(), stateLabel: options.getStateLabel(),
        scenes: options.scenes, progress: options.navigation?.getProgress() ?? null,
        ...options.getStatus(), zoom: options.playbackView?.state.zoom ?? 1,
        ...options.getSession(),
      }),
      subscribe: listener => { this.#listeners.add(listener); return () => this.#listeners.delete(listener) },
      canExecute: action => !this.#disposed && (options.navigation?.canExecute(action) ?? true),
      execute: async action => {
        if (!active() || !(options.navigation?.canExecute(action) ?? true)) return false
        try {
          const accepted = await options.onAction(action)
          this.refreshStatus()
          return accepted !== false
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          if (options.onActionError) options.onActionError(action, failure)
          else this.reportCallbackError(failure)
          return false
        }
      },
      setCollapsed: collapsed => {
        if (!active()) return
        const current = options.getSession()
        options.onSessionChange({ ...current, collapsed, offset: {
          dx: current.offset.dx + this.#shift.x - this.#anchorShift.x,
          dy: current.offset.dy + this.#shift.y - this.#anchorShift.y,
        } })
        this.#options.onPositionChange?.(this.#options.node, this.offset)
        this.refreshStatus()
      },
      moveBy: (dx, dy) => {
        if (!active() || !Number.isFinite(dx) || !Number.isFinite(dy)) return
        const current = options.getSession(), bounds = options.getRenderedStageBounds()
        // Rebase any viewport correction before applying the pointer delta;
        // native-controller recovery bounds do not describe component content.
        const offset = {
          dx: current.offset.dx + this.#shift.x - this.#anchorShift.x + dx * options.canvas.width / Math.max(1, bounds.width),
          dy: current.offset.dy + this.#shift.y - this.#anchorShift.y + dy * options.canvas.height / Math.max(1, bounds.height),
        }
        options.onSessionChange({ ...current, offset })
        options.onPositionChange?.(this.#options.node, offset)
        this.syncFootprint()
      },
      setZoom: value => { if (active() && Number.isFinite(value)) options.playbackView?.zoomTo(value) },
      resetView: () => { if (active()) options.playbackView?.reset() },
    }
    this.#handle = mountPublishedComponent(options.container, { ...component, teacherController: port })
    this.rootElement.style.pointerEvents = 'none'
    this.rootElement.style.overflow = 'visible'
    const surface = this.rootElement.shadowRoot?.querySelector<HTMLElement>('[data-component-surface]')
    const view = options.container.ownerDocument.defaultView
    if (view) {
      let frame = 0
      const resize = () => { view.cancelAnimationFrame(frame); frame = view.requestAnimationFrame(() => this.syncFootprint()) }
      if (surface && typeof ResizeObserver !== 'undefined') {
        this.#sizeObserver = new ResizeObserver(resize)
        this.#sizeObserver.observe(surface)
      }
      view.addEventListener('resize', resize)
      this.#cleanup.push(() => { view.removeEventListener('resize', resize); view.cancelAnimationFrame(frame) })
      resize()
    }
    this.syncFootprint()
    if (options.navigation) this.#cleanup.push(options.navigation.subscribe(() => this.refreshStatus()))
    if (options.playbackView) this.#cleanup.push(options.playbackView.subscribe(() => this.refreshStatus()))
    const fullscreen = () => this.refreshStatus()
    options.container.ownerDocument.addEventListener('fullscreenchange', fullscreen)
    this.#cleanup.push(() => options.container.ownerDocument.removeEventListener('fullscreenchange', fullscreen))
  }
  get collapsed() { return this.#options.getSession().collapsed }
  get rootElement() { return this.#handle.element }
  get offset() { return this.#options.getSession().offset }
  private reportCallbackError(error: unknown): void {
    this.#reportError?.('lifecycle', error instanceof Error ? error : new Error(String(error)))
  }
  refreshStatus(): void {
    if (this.#disposed) return
    this.#listeners.forEach(listener => { try { listener() } catch (error) { this.reportCallbackError(error) } })
    this.syncFootprint()
  }
  /** The saved authoring frame remains intact. Only the runtime DOM footprint
   * follows the component's actual collapsed content, including custom UIs. */
  private syncFootprint(): void {
    if (this.#disposed || !this.#handle) return
    const { node, container, footprintElement } = this.#options
    // Layout remains in the containing surface's coordinates. Its ordinary
    // fit-to-window transform applies to the controller as well. The surface
    // already excludes this overlay from the separate content zoom/pan layer.
    let width = node.width, height = node.height
    const surface = this.rootElement.shadowRoot?.querySelector<HTMLElement>('[data-component-surface]')
    if (surface) {
      const origin = surface.getBoundingClientRect()
      const sx = origin.width / (surface.offsetWidth || 1), sy = origin.height / (surface.offsetHeight || 1)
      const bounds = [...surface.children].filter(child => child.tagName !== 'STYLE')
        .map(child => child.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
      if (bounds.length && sx > 0 && sy > 0) {
        if (this.collapsed) width = (Math.max(...bounds.map(rect => rect.right)) - Math.min(...bounds.map(rect => rect.left))) / sx
        height = (Math.max(...bounds.map(rect => rect.bottom)) - Math.min(...bounds.map(rect => rect.top))) / sy
      } else if (this.collapsed) {
        // First mount can be hidden while the editor switches into try-run.
        if (/^\d+(\.\d+)?px$/.test(surface.style.width)) width = parseFloat(surface.style.width)
        if (/^\d+(\.\d+)?px$/.test(surface.style.height)) height = parseFloat(surface.style.height)
      }
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    width = Math.round(width * 1000) / 1000
    height = Math.round(height * 1000) / 1000
    for (const element of new Set([container, footprintElement, this.rootElement])) if (element) {
      element.style.width = `${width}px`
      element.style.height = `${height}px`
      element.style.pointerEvents = 'none'
    }
    this.rootElement.style.transformOrigin = '0 0'
    this.rootElement.style.transform = ''
    this.#anchorShift = { x: node.width - width, y: node.height - height }
    this.#shift = { ...this.#anchorShift }
    if (!this.#authoringId) {
      const canvas = this.#options.getConstraintCanvas?.() ?? this.#options.canvas
      const x = node.x + this.offset.dx + this.#shift.x, y = node.y + this.offset.dy + this.#shift.y
      this.#shift.x += Math.max(0, Math.min(x, canvas.width - width)) - x
      this.#shift.y += Math.max(0, Math.min(y, canvas.height - height)) - y
    }
    const positioned = footprintElement ?? container
    positioned.style.translate = `${this.#shift.x}px ${this.#shift.y}px`
    if (this.#authoringId) {
      const root = this.rootElement
      root.dataset.controllerAuthoringId = this.#authoringId
      const bounds = [this.#shift.x, this.#shift.y, width, height].map(value => Math.round(value * 1000) / 1000).join(',')
      if (root.dataset.controllerAuthoringBounds !== bounds) {
        root.dataset.controllerAuthoringBounds = bounds
        container.ownerDocument.dispatchEvent(new Event('controller-authoring-bounds'))
      }
    }
    this.rootElement.style.pointerEvents = 'none'
  }
  updateGeometry(node: TeacherControllerRuntimeNode): void {
    this.#options = { ...this.#options, node }
    this.#handle.resize(node.width, node.height)
    this.#options.onPositionChange?.(node, this.offset)
    this.syncFootprint()
  }
  update(node: TeacherControllerRuntimeNode): void { this.updateGeometry(node); this.refreshStatus() }
  suspend(): void { this.#handle.setVisible(false); this.#handle.suspend() }
  resume(): void { this.#handle.setVisible(true); this.#handle.resume(); this.refreshStatus() }
  destroy(): void {
    this.#disposed = true
    this.#sizeObserver?.disconnect()
    this.#cleanup.splice(0).forEach(dispose => dispose())
    this.#listeners.clear()
    this.#handle.destroy()
  }
}
