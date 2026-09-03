import * as Phaser from 'phaser'
import type {
  TeacherControllerAction,
  TeacherControllerNode,
} from '../shared/contracts/native-v1/types'
import type { RuntimeEventDisposer } from '../shared/runtimeTypes'
import {
  createTeacherControllerLayout,
  formatTeacherControllerProgress,
  teacherControllerButtonDisplayLabel,
  type TeacherControllerButtonLayout,
  type TeacherControllerViewStatus,
} from '../shared/teacherControllerLayout'
import type {
  RenderedNodeHandle,
  RenderNodeContext,
} from './renderNode'
import {
  SCENE_PICKER_OPEN_EVENT,
  TEACHER_CONTROLLER_COLLAPSE_EVENT,
} from './ScenePickerOverlay'
import {
  constrainTeacherControllerOffset,
  logicalDragDelta,
  runtimeTeacherControllerButtons,
  teacherControllerGestureOutcome,
  TEACHER_CONTROLLER_KEYBOARD_FINE_STEP,
  TEACHER_CONTROLLER_KEYBOARD_STEP,
  TEACHER_CONTROLLER_MOUSE_DRAG_THRESHOLD_PX,
  TEACHER_CONTROLLER_TOUCH_DRAG_THRESHOLD_PX,
  type TeacherControllerSessionOffset,
} from './teacherControllerRuntimeSession'

const FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'

interface SceneEvent {
  sceneId?: string
}

interface PresentationEvent extends SceneEvent {
  stateId?: string
}

interface AudioChangeEvent {
  muted?: boolean
}

interface ButtonControl {
  action: TeacherControllerAction
  zone: Phaser.GameObjects.Zone
  text: Phaser.GameObjects.Text
  activate(): void
  beginGesture(pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData): void
}

interface DragCandidate {
  pointerId: number
  domPointerId: number | null
  start: { x: number; y: number }
  startOffset: TeacherControllerSessionOffset
  threshold: number
  dragging: boolean
  activate?: () => void
}

type PreviewAwareRenderContext = RenderNodeContext & {
  mode?: 'preview' | 'capture'
}

function isPreviewContext(context: RenderNodeContext): boolean {
  return (context as PreviewAwareRenderContext).mode !== 'capture' &&
    context.authoring !== true
}

function pointerEvent(pointer: Phaser.Input.Pointer): PointerEvent | null {
  const event = pointer.event
  return typeof PointerEvent !== 'undefined' && event instanceof PointerEvent
    ? event
    : null
}

function pointerScreenPosition(pointer: Phaser.Input.Pointer): { x: number; y: number } {
  const event = pointer.event as Event & { clientX?: number; clientY?: number }
  return typeof event.clientX === 'number' && typeof event.clientY === 'number'
    ? { x: event.clientX, y: event.clientY }
    : { x: pointer.x, y: pointer.y }
}

function pointerDragThreshold(pointer: Phaser.Input.Pointer): number {
  const event = pointerEvent(pointer)
  return event?.pointerType === 'touch'
    ? TEACHER_CONTROLLER_TOUCH_DRAG_THRESHOLD_PX
    : TEACHER_CONTROLLER_MOUSE_DRAG_THRESHOLD_PX
}

async function toggleDocumentFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      if (typeof document.exitFullscreen === 'function') {
        await document.exitFullscreen()
      }
      return
    }
    const root = document.documentElement
    if (typeof root.requestFullscreen === 'function') {
      await root.requestFullscreen()
    }
  } catch (error) {
    console.error('切换全屏失败', error)
  }
}

export function invokeControllerAction(
  action: TeacherControllerAction,
  context: RenderNodeContext,
): void {
  window.dispatchEvent(new CustomEvent('courseware-teacher-controller-action', {
    detail: {
      action: action.type,
      sceneId: context.sceneId ?? null,
      stateId: context.currentStateId?.() ?? null,
    },
  }))
  switch (action.type) {
    case 'scene.previous':
      context.actions.previousScene()
      break
    case 'scene.next':
      context.actions.nextScene()
      break
    case 'scene.replay':
      context.actions.replayScene()
      break
    case 'course.restart':
      context.actions.restartCourse()
      break
    case 'scene.go':
      context.actions.goToScene(action.sceneId, action.targetStateId)
      break
    case 'scene.open-picker':
      context.events?.emit(SCENE_PICKER_OPEN_EVENT)
      break
    case 'audio.toggle-mute':
      context.events?.emit('audio:toggle-mute')
      break
    case 'player.fullscreen.toggle':
      void toggleDocumentFullscreen()
      break
  }
}

