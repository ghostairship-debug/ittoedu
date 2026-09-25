import { useEffect, useState } from 'react'
import type { LayerItem } from '../../shared/courseProjectTypes'
import { isTeacherController } from '../../shared/teacherControllerRole'
import { rotatedRectangleAabb } from '../../shared/geometry'

function controllerMount(item: LayerItem): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-controller-authoring-id]')]
    .find(element => element.dataset.controllerAuthoringId === item.layerItemId && element.isConnected)
}

/** The part of the page an edited controller is kept on, as its host reports it: the visible part of a scrolled or
 * zoomed page (M19). The whole page until the host has measured. */
export function controllerAuthoringArea(item: LayerItem, page: { width: number; height: number }) {
  const reported = typeof document === 'undefined' ? undefined : controllerMount(item)?.dataset.controllerAuthoringPage?.split(',').map(Number)
  return reported && reported.length === 4 && reported.every(Number.isFinite) && reported[2]! > 0 && reported[3]! > 0
    ? { x: reported[0]!, y: reported[1]!, width: reported[2]!, height: reported[3]! }
    : { x: 0, y: 0, ...page }
}

/** Renderer measurement only: never write the collapsed footprint into the project. */
export function controllerDisplayFrame(
  item: LayerItem,
  frame: { x: number; y: number; width: number; height: number } = item.frame,
  /** Slide page: an off-page controller is shown at its edge, as playback shows it (M19). */
  page?: { width: number; height: number },
) {
  if (!isTeacherController(item) || typeof document === 'undefined') return frame
  const values = controllerMount(item)?.dataset.controllerAuthoringBounds?.split(',').map(Number)
  const shown = values && values.length === 4 && values.every(Number.isFinite)
    ? { x: frame.x + values[0]!, y: frame.y + values[1]!, width: values[2]!, height: values[3]! }
    : frame
  if (!page) return shown
  const area = controllerAuthoringArea(item, page)
  return {
    ...shown,
    x: Math.max(area.x, Math.min(shown.x, area.x + area.width - shown.width)),
    y: Math.max(area.y, Math.min(shown.y, area.y + area.height - shown.height)),
  }
}

/** The frame whose footprint sits where the controller is shown, so a drag starts from what the teacher sees. */
export function shownControllerFrame<T extends { x: number; y: number; width: number; height: number }>(
  item: LayerItem,
  frame: T,
  page: { width: number; height: number },
): T {
  if (!isTeacherController(item)) return frame
  const shown = controllerDisplayFrame(item, frame, page), footprint = controllerDisplayFrame(item, frame)
  return { ...frame, x: frame.x + shown.x - footprint.x, y: frame.y + shown.y - footprint.y }
}

/** Constrain a teacher gesture by its visible component footprint. Ordinary
 * content may overflow; the component's authored dimensions remain unchanged. */
export function constrainControllerDisplayFrame<T extends { x: number; y: number; width: number; height: number; rotation?: number }>(
  item: LayerItem,
  frame: T,
  viewport: { x?: number; y?: number; width: number; height: number },
): T {
  if (!isTeacherController(item)) return frame
  const bounds = rotatedRectangleAabb({ ...controllerDisplayFrame(item, frame), rotation: frame.rotation ?? item.rotation })
  const left = viewport.x ?? 0, top = viewport.y ?? 0
  const x = Math.max(left, Math.min(bounds.left, left + viewport.width - bounds.width))
  const y = Math.max(top, Math.min(bounds.top, top + viewport.height - bounds.height))
  return { ...frame, x: frame.x + x - bounds.left, y: frame.y + y - bounds.top }
}

export function useControllerDisplayRevision() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    document.addEventListener('controller-authoring-bounds', refresh)
    return () => document.removeEventListener('controller-authoring-bounds', refresh)
  }, [])
  return revision
}

