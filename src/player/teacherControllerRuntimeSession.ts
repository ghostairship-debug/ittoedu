import {
  createTeacherControllerLayout,
  constrainTeacherControllerBounds,
  teacherControllerAuthoringRecoveryBounds,
  teacherControllerRecoveryLocalRect,
  type TeacherControllerLayoutSource,
  type TeacherControllerRect,
} from '../shared/teacherControllerLayout'

export const TEACHER_CONTROLLER_MOUSE_DRAG_THRESHOLD_PX = 6
export const TEACHER_CONTROLLER_TOUCH_DRAG_THRESHOLD_PX = 10
export const TEACHER_CONTROLLER_EDGE_SNAP = 12
export const TEACHER_CONTROLLER_KEYBOARD_STEP = 8
export const TEACHER_CONTROLLER_KEYBOARD_FINE_STEP = 1

export interface TeacherControllerSessionOffset {
  dx: number
  dy: number
}

export interface TeacherControllerLogicalSize {
  width: number
  height: number
}

export interface TeacherControllerRuntimeSessionValue {
  offset: TeacherControllerSessionOffset
  collapsed: boolean
}

export interface TeacherControllerRuntimeSessionAddress {
  controllerId: string
  surfaceSessionId: string
  defaultCollapsed: boolean
}

/**
 * Runtime-only controller state. Collapse follows a stable controller across
 * the course, while offsets remain owned by the surface session that moved it.
 */
export class TeacherControllerRuntimeSessionStore {
  readonly #collapsedByControllerId = new Map<string, boolean>()
  readonly #offsetBySurfaceSession = new Map<string, Map<string, TeacherControllerSessionOffset>>()

  get(address: TeacherControllerRuntimeSessionAddress): TeacherControllerRuntimeSessionValue {
    const surfaceOffsets = this.#offsetBySurfaceSession.get(address.surfaceSessionId)
    const offset = surfaceOffsets?.get(address.controllerId) ?? { dx: 0, dy: 0 }
    return {
      offset: { ...offset },
      collapsed: this.#collapsedByControllerId.get(address.controllerId)
        ?? address.defaultCollapsed,
    }
  }

  set(
    address: TeacherControllerRuntimeSessionAddress,
    value: TeacherControllerRuntimeSessionValue,
  ): void {
    this.#collapsedByControllerId.set(address.controllerId, value.collapsed)
    let surfaceOffsets = this.#offsetBySurfaceSession.get(address.surfaceSessionId)
    if (!surfaceOffsets) {
      surfaceOffsets = new Map()
      this.#offsetBySurfaceSession.set(address.surfaceSessionId, surfaceOffsets)
    }
    surfaceOffsets.set(address.controllerId, { ...value.offset })
  }

  resetSurface(surfaceSessionId: string): void {
    this.#offsetBySurfaceSession.delete(surfaceSessionId)
  }

  resetCourse(): void {
    this.#collapsedByControllerId.clear()
    this.#offsetBySurfaceSession.clear()
  }
}

export type TeacherControllerGestureOutcome = 'activate' | 'moved' | 'cancelled'

/**
 * Structural node view shared by the Phaser renderer and the DOM surface
 * adapter: the authoring frame plus the layout source fields. `TeacherControllerNode`
 * satisfies it, and DOM hosts compose it from a layer item's frame + content.
 */
export type TeacherControllerRuntimeNode = TeacherControllerLayoutSource & {
  title: string
  /** Ephemeral host chrome; never part of a course node. */
  playbackView?: boolean
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/** Keeps Phaser callback payloads out of the click-versus-drag decision. */
export function teacherControllerGestureOutcome(
  dragging: boolean,
  cancelled: boolean,
): TeacherControllerGestureOutcome {
  if (cancelled) return 'cancelled'
  return dragging ? 'moved' : 'activate'
}

interface AxisAlignedBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Layout-local rectangle that is actually visible and interactive at runtime.
 * DOM clipping and hit bounds consume this result. Oversized panels constrain
 * their recovery controls instead of requiring the full panel to fit.
 */
export function teacherControllerVisibleLocalRect(
  node: TeacherControllerRuntimeNode,
  collapsed: boolean,
): TeacherControllerRect {
  if (collapsed) {
    const collapse = createTeacherControllerLayout(node, node.width, node.height)
      .collapse
    if (collapse) return teacherControllerRecoveryLocalRect(node, node)
  }
  return { x: 0, y: 0, width: node.width, height: node.height }
}

function rotatedBounds(
  node: TeacherControllerRuntimeNode,
  offset: TeacherControllerSessionOffset,
  collapsed: boolean,
): AxisAlignedBounds {
  const rect = teacherControllerVisibleLocalRect(node, collapsed)
  const radians = node.rotation * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const centerX = node.x + node.width / 2 + offset.dx
  const centerY = node.y + node.height / 2 + offset.dy
  const localCenterX = node.width / 2
  const localCenterY = node.height / 2
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ].map(([x, y]) => {
    const relativeX = x! - localCenterX
    const relativeY = y! - localCenterY
    return {
      x: centerX + relativeX * cosine - relativeY * sine,
      y: centerY + relativeX * sine + relativeY * cosine,
    }
  })
  return {
    left: Math.min(...corners.map(({ x }) => x)),
    top: Math.min(...corners.map(({ y }) => y)),
    right: Math.max(...corners.map(({ x }) => x)),
    bottom: Math.max(...corners.map(({ y }) => y)),
  }
}

