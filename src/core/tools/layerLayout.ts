import type { LayerFrame } from '../../shared/courseProjectTypes'
import { rotatedRectangleAabb } from '../../shared/geometry'
export type SlideMultiLayerLayoutIntent =
  | {
      readonly kind: 'align'
      readonly mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
    }
  | { readonly kind: 'distribute'; readonly axis: 'horizontal' | 'vertical' }

export interface SlideMultiLayerLayoutItem {
  readonly id: string
  readonly frame: LayerFrame
  readonly rotation: number
  readonly locked: boolean
}

export interface SlideMultiLayerFramePatch {
  readonly itemId: string
  readonly frame: { readonly x: number; readonly y: number }
}

export type SlideMultiLayerFramePlan =
  | { readonly ok: true; readonly patches: readonly SlideMultiLayerFramePatch[] }
  | { readonly ok: false; readonly reason: string }

export function planSlideMultiLayerFrames(
  items: readonly SlideMultiLayerLayoutItem[],
  intent: SlideMultiLayerLayoutIntent,
  primaryItemId?: string,
): SlideMultiLayerFramePlan {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    return { ok: false, reason: '成组布局目标不能包含重复元素' }
  }
  if (primaryItemId !== undefined && !items.some((item) => item.id === primaryItemId)) {
    return { ok: false, reason: '成组布局主目标必须包含在 targets 中' }
  }
  const unlocked = items.filter((item) => !item.locked)
  const minimum = intent.kind === 'distribute' ? 3 : 2
  if (unlocked.length < minimum) return { ok: true, patches: [] }

  const boundsById = new Map(items.map((item) => [
    item.id,
    rotatedRectangleAabb({
      x: item.frame.x,
      y: item.frame.y,
      width: item.frame.width,
      height: item.frame.height,
      rotation: item.rotation,
    }),
  ]))
  const nextFrames = new Map<string, { readonly x: number; readonly y: number }>()

  if (intent.kind === 'distribute') {
    const horizontal = intent.axis === 'horizontal'
    const sorted = [...unlocked].sort((left, right) => {
      const leftBounds = boundsById.get(left.id)!
      const rightBounds = boundsById.get(right.id)!
      return horizontal
        ? leftBounds.left - rightBounds.left
        : leftBounds.top - rightBounds.top
    })
    const first = boundsById.get(sorted[0]!.id)!
    const last = boundsById.get(sorted.at(-1)!.id)!
    const span = horizontal ? last.right - first.left : last.bottom - first.top
    const totalSize = sorted.reduce((sum, item) => {
      const bounds = boundsById.get(item.id)!
      return sum + (horizontal ? bounds.width : bounds.height)
    }, 0)
    const gap = (span - totalSize) / (sorted.length - 1)
    let cursor = horizontal ? first.left : first.top
    for (const item of sorted) {
      const bounds = boundsById.get(item.id)!
      const current = horizontal ? bounds.left : bounds.top
      const delta = cursor - current
      nextFrames.set(item.id, {
        x: item.frame.x + (horizontal ? delta : 0),
        y: item.frame.y + (horizontal ? 0 : delta),
      })
      cursor += (horizontal ? bounds.width : bounds.height) + gap
    }
  } else {
    const reference = primaryItemId === undefined
      ? (() => {
          const bounds = unlocked.map((item) => boundsById.get(item.id)!)
          return {
            left: Math.min(...bounds.map((item) => item.left)),
            right: Math.max(...bounds.map((item) => item.right)),
            top: Math.min(...bounds.map((item) => item.top)),
            bottom: Math.max(...bounds.map((item) => item.bottom)),
          }
        })()
      : boundsById.get(primaryItemId)!
    for (const item of unlocked) {
      const visual = boundsById.get(item.id)!
      let dx = 0
      let dy = 0
      if (intent.mode === 'left') dx = reference.left - visual.left
      else if (intent.mode === 'center') dx = (reference.left + reference.right) / 2 - visual.centerX
      else if (intent.mode === 'right') dx = reference.right - visual.right
      else if (intent.mode === 'top') dy = reference.top - visual.top
      else if (intent.mode === 'middle') dy = (reference.top + reference.bottom) / 2 - visual.centerY
      else dy = reference.bottom - visual.bottom
      nextFrames.set(item.id, { x: item.frame.x + dx, y: item.frame.y + dy })
    }
  }

  return {
    ok: true,
    patches: unlocked.flatMap((item) => {
      const frame = nextFrames.get(item.id)
      return frame && (frame.x !== item.frame.x || frame.y !== item.frame.y)
        ? [{ itemId: item.id, frame }]
        : []
    }),
  }
}

/** Resolve canonical wire targets against one frozen Slide projection. */
