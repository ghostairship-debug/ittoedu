import type { LayerItem, ScopedLayerItem } from '../../shared/courseProjectTypes'
import { componentContentSha256 } from '../../shared/componentContentIntegrity'
import type { EditorCanvasNode } from '../phaser/editorCanvasNode'
import type {
  AssetMeta,
  GlobalLayerItem,
} from '../../shared/projectTypes'

export interface SlidePreviewNodeIdentity {
  readonly id: string
  readonly type: EditorCanvasNode['type']
  readonly componentId?: string
  readonly componentVersion?: string
}

export interface SlidePreviewRebuildScene {
  readonly id: string
  readonly nodes: readonly SlidePreviewIdentityNode[]
  readonly presentation?: {
    readonly states: readonly { readonly id: string }[]
  }
  readonly runtime?: unknown
}

export type SlidePreviewIdentityNode = Pick<EditorCanvasNode, 'id' | 'type'> & {
  readonly component?: {
    readonly packageId: string
    readonly version: string
  }
}

export type SlidePreviewPackageRecord = Record<string, {
  readonly manifest?: { readonly id: string; readonly version: string }
  readonly packageId?: string
  readonly version?: string
  readonly runtimeSource?: string
  readonly files?: Readonly<Record<string, Uint8Array>>
  readonly contentSha256?: string
}>

export interface SlidePreviewRebuildGlobalItem {
  readonly node: SlidePreviewIdentityNode
  readonly layer: GlobalLayerItem['layer'] | string
  readonly visibility: unknown
}

export interface SlidePreviewRebuildLocalItem {
  readonly owner: 'scene' | 'surface'
  readonly item: LayerItem
  readonly visibility?: unknown
}

export interface SlidePreviewRebuildKeyInput {
  readonly canvasMode: string
  readonly editingScope: string
  readonly activePresentationStateId: string | null | undefined
  readonly scene: SlidePreviewRebuildScene
  readonly scenes: readonly SlidePreviewRebuildScene[]
  readonly globalLayer: readonly SlidePreviewRebuildGlobalItem[]
  readonly globalRuntime: unknown
  readonly assets: Record<string, Pick<AssetMeta, 'id' | 'kind' | 'byteLength' | 'path'>>
  readonly candidateGlobals: readonly ScopedLayerItem[] | null
  readonly candidateLocalItems: readonly SlidePreviewRebuildLocalItem[] | null
  readonly candidateAssets: Record<
    string,
    Pick<AssetMeta, 'id' | 'kind' | 'byteLength' | 'path'>
  > | null
  readonly sidecarFileIds: readonly string[]
  readonly componentPackages: SlidePreviewPackageRecord
}

export function slidePreviewNodeIdentity(
  node: SlidePreviewIdentityNode,
): SlidePreviewNodeIdentity {
  if (node.type === 'external-component' && node.component) {
    return {
      id: node.id,
      type: node.type,
      componentId: node.component.packageId,
      componentVersion: node.component.version,
    }
  }
  return { id: node.id, type: node.type }
}

export function slidePreviewComponentPackageFingerprint(
  packages: SlidePreviewPackageRecord,
): readonly string[] {
  return Object.entries(packages)
    .map(([key, value]) => {
      const executableIdentity = value.contentSha256
        ?? (value.files ? componentContentSha256(value.files) : value.runtimeSource ?? '')
      if ('manifest' in value && value.manifest) {
        return `${value.manifest.id}@${value.manifest.version}#${executableIdentity}`
      }
      if ('packageId' in value && 'version' in value) {
        return `${value.packageId}@${value.version}#${executableIdentity}`
      }
      return `${key}@#${executableIdentity}`
    })
    .sort()
}

function assetFingerprint(
  assets: Record<string, Pick<AssetMeta, 'id' | 'kind' | 'byteLength' | 'path'>>,
): readonly { id: string; kind: string; byteLength: number; path: string }[] {
  return Object.keys(assets)
    .sort()
    .map((key) => {
      const asset = assets[key]
      return {
        id: asset?.id ?? key,
        kind: asset?.kind ?? '',
        byteLength: asset?.byteLength ?? 0,
        path: asset?.path ?? '',
      }
    })
}

function runtimeAuthoringStructure(runtime: unknown): unknown {
  if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) {
    return runtime ?? null
  }
  const record = runtime as Record<string, unknown>
  const content = record.content
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    return record
  }
  const contentRecord = content as Record<string, unknown>
  const values = contentRecord.values
  const contentStructure = {
    ...contentRecord,
    values: typeof values === 'object' && values !== null && !Array.isArray(values)
      ? Object.keys(values).sort()
      : values,
  }
  return {
    ...record,
    content: contentStructure,
  }
}

