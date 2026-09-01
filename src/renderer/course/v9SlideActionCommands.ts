import { MAX_SCENE_NODES } from '../../shared/constants'
import type { InteractionRule } from '../../shared/interactionTypes'
import type {
  CourseProjectDocument,
  LayerItem,
  LayerItemOverride,
  SlidePresentationState,
  SlideSceneDocument,
} from '../../shared/courseProjectTypes'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  SlideCommandError,
  commitSlideAuthoringHistory,
  commitSlideProjectMutation,
  selectSlideEditorLayers,
  type SlideAuthoringHistory,
  type SlideAuthoringSelection,
  type SlideAuthoringSessionRef,
  type SlideCommandOptions,
  type SlideCommandResult,
} from './slideEditorCommands'
import {
  buildSlideEditorView,
  type SlideEditorLayerView,
} from './slideEditorView'
import {
  addSlideInteractionRule,
  deleteSlideInteractionRule,
  duplicateSlideInteractionRule,
  moveSlideInteractionRule,
  updateSlideInteractionRule,
  type SlideInteractionTarget,
} from './slideInteractionCommands'
import {
  copySlideGlobalClipboard,
  copySlideSceneClipboard,
  mutatePasteSlideGlobalClipboard,
  mutatePasteSlideSceneClipboard,
  sortSlideSceneLayerItems,
  type V9SlideClipboardPayload,
} from './v9SlideClipboard'
import { selectSlideLayers, type SlideAuthoringSession } from './slideAuthoringBackend'
import { repairRemovedCourseReferences } from './courseReferenceCleanup'

export type {
  V9SlideClipboardItem,
  V9SlideClipboardPayload,
  V9SlideClipboardScope,
  V9SlideGlobalClipboardItem,
  V9SlideGlobalClipboardPayload,
} from './v9SlideClipboard'
export {
  SLIDE_CLIPBOARD_EMPTY_REASON,
  SLIDE_CLIPBOARD_WRONG_OWNER_REASON,
  SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON,
  SLIDE_SCENE_CLIPBOARD_OFFSET,
  copySlideGlobalClipboard,
  copySlideSceneClipboard,
} from './v9SlideClipboard'

/**
 * Shared action IDs for keyboard, context menu and toolbar.
 * R2-Z must call these IDs; this lane does not change NodesTab / App.
 */
export const SLIDE_SCENE_ACTION_IDS = [
  'select-all',
  'copy',
  'cut',
  'paste',
  'duplicate',
  'delete',
  'rename',
  'reorder',
  'move-forward',
  'move-backward',
  'bring-front',
  'send-back',
  'show',
  'hide',
  'lock',
  'unlock',
  'edit-text',
  'edit-formula',
  'replace-media',
  'insert-before',
  'insert-after',
  'indent',
  'outdent',
  'focus',
  'fit',
  'reset-view',
] as const

export type SlideSceneActionId = (typeof SLIDE_SCENE_ACTION_IDS)[number]

export type SlideSceneActionKind =
  | 'scene-command'
  | 'clipboard-read'
  | 'ui-elsewhere'
  | 'not-slide-scene'

export interface SlideSceneActionMapping {
  readonly actionId: SlideSceneActionId
  readonly kind: SlideSceneActionKind
  readonly command: string
  readonly notes: string
}

