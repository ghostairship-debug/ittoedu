import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentIsLocked, owningContainer, type ComponentContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { frameCorners, transformVector, invertMatrix, translateFrame } from '../components/geometry'
import { componentParentMatrix } from '../drivers/courseV10Operations'
import { selectedRoots, sameContainer } from './courseObjectEdits'

export type CourseGeometryIntent =
  | { kind: 'align'; alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' }
  | { kind: 'distribute'; axis: 'horizontal' | 'vertical' }

/** The active multi-selection algorithm in world coordinates; Session owns capture and undo. */
export function courseGeometryEdits(project: CourseProjectV10, instanceIds: readonly string[], intent: CourseGeometryIntent): ComponentEdit[] {
  const ids = selectedRoots(project, instanceIds).filter(id => !componentIsLocked(project, id) && project.instances[id].frame)
  const distribution = intent.kind === 'distribute', kind = distribution ? intent.axis : intent.alignment
  if (ids.length < (distribution ? 3 : 2)) throw new Error(distribution ? '至少需要 3 个未锁定对象' : '至少需要 2 个未锁定对象')
  const rootOwner = (id: string): ComponentContainer | null => {
    let owner = owningContainer(project, id)
    while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
    return owner
  }
  const firstOwner = rootOwner(ids[0])
  if (ids.some(id => !sameContainer(rootOwner(id), firstOwner))) throw new Error('不同归属的对象需要分别对齐')
  if (firstOwner?.kind === 'surface' && project.surfaces.find(surface => surface.id === firstOwner.surfaceId)?.kind === 'flow') {
    const carrier = (id: string): string => {
      let owner = owningContainer(project, id)
      while (owner?.kind === 'instance') { id = owner.instanceId; owner = owningContainer(project, id) }
      return id
    }
    const carriers = ids.map(carrier)
    // Children in one free container share its displayed origin, including
    // paragraph-anchored containers; that translation cancels in alignment.
    const commonFreeContainer = !!project.instances[carriers[0]].flowPlacement
      && carriers.every(id => id === carriers[0]) && ids.every(id => id !== carriers[0])
    if (!commonFreeContainer) {
      const placement = project.instances[carriers[0]].flowPlacement
      if (!placement || carriers.some(id => {
        const next = project.instances[id].flowPlacement
        return !next || next.space !== placement.space
      })) throw new Error('讲义浮层需要在同一定位空间内对齐；正文保持阅读布局')
      if (carriers.some(id => project.instances[id].flowPlacement?.paragraphAnchor))
        throw new Error('随段落浮层的对齐需要当前正文排版位置；当前入口未提供该计量，未修改对象')
    }
  }
  const boxes = ids.map(id => {
    const points = frameCorners(project.instances[id].frame!, componentParentMatrix(project, id))
    const xs = points.map(point => point.x), ys = points.map(point => point.y)
    return { id, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  })
  const left = Math.min(...boxes.map(box => box.left)), right = Math.max(...boxes.map(box => box.right))
  const top = Math.min(...boxes.map(box => box.top)), bottom = Math.max(...boxes.map(box => box.bottom))
  const deltas = new Map<string, { x: number; y: number }>()
  if (distribution) {
    const horizontal = kind === 'horizontal', ordered = boxes.slice().sort((a, b) => horizontal ? a.left - b.left : a.top - b.top)
    const start = horizontal ? ordered[0].left : ordered[0].top, end = horizontal ? ordered.at(-1)!.right : ordered.at(-1)!.bottom
    const sizes = ordered.map(box => horizontal ? box.right - box.left : box.bottom - box.top)
    const gap = (end - start - sizes.reduce((a, b) => a + b, 0)) / (ordered.length - 1)
    let cursor = start
    ordered.forEach((box, index) => { deltas.set(box.id, { x: horizontal ? cursor - box.left : 0, y: horizontal ? 0 : cursor - box.top }); cursor += sizes[index] + gap })
  } else boxes.forEach(box => deltas.set(box.id, {
    x: kind === 'left' ? left - box.left : kind === 'right' ? right - box.right : kind === 'center' ? (left + right - box.left - box.right) / 2 : 0,
    y: kind === 'top' ? top - box.top : kind === 'bottom' ? bottom - box.bottom : kind === 'middle' ? (top + bottom - box.top - box.bottom) / 2 : 0,
  }))
  return boxes.flatMap(box => {
    const delta = deltas.get(box.id)!
    return delta.x === 0 && delta.y === 0 ? [] : [{ type: 'frame.set' as const, instanceId: box.id,
      frame: translateFrame(project.instances[box.id].frame!, transformVector(invertMatrix(componentParentMatrix(project, box.id)), delta)) }]
  })
}
