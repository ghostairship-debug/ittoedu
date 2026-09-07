import {
  panSpatialRuntimeCamera,
  zoomSpatialRuntimeCameraAt,
  type SpatialRuntimeCamera,
} from './spatialModel'

export const SPATIAL_GESTURE_OWNER_ATTR = 'data-spatial-gesture-owner'

export type SpatialGestureOwner = 'runtime' | 'component' | 'media' | 'controller'

const PAN_THRESHOLD_PX = 4
const ZOOM_IN = 1.08
const ZOOM_OUT = 0.92

const OCCUPIED_SELECTOR = [
  `[${SPATIAL_GESTURE_OWNER_ATTR}]`,
  'video',
  'audio',
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  '[contenteditable="true"]',
].join(',')

/**
 * Playback camera is free-explore plus authored tours. Pan/zoom unless the
 * event target is already owned by runtime, component, media, controller, or
 * a native control. Decorative native text/image/shape do not occupy gestures.
 */
export function spatialPlaybackGestureOccupied(
  target: EventTarget | null,
  root: Element,
): boolean {
  if (!(target instanceof Element)) return false
  if (!root.contains(target)) return false
  const occupied = target.closest(OCCUPIED_SELECTOR)
  return occupied !== null && root.contains(occupied)
}

export function clientDeltaToLogicalScreen(
  root: HTMLElement,
  camera: SpatialRuntimeCamera,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const rect = root.getBoundingClientRect()
  const scaleX = rect.width > 0 ? camera.viewportWidth / rect.width : 1
  const scaleY = rect.height > 0 ? camera.viewportHeight / rect.height : 1
  return { x: dx * scaleX, y: dy * scaleY }
}

export function screenPointInRoot(
  root: HTMLElement,
  camera: SpatialRuntimeCamera,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = root.getBoundingClientRect()
  const scaleX = rect.width > 0 ? camera.viewportWidth / rect.width : 1
  const scaleY = rect.height > 0 ? camera.viewportHeight / rect.height : 1
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  }
}

export interface SpatialPlaybackCameraGestureHost {
  readonly root: HTMLElement
  observation?: boolean
  isActive(): boolean
  getCamera(): SpatialRuntimeCamera | null
  setCamera(camera: SpatialRuntimeCamera): void
}

export function attachSpatialPlaybackCameraGestures(
  host: SpatialPlaybackCameraGestureHost,
): () => void {
  const { root } = host
  let pointer:
    | {
        id: number
        startX: number
        startY: number
        lastX: number
        lastY: number
        panning: boolean
      }
    | null = null
  let suppressClick = false

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false || (host.observation && event.pointerType === 'touch')) return
    if (!host.isActive() || spatialPlaybackGestureOccupied(event.target, root)) return
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      panning: false,
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id) return
    const camera = host.getCamera()
    if (!camera || !host.isActive()) return
    const dx = event.clientX - pointer.lastX
    const dy = event.clientY - pointer.lastY
    if (!pointer.panning) {
      const travelled = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY)
      if (travelled < PAN_THRESHOLD_PX) return
      pointer.panning = true
      try {
        root.setPointerCapture(event.pointerId)
      } catch {
        /* jsdom and some SVG targets omit capture */
      }
    }
    pointer.lastX = event.clientX
    pointer.lastY = event.clientY
    if (dx === 0 && dy === 0) return
    event.preventDefault()
    host.setCamera(panSpatialRuntimeCamera(camera, clientDeltaToLogicalScreen(root, camera, dx, dy)))
  }

  const endPointer = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id) return
    if (pointer.panning) suppressClick = true
    if (root.hasPointerCapture?.(event.pointerId)) {
      try {
        root.releasePointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
    }
    pointer = null
  }

  const onClickCapture = (event: MouseEvent) => {
    if (!suppressClick) return
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || (host.observation && event.ctrlKey)) return
    if (!host.isActive() || spatialPlaybackGestureOccupied(event.target, root)) return
    const camera = host.getCamera()
    if (!camera) return
    event.preventDefault()
    const factor = event.deltaY > 0 ? ZOOM_OUT : ZOOM_IN
    host.setCamera(zoomSpatialRuntimeCameraAt(
      camera,
      camera.zoom * factor,
      screenPointInRoot(root, camera, event.clientX, event.clientY),
    ))
  }

  root.addEventListener('pointerdown', onPointerDown)
  root.addEventListener('pointermove', onPointerMove)
  root.addEventListener('pointerup', endPointer)
  root.addEventListener('pointercancel', endPointer)
  root.addEventListener('click', onClickCapture, true)
  root.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    root.removeEventListener('pointerdown', onPointerDown)
    root.removeEventListener('pointermove', onPointerMove)
    root.removeEventListener('pointerup', endPointer)
    root.removeEventListener('pointercancel', endPointer)
    root.removeEventListener('click', onClickCapture, true)
    root.removeEventListener('wheel', onWheel)
    pointer = null
  }
}
