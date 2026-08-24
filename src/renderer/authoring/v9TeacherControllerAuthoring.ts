import { CANVAS_HEIGHT, CANVAS_WIDTH, MIN_NODE_SIZE } from '../../shared/constants'
import { makeAuthoringAddress } from '../../shared/authoringAddress'
import type {
  CourseProjectDocument,
  NativeLayerItem,
} from '../../shared/courseProjectTypes'
import {
  isCourseTeacherControllerLayerItem,
} from '../../shared/teacherControllerConsistency'
import {
  constrainTeacherControllerAuthoringFrame,
  createTeacherControllerLayout,
  teacherControllerContentRect,
  teacherControllerSelectionChrome,
  type TeacherControllerLayout,
  type TeacherControllerLayoutSource,
  type TeacherControllerRect,
} from '../../shared/teacherControllerLayout'
import {
  clientDeltaToWorld,
  clientToWorld,
  createStageViewportTransform,
  pointInsideRotatedWorldRect,
  resizeWorldFrameFromHandle,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  stageResizeHandleWorldPoint,
  stageSelectionOverlayGeometry,
  type StagePoint,
  type StageRect,
  type StageResizeHandleDirection,
  type StageSelectionOverlayGeometry,
  type StageViewportTransform,
  type StageViewportTransformOptions,
} from './stageViewportTransform'
import {
  SLIDE_BACKEND_NOT_CANDIDATE,
} from '../store/slideBackendPort'
import {
  selectSlideAuthoringBackend,
  useEditorStore,
} from '../store/editorStore'
import {
  commitSlideAuthoringHistory,
  commitSlideProjectMutation,
  SlideCommandError,
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  type SlideAuthoringSessionRef,
  type SlideAuthoringTarget,
  type SlideCommandOptions,
  type SlideCommandResult,
} from '../course/slideEditorCommands'
import type { SlideAuthoringSession } from '../course/slideAuthoringBackend'

const HANDLE_HIT_RADIUS = 10

export type TeacherControllerAuthoringKind = 'v8' | 'v9-controller-candidate'

export type TeacherControllerAuthoringPhase = 'preview' | 'commit'

export interface TeacherControllerAuthoringPointer {
  readonly x: number
  readonly y: number
  readonly space?: 'client' | 'world'
}

export type TeacherControllerAuthoringResult =
  | {
      readonly kind: 'v8'
      readonly reason: typeof SLIDE_BACKEND_NOT_CANDIDATE
    }
  | {
      readonly kind: 'v9-controller-candidate'
      readonly overlay: StageSelectionOverlayGeometry | null
      readonly layout: TeacherControllerLayout | null
      readonly preview?: StageRect
      readonly target?: SlideAuthoringTarget
      readonly command?: SlideCommandResult
      readonly source: 'global'
      readonly inert: true
      readonly locked?: boolean
    }

interface MoveGesture {
  readonly type: 'move'
  readonly layerItemId: string
  readonly startWorld: StagePoint
  readonly startFrame: StageRect
  readonly rotation: number
}

interface ResizeGesture {
  readonly type: 'resize'
  readonly layerItemId: string
  readonly direction: StageResizeHandleDirection
  readonly startFrame: StageRect
  readonly rotation: number
}

type ControllerGesture = MoveGesture | ResizeGesture

function v8Fallback(): TeacherControllerAuthoringResult {
  return { kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE }
}

function readCandidate() {
  return selectSlideAuthoringBackend(useEditorStore.getState())
}

function viewportTransform(
  options: StageViewportTransformOptions,
): StageViewportTransform {
  return createStageViewportTransform(options)
}

export function pointerToControllerWorld(
  pointer: TeacherControllerAuthoringPointer,
  options: StageViewportTransformOptions,
): StagePoint {
  if (pointer.space === 'world') return { x: pointer.x, y: pointer.y }
  return clientToWorld(viewportTransform(options), { x: pointer.x, y: pointer.y })
}

