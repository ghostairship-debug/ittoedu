import { nanoid } from 'nanoid'
import { CANVAS_HEIGHT, CANVAS_WIDTH, MAX_SCENE_NODES } from '../../shared/constants'
import { rotatedRectangleAabb } from '../../shared/geometry'
import {
  applyComponentVariant,
  getComponentPropValue,
  resolveComponentPresetProps,
  setComponentPropValue,
} from '../../shared/componentProps'
import { componentSupportsScope } from '../../shared/componentCapabilities'
import { mergeCourseNativeData } from '../../shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import type {
  ComponentLayerItem,
  CourseProjectDocument,
  CourseRuntimeDefinition,
  LayerItem,
  LayerItemOverride,
  NativeLayerItem,
  RuntimeLayerItem,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'
import type { ComponentManifest } from '../../shared/componentTypes'
import { interactionRuleSchema } from '../../shared/interactionSchema'
import {
  isNodeMotionAction,
  type InteractionRule,
  type MotionDirection,
  type MotionEffect,
  type NodeMotionAction,
} from '../../shared/interactionTypes'
import type { ShapeType } from '../../shared/contracts/native-v1'
import { nativeLineGeometrySchema } from '../../shared/contracts/native-v1'
import type { NativeLineGeometry } from '../../shared/contracts/native-v1/types'
import {
  patchEffectiveLayerPropertiesAtTarget,
  patchEffectiveLayerPropertiesAtTargets,
  patchEffectiveLayerItems,
  deleteEffectiveLayerItems,
  type EffectiveLayerPropertiesPatchAtTarget,
  type EffectiveLayerPropertyUpdate,
} from './effectiveLayerCommands'
import {
  createExternalComponentNode,
  createFormulaNode,
  createImageNode,
  createShapeNode,
  createTextNode,
  createVideoNode,
} from '../project/nativeNodeFactories'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  SlideCommandError,
  commitSlideAuthoringHistory,
  commitSlideProjectMutation,
  selectSlideEditorLayers,
  type SlideAuthoringSelection,
  type SlideAuthoringSessionRef,
  type SlideCommandOptions,
  type SlideCommandResult,
} from './slideEditorCommands'
import { buildSlideEditorView, type SlideEditorLayerView } from './slideEditorView'
import {
  makeSlideAuthoringTarget,
  type SlideAuthoringSession,
  type SlideAuthoringTarget,
} from './slideAuthoringBackend'
import {
  allocateCourseLayerOrder,
  sortScopedLayerList,
  type LayerCommandResult,
} from './globalLayerCommands'
import {
  deleteSlideSceneLayers,
  duplicateSlideGlobalLayers,
  duplicateSlideSceneLayers,
} from './v9SlideActionCommands'
import { createInputLayerItem, DEFAULT_INPUT_STYLE, createTextNode as createInputFeedbackText } from '../project/nativeNodeFactories'
import { buildInputRuleFamily, inspectInputRuleFamily, type InputRuleConfig } from '../interactions/inputRuleFamily'
import { allocateInputStateKeys } from '../interactions/inputAuthoringState'

export function addSlideInputLayer(
  session: SlideAuthoringSession,
  input: { answerType?: 'text' | 'number'; x?: number; y?: number; idFactory?: () => string } = {},
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    if (session.scope !== 'scene') throw new Error('填空题只允许添加到演示页场景')
    const id = input.idFactory ?? nanoid
    const layerId = `input_${id()}`
    const answerType = input.answerType ?? 'text'
    const project = commitSlideProjectMutation(session.history.present, draft => {
      const { scene } = slideSceneContext(draft, session)
      const keys = allocateInputStateKeys(draft, answerType, id)
      const data = { ...keys, answerType, placeholder: '填写答案', ruleFamilyRuleIds: [] as string[], style: { ...DEFAULT_INPUT_STYLE } }
      const item = createInputLayerItem(data, { ...input, id: layerId })
      const feedback = (text: string, color: string) => sceneNodeToCourseLayerItem(createInputFeedbackText({
        id: `text_${id()}`, text, name: text, x: item.frame.x, y: item.frame.y + item.frame.height + 16,
        width: 480, height: 60, playbackInitialVisibility: 'hidden', style: { color, fontSize: 24 },
      }))
      const correct = feedback('回答正确！', '#15803d')
      const error = feedback('再想一想，请重新作答。', '#b91c1c')
      const show = (nodeId: string, visible: boolean): import('../../shared/interactionTypes').InteractionActionPayload => ({
        type: visible ? 'node.enter' : 'node.exit', nodeId, effect: 'none', durationMs: 0, easing: 'linear',
      })
      const actions = { correct: [show(error.layerItemId, false), show(correct.layerItemId, true)], error: [show(correct.layerItemId, false), show(error.layerItemId, true)] }
      const config: InputRuleConfig = answerType === 'text' ? { answerType, answers: ['答案'], ...actions } : { answerType, min: 1, max: 1, ...actions }
      const family = buildInputRuleFamily(layerId, data, config, id)
      data.ruleFamilyRuleIds = family.map(rule => rule.id)
      if (item.content.nativeType === 'input') item.content.data = data
      for (const layer of [item, correct, error]) appendOwnedLayer(draft, session, layer)
      scene.interactions.push(...family)
    }, options.now)
    return commitAdded(session, project, layerId)
  } catch (error) { return catchCommand(session, error) }
}

export function configureSlideInputAtTarget(
  session: SlideAuthoringSession,
  target: SlideAuthoringTarget,
  request: { mode: 'apply' | 'rebuild'; config: InputRuleConfig } | { mode: 'unmanage' },
): SlideCommandResult {
  const stale = rejectIfStale(session, target.revision)
  if (stale) return stale
  try {
    if (session.scope !== 'scene' || session.generation !== target.generation || session.sessionId !== target.sessionId ||
      makeSlideAuthoringTarget(session, target.layerItemId, 'item').authoringAddress !== target.authoringAddress) throw new Error('输入编辑目标已改变')
    const project = commitSlideProjectMutation(session.history.present, draft => {
      const { scene } = slideSceneContext(draft, session)
      const item = scene.layerItems.find(layer => layer.layerItemId === target.layerItemId)
      if (!item || item.locked || item.kind !== 'native' || item.content.nativeType !== 'input') throw new Error('输入编辑目标不可用')
      const data = item.content.data
      const inspection = inspectInputRuleFamily(item.layerItemId, data, scene.interactions)
      if (request.mode === 'unmanage') { data.ruleFamilyRuleIds = []; return }
      if (request.mode === 'apply' && inspection.conflict) throw new Error('判题规则已被手改，请选择保留手改或重建')
      scene.interactions = scene.interactions.filter(rule => !data.ruleFamilyRuleIds.includes(rule.id))
      if (request.config.answerType !== data.answerType) {
        data.answerType = request.config.answerType
        const declaration = draft.courseState.find(entry => entry.key === data.stateKey)
        if (!declaration) throw new Error('输入答案状态声明已失效')
        draft.courseState = draft.courseState.map(entry => entry === declaration
          ? data.answerType === 'text' ? { key: entry.key, valueType: 'string', defaultValue: '' } : { key: entry.key, valueType: 'number', defaultValue: 0 }
          : entry)
      }
      const rules = buildInputRuleFamily(item.layerItemId, data, request.config, nanoid)
      data.ruleFamilyRuleIds = rules.map(rule => rule.id)
      scene.interactions.push(...rules)
    })
    return commitUpdated(session, project)
  } catch (error) { return catchCommand(session, error) }
}

/**
 * V8 `offsetDefaultInsertion` contract from editorStore.
 * Consecutive default inserts stagger by 20px on a 6-wide grid that wraps
 * every 24 slots. Explicit x/y skips the offset.
 */
export const SLIDE_DEFAULT_INSERTION_COLUMNS = 6
export const SLIDE_DEFAULT_INSERTION_OFFSET = 20
const SLIDE_DEFAULT_INSERTION_SLOTS = SLIDE_DEFAULT_INSERTION_COLUMNS * 4

export interface SlideInsertionPoint {
  readonly x: number
  readonly y: number
}

