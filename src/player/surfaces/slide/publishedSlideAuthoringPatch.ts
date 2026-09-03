import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../../shared/constants'
import type { NativeElementContent } from '../../../shared/contracts/course-project-v9/types'
import {
  isNativeRenderInput,
  NATIVE_RENDERABLE_BASE_KEYS,
  type NativeRenderInput,
} from '../../../shared/contracts/native-v1'
import type {
  PublishedComponentLayerItem,
  PublishedLayerItem,
} from '../../../shared/publishedCourseTypes'
import type {
  PlayerAuthoringErrorCode,
  PlayerAuthoringTarget,
} from '../../../shared/playerAuthoringProtocol'
import type {
  RuntimeAuthoringBounds,
  RuntimeAuthoringTarget,
  RuntimeAuthoringTargetUpdate,
} from '../../../shared/runtimeTypes'
import type { ComponentHostNode } from '../publishedComponentMount'

export type PublishedSlideAuthoringPatchResult =
  | { ok: true; target: PlayerAuthoringTarget }
  | { ok: false; code: PlayerAuthoringErrorCode; message: string }

export type PublishedLayerItemMergeResult =
  | { ok: true; item: PublishedLayerItem }
  | { ok: false; code: PlayerAuthoringErrorCode; message: string }

export type PublishedSlideAuthoringOwner = 'scene' | 'surface' | 'global'

/**
 * Canonical identity a direct Published Slide patch must carry. Stale or
 * incomplete identity never writes the transient Published item.
 */
export interface PublishedSlideAuthoringIdentity {
  readonly target: PlayerAuthoringTarget
  readonly revision: number
  readonly generation: number
  readonly owner: PublishedSlideAuthoringOwner
  readonly itemId: string
}

/** Component mount descriptor used by Slide authoring; not a SceneNode. */
export interface PublishedSlideComponentAuthoringNode extends ComponentHostNode {
  type: 'external-component'
  name: string
  opacity: number
  locked: boolean
  playbackInitialVisibility: 'inherit' | 'hidden'
}

export type PublishedSlideAuthoringFrame =
  | NativeRenderInput
  | PublishedSlideComponentAuthoringNode

const nativeRenderableBaseKeySet = new Set<string>(NATIVE_RENDERABLE_BASE_KEYS)

function patchFailure(
  code: PlayerAuthoringErrorCode,
  message: string,
): Extract<PublishedSlideAuthoringPatchResult, { ok: false }> {
  return { ok: false, code, message }
}

function mergeFailure(
  code: PlayerAuthoringErrorCode,
  message: string,
): PublishedLayerItemMergeResult {
  return { ok: false, code, message }
}

function targetItemId(target: PlayerAuthoringTarget, itemId: string): string {
  if (target.kind === 'native-node' || target.kind === 'runtime-content') {
    return target.nodeId
  }
  return itemId
}

export function isPublishedSlideComponentAuthoringNode(
  value: { readonly type: string },
): value is PublishedSlideComponentAuthoringNode {
  if (value.type !== 'external-component') return false
  const record = value as PublishedSlideComponentAuthoringNode
  return typeof record.id === 'string'
    && typeof record.x === 'number'
    && typeof record.y === 'number'
    && typeof record.width === 'number'
    && typeof record.height === 'number'
    && record.component != null
    && typeof record.component.packageId === 'string'
    && typeof record.component.version === 'string'
    && record.props != null
    && typeof record.props === 'object'
}

export function publishedSlideAuthoringFrameOf(
  value: { readonly type: string },
): PublishedSlideAuthoringFrame | null {
  if (isNativeRenderInput(value)) return value
  if (isPublishedSlideComponentAuthoringNode(value)) return value
  return null
}

function nativeContentFromRenderInput(input: NativeRenderInput): NativeElementContent {
  const data = Object.fromEntries(
    Object.entries(input).filter(([key]) => !nativeRenderableBaseKeySet.has(key)),
  )
  return {
    nativeType: input.type,
    data,
  } as NativeElementContent
}

/**
 * Validates complete target/revision/generation/owner/item identity. Callers
 * must not merge or paint when this fails.
 */
export function validatePublishedSlideAuthoringIdentity(input: {
  readonly captured: PublishedSlideAuthoringIdentity
  readonly current: Omit<PublishedSlideAuthoringIdentity, 'target'>
  readonly item: PublishedLayerItem | null
}): PublishedSlideAuthoringPatchResult {
  const { captured, current, item } = input
  if (captured.generation !== current.generation) {
    return patchFailure(
      'stale-revision',
      `编辑世代 ${captured.generation} 已过期，当前世代 ${current.generation}。`,
    )
  }
  if (captured.revision !== current.revision) {
    return patchFailure(
      'stale-revision',
      `编辑修订 ${captured.revision} 已过期，当前已应用 ${current.revision}。`,
    )
  }
  if (captured.owner !== current.owner) {
    return patchFailure('target-mismatch', '编辑目标所有者与当前图层所有者不一致。')
  }
  const capturedItemId = targetItemId(captured.target, captured.itemId)
  if (captured.itemId !== capturedItemId) {
    return patchFailure('target-mismatch', '编辑目标 ID 与 item 身份不一致。')
  }
  if (
    !item
    || item.layerItemId !== captured.itemId
    || captured.itemId !== current.itemId
  ) {
    return patchFailure(
      'target-not-found',
      `当前 Published 宿主中不存在节点“${captured.itemId}”。`,
    )
  }
  return { ok: true, target: captured.target }
}