export function findGlobalTeacherControllerItems(
  project: CourseProjectDocument,
): NativeLayerItem[] {
  return project.globalLayerItems.flatMap((entry) => (
    isCourseTeacherControllerLayerItem(entry.item) ? [entry.item] : []
  ))
}

export function findGlobalTeacherController(
  project: CourseProjectDocument,
  layerItemId?: string,
): NativeLayerItem | null {
  const items = findGlobalTeacherControllerItems(project)
  if (layerItemId) {
    return items.find((item) => item.layerItemId === layerItemId) ?? null
  }
  return items[0] ?? null
}

function sceneOwnsTeacherController(
  project: CourseProjectDocument,
  layerItemId: string,
): boolean {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
      if (item && isCourseTeacherControllerLayerItem(item)) return true
    }
  }
  return false
}

export function teacherControllerCanonicalFrame(
  item: Pick<NativeLayerItem, 'frame'>,
): StageRect {
  return teacherControllerContentRect(item.frame)
}

export function teacherControllerOverlayGeometry(
  transform: StageViewportTransform,
  frame: StageRect,
  rotation = 0,
): StageSelectionOverlayGeometry | null {
  const chrome = teacherControllerSelectionChrome(frame)
  return stageSelectionOverlayGeometry(transform, [{ ...chrome, rotation }])
}

export function teacherControllerPropertiesPreview(
  source: TeacherControllerLayoutSource,
  frame: TeacherControllerRect,
): TeacherControllerLayout {
  return createTeacherControllerLayout(source, frame.width, frame.height)
}

/**
 * Geometry is identical for preview and commit. Callers apply this on
 * pointermove without history, then write the same rect once on pointerup.
 * Pointers are already in Project world space via `stageViewportTransform`.
 */
export function teacherControllerGestureFrame(
  start: StageRect,
  pointer: {
    readonly kind: 'move' | 'resize'
    readonly direction?: StageResizeHandleDirection
    readonly startWorld: StagePoint
    readonly currentWorld: StagePoint
  },
  _phase: TeacherControllerAuthoringPhase,
): StageRect {
  if (pointer.kind === 'resize' && pointer.direction) {
    return resizeWorldFrameFromHandle(
      start,
      pointer.direction,
      pointer.currentWorld,
      MIN_NODE_SIZE,
    )
  }
  return {
    x: start.x + (pointer.currentWorld.x - pointer.startWorld.x),
    y: start.y + (pointer.currentWorld.y - pointer.startWorld.y),
    width: start.width,
    height: start.height,
  }
}

function layoutSourceFromItem(item: NativeLayerItem): TeacherControllerLayoutSource {
  if (!isCourseTeacherControllerLayerItem(item)) {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前项不是教师控制器')
  }
  return item.content.data
}

function safeAuthoringFrame(
  item: NativeLayerItem,
  frame: StageRect,
  rotation: number,
): StageRect {
  return constrainTeacherControllerAuthoringFrame(
    layoutSourceFromItem(item),
    frame,
    rotation,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  )
}

function failCommand(
  session: SlideAuthoringSession,
  reason: string,
): SlideCommandResult {
  return {
    ok: false,
    reason,
    nextSession: session,
    historyEntry: false,
    selection: session.selection,
  }
}

/**
 * Writes the global controller frame once. Scene Native transform commands
 * refuse this owner; do not route controller gestures through
 * `transformNativeLayers`.
 */
