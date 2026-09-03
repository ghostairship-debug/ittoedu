import type {
  ComponentManifest,
  ExportPayload,
} from '../shared/componentTypes'
import type {
  AssetKind,
  ProjectDocument,
  SceneNode,
  SceneNodeOverride,
} from '../shared/projectTypes'
import {
  PUBLISHED_LESSON_FORMAT,
  PUBLISHED_LESSON_VERSION,
  type PublishedComponent,
  type PublishedLessonPayload,
  type PublishedRuntimeDocument,
  type PublishedSceneNode,
} from '../shared/publishedLessonTypes'
import type { RuntimeDocument } from '../shared/runtimeTypes'
import { decodePublishedCode } from './decodePublishedExecutableCode'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function isPublishedLessonPayload(
  value: unknown,
): value is PublishedLessonPayload {
  return (
    isRecord(value) &&
    value.format === PUBLISHED_LESSON_FORMAT &&
    value.formatVersion === PUBLISHED_LESSON_VERSION
  )
}

function restoreRuntime(
  runtime: PublishedRuntimeDocument | undefined,
  label: string,
): RuntimeDocument | undefined {
  if (!runtime) return undefined
  if (
    runtime.apiVersion !== 2 ||
    !['phaser', 'dom', 'hybrid'].includes(runtime.renderMode) ||
    !isRecord(runtime.content) ||
    !isRecord(runtime.assets)
  ) {
    throw new Error(`${label}格式无效`)
  }
  return {
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: runtime.renderMode,
    source: decodePublishedCode(runtime.code, `${label}代码`),
    content: { values: cloneJson(runtime.content) },
    assets: cloneJson(runtime.assets),
    ...(runtime.nodeBindings
      ? { nodeBindings: cloneJson(runtime.nodeBindings) }
      : {}),
    ...(runtime.staticFallback
      ? { staticFallback: cloneJson(runtime.staticFallback) }
      : {}),
  }
}

function restoreNode(node: PublishedSceneNode): SceneNode {
  if (!isRecord(node) || typeof node.id !== 'string' || typeof node.type !== 'string') {
    throw new Error('发布场景包含无效元素')
  }
  return {
    ...cloneJson(node),
    name: `${node.type}:${node.id}`,
    locked: false,
  } as SceneNode
}

function restoreOverride(override: unknown): SceneNodeOverride {
  if (!isRecord(override)) {
    throw new Error('发布场景包含无效状态覆盖')
  }
  const restored = cloneJson(override) as SceneNodeOverride & {
    name?: string
    locked?: boolean
  }
  delete restored.name
  delete restored.locked
  return restored
}

function assetKind(mimeType: string): AssetKind {
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('video/')) return 'video'
  return 'image'
}

function componentManifest(component: PublishedComponent): ComponentManifest {
  if (
    component.apiVersion !== 4 ||
    !Array.isArray(component.scopes) ||
    !['phaser', 'dom', 'hybrid'].includes(component.renderMode)
  ) {
    throw new Error(`发布组件“${component.id}”的 API 版本或渲染模式不受支持`)
  }
  const common = {
    id: component.id,
    name: component.name,
    version: component.version,
    entry: 'published-runtime',
    defaultSize: { width: 16, height: 16 },
    minSize: { width: 16, height: 16 },
    preserveAspectRatio: false,
    assets: Object.fromEntries(
      Object.keys(component.assets).map((assetKey) => [assetKey, assetKey]),
    ),
    // Published component instances already carry effective props.
    defaultProps: {},
  }
  return {
    ...common,
    schemaVersion: 4,
    runtimeApiVersion: 4,
    supportedScopes: cloneJson(component.scopes),
    renderMode: component.renderMode,
  }
}

function assertPublishedShape(
  payload: PublishedLessonPayload,
): void {
  if (
    typeof payload.title !== 'string' ||
    !isRecord(payload.canvas) ||
    !Array.isArray(payload.scenes) ||
    payload.scenes.length === 0 ||
    !isRecord(payload.assets) ||
    !isRecord(payload.components) ||
    !Array.isArray(payload.globalLayer) ||
    !Array.isArray(payload.globalInteractions) ||
    !isRecord(payload.media) ||
    !isRecord(payload.playback)
  ) {
    throw new Error('PublishedLesson V1 格式无效')
  }
}

