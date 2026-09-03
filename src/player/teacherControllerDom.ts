import type {
  TeacherControllerAction,
  TeacherControllerButton,
} from '../shared/contracts/native-v1'
import {
  createTeacherControllerLayout,
  formatTeacherControllerProgress,
  teacherControllerButtonDisplayLabel,
  teacherControllerHitTarget,
  type TeacherControllerButtonLayout,
  type TeacherControllerHitTarget,
  type TeacherControllerLayout,
  type TeacherControllerRect,
  type TeacherControllerSceneInfo,
  type TeacherControllerViewStatus,
} from '../shared/teacherControllerLayout'
import {
  constrainTeacherControllerOffset,
  runtimeTeacherControllerButtons,
  teacherControllerLocalPointFromClient,
  teacherControllerStagePointerDelta,
  teacherControllerVisibleLocalRect,
  TEACHER_CONTROLLER_KEYBOARD_FINE_STEP,
  TEACHER_CONTROLLER_KEYBOARD_STEP,
  TEACHER_CONTROLLER_MOUSE_DRAG_THRESHOLD_PX,
  TEACHER_CONTROLLER_TOUCH_DRAG_THRESHOLD_PX,
  type TeacherControllerRuntimeNode,
  type TeacherControllerSessionOffset,
} from './teacherControllerRuntimeSession'

export interface TeacherControllerDomSession {
  offset: TeacherControllerSessionOffset
  collapsed: boolean
}

export interface TeacherControllerDomOptions {
  /** Frame + layout source composed by the surface host from the layer item. */
  node: TeacherControllerRuntimeNode
  /** Already positioned by the compositor; the controller fills it 1:1. */
  container: HTMLElement
  /** Host wrapper whose compositor hit region follows the visible chrome. */
  footprintElement?: HTMLElement
  /** Logical course canvas used to constrain session offsets. */
  canvas: { width: number; height: number }
  /**
   * CSS size of the 1280×720 stage (not the controller frame). Pointer deltas
   * map through this the same way `clientDeltaToWorld` maps through
   * `stageViewportTransform`.
   *
   * Optional `left`/`top` are the stage's viewport origin. Playback hosts pass
   * them so button hit-testing uses the logical canvas instead of a CSS-scaled
   * controller client box, which misses buttons after `transform: scale()`.
   */
  getRenderedStageBounds(): { width: number; height: number; left?: number; top?: number }
  scenes: readonly TeacherControllerSceneInfo[]
  getCurrentSceneId(): string | null
  getStateLabel(): string | null
  /** Live mute/fullscreen labels; reads `document.fullscreenElement` itself. */
  getStatus(): TeacherControllerViewStatus
  /** Canonical session persisted by the surface host (defaults after restart). */
  getSession(): TeacherControllerDomSession
  onSessionChange(next: TeacherControllerDomSession): void
  onAction(action: TeacherControllerAction): void
  /** Playback-only gate: false in inspect frames or when controls are none. */
  getInteractive(): boolean
}

/**
 * Host-side bundle the DOM controller uses to read the canonical session,
 * scene/state progress and mute/fullscreen status, and to report session
 * changes and actions upward. Keeps the adapter free of surface internals.
 */
export interface TeacherControllerDomContext {
  canvas: { width: number; height: number }
  getRenderedStageBounds(): { width: number; height: number; left?: number; top?: number }
  scenes: readonly TeacherControllerSceneInfo[]
  getCurrentSceneId(): string | null
  getStateLabel(): string | null
  getStatus(): TeacherControllerViewStatus
  getSession(layerItemId: string): TeacherControllerDomSession
  onSessionChange(layerItemId: string, next: TeacherControllerDomSession): void
  getInteractive(): boolean
}

interface DragCandidate {
  pointerId: number
  start: { x: number; y: number }
  startOffset: TeacherControllerSessionOffset
  threshold: number
  dragging: boolean
  target: TeacherControllerHitTarget | null
  buttonAction?: TeacherControllerAction
}

function colorWithAlpha(value: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) return value
  const number = Number.parseInt(match[1]!, 16)
  const red = (number >> 16) & 0xff
  const green = (number >> 8) & 0xff
  const blue = number & 0xff
  const clamped = Math.max(0, Math.min(1, alpha))
  return `rgba(${red}, ${green}, ${blue}, ${clamped})`
}

function numberToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export function stageBoundsFromElement(
  element: HTMLElement | null | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number; left: number; top: number } {
  if (!element) return { ...fallback, left: 0, top: 0 }
  const bounds = element.getBoundingClientRect()
  const sized = bounds.width > 1 && bounds.height > 1
  return {
    left: sized ? bounds.left : 0,
    top: sized ? bounds.top : 0,
    width: sized ? bounds.width : fallback.width,
    height: sized ? bounds.height : fallback.height,
  }
}

function applyRect(
  element: HTMLElement,
  rect: TeacherControllerRect,
): void {
  element.style.position = 'absolute'
  element.style.left = `${rect.x}px`
  element.style.top = `${rect.y}px`
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
}

/**
 * Clips the host's real pointer footprint to the visible collapse pill. The
 * authored frame remains unchanged, so expanding restores the full panel and
 * session offsets continue to use the shared logical canvas.
 */
export function applyTeacherControllerDomFootprint(
  element: HTMLElement,
  node: TeacherControllerRuntimeNode,
  collapsed: boolean,
): void {
  const visible = teacherControllerVisibleLocalRect(node, collapsed)
  const fullFrame = visible.x === 0
    && visible.y === 0
    && visible.width === node.width
    && visible.height === node.height
  if (!collapsed || fullFrame) {
    element.style.clipPath = 'none'
    return
  }
  const right = Math.max(0, node.width - visible.x - visible.width)
  const bottom = Math.max(0, node.height - visible.y - visible.height)
  element.style.clipPath = `inset(${visible.y}px ${right}px ${bottom}px ${visible.x}px round 999px)`
}

/**
 * Delivery-time DOM teacher controller. It shares layout and session geometry
 * with the Phaser renderer. Pointer deltas use the stage CSS size, not this
 * element's own box (the failed donor mapping that overscaled drags).
 */
export class TeacherControllerDom {
  readonly #options: TeacherControllerDomOptions
  readonly #root: HTMLElement
  #node: TeacherControllerRuntimeNode
  #session: TeacherControllerDomSession
  #layout!: TeacherControllerLayout
  #buttons = new Map<string, HTMLButtonElement>()
  #collapseButton: HTMLButtonElement | null = null
  #drag: DragCandidate | null = null
  #destroyed = false