export function commitTeacherControllerAuthoringFrame(
  session: SlideAuthoringSessionRef,
  input: {
    readonly layerItemId: string
    readonly frame: StageRect
    readonly rotation?: number
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  if (
    options.expectedRevision !== undefined &&
    options.expectedRevision !== session.history.present.revision
  ) {
    return failCommand(session, SLIDE_REJECT_STALE_REVISION)
  }
  if (sceneOwnsTeacherController(session.history.present, input.layerItemId)) {
    return failCommand(session, SLIDE_REJECT_WRONG_OWNER)
  }
  const current = findGlobalTeacherController(session.history.present, input.layerItemId)
  if (!current) {
    return failCommand(session, 'missing-controller')
  }
  if (current.locked) return failCommand(session, SLIDE_REJECT_LOCKED)
  if (
    !Number.isFinite(input.frame.x) ||
    !Number.isFinite(input.frame.y) ||
    !Number.isFinite(input.frame.width) ||
    !Number.isFinite(input.frame.height) ||
    input.frame.width < MIN_NODE_SIZE ||
    input.frame.height < MIN_NODE_SIZE
  ) {
    return failCommand(session, 'invalid-target')
  }
  const rotation = input.rotation ?? current.rotation
  if (!Number.isFinite(rotation)) return failCommand(session, 'invalid-target')
  const frame = safeAuthoringFrame(current, input.frame, rotation)
  const unchanged =
    Math.abs(current.frame.x - frame.x) < 0.01 &&
    Math.abs(current.frame.y - frame.y) < 0.01 &&
    Math.abs(current.frame.width - frame.width) < 0.01 &&
    Math.abs(current.frame.height - frame.height) < 0.01 &&
    Math.abs(current.rotation - rotation) < 0.01
  if (unchanged) {
    return {
      ok: true,
      nextSession: session,
      historyEntry: false,
      selection: session.selection,
    }
  }
  try {
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const entry = draft.globalLayerItems.find(
        (candidate) => candidate.item.layerItemId === input.layerItemId,
      )
      if (!entry || !isCourseTeacherControllerLayerItem(entry.item)) {
        throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '教师控制器必须是 global owner')
      }
      entry.item.frame = {
        mode: 'absolute',
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      }
      entry.item.rotation = rotation
    }, options.now)
    const nextSession: SlideAuthoringSessionRef = {
      ...session,
      history: commitSlideAuthoringHistory(session.history, project),
    }
    return {
      ok: true,
      nextSession,
      historyEntry: true,
      selection: nextSession.selection,
    }
  } catch (error) {
    if (error instanceof SlideCommandError) return failCommand(session, error.reason)
    return failCommand(session, error instanceof Error ? error.message : '命令失败')
  }
}

function hitResizeHandle(
  frame: StageRect,
  rotation: number,
  world: StagePoint,
): StageResizeHandleDirection | null {
  for (const direction of STAGE_RESIZE_HANDLE_DIRECTIONS) {
    const point = stageResizeHandleWorldPoint(frame, direction, rotation)
    if (Math.hypot(world.x - point.x, world.y - point.y) <= HANDLE_HIT_RADIUS) {
      return direction
    }
  }
  return null
}

function hitControllerItem(
  items: readonly NativeLayerItem[],
  world: StagePoint,
): NativeLayerItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (!item.visible) continue
    const frame = teacherControllerCanonicalFrame(item)
    if (pointInsideRotatedWorldRect(world, frame, item.rotation)) return item
    if (hitResizeHandle(frame, item.rotation, world)) return item
  }
  return null
}

function makeControllerTarget(
  session: SlideAuthoringSession,
  item: NativeLayerItem,
): SlideAuthoringTarget {
  return Object.freeze({
    sessionId: session.sessionId,
    revision: session.history.present.revision,
    generation: session.generation,
    authoringAddress: makeAuthoringAddress({
      projectId: session.history.present.id,
      scope: 'global',
      carrier: 'native',
      layerItemId: item.layerItemId,
      field: 'item',
    }),
    scope: 'global',
    layerItemId: item.layerItemId,
  })
}

function applyCandidate(
  run: (session: SlideAuthoringSession) => SlideCommandResult,
): SlideCommandResult {
  return useEditorStore.getState().applySlideCandidateCommand(run)
}

/**
 * Authoring kernel for the global teacher controller. Default V8
 * (`selectSlideAuthoringBackend === null`) returns `{ kind: 'v8' }` and never
 * reports a successful command. Candidate pointermove only previews; pointerup
 * writes one history entry through `applySlideCandidateCommand`.
 */
