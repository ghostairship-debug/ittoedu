import type { AuthoringToolTargetWireV1 } from '../../shared/authoringToolContract'
import type { CourseProjectDocument, LayerFrame } from '../../shared/courseProjectTypes'
import { rotatedRectangleAabb } from '../../shared/geometry'
import { projectEffectiveLayers } from './effectiveLayerProjection'
import type { EffectiveLayerPropertiesPatchAtTarget } from './effectiveLayerCommands'

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

export interface SlideMultiLayerTargetPatch {
  readonly target: {
    readonly authoringAddress: string
    readonly locationId: string
    readonly stateId: string | null
  }
  readonly itemId: string
  readonly ownerKey: string
  readonly authoringAddress: string
  readonly frame: { readonly x: number; readonly y: number }
  readonly patch: EffectiveLayerPropertiesPatchAtTarget
}

export type SlideMultiLayerTargetPlan =
  | { readonly ok: true; readonly patches: readonly SlideMultiLayerTargetPatch[] }
  | { readonly ok: false; readonly reason: string }

function sameTarget(left: AuthoringToolTargetWireV1, right: AuthoringToolTargetWireV1): boolean {
  return left.projectId === right.projectId
    && left.documentRevision === right.documentRevision
    && left.revisionPolicy.kind === right.revisionPolicy.kind
    && left.sessionGeneration === right.sessionGeneration
    && left.surfaceType === right.surfaceType
    && left.surfaceId === right.surfaceId
    && left.locationId === right.locationId
    && left.stateId === right.stateId
    && left.owner === right.owner
    && left.ownerKey === right.ownerKey
    && left.itemId === right.itemId
    && left.authoringAddress === right.authoringAddress
}

function sameFrozenContext(left: AuthoringToolTargetWireV1, right: AuthoringToolTargetWireV1): boolean {
  return left.projectId === right.projectId
    && left.documentRevision === right.documentRevision
    && left.revisionPolicy.kind === right.revisionPolicy.kind
    && left.sessionGeneration === right.sessionGeneration
    && left.surfaceType === right.surfaceType
    && left.surfaceId === right.surfaceId
    && left.locationId === right.locationId
    && left.stateId === right.stateId
    && left.owner === right.owner
    && left.ownerKey === right.ownerKey
}

/**
 * Pure geometry shared by the live Slide Properties command and private AI
 * candidates. Locked items participate in the captured target set but are not
 * moved or counted toward the existing minimum movable-item rule.
 */
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
export function planSlideMultiLayerLayoutAtTargets(
  document: CourseProjectDocument,
  input: {
    readonly targets: readonly AuthoringToolTargetWireV1[]
    readonly intent: SlideMultiLayerLayoutIntent
    readonly primaryTarget?: AuthoringToolTargetWireV1
  },
): SlideMultiLayerTargetPlan {
  const first = input.targets[0]
  const minimum = input.intent.kind === 'distribute' ? 3 : 2
  if (!first || input.targets.length < minimum) {
    return { ok: false, reason: `成组布局至少需要 ${minimum} 个精确目标` }
  }
  if (new Set(input.targets.map((target) => target.itemId)).size !== input.targets.length) {
    return { ok: false, reason: '成组布局目标不能包含重复元素' }
  }
  if (first.projectId !== document.id || first.documentRevision !== document.revision) {
    return { ok: false, reason: '成组布局目标的工程版本已改变' }
  }
  if (first.surfaceType !== 'slide' || input.targets.some((target) => !sameFrozenContext(first, target))) {
    return { ok: false, reason: '成组布局目标必须来自同一冻结 Slide 上下文和 Owner' }
  }
  if (input.primaryTarget && !input.targets.some((target) => sameTarget(target, input.primaryTarget!))) {
    return { ok: false, reason: '成组布局主目标必须精确包含在 targets 中' }
  }

  try {
    const projection = projectEffectiveLayers({
      project: document,
      locationId: first.locationId,
      stateId: first.stateId,
      owner: first.owner,
    })
    if (projection.surfaceType !== 'slide' || projection.surfaceId !== first.surfaceId
      || projection.stateId !== first.stateId || projection.scope.ownerKey !== first.ownerKey) {
      return { ok: false, reason: '成组布局目标的 Surface、状态或 Owner 已失效' }
    }
    const rowsById = new Map(projection.unifiedRows.map((row) => [row.id, row]))
    const rows = input.targets.map((target) => rowsById.get(target.itemId))
    if (rows.some((row, index) => !row
      || row.owner !== input.targets[index]!.owner
      || row.ownerKey !== input.targets[index]!.ownerKey
      || row.authoringAddress !== input.targets[index]!.authoringAddress)) {
      return { ok: false, reason: '成组布局目标的身份或地址已失效' }
    }
    const resolvedRows = rows as NonNullable<(typeof rows)[number]>[]
    if (new Set(resolvedRows.map((row) => row.reorderGroupKey)).size !== 1) {
      return { ok: false, reason: '成组布局目标必须位于同一 Owner 和平面' }
    }
    const geometry = planSlideMultiLayerFrames(
      resolvedRows.map((row) => ({
        id: row.id,
        frame: row.frame,
        rotation: row.rotation,
        locked: row.locked,
      })),
      input.intent,
      input.primaryTarget?.itemId,
    )
    if (!geometry.ok) return geometry
    const targetsById = new Map(input.targets.map((target) => [target.itemId, target]))
    return {
      ok: true,
      patches: geometry.patches.map(({ itemId, frame }) => {
        const target = targetsById.get(itemId)!
        return {
          target: {
            authoringAddress: target.authoringAddress,
            locationId: target.locationId,
            stateId: target.stateId,
          },
          itemId,
          ownerKey: target.ownerKey,
          authoringAddress: target.authoringAddress,
          frame,
          patch: { frame },
        }
      }),
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '无法规划成组布局' }
  }
}
