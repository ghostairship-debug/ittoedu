import { CANVAS_HEIGHT, CANVAS_WIDTH, MAX_SCENE_NODES, MIN_NODE_SIZE } from '../../shared/constants'
import { formulaAstToAccessibleText } from '../../shared/formulaLinear'
import {
  applyComponentVariant,
  resolveComponentPresetProps,
  setComponentPropValue,
} from '../../shared/componentProps'
import { componentSupportsScope } from '../../shared/componentCapabilities'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import type { ComponentManifest } from '../../shared/componentTypes'
import type { FormulaAstNode, ShapeType } from '../../shared/projectTypes'
import type {
  ComponentLayerItem,
  CourseProjectDocument,
  CourseRuntimeDefinition,
  FlowBlock,
  FlowComponentBlock,
  FlowMediaBlock,
  LayerItem,
  LocationVisibility,
  NativeLayerItem,
  RuntimeLayerItem,
} from '../../shared/courseProjectTypes'
import {
  createExternalComponentNode,
  createImageNode,
  createShapeNode,
  createVideoNode,
} from '../project/createProject'
import {
  locateCourseLayer,
  makeEffectiveLayerAuthoringAddress,
  patchEffectiveLayerItem,
} from './effectiveLayerCommands'
import {
  FLOW_GLOBAL_STRUCTURE_REASON,
  findFlowBlockRecursive,
  flowSurfaceIn,
  removeBlocksById,
  repairFlowReferences,
  stableFlowId,
  syncFlowCourseLocations,
  walkFlowBlocks,
} from './flowDocumentModel'
import {
  executeFlowDelete,
  insertFlowEditorBlock,
  updateFlowEditorBlock,
  type FlowCommandOptions,
  type FlowCommandResult,
} from './flowEditorCommands'
import {
  classifyFlowDeleteIntent,
  selectFlowEditorBlock,
  selectFlowGlobalScope,
  selectFlowOverlay,
  type FlowEditorSelection,
} from './flowEditorSlice'
import {
  projectFlowUnifiedOverlays,
  teacherControllerOverlayPlacement,
} from './flowOverlayProjection'
import {
  allocateCourseLayerOrder,
  isTeacherControllerLayerItem,
  LAYER_REJECT_LOCKED,
  lockedLayerWriteReason,
  refuseLockedLayerWrite,
  rejectIfStaleDocument,
  setGlobalLayerVisibleAtLocation,
  sortAllCourseLayerLists,
  validateLocationVisibilitySpec,
  visibilityAfterTogglingLocation,
  type LayerCommandOptions,
  type LayerCommandResult,
} from './globalLayerCommands'
import { commitCourseProjectMutation } from './courseProjectMutation'

export const FLOW_NO_PAGE_REASON = '请先选择一个流式页面'
export { FLOW_GLOBAL_STRUCTURE_REASON }
export const FLOW_EMPTY_ASSET_REASON = '请先选择要插入的图片、视频或声音'
export const FLOW_AUDIO_OVERLAY_REASON = '声音没有页面浮层形态，请插入文中媒体块'
export const FLOW_DOCUMENT_LAYER_REASON = '普通正文块不能写入图层'
export const FLOW_MEDIA_ONLY_CONVERT_REASON = '只有文中图片、视频或声音可以改为浮层'
export const FLOW_EMBED_COMPONENT_FALLBACK_REASON = '组件嵌入正文需要静态回退图'
export const FLOW_RUNTIME_EMBED_REASON = '动态内容不能嵌入为文档块'
export const FLOW_SHAPE_EMBED_REASON = '图形在 Flow 中没有文档块，只能作为页面浮层'
export const FLOW_CONTROLLER_EMBED_REASON = '教师控制器是视口浮层，不能嵌入正文'
export const FLOW_CONTROLLER_NOT_FOOTER_REASON = '教师控制器是视口浮层，不是文档流页脚'
export const FLOW_PARAGRAPH_INTERACTION_REASON = '文档段落不做画布入场动画'
export const FLOW_NO_COMPONENT_PACKAGE_REASON = '组件包未嵌入工程'
export const FLOW_COMPONENT_SCOPE_REASON = '该组件不支持当前作者范围'
export const FLOW_GLOBAL_ITEM_EMBED_REASON = '全局层内容不能嵌入 Flow 正文'
export const FLOW_NO_OVERLAY_REASON = '没有可转换的浮层'
export const FLOW_EMPTY_PACKAGE_REASON = '请先选择要插入的组件'

export type FlowSharedOwnership = 'document-block' | 'viewport-overlay'
export type FlowMediaInsertPlacement = FlowSharedOwnership
export type FlowComponentInsertPlacement = FlowSharedOwnership

export interface FlowSharedAuthoringResult {
  readonly ok: boolean
  readonly reason?: string
  readonly nextDocument?: CourseProjectDocument
  readonly historyEntry?: boolean
  readonly selection?: FlowEditorSelection
  readonly createdBlockIds?: readonly string[]
  readonly createdLayerItemIds?: readonly string[]
  readonly ownership?: FlowSharedOwnership
}

export interface FlowMediaInsertRequest {
  readonly assetId?: string
  readonly placement?: FlowMediaInsertPlacement
  readonly altKey?: boolean
  readonly menuAction?: 'insert-document' | 'insert-overlay'
  readonly altText?: string
  readonly caption?: string
  readonly id?: string
}

export interface FlowComponentInsertRequest {
  readonly packageId?: string
  readonly placement?: FlowComponentInsertPlacement
  readonly menuAction?: 'insert-overlay' | 'embed-document'
  readonly version?: string
  readonly props?: Record<string, unknown>
  readonly presetId?: string
  readonly variantId?: string
  readonly manifest?: ComponentManifest
  readonly staticFallbackAssetId?: string
  readonly label?: string
  readonly nestedPath?: string
  readonly nestedValue?: unknown
  readonly id?: string
}