/** Right-click / keyboard / toolbar share this table. Do not invent a second ID set. */
export const SLIDE_SCENE_ACTION_COMMAND_MAP: readonly SlideSceneActionMapping[] = Object.freeze([
  { actionId: 'select-all', kind: 'scene-command', command: 'selectAllSlideSceneLayers', notes: '全选当前 scene 可选图层，不含 history' },
  { actionId: 'copy', kind: 'clipboard-read', command: 'copySlideSceneClipboard', notes: '新 payload，不写 history' },
  { actionId: 'cut', kind: 'scene-command', command: 'cutSlideSceneLayers', notes: 'copy + delete，一次 history' },
  { actionId: 'paste', kind: 'scene-command', command: 'pasteSlideSceneLayers', notes: '新稳定 ID，重写内部引用，一次 history' },
  { actionId: 'duplicate', kind: 'scene-command', command: 'duplicateSlideSceneLayers', notes: '新稳定 ID，一次 history' },
  { actionId: 'delete', kind: 'scene-command', command: 'deleteSlideSceneLayers', notes: '多选一次 history；焦点 guard 先拦截' },
  { actionId: 'reorder', kind: 'scene-command', command: 'reorderSlideSceneLayers', notes: 'NodesTab 拖排传入 back-to-front id 列表' },
  { actionId: 'move-forward', kind: 'scene-command', command: 'nudgeSlideSceneLayers', notes: 'domain 上移一层；f272756 UI 无独立按钮' },
  { actionId: 'move-backward', kind: 'scene-command', command: 'nudgeSlideSceneLayers', notes: 'domain 下移一层；f272756 UI 无独立按钮' },
  { actionId: 'bring-front', kind: 'scene-command', command: 'nudgeSlideSceneLayers', notes: 'domain 置顶；f272756 UI 无独立按钮，不要改 NodesTab' },
  { actionId: 'send-back', kind: 'scene-command', command: 'nudgeSlideSceneLayers', notes: 'domain 置底；f272756 UI 无独立按钮，不要改 NodesTab' },
  { actionId: 'show', kind: 'scene-command', command: 'patchSlideSceneLayers', notes: '多选一次 history' },
  { actionId: 'hide', kind: 'scene-command', command: 'patchSlideSceneLayers', notes: '多选一次 history' },
  { actionId: 'lock', kind: 'scene-command', command: 'patchSlideSceneLayers', notes: '多选一次 history' },
  { actionId: 'unlock', kind: 'scene-command', command: 'patchSlideSceneLayers', notes: '锁定项可解锁' },
  { actionId: 'rename', kind: 'ui-elsewhere', command: 'none', notes: '属性栏重命名，本 lane 拒绝以免假成功' },
  { actionId: 'edit-text', kind: 'ui-elsewhere', command: 'none', notes: 'R2-C 文字会话' },
  { actionId: 'edit-formula', kind: 'ui-elsewhere', command: 'none', notes: 'R2-C 公式会话' },
  { actionId: 'replace-media', kind: 'ui-elsewhere', command: 'none', notes: 'R2-D 媒体替换' },
  { actionId: 'fit', kind: 'ui-elsewhere', command: 'none', notes: 'R2-B viewport' },
  { actionId: 'reset-view', kind: 'ui-elsewhere', command: 'none', notes: 'R2-B viewport' },
  { actionId: 'insert-before', kind: 'not-slide-scene', command: 'none', notes: 'Flow/location' },
  { actionId: 'insert-after', kind: 'not-slide-scene', command: 'none', notes: 'Flow/location' },
  { actionId: 'indent', kind: 'not-slide-scene', command: 'none', notes: 'Flow' },
  { actionId: 'outdent', kind: 'not-slide-scene', command: 'none', notes: 'Flow' },
  { actionId: 'focus', kind: 'not-slide-scene', command: 'none', notes: 'Spatial' },
])

export const SLIDE_SCENE_ACTION_REASON: Record<SlideSceneActionId, string> = {
  'select-all': '全选当前可见元素',
  copy: '复制当前选择',
  cut: '剪切当前选择',
  paste: '粘贴到当前幻灯片',
  duplicate: '重复当前选择',
  delete: '删除当前选择',
  rename: '重命名请在属性栏完成',
  reorder: '拖排当前图层',
  'move-forward': '上移一层',
  'move-backward': '下移一层',
  'bring-front': '置顶',
  'send-back': '置底',
  show: '显示所选元素',
  hide: '隐藏所选元素',
  lock: '锁定所选元素',
  unlock: '解锁所选元素',
  'edit-text': '打开文字编辑属于 R2-C',
  'edit-formula': '打开公式编辑属于 R2-C',
  'replace-media': '替换媒体属于 R2-D',
  'insert-before': '幻灯片元素不支持该动作',
  'insert-after': '幻灯片元素不支持该动作',
  indent: '幻灯片元素不支持该动作',
  outdent: '幻灯片元素不支持该动作',
  focus: '幻灯片元素不支持该动作',
  fit: '适配视图属于 R2-B',
  'reset-view': '重置视图属于 R2-B',
}

export type SlideAuthoringFocusKind =
  | 'none'
  | 'input'
  | 'textarea'
  | 'select'
  | 'contenteditable'
  | 'text-edit-session'
  | 'formula-edit-session'
  | 'runtime-author-session'
  | 'component-author-session'

export interface SlideAuthoringFocusDescriptor {
  readonly tagName?: string
  readonly isContentEditable?: boolean
  readonly textEditSession?: boolean
  readonly formulaEditSession?: boolean
  readonly runtimeAuthorSession?: boolean
  readonly componentAuthorSession?: boolean
}