function sceneStructure(scene: SlidePreviewRebuildScene) {
  return {
    id: scene.id,
    nodes: scene.nodes.map(slidePreviewNodeIdentity),
    stateIds: scene.presentation?.states.map((state) => state.id) ?? [],
    runtime: scene.runtime ?? null,
  }
}

function authoringSceneStructure(scene: SlidePreviewRebuildScene) {
  return {
    id: scene.id,
    nodes: scene.nodes
      .map(slidePreviewNodeIdentity)
      .sort((left, right) => left.id.localeCompare(right.id)),
    stateIds: scene.presentation?.states.map((state) => state.id) ?? [],
    runtime: runtimeAuthoringStructure(scene.runtime),
  }
}

function candidateGlobalStructure(
  entry: ScopedLayerItem,
  authoring: boolean,
) {
  if (!authoring) {
    return entry
  }
  const common = {
    id: entry.item.layerItemId,
    type: entry.item.kind === 'native' ? entry.item.content.nativeType : entry.item.kind,
    label: entry.item.label,
    frameMode: entry.item.frame.mode,
    order: entry.item.order,
    locked: entry.item.locked,
    hitPolicy: entry.item.hitPolicy,
    paperSpace: entry.item.paperSpace ?? null,
    visibility: entry.visibility,
  }
  if (entry.item.kind === 'runtime') {
    return {
      ...common,
      item: {
        ...entry.item,
        runtime: authoring
          ? runtimeAuthoringStructure(entry.item.runtime)
          : entry.item.runtime,
      },
    }
  }
  if (entry.item.kind === 'component') {
    return {
      ...common,
      component: entry.item.component,
      staticFallbackAssetId: entry.item.staticFallbackAssetId ?? null,
    }
  }
  return common
}

function candidateLocalStructure(
  entry: SlidePreviewRebuildLocalItem,
  authoring: boolean,
) {
  const common = {
    owner: entry.owner,
    id: entry.item.layerItemId,
    kind: entry.item.kind,
    visibility: entry.visibility ?? null,
  }
  if (entry.item.kind !== 'runtime') return common
  return {
    ...common,
    item: {
      ...entry.item,
      runtime: authoring
        ? runtimeAuthoringStructure(entry.item.runtime)
        : entry.item.runtime,
    },
  }
}

function v8GlobalStructure(item: SlidePreviewRebuildGlobalItem) {
  return {
    ...slidePreviewNodeIdentity(item.node),
    layer: item.layer,
    visibility: item.visibility,
  }
}

/**
 * Structural identity for the Slide Published authoring host. Same scene/global/asset/
 * package set must yield the same string even when `project`,
 * `componentPackages`, or `assetFiles` are new object identities.
 */
export function buildSlidePreviewRebuildKey(
  input: SlidePreviewRebuildKeyInput,
): string {
  const sidecar = [...input.sidecarFileIds].sort()
  const packages = slidePreviewComponentPackageFingerprint(input.componentPackages)
  const assets = assetFingerprint(input.candidateAssets ?? input.assets)
  const authoring = input.canvasMode !== 'run'
  const globalStructure = input.candidateGlobals
    ? input.candidateGlobals.map((entry) => candidateGlobalStructure(entry, authoring))
    : input.globalLayer.map(v8GlobalStructure)
  const localStructure = input.candidateLocalItems?.map((entry) => (
    candidateLocalStructure(entry, authoring)
  )) ?? null

  if (input.canvasMode === 'run') {
    return JSON.stringify({
      mode: input.canvasMode,
      currentSceneId: input.scene.id,
      scenes: input.scenes.map(sceneStructure),
      localStructure,
      globalStructure,
      globalRuntime: input.globalRuntime ?? null,
      assets,
      sidecar,
      componentPackages: packages,
    })
  }

  return JSON.stringify({
    mode: input.canvasMode,
    authoringContext: [
      input.scene.id,
      input.activePresentationStateId ?? null,
    ],
    sceneStructure: authoringSceneStructure(input.scene),
    localStructure,
    globalStructure,
    globalRuntime: runtimeAuthoringStructure(input.globalRuntime),
    assets,
    sidecar,
    componentPackages: packages,
  })
}

export function sidecarFileIdsFrom(
  candidateSidecarFiles: Record<string, unknown> | null | undefined,
  assetFiles: Record<string, unknown>,
): string[] {
  return Object.keys(candidateSidecarFiles ?? assetFiles)
}