export interface FlowRuntimeInsertRequest {
  readonly placement?: FlowSharedOwnership
  readonly label?: string
  readonly runtime?: CourseRuntimeDefinition
  readonly id?: string
}

export interface FlowShapeInsertRequest {
  readonly shapeType: ShapeType
  readonly label?: string
  readonly id?: string
}

function fail(reason: string): FlowSharedAuthoringResult {
  return { ok: false, reason, historyEntry: false }
}

function fromFlowCommand(
  result: FlowCommandResult,
  extra: Partial<FlowSharedAuthoringResult> = {},
): FlowSharedAuthoringResult {
  return {
    ok: result.ok,
    reason: result.reason,
    nextDocument: result.nextDocument,
    historyEntry: result.historyEntry,
    selection: result.selection,
    createdBlockIds: result.createdBlockIds,
    ...extra,
  }
}

function fromLayer(
  result: LayerCommandResult,
  extra: Partial<FlowSharedAuthoringResult> = {},
): FlowSharedAuthoringResult {
  const reason = result.reason === LAYER_REJECT_LOCKED
    ? lockedLayerWriteReason()
    : result.reason
  return {
    ok: result.ok,
    reason,
    nextDocument: result.nextDocument,
    historyEntry: result.historyEntry,
    createdLayerItemIds: result.createdLayerItemId ? [result.createdLayerItemId] : undefined,
    ...extra,
  }
}

function teacherLocked(item: LayerItem): FlowSharedAuthoringResult | null {
  const locked = refuseLockedLayerWrite(item, false)
  if (!locked) return null
  return fail(lockedLayerWriteReason())
}

function defaultSurfaceRuntime(): CourseRuntimeDefinition {
  return {
    protocol: 'surface-runtime',
    runtimeApiVersion: 3,
    enabled: true,
    renderMode: 'dom',
    source: 'CoursewareRuntime.define({ runtimeApiVersion: 3, protocol: "surface-runtime" })',
    content: { values: {} },
    assets: {},
  }
}

export function resolveFlowMediaInsertPlacement(input: {
  readonly altKey?: boolean
  readonly menuAction?: 'insert-document' | 'insert-overlay'
  readonly placement?: FlowMediaInsertPlacement
} = {}): FlowMediaInsertPlacement {
  if (input.placement) return input.placement
  if (input.menuAction === 'insert-overlay' || input.altKey) return 'viewport-overlay'
  return 'document-block'
}

export function resolveFlowComponentInsertPlacement(input: {
  readonly menuAction?: 'insert-overlay' | 'embed-document'
  readonly placement?: FlowComponentInsertPlacement
} = {}): FlowComponentInsertPlacement {
  if (input.placement) return input.placement
  if (input.menuAction === 'embed-document') return 'document-block'
  return 'viewport-overlay'
}

function requireFlowPage(
  document: CourseProjectDocument,
  selection: FlowEditorSelection | { locationId?: string },
): { ok: true; locationId: string; surfaceId: string } | FlowSharedAuthoringResult {
  const locationId = selection.locationId?.trim() ?? ''
  if (!locationId) return fail(FLOW_NO_PAGE_REASON)
  const location = document.locations.find((candidate) => candidate.id === locationId)
  if (!location) return fail(FLOW_NO_PAGE_REASON)
  if (location.kind !== 'flow-block') {
    return fail('当前课程位置不是 Flow 内容块，请重新选择')
  }
  try {
    flowSurfaceIn(document, location.surfaceId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : FLOW_NO_PAGE_REASON)
  }
  return { ok: true, locationId, surfaceId: location.surfaceId }
}

function resolveInsertAnchor(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  surfaceId: string,
): { parentId: string | null; index: number } {
  const surface = flowSurfaceIn(document, surfaceId)
  const location = document.locations.find((candidate) => candidate.id === selection.locationId)
  const preferredId = selection.selectedBlockId
    ?? (location && location.kind === 'flow-block' ? location.blockId : null)
    ?? null
  if (!preferredId) {
    return { parentId: null, index: surface.blocks.length }
  }
  const found = findFlowBlockRecursive(surface.blocks, preferredId)
  if (!found) return { parentId: null, index: surface.blocks.length }
  return { parentId: found.parentId, index: found.index + 1 }
}

function overlayDestination(
  selection: FlowEditorSelection,
  surfaceId: string,
): { source: 'global' | 'surface'; surfaceId: string } {
  return selection.authoringScope === 'global'
    ? { source: 'global', surfaceId }
    : { source: 'surface', surfaceId }
}

function appendOverlayItem(
  draft: CourseProjectDocument,
  destination: { source: 'global' | 'surface'; surfaceId: string },
  item: LayerItem,
): void {
  const ownerCount = destination.source === 'global'
    ? draft.globalLayerItems.length
    : flowSurfaceIn(draft, destination.surfaceId).surfaceLayerItems.length
  if (ownerCount >= MAX_SCENE_NODES) {
    throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
  }
  item.order = allocateCourseLayerOrder(draft, item.order)
  const scoped = { item, visibility: { mode: 'all' as const, locationIds: [] } }
  if (destination.source === 'global') {
    draft.globalLayerItems.push(scoped)
    sortAllCourseLayerLists(draft)
    return
  }
  flowSurfaceIn(draft, destination.surfaceId).surfaceLayerItems.push(scoped)
  sortAllCourseLayerLists(draft)
}

