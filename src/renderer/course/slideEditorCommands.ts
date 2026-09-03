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
  cloneHistoryResourceChanges,
  type HistoryResourceChanges,
  type HistoryResourceDirection,
} from '../store/courseResourceState'
import { commitCourseProjectMutation as commitSlideProjectMutation } from './courseProjectMutation'
import { buildSlideEditorView, type SlideEditorLayerScope } from './slideEditorView'

export { commitSlideProjectMutation }

export const SLIDE_REJECT_LOCKED = 'locked'
export const SLIDE_REJECT_STALE_REVISION = 'stale-revision'
export const SLIDE_REJECT_WRONG_OWNER = 'wrong-owner'
export const SLIDE_AUTHORING_HISTORY_LIMIT = 100

/** Stable editor-only identities; they are never persisted in the project or history. */
export interface SlideAuthoringSelection {
  readonly locationId: string
  readonly stateId: string | null
  readonly selectionIds: readonly string[]
}

/** @deprecated Use SlideAuthoringSelection. Kept as the donor command-layer alias. */
export type SlideEditorSelection = SlideAuthoringSelection

export interface SlideAuthoringHistory {
  readonly present: CourseProjectDocument
  readonly past: readonly SlideAuthoringHistoryEntry[]
  readonly future: readonly SlideAuthoringHistoryEntry[]
}

export interface SlideAuthoringTransactionFrame {
  readonly kind: 'editor-transaction'
  readonly document: CourseProjectDocument
  readonly resourceChanges: HistoryResourceChanges
}

export type SlideAuthoringHistoryEntry =
  | CourseProjectDocument
  | SlideAuthoringTransactionFrame

export interface SlideAuthoringResourceTransition {
  readonly resourceChanges: HistoryResourceChanges
  readonly resourceDirection: HistoryResourceDirection
}

export function isSlideAuthoringTransactionFrame(
  entry: SlideAuthoringHistoryEntry,
): entry is SlideAuthoringTransactionFrame {
  return 'kind' in entry && entry.kind === 'editor-transaction'
}

export function slideAuthoringLegacyHistoryEntryCount(
  entries: readonly SlideAuthoringHistoryEntry[],
): number {
  return entries.reduce(
    (count, entry) => count + (isSlideAuthoringTransactionFrame(entry) ? 0 : 1),
    0,
  )
}

function slideAuthoringHistoryDocument(
  entry: SlideAuthoringHistoryEntry,
): CourseProjectDocument {
  return isSlideAuthoringTransactionFrame(entry) ? entry.document : entry
}

function slideAuthoringTransactionFrame(
  document: CourseProjectDocument,
  resourceChanges: HistoryResourceChanges,
): SlideAuthoringTransactionFrame {
  return Object.freeze({
    kind: 'editor-transaction' as const,
    document,
    resourceChanges: cloneHistoryResourceChanges(resourceChanges),
  })
}

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
  readonly resourceTransition?: SlideAuthoringResourceTransition
}

/**
 * Session shape owned by the Slide domain slice. Commands accept this token
 * without importing App/store types.
 */
export interface SlideAuthoringSessionRef {
  readonly sessionId: string
  readonly history: SlideAuthoringHistory
  readonly selection: SlideAuthoringSelection
  readonly scope: SlideEditorLayerScope
  readonly generation: number
}

export class SlideCommandError extends Error {
  readonly reason: string