export const SLIDE_DELETE_FOCUS_GUARD_REASON =
  '文字或作者编辑中，Delete/Backspace 只编辑文本，不删除元素'

export function classifySlideAuthoringFocus(
  input?: SlideAuthoringFocusKind | SlideAuthoringFocusDescriptor | EventTarget | null,
): SlideAuthoringFocusKind {
  if (input == null) return 'none'
  if (typeof input === 'string') return input
  const descriptor = readFocusDescriptor(input)
  if (descriptor.formulaEditSession) return 'formula-edit-session'
  if (descriptor.textEditSession) return 'text-edit-session'
  if (descriptor.runtimeAuthorSession) return 'runtime-author-session'
  if (descriptor.componentAuthorSession) return 'component-author-session'
  const tag = descriptor.tagName?.toLowerCase()
  if (tag === 'input') return 'input'
  if (tag === 'textarea') return 'textarea'
  if (tag === 'select') return 'select'
  if (isContentEditableDescriptor(descriptor, input)) return 'contenteditable'
  return 'none'
}

export function isSlideTextLikeAuthoringFocus(focus: SlideAuthoringFocusKind): boolean {
  return focus !== 'none'
}

/**
 * R2-Z: if this returns true, do not route Delete/Backspace to layer delete.
 * Also refuse inside executeSlideSceneAction so a missed UI wire cannot drop layers.
 */
export function shouldIgnoreSlideLayerDeleteForFocus(
  input?: SlideAuthoringFocusKind | SlideAuthoringFocusDescriptor | EventTarget | null,
): boolean {
  return isSlideTextLikeAuthoringFocus(classifySlideAuthoringFocus(input))
}

function readFocusDescriptor(
  input: SlideAuthoringFocusDescriptor | EventTarget,
): SlideAuthoringFocusDescriptor {
  if (typeof HTMLElement !== 'undefined' && input instanceof HTMLElement) {
    return {
      tagName: input.tagName,
      isContentEditable: isHtmlContentEditable(input),
    }
  }
  return input as SlideAuthoringFocusDescriptor
}

function isHtmlContentEditable(element: HTMLElement): boolean {
  if (element.isContentEditable) return true
  const value = element.contentEditable
  if (value === 'true' || value === 'plaintext-only') return true
  const attr = element.getAttribute('contenteditable')
  return attr === '' || attr === 'true' || attr === 'plaintext-only'
}

function isContentEditableDescriptor(
  descriptor: SlideAuthoringFocusDescriptor,
  input: SlideAuthoringFocusKind | SlideAuthoringFocusDescriptor | EventTarget,
): boolean {
  if (descriptor.isContentEditable) return true
  if (typeof HTMLElement !== 'undefined' && input instanceof HTMLElement) {
    return isHtmlContentEditable(input)
  }
  return false
}

export interface SlideActionContext extends SlideCommandOptions {
  readonly clipboard?: V9SlideClipboardPayload | null
  readonly focus?: SlideAuthoringFocusKind | SlideAuthoringFocusDescriptor | EventTarget | null
  readonly orderedLayerItemIds?: readonly string[]
}

export interface SlideActionExecution extends SlideCommandResult {
  readonly actionId: SlideSceneActionId
  readonly clipboard: V9SlideClipboardPayload | null
}

function freezeSelection(selection: SlideAuthoringSelection): SlideAuthoringSelection {
  return Object.freeze({
    locationId: selection.locationId,
    stateId: selection.stateId,
    selectionIds: Object.freeze([...selection.selectionIds]),
  })
}

function freezeHistory(history: SlideAuthoringHistory): SlideAuthoringHistory {
  if (Object.isFrozen(history) && Object.isFrozen(history.past) && Object.isFrozen(history.future)) {
    return history
  }
  return Object.freeze({
    present: history.present,
    past: Object.freeze([...history.past]),
    future: Object.freeze([...history.future]),
  })
}

function freezeSession(session: SlideAuthoringSessionRef): SlideAuthoringSession {
  return Object.freeze({
    sessionId: session.sessionId,
    history: freezeHistory(session.history),
    selection: freezeSelection(session.selection),
    scope: session.scope,
    generation: session.generation,
  }) as SlideAuthoringSession
}

function succeed(
  next: SlideAuthoringSessionRef,
  historyEntry: boolean,
): SlideCommandResult {
  const session = freezeSession(next)
  return {
    ok: true,
    nextSession: session,
    historyEntry,
    selection: session.selection,
  }
}