function mediaKindFromAsset(
  document: CourseProjectDocument,
  assetId: string,
): FlowMediaBlock['mediaKind'] | null {
  const kind = document.assets[assetId]?.kind
  if (kind === 'image' || kind === 'video' || kind === 'audio') return kind
  return null
}

function requireMediaAsset(
  document: CourseProjectDocument,
  assetId: string | undefined,
): { ok: true; assetId: string; mediaKind: FlowMediaBlock['mediaKind'] } | FlowSharedAuthoringResult {
  if (!assetId || assetId.trim() === '') return fail(FLOW_EMPTY_ASSET_REASON)
  const asset = document.assets[assetId]
  if (!asset) return fail(`找不到素材：${assetId}`)
  const mediaKind = mediaKindFromAsset(document, assetId)
  if (!mediaKind) return fail('该素材不能插入 Flow')
  return { ok: true, assetId, mediaKind }
}

function nativeMediaOverlay(
  document: CourseProjectDocument,
  input: { assetId: string; mediaKind: 'image' | 'video'; id?: string; label?: string },
): NativeLayerItem {
  const asset = document.assets[input.assetId]!
  if (input.mediaKind === 'image') {
    const node = createImageNode({
      id: stableFlowId('image', input.id),
      name: input.label ?? asset.filename ?? '图片',
      assetId: input.assetId,
      width: asset.width,
      height: asset.height,
      x: (CANVAS_WIDTH - (asset.width ?? 320)) / 2,
      y: (CANVAS_HEIGHT - (asset.height ?? 180)) / 2,
    })
    const item = sceneNodeToCourseLayerItem(node) as NativeLayerItem
    item.paperSpace = 'paper'
    return item
  }
  const node = createVideoNode({
    id: stableFlowId('video', input.id),
    name: input.label ?? asset.filename ?? '视频',
    assetId: input.assetId,
    width: asset.width ?? 640,
    height: asset.height ?? 360,
  })
  const item = sceneNodeToCourseLayerItem(node) as NativeLayerItem
  item.paperSpace = 'paper'
  return item
}

function runOverlayMutation(
  document: CourseProjectDocument,
  options: FlowCommandOptions,
  mutate: (draft: CourseProjectDocument) => string[],
  reason: string,
): FlowSharedAuthoringResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return fail(stale.reason ?? '版本已过期')
  try {
    let created: string[] = []
    const next = commitCourseProjectMutation(document, (draft) => {
      created = mutate(draft)
    }, options.now)
    return {
      ok: true,
      reason,
      nextDocument: next,
      historyEntry: true,
      createdLayerItemIds: created,
    }
  } catch (error) {
    return fail(error instanceof Error && error.message.trim() ? error.message : '无法完成插入')
  }
}

export function insertFlowSharedMedia(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  request: FlowMediaInsertRequest = {},
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  const asset = requireMediaAsset(document, request.assetId)
  if (!('assetId' in asset)) return asset
  const placement = resolveFlowMediaInsertPlacement(request)
  if (placement === 'document-block') {
    if (selection.authoringScope === 'global') return fail(FLOW_GLOBAL_STRUCTURE_REASON)
    const anchor = resolveInsertAnchor(document, selection, page.surfaceId)
    const inserted = insertFlowEditorBlock(document, {
      surfaceId: page.surfaceId,
      parentId: anchor.parentId,
      index: anchor.index,
      block: {
        id: request.id,
        type: 'media',
        assetId: asset.assetId,
        mediaKind: asset.mediaKind,
        layout: 'content-width',
        ...(request.altText ? { altText: request.altText } : {}),
        ...(request.caption ? { caption: request.caption } : {}),
      },
    }, options)
    const createdId = inserted.createdBlockIds?.[0]
    if (!inserted.ok || !inserted.nextDocument || !createdId) {
      return fromFlowCommand(inserted, { ownership: 'document-block' })
    }
    return {
      ...fromFlowCommand(inserted, {
        ownership: 'document-block',
        selection: selectFlowEditorBlock(inserted.nextDocument, page.locationId, createdId),
      }),
    }
  }
  if (asset.mediaKind === 'audio') return fail(FLOW_AUDIO_OVERLAY_REASON)
  const overlayMediaKind = asset.mediaKind
  const destination = overlayDestination(selection, page.surfaceId)
  const created = runOverlayMutation(document, options, (draft) => {
    const item = nativeMediaOverlay(draft, {
      assetId: asset.assetId,
      mediaKind: overlayMediaKind,
      id: request.id,
      label: request.caption,
    })
    appendOverlayItem(draft, destination, item)
    return [item.layerItemId]
  }, '已作为浮层添加')
  if (!created.ok || !created.nextDocument || !created.createdLayerItemIds?.[0]) return created
  const overlayId = created.createdLayerItemIds[0]
  return {
    ...created,
    ownership: 'viewport-overlay',
    selection: selectFlowOverlay(
      created.nextDocument,
      page.locationId,
      [overlayId],
      destination.source === 'global' ? 'global' : 'page',
    ),
  }
}

function resolveComponentProps(
  document: CourseProjectDocument,
  request: FlowComponentInsertRequest,
  packageId: string,
): { version: string; props: Record<string, unknown>; label: string } | FlowSharedAuthoringResult {
  const embedded = document.componentPackages[packageId]
  if (!embedded) return fail(`${FLOW_NO_COMPONENT_PACKAGE_REASON}：${packageId}`)
  const manifest = request.manifest
  if (manifest && manifest.id !== packageId) {
    return fail('组件清单 ID 与工程嵌入包不一致')
  }
  if (request.presetId && !manifest) return fail('应用组件预设需要组件清单')
  if (request.variantId && !manifest) return fail('应用组件变体需要组件清单')
  let props = structuredClone(request.props ?? manifest?.defaultProps ?? {})
  if (manifest && request.presetId) {
    props = resolveComponentPresetProps(manifest, request.presetId)
  } else if (manifest && request.variantId) {
    const variant = manifest.variants?.find((candidate) => candidate.id === request.variantId)
    if (!variant) return fail('组件变体不存在')
    props = applyComponentVariant(props, variant, manifest)
  }
  if (request.nestedPath) {
    props = setComponentPropValue(props, request.nestedPath, request.nestedValue)
  }
  return {
    version: request.version ?? embedded.version,
    props,
    label: request.label ?? manifest?.name ?? embedded.name,
  }
}