export function offsetDefaultSlideInsertion<T extends SlideInsertionPoint>(
  item: T,
  existingItemCount: number,
  hasExplicitPosition: boolean,
): T {
  if (hasExplicitPosition) return item
  const slot = existingItemCount % SLIDE_DEFAULT_INSERTION_SLOTS
  return {
    ...item,
    x: item.x + (slot % SLIDE_DEFAULT_INSERTION_COLUMNS) * SLIDE_DEFAULT_INSERTION_OFFSET,
    y: item.y + Math.floor(slot / SLIDE_DEFAULT_INSERTION_COLUMNS) * SLIDE_DEFAULT_INSERTION_OFFSET,
  }
}

export interface SlideSimpleEntranceAnimationConfig {
  effect: Exclude<MotionEffect, 'none'>
  direction?: MotionDirection
  durationMs: number
  delayMs: number
}
export type SimpleEntranceAnimationConfig = SlideSimpleEntranceAnimationConfig

export interface SlideNativeContentPatch {
  readonly nativeData?: Record<string, unknown>
  readonly label?: string
}

export interface AddSlideTextLayerInput {
  readonly text?: string
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly label?: string
}

export interface AddSlideFormulaLayerInput {
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly label?: string
}

export interface AddSlideShapeLayerInput {
  readonly shapeType: ShapeType
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly label?: string
  /**
   * Direct-draw path: one pointerdown→pointerup gesture commits frame and
   * parameterized geometry together. Both must be present for line tools.
   */
  readonly frame?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly lineGeometry?: NativeLineGeometry
}

export interface AddSlideImageLayerInput {
  readonly assetId: string
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly label?: string
}

export interface AddSlideVideoLayerInput {
  readonly assetId: string
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly label?: string
}

export interface AddSlideComponentLayerInput {
  readonly packageId: string
  readonly manifest?: ComponentManifest
  readonly props?: Record<string, unknown>
  readonly presetId?: string
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly label?: string
}

export interface AddSlideRuntimeLayerInput {
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly label?: string
  readonly runtime?: CourseRuntimeDefinition
}

export interface SlideRuntimeDefinitionPatch {
  readonly source?: string
  readonly enabled?: boolean
  readonly contentValues?: Record<string, string>
  readonly assets?: Record<string, { assetId: string }>
}

export interface SlideEntrancePreviewRequest {
  readonly action: NodeMotionAction
  readonly delayMs: number
}

function freezeSelection(selection: SlideAuthoringSelection): SlideAuthoringSelection {
  return Object.freeze({
    locationId: selection.locationId,
    stateId: selection.stateId,
    selectionIds: Object.freeze([...selection.selectionIds]),
  })
}

function freezeSession(session: SlideAuthoringSessionRef): SlideAuthoringSession {
  return Object.freeze({
    sessionId: session.sessionId,
    history: Object.freeze({
      present: session.history.present,
      past: Object.freeze([...session.history.past]),
      future: Object.freeze([...session.history.future]),
    }),
    selection: freezeSelection(session.selection),
    scope: session.scope,
    generation: session.generation,
  })
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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function stableId(prefix: string, preferred?: string): string {
  return preferred ?? `${prefix}-${nanoid(10)}`
}

function slideSceneContext(
  project: CourseProjectDocument,
  session: SlideAuthoringSessionRef,
): {
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'slide-scene' }>
  surface: SlideSurfaceDocument
  scene: SlideSceneDocument
} {
  const location = project.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前位置不是幻灯片')
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('当前幻灯片已失效')
  return { location, surface, scene }
}

function requireSceneScope(session: SlideAuthoringSessionRef): void {
  if (session.scope !== 'scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '请先切换到场景层')
  }
}

function appendGlobalLayer(
  project: CourseProjectDocument,
  item: LayerItem,
): void {
  if (project.globalLayerItems.some((entry) => entry.item.layerItemId === item.layerItemId)) {
    throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  }
  const preferred = Math.max(-1, ...project.globalLayerItems.map((entry) => entry.item.order)) + 1
  item.order = allocateCourseLayerOrder(project, Math.max(0, preferred))
  project.globalLayerItems.push({
    item,
    plane: 'overlay',
    visibility: { mode: 'all', locationIds: [] },
  })
  sortScopedLayerList(project.globalLayerItems)
}

function appendOwnedLayer(
  project: CourseProjectDocument,
  session: SlideAuthoringSessionRef,
  item: LayerItem,
): void {
  if (session.scope === 'global') {
    appendGlobalLayer(project, item)
    return
  }
  requireSceneScope(session)
  const { scene } = slideSceneContext(project, session)
  appendSceneLayer(project, scene, structuredClone(item), session.selection.stateId)
}

function sortSceneLayers(scene: SlideSceneDocument): void {
  scene.layerItems.sort((left, right) =>
    left.order - right.order || left.layerItemId.localeCompare(right.layerItemId),
  )
}

function nextSceneLayerOrder(
  project: CourseProjectDocument,
  scene: SlideSceneDocument,
): number {
  const preferred = Math.max(-1, ...scene.layerItems.map((item) => item.order)) + 1
  return allocateCourseLayerOrder(project, Math.max(0, preferred))
}

function appendSceneLayer(
  project: CourseProjectDocument,
  scene: SlideSceneDocument,
  item: LayerItem,
  stateId: string | null,
): void {
  if (scene.layerItems.length >= MAX_SCENE_NODES) {
    throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
  }
  if (scene.layerItems.some((candidate) => candidate.layerItemId === item.layerItemId)) {
    throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  }
  item.order = nextSceneLayerOrder(project, scene)
  if (stateId) {
    const presentationState = scene.presentation?.states.find(
      (candidate) => candidate.id === stateId,
    )
    if (!presentationState) throw new Error(`找不到命名状态：${stateId}`)
    item.visible = false
    presentationState.layerItemOverrides[item.layerItemId] = { visible: true }
  }
  scene.layerItems.push(item)
  sortSceneLayers(scene)
}

function selectAdded(
  session: SlideAuthoringSessionRef,
  project: CourseProjectDocument,
  layerItemId: string,
): SlideAuthoringSelection {
  return selectSlideEditorLayers({
    project,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
    selectionIds: [layerItemId],
  })
}

function commitAdded(
  session: SlideAuthoringSessionRef,
  project: CourseProjectDocument,
  layerItemId: string,
): SlideCommandResult {
  return succeed({
    sessionId: session.sessionId,
    history: commitSlideAuthoringHistory(session.history, project),
    selection: selectAdded(session, project, layerItemId),
    scope: session.scope,
    generation: session.generation,
  }, true)
}

function commitUpdated(
  session: SlideAuthoringSessionRef,
  project: CourseProjectDocument,
): SlideCommandResult {
  return succeed({
    sessionId: session.sessionId,
    history: commitSlideAuthoringHistory(session.history, project),
    selection: selectSlideEditorLayers({
      project,
      locationId: session.selection.locationId,
      stateId: session.selection.stateId,
      selectionIds: session.selection.selectionIds,
    }),
    scope: session.scope,
    generation: session.generation,
  }, true)
}

function sceneLayerView(
  session: SlideAuthoringSessionRef,
  layerItemId: string,
): SlideEditorLayerView {
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer) throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
  if (layer.source !== 'scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前选择不属于当前幻灯片场景')
  }
  return layer
}

function ownedLayerView(
  session: SlideAuthoringSessionRef,
  layerItemId: string,
): SlideEditorLayerView {
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer) throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
  if (layer.source !== session.scope) {
    throw new SlideCommandError(
      SLIDE_REJECT_WRONG_OWNER,
      session.scope === 'global' ? '当前选择不属于全局层' : '当前选择不属于当前幻灯片场景',
    )
  }
  return layer
}

function requireUnlockedOwnedLayer(
  session: SlideAuthoringSessionRef,
  layerItemId: string,
): SlideEditorLayerView {
  const layer = ownedLayerView(session, layerItemId)
  if (layer.item.locked) {
    throw new SlideCommandError(SLIDE_REJECT_LOCKED, '当前元素已锁定')
  }
  if (layer.item.kind === 'native' && layer.item.content.nativeType === 'teacher-controller') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '教师控制器不由本命令编辑')
  }
  return layer
}

