import { SlideMultiLayerLayoutIntent, planSlideMultiLayerFrames } from '../../core/tools/layerLayout'
import type { AuthoringToolTargetWireV1 } from '../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'

import { projectEffectiveLayers } from './effectiveLayerProjection'
import type { EffectiveLayerPropertiesPatchAtTarget } from './effectiveLayerCommands'

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