export function insertFlowSharedComponent(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  request: FlowComponentInsertRequest = {},
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  if (!request.packageId || request.packageId.trim() === '') return fail(FLOW_EMPTY_PACKAGE_REASON)
  const resolved = resolveComponentProps(document, request, request.packageId)
  if (!('version' in resolved)) return resolved
  const placement = resolveFlowComponentInsertPlacement(request)
  const overlayOwner = overlayDestination(selection, page.surfaceId)
  if (request.manifest) {
    const scope = overlayOwner.source === 'global' || selection.authoringScope === 'global'
      ? 'global'
      : 'scene'
    if (!componentSupportsScope(request.manifest, scope)) {
      return fail(FLOW_COMPONENT_SCOPE_REASON)
    }
  }
  if (placement === 'document-block') {
    if (selection.authoringScope === 'global') return fail(FLOW_GLOBAL_STRUCTURE_REASON)
    const fallback = request.staticFallbackAssetId?.trim()
    if (!fallback) return fail(FLOW_EMBED_COMPONENT_FALLBACK_REASON)
    if (!document.assets[fallback]) return fail(`找不到素材：${fallback}`)
    const anchor = resolveInsertAnchor(document, selection, page.surfaceId)
    const inserted = insertFlowEditorBlock(document, {
      surfaceId: page.surfaceId,
      parentId: anchor.parentId,
      index: anchor.index,
      block: {
        id: request.id,
        type: 'component',
        component: { packageId: request.packageId, version: resolved.version },
        props: resolved.props,
        staticFallbackAssetId: fallback,
      },
    }, options)
    const createdId = inserted.createdBlockIds?.[0]
    if (!inserted.ok || !inserted.nextDocument || !createdId) {
      return fromFlowCommand(inserted, { ownership: 'document-block' })
    }
    return fromFlowCommand(inserted, {
      ownership: 'document-block',
      selection: selectFlowEditorBlock(inserted.nextDocument, page.locationId, createdId),
    })
  }
  const created = runOverlayMutation(document, options, (draft) => {
    const node = createExternalComponentNode({
      id: stableFlowId('component', request.id),
      name: resolved.label,
      component: { packageId: request.packageId!, version: resolved.version },
      props: resolved.props,
    })
    const item = sceneNodeToCourseLayerItem(node) as ComponentLayerItem
    if (request.staticFallbackAssetId) {
      if (!draft.assets[request.staticFallbackAssetId]) {
        throw new Error(`找不到素材：${request.staticFallbackAssetId}`)
      }
      item.staticFallbackAssetId = request.staticFallbackAssetId
    }
    appendOverlayItem(draft, overlayOwner, item)
    return [item.layerItemId]
  }, '已作为页面浮层添加组件')
  if (!created.ok || !created.nextDocument || !created.createdLayerItemIds?.[0]) return created
  return {
    ...created,
    ownership: 'viewport-overlay',
    selection: selectFlowOverlay(
      created.nextDocument,
      page.locationId,
      [created.createdLayerItemIds[0]],
      overlayOwner.source === 'global' ? 'global' : 'page',
    ),
  }
}

export function insertFlowSharedRuntime(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  request: FlowRuntimeInsertRequest = {},
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  if (request.placement === 'document-block') return fail(FLOW_RUNTIME_EMBED_REASON)
  const destination = overlayDestination(selection, page.surfaceId)
  const created = runOverlayMutation(document, options, (draft) => {
    const runtime = structuredClone(request.runtime ?? defaultSurfaceRuntime())
    Object.values(runtime.assets).forEach((binding) => {
      if (!draft.assets[binding.assetId]) throw new Error(`找不到素材：${binding.assetId}`)
    })
    const width = 640
    const height = 360
    const item: RuntimeLayerItem = {
      layerItemId: stableFlowId('runtime', request.id),
      label: request.label ?? '动态内容',
      kind: 'runtime',
      frame: {
        mode: 'absolute',
        x: (CANVAS_WIDTH - width) / 2,
        y: (CANVAS_HEIGHT - height) / 2,
        width,
        height,
      },
      order: 0,
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      runtime,
    }
    appendOverlayItem(draft, destination, item)
    return [item.layerItemId]
  }, '已作为页面浮层添加动态内容')
  if (!created.ok || !created.nextDocument || !created.createdLayerItemIds?.[0]) return created
  return {
    ...created,
    ownership: 'viewport-overlay',
    selection: selectFlowOverlay(
      created.nextDocument,
      page.locationId,
      [created.createdLayerItemIds[0]],
      destination.source === 'global' ? 'global' : 'page',
    ),
  }
}

export function insertFlowSharedShape(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  request: FlowShapeInsertRequest,
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  const destination = overlayDestination(selection, page.surfaceId)
  const created = runOverlayMutation(document, options, (draft) => {
    const node = createShapeNode(request.shapeType, {
      id: stableFlowId('shape', request.id),
      name: request.label,
    })
    const item = sceneNodeToCourseLayerItem(node)
    appendOverlayItem(draft, destination, item)
    return [item.layerItemId]
  }, '已作为页面浮层添加图形')
  if (!created.ok || !created.nextDocument || !created.createdLayerItemIds?.[0]) return created
  return {
    ...created,
    ownership: 'viewport-overlay',
    selection: selectFlowOverlay(
      created.nextDocument,
      page.locationId,
      [created.createdLayerItemIds[0]],
      destination.source === 'global' ? 'global' : 'page',
    ),
  }
}

