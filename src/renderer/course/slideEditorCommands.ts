import { SlideCommandError } from '../../core/tools/slideInsertion'
export { SlideCommandError } from '../../core/tools/slideInsertion'
import { canEditLayerInScope } from '../../shared/teacherControllerRole'
import { RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT, commitResourceAwareAuthoringHistory, type ResourceAwareAuthoringHistory, type AuthoringHistoryResourceTransition } from '../authoring/resourceAwareAuthoringHistory'
import type {
  CourseProjectDocument,
  LayerItem,
  LayerItemOverride,
} from '../../shared/courseProjectTypes'
import type { EditorTransactionStep } from '../authoring/editorTransaction'
import {
  commitAuthoringDocumentTransaction,
} from '../authoring/resourceAwareAuthoringHistory'
import {
  type HistoryResourceChanges,
} from '../store/courseResourceState'
import { commitCourseProjectMutation as commitSlideProjectMutation } from '../../core/tools/courseProjectMutation'
import { buildSlideEditorView, type SlideEditorLayerScope } from '../../core/tools/slideLayerView'

export { commitSlideProjectMutation }

export const SLIDE_REJECT_LOCKED = 'locked'
export const SLIDE_REJECT_STALE_REVISION = 'stale-revision'
export const SLIDE_REJECT_WRONG_OWNER = 'wrong-owner'

/** Stable editor-only identities; they are never persisted in the project or history. */
export interface SlideAuthoringSelection {
  readonly locationId: string
  readonly stateId: string | null
  readonly selectionIds: readonly string[]
}

/** @deprecated Use SlideAuthoringSelection. Kept as the donor command-layer alias. */
export type SlideEditorSelection = SlideAuthoringSelection

/**
 * Stable authoring token. `authoringAddress` is always `makeAuthoringAddress`.
 * Temporary hit-test ids must not be stored here or written into the project.
 */
export interface SlideAuthoringTarget {
  readonly sessionId: string
  readonly revision: number
  readonly generation: number
  readonly authoringAddress: string
  readonly scope: SlideEditorLayerScope
  readonly layerItemId: string
}

export interface SlideCommandOptions {
  readonly now?: string
  readonly expectedRevision?: number
}

export interface SlideCommandResult {
  readonly ok: boolean
  readonly reason?: string
  readonly nextSession?: SlideAuthoringSessionRef
  readonly historyEntry?: boolean
  readonly selection?: SlideAuthoringSelection
  readonly resourceTransition?: AuthoringHistoryResourceTransition
}

/**
 * Session shape owned by the Slide domain slice. Commands accept this token
 * without importing App/store types.
 */
export interface SlideAuthoringSessionRef {
  readonly sessionId: string
  readonly history: ResourceAwareAuthoringHistory
  readonly selection: SlideAuthoringSelection
  readonly scope: SlideEditorLayerScope
  readonly generation: number
}


export interface SelectSlideEditorLayersInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
  /** `undefined` follows the location; `null` deliberately selects the base scene. */
  readonly stateId?: string | null
  readonly selectionIds: readonly string[]
}

export interface SlideEditorNodeTransform {
  readonly nodeId: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation: number
}

export interface SlideEditorTransformInput {
  readonly nodes: readonly SlideEditorNodeTransform[]
}

export function commitSlideEditorTransactionHistory(
  history: ResourceAwareAuthoringHistory,
  step: EditorTransactionStep,
  limit = RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT,
): ResourceAwareAuthoringHistory {
  if (
    history.present.id !== step.projectId ||
    history.present.revision !== step.baseRevision
  ) {
    throw new SlideCommandError(
      SLIDE_REJECT_STALE_REVISION,
      '编辑事务与当前 Slide 文档不一致',
    )
  }
  return commitResourceAwareAuthoringHistory(
    history,
    step.nextDocument,
    limit,
    step.resourceChanges,
  )
}

