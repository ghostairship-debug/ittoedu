import { nanoid } from 'nanoid'
import { CANVAS_HEIGHT, CANVAS_WIDTH, MAX_SCENE_NODES } from '../../shared/constants'
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
import type { ShapeType } from '../../shared/projectTypes'
import {
  createExternalComponentNode,
  createFormulaNode,
  createImageNode,
  createShapeNode,
  createTextNode,
  createVideoNode,
} from '../project/createProject'
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
} from './slideAuthoringBackend'
import { allocateCourseLayerOrder } from './globalLayerCommands'

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
    if (!sameJson(base[key], next[key]) && Object.prototype.hasOwnProperty.call(next, key)) {
      diff[key] = structuredClone(next[key])
    }
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
    requireSceneScope(session)
    const { scene } = slideSceneContext(session.history.present, session)
    const node = offsetDefaultSlideInsertion(
      createTextNode({
        id: stableId('text', input.id),
        name: input.label ?? '文本',
        text: input.text ?? '双击编辑文字',
        x: input.x,
        y: input.y,
      }),
      scene.layerItems.length,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const next = slideSceneContext(draft, session)
      appendSceneLayer(draft, next.scene, structuredClone(item), session.selection.stateId)
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
    requireSceneScope(session)
    const { scene } = slideSceneContext(session.history.present, session)
    const node = offsetDefaultSlideInsertion(
      createFormulaNode({
        id: stableId('formula', input.id),
        name: input.label ?? '公式',
        x: input.x,
        y: input.y,
      }),
      scene.layerItems.length,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const next = slideSceneContext(draft, session)
      appendSceneLayer(draft, next.scene, structuredClone(item), session.selection.stateId)
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
    requireSceneScope(session)
    const { scene } = slideSceneContext(session.history.present, session)
    const node = offsetDefaultSlideInsertion(
      createShapeNode(input.shapeType, {
        id: stableId('shape', input.id),
        ...(input.label === undefined ? {} : { name: input.label }),
        x: input.x,
        y: input.y,
      }),
      scene.layerItems.length,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const next = slideSceneContext(draft, session)
      appendSceneLayer(draft, next.scene, structuredClone(item), session.selection.stateId)
    }, options.now)
    return commitAdded(session, project, node.id)
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
    const { scene } = slideSceneContext(session.history.present, session)
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
      scene.layerItems.length,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const next = slideSceneContext(draft, session)
      appendSceneLayer(draft, next.scene, structuredClone(item), session.selection.stateId)
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
    requireSceneScope(session)
    requireAsset(session.history.present, input.assetId, 'video')
    const { scene } = slideSceneContext(session.history.present, session)
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
      scene.layerItems.length,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const next = slideSceneContext(draft, session)
      appendSceneLayer(draft, next.scene, structuredClone(item), session.selection.stateId)
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
    requireSceneScope(session)
    const embedded = session.history.present.componentPackages[input.packageId]
    if (!embedded) throw new Error(`组件包未嵌入工程：${input.packageId}`)
    const manifest = input.manifest
    if (manifest && manifest.id !== input.packageId) {
      throw new Error('组件清单 ID 与工程嵌入包不一致')
    }
    if (manifest && !componentSupportsScope(manifest, 'scene')) {
      throw new Error('该组件不支持场景层')
    }
    const preset = input.presetId
      ? manifest?.presets?.find((candidate) => candidate.id === input.presetId)
      : undefined
    if (input.presetId && !preset) throw new Error('组件预设不存在')
    const props = preset && manifest
      ? resolveComponentPresetProps(manifest, preset)
      : structuredClone(input.props ?? manifest?.defaultProps ?? {})
    const { scene } = slideSceneContext(session.history.present, session)
    const node = offsetDefaultSlideInsertion(
      createExternalComponentNode({
        id: stableId('component', input.id),
        name: input.label ?? preset?.label ?? manifest?.name ?? embedded.name,
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
      scene.layerItems.length,
      input.x !== undefined || input.y !== undefined,
    )
    const item = sceneNodeToCourseLayerItem(node)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const next = slideSceneContext(draft, session)
      appendSceneLayer(draft, next.scene, structuredClone(item), session.selection.stateId)
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

function findSimpleEntranceRule(
  rules: readonly InteractionRule[],
  nodeId: string,
  stateId: string | null,
): InteractionRule | undefined {
  return rules.find((rule) => simpleEntranceRuleMatchesState(rule, nodeId, stateId))
}

function hasAdvancedEntranceAnimation(
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

export { makeSlideAuthoringTarget }