/**
 * Maps a Native render input or component mount descriptor onto one transient
 * Published item. Published-only fields stay owned by the V9/V2 source.
 */
export function mergePublishedAuthoringFrame(
  current: PublishedLayerItem,
  next: PublishedSlideAuthoringFrame,
): PublishedLayerItemMergeResult {
  if (next.id !== current.layerItemId) {
    return mergeFailure('target-mismatch', '编辑目标 ID 与完整节点 ID 不一致。')
  }

  const common = {
    ...current,
    frame: {
      ...current.frame,
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
    },
    rotation: next.rotation,
    opacity: next.opacity,
    visible: next.visible,
    // Published V2 intentionally omits authoring locks. Keep the current V9
    // lock only on this transient patch record so target publication follows
    // the live authoring snapshot without changing the persisted contract.
    locked: next.locked,
    playbackInitialVisibility: next.playbackInitialVisibility,
  }

  if (isNativeRenderInput(next)) {
    if (current.kind !== 'native') {
      return mergeFailure('target-mismatch', '编辑更新不能改变节点载体类型。')
    }
    if (current.content.nativeType !== next.type) {
      return mergeFailure('target-mismatch', '编辑更新不能改变 Native 节点类型。')
    }
    return {
      ok: true,
      item: {
        ...common,
        kind: 'native',
        content: structuredClone(nativeContentFromRenderInput(next)),
      },
    }
  }

  if (current.kind !== 'component') {
    return mergeFailure('target-mismatch', '编辑更新不能改变节点载体类型。')
  }
  if (
    current.component.packageId !== next.component.packageId
    || current.component.version !== next.component.version
  ) {
    return mergeFailure('target-mismatch', '组件画布更新不能替换包 ID 或版本。')
  }
  return {
    ok: true,
    item: {
      ...common,
      kind: 'component',
      component: current.component,
      props: structuredClone(next.props),
    },
  }
}

/** Identity-checked merge. Stale or invalid identity returns without a next item. */
export function applyPublishedSlideAuthoringItemPatch(input: {
  readonly current: PublishedLayerItem | null
  readonly next: PublishedSlideAuthoringFrame
  readonly captured: PublishedSlideAuthoringIdentity
  readonly currentIdentity: Omit<PublishedSlideAuthoringIdentity, 'target'>
}): PublishedLayerItemMergeResult {
  const identity = validatePublishedSlideAuthoringIdentity({
    captured: input.captured,
    current: input.currentIdentity,
    item: input.current,
  })
  if (!identity.ok) return identity
  return mergePublishedAuthoringFrame(input.current!, input.next)
}

export function mergePublishedAuthoringNode(
  current: PublishedLayerItem,
  node: PublishedSlideAuthoringFrame,
): PublishedLayerItemMergeResult {
  return mergePublishedAuthoringFrame(current, node)
}

export function publishedComponentAuthoringNode(
  item: PublishedComponentLayerItem,
): PublishedSlideComponentAuthoringNode {
  const locked = Reflect.get(item, 'locked') === true
  return {
    id: item.layerItemId,
    name: item.layerItemId,
    type: 'external-component',
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    rotation: item.rotation,
    opacity: item.opacity,
    // ComponentAuthoringTargetRegistry publishes only visible nodes. Treat a
    // locked transient authoring item as non-targetable while leaving its
    // Published wrapper visible.
    visible: item.visible && !locked,
    locked,
    playbackInitialVisibility: item.playbackInitialVisibility,
    component: structuredClone(item.component),
    props: structuredClone(item.props),
  }
}

function rotatedBounds(
  bounds: RuntimeAuthoringBounds,
  item: PublishedLayerItem,
): RuntimeAuthoringBounds {
  const scaled = {
    x: item.frame.x + bounds.x / CANVAS_WIDTH * item.frame.width,
    y: item.frame.y + bounds.y / CANVAS_HEIGHT * item.frame.height,
    width: bounds.width / CANVAS_WIDTH * item.frame.width,
    height: bounds.height / CANVAS_HEIGHT * item.frame.height,
  }
  if (item.rotation === 0) return scaled
  const angle = item.rotation * Math.PI / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const centerX = item.frame.x + item.frame.width / 2
  const centerY = item.frame.y + item.frame.height / 2
  const corners = [
    [scaled.x, scaled.y],
    [scaled.x + scaled.width, scaled.y],
    [scaled.x + scaled.width, scaled.y + scaled.height],
    [scaled.x, scaled.y + scaled.height],
  ].map(([x, y]) => ({
    x: centerX + (x! - centerX) * cosine - (y! - centerY) * sine,
    y: centerY + (x! - centerX) * sine + (y! - centerY) * cosine,
  }))
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Converts a runtime-local 1280×720 target snapshot into Slide canvas space. */
export function mapRuntimeAuthoringTargetsToLayer(
  update: Readonly<RuntimeAuthoringTargetUpdate>,
  item: PublishedLayerItem,
): RuntimeAuthoringTargetUpdate {
  return Object.freeze({
    ...update,
    targets: Object.freeze(update.targets.map((target): Readonly<RuntimeAuthoringTarget> => (
      Object.freeze({
        ...target,
        nodeId: item.layerItemId,
        bounds: Object.freeze(rotatedBounds(target.bounds, item)),
      })
    ))),
  })
}