/** Keeps the panel, or its recovery controls on oversized axes, on canvas. */
export function constrainTeacherControllerOffset(
  node: TeacherControllerRuntimeNode,
  proposed: TeacherControllerSessionOffset,
  collapsed: boolean,
  canvas: TeacherControllerLogicalSize,
  snapToEdge = true,
): TeacherControllerSessionOffset {
  const safeCanvas = {
    width: Math.max(1, canvas.width),
    height: Math.max(1, canvas.height),
  }
  const visible = rotatedBounds(node, proposed, collapsed)
  const recovery = teacherControllerAuthoringRecoveryBounds(node, {
    x: node.x + proposed.dx,
    y: node.y + proposed.dy,
    width: node.width,
    height: node.height,
  }, node.rotation)
  const horizontal = visible.right - visible.left <= safeCanvas.width ? visible : recovery
  const vertical = visible.bottom - visible.top <= safeCanvas.height ? visible : recovery
  const bounds = {
    left: horizontal.left,
    right: horizontal.right,
    top: vertical.top,
    bottom: vertical.bottom,
  }
  const correction = constrainTeacherControllerBounds(bounds, safeCanvas)
  let offset = { dx: proposed.dx + correction.dx, dy: proposed.dy + correction.dy }
  if (!snapToEdge) return offset

  const snap = (start: number, end: number, available: number): number => {
    if (end - start > available) return 0
    if (start <= TEACHER_CONTROLLER_EDGE_SNAP) return -start
    if (available - end <= TEACHER_CONTROLLER_EDGE_SNAP) return available - end
    return 0
  }
  offset = {
    dx: offset.dx + snap(bounds.left + correction.dx, bounds.right + correction.dx, safeCanvas.width),
    dy: offset.dy + snap(bounds.top + correction.dy, bounds.bottom + correction.dy, safeCanvas.height),
  }
  return offset
}

export function logicalDragDelta(
  start: { x: number; y: number },
  current: { x: number; y: number },
  renderedBounds: TeacherControllerLogicalSize,
  logicalCanvas: TeacherControllerLogicalSize,
): TeacherControllerSessionOffset {
  const width = Math.max(1, renderedBounds.width)
  const height = Math.max(1, renderedBounds.height)
  return {
    dx: (current.x - start.x) * logicalCanvas.width / width,
    dy: (current.y - start.y) * logicalCanvas.height / height,
  }
}

/**
 * Same mapping as `logicalDragDelta`, but the rendered bounds MUST be the
 * stage/viewport CSS size (the 1280×720 surface), never the controller frame.
 * That is the Player equivalent of `clientDeltaToWorld` from
 * `stageViewportTransform` — do not introduce a second coordinate system.
 */
export function teacherControllerStagePointerDelta(
  start: { x: number; y: number },
  current: { x: number; y: number },
  stageCss: TeacherControllerLogicalSize,
  logicalCanvas: TeacherControllerLogicalSize,
): TeacherControllerSessionOffset {
  return logicalDragDelta(start, current, stageCss, logicalCanvas)
}

/**
 * Converts a client point on the compositor-positioned controller frame into
 * layout-local coordinates, accounting for CSS scale of the stage.
 */
export function teacherControllerLocalPointFromClient(
  client: { x: number; y: number },
  frameClient: { left: number; top: number; width: number; height: number },
  node: Pick<TeacherControllerRuntimeNode, 'width' | 'height' | 'rotation'>,
): { x: number; y: number } {
  const width = Math.max(1, frameClient.width)
  const height = Math.max(1, frameClient.height)
  const radians = -node.rotation * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const dx = client.x - (frameClient.left + width / 2)
  const dy = client.y - (frameClient.top + height / 2)
  return {
    x: (dx * cosine - dy * sine) * node.width / width + node.width / 2,
    y: (dx * sine + dy * cosine) * node.height / height + node.height / 2,
  }
}

/**
 * World-space axis-aligned bounds of the currently visible controller surface
 * (full panel when expanded, only the collapse pill when collapsed).
 */
export function teacherControllerHitBounds(
  node: TeacherControllerRuntimeNode,
  offset: TeacherControllerSessionOffset,
  collapsed: boolean,
): { left: number; top: number; right: number; bottom: number } {
  return rotatedBounds(node, offset, collapsed)
}

/**
 * Runtime consoles keep the authored action set minus authoring-only labels.
 * “定位” and in-console “试运行” belong to the editor shell, not playback.
 */
export function isRuntimeTeacherControllerButton(button: {
  label: string
  visible?: boolean
}): boolean {
  if (button.visible === false) return false
  const label = button.label.trim()
  return label !== '定位' && !label.includes('试运行')
}

export function runtimeTeacherControllerButtons<T extends { label: string; visible: boolean }>(
  buttons: readonly T[],
): T[] {
  return buttons.filter((button) => isRuntimeTeacherControllerButton(button))
}
