import { useEffect, useState } from 'react'
import type { LayerItem } from '../../shared/courseProjectTypes'
import { isTeacherController } from '../../shared/teacherControllerRole'
import { rotatedRectangleAabb } from '../../shared/geometry'

/** Renderer measurement only: never write the collapsed footprint into the project. */
export function controllerDisplayFrame(item: LayerItem, frame: { x: number; y: number; width: number; height: number } = item.frame) {
  if (!isTeacherController(item) || typeof document === 'undefined') return frame
  const mount = [...document.querySelectorAll<HTMLElement>('[data-controller-authoring-id]')]
    .find(element => element.dataset.controllerAuthoringId === item.layerItemId && element.isConnected)
  if (!mount) return frame
  const values = mount.dataset.controllerAuthoringBounds?.split(',').map(Number)
  if (!values || values.length !== 4 || !values.every(Number.isFinite)) return frame
  return { x: frame.x + values[0]!, y: frame.y + values[1]!, width: values[2]!, height: values[3]! }
}

/** Constrain a teacher gesture by its visible component footprint. Ordinary
 * content may overflow; the component's authored dimensions remain unchanged. */
export function constrainControllerDisplayFrame<T extends { x: number; y: number; width: number; height: number; rotation?: number }>(
  item: LayerItem,
  frame: T,
  viewport: { width: number; height: number },
): T {
  if (!isTeacherController(item)) return frame
  const bounds = rotatedRectangleAabb({ ...controllerDisplayFrame(item, frame), rotation: frame.rotation ?? item.rotation })
  const x = Math.max(0, Math.min(bounds.left, viewport.width - bounds.width))
  const y = Math.max(0, Math.min(bounds.top, viewport.height - bounds.height))
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