  constructor(options: TeacherControllerDomOptions) {
    this.#options = options
    this.#node = sanitizeRuntimeControllerNode(options.node)
    this.#session = options.getSession()
    const dom = options.container.ownerDocument
    const root = dom.createElement('nav')
    root.className = 'slide-native-teacher-controller'
    root.setAttribute('aria-label', `${this.#node.title}，可使用 Alt 加方向键移动`)
    root.setAttribute(
      'aria-keyshortcuts',
      'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight',
    )
    root.tabIndex = 0
    root.style.boxSizing = 'border-box'
    root.style.position = 'absolute'
    root.style.inset = '0'
    root.style.userSelect = 'none'
    root.style.webkitUserSelect = 'none'
    root.style.cursor = 'move'
    root.style.outline = 'none'
    root.style.pointerEvents = 'auto'
    this.#root = root

    root.addEventListener('pointerdown', this.#handlePointerDown)
    root.addEventListener('pointermove', this.#handlePointerMove)
    root.addEventListener('pointerup', this.#handlePointerUp)
    root.addEventListener('pointercancel', this.#handlePointerCancel)
    root.addEventListener('keydown', this.#handleKeyDown)
    root.addEventListener('focusin', this.#handleFocusChange)
    root.addEventListener('focusout', this.#handleFocusChange)
    dom.defaultView?.addEventListener('fullscreenchange', this.#handleFullscreenChange)

    this.#render()
    options.container.replaceChildren(root)
  }

  get rootElement(): HTMLElement {
    return this.#root
  }

  get collapsed(): boolean {
    return this.#session.collapsed
  }

  get offset(): TeacherControllerSessionOffset {
    return { ...this.#session.offset }
  }

  /** Re-renders after a node/status/scene change; session is re-read from the host. */
  update(node: TeacherControllerRuntimeNode): void {
    if (this.#destroyed) return
    this.#node = sanitizeRuntimeControllerNode(node)
    this.#session = this.#options.getSession()
    this.#render()
  }

  refreshStatus(): void {
    if (this.#destroyed) return
    this.#render()
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#drag = null
    const dom = this.#options.container.ownerDocument
    dom.defaultView?.removeEventListener('fullscreenchange', this.#handleFullscreenChange)
    this.#root.remove()
  }

  #render(): void {
    const layout = createTeacherControllerLayout(
      this.#node,
      this.#node.width,
      this.#node.height,
    )
    this.#layout = layout
    const { palette } = layout
    const collapsed = this.#session.collapsed
    if (this.#options.footprintElement) {
      applyTeacherControllerDomFootprint(
        this.#options.footprintElement,
        this.#node,
        collapsed,
      )
    }
    const dom = this.#options.container.ownerDocument
    this.#root.replaceChildren()
    this.#buttons.clear()

    if (!collapsed) {
      const background = dom.createElement('div')
      background.className = 'slide-teacher-controller-background'
      background.style.position = 'absolute'
      background.style.inset = '0'
      background.style.borderRadius = `${layout.cornerRadius}px`
      background.style.background = colorWithAlpha(palette.backgroundCss, palette.backgroundAlpha)
      background.style.border = `1.5px solid ${colorWithAlpha(palette.accentCss, 0.72)}`
      this.#root.appendChild(background)

      const accent = dom.createElement('div')
      accent.className = 'slide-teacher-controller-accent'
      accent.style.position = 'absolute'
      accent.style.left = `${layout.padding}px`
      accent.style.top = `${layout.padding}px`
      accent.style.width = '3px'
      accent.style.height = `${Math.max(4, layout.height - layout.padding * 2)}px`
      accent.style.borderRadius = '1.5px'
      accent.style.background = colorWithAlpha(palette.accentCss, 0.92)
      this.#root.appendChild(accent)

      const title = dom.createElement('strong')
      title.className = 'slide-teacher-controller-title'
      title.textContent = this.#node.title
      applyRect(title, layout.title)
      title.style.fontSize = `${layout.titleFontSize}px`
      title.style.color = palette.textCss
      title.style.fontWeight = '700'
      title.style.display = 'flex'
      title.style.alignItems = 'center'
      title.style.overflow = 'hidden'
      title.style.whiteSpace = 'nowrap'
      title.style.textOverflow = 'ellipsis'
      this.#root.appendChild(title)

      if (layout.progress) {
        const progress = dom.createElement('div')
        progress.className = 'slide-teacher-controller-progress'
        progress.textContent = formatTeacherControllerProgress(
          this.#options.scenes,
          this.#options.getCurrentSceneId(),
          this.#options.getStateLabel(),
        )
        applyRect(progress, layout.progress)
        progress.style.fontSize = `${layout.progressFontSize}px`
        progress.style.color = palette.accentCss
        progress.style.opacity = '0.84'
        progress.style.display = 'flex'
        progress.style.alignItems = 'center'
        progress.style.overflow = 'hidden'
        progress.style.whiteSpace = 'nowrap'
        progress.style.textOverflow = 'ellipsis'
        this.#root.appendChild(progress)
      }

      for (const button of layout.buttons) {
        const element = this.#createButton(button, palette.textCss)
        this.#buttons.set(button.id, element)
        this.#root.appendChild(element)
      }
    }

    if (layout.collapse) {
      const collapse = layout.collapse
      const element = dom.createElement('button')
      element.type = 'button'
      element.className = 'slide-teacher-controller-collapse'
      element.dataset.teacherControllerCollapse = 'true'
      element.setAttribute('aria-label', collapsed ? '展开教师控制器' : '收起教师控制器')
      element.textContent = collapsed ? '展' : '收'
      applyRect(element, collapse)
      element.style.borderRadius = '999px'
      element.style.border = `1.5px solid ${colorWithAlpha(palette.accentCss, 0.82)}`
      element.style.background = colorWithAlpha(
        palette.backgroundCss,
        Math.max(0.88, palette.backgroundAlpha),
      )
      element.style.color = palette.textCss
      element.style.fontSize = `${Math.max(9, Math.min(13, collapse.height * 0.4))}px`
      element.style.fontWeight = '700'
      element.style.display = 'grid'
      element.style.placeItems = 'center'
      element.style.pointerEvents = 'none'
      element.addEventListener('click', this.#handleCollapseClick)
      this.#collapseButton = element
      this.#root.appendChild(element)
    } else {
      this.#collapseButton = null
    }
    this.#syncCollapsedFocusRing()
  }

  #createButton(
    button: TeacherControllerButtonLayout,
    textColor: string,
  ): HTMLButtonElement {
    const dom = this.#options.container.ownerDocument
    const element = dom.createElement('button')
    element.type = 'button'
    element.dataset.controllerButtonId = button.id
    element.textContent = teacherControllerButtonDisplayLabel(
      button,
      this.#options.getStatus(),
    )
    applyRect(element, button)
    element.style.border = `1px solid ${this.#layout.palette.accentCss}`
    element.style.borderRadius = `${Math.min(
      10,
      button.height / 3,
      button.width / 3,
    )}px`
    element.style.background = numberToCss(this.#layout.palette.button)
    element.style.color = textColor
    element.style.fontSize = `${this.#layout.buttonFontSize}px`
    element.style.fontWeight = '700'
    element.style.pointerEvents = 'none'
    element.addEventListener('click', () => {
      if (this.#destroyed || !this.#options.getInteractive()) return
      this.#options.onAction(button.action)
    })
    return element
  }

  #handleCollapseClick = (): void => {
    this.#toggleCollapsed()
  }

  #handleFocusChange = (): void => {
    this.#syncCollapsedFocusRing()
  }

  #syncCollapsedFocusRing(): void {
    const collapseButton = this.#collapseButton
    if (!collapseButton) return
    const focusVisible = this.#session.collapsed && (
      this.#root.matches(':focus-visible')
      || collapseButton.matches(':focus-visible')
    )
    if (focusVisible) {
      collapseButton.style.outline = 'none'
      collapseButton.style.boxShadow = `inset 0 0 0 3px ${this.#layout.palette.textCss}`
      return
    }
    collapseButton.style.removeProperty('outline')
    collapseButton.style.removeProperty('box-shadow')
  }

  #toggleCollapsed(): void {
    if (this.#destroyed || !this.#options.getInteractive()) return
    const collapsed = !this.#session.collapsed
    const offset = constrainTeacherControllerOffset(
      this.#node,
      this.#session.offset,
      collapsed,
      this.#options.canvas,
    )
    this.#session = { offset, collapsed }
    this.#render()
    this.#options.onSessionChange(this.#session)
  }

  #handlePointerDown = (event: PointerEvent): void => {
    if (this.#destroyed || !this.#options.getInteractive()) return
    if (this.#drag) return
    const local = this.#localPoint(event)
    const target = teacherControllerHitTarget(
      local,
      this.#layout,
      this.#session.collapsed,
    )
    if (!target) return
    this.#drag = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      startOffset: { ...this.#session.offset },
      threshold: event.pointerType === 'touch'
        ? TEACHER_CONTROLLER_TOUCH_DRAG_THRESHOLD_PX
        : TEACHER_CONTROLLER_MOUSE_DRAG_THRESHOLD_PX,
      dragging: false,
      target,
      ...(target === 'button'
        ? { buttonAction: this.#buttonActionAt(local) }
        : {}),
    }
    try {
      this.#root.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; the gesture still resolves on the root.
    }
  }

  #handlePointerMove = (event: PointerEvent): void => {
    const drag = this.#drag
    if (!drag || drag.pointerId !== event.pointerId) return
    const distance = Math.hypot(
      event.clientX - drag.start.x,
      event.clientY - drag.start.y,
    )
    if (!drag.dragging && distance < drag.threshold) return
    drag.dragging = true
    const stage = this.#options.getRenderedStageBounds()
    const delta = teacherControllerStagePointerDelta(
      drag.start,
      { x: event.clientX, y: event.clientY },
      { width: Math.max(1, stage.width), height: Math.max(1, stage.height) },
      this.#options.canvas,
    )
    const offset = constrainTeacherControllerOffset(
      this.#node,
      {
        dx: drag.startOffset.dx + delta.dx,
        dy: drag.startOffset.dy + delta.dy,
      },
      this.#session.collapsed,
      this.#options.canvas,
    )
    this.#session = { ...this.#session, offset }
    this.#options.onSessionChange(this.#session)
  }

  #handlePointerUp = (event: PointerEvent): void => {
    const drag = this.#drag
    if (!drag || drag.pointerId !== event.pointerId) return
    this.#drag = null
    try {
      this.#root.releasePointerCapture(event.pointerId)
    } catch {
      // The browser may already have released capture after pointercancel.
    }
    if (drag.dragging) return
    if (drag.target === 'collapse') {
      this.#toggleCollapsed()
      return
    }
    if (drag.target === 'button' && drag.buttonAction) {
      if (!this.#destroyed && this.#options.getInteractive()) {
        this.#options.onAction(drag.buttonAction)
      }
    }
  }

  #handlePointerCancel = (event: PointerEvent): void => {
    const drag = this.#drag
    if (!drag || drag.pointerId !== event.pointerId) return
    this.#drag = null
    try {
      this.#root.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort.
    }
  }

  #handleKeyDown = (event: KeyboardEvent): void => {
    if (this.#destroyed || !this.#options.getInteractive()) return
    if (!event.altKey || event.ctrlKey || event.metaKey) return
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey
      ? TEACHER_CONTROLLER_KEYBOARD_FINE_STEP
      : TEACHER_CONTROLLER_KEYBOARD_STEP
    const proposed = { ...this.#session.offset }
    if (event.key === 'ArrowLeft') proposed.dx -= step
    if (event.key === 'ArrowRight') proposed.dx += step
    if (event.key === 'ArrowUp') proposed.dy -= step
    if (event.key === 'ArrowDown') proposed.dy += step
    const offset = constrainTeacherControllerOffset(
      this.#node,
      proposed,
      this.#session.collapsed,
      this.#options.canvas,
      false,
    )
    this.#session = { ...this.#session, offset }
    this.#options.onSessionChange(this.#session)
  }

  #handleFullscreenChange = (): void => {
    if (this.#destroyed) return
    this.#render()
  }

  #localPoint(event: PointerEvent): { x: number; y: number } {
    const client = { x: event.clientX, y: event.clientY }
    const stage = this.#options.getRenderedStageBounds()
    const canvas = this.#options.canvas
    if (
      typeof stage.left === 'number'
      && typeof stage.top === 'number'
      && stage.width > 1
      && stage.height > 1
      && canvas.width > 0
      && canvas.height > 0
    ) {
      const scaleX = stage.width / canvas.width
      const scaleY = stage.height / canvas.height
      const offset = this.#session.offset
      return teacherControllerLocalPointFromClient(
        client,
        {
          left: stage.left + (this.#node.x + offset.dx) * scaleX,
          top: stage.top + (this.#node.y + offset.dy) * scaleY,
          width: Math.max(1, this.#node.width * scaleX),
          height: Math.max(1, this.#node.height * scaleY),
        },
        this.#node,
      )
    }
    const rect = this.#root.getBoundingClientRect()
    const width = rect.width > 1 ? rect.width : this.#node.width
    const height = rect.height > 1 ? rect.height : this.#node.height
    return teacherControllerLocalPointFromClient(
      client,
      { left: rect.left, top: rect.top, width, height },
      this.#node,
    )
  }

  #buttonActionAt(local: { x: number; y: number }): TeacherControllerAction | undefined {
    return this.#layout.buttons.find((button) => (
      local.x >= button.x &&
      local.x <= button.x + button.width &&
      local.y >= button.y &&
      local.y <= button.y + button.height
    ))?.action
  }
}

/** Composes the runtime node view from a layer item frame and controller data. */
export function teacherControllerDomNode(
  frame: { x: number; y: number; width: number; height: number },
  rotation: number,
  data: {
    title: string
    compact: boolean
    showSceneProgress: boolean
    collapsible: boolean
    buttons: TeacherControllerButton[]
    style: TeacherControllerRuntimeNode['style']
  },
): TeacherControllerRuntimeNode {
  return sanitizeRuntimeControllerNode({
    ...frame,
    rotation,
    ...structuredClone(data),
  })
}

function sanitizeRuntimeControllerNode(
  node: TeacherControllerRuntimeNode,
): TeacherControllerRuntimeNode {
  return {
    ...node,
    buttons: runtimeTeacherControllerButtons(node.buttons),
  }
}