function selectedDocumentBlock(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  surfaceId: string,
  blockId = selection.selectedBlockId,
): { parentId: string | null; block: FlowBlock } | FlowSharedAuthoringResult {
  if (!blockId) return fail('没有可转换的文档块')
  const surface = flowSurfaceIn(document, surfaceId)
  const found = findFlowBlockRecursive(surface.blocks, blockId)
  if (!found) return fail(`找不到 Flow 块：${blockId}`)
  return { parentId: found.parentId, block: found.block }
}

export function convertFlowMediaBlockToOverlay(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  if (selection.authoringScope === 'global') return fail(FLOW_GLOBAL_STRUCTURE_REASON)
  const selected = selectedDocumentBlock(document, selection, page.surfaceId)
  if (!('block' in selected)) return selected
  if (selected.block.type !== 'media') return fail(FLOW_MEDIA_ONLY_CONVERT_REASON)
  if (selected.block.mediaKind === 'audio') return fail(FLOW_AUDIO_OVERLAY_REASON)
  const asset = requireMediaAsset(document, selected.block.assetId)
  if (!('assetId' in asset)) return asset
  const blockId = selected.block.id
  const created = runOverlayMutation(document, options, (draft) => {
    const surface = flowSurfaceIn(draft, page.surfaceId)
    const found = findFlowBlockRecursive(surface.blocks, blockId)
    if (!found || found.block.type !== 'media') throw new Error(FLOW_MEDIA_ONLY_CONVERT_REASON)
    if (found.block.mediaKind === 'audio') throw new Error(FLOW_AUDIO_OVERLAY_REASON)
    const item = nativeMediaOverlay(draft, {
      assetId: found.block.assetId,
      mediaKind: found.block.mediaKind,
      label: found.block.caption ?? found.block.altText,
    })
    surface.blocks = removeBlocksById(surface.blocks, new Set([blockId]))
    syncFlowCourseLocations(draft, page.surfaceId)
    repairFlowReferences(draft, new Set([blockId]))
    appendOverlayItem(draft, { source: 'surface', surfaceId: page.surfaceId }, item)
    return [item.layerItemId]
  }, '已改为页面浮层')
  if (!created.ok || !created.nextDocument || !created.createdLayerItemIds?.[0]) return created
  return {
    ...created,
    ownership: 'viewport-overlay',
    selection: selectFlowOverlay(
      created.nextDocument,
      page.locationId,
      [created.createdLayerItemIds[0]],
    ),
  }
}

export function convertFlowOverlayMediaToDocument(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  if (selection.authoringScope === 'global') return fail(FLOW_GLOBAL_ITEM_EMBED_REASON)
  const overlayId = selection.selectedOverlayIds[0]
  if (!overlayId) return fail(FLOW_NO_OVERLAY_REASON)
  const located = locateCourseLayer(document, overlayId)
  if (!located) return fail(`找不到浮层：${overlayId}`)
  if (located.source !== 'surface') return fail(FLOW_GLOBAL_ITEM_EMBED_REASON)
  const locked = teacherLocked(located.item)
  if (locked) return locked
  if (located.item.kind !== 'native') return fail('只有图片或视频浮层可以嵌入正文')
  const nativeType = located.item.content.nativeType
  if (nativeType !== 'image' && nativeType !== 'video') {
    if (nativeType === 'teacher-controller') return fail(FLOW_CONTROLLER_EMBED_REASON)
    if (nativeType === 'shape') return fail(FLOW_SHAPE_EMBED_REASON)
    return fail('该浮层不能嵌入正文')
  }
  const assetId = located.item.content.data.assetId
  const created = runOverlayMutation(document, options, (draft) => {
    const surface = flowSurfaceIn(draft, page.surfaceId)
    const index = surface.surfaceLayerItems.findIndex(
      (entry) => entry.item.layerItemId === overlayId,
    )
    if (index < 0) throw new Error(`找不到浮层：${overlayId}`)
    surface.surfaceLayerItems.splice(index, 1)
    const anchor = resolveInsertAnchor(draft, selection, page.surfaceId)
    const parentBlocks = anchor.parentId
      ? (() => {
        const section = findFlowBlockRecursive(surface.blocks, anchor.parentId)
        if (!section || section.block.type !== 'section') throw new Error(`找不到 Flow 分节：${anchor.parentId}`)
        return section.block.blocks
      })()
      : surface.blocks
    const blockId = stableFlowId('block')
    parentBlocks.splice(anchor.index, 0, {
      id: blockId,
      type: 'media',
      assetId,
      mediaKind: nativeType,
      caption: located.item.label,
      layout: 'content-width',
    })
    syncFlowCourseLocations(draft, page.surfaceId)
    return [blockId]
  }, '已嵌入正文')
  if (!created.ok || !created.nextDocument || !created.createdLayerItemIds?.[0]) {
    return created
  }
  const blockId = created.createdLayerItemIds[0]
  return {
    ok: true,
    reason: created.reason,
    nextDocument: created.nextDocument,
    historyEntry: true,
    createdBlockIds: [blockId],
    ownership: 'document-block',
    selection: selectFlowEditorBlock(created.nextDocument, page.locationId, blockId),
  }
}