export function commitSlideActionTransaction(
  history: ResourceAwareAuthoringHistory,
  next: CourseProjectDocument,
  resourceChanges: HistoryResourceChanges = {},
  limit = RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT,
): {
  readonly history: ResourceAwareAuthoringHistory
  readonly resourceTransition: AuthoringHistoryResourceTransition
} | null {
  try {
    const committed = commitAuthoringDocumentTransaction(
      history,
      next,
      resourceChanges,
      limit,
    )
    if (!committed) return null
    return {
      history: committed.history,
      resourceTransition: committed.resourceTransition,
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('revision')) {
      throw new SlideCommandError(
        SLIDE_REJECT_STALE_REVISION,
        '编辑事务与当前 Slide 文档不一致',
      )
    }
    throw error
  }
}

export function selectSlideEditorLayers(
  input: SelectSlideEditorLayersInput,
): SlideAuthoringSelection {
  const view = buildSlideEditorView({
    project: input.project,
    locationId: input.locationId,
    stateId: input.stateId,
  })
  const selectionIds = [...input.selectionIds]
  if (new Set(selectionIds).size !== selectionIds.length) {
    throw new SlideCommandError('invalid-selection', '选择中不能包含重复元素')
  }
  const availableIds = new Set(view.layers.map((layer) => layer.selectionId))
  const missingId = selectionIds.find((selectionId) => !availableIds.has(selectionId))
  if (missingId !== undefined) {
    throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
  }

  return Object.freeze({
    locationId: view.locationId,
    stateId: view.presentation?.activeStateId ?? null,
    selectionIds: Object.freeze(selectionIds),
  })
}

function validateTransform(transform: SlideEditorNodeTransform): void {
  if (
    !Number.isFinite(transform.x) ||
    !Number.isFinite(transform.y) ||
    !Number.isFinite(transform.width) ||
    !Number.isFinite(transform.height) ||
    !Number.isFinite(transform.rotation)
  ) {
    throw new SlideCommandError('invalid-target', '元素位置和尺寸必须是有效数字')
  }
  if (transform.width <= 0 || transform.height <= 0) {
    throw new SlideCommandError('invalid-target', '元素宽高必须大于零')
  }
  if (transform.rotation < -36_000 || transform.rotation > 36_000) {
    throw new SlideCommandError('invalid-target', '元素旋转角度超出允许范围')
  }
}

function deleteEmptyFrameOverride(override: LayerItemOverride): void {
  if (override.frame && Object.keys(override.frame).length === 0) {
    delete override.frame
  }
}

function deleteEmptyLayerOverride(
  overrides: Record<string, LayerItemOverride>,
  layerItemId: string,
): void {
  const override = overrides[layerItemId]
  if (override && Object.keys(override).length === 0) {
    delete overrides[layerItemId]
  }
}

function isSceneFrameTransformableKind(kind: LayerItem['kind']): boolean {
  return kind === 'native' || kind === 'component' || kind === 'runtime'
}

/**
 * Applies one completed Workspace gesture to unlocked scene or global layers that own a
 * frame (native, component, runtime). Teacher-controller stays on the controller-specific
 * path. Preview frames never enter this command, so one invocation creates at
 * most one Project revision and one history entry regardless of selection size.
 */