function reject(session: SlideAuthoringSessionRef, reason: string): SlideCommandResult {
  const current = freezeSession(session)
  return {
    ok: false,
    reason,
    nextSession: current,
    historyEntry: false,
    selection: current.selection,
  }
}

function rejectIfStale(
  session: SlideAuthoringSessionRef,
  expectedRevision?: number,
): SlideCommandResult | null {
  if (
    expectedRevision !== undefined &&
    expectedRevision !== session.history.present.revision
  ) {
    return reject(session, SLIDE_REJECT_STALE_REVISION)
  }
  return null
}

function catchCommand(session: SlideAuthoringSessionRef, error: unknown): SlideCommandResult {
  if (error instanceof SlideCommandError) return reject(session, error.reason)
  if (error instanceof Error) return reject(session, error.message)
  return reject(session, '命令失败')
}

function requireSceneScope(session: SlideAuthoringSessionRef): SlideCommandResult | null {
  if (session.scope !== 'scene') {
    return reject(session, SLIDE_REJECT_WRONG_OWNER)
  }
  return null
}

function requireGlobalScope(session: SlideAuthoringSessionRef): SlideCommandResult | null {
  if (session.scope !== 'global') {
    return reject(session, SLIDE_REJECT_WRONG_OWNER)
  }
  return null
}

function commitDocument(
  session: SlideAuthoringSessionRef,
  project: CourseProjectDocument,
  selection: SlideAuthoringSelection = session.selection,
): SlideAuthoringSessionRef {
  return {
    sessionId: session.sessionId,
    history: commitSlideAuthoringHistory(session.history, project),
    selection,
    scope: session.scope,
    generation: session.generation,
  }
}

function selectionAfter(
  session: SlideAuthoringSessionRef,
  project: CourseProjectDocument,
  selectionIds: readonly string[],
): SlideAuthoringSelection {
  try {
    return selectSlideEditorLayers({
      project,
      locationId: session.selection.locationId,
      stateId: session.selection.stateId,
      selectionIds,
    })
  } catch {
    return selectSlideEditorLayers({
      project,
      locationId: session.selection.locationId,
      stateId: session.selection.stateId,
      selectionIds: [],
    })
  }
}

function sceneLayerViews(session: SlideAuthoringSessionRef): SlideEditorLayerView[] {
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  return view.layers.filter((layer) => layer.source === 'scene')
}

function resolveSceneLayers(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
): SlideEditorLayerView[] {
  const unique = [...new Set(layerItemIds)]
  if (unique.length !== layerItemIds.length) {
    throw new SlideCommandError('invalid-selection', '选择中不能包含重复元素')
  }
  const byId = new Map(sceneLayerViews(session).map((layer) => [layer.selectionId, layer]))
  return unique.map((id) => {
    const layer = byId.get(id)
    if (!layer) {
      throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
    }
    if (layer.source !== 'scene') {
      throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前选择不属于当前幻灯片场景')
    }
    return layer
  })
}