function requireUnlockedSceneLayer(
  session: SlideAuthoringSessionRef,
  layerItemId: string,
): SlideEditorLayerView {
  requireSceneScope(session)
  const layer = sceneLayerView(session, layerItemId)
  if (layer.item.locked) {
    throw new SlideCommandError(SLIDE_REJECT_LOCKED, '当前元素已锁定')
  }
  return layer
}

function deleteEmptyOverride(
  overrides: Record<string, LayerItemOverride>,
  layerItemId: string,
): void {
  const override = overrides[layerItemId]
  if (override && Object.keys(override).length === 0) {
    delete overrides[layerItemId]
  }
}

function presentationStateForWrite(
  scene: SlideSceneDocument,
  stateId: string | null,
) {
  if (stateId === null) return undefined
  const state = scene.presentation?.states.find((candidate) => candidate.id === stateId)
  if (!state) throw new Error('当前命名状态已失效')
  return state
}

function writeNativeData(
  scene: SlideSceneDocument,
  stateId: string | null,
  layerItemId: string,
  nativeData: Record<string, unknown>,
  label?: string,
): boolean {
  const base = scene.layerItems.find((item) => item.layerItemId === layerItemId)
  if (!base || base.kind !== 'native') {
    throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
  }
  const state = presentationStateForWrite(scene, stateId)
  if (!state) {
    const nextData = mergeCourseNativeData(
      base.content.data as Record<string, unknown>,
      nativeData,
    )
    const nextLabel = label ?? base.label
    if (sameJson(base.content.data, nextData) && nextLabel === base.label) return false
    base.content.data = nextData as typeof base.content.data
    if (label !== undefined) base.label = label
    return true
  }
  const override = state.layerItemOverrides[layerItemId] ?? {}
  const currentData = mergeCourseNativeData(
    base.content.data as Record<string, unknown>,
    override.nativeData ?? {},
  )
  const nextData = mergeCourseNativeData(currentData, nativeData)
  const nextNative = sparseObjectDiff(base.content.data as Record<string, unknown>, nextData)
  if (Object.keys(nextNative).length === 0) delete override.nativeData
  else override.nativeData = nextNative
  if (label !== undefined) {
    if (label === base.label) delete override.label
    else override.label = label
  }
  state.layerItemOverrides[layerItemId] = override
  deleteEmptyOverride(state.layerItemOverrides, layerItemId)
  return !sameJson(currentData, nextData) || (label !== undefined && label !== (
    override.label ?? base.label
  ))
}

function sparseObjectDiff(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (sameJson(base[key], next[key])) continue
    // `null` rides the shared merge contract as a key deletion.
    diff[key] = Object.prototype.hasOwnProperty.call(next, key)
      ? structuredClone(next[key])
      : null
  }
  return diff
}

function writeComponentProps(
  scene: SlideSceneDocument,
  stateId: string | null,
  layerItemId: string,
  props: Record<string, unknown>,
  label?: string,
): boolean {
  const base = scene.layerItems.find((item) => item.layerItemId === layerItemId)
  if (!base || base.kind !== 'component') {
    throw new SlideCommandError('invalid-target', '当前元素不是复用组件')
  }
  const state = presentationStateForWrite(scene, stateId)
  if (!state) {
    const nextLabel = label ?? base.label
    if (sameJson(base.props, props) && nextLabel === base.label) return false
    base.props = structuredClone(props)
    if (label !== undefined) base.label = label
    return true
  }
  const override = state.layerItemOverrides[layerItemId] ?? {}
  const current = {
    ...structuredClone(base.props),
    ...(override.componentProps ?? {}),
  }
  const componentProps = sparseObjectDiff(base.props, props)
  if (Object.keys(componentProps).length === 0) delete override.componentProps
  else override.componentProps = componentProps
  if (label !== undefined) {
    if (label === base.label) delete override.label
    else override.label = label
  }
  state.layerItemOverrides[layerItemId] = override
  deleteEmptyOverride(state.layerItemOverrides, layerItemId)
  return !sameJson(current, props) || (label !== undefined && label !== (override.label ?? base.label))
}

function writeRuntimeItem(
  scene: SlideSceneDocument,
  layerItemId: string,
  update: (item: RuntimeLayerItem) => boolean,
): boolean {
  const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
  if (!item || item.kind !== 'runtime') {
    throw new SlideCommandError('invalid-target', '找不到当前动态内容层')
  }
  return update(item)
}

function defaultSurfaceRuntime(
  assets: Record<string, { assetId: string }> = {},
  content: CourseRuntimeDefinition['content'] = { values: {} },
): CourseRuntimeDefinition {
  return {
    protocol: 'surface-runtime',
    runtimeApiVersion: 3,
    enabled: true,
    renderMode: 'dom',
    source: 'CoursewareRuntime.define({ runtimeApiVersion: 3, protocol: "surface-runtime" })',
    content: structuredClone(content),
    assets: structuredClone(assets),
  }
}

function offsetFrame(
  frame: { x: number; y: number; width: number; height: number },
  existingCount: number,
  hasExplicitPosition: boolean,
): { x: number; y: number; width: number; height: number } {
  const offset = offsetDefaultSlideInsertion(
    { x: frame.x, y: frame.y },
    existingCount,
    hasExplicitPosition,
  )
  return { ...frame, x: offset.x, y: offset.y }
}

function requireAsset(
  project: CourseProjectDocument,
  assetId: string,
  kind?: 'image' | 'video',
): void {
  const asset = project.assets[assetId]
  if (!asset) throw new Error(`找不到素材：${assetId}`)
  if (kind && asset.kind !== kind) throw new Error(`素材类型必须是${kind === 'image' ? '图片' : '视频'}`)
}

