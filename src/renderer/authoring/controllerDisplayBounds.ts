import { useEffect, useState } from 'react'
import type { LayerItem } from '../../shared/courseProjectTypes'
import { isTeacherController } from '../../shared/teacherControllerRole'

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

export function useControllerDisplayRevision() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    document.addEventListener('controller-authoring-bounds', refresh)
    return () => document.removeEventListener('controller-authoring-bounds', refresh)
  }, [])
  return revision
}