/** Convert the one-way player format into the established in-memory runtime model. */
export function publishedLessonToExportPayload(
  published: PublishedLessonPayload,
): ExportPayload {
  assertPublishedShape(published)
  const assets: ExportPayload['assets'] = {}
  const projectAssets: ProjectDocument['assets'] = {}
  Object.entries(published.assets).forEach(([assetId, asset], index) => {
    if (
      !isRecord(asset) ||
      typeof asset.mimeType !== 'string' ||
      typeof asset.url !== 'string'
    ) {
      throw new Error(`发布素材“${assetId}”格式无效`)
    }
    assets[assetId] = { mimeType: asset.mimeType, dataUrl: asset.url }
    projectAssets[assetId] = {
      id: assetId,
      filename: `asset-${String(index).padStart(3, '0')}`,
      mimeType: asset.mimeType,
      kind: assetKind(asset.mimeType),
      path: `published-assets/${String(index).padStart(3, '0')}`,
      byteLength: 0,
    }
  })

  const components: ExportPayload['components'] = {}
  const projectComponents: ProjectDocument['componentPackages'] = {}
  Object.entries(published.components).forEach(([recordKey, component], index) => {
    if (
      !isRecord(component) ||
      typeof component.id !== 'string' ||
      typeof component.name !== 'string' ||
      typeof component.version !== 'string' ||
      typeof component.contentSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(component.contentSha256) ||
      !isRecord(component.assets)
    ) {
      throw new Error(`发布组件“${recordKey}”格式无效`)
    }
    const manifest = componentManifest(component)
    components[recordKey] = {
      manifest,
      runtimeSource: decodePublishedCode(
        component.code,
        `发布组件“${component.name}”代码`,
      ),
      assets: Object.fromEntries(
        Object.entries(component.assets).map(([assetKey, asset]) => {
          if (
            !isRecord(asset) ||
            typeof asset.mimeType !== 'string' ||
            typeof asset.url !== 'string'
          ) {
            throw new Error(`发布组件素材“${component.name}/${assetKey}”格式无效`)
          }
          return [assetKey, { mimeType: asset.mimeType, dataUrl: asset.url }]
        }),
      ),
    }
    projectComponents[recordKey] = {
      packageId: component.id,
      version: component.version,
      name: component.name,
      manifestPath: `published-components/${String(index).padStart(3, '0')}`,
      runtimePath: `published-components/${String(index).padStart(3, '0')}`,
      contentSha256: component.contentSha256,
    }
  })

  const publishedPlayback = cloneJson(published.playback) as {
    controls: ProjectDocument['playback']['controls'] | 'footer'
    keyboardNavigation: boolean
    presenter?: ProjectDocument['playback']['presenter']
  }

  const project: ProjectDocument = {
    schemaVersion: 8,
    id: 'published-lesson',
    title: published.title,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    canvas: cloneJson(published.canvas),
    scenes: published.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      backgroundColor: scene.backgroundColor,
      ...(scene.backgroundAssetId !== undefined
        ? { backgroundAssetId: scene.backgroundAssetId }
        : {}),
      nodes: scene.nodes.map(restoreNode),
      ...(scene.presentation
        ? {
            presentation: {
              initialStateId: scene.presentation.initialStateId,
              states: scene.presentation.states.map((state) => ({
                id: state.id,
                name: state.name,
                ...(state.backgroundColor !== undefined
                  ? { backgroundColor: state.backgroundColor }
                  : {}),
                ...(state.backgroundAssetId !== undefined
                  ? { backgroundAssetId: state.backgroundAssetId }
                  : {}),
                nodeOverrides: Object.fromEntries(
                  Object.entries(state.nodeOverrides).map(([nodeId, override]) => [
                    nodeId,
                    restoreOverride(override),
                  ]),
                ),
                ...(state.nodeOrder
                  ? { nodeOrder: cloneJson(state.nodeOrder) }
                  : {}),
              })),
            },
          }
        : {}),
      ...(scene.runtime
        ? { runtime: restoreRuntime(scene.runtime, `场景“${scene.name}”运行时`)! }
        : {}),
      interactions: cloneJson(scene.interactions),
    })),
    assets: projectAssets,
    componentPackages: projectComponents,
    ...(published.globalRuntime
      ? { globalRuntime: restoreRuntime(published.globalRuntime, '全局运行时')! }
      : {}),
    globalLayer: published.globalLayer.map((item) => ({
      node: restoreNode(item.node),
      layer: item.layer,
      visibility: cloneJson(item.visibility),
    })),
    globalInteractions: cloneJson(published.globalInteractions),
    designTokens: {
      fonts: [{
        id: 'body',
        label: '正文',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      }],
      colors: [
        { id: 'background', label: '背景', color: '#ffffff' },
        { id: 'text', label: '正文', color: '#1f2937' },
        { id: 'accent', label: '强调', color: '#2563eb' },
      ],
    },
    media: cloneJson(published.media),
    playback: {
      controls: publishedPlayback.controls === 'footer'
        ? 'none'
        : publishedPlayback.controls,
      keyboardNavigation: publishedPlayback.keyboardNavigation,
      presenter: publishedPlayback.presenter
        ? cloneJson(publishedPlayback.presenter)
        : {
            enabled: true,
            strategy: 'scene-navigation',
            additionalBindings: [],
          },
    },
  }
  return { project, assets, components }
}