  constructor(reason: string, message?: string) {
    super(message ?? reason)
    this.name = 'SlideCommandError'
    this.reason = reason
  }
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

export function createSlideAuthoringHistory(
  project: CourseProjectDocument,
): SlideAuthoringHistory {
  return Object.freeze({
    present: project,
    past: Object.freeze([] as SlideAuthoringHistoryEntry[]),
    future: Object.freeze([] as SlideAuthoringHistoryEntry[]),
  })
}

export function commitSlideAuthoringHistory(
  history: SlideAuthoringHistory,
  next: CourseProjectDocument,
  limit = SLIDE_AUTHORING_HISTORY_LIMIT,
  resourceChanges?: HistoryResourceChanges,
): SlideAuthoringHistory {
  const previous = resourceChanges === undefined
    ? history.present
    : slideAuthoringTransactionFrame(history.present, resourceChanges)
  return Object.freeze({
    present: next,
    past: Object.freeze([...history.past, previous].slice(-limit)),
    future: Object.freeze([] as SlideAuthoringHistoryEntry[]),
  })
}

export function commitSlideEditorTransactionHistory(
  history: SlideAuthoringHistory,
  step: EditorTransactionStep,
  limit = SLIDE_AUTHORING_HISTORY_LIMIT,
): SlideAuthoringHistory {
  if (
    history.present.id !== step.projectId ||
    history.present.revision !== step.baseRevision
  ) {
    throw new SlideCommandError(
      SLIDE_REJECT_STALE_REVISION,
      '编辑事务与当前 Slide 文档不一致',
    )
  }
  return commitSlideAuthoringHistory(
    history,
    step.nextDocument,
    limit,
    step.resourceChanges,
  )
}

export function commitSlideActionTransaction(
  history: SlideAuthoringHistory,
  next: CourseProjectDocument,
  resourceChanges: HistoryResourceChanges = {},
  limit = SLIDE_AUTHORING_HISTORY_LIMIT,
): {
  readonly history: SlideAuthoringHistory
  readonly resourceTransition: SlideAuthoringResourceTransition
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

export function slideAuthoringUndoResourceTransition(
  history: SlideAuthoringHistory,
): SlideAuthoringResourceTransition | undefined {
  const previous = history.past.at(-1)
  if (!previous || !isSlideAuthoringTransactionFrame(previous)) return undefined
  return Object.freeze({
    resourceChanges: previous.resourceChanges,
    resourceDirection: 'inverse' as const,
  })
}

export function slideAuthoringRedoResourceTransition(
  history: SlideAuthoringHistory,
): SlideAuthoringResourceTransition | undefined {
  const next = history.future[0]
  if (!next || !isSlideAuthoringTransactionFrame(next)) return undefined
  return Object.freeze({
    resourceChanges: next.resourceChanges,
    resourceDirection: 'forward' as const,
  })
}

export function undoSlideAuthoringHistory(
  history: SlideAuthoringHistory,
): SlideAuthoringHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  const transaction = isSlideAuthoringTransactionFrame(previous)
  return Object.freeze({
    present: slideAuthoringHistoryDocument(previous),
    past: Object.freeze(history.past.slice(0, -1)),
    future: Object.freeze([
      transaction
        ? slideAuthoringTransactionFrame(history.present, previous.resourceChanges)
        : history.present,
      ...history.future,
    ]),
  })
}

export function redoSlideAuthoringHistory(
  history: SlideAuthoringHistory,
): SlideAuthoringHistory {
  const next = history.future[0]
  if (!next) return history
  const transaction = isSlideAuthoringTransactionFrame(next)
  return Object.freeze({
    present: slideAuthoringHistoryDocument(next),
    past: Object.freeze([
      ...history.past,
      transaction
        ? slideAuthoringTransactionFrame(history.present, next.resourceChanges)
        : history.present,
    ]),
    future: Object.freeze(history.future.slice(1)),
  })
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
  history: SlideAuthoringHistory,
  selection: SlideAuthoringSelection,
  input: SlideEditorTransformInput,
  scope: SlideEditorLayerScope = 'scene',
  now?: string,
): SlideAuthoringHistory {
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
    if (layer.source !== scope) {
      throw new SlideCommandError(
        SLIDE_REJECT_WRONG_OWNER,
        scope === 'global' ? '当前选择不属于全局层' : '当前选择不属于当前幻灯片场景',
      )
    }
    if (layer.item.kind === 'native' && layer.item.content.nativeType === 'teacher-controller') {
      throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '教师控制器不由本命令编辑')
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
    return { transform, changed }
  })
  if (!plans.some((plan) => plan.changed)) return history

  const next = commitSlideProjectMutation(history.present, (draft) => {
    if (scope === 'global') {
      const globalById = new Map(draft.globalLayerItems.map((entry) => [entry.item.layerItemId, entry.item]))
      for (const { transform, changed } of plans) {
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
      return
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

    for (const { transform, changed } of plans) {
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

  return commitSlideAuthoringHistory(history, next)
}