function assertWritableLayers(
  layers: readonly SlideEditorLayerView[],
  allowLocked: boolean,
): void {
  if (allowLocked) return
  if (layers.some((layer) => layer.item.locked)) {
    throw new SlideCommandError(SLIDE_REJECT_LOCKED, '当前元素已锁定')
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function deleteEmptyOverride(
  overrides: Record<string, LayerItemOverride>,
  layerItemId: string,
): void {
  if (Object.keys(overrides[layerItemId] ?? {}).length === 0) {
    delete overrides[layerItemId]
  }
}

function isNamedStateOwnedLayer(
  base: LayerItem,
  presentationState: SlidePresentationState,
): boolean {
  return base.visible === false &&
    presentationState.layerItemOverrides[base.layerItemId]?.visible === true
}

function structurallyDeleteSceneLayers(
  draft: CourseProjectDocument,
  draftScene: SlideSceneDocument,
  layerItemIds: ReadonlySet<string>,
): void {
  draftScene.layerItems = draftScene.layerItems.filter(
    (item) => !layerItemIds.has(item.layerItemId),
  )
  draftScene.presentation?.states.forEach((presentationState) => {
    for (const layerItemId of layerItemIds) {
      delete presentationState.layerItemOverrides[layerItemId]
    }
    if (presentationState.layerItemOrder) {
      presentationState.layerItemOrder = presentationState.layerItemOrder.filter(
        (id) => !layerItemIds.has(id),
      )
      if (presentationState.layerItemOrder.length === 0) {
        delete presentationState.layerItemOrder
      }
    }
  })
  repairRemovedCourseReferences(draft, {
    removedLocationIds: new Set(),
    removedLayerItemIds: layerItemIds,
  })
}

function activeDraftScene(
  draft: CourseProjectDocument,
  session: SlideAuthoringSessionRef,
): { surfaceId: string; scene: SlideSceneDocument } {
  const location = draft.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前位置不是幻灯片')
  }
  const surface = draft.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('当前幻灯片已失效')
  return { surfaceId: surface.id, scene }
}

export function selectAllSlideSceneLayers(
  session: SlideAuthoringSessionRef,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  const ids = sceneLayerViews(session).map((layer) => layer.selectionId)
  return selectSlideLayers(session as SlideAuthoringSession, { nodeIds: ids }, options)
}

export function reorderSlideSceneLayers(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    const currentIds = sceneLayerViews(session).map((layer) => layer.selectionId)
    if (
      layerItemIds.length !== currentIds.length ||
      new Set(layerItemIds).size !== layerItemIds.length ||
      layerItemIds.some((id) => !currentIds.includes(id))
    ) {
      throw new SlideCommandError('invalid-selection', '图层顺序必须包含当前场景的全部元素')
    }
    if (sameIds(layerItemIds, currentIds)) return succeed(session, false)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = activeDraftScene(draft, session)
      if (session.selection.stateId !== null) {
        const presentationState = scene.presentation?.states.find(
          (candidate) => candidate.id === session.selection.stateId,
        )
        if (!presentationState) throw new Error('当前命名状态已失效')
        for (const [id, override] of Object.entries(presentationState.layerItemOverrides)) {
          delete override.order
          deleteEmptyOverride(presentationState.layerItemOverrides, id)
        }
        const baseIds = [...scene.layerItems]
          .sort((left, right) => left.order - right.order ||
            left.layerItemId.localeCompare(right.layerItemId))
          .map((item) => item.layerItemId)
        if (sameIds(layerItemIds, baseIds)) delete presentationState.layerItemOrder
        else presentationState.layerItemOrder = [...layerItemIds]
        return
      }
      const orderSlots = scene.layerItems.map((item) => item.order).sort((left, right) => left - right)
      const byId = new Map(scene.layerItems.map((item) => [item.layerItemId, item]))
      layerItemIds.forEach((id, index) => {
        const item = byId.get(id)
        if (!item) throw new Error('当前元素已失效')
        item.order = orderSlots[index]!
      })
      sortSlideSceneLayerItems(scene)
    }, options.now)
    return succeed(commitDocument(session, project), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

function relativeReorder(
  viewIds: readonly string[],
  selectedIds: readonly string[],
  mode: 'forward' | 'backward' | 'front' | 'back',
): string[] {
  const selected = new Set(selectedIds)
  const selectedInOrder = viewIds.filter((id) => selected.has(id))
  if (selectedInOrder.length === 0) return [...viewIds]
  if (mode === 'front') return [...viewIds.filter((id) => !selected.has(id)), ...selectedInOrder]
  if (mode === 'back') return [...selectedInOrder, ...viewIds.filter((id) => !selected.has(id))]
  const next = [...viewIds]
  if (mode === 'forward') {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const id = next[index]!
      if (!selected.has(id) || index === next.length - 1) continue
      if (selected.has(next[index + 1]!)) continue
      ;[next[index], next[index + 1]] = [next[index + 1]!, next[index]!]
    }
  } else {
    for (let index = 0; index < next.length; index += 1) {
      const id = next[index]!
      if (!selected.has(id) || index === 0) continue
      if (selected.has(next[index - 1]!)) continue
      ;[next[index], next[index - 1]] = [next[index - 1]!, next[index]!]
    }
  }
  return next
}