export function convertFlowComponentBlockToOverlay(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  if (selection.authoringScope === 'global') return fail(FLOW_GLOBAL_STRUCTURE_REASON)
  const selected = selectedDocumentBlock(document, selection, page.surfaceId)
  if (!('block' in selected)) return selected
  if (selected.block.type !== 'component') {
    return fail('只有文中组件可以改为页面浮层')
  }
  const block = selected.block
  const created = runOverlayMutation(document, options, (draft) => {
    const surface = flowSurfaceIn(draft, page.surfaceId)
    const found = findFlowBlockRecursive(surface.blocks, block.id)
    if (!found || found.block.type !== 'component') throw new Error('只有文中组件可以改为页面浮层')
    const node = createExternalComponentNode({
      name: `组件·${found.block.component.packageId}`,
      component: { ...found.block.component },
      props: structuredClone(found.block.props),
    })
    const item = sceneNodeToCourseLayerItem(node) as ComponentLayerItem
    item.paperSpace = 'paper'
    item.staticFallbackAssetId = found.block.staticFallbackAssetId
    surface.blocks = removeBlocksById(surface.blocks, new Set([block.id]))
    syncFlowCourseLocations(draft, page.surfaceId)
    repairFlowReferences(draft, new Set([block.id]))
    appendOverlayItem(draft, { source: 'surface', surfaceId: page.surfaceId }, item)
    return [item.layerItemId]
  }, '已改为页面浮层')
  if (!created.ok || !created.nextDocument || !created.createdLayerItemIds?.[0]) return created
  return {
    ...created,
    ownership: 'viewport-overlay',
    selection: selectFlowOverlay(
      created.nextDocument,
      page.locationId,
      [created.createdLayerItemIds[0]],
    ),
  }
}

export function convertFlowOverlayComponentToDocument(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  if (selection.authoringScope === 'global') return fail(FLOW_GLOBAL_ITEM_EMBED_REASON)
  const overlayId = selection.selectedOverlayIds[0]
  if (!overlayId) return fail(FLOW_NO_OVERLAY_REASON)
  const located = locateCourseLayer(document, overlayId)
  if (!located) return fail(`找不到浮层：${overlayId}`)
  if (located.source !== 'surface') return fail(FLOW_GLOBAL_ITEM_EMBED_REASON)
  const locked = teacherLocked(located.item)
  if (locked) return locked
  if (located.item.kind === 'runtime') return fail(FLOW_RUNTIME_EMBED_REASON)
  if (located.item.kind !== 'component') return fail('只有组件浮层可以嵌入为文档块')
  const fallback = located.item.staticFallbackAssetId?.trim()
  if (!fallback) return fail(FLOW_EMBED_COMPONENT_FALLBACK_REASON)
  if (!document.assets[fallback]) return fail(`找不到素材：${fallback}`)
  const created = runOverlayMutation(document, options, (draft) => {
    const surface = flowSurfaceIn(draft, page.surfaceId)
    const index = surface.surfaceLayerItems.findIndex(
      (entry) => entry.item.layerItemId === overlayId,
    )
    if (index < 0) throw new Error(`找不到浮层：${overlayId}`)
    const item = surface.surfaceLayerItems[index]!.item
    if (item.kind !== 'component') throw new Error('只有组件浮层可以嵌入为文档块')
    surface.surfaceLayerItems.splice(index, 1)
    const anchor = resolveInsertAnchor(draft, selection, page.surfaceId)
    const parentBlocks = anchor.parentId
      ? (() => {
        const section = findFlowBlockRecursive(surface.blocks, anchor.parentId)
        if (!section || section.block.type !== 'section') throw new Error(`找不到 Flow 分节：${anchor.parentId}`)
        return section.block.blocks
      })()
      : surface.blocks
    const blockId = stableFlowId('block')
    const block: FlowComponentBlock = {
      id: blockId,
      type: 'component',
      component: { ...item.component },
      props: structuredClone(item.props),
      staticFallbackAssetId: fallback,
    }
    parentBlocks.splice(anchor.index, 0, block)
    syncFlowCourseLocations(draft, page.surfaceId)
    return [blockId]
  }, '已嵌入为文档块')
  if (!created.ok || !created.nextDocument || !created.createdLayerItemIds?.[0]) return created
  const blockId = created.createdLayerItemIds[0]
  return {
    ok: true,
    reason: created.reason,
    nextDocument: created.nextDocument,
    historyEntry: true,
    createdBlockIds: [blockId],
    ownership: 'document-block',
    selection: selectFlowEditorBlock(created.nextDocument, page.locationId, blockId),
  }
}

export function executeFlowSharedDelete(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  options: FlowCommandOptions & { direction?: 'backward' | 'forward' } = {},
): FlowSharedAuthoringResult {
  return fromFlowCommand(executeFlowDelete(document, selection, options))
}

export function classifyFlowSharedDelete(selection: FlowEditorSelection) {
  return classifyFlowDeleteIntent(selection)
}

export function classifyFlowSharedInteraction(selection: FlowEditorSelection): {
  readonly allowed: boolean
  readonly owner: 'overlay' | 'document' | 'none'
  readonly reason?: string
} {
  if (selection.focus === 'overlay') {
    return { allowed: true, owner: 'overlay' }
  }
  if (selection.focus === 'text' || selection.focus === 'block') {
    return {
      allowed: false,
      owner: 'document',
      reason: FLOW_PARAGRAPH_INTERACTION_REASON,
    }
  }
  return { allowed: false, owner: 'none', reason: '没有可绑定互动的选择' }
}

export function enterFlowGlobalAuthoring(
  document: CourseProjectDocument,
  locationId: string,
  overlayId?: string,
): { ok: true; selection: FlowEditorSelection } | FlowSharedAuthoringResult {
  const page = requireFlowPage(document, { locationId })
  if (!('surfaceId' in page)) return page
  try {
    return { ok: true, selection: selectFlowGlobalScope(document, locationId, overlayId) }
  } catch (error) {
    return fail(error instanceof Error ? error.message : FLOW_NO_PAGE_REASON)
  }
}