export function addSlideTextLayer(
  session: SlideAuthoringSession,
  input: AddSlideTextLayerInput = {},
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const existingCount = session.scope === 'global'
      ? session.history.present.globalLayerItems.length
      : slideSceneContext(session.history.present, session).scene.layerItems.length
    const node = offsetDefaultSlideInsertion(
      createTextNode({
        id: stableId('text', input.id),
        name: input.label ?? '文本',
        text: input.text ?? '双击编辑文字',
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      appendOwnedLayer(draft, session, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function addSlideFormulaLayer(
  session: SlideAuthoringSession,
  input: AddSlideFormulaLayerInput = {},
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const existingCount = session.scope === 'global'
      ? session.history.present.globalLayerItems.length
      : slideSceneContext(session.history.present, session).scene.layerItems.length
    const node = offsetDefaultSlideInsertion(
      createFormulaNode({
        id: stableId('formula', input.id),
        name: input.label ?? '公式',
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      appendOwnedLayer(draft, session, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function addSlideShapeLayer(
  session: SlideAuthoringSession,
  input: AddSlideShapeLayerInput,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const lineGeometry = input.lineGeometry === undefined
      ? undefined
      : validateSlideLineGeometry(input.shapeType, input.lineGeometry)
    if (input.frame !== undefined) {
      validateSlideLineFrame(input.frame)
      if (!lineGeometry) {
        throw new SlideCommandError('invalid-target', '直接绘制的线条必须同时提供几何参数')
      }
    }
    if (lineGeometry && input.frame === undefined) {
      throw new SlideCommandError('invalid-target', '线条几何必须与绘制框同时提交')
    }
    const existingCount = session.scope === 'global'
      ? session.history.present.globalLayerItems.length
      : slideSceneContext(session.history.present, session).scene.layerItems.length
    const node = offsetDefaultSlideInsertion(
      (() => {
        const created = createShapeNode(input.shapeType, {
          id: stableId('shape', input.id),
          ...(input.label === undefined ? {} : { name: input.label }),
          x: input.frame?.x ?? input.x,
          y: input.frame?.y ?? input.y,
          ...(input.frame ? { width: input.frame.width, height: input.frame.height } : {}),
        })
        if (lineGeometry) created.lineGeometry = structuredClone(lineGeometry)
        return created
      })(),
      existingCount,
      input.frame !== undefined || input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      appendOwnedLayer(draft, session, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchCommand(session, error)
  }
}

function validateSlideLineFrame(
  frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): void {
  if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) {
    throw new SlideCommandError('invalid-target', '线条绘制框必须是有限数值')
  }
  if (frame.width <= 0 || frame.height <= 0) {
    throw new SlideCommandError('invalid-target', '线条绘制框尺寸必须大于 0')
  }
}

function validateSlideLineGeometry(
  shapeType: ShapeType,
  lineGeometry: NativeLineGeometry,
): NativeLineGeometry {
  if (shapeType !== 'line' && shapeType !== 'elbow-arrow') {
    throw new SlideCommandError(
      'invalid-target',
      `只有直线和折线箭头支持线几何，${shapeType} 不支持`,
    )
  }
  const parsed = nativeLineGeometrySchema.safeParse(lineGeometry)
  if (!parsed.success) {
    throw new SlideCommandError(
      'invalid-target',
      `线几何无效：${parsed.error.issues[0]?.message ?? '未知原因'}`,
    )
  }
  if (shapeType === 'line' && parsed.data.kind !== 'straight') {
    throw new SlideCommandError('invalid-target', '直线只支持 straight 类型的线几何')
  }
  if (shapeType === 'elbow-arrow' && parsed.data.kind !== 'elbow') {
    throw new SlideCommandError('invalid-target', '折线箭头只支持 elbow 类型的线几何')
  }
  return structuredClone(parsed.data)
}

export interface UpdateSlideShapeLineGeometryInput {
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly lineGeometry: NativeLineGeometry
}

/**
 * One line handle gesture commit: LayerItem frame and normalized lineGeometry
 * are written atomically as a single history entry. Geometry absent from the
 * stored data materializes here for the first time (legacy defaults are never
 * written back on read).
 */
export function updateSlideShapeLineGeometry(
  session: SlideAuthoringSession,
  layerItemId: string,
  input: UpdateSlideShapeLineGeometryInput,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const layer = requireUnlockedOwnedLayer(session, layerItemId)
    if (layer.item.kind !== 'native' || layer.item.content.nativeType !== 'shape') {
      throw new SlideCommandError('invalid-target', '当前选择不是原生图形')
    }
    const shapeType = (layer.item.content.data as { shapeType?: unknown }).shapeType
    if (shapeType !== 'line' && shapeType !== 'elbow-arrow') {
      throw new SlideCommandError('invalid-target', '只有直线和折线箭头支持编辑线几何')
    }
    const lineGeometry = validateSlideLineGeometry(shapeType, input.lineGeometry)
    validateSlideLineFrame(input.frame)
    const effectiveFrame = layer.item.frame
    const currentGeometry = (layer.item.content.data as { lineGeometry?: unknown }).lineGeometry
    const unchanged =
      effectiveFrame.x === input.frame.x &&
      effectiveFrame.y === input.frame.y &&
      effectiveFrame.width === input.frame.width &&
      effectiveFrame.height === input.frame.height &&
      sameJson(currentGeometry, lineGeometry)
    if (unchanged) return succeed(session, false)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const writeFrame = (item: { frame: { x: number; y: number; width: number; height: number } }) => {
        item.frame.x = input.frame.x
        item.frame.y = input.frame.y
        item.frame.width = input.frame.width
        item.frame.height = input.frame.height
      }
      if (session.scope === 'global') {
        const globalEntry = draft.globalLayerItems.find((entry) => entry.item.layerItemId === layerItemId)
        if (!globalEntry || globalEntry.item.kind !== 'native') {
          throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
        }
        writeFrame(globalEntry.item)
        globalEntry.item.content.data = mergeCourseNativeData(
          globalEntry.item.content.data as Record<string, unknown>,
          { lineGeometry },
        ) as typeof globalEntry.item.content.data
        return
      }
      const { scene } = slideSceneContext(draft, session)
      const base = scene.layerItems.find((item) => item.layerItemId === layerItemId)
      if (!base || base.kind !== 'native') {
        throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
      }
      const state = presentationStateForWrite(scene, session.selection.stateId)
      if (!state) {
        writeFrame(base)
        base.content.data = mergeCourseNativeData(
          base.content.data as Record<string, unknown>,
          { lineGeometry },
        ) as typeof base.content.data
        return
      }
      const override = state.layerItemOverrides[layerItemId] ?? {}
      const frame = { ...override.frame }
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (input.frame[key] === base.frame[key]) delete frame[key]
        else frame[key] = input.frame[key]
      }
      if (Object.keys(frame).length === 0) delete override.frame
      else override.frame = frame
      state.layerItemOverrides[layerItemId] = override
      writeNativeData(scene, session.selection.stateId, layerItemId, { lineGeometry })
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function addSlideImageLayer(
  session: SlideAuthoringSession,
  input: AddSlideImageLayerInput,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    requireAsset(session.history.present, input.assetId, 'image')
    const existingCount = session.scope === 'global'
      ? session.history.present.globalLayerItems.length
      : slideSceneContext(session.history.present, session).scene.layerItems.length
    const asset = session.history.present.assets[input.assetId]!
    const sized = createImageNode(input.assetId, asset.width, asset.height, input.x, input.y)
    const node = offsetDefaultSlideInsertion(
      createImageNode({
        id: stableId('image', input.id),
        name: input.label ?? '图片',
        assetId: input.assetId,
        width: input.width ?? sized.width,
        height: input.height ?? sized.height,
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      appendOwnedLayer(draft, session, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function addSlideVideoLayer(
  session: SlideAuthoringSession,
  input: AddSlideVideoLayerInput,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireAsset(session.history.present, input.assetId, 'video')
    const existingCount = session.scope === 'global'
      ? session.history.present.globalLayerItems.length
      : slideSceneContext(session.history.present, session).scene.layerItems.length
    const asset = session.history.present.assets[input.assetId]!
    const node = offsetDefaultSlideInsertion(
      createVideoNode({
        id: stableId('video', input.id),
        name: input.label ?? '视频',
        assetId: input.assetId,
        width: input.width ?? asset.width ?? 640,
        height: input.height ?? asset.height ?? 360,
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      appendOwnedLayer(draft, session, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function addSlideComponentLayer(
  session: SlideAuthoringSession,
  input: AddSlideComponentLayerInput,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const ownedScope = session.scope === 'global' ? 'global' : 'scene'
    const embedded = session.history.present.componentPackages[input.packageId]
    if (!embedded) throw new Error(`组件包未嵌入工程：${input.packageId}`)
    const manifest = input.manifest
    if (manifest && manifest.id !== input.packageId) {
      throw new Error('组件清单 ID 与工程嵌入包不一致')
    }
    if (manifest && !componentSupportsScope(manifest, ownedScope)) {
      throw new Error(ownedScope === 'global' ? '未声明支持全局层' : '该组件不支持场景层')
    }
    const preset = input.presetId
      ? manifest?.presets?.find((candidate) => candidate.id === input.presetId)
      : undefined
    if (input.presetId && !preset) throw new Error('组件预设不存在')
    const props = preset && manifest
      ? resolveComponentPresetProps(manifest, preset)
      : structuredClone(input.props ?? manifest?.defaultProps ?? {})
    const existingCount = session.scope === 'global'
      ? session.history.present.globalLayerItems.length
      : slideSceneContext(session.history.present, session).scene.layerItems.length
    const node = offsetDefaultSlideInsertion(
      createExternalComponentNode({
        id: stableId('component', input.id),
        name: input.label
          ?? (preset && manifest ? `${manifest.name} · ${preset.label}` : undefined)
          ?? preset?.label
          ?? manifest?.name
          ?? embedded.name,
        component: {
          packageId: embedded.packageId,
          version: embedded.version,
        },
        props,
        width: input.width ?? manifest?.defaultSize.width ?? 480,
        height: input.height ?? manifest?.defaultSize.height ?? 280,
        x: input.x,
        y: input.y,
      }),
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      appendOwnedLayer(draft, session, structuredClone(item))
    }, options.now)
    return commitAdded(session, project, node.id)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function addSlideRuntimeLayer(
  session: SlideAuthoringSession,
  input: AddSlideRuntimeLayerInput = {},
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const { scene } = slideSceneContext(session.history.present, session)
    const width = input.width ?? 640
    const height = input.height ?? 360
    const frame = offsetFrame({
      x: input.x ?? (CANVAS_WIDTH - width) / 2,
      y: input.y ?? (CANVAS_HEIGHT - height) / 2,
      width,
      height,
    }, scene.layerItems.length, input.x !== undefined || input.y !== undefined)
    const layerItemId = stableId('runtime', input.id)
    const item: RuntimeLayerItem = {
      layerItemId,
      label: input.label ?? '动态内容',
      kind: 'runtime',
      frame: { mode: 'absolute', ...frame },
      order: 0,
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      runtime: structuredClone(input.runtime ?? defaultSurfaceRuntime()),
    }
    Object.values(item.runtime.assets).forEach((binding) => {
      requireAsset(session.history.present, binding.assetId)
    })
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const next = slideSceneContext(draft, session)
      appendSceneLayer(draft, next.scene, structuredClone(item), session.selection.stateId)
    }, options.now)
    return commitAdded(session, project, layerItemId)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function replaceSlideMediaAsset(
  session: SlideAuthoringSession,
  layerItemId: string,
  assetId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const layer = requireUnlockedSceneLayer(session, layerItemId)
    if (layer.item.kind !== 'native') {
      throw new SlideCommandError('invalid-target', '请选择一个图片或视频后替换')
    }
    const nativeType = layer.item.content.nativeType
    if (nativeType !== 'image' && nativeType !== 'video') {
      throw new SlideCommandError('invalid-target', '请选择一个图片或视频后替换')
    }
    requireAsset(session.history.present, assetId, nativeType)
    const currentAssetId = layer.item.content.data.assetId
    if (currentAssetId === assetId) return succeed(session, false)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      writeNativeData(
        scene,
        session.selection.stateId,
        layerItemId,
        { assetId },
      )
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function updateSlideNativeLayerContent(
  session: SlideAuthoringSession,
  layerItemId: string,
  patch: SlideNativeContentPatch,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const layer = requireUnlockedOwnedLayer(session, layerItemId)
    if (layer.item.kind !== 'native') {
      throw new SlideCommandError('invalid-target', '当前选择不是原生图层')
    }
    if (layer.item.content.nativeType === 'teacher-controller') {
      throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '教师控制器不由本命令编辑')
    }
    const nativeData = patch.nativeData ?? {}
    const current = layer.item as NativeLayerItem
    const nextData = mergeCourseNativeData(
      current.content.data as Record<string, unknown>,
      nativeData,
    )
    const nextLabel = patch.label ?? current.label
    if (sameJson(current.content.data, nextData) && nextLabel === current.label) {
      return succeed(session, false)
    }
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      if (session.scope === 'global') {
        const globalEntry = draft.globalLayerItems.find((entry) => entry.item.layerItemId === layerItemId)
        if (!globalEntry || globalEntry.item.kind !== 'native') {
          throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
        }
        globalEntry.item.content.data = mergeCourseNativeData(
          globalEntry.item.content.data as Record<string, unknown>,
          nativeData,
        ) as typeof globalEntry.item.content.data
        if (patch.label !== undefined) globalEntry.item.label = patch.label
        return
      }
      const { scene } = slideSceneContext(draft, session)
      writeNativeData(
        scene,
        session.selection.stateId,
        layerItemId,
        nativeData,
        patch.label,
      )
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function updateSlideComponentProps(
  session: SlideAuthoringSession,
  layerItemId: string,
  props: Record<string, unknown>,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const layer = requireUnlockedSceneLayer(session, layerItemId)
    if (layer.item.kind !== 'component') {
      throw new SlideCommandError('invalid-target', '当前元素不是复用组件')
    }
    if (sameJson(layer.item.props, props)) return succeed(session, false)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      writeComponentProps(scene, session.selection.stateId, layerItemId, props)
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function applySlideComponentVariant(
  session: SlideAuthoringSession,
  layerItemId: string,
  variantId: string,
  manifest: ComponentManifest,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  try {
    const layer = requireUnlockedSceneLayer(session, layerItemId)
    if (layer.item.kind !== 'component') {
      throw new SlideCommandError('invalid-target', '当前元素不是复用组件')
    }
    const variant = manifest.variants?.find((candidate) => candidate.id === variantId)
    if (!variant) throw new Error('组件变体不存在')
    const props = applyComponentVariant(layer.item.props as Record<string, unknown>, variant, manifest)
    return updateSlideComponentProps(session, layerItemId, props, options)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function applySlideComponentPreset(
  session: SlideAuthoringSession,
  layerItemId: string,
  presetId: string,
  manifest: ComponentManifest,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  try {
    requireUnlockedSceneLayer(session, layerItemId)
    const props = resolveComponentPresetProps(manifest, presetId)
    return updateSlideComponentProps(session, layerItemId, props, options)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function updateSlideComponentNestedContent(
  session: SlideAuthoringSession,
  layerItemId: string,
  path: string,
  value: unknown,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  try {
    const layer = requireUnlockedSceneLayer(session, layerItemId)
    if (layer.item.kind !== 'component') {
      throw new SlideCommandError('invalid-target', '当前元素不是复用组件')
    }
    const current = getComponentPropValue(layer.item.props as Record<string, unknown>, path)
    if (sameJson(current, value)) return succeed(session, false)
    const props = setComponentPropValue(
      layer.item.props as Record<string, unknown>,
      path,
      value,
    )
    return updateSlideComponentProps(session, layerItemId, props, options)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function updateSlideRuntimeContentValue(
  session: SlideAuthoringSession,
  layerItemId: string,
  key: string,
  value: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const layer = requireUnlockedSceneLayer(session, layerItemId)
    if (layer.item.kind !== 'runtime') {
      throw new SlideCommandError('invalid-target', '找不到当前动态内容层')
    }
    if (!Object.prototype.hasOwnProperty.call(layer.item.runtime.content.values, key)) {
      throw new Error('当前动态内容没有这个文字字段')
    }
    if (layer.item.runtime.content.values[key] === value) return succeed(session, false)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      writeRuntimeItem(scene, layerItemId, (item) => {
        item.runtime.content.values[key] = value
        return true
      })
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function updateSlideRuntimeAsset(
  session: SlideAuthoringSession,
  layerItemId: string,
  key: string,
  assetId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const layer = requireUnlockedSceneLayer(session, layerItemId)
    if (layer.item.kind !== 'runtime') {
      throw new SlideCommandError('invalid-target', '找不到当前动态内容层')
    }
    if (!Object.prototype.hasOwnProperty.call(layer.item.runtime.assets, key)) {
      throw new Error('当前动态内容没有这个图片字段')
    }
    requireAsset(session.history.present, assetId)
    if (layer.item.runtime.assets[key]?.assetId === assetId) return succeed(session, false)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      writeRuntimeItem(scene, layerItemId, (item) => {
        item.runtime.assets[key] = { assetId }
        return true
      })
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function updateSlideRuntimeDefinition(
  session: SlideAuthoringSession,
  layerItemId: string,
  patch: SlideRuntimeDefinitionPatch,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const layer = requireUnlockedSceneLayer(session, layerItemId)
    if (layer.item.kind !== 'runtime') {
      throw new SlideCommandError('invalid-target', '找不到当前动态内容层')
    }
    const runtime = layer.item.runtime
    const nextRuntime: CourseRuntimeDefinition = {
      ...runtime,
      ...(patch.source === undefined ? {} : { source: patch.source }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.contentValues === undefined
        ? {}
        : { content: { ...runtime.content, values: { ...patch.contentValues } } }),
      ...(patch.assets === undefined ? {} : { assets: structuredClone(patch.assets) }),
    }
    if (sameJson(runtime, nextRuntime)) return succeed(session, false)
    Object.values(nextRuntime.assets).forEach((binding) => {
      requireAsset(session.history.present, binding.assetId)
    })
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      writeRuntimeItem(scene, layerItemId, (item) => {
        item.runtime = structuredClone(nextRuntime)
        return true
      })
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

function simpleEntranceRuleMatchesState(
  rule: InteractionRule,
  nodeId: string,
  stateId: string | null,
): boolean {
  if (
    !rule.id.startsWith('simple_entrance_') ||
    rule.trigger.type !== 'node.activated' ||
    rule.trigger.nodeId !== nodeId ||
    rule.actions.length !== 1
  ) {
    return false
  }
  const [step] = rule.actions
  if (
    !step ||
    step.start !== 'after-previous' ||
    !isNodeMotionAction(step.action) ||
    step.action.type !== 'node.enter' ||
    step.action.nodeId !== nodeId
  ) {
    return false
  }
  if (rule.conditions.some((condition) => condition.type !== 'presentation.in')) {
    return false
  }
  const presentationConditions = rule.conditions.filter(
    (condition) => condition.type === 'presentation.in',
  )
  if (stateId === null) return presentationConditions.length === 0
  return presentationConditions.length === 1 &&
    presentationConditions[0]!.stateIds.length === 1 &&
    presentationConditions[0]!.stateIds[0] === stateId
}

export function findSimpleEntranceAnimationRule(
  rules: readonly InteractionRule[],
  nodeId: string,
  stateId: string | null,
): InteractionRule | undefined {
  return rules.find((rule) => simpleEntranceRuleMatchesState(rule, nodeId, stateId))
}

function findSimpleEntranceRule(
  rules: readonly InteractionRule[],
  nodeId: string,
  stateId: string | null,
): InteractionRule | undefined {
  return findSimpleEntranceAnimationRule(rules, nodeId, stateId)
}

export function hasAdvancedEntranceAnimation(
  rules: readonly InteractionRule[],
  nodeId: string,
  stateId: string | null,
): boolean {
  return rules.some((rule) => (
    rule.actions.some((step) => (
      isNodeMotionAction(step.action) &&
      step.action.type === 'node.enter' &&
      step.action.nodeId === nodeId
    )) &&
    (
      stateId === null ||
      !rule.conditions.some((condition) => condition.type === 'presentation.in') ||
      rule.conditions.some((condition) => (
        condition.type === 'presentation.in' &&
        condition.stateIds.includes(stateId)
      ))
    ) &&
    !simpleEntranceRuleMatchesState(rule, nodeId, stateId)
  ))
}

function simpleEntranceAction(
  nodeId: string,
  config: SlideSimpleEntranceAnimationConfig,
): NodeMotionAction {
  const common = {
    type: 'node.enter' as const,
    nodeId,
    durationMs: Math.min(10_000, Math.max(0, config.durationMs)),
    easing: 'ease-out' as const,
  }
  return config.effect === 'slide'
    ? {
        ...common,
        effect: 'slide',
        direction: config.direction ?? 'left',
      }
    : {
        ...common,
        effect: config.effect,
      }
}

function withoutDanglingAnimationCompletionRules(
  rules: readonly InteractionRule[],
): InteractionRule[] {
  let retained = [...rules]
  while (true) {
    const motionActionIds = new Set(retained.flatMap((rule) =>
      rule.actions.flatMap((step) => isNodeMotionAction(step.action) ? [step.id] : []),
    ))
    const next = retained.filter((rule) =>
      rule.trigger.type !== 'animation.completed' ||
      motionActionIds.has(rule.trigger.actionId),
    )
    if (next.length === retained.length) return next
    retained = next
  }
}

function entranceRuleAppliesToState(
  rule: InteractionRule,
  nodeId: string,
  stateId: string | null,
): boolean {
  if (!rule.actions.some((step) => (
    isNodeMotionAction(step.action) &&
    step.action.type === 'node.enter' &&
    step.action.nodeId === nodeId
  ))) {
    return false
  }
  const presentationConditions = rule.conditions.filter(
    (condition) => condition.type === 'presentation.in',
  )
  if (stateId === null) return presentationConditions.length === 0
  return presentationConditions.length === 0 ||
    presentationConditions.some((condition) => condition.stateIds.includes(stateId))
}

function setPlaybackInitialVisibility(
  scene: SlideSceneDocument,
  stateId: string | null,
  layerItemId: string,
  value: 'inherit' | 'hidden',
): void {
  const base = scene.layerItems.find((item) => item.layerItemId === layerItemId)
  if (!base) return
  if (stateId === null) {
    base.playbackInitialVisibility = value
    return
  }
  const state = presentationStateForWrite(scene, stateId)
  if (!state) return
  const override = state.layerItemOverrides[layerItemId] ?? {}
  if (value === base.playbackInitialVisibility) delete override.playbackInitialVisibility
  else override.playbackInitialVisibility = value
  state.layerItemOverrides[layerItemId] = override
  deleteEmptyOverride(state.layerItemOverrides, layerItemId)
}

function configFromSimpleRule(rule: InteractionRule): SlideSimpleEntranceAnimationConfig | null {
  const step = rule.actions[0]
  if (!step || !isNodeMotionAction(step.action) || step.action.type !== 'node.enter') return null
  if (step.action.effect === 'none') return null
  return {
    effect: step.action.effect,
    ...(step.action.effect === 'slide' ? { direction: step.action.direction } : {}),
    durationMs: step.action.durationMs,
    delayMs: step.delayMs,
  }
}

export function readSlideSceneInteractions(
  session: SlideAuthoringSession,
): readonly InteractionRule[] {
  const { scene } = slideSceneContext(session.history.present, session)
  return scene.interactions
}

export function readSlideSimpleEntranceAnimation(
  session: SlideAuthoringSession,
  layerItemId: string,
): SlideSimpleEntranceAnimationConfig | null {
  const { scene } = slideSceneContext(session.history.present, session)
  const rule = findSimpleEntranceRule(scene.interactions, layerItemId, session.selection.stateId)
  return rule ? configFromSimpleRule(rule) : null
}

export function slideSimpleEntrancePreviewRequest(
  session: SlideAuthoringSession,
  layerItemId: string,
): SlideEntrancePreviewRequest | null {
  const { scene } = slideSceneContext(session.history.present, session)
  const rule = findSimpleEntranceRule(scene.interactions, layerItemId, session.selection.stateId)
  const step = rule?.actions[0]
  if (!step || !isNodeMotionAction(step.action) || step.action.type !== 'node.enter') return null
  return {
    action: structuredClone(step.action),
    delayMs: step.delayMs,
  }
}

export function setSlideSimpleEntranceAnimation(
  session: SlideAuthoringSession,
  layerItemId: string,
  config: SlideSimpleEntranceAnimationConfig | null,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const layer = requireUnlockedSceneLayer(session, layerItemId)
    const { scene } = slideSceneContext(session.history.present, session)
    const stateId = session.selection.stateId
    if (config && hasAdvancedEntranceAnimation(scene.interactions, layerItemId, stateId)) {
      throw new Error('该元素已有专业动画规则。请切换到专业模式编辑，避免重复播放。')
    }
    const existing = findSimpleEntranceRule(scene.interactions, layerItemId, stateId)
    if (!config && !existing) return succeed(session, false)
    if (config && existing) {
      const current = configFromSimpleRule(existing)
      if (current && sameJson(current, {
        effect: config.effect,
        ...(config.effect === 'slide' ? { direction: config.direction ?? 'left' } : {}),
        durationMs: Math.min(10_000, Math.max(0, config.durationMs)),
        delayMs: Math.min(60_000, Math.max(0, config.delayMs)),
      })) {
        return succeed(session, false)
      }
    }
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene: draftScene } = slideSceneContext(draft, session)
      const rules = draftScene.interactions
      const current = findSimpleEntranceRule(rules, layerItemId, stateId)
      if (config) {
        const action = simpleEntranceAction(layerItemId, config)
        const delayMs = Math.min(60_000, Math.max(0, config.delayMs))
        if (current) {
          const index = rules.findIndex((rule) => rule.id === current.id)
          const present = rules[index]!
          rules[index] = {
            ...present,
            name: `${layer.item.label} · 出现动画`.slice(0, 80),
            enabled: true,
            actions: [{
              ...present.actions[0]!,
              delayMs,
              action,
            }],
          }
        } else {
          rules.push({
            id: `simple_entrance_${nanoid()}`,
            name: `${layer.item.label} · 出现动画`.slice(0, 80),
            enabled: true,
            trigger: { type: 'node.activated', nodeId: layerItemId },
            conditions: stateId === null
              ? []
              : [{ type: 'presentation.in', stateIds: [stateId] }],
            actions: [{
              id: `action_${nanoid()}`,
              start: 'after-previous',
              delayMs,
              action,
            }],
          })
        }
        setPlaybackInitialVisibility(draftScene, stateId, layerItemId, 'hidden')
        return
      }
      draftScene.interactions = withoutDanglingAnimationCompletionRules(
        rules.filter((rule) => rule.id !== current?.id),
      )
      if (!draftScene.interactions.some((rule) =>
        entranceRuleAppliesToState(rule, layerItemId, stateId)
      )) {
        setPlaybackInitialVisibility(draftScene, stateId, layerItemId, 'inherit')
      }
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function upsertSlideInteractionRule(
  session: SlideAuthoringSession,
  rule: InteractionRule,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const parsed = interactionRuleSchema.parse(structuredClone(rule))
    const { scene } = slideSceneContext(session.history.present, session)
    const index = scene.interactions.findIndex((candidate) => candidate.id === parsed.id)
    if (index >= 0 && sameJson(scene.interactions[index], parsed)) {
      return succeed(session, false)
    }
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene: draftScene } = slideSceneContext(draft, session)
      const currentIndex = draftScene.interactions.findIndex(
        (candidate) => candidate.id === parsed.id,
      )
      if (currentIndex >= 0) draftScene.interactions[currentIndex] = structuredClone(parsed)
      else draftScene.interactions.push(structuredClone(parsed))
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function removeSlideInteractionRule(
  session: SlideAuthoringSession,
  ruleId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const { scene } = slideSceneContext(session.history.present, session)
    if (!scene.interactions.some((rule) => rule.id === ruleId)) return succeed(session, false)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene: draftScene } = slideSceneContext(draft, session)
      draftScene.interactions = withoutDanglingAnimationCompletionRules(
        draftScene.interactions.filter((rule) => rule.id !== ruleId),
      )
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function readSlideLayerView(
  session: SlideAuthoringSession,
  layerItemId: string,
): SlideEditorLayerView {
  return sceneLayerView(session, layerItemId)
}

export function readSlideNativeLayer(
  session: SlideAuthoringSession,
  layerItemId: string,
): NativeLayerItem {
  const layer = sceneLayerView(session, layerItemId)
  if (layer.item.kind !== 'native') throw new Error('当前选择不是原生图层')
  return structuredClone(layer.item) as NativeLayerItem
}

export function readSlideComponentLayer(
  session: SlideAuthoringSession,
  layerItemId: string,
): ComponentLayerItem {
  const layer = sceneLayerView(session, layerItemId)
  if (layer.item.kind !== 'component') throw new Error('当前元素不是复用组件')
  return structuredClone(layer.item) as ComponentLayerItem
}

export function readSlideRuntimeLayer(
  session: SlideAuthoringSession,
  layerItemId: string,
): RuntimeLayerItem {
  const layer = sceneLayerView(session, layerItemId)
  if (layer.item.kind !== 'runtime') throw new Error('找不到当前动态内容层')
  return structuredClone(layer.item) as RuntimeLayerItem
}

function slideResultFromLayerCommand(
  session: SlideAuthoringSession,
  result: LayerCommandResult,
  nextSelectionIds?: readonly string[],
): SlideCommandResult {
  if (!result.ok || !result.nextDocument) {
    return {
      ok: false,
      reason: result.reason,
      historyEntry: false,
      nextSession: session,
      selection: session.selection,
    }
  }
  const nextHistory = result.historyEntry
    ? commitSlideAuthoringHistory(session.history, result.nextDocument)
    : {
        present: result.nextDocument,
        past: session.history.past,
        future: session.history.future,
      }
  const nextSelection = nextSelectionIds
    ? selectSlideEditorLayers({
        project: result.nextDocument,
        locationId: session.selection.locationId,
        stateId: session.selection.stateId,
        selectionIds: [...nextSelectionIds],
      })
    : session.selection
  return {
    ok: true,
    reason: result.reason,
    historyEntry: Boolean(result.historyEntry),
    nextSession: {
      ...session,
      history: nextHistory,
      selection: nextSelection,
    },
    selection: nextSelection,
  }
}

/**
 * Applies one or more effective-layer property patches and folds them into the
 * current Slide session. Callers that also write native content should run this
 * inside `coalesceSlideAuthoringCommands` so one gesture is one history entry.
 */
export function patchSlideEffectiveLayerProperties(
  session: SlideAuthoringSession,
  updates: readonly EffectiveLayerPropertyUpdate[],
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  return slideResultFromLayerCommand(
    session,
    patchEffectiveLayerItems(session.history.present, updates, {
      expectedRevision: options.expectedRevision ?? session.history.present.revision,
      now: options.now,
    }),
  )
}

/**
 * Applies one complete Properties submit to the exact Slide target captured
 * when that editor was rendered. This deliberately does not reuse the batch
 * command: named-state property editing needs one sparse override transaction,
 * while a stale focused control must never be rebound to the current selection.
 */
export function patchSlideLayerPropertiesAtTarget(
  session: SlideAuthoringSession,
  target: SlideAuthoringTarget,
  patch: EffectiveLayerPropertiesPatchAtTarget,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(
    session,
    options.expectedRevision ?? target.revision,
  )
  if (stale) return stale
  if (
    target.sessionId !== session.sessionId
    || target.generation !== session.generation
    || target.scope !== session.scope
    || session.selection.selectionIds.length !== 1
    || session.selection.selectionIds[0] !== target.layerItemId
  ) {
    return reject(session, SLIDE_REJECT_STALE_REVISION)
  }
  try {
    const currentTarget = makeSlideAuthoringTarget(
      session,
      target.layerItemId,
      'item',
    )
    if (
      currentTarget.authoringAddress !== target.authoringAddress
      || currentTarget.scope !== target.scope
      || currentTarget.layerItemId !== target.layerItemId
    ) {
      return reject(session, SLIDE_REJECT_WRONG_OWNER)
    }
    return slideResultFromLayerCommand(
      session,
      patchEffectiveLayerPropertiesAtTarget(
        session.history.present,
        {
          authoringAddress: target.authoringAddress,
          locationId: session.selection.locationId,
          stateId: session.selection.stateId,
        },
        patch,
        {
          expectedRevision: target.revision,
          now: options.now,
        },
      ),
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

export type SlideMultiLayerPropertiesIntent =
  | { readonly kind: 'set-visible'; readonly visible: boolean }
  | { readonly kind: 'set-locked'; readonly locked: boolean }
  | {
      readonly kind: 'align'
      readonly mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
    }
  | { readonly kind: 'distribute'; readonly axis: 'horizontal' | 'vertical' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'delete' }

function exactSlideMultiLayers(
  session: SlideAuthoringSession,
  targets: readonly SlideAuthoringTarget[],
):
  | { readonly kind: 'layers'; readonly layers: readonly SlideEditorLayerView[] }
  | { readonly kind: 'error'; readonly result: SlideCommandResult } {
  const selectedIds = session.selection.selectionIds
  if (
    targets.length < 2
    || targets.length !== selectedIds.length
    || new Set(targets.map((target) => target.layerItemId)).size !== targets.length
    || targets.some((target, index) => (
      target.layerItemId !== selectedIds[index]
      || target.sessionId !== session.sessionId
      || target.revision !== session.history.present.revision
      || target.generation !== session.generation
      || target.scope !== session.scope
    ))
  ) {
    return { kind: 'error', result: reject(session, SLIDE_REJECT_STALE_REVISION) }
  }
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layersById = new Map(view.layers.map((layer) => [layer.selectionId, layer]))
  const layers: SlideEditorLayerView[] = []
  for (const target of targets) {
    const current = makeSlideAuthoringTarget(session, target.layerItemId, 'item')
    const layer = layersById.get(target.layerItemId)
    if (
      !layer
      || current.authoringAddress !== target.authoringAddress
      || current.scope !== target.scope
    ) {
      return { kind: 'error', result: reject(session, SLIDE_REJECT_WRONG_OWNER) }
    }
    layers.push(layer)
  }
  return { kind: 'layers', layers }
}

function slideMultiFramePatches(
  layers: readonly SlideEditorLayerView[],
  intent: Extract<SlideMultiLayerPropertiesIntent, { kind: 'align' | 'distribute' }>,
): Map<string, { readonly x: number; readonly y: number }> {
  const unlocked = layers.filter((layer) => !layer.item.locked)
  const minimum = intent.kind === 'distribute' ? 3 : 2
  if (unlocked.length < minimum) return new Map()
  const boundsById = new Map(unlocked.map((layer) => [
    layer.selectionId,
    rotatedRectangleAabb({
      x: layer.item.frame.x,
      y: layer.item.frame.y,
      width: layer.item.frame.width,
      height: layer.item.frame.height,
      rotation: layer.item.rotation,
    }),
  ]))
  if (intent.kind === 'distribute') {
    const horizontal = intent.axis === 'horizontal'
    const sorted = [...unlocked].sort((left, right) => {
      const leftBounds = boundsById.get(left.selectionId)!
      const rightBounds = boundsById.get(right.selectionId)!
      return horizontal
        ? leftBounds.left - rightBounds.left
        : leftBounds.top - rightBounds.top
    })
    const first = boundsById.get(sorted[0]!.selectionId)!
    const last = boundsById.get(sorted.at(-1)!.selectionId)!
    const span = horizontal ? last.right - first.left : last.bottom - first.top
    const totalSize = sorted.reduce((sum, layer) => {
      const bounds = boundsById.get(layer.selectionId)!
      return sum + (horizontal ? bounds.width : bounds.height)
    }, 0)
    const gap = (span - totalSize) / (sorted.length - 1)
    let cursor = horizontal ? first.left : first.top
    const translations = new Map<string, number>()
    for (const layer of sorted) {
      const bounds = boundsById.get(layer.selectionId)!
      const current = horizontal ? bounds.left : bounds.top
      translations.set(layer.selectionId, cursor - current)
      cursor += (horizontal ? bounds.width : bounds.height) + gap
    }
    return new Map(unlocked.map((layer) => {
      const delta = translations.get(layer.selectionId) ?? 0
      return [layer.selectionId, {
        x: layer.item.frame.x + (horizontal ? delta : 0),
        y: layer.item.frame.y + (horizontal ? 0 : delta),
      }]
    }))
  }
  const bounds = [...boundsById.values()]
  const left = Math.min(...bounds.map((item) => item.left))
  const right = Math.max(...bounds.map((item) => item.right))
  const top = Math.min(...bounds.map((item) => item.top))
  const bottom = Math.max(...bounds.map((item) => item.bottom))
  return new Map(unlocked.map((layer) => {
    const visual = boundsById.get(layer.selectionId)!
    let dx = 0
    let dy = 0
    if (intent.mode === 'left') dx = left - visual.left
    else if (intent.mode === 'center') dx = (left + right) / 2 - visual.centerX
    else if (intent.mode === 'right') dx = right - visual.right
    else if (intent.mode === 'top') dy = top - visual.top
    else if (intent.mode === 'middle') dy = (top + bottom) / 2 - visual.centerY
    else dy = bottom - visual.bottom
    return [layer.selectionId, {
      x: layer.item.frame.x + dx,
      y: layer.item.frame.y + dy,
    }]
  }))
}

/**
 * Executes one Properties multi-selection gesture against the exact captured
 * Slide selection. Validation happens before planning, and every property
 * patch is committed by one Course document transaction.
 */
export function commitSlideMultiLayerIntentAtTargets(
  session: SlideAuthoringSession,
  input: {
    readonly targets: readonly SlideAuthoringTarget[]
    readonly intent: SlideMultiLayerPropertiesIntent
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(
    session,
    options.expectedRevision ?? input.targets[0]?.revision,
  )
  if (stale) return stale
  try {
    const exact = exactSlideMultiLayers(session, input.targets)
    if (exact.kind === 'error') return exact.result
    const ids = input.targets.map((target) => target.layerItemId)
    if (input.intent.kind === 'duplicate') {
      if (session.scope === 'scene') {
        return duplicateSlideSceneLayers(session, ids, options)
      }
      if (session.scope === 'global') {
        return duplicateSlideGlobalLayers(session, ids, options)
      }
      return reject(session, '当前表面多选复制尚未形成完整引用事务。')
    }
    if (input.intent.kind === 'delete') {
      if (session.scope === 'scene') return deleteSlideSceneLayers(session, ids, options)
      return slideResultFromLayerCommand(
        session,
        deleteEffectiveLayerItems(
          session.history.present,
          input.targets.map((target) => ({
            authoringAddress: target.authoringAddress,
            locationId: session.selection.locationId,
            stateId: session.selection.stateId,
          })),
          {
            expectedRevision: session.history.present.revision,
            now: options.now,
          },
        ),
        [],
      )
    }
    const framePatches = input.intent.kind === 'align' || input.intent.kind === 'distribute'
      ? slideMultiFramePatches(exact.layers, input.intent)
      : null
    const updates = exact.layers.flatMap((layer, index) => {
      let patch: EffectiveLayerPropertiesPatchAtTarget | null = null
      if (input.intent.kind === 'set-visible') {
        if (!layer.item.locked) patch = { visible: input.intent.visible }
      } else if (input.intent.kind === 'set-locked') {
        if (!layer.item.locked || input.intent.locked === false) {
          patch = { locked: input.intent.locked }
        }
      } else {
        const frame = framePatches?.get(layer.selectionId)
        if (frame) patch = { frame }
      }
      if (!patch) return []
      const target = input.targets[index]!
      return [{
        target: {
          authoringAddress: target.authoringAddress,
          locationId: session.selection.locationId,
          stateId: session.selection.stateId,
        },
        patch,
      }]
    })
    return slideResultFromLayerCommand(
      session,
      patchEffectiveLayerPropertiesAtTargets(
        session.history.present,
        updates,
        {
          expectedRevision: session.history.present.revision,
          now: options.now,
        },
      ),
    )
  } catch (error) {
    return catchCommand(session, error)
  }
}

/**
 * Runs sequential Slide session commands and keeps a single document history
 * frame against the original session, so one user submit cannot split undo.
 */
export function coalesceSlideAuthoringCommands(
  session: SlideAuthoringSession,
  run: (current: SlideAuthoringSession) => SlideCommandResult,
): SlideCommandResult {
  const result = run(session)
  if (!result.ok) return result
  const next = result.nextSession ?? session
  if (next.history.present === session.history.present) {
    return {
      ok: true,
      reason: result.reason,
      historyEntry: false,
      nextSession: next,
      selection: next.selection,
    }
  }
  return {
    ok: true,
    reason: result.reason,
    historyEntry: true,
    nextSession: {
      ...next,
      history: commitSlideAuthoringHistory(session.history, next.history.present),
    },
    selection: next.selection,
  }
}

export { makeSlideAuthoringTarget }

export {
  addSlideTableLayer,
  patchSlideTableCellText,
  patchSlideTableStyle,
  patchSlideTableCellStyle,
  patchSlideTableRowHeight,
  patchSlideTableColumnWidth,
  insertSlideTableRow,
  deleteSlideTableRow,
  reorderSlideTableRows,
  insertSlideTableColumn,
  deleteSlideTableColumn,
  reorderSlideTableColumns,
  commitSlideTableLastCellAndAppendRow,
  type AddSlideTableLayerInput,
  type CommitSlideTableLastCellAndAppendRowInput,
  type CommitSlideTableLastCellAndAppendRowResult,
} from './v9TableCommands'

export {
  addSlideChartLayer,
  patchSlideChartTitle,
  patchSlideChartStyle,
  patchSlideChartType,
  patchSlideChartPointValue,
  insertSlideChartCategory,
  deleteSlideChartCategory,
  reorderSlideChartCategories,
  insertSlideChartSeries,
  deleteSlideChartSeries,
  reorderSlideChartSeries,
  replaceSlideChartTableData,
  type AddSlideChartLayerInput,
  type SlideChartCandidateData,
} from './v9ChartCommands'