export function nudgeSlideSceneLayers(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
  mode: 'forward' | 'backward' | 'front' | 'back',
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    if (layerItemIds.length === 0) throw new Error('没有可调整层级的选择')
    assertWritableLayers(resolveSceneLayers(session, layerItemIds), false)
    const viewIds = sceneLayerViews(session).map((layer) => layer.selectionId)
    const next = relativeReorder(viewIds, layerItemIds, mode)
    return reorderSlideSceneLayers(session, next, options)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideSceneLayers(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
  patch: { readonly visible?: boolean; readonly locked?: boolean },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    if (layerItemIds.length === 0) {
      throw new Error(patch.locked === false ? '没有可解锁的选择' : '没有可修改的选择')
    }
    const layers = resolveSceneLayers(session, layerItemIds)
    const unlocking = patch.locked === false
    assertWritableLayers(layers, unlocking)
    const unchanged = layers.every((layer) => {
      if (patch.visible !== undefined && layer.item.visible !== patch.visible) return false
      if (patch.locked !== undefined && layer.item.locked !== patch.locked) return false
      return true
    })
    if (unchanged) return succeed(session, false)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = activeDraftScene(draft, session)
      for (const layerItemId of layerItemIds) {
        if (session.selection.stateId !== null) {
          const presentationState = scene.presentation?.states.find(
            (candidate) => candidate.id === session.selection.stateId,
          )
          const base = scene.layerItems.find((item) => item.layerItemId === layerItemId)
          if (!presentationState || !base) throw new Error('当前元素已失效')
          const override = presentationState.layerItemOverrides[layerItemId] ?? {}
          if (patch.visible !== undefined) {
            if (patch.visible === base.visible) delete override.visible
            else override.visible = patch.visible
          }
          if (patch.locked !== undefined) {
            if (patch.locked === base.locked) delete override.locked
            else override.locked = patch.locked
          }
          presentationState.layerItemOverrides[layerItemId] = override
          deleteEmptyOverride(presentationState.layerItemOverrides, layerItemId)
          continue
        }
        const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
        if (!item) throw new Error('当前元素已失效')
        if (patch.visible !== undefined) item.visible = patch.visible
        if (patch.locked !== undefined) item.locked = patch.locked
      }
    }, options.now)
    return succeed(commitDocument(session, project), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function deleteSlideSceneLayers(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    const uniqueIds = [...new Set(layerItemIds)]
    if (uniqueIds.length === 0) throw new Error('没有可删除的选择')
    const layers = resolveSceneLayers(session, uniqueIds)
    assertWritableLayers(layers, false)
    const remainingSelection = session.selection.selectionIds.filter(
      (id) => !uniqueIds.includes(id),
    )
    const mutatingIds = uniqueIds.filter((layerItemId, index) => {
      const layer = layers[index]!
      return !(session.selection.stateId !== null && !layer.item.visible)
    })
    if (mutatingIds.length === 0) {
      if (remainingSelection.length === session.selection.selectionIds.length) {
        return succeed(session, false)
      }
      return succeed({
        ...session,
        selection: selectionAfter(session, session.history.present, remainingSelection),
      }, false)
    }
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = activeDraftScene(draft, session)
      const structural = new Set<string>()
      for (const layerItemId of mutatingIds) {
        if (session.selection.stateId !== null) {
          const presentationState = scene.presentation?.states.find(
            (candidate) => candidate.id === session.selection.stateId,
          )
          const base = scene.layerItems.find((item) => item.layerItemId === layerItemId)
          if (!presentationState || !base) throw new Error('当前元素已失效')
          if (isNamedStateOwnedLayer(base, presentationState)) {
            structural.add(layerItemId)
          } else {
            const override = { ...presentationState.layerItemOverrides[layerItemId] }
            if (base.visible) override.visible = false
            else delete override.visible
            presentationState.layerItemOverrides[layerItemId] = override
            deleteEmptyOverride(presentationState.layerItemOverrides, layerItemId)
          }
          continue
        }
        structural.add(layerItemId)
      }
      if (structural.size > 0) structurallyDeleteSceneLayers(draft, scene, structural)
    }, options.now)
    return succeed(
      commitDocument(session, project, selectionAfter(session, project, remainingSelection)),
      true,
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function pasteSlideSceneLayers(
  session: SlideAuthoringSessionRef,
  clipboard: V9SlideClipboardPayload | null | undefined,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    if (!clipboard || clipboard.items.length === 0) {
      throw new Error('剪贴板为空，无法粘贴')
    }
    if (clipboard.sourceScope !== 'scene') {
      throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前 Slide scene 命令不能粘贴 global/surface 图层；请交给 R3')
    }
    let pastedIds: string[] = []
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      pastedIds = mutatePasteSlideSceneClipboard(draft, {
        locationId: session.selection.locationId,
        stateId: session.selection.stateId,
        clipboard,
      })
    }, options.now)
    return succeed(
      commitDocument(session, project, selectionAfter(session, project, pastedIds)),
      true,
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function pasteSlideGlobalLayers(
  session: SlideAuthoringSessionRef,
  clipboard: V9SlideClipboardPayload | null | undefined,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireGlobalScope(session)
  if (wrong) return wrong
  try {
    if (!clipboard || clipboard.items.length === 0) {
      throw new Error('剪贴板为空，无法粘贴')
    }
    if (clipboard.sourceScope !== 'global') {
      throw new SlideCommandError(
        SLIDE_REJECT_WRONG_OWNER,
        '当前全局层不能粘贴 scene/surface 图层',
      )
    }
    let pastedIds: string[] = []
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      pastedIds = mutatePasteSlideGlobalClipboard(draft, clipboard)
    }, options.now)
    return succeed(
      commitDocument(session, project, selectionAfter(session, project, pastedIds)),
      true,
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function duplicateSlideSceneLayers(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    if (layerItemIds.length === 0) throw new Error('没有可重复的选择')
    const layers = resolveSceneLayers(session, layerItemIds)
    assertWritableLayers(layers, false)
    if (sceneLayerViews(session).length + layers.length > MAX_SCENE_NODES) {
      throw new Error(`复制后将超过每场景 ${MAX_SCENE_NODES} 个图层的上限。`)
    }
    const clipboard = copySlideSceneClipboard(session, layerItemIds)
    return pasteSlideSceneLayers(session, clipboard, options)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function copySlideSceneLayers(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
  options: SlideCommandOptions = {},
): SlideActionExecution {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return actionExecution('copy', stale, null)
  const wrong = requireSceneScope(session)
  if (wrong) return actionExecution('copy', wrong, null)
  try {
    const payload = copySlideSceneClipboard(session, layerItemIds)
    return actionExecution('copy', succeed(session, false), payload, `已复制 ${payload.items.length} 项`)
  } catch (error) {
    return actionExecution('copy', catchCommand(session, error), null)
  }
}

function actionExecution(
  actionId: SlideSceneActionId,
  result: SlideCommandResult,
  clipboard: V9SlideClipboardPayload | null,
  reason?: string,
): SlideActionExecution {
  return {
    ...result,
    reason: result.ok ? (reason ?? result.reason) : result.reason,
    actionId,
    clipboard,
  }
}

function refuseAction(
  session: SlideAuthoringSessionRef,
  actionId: SlideSceneActionId,
  clipboard: V9SlideClipboardPayload | null,
  reason: string,
): SlideActionExecution {
  return actionExecution(actionId, reject(session, reason), clipboard)
}

export function executeSlideSceneAction(
  actionId: SlideSceneActionId | string,
  session: SlideAuthoringSessionRef,
  context: SlideActionContext = {},
): SlideActionExecution {
  const clipboard = context.clipboard ?? null
  const known = SLIDE_SCENE_ACTION_IDS.find((id) => id === actionId)
  if (!known) {
    return refuseAction(session, 'delete', clipboard, `未知动作：${actionId}`)
  }
  const stale = rejectIfStale(session, context.expectedRevision)
  if (stale) return actionExecution(known, stale, clipboard)
  const wrong = requireSceneScope(session)
  if (wrong) return actionExecution(known, wrong, clipboard)

  const focus = classifySlideAuthoringFocus(context.focus)
  if (
    isSlideTextLikeAuthoringFocus(focus) &&
    (known === 'delete' || known === 'cut' || known === 'duplicate')
  ) {
    return refuseAction(
      session,
      known,
      clipboard,
      known === 'delete'
        ? SLIDE_DELETE_FOCUS_GUARD_REASON
        : `文字或作者编辑中，不能${known === 'cut' ? '剪切' : '重复'}元素`,
    )
  }

  const ids = context.orderedLayerItemIds ?? session.selection.selectionIds
  const mapping = SLIDE_SCENE_ACTION_COMMAND_MAP.find((entry) => entry.actionId === known)
  if (mapping?.kind === 'ui-elsewhere' || mapping?.kind === 'not-slide-scene') {
    return refuseAction(session, known, clipboard, SLIDE_SCENE_ACTION_REASON[known])
  }

  try {
    switch (known) {
      case 'select-all':
        return actionExecution(
          known,
          selectAllSlideSceneLayers(session, context),
          clipboard,
          '已全选当前可见元素',
        )
      case 'copy': {
        const payload = copySlideSceneClipboard(session, ids)
        return actionExecution(known, succeed(session, false), payload, `已复制 ${payload.items.length} 项`)
      }
      case 'cut': {
        const payload = copySlideSceneClipboard(session, ids)
        const deleted = deleteSlideSceneLayers(session, ids, context)
        return actionExecution(known, deleted, payload, `已剪切 ${payload.items.length} 项`)
      }
      case 'paste':
        return actionExecution(
          known,
          pasteSlideSceneLayers(session, clipboard, context),
          clipboard,
          clipboard ? `已粘贴 ${clipboard.items.length} 项` : '剪贴板为空，无法粘贴',
        )
      case 'duplicate':
        return actionExecution(
          known,
          duplicateSlideSceneLayers(session, ids, context),
          clipboard,
          `已重复 ${ids.length} 项`,
        )
      case 'delete':
        return actionExecution(
          known,
          deleteSlideSceneLayers(session, ids, context),
          clipboard,
          ids.length > 1 ? `已删除 ${ids.length} 项` : '已删除当前选择',
        )
      case 'reorder':
        return actionExecution(
          known,
          reorderSlideSceneLayers(session, context.orderedLayerItemIds ?? ids, context),
          clipboard,
          '已调整图层顺序',
        )
      case 'show':
        return actionExecution(
          known,
          patchSlideSceneLayers(session, ids, { visible: true }, context),
          clipboard,
          '已显示所选元素',
        )
      case 'hide':
        return actionExecution(
          known,
          patchSlideSceneLayers(session, ids, { visible: false }, context),
          clipboard,
          '已隐藏所选元素',
        )
      case 'lock':
        return actionExecution(
          known,
          patchSlideSceneLayers(session, ids, { locked: true }, context),
          clipboard,
          '已锁定所选元素',
        )
      case 'unlock':
        return actionExecution(
          known,
          patchSlideSceneLayers(session, ids, { locked: false }, context),
          clipboard,
          '已解锁所选元素',
        )
      case 'move-forward':
        return actionExecution(
          known,
          nudgeSlideSceneLayers(session, ids, 'forward', context),
          clipboard,
          '已前移所选元素',
        )
      case 'move-backward':
        return actionExecution(
          known,
          nudgeSlideSceneLayers(session, ids, 'backward', context),
          clipboard,
          '已后移所选元素',
        )
      case 'bring-front':
        return actionExecution(
          known,
          nudgeSlideSceneLayers(session, ids, 'front', context),
          clipboard,
          '已置顶所选元素',
        )
      case 'send-back':
        return actionExecution(
          known,
          nudgeSlideSceneLayers(session, ids, 'back', context),
          clipboard,
          '已置底所选元素',
        )
      default:
        return refuseAction(session, known, clipboard, SLIDE_SCENE_ACTION_REASON[known])
    }
  } catch (error) {
    return actionExecution(known, catchCommand(session, error), clipboard)
  }
}

function interactionTarget(session: SlideAuthoringSessionRef): SlideInteractionTarget {
  return { locationId: session.selection.locationId, scope: 'scene' }
}

function applyInteractionHistory(
  session: SlideAuthoringSessionRef,
  history: SlideAuthoringHistory,
): SlideCommandResult {
  if (history === session.history) return succeed(session, false)
  return succeed({
    ...session,
    history,
    selection: selectionAfter(session, history.present, session.selection.selectionIds),
  }, true)
}

export function addSlideSceneInteractionRule(
  session: SlideAuthoringSessionRef,
  rule: InteractionRule,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    return applyInteractionHistory(
      session,
      addSlideInteractionRule(session.history, interactionTarget(session), rule, options.now),
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function updateSlideSceneInteractionRule(
  session: SlideAuthoringSessionRef,
  ruleId: string,
  patch: Partial<Omit<InteractionRule, 'id'>>,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    return applyInteractionHistory(
      session,
      updateSlideInteractionRule(
        session.history,
        interactionTarget(session),
        ruleId,
        patch,
        options.now,
      ),
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function deleteSlideSceneInteractionRule(
  session: SlideAuthoringSessionRef,
  ruleId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    return applyInteractionHistory(
      session,
      deleteSlideInteractionRule(session.history, interactionTarget(session), ruleId, options.now),
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function duplicateSlideSceneInteractionRule(
  session: SlideAuthoringSessionRef,
  ruleId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    return applyInteractionHistory(
      session,
      duplicateSlideInteractionRule(
        session.history,
        interactionTarget(session),
        ruleId,
        options.now,
      ),
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function moveSlideSceneInteractionRule(
  session: SlideAuthoringSessionRef,
  ruleId: string,
  direction: -1 | 1,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const wrong = requireSceneScope(session)
  if (wrong) return wrong
  try {
    return applyInteractionHistory(
      session,
      moveSlideInteractionRule(
        session.history,
        interactionTarget(session),
        ruleId,
        direction,
        options.now,
      ),
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}