export function classifyFlowTeacherControllerRole(item: LayerItem): {
  readonly placement: 'viewport-overlay'
  readonly documentFooter: false
  readonly reason: typeof FLOW_CONTROLLER_NOT_FOOTER_REASON
} | { readonly placement: null } {
  if (!isTeacherControllerLayerItem(item) || !teacherControllerOverlayPlacement(item)) {
    return { placement: null }
  }
  return {
    placement: 'viewport-overlay',
    documentFooter: false,
    reason: FLOW_CONTROLLER_NOT_FOOTER_REASON,
  }
}

export function setFlowOverlayVisibleAtLocation(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  visible: boolean,
  options: LayerCommandOptions = {},
): FlowSharedAuthoringResult {
  const overlayId = selection.selectedOverlayIds[0]
  if (!overlayId) return fail('请先选择一个浮层或全局层项目')
  const located = locateCourseLayer(document, overlayId)
  if (!located) return fail(`找不到浮层：${overlayId}`)
  const locked = teacherLocked(located.item)
  if (locked) return locked
  if (located.source === 'global') {
    const target = {
      authoringAddress: makeEffectiveLayerAuthoringAddress(document.id, located),
      locationId: selection.locationId,
    }
    const result = setGlobalLayerVisibleAtLocation(document, target, visible, options)
    return fromLayer(result, { ownership: 'viewport-overlay' })
  }
  if (located.source !== 'surface' || !located.scoped) {
    return fail('只有页面或全局浮层可以设置逐页显隐')
  }
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return fail(stale.reason ?? '版本已过期')
  const currentlyVisible = located.scoped.visibility.mode === 'all'
    || (located.scoped.visibility.mode === 'include'
      ? located.scoped.visibility.locationIds.includes(selection.locationId)
      : !located.scoped.visibility.locationIds.includes(selection.locationId))
  if (currentlyVisible === visible) {
    return { ok: true, reason: '当前页显隐未变化', nextDocument: document, historyEntry: false }
  }
  try {
    const nextVisibility = validateLocationVisibilitySpec(
      document,
      visibilityAfterTogglingLocation(
        located.scoped.visibility,
        selection.locationId,
        visible,
        document.locations.map((location) => location.id),
      ),
    )
    const next = commitCourseProjectMutation(document, (draft) => {
      const surface = flowSurfaceIn(draft, located.surfaceId ?? selection.surfaceId)
      const entry = surface.surfaceLayerItems.find(
        (candidate) => candidate.item.layerItemId === overlayId,
      )
      if (!entry) throw new Error(`找不到浮层：${overlayId}`)
      entry.visibility = nextVisibility as LocationVisibility
    }, options.now)
    return {
      ok: true,
      reason: '已更新当前页显隐',
      nextDocument: next,
      historyEntry: true,
      ownership: 'viewport-overlay',
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : '无法更新当前页显隐')
  }
}

export function transformFlowOverlayFrame(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const overlayId = selection.selectedOverlayIds[0]
  if (!overlayId) return fail('请先选择一个浮层或全局层项目')
  const located = locateCourseLayer(document, overlayId)
  if (!located) return fail(`找不到浮层：${overlayId}`)
  if (located.source !== 'global' && located.source !== 'surface') {
    return fail('当前选择不是页面浮层')
  }
  if (isTeacherControllerLayerItem(located.item) && located.source !== 'global') {
    return fail(FLOW_CONTROLLER_EMBED_REASON)
  }
  const locked = teacherLocked(located.item)
  if (locked) return locked
  if (
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    frame.width < MIN_NODE_SIZE ||
    frame.height < MIN_NODE_SIZE
  ) {
    return fail('浮层尺寸无效')
  }
  const current = located.item.frame
  const unchanged =
    Math.abs(current.x - frame.x) < 0.01 &&
    Math.abs(current.y - frame.y) < 0.01 &&
    Math.abs(current.width - frame.width) < 0.01 &&
    Math.abs(current.height - frame.height) < 0.01
  if (unchanged) {
    return {
      ok: true,
      reason: '未变化',
      nextDocument: document,
      historyEntry: false,
      selection,
      ownership: 'viewport-overlay',
    }
  }
  const mutated = runOverlayMutation(document, options, (draft) => {
    const next = locateCourseLayer(draft, overlayId)
    if (!next || (next.source !== 'global' && next.source !== 'surface')) {
      throw new Error('找不到浮层')
    }
    if (isTeacherControllerLayerItem(next.item) && next.source !== 'global') {
      throw new Error(FLOW_CONTROLLER_EMBED_REASON)
    }
    next.item.frame = {
      mode: 'absolute',
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    }
    return []
  }, '已调整浮层位置')
  if (!mutated.ok) return mutated
  return {
    ...mutated,
    selection,
    ownership: 'viewport-overlay',
  }
}

export function patchFlowOverlayItem(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  patch: { readonly visible?: boolean; readonly locked?: boolean; readonly label?: string },
  options: LayerCommandOptions = {},
): FlowSharedAuthoringResult {
  const overlayId = selection.selectedOverlayIds[0]
  if (!overlayId) return fail('请先选择一个浮层或全局层项目')
  const located = locateCourseLayer(document, overlayId)
  if (!located) return fail(`找不到浮层：${overlayId}`)
  return fromLayer(patchEffectiveLayerItem(document, {
    authoringAddress: selection.authoringAddress || makeEffectiveLayerAuthoringAddress(document.id, located),
    locationId: selection.locationId,
  }, patch, options), { ownership: 'viewport-overlay' })
}

