import type { ComponentLayoutInput, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { frameCorners, composeMatrices, IDENTITY_MATRIX, type AffineMatrix } from './index'

/** Read-only local assembly extent; nested authored frames keep their actual matrices. */
export function flowObjectExtent(project: CourseProjectV10, instanceId: string, layout?: ComponentLayoutInput): { x: number; y: number; width: number; height: number } | null {
  if (layout?.mode === 'flow-content') return null
  const root = project.instances[instanceId], points: { x: number; y: number }[] = []
  if (root?.frame) points.push({ x: 0, y: 0 }, { x: root.frame.width, y: root.frame.height })
  const visit = (ids: readonly string[], parent: AffineMatrix) => {
    for (const id of ids) {
      const instance = project.instances[id]
      if (!instance) continue
      if (instance.frame) points.push(...frameCorners(instance.frame, parent))
      visit(instance.childIds ?? [], instance.frame ? composeMatrices(parent, instance.frame.transform) : parent)
    }
  }
  visit(root?.childIds ?? [], IDENTITY_MATRIX)
  if (!points.length) return null
  const x = Math.min(0, ...points.map(point => point.x)), y = Math.min(0, ...points.map(point => point.y))
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y }
}
