import { materializeNativeLayerItem } from '../shared/contracts/course-project-v9/schema'
import type { NativeLayerItem } from '../shared/contracts/course-project-v9/types'
import {
  isNativeRenderInput,
  type NativeRenderInput,
} from '../shared/contracts/native-v1/types'

function nativeTextureAssetId(node: NativeRenderInput): string[] {
  if (node.type === 'image') return [node.assetId]
  if (node.type === 'video' && node.poster.mode === 'image' && node.poster.assetId) {
    return [node.poster.assetId]
  }
  return []
}

/** Phaser image textures for Native paint. Video files are not textures. */
export function nativeTextureAssetIds(
  nodes: readonly NativeRenderInput[],
): string[] {
  const ids = new Set<string>()
  for (const node of nodes) {
    for (const assetId of nativeTextureAssetId(node)) ids.add(assetId)
  }
  return [...ids]
}

/**
 * Image, video, and optional poster assets a Native item must resolve.
 * Broader than Phaser texture preload: Adapter authoring validation uses this.
 */
export function nativeMediaAssetIds(node: NativeRenderInput): string[] {
  if (node.type === 'image') return [node.assetId]
  if (node.type === 'video') {
    const ids = [node.assetId]
    if (node.poster.assetId) ids.push(node.poster.assetId)
    return ids
  }
  return []
}

export interface NativeSceneTexturePlan {
  readonly backgroundAssetId?: string | null
  readonly nodes: readonly NativeRenderInput[]
  readonly namedStates?: readonly {
    readonly backgroundAssetId?: string | null
    readonly nodes: readonly NativeRenderInput[]
  }[]
}

function collectPlanAssets(
  ids: Set<string>,
  backgroundAssetId: string | null | undefined,
  nodes: readonly NativeRenderInput[],
): void {
  if (backgroundAssetId) ids.add(backgroundAssetId)
  for (const assetId of nativeTextureAssetIds(nodes)) ids.add(assetId)
}

/** Native Phaser textures needed to render one scene (or named-state variants). */
export function sceneNativeAssetIds(plan: NativeSceneTexturePlan): string[] {
  const ids = new Set<string>()
  collectPlanAssets(ids, plan.backgroundAssetId, plan.nodes)
  for (const state of plan.namedStates ?? []) {
    collectPlanAssets(ids, state.backgroundAssetId, state.nodes)
  }
  return [...ids]
}

/** Native images mounted once in the persistent project-level master layer. */
export function globalLayerNativeAssetIds(
  nodes: readonly NativeRenderInput[],
): string[] {
  return nativeTextureAssetIds(nodes)
}

export function nativeRenderInputsFromLayerItems(
  items: readonly NativeLayerItem[],
): NativeRenderInput[] {
  return items.map(materializeNativeLayerItem)
}

export function nativeRenderInputsOf(
  nodes: readonly { readonly type: string }[],
): NativeRenderInput[] {
  const inputs: NativeRenderInput[] = []
  for (const node of nodes) {
    if (isNativeRenderInput(node)) inputs.push(node)
  }
  return inputs
}