export function createV9TeacherControllerAuthoringController() {
  let gesture: ControllerGesture | null = null
  let preview: StageRect | null = null

  const resolveKind = (): TeacherControllerAuthoringKind =>
    readCandidate() ? 'v9-controller-candidate' : 'v8'

  const currentItem = (): NativeLayerItem | null => {
    const backend = readCandidate()
    return backend ? findGlobalTeacherController(backend.getSession().history.present) : null
  }

  const overlayGeometry = (
    options: StageViewportTransformOptions,
  ): StageSelectionOverlayGeometry | null => {
    const backend = readCandidate()
    if (!backend) return null
    if (backend.getSession().scope !== 'global') return null
    const item = currentItem()
    if (!item) return null
    const frame = preview ?? teacherControllerCanonicalFrame(item)
    return teacherControllerOverlayGeometry(
      viewportTransform(options),
      frame,
      item.rotation,
    )
  }

  const propertiesPreview = (
    frame?: StageRect,
  ): TeacherControllerLayout | null => {
    const item = currentItem()
    if (!item) return null
    return teacherControllerPropertiesPreview(
      layoutSourceFromItem(item),
      frame ?? preview ?? teacherControllerCanonicalFrame(item),
    )
  }

  const v9Result = (
    backend: NonNullable<ReturnType<typeof readCandidate>>,
    options: StageViewportTransformOptions,
    extra: Partial<Omit<Extract<TeacherControllerAuthoringResult, { kind: 'v9-controller-candidate' }>, 'kind' | 'source' | 'inert' | 'overlay' | 'layout'>> = {},
  ): TeacherControllerAuthoringResult => {
    const item = extra.target
      ? findGlobalTeacherController(backend.getSession().history.present, extra.target.layerItemId)
      : currentItem()
    const frame = extra.preview ??
      preview ??
      (item ? teacherControllerCanonicalFrame(item) : null)
    const rotation = item?.rotation ?? 0
    const globalAuthoring = backend.getSession().scope === 'global'
    return {
      kind: 'v9-controller-candidate',
      overlay: globalAuthoring && frame
        ? teacherControllerOverlayGeometry(viewportTransform(options), frame, rotation)
        : null,
      layout: item
        ? teacherControllerPropertiesPreview(
            layoutSourceFromItem(item),
            frame ?? teacherControllerCanonicalFrame(item),
          )
        : null,
      source: 'global',
      inert: true,
      ...extra,
    }
  }

  const pointerDown = (
    pointer: TeacherControllerAuthoringPointer,
    options: StageViewportTransformOptions,
  ): TeacherControllerAuthoringResult => {
    const backend = readCandidate()
    if (!backend) return v8Fallback()
    const session = backend.getSession()
    if (session.scope !== 'global') {
      gesture = null
      preview = null
      return v9Result(backend, options)
    }
    const world = pointerToControllerWorld(pointer, options)
    const items = findGlobalTeacherControllerItems(session.history.present)
    if (items.length === 0) {
      return v9Result(backend, options, {
        command: failCommand(session, 'missing-controller'),
      })
    }
    const item = hitControllerItem(items, world) ??
      items.find((candidate) => {
        const frame = teacherControllerCanonicalFrame(candidate)
        return hitResizeHandle(frame, candidate.rotation, world) !== null
      })
    if (!item) {
      gesture = null
      preview = null
      return v9Result(backend, options)
    }
    const target = makeControllerTarget(session, item)
    const frame = teacherControllerCanonicalFrame(item)
    if (item.locked) {
      gesture = null
      preview = null
      return v9Result(backend, options, { target, locked: true })
    }
    const direction = hitResizeHandle(frame, item.rotation, world)
    if (direction) {
      gesture = {
        type: 'resize',
        layerItemId: item.layerItemId,
        direction,
        startFrame: frame,
        rotation: item.rotation,
      }
    } else {
      gesture = {
        type: 'move',
        layerItemId: item.layerItemId,
        startWorld: world,
        startFrame: frame,
        rotation: item.rotation,
      }
    }
    preview = frame
    return v9Result(backend, options, { target, preview, locked: false })
  }

  const pointerMove = (
    pointer: TeacherControllerAuthoringPointer,
    options: StageViewportTransformOptions,
  ): TeacherControllerAuthoringResult => {
    const backend = readCandidate()
    if (!backend) return v8Fallback()
    if (!gesture) return v9Result(backend, options)
    const world = pointerToControllerWorld(pointer, options)
    const rawPreview = gesture.type === 'resize'
      ? teacherControllerGestureFrame(gesture.startFrame, {
          kind: 'resize',
          direction: gesture.direction,
          startWorld: world,
          currentWorld: world,
        }, 'preview')
      : teacherControllerGestureFrame(gesture.startFrame, {
          kind: 'move',
          startWorld: gesture.startWorld,
          currentWorld: world,
        }, 'preview')
    const item = findGlobalTeacherController(
      backend.getSession().history.present,
      gesture.layerItemId,
    )
    preview = item
      ? safeAuthoringFrame(item, rawPreview, gesture.rotation)
      : rawPreview
    return v9Result(backend, options, {
      preview,
      ...(item ? { target: makeControllerTarget(backend.getSession(), item) } : {}),
    })
  }

  const pointerUp = (
    pointer: TeacherControllerAuthoringPointer,
    options: StageViewportTransformOptions,
  ): TeacherControllerAuthoringResult => {
    const backend = readCandidate()
    if (!backend) return v8Fallback()
    const active = gesture
    gesture = null
    if (!active) {
      preview = null
      return v9Result(backend, options)
    }
    const world = pointerToControllerWorld(pointer, options)
    const rawFrame = active.type === 'resize'
      ? teacherControllerGestureFrame(active.startFrame, {
          kind: 'resize',
          direction: active.direction,
          startWorld: world,
          currentWorld: world,
        }, 'commit')
      : teacherControllerGestureFrame(active.startFrame, {
          kind: 'move',
          startWorld: active.startWorld,
          currentWorld: world,
        }, 'commit')
    const liveItem = findGlobalTeacherController(
      backend.getSession().history.present,
      active.layerItemId,
    )
    const frame = liveItem
      ? safeAuthoringFrame(liveItem, rawFrame, active.rotation)
      : rawFrame
    const snapshot = backend.getSnapshot()
    const command = applyCandidate((session) =>
      commitTeacherControllerAuthoringFrame(session, {
        layerItemId: active.layerItemId,
        frame,
        rotation: active.rotation,
      }, { expectedRevision: snapshot.revision }),
    )
    preview = null
    const nextBackend = readCandidate() ?? backend
    const committed = findGlobalTeacherController(
      nextBackend.getSession().history.present,
      active.layerItemId,
    )
    return v9Result(nextBackend, options, {
      command,
      preview: undefined,
      ...(committed
        ? { target: makeControllerTarget(nextBackend.getSession(), committed) }
        : {}),
    })
  }

  const pointerCancel = (
    _pointer: TeacherControllerAuthoringPointer,
    options: StageViewportTransformOptions,
  ): TeacherControllerAuthoringResult => {
    const backend = readCandidate()
    if (!backend) return v8Fallback()
    gesture = null
    preview = null
    return v9Result(backend, options)
  }

  return {
    resolveKind,
    overlayGeometry,
    propertiesPreview,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    previewFrame: () => preview,
  }
}

export function resolveTeacherControllerAuthoringKind(): TeacherControllerAuthoringKind {
  return readCandidate() ? 'v9-controller-candidate' : 'v8'
}

export function clientDeltaToControllerWorld(
  options: StageViewportTransformOptions,
  delta: StagePoint,
): StagePoint {
  return clientDeltaToWorld(viewportTransform(options), delta)
}

export { SLIDE_BACKEND_NOT_CANDIDATE, SLIDE_REJECT_WRONG_OWNER, STAGE_RESIZE_HANDLE_DIRECTIONS }