function applyNodeFrame(
  scene: Phaser.Scene,
  node: TeacherControllerNode,
  root: Phaser.GameObjects.Container,
  offset: TeacherControllerSessionOffset,
  transition?: Parameters<RenderedNodeHandle['update']>[1],
): void {
  const x = node.x + node.width / 2 + offset.dx
  const y = node.y + node.height / 2 + offset.dy
  const duration = Math.max(0, Math.min(10_000, transition?.duration ?? 0))
  scene.tweens.killTweensOf(root)
  root.setSize(node.width, node.height)
  if (duration === 0) {
    root
      .setPosition(x, y)
      .setAngle(node.rotation)
      .setAlpha(node.opacity)
      .setVisible(node.visible)
    return
  }
  if (node.visible && !root.visible) root.setAlpha(0).setVisible(true)
  scene.tweens.add({
    targets: root,
    x,
    y,
    angle: node.rotation,
    alpha: node.visible ? node.opacity : 0,
    duration,
    ease: transition?.ease ?? 'Sine.easeInOut',
    onComplete: () => {
      if (root.active) root.setVisible(node.visible).setAlpha(node.opacity)
    },
  })
}

export function renderTeacherController(
  scene: Phaser.Scene,
  initialNode: TeacherControllerNode,
  depth: number,
  context: RenderNodeContext,
): RenderedNodeHandle {
  let node = initialNode
  const layoutNode = (): TeacherControllerNode => (
    isPreviewContext(context)
      ? { ...node, buttons: runtimeTeacherControllerButtons(node.buttons) }
      : node
  )
  let destroyed = false
  let currentSceneId: string | null = null
  let currentStateLabel: string | null = null
  let hostVisible = true
  let motionVisible = true
  let collapsed = initialNode.collapsible && initialNode.defaultCollapsed
  let sessionOffset: TeacherControllerSessionOffset = { dx: 0, dy: 0 }
  let dragCandidate: DragCandidate | null = null
  const controllerVisible = (): boolean => {
    if (!node.visible || !hostVisible || !motionVisible) return false
    if (context.mode === 'capture') return node.includeInStaticExports
    const canvasControlsEnabled = context.canvasControlsEnabled ??
      context.payload.project.playback.controls === 'canvas'
    return canvasControlsEnabled
  }
  const status: TeacherControllerViewStatus = {
    muted: context.payload.project.media.audio.defaultMuted,
    fullscreen: Boolean(document.fullscreenElement),
  }
  const scenes = context.payload.project.scenes.map(({ id, name }) => ({ id, name }))
  const eventDisposers: RuntimeEventDisposer[] = []
  const buttonControls: ButtonControl[] = []
  const accessibleButtons = new Map<string, HTMLButtonElement>()

  const root = scene.add
    .container(node.x + node.width / 2, node.y + node.height / 2)
    .setName(`node:${node.id}`)
    .setDepth(depth)
    .setAngle(node.rotation)
    .setAlpha(node.opacity)
    .setVisible(controllerVisible())
  root.setSize(node.width, node.height)
  context.parentRoot?.add(root)

  const content = scene.add.container(-node.width / 2, -node.height / 2)
  const dragZone = scene.add.zone(0, 0, 1, 1).setOrigin(0.5)
  const graphics = scene.add.graphics()
  const titleText = scene.add.text(0, 0, '', {
    fontFamily: FONT_FAMILY,
    fontStyle: 'bold',
  })
  const progressText = scene.add.text(0, 0, '', {
    fontFamily: FONT_FAMILY,
  })
  const collapseZone = scene.add.zone(0, 0, 1, 1).setOrigin(0.5)
  const collapseText = scene.add.text(0, 0, '', {
    fontFamily: FONT_FAMILY,
    fontStyle: 'bold',
    align: 'center',
  }).setOrigin(0.5)
  const accessibilityGroup = isPreviewContext(context) && context.accessibilityRoot
    ? document.createElement('div')
    : null
  const accessibilityAnnouncement = accessibilityGroup
    ? document.createElement('span')
    : null
  const accessibleCollapseButton = accessibilityGroup
    ? document.createElement('button')
    : null

  if (accessibilityGroup) {
    accessibilityGroup.className = 'lesson-teacher-controller-accessibility'
    accessibilityGroup.tabIndex = 0
    accessibilityGroup.setAttribute('role', 'group')
    accessibilityGroup.setAttribute('aria-label', `${node.title}，可使用 Alt 加方向键移动`)
    accessibilityGroup.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight')
    Object.assign(accessibilityGroup.style, {
      position: 'absolute',
      pointerEvents: 'none',
      transformOrigin: '50% 50%',
      outline: '2px solid transparent',
      outlineOffset: '2px',
    })
    accessibilityGroup.addEventListener('focus', () => {
      accessibilityGroup.style.outlineColor = '#f4c45c'
    })
    accessibilityGroup.addEventListener('blur', (event) => {
      if (!accessibilityGroup.contains(event.relatedTarget as Node | null)) {
        accessibilityGroup.style.outlineColor = 'transparent'
      }
    })
    accessibilityGroup.addEventListener('keydown', handleAccessibilityKeyDown)

    if (accessibilityAnnouncement) {
      accessibilityAnnouncement.setAttribute('role', 'status')
      accessibilityAnnouncement.setAttribute('aria-live', 'polite')
      Object.assign(accessibilityAnnouncement.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
      })
      accessibilityGroup.append(accessibilityAnnouncement)
    }
    if (accessibleCollapseButton) {
      accessibleCollapseButton.type = 'button'
      accessibleCollapseButton.style.position = 'absolute'
      accessibleCollapseButton.style.pointerEvents = 'none'
      accessibleCollapseButton.style.color = 'transparent'
      accessibleCollapseButton.style.background = 'transparent'
      accessibleCollapseButton.style.border = '1px solid transparent'
      accessibleCollapseButton.addEventListener('focus', () => {
        accessibleCollapseButton.style.boxShadow = '0 0 0 3px #f4c45c'
      })
      accessibleCollapseButton.addEventListener('blur', () => {
        accessibleCollapseButton.style.boxShadow = 'none'
      })
      accessibilityGroup.append(accessibleCollapseButton)
    }
    context.accessibilityRoot?.append(accessibilityGroup)
  }

  function announceSession(message: string): void {
    if (accessibilityAnnouncement) accessibilityAnnouncement.textContent = message
    context.events?.emit('player:teacher-controller:session-change', {
      nodeId: node.id,
      dx: sessionOffset.dx,
      dy: sessionOffset.dy,
      collapsed,
      message,
    })
  }

  function applySessionPosition(): void {
    root.setPosition(
      node.x + node.width / 2 + sessionOffset.dx,
      node.y + node.height / 2 + sessionOffset.dy,
    )
  }

  function beginGesture(
    pointer: Phaser.Input.Pointer,
    event: Phaser.Types.Input.EventData,
    activate?: () => void,
  ): void {
    if (
      destroyed ||
      dragCandidate ||
      !controllerVisible() ||
      !isPreviewContext(context)
    ) return
    event.stopPropagation()
    const domEvent = pointerEvent(pointer)
    domEvent?.preventDefault()
    const domPointerId = domEvent?.pointerId ?? null
    if (domPointerId !== null) {
      try {
        scene.game.canvas.setPointerCapture(domPointerId)
      } catch {
        // Pointer capture is best-effort; Phaser still delivers scene-level moves.
      }
    }
    dragCandidate = {
      pointerId: pointer.id,
      domPointerId,
      start: pointerScreenPosition(pointer),
      startOffset: { ...sessionOffset },
      threshold: pointerDragThreshold(pointer),
      dragging: false,
      ...(activate ? { activate } : {}),
    }
  }

  function cancelGesture(): void {
    const candidate = dragCandidate
    dragCandidate = null
    if (candidate?.domPointerId !== null && candidate?.domPointerId !== undefined) {
      try {
        scene.game.canvas.releasePointerCapture(candidate.domPointerId)
      } catch {
        // The browser may already have released capture after pointercancel.
      }
    }
  }

  function handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const candidate = dragCandidate
    if (!candidate || candidate.pointerId !== pointer.id) return
    const current = pointerScreenPosition(pointer)
    const screenDistance = Math.hypot(
      current.x - candidate.start.x,
      current.y - candidate.start.y,
    )
    if (!candidate.dragging && screenDistance < candidate.threshold) return
    candidate.dragging = true
    const bounds = scene.game.canvas.getBoundingClientRect()
    const delta = logicalDragDelta(
      candidate.start,
      current,
      { width: bounds.width, height: bounds.height },
      context.payload.project.canvas,
    )
    sessionOffset = constrainTeacherControllerOffset(
      node,
      {
        dx: candidate.startOffset.dx + delta.dx,
        dy: candidate.startOffset.dy + delta.dy,
      },
      collapsed,
      context.payload.project.canvas,
    )
    applySessionPosition()
    syncAccessibility()
  }

  function finishGesture(pointer: Phaser.Input.Pointer, cancelled = false): void {
    const candidate = dragCandidate
    if (!candidate || candidate.pointerId !== pointer.id) return
    const outcome = teacherControllerGestureOutcome(candidate.dragging, cancelled)
    const activate = candidate.activate
    cancelGesture()
    if (outcome === 'activate') activate?.()
    else if (outcome === 'moved') {
      announceSession(
        `控制器已移动到 ${Math.round(node.x + sessionOffset.dx)}，${Math.round(node.y + sessionOffset.dy)}`,
      )
    }
  }

  // Phaser's pointerup second argument is the currently-over object array. It
  // must never be forwarded as the `cancelled` flag (an empty array is truthy).
  const handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    finishGesture(pointer, false)
  }
  const handlePointerUpOutside = (pointer: Phaser.Input.Pointer): void => {
    finishGesture(pointer, true)
  }

  function handleAccessibilityKeyDown(event: KeyboardEvent): void {
    if (
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
    ) return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey
      ? TEACHER_CONTROLLER_KEYBOARD_FINE_STEP
      : TEACHER_CONTROLLER_KEYBOARD_STEP
    const proposed = { ...sessionOffset }
    if (event.key === 'ArrowLeft') proposed.dx -= step
    if (event.key === 'ArrowRight') proposed.dx += step
    if (event.key === 'ArrowUp') proposed.dy -= step
    if (event.key === 'ArrowDown') proposed.dy += step
    sessionOffset = constrainTeacherControllerOffset(
      node,
      proposed,
      collapsed,
      context.payload.project.canvas,
      false,
    )
    applySessionPosition()
    syncAccessibility()
    announceSession(
      `控制器已移动到 ${Math.round(node.x + sessionOffset.dx)}，${Math.round(node.y + sessionOffset.dy)}`,
    )
  }

  const toggleCollapsed = (): void => {
    if (
      destroyed ||
      !node.collapsible ||
      !node.visible ||
      !isPreviewContext(context)
    ) return
    collapsed = !collapsed
    sessionOffset = constrainTeacherControllerOffset(
      node,
      sessionOffset,
      collapsed,
      context.payload.project.canvas,
    )
    applySessionPosition()
    redraw()
    context.events?.emit(TEACHER_CONTROLLER_COLLAPSE_EVENT, {
      nodeId: node.id,
      collapsed,
    })
  }
  collapseZone
    .setInteractive({ useHandCursor: true })
    .on('pointerdown', (
      pointer: Phaser.Input.Pointer,
      x: number,
      y: number,
      event: Phaser.Types.Input.EventData,
    ) => beginGesture(pointer, event, toggleCollapsed))
  dragZone
    .setInteractive({ useHandCursor: false })
    .on('pointerdown', (
      pointer: Phaser.Input.Pointer,
      x: number,
      y: number,
      event: Phaser.Types.Input.EventData,
    ) => beginGesture(pointer, event))
  accessibleCollapseButton?.addEventListener('click', toggleCollapsed)
  content.add([
    dragZone,
    graphics,
    titleText,
    progressText,
    collapseZone,
    collapseText,
  ])
  root.add(content)

  const stateName = (stateId: string | null): string | null => {
    if (!stateId) return null
    return context.presentation?.states().find((state) => state.id === stateId)
      ?.name ?? stateId
  }

  const removeLastButton = (): void => {
    const control = buttonControls.pop()
    if (!control) return
    control.zone.off('pointerdown', control.beginGesture)
    control.zone.destroy()
    control.text.destroy()
  }

  const syncButtonControls = (
    layouts: TeacherControllerButtonLayout[],
    fontSize: number,
    color: string,
  ): void => {
    while (buttonControls.length < layouts.length) {
      let control: ButtonControl
      const zone = scene.add.zone(0, 0, 1, 1).setOrigin(0.5)
      const text = scene.add.text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
        align: 'center',
      }).setOrigin(0.5)
      control = {
        action: { type: 'scene.next' },
        zone,
        text,
        activate: () => {
          if (
            destroyed ||
            !node.visible ||
            !isPreviewContext(context)
          ) {
            return
          }
          invokeControllerAction(control.action, context)
        },
        beginGesture: (pointer, _x, _y, event) => {
          beginGesture(pointer, event, control.activate)
        },
      }
      zone
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', control.beginGesture)
      buttonControls.push(control)
      content.add([zone, text])
    }
    while (buttonControls.length > layouts.length) removeLastButton()

    layouts.forEach((button, index) => {
      const control = buttonControls[index]!
      control.action = button.action
      control.zone
        .setPosition(button.x + button.width / 2, button.y + button.height / 2)
        .setSize(button.width, button.height)
        .setVisible(controllerVisible() && !collapsed)
      if (control.zone.input) {
        control.zone.input.enabled = controllerVisible() && !collapsed && isPreviewContext(context)
        const hitArea = control.zone.input.hitArea
        if (hitArea instanceof Phaser.Geom.Rectangle) {
          hitArea.setSize(button.width, button.height)
        }
      }
      control.text
        .setText(teacherControllerButtonDisplayLabel(button, status))
        .setColor(color)
        .setFontSize(fontSize)
        .setPosition(
          button.x + button.width / 2,
          button.y + button.height / 2,
        )
        .setWordWrapWidth(Math.max(8, button.width - 8), false)
        .setVisible(controllerVisible() && !collapsed)
    })
  }

  function syncAccessibility(
    suppliedLayout?: ReturnType<typeof createTeacherControllerLayout>,
  ): void {
    if (!accessibilityGroup) return
    const layout = suppliedLayout ??
      createTeacherControllerLayout(layoutNode(), node.width, node.height)
    const visible = controllerVisible() && isPreviewContext(context)
    accessibilityGroup.hidden = !visible
    accessibilityGroup.setAttribute(
      'aria-label',
      `${node.title}${collapsed ? '，已收起' : ''}，可使用 Alt 加方向键移动`,
    )
    Object.assign(accessibilityGroup.style, {
      left: `${node.x + sessionOffset.dx}px`,
      top: `${node.y + sessionOffset.dy}px`,
      width: `${node.width}px`,
      height: `${node.height}px`,
      transform: `rotate(${node.rotation}deg)`,
    })

    if (accessibleCollapseButton) {
      const collapse = layout.collapse
      accessibleCollapseButton.hidden = !visible || !collapse
      accessibleCollapseButton.setAttribute(
        'aria-label',
        collapsed ? '展开教师控制器' : '收起教师控制器',
      )
      if (collapse) {
        Object.assign(accessibleCollapseButton.style, {
          left: `${collapse.x}px`,
          top: `${collapse.y}px`,
          width: `${collapse.width}px`,
          height: `${collapse.height}px`,
        })
      }
    }

    const activeIds = new Set<string>()
    for (const button of layout.buttons) {
      activeIds.add(button.id)
      let element = accessibleButtons.get(button.id)
      if (!element) {
        element = document.createElement('button')
        element.type = 'button'
        element.style.position = 'absolute'
        element.style.pointerEvents = 'none'
        element.style.color = 'transparent'
        element.style.background = 'transparent'
        element.style.border = '1px solid transparent'
        element.addEventListener('focus', () => {
          if (element) element.style.boxShadow = '0 0 0 3px #f4c45c'
        })
        element.addEventListener('blur', () => {
          if (element) element.style.boxShadow = 'none'
        })
        accessibilityGroup.append(element)
        accessibleButtons.set(button.id, element)
      }
      element.hidden = !visible || collapsed
      element.setAttribute(
        'aria-label',
        teacherControllerButtonDisplayLabel(button, status),
      )
      element.onclick = () => {
        const current = createTeacherControllerLayout(layoutNode(), node.width, node.height)
          .buttons.find((candidate) => candidate.id === button.id)
        if (current && controllerVisible() && isPreviewContext(context)) {
          invokeControllerAction(current.action, context)
        }
      }
      Object.assign(element.style, {
        left: `${button.x}px`,
        top: `${button.y}px`,
        width: `${button.width}px`,
        height: `${button.height}px`,
      })
    }
    for (const [id, element] of [...accessibleButtons]) {
      if (activeIds.has(id)) continue
      element.remove()
      accessibleButtons.delete(id)
    }
  }

  const drawButton = (
    button: TeacherControllerButtonLayout,
    palette: ReturnType<typeof createTeacherControllerLayout>['palette'],
  ): void => {
    const radius = Math.min(10, button.height / 3, button.width / 3)
    graphics.fillStyle(palette.button, 0.94)
    graphics.fillRoundedRect(
      button.x,
      button.y,
      button.width,
      button.height,
      radius,
    )
    graphics.lineStyle(1, palette.accent, 0.38)
    graphics.strokeRoundedRect(
      button.x + 0.5,
      button.y + 0.5,
      Math.max(1, button.width - 1),
      Math.max(1, button.height - 1),
      Math.max(0, radius - 0.5),
    )
  }

  const redraw = (): void => {
    if (destroyed) return
    const layout = createTeacherControllerLayout(
      layoutNode(),
      node.width,
      node.height,
    )
    const { palette } = layout
    content.setPosition(-node.width / 2, -node.height / 2)
    dragZone
      .setPosition(layout.width / 2, layout.height / 2)
      .setSize(layout.width, layout.height)
      .setVisible(controllerVisible() && !collapsed)
    if (dragZone.input) {
      dragZone.input.enabled = controllerVisible() &&
        !collapsed &&
        isPreviewContext(context)
      const hitArea = dragZone.input.hitArea
      if (hitArea instanceof Phaser.Geom.Rectangle) {
        hitArea.setSize(layout.width, layout.height)
      }
    }

    graphics.clear()
    if (!collapsed) {
      graphics.fillStyle(palette.background, palette.backgroundAlpha)
      graphics.fillRoundedRect(0, 0, layout.width, layout.height, layout.cornerRadius)
      graphics.lineStyle(1.5, palette.accent, 0.72)
      graphics.strokeRoundedRect(
        0.75,
        0.75,
        Math.max(1, layout.width - 1.5),
        Math.max(1, layout.height - 1.5),
        Math.max(0, layout.cornerRadius - 0.75),
      )
      graphics.fillStyle(palette.accent, 0.92)
      graphics.fillRoundedRect(
        layout.padding,
        layout.padding,
        3,
        Math.max(4, layout.height - layout.padding * 2),
        1.5,
      )
      for (const button of layout.buttons) drawButton(button, palette)
    }

    if (layout.collapse) {
      const collapse = layout.collapse
      graphics.fillStyle(palette.background, Math.max(0.88, palette.backgroundAlpha))
      graphics.fillRoundedRect(
        collapse.x,
        collapse.y,
        collapse.width,
        collapse.height,
        Math.min(collapse.width, collapse.height) / 2,
      )
      graphics.lineStyle(1.5, palette.accent, 0.82)
      graphics.strokeRoundedRect(
        collapse.x + 0.75,
        collapse.y + 0.75,
        Math.max(1, collapse.width - 1.5),
        Math.max(1, collapse.height - 1.5),
        Math.max(0, Math.min(collapse.width, collapse.height) / 2 - 0.75),
      )
      collapseZone
        .setPosition(
          collapse.x + collapse.width / 2,
          collapse.y + collapse.height / 2,
        )
        .setSize(collapse.width, collapse.height)
        .setVisible(controllerVisible())
      if (collapseZone.input) {
        collapseZone.input.enabled = controllerVisible() && isPreviewContext(context)
        const hitArea = collapseZone.input.hitArea
        if (hitArea instanceof Phaser.Geom.Rectangle) {
          hitArea.setSize(collapse.width, collapse.height)
        }
      }
      collapseText
        .setText(collapsed ? '展' : '收')
        .setColor(palette.textCss)
        .setFontSize(Math.max(9, Math.min(13, collapse.height * 0.4)))
        .setPosition(
          collapse.x + collapse.width / 2,
          collapse.y + collapse.height / 2,
        )
        .setVisible(controllerVisible())
    } else {
      collapseZone.setVisible(false)
      if (collapseZone.input) collapseZone.input.enabled = false
      collapseText.setVisible(false)
    }

    titleText
      .setVisible(!collapsed)
      .setText(node.title)
      .setColor(palette.textCss)
      .setFontSize(layout.titleFontSize)
      .setPosition(layout.title.x + 12, layout.title.y + layout.title.height / 2)
      .setOrigin(0, 0.5)
      .setWordWrapWidth(Math.max(8, layout.title.width - 12), false)

    if (layout.progress && !collapsed) {
      progressText
        .setVisible(true)
        .setText(formatTeacherControllerProgress(
          scenes,
          currentSceneId,
          currentStateLabel,
        ))
        .setColor(palette.accentCss)
        .setAlpha(0.84)
        .setFontSize(layout.progressFontSize)
        .setPosition(
          layout.progress.x + 12,
          layout.progress.y + layout.progress.height / 2,
        )
        .setOrigin(0, 0.5)
        .setWordWrapWidth(Math.max(8, layout.progress.width - 12), false)
    } else {
      progressText.setVisible(false)
    }

    syncButtonControls(layout.buttons, layout.buttonFontSize, palette.textCss)
    syncAccessibility(layout)
  }

  const onFullscreenChange = (): void => {
    status.fullscreen = Boolean(document.fullscreenElement)
    redraw()
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)
  scene.input.on('pointermove', handlePointerMove)
  scene.input.on('pointerup', handlePointerUp)
  scene.input.on('pointerupoutside', handlePointerUpOutside)
  scene.input.on('gameout', cancelGesture)
  window.addEventListener('blur', cancelGesture)
  scene.game.canvas.addEventListener('pointercancel', cancelGesture)

  if (context.events) {
    eventDisposers.push(
      context.events.on<SceneEvent>('scene:enter', (event) => {
        currentSceneId = event?.sceneId ?? null
        currentStateLabel = stateName(context.presentation?.current() ?? null)
        redraw()
      }),
      context.events.on<PresentationEvent>('presentation:change', (event) => {
        if (event?.sceneId) currentSceneId = event.sceneId
        currentStateLabel = stateName(event?.stateId ?? null)
        redraw()
      }),
      context.events.on<AudioChangeEvent>('audio:change', (event) => {
        if (typeof event?.muted === 'boolean') status.muted = event.muted
        redraw()
      }),
    )
  }

  redraw()

  return {
    id: initialNode.id,
    type: initialNode.type,
    root,
    setHostVisible(visible): void {
      if (destroyed) return
      hostVisible = visible
      redraw()
      root.setVisible(controllerVisible())
    },
    setMotionVisible(visible): void {
      if (destroyed) return
      motionVisible = visible
      redraw()
      root.setVisible(controllerVisible())
    },
    update(nextNode, transition): void {
      if (
        destroyed ||
        nextNode.type !== 'teacher-controller' ||
        nextNode.id !== initialNode.id
      ) {
        return
      }
      node = nextNode
      if (!node.collapsible) collapsed = false
      sessionOffset = constrainTeacherControllerOffset(
        node,
        sessionOffset,
        collapsed,
        context.payload.project.canvas,
      )
      redraw()
      applyNodeFrame(
        scene,
        controllerVisible() ? node : { ...node, visible: false },
        root,
        sessionOffset,
        transition,
      )
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      cancelGesture()
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      scene.input.off('pointermove', handlePointerMove)
      scene.input.off('pointerup', handlePointerUp)
      scene.input.off('pointerupoutside', handlePointerUpOutside)
      scene.input.off('gameout', cancelGesture)
      window.removeEventListener('blur', cancelGesture)
      scene.game.canvas.removeEventListener('pointercancel', cancelGesture)
      eventDisposers.splice(0).forEach((dispose) => dispose())
      collapseZone.removeAllListeners()
      dragZone.removeAllListeners()
      while (buttonControls.length > 0) removeLastButton()
      accessibleCollapseButton?.removeEventListener('click', toggleCollapsed)
      accessibleButtons.clear()
      accessibilityGroup?.remove()
      scene.tweens.killTweensOf(root)
      if (root.active) root.destroy(true)
    },
  }
}