export function transformSelectedSlideNativeLayers(
  history: ResourceAwareAuthoringHistory,
  selection: SlideAuthoringSelection,
  input: SlideEditorTransformInput,
  scope: SlideEditorLayerScope = 'scene',
  now?: string,
): ResourceAwareAuthoringHistory {
  if (input.nodes.length === 0) return history
  const nodeIds = input.nodes.map((node) => node.nodeId)
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new SlideCommandError('invalid-selection', '一次变换不能包含重复元素')
  }
  input.nodes.forEach(validateTransform)

  const selectedIds = new Set(selection.selectionIds)
  const unselectedId = nodeIds.find((nodeId) => !selectedIds.has(nodeId))
  if (unselectedId !== undefined) {
    throw new SlideCommandError('invalid-selection', '变换目标不在当前选择中')
  }

  const view = buildSlideEditorView({
    project: history.present,
    locationId: selection.locationId,
    stateId: selection.stateId,
  })
  const layerById = new Map(view.layers.map((layer) => [layer.selectionId, layer]))
  const plans = input.nodes.map((transform) => {
    const layer = layerById.get(transform.nodeId)
    if (!layer) throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
    if (!canEditLayerInScope(layer, scope)) {
      throw new SlideCommandError(
        SLIDE_REJECT_WRONG_OWNER,
        scope === 'global' ? '当前选择不属于全局层' : '当前选择不属于当前幻灯片场景',
      )
    }

    if (!isSceneFrameTransformableKind(layer.item.kind)) {
      throw new SlideCommandError('invalid-target', '当前选择包含暂不可变换的元素')
    }
    if (!layer.effectiveVisible) {
      throw new SlideCommandError('invalid-target', '当前元素不可见')
    }
    if (layer.item.locked) {
      throw new SlideCommandError(SLIDE_REJECT_LOCKED, '当前元素已锁定')
    }
    const changed =
      layer.item.frame.x !== transform.x ||
      layer.item.frame.y !== transform.y ||
      layer.item.frame.width !== transform.width ||
      layer.item.frame.height !== transform.height ||
      layer.item.rotation !== transform.rotation
    return { transform, changed, source: layer.source }
  })
  if (!plans.some((plan) => plan.changed)) return history

  const next = commitSlideProjectMutation(history.present, (draft) => {
    const globalPlans = plans.filter(plan => plan.source === 'global')
    if (globalPlans.length > 0) {
      const globalById = new Map(draft.globalLayerItems.map((entry) => [entry.item.layerItemId, entry.item]))
      for (const { transform, changed } of globalPlans) {
        if (!changed) continue
        const item = globalById.get(transform.nodeId)
        if (!item || !isSceneFrameTransformableKind(item.kind)) {
          throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
        }
        item.frame.x = transform.x
        item.frame.y = transform.y
        item.frame.width = transform.width
        item.frame.height = transform.height
        item.rotation = transform.rotation
      }
      if (globalPlans.length === plans.length) return
    }

    const location = draft.locations.find((candidate) => candidate.id === selection.locationId)
    if (!location || location.kind !== 'slide-scene') {
      throw new SlideCommandError('invalid-target', '当前幻灯片位置已失效')
    }
    const surface = draft.surfaces.find((candidate) => candidate.id === location.surfaceId)
    if (!surface || surface.type !== 'slide') {
      throw new SlideCommandError('invalid-target', '当前幻灯片已失效')
    }
    const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
    if (!scene) throw new SlideCommandError('invalid-target', '当前幻灯片已失效')
    const baseById = new Map(scene.layerItems.map((item) => [item.layerItemId, item]))
    const state = selection.stateId === null
      ? undefined
      : scene.presentation?.states.find((candidate) => candidate.id === selection.stateId)
    if (selection.stateId !== null && !state) {
      throw new SlideCommandError('invalid-target', '当前状态已失效')
    }

    for (const { transform, changed } of plans.filter(plan => plan.source !== 'global')) {
      if (!changed) continue
      const base = baseById.get(transform.nodeId)
      if (!base || !isSceneFrameTransformableKind(base.kind)) {
        throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
      }
      if (!state) {
        base.frame.x = transform.x
        base.frame.y = transform.y
        base.frame.width = transform.width
        base.frame.height = transform.height
        base.rotation = transform.rotation
        continue
      }

      const override = state.layerItemOverrides[base.layerItemId] ?? {}
      const frame = { ...override.frame }
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (transform[key] === base.frame[key]) delete frame[key]
        else frame[key] = transform[key]
      }
      override.frame = frame
      if (transform.rotation === base.rotation) delete override.rotation
      else override.rotation = transform.rotation
      deleteEmptyFrameOverride(override)
      state.layerItemOverrides[base.layerItemId] = override
      deleteEmptyLayerOverride(state.layerItemOverrides, base.layerItemId)
    }
  }, now)

  return commitResourceAwareAuthoringHistory(history, next)
}
