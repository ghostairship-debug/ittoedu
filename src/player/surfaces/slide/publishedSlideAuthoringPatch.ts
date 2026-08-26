import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../../shared/constants'
import { sceneNodeToCourseLayerItem } from '../../../shared/courseProjectModel'
import type { ExternalComponentNode, SceneNode } from '../../../shared/projectTypes'
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

export type PublishedSlideAuthoringPatchResult =
  | { ok: true; target: PlayerAuthoringTarget }
  | { ok: false; code: PlayerAuthoringErrorCode; message: string }

export type PublishedLayerItemMergeResult =
  | { ok: true; item: PublishedLayerItem }
  | { ok: false; code: PlayerAuthoringErrorCode; message: string }

function failure(
  code: PlayerAuthoringErrorCode,
  message: string,
): PublishedLayerItemMergeResult {
  return { ok: false, code, message }
}

/**
 * Maps the existing complete V8 authoring command frame onto one transient
 * Published item. Published-only fields stay owned by the V9/V2 source.
 */
export function mergePublishedAuthoringNode(
  current: PublishedLayerItem,
  node: SceneNode,
): PublishedLayerItemMergeResult {
  if (node.id !== current.layerItemId) {
    return failure('target-mismatch', '编辑目标 ID 与完整节点 ID 不一致。')
  }
  const converted = sceneNodeToCourseLayerItem(node, current.order)
  if (current.kind !== converted.kind) {
    return failure('target-mismatch', '编辑更新不能改变节点载体类型。')
  }

  const common = {
    ...current,
    frame: {
      ...current.frame,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    },
    rotation: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    // Published V2 intentionally omits authoring locks. Keep the current V9
    // lock only on this transient patch record so target publication follows
    // the live authoring snapshot without changing the persisted contract.
    locked: node.locked,
    playbackInitialVisibility: node.playbackInitialVisibility,
  }
  if (current.kind === 'native' && converted.kind === 'native') {
    if (current.content.nativeType !== converted.content.nativeType) {
      return failure('target-mismatch', '编辑更新不能改变 Native 节点类型。')
    }
    return {
      ok: true,
      item: {
        ...common,
        kind: 'native',
        content: structuredClone(converted.content),
      },
    }
  }
  if (current.kind === 'component' && converted.kind === 'component') {
    if (
      current.component.packageId !== converted.component.packageId
      || current.component.version !== converted.component.version
    ) {
      return failure('target-mismatch', '组件画布更新不能替换包 ID 或版本。')
    }
    return {
      ok: true,
      item: {
        ...common,
        kind: 'component',
        component: current.component,
        props: structuredClone(converted.props),
      },
    }
  }
  return failure('target-mismatch', 'Runtime 不使用 SceneNode 画面命令更新。')
}

export function publishedComponentAuthoringNode(
  item: PublishedComponentLayerItem,
): ExternalComponentNode {
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