export function updateFlowOverlayComponentProps(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  props: Record<string, unknown>,
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const overlayId = selection.selectedOverlayIds[0]
  if (!overlayId) return fail('请先选择一个组件浮层')
  const located = locateCourseLayer(document, overlayId)
  if (!located || located.item.kind !== 'component') return fail('请先选择一个组件浮层')
  const locked = teacherLocked(located.item)
  if (locked) return locked
  const mutated = runOverlayMutation(document, options, (draft) => {
    const current = locateCourseLayer(draft, overlayId)
    if (!current || current.item.kind !== 'component') throw new Error('请先选择一个组件浮层')
    current.item.props = structuredClone(props)
    return []
  }, '已更新组件属性')
  if (!mutated.ok) return mutated
  return {
    ...mutated,
    selection,
    ownership: 'viewport-overlay',
  }
}

export function updateFlowDocumentComponentBlock(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  update: Partial<Pick<FlowComponentBlock, 'props'>> & { nestedPath?: string; nestedValue?: unknown },
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const page = requireFlowPage(document, selection)
  if (!('surfaceId' in page)) return page
  if (!selection.selectedBlockId) return fail('请先选择一个文中组件')
  const selected = selectedDocumentBlock(document, selection, page.surfaceId)
  if (!('block' in selected)) return selected
  if (selected.block.type !== 'component') return fail('请先选择一个文中组件')
  return fromFlowCommand(updateFlowEditorBlock(document, {
    surfaceId: page.surfaceId,
    blockId: selected.block.id,
    parentId: selected.parentId,
  }, (block) => {
    if (block.type !== 'component') throw new Error('请先选择一个文中组件')
    if (update.props) block.props = structuredClone(update.props)
    if (update.nestedPath) {
      block.props = setComponentPropValue(block.props, update.nestedPath, update.nestedValue)
    }
  }, options), { ownership: 'document-block' })
}

export function readFlowSharedOwnership(
  document: CourseProjectDocument,
  id: string,
): FlowSharedOwnership | 'unknown' {
  for (const surface of document.surfaces) {
    if (surface.type !== 'flow') continue
    let owned: FlowSharedOwnership | 'unknown' = 'unknown'
    walkFlowBlocks(surface.blocks, (block) => {
      if (block.id === id) owned = 'document-block'
    })
    if (owned !== 'unknown') return owned
  }
  const located = locateCourseLayer(document, id)
  if (located && (located.source === 'global' || located.source === 'surface')) {
    return 'viewport-overlay'
  }
  return 'unknown'
}

export function flowNodesTabOverlayIds(
  document: CourseProjectDocument,
  locationId: string,
): readonly string[] {
  return projectFlowUnifiedOverlays(document, locationId).nodesTabIds
}

export function commitFlowOverlayFormulaAst(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  ast: FormulaAstNode,
  accessibleText?: string,
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const overlayId = selection.selectedOverlayIds[0]
  if (!overlayId) return fail('请先选择一个公式浮层')
  const located = locateCourseLayer(document, overlayId)
  if (!located || located.item.kind !== 'native' || located.item.content.nativeType !== 'formula') {
    return fail('请先选择一个公式浮层')
  }
  const locked = teacherLocked(located.item)
  if (locked) return locked
  const mutated = runOverlayMutation(document, options, (draft) => {
    const current = locateCourseLayer(draft, overlayId)
    if (!current || current.item.kind !== 'native' || current.item.content.nativeType !== 'formula') {
      throw new Error('请先选择一个公式浮层')
    }
    current.item.content.data.ast = structuredClone(ast)
    current.item.content.data.accessibleText = accessibleText ?? formulaAstToAccessibleText(ast)
    return []
  }, '已更新公式内容')
  if (!mutated.ok) return mutated
  return {
    ...mutated,
    selection,
    ownership: 'viewport-overlay',
  }
}

export function patchFlowOverlayPaperSpace(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  paperSpace: 'viewport' | 'paper',
  options: FlowCommandOptions = {},
): FlowSharedAuthoringResult {
  const overlayId = selection.selectedOverlayIds[0]
  if (!overlayId) return fail('请先选择一个浮层或全局层项目')
  const located = locateCourseLayer(document, overlayId)
  if (!located) return fail(`找不到浮层：${overlayId}`)
  if (located.item.kind === 'native' && located.item.content.nativeType === 'teacher-controller') {
    return fail('教师控制器始终钉在视口')
  }
  const locked = teacherLocked(located.item)
  if (locked) return locked
  const current = located.item.paperSpace ?? 'viewport'
  if (current === paperSpace) {
    return {
      ok: true,
      reason: '未变化',
      nextDocument: document,
      historyEntry: false,
      selection,
      ownership: 'viewport-overlay',
    }
  }
  const mutated = runOverlayMutation(document, options, (draft) => {
    const next = locateCourseLayer(draft, overlayId)
    if (!next) throw new Error(`找不到浮层：${overlayId}`)
    if (paperSpace === 'viewport') delete next.item.paperSpace
    else next.item.paperSpace = 'paper'
    return []
  }, paperSpace === 'paper' ? '已改为跟随稿纸滚动' : '已改为钉在视口')
  if (!mutated.ok) return mutated
  return {
    ...mutated,
    selection,
    ownership: 'viewport-overlay',
  }
}

export {
  enterFlowGlobalAuthoringScope,
  resolveFlowOverlayAuthoringTarget,
  selectFlowAuthoringFromOverlayHit,
} from '../authoring/flowOverlayAuthoring'
export {
  listFlowGlobalAuthoringItems,
  projectFlowUnifiedOverlays,
} from './flowOverlayProjection'
