import type { ComponentAsset, ComponentImplementation, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { PublishedCourseV3, PublishedDefinition, PublishedImplementation, PublishedInstance } from '../../../shared/contracts/component-platform/published'
import { publishedCourseV3Schema } from '../../../shared/contracts/component-platform/published'
import { courseProjectV10Schema } from '../../../shared/contracts/component-platform/schema'
import type { DocumentResources } from '../../../shared/workbench/document'
import { componentCompilationInput } from '../../components/compilation/componentCompilationInput'
import { componentPublishDependencies, type ComponentPublishDependencies } from './dependencies'
import { componentAssetDataUrl } from './resourceUrl'
import { projectWebModuleGraph, webModuleCompilationInput } from '../../../components/web/moduleGraph'
import type { WebData } from '../../../components/web/data'
import type { ComponentCompilationInput, ComponentCompilationResult } from '../../components/compilation/types'

export interface ComponentPublishDiagnostic {
  code: 'asset-bytes-missing' | 'asset-url-unusable' | 'source-not-compiled' | 'source-compile-failed' | 'source-compile-warning' | 'online-remote-asset' | 'network-dependency'
  severity?: 'info' | 'warning'
  message: string
  path: Array<string | number>
}

export interface ComponentPublishOptions {
  singleHtmlMode?: 'offline-portable' | 'online-lightweight'
  /** Reuse L04's compiler/cache. Production Main compiles; no author code is run here. */
  compilation?: { compile(input: ComponentCompilationInput, signal?: AbortSignal, onProgress?: () => void): Promise<ComponentCompilationResult> }
  signal?: AbortSignal
  onProgress?: () => void
  /** A web package writer can save these bytes and return a relative URL. Default: embedded bytes. */
  assetUrl?: (asset: Readonly<ComponentAsset>, bytes: Uint8Array) => string | undefined | Promise<string | undefined>
}

export interface ComponentPublishResult {
  payload: PublishedCourseV3
  dependencies: ComponentPublishDependencies
  diagnostics: ComponentPublishDiagnostic[]
  /** Actual asset embedding and effective-source compilation; not a playback verdict. */
  offlineComplete: boolean
}

function portableUrl(value: string | undefined): value is string {
  return !!value && !/^(?:blob:|file:|[a-z]:[\\/]|[\\/])/i.test(value)
}

/** Project identity/ownership is checked; local resource or source problems remain recoverable. */
export async function buildPublishedCourseV3(
  sources: { project: CourseProjectV10; assetBytes: Readonly<Record<string, Uint8Array>>; componentFiles?: DocumentResources['components'] },
  options: ComponentPublishOptions = {},
): Promise<ComponentPublishResult> {
  const check = () => { options.signal?.throwIfAborted(); options.onProgress?.() }
  check()
  // Parse creates a detached snapshot and rejects actual wrong ownership before projection.
  const project = courseProjectV10Schema.parse(sources.project)
  const diagnostics: ComponentPublishDiagnostic[] = []
  const dependencies = componentPublishDependencies(project)
  const effectiveDefinitions = new Set(Object.values(project.instances)
    .filter(instance => !instance.implementationOverride).map(instance => instance.definitionId))
  const definitions: Record<string, PublishedDefinition> = {}
  const instances: Record<string, PublishedInstance> = {}
  const usedDefinitions = new Set(Object.values(project.instances).map(instance => instance.definitionId))

  async function implementation(value: ComponentImplementation, path: Array<string | number>): Promise<PublishedImplementation> {
    check()
    if (value.kind === 'builtin') return value
    if (!options.compilation) {
      diagnostics.push({ code: 'source-not-compiled', message: '源码已保留；独立运行所需的编译服务尚未连接', path })
      return value
    }
    try {
      const result = await options.compilation.compile(componentCompilationInput(project, value, { assets: sources.assetBytes, components: sources.componentFiles ?? {} }), options.signal, options.onProgress)
      check()
      if (result.status === 'failed') {
        for (const issue of result.diagnostics) diagnostics.push({
          code: 'source-compile-failed', message: issue.message,
          path: [...path, value.workspace ? 'workspace' : 'source', ...(issue.file ? [issue.file] : []), ...(issue.line === undefined ? [] : [issue.line])],
        })
        if (!result.diagnostics.length) diagnostics.push({ code: 'source-compile-failed', message: '源码编译失败；原始源码已保留', path })
        return value
      }
      for (const issue of result.artifact.diagnostics) diagnostics.push({ code: 'source-compile-warning', message: issue.message, path })
      return { ...value, compiled: { code: result.artifact.code, ...(result.artifact.css ? { css: result.artifact.css } : {}) } }
    } catch (error) {
      options.signal?.throwIfAborted()
      diagnostics.push({ code: 'source-compile-failed', message: error instanceof Error ? error.message : String(error), path })
      return value
    }
  }

  for (const [id, definition] of Object.entries(project.definitions)) {
    check()
    if (!usedDefinitions.has(id)) continue
    const { dataSchema: _dataSchema, implementation: original, ...definitionData } = definition
    definitions[id] = { ...definitionData, implementation: effectiveDefinitions.has(id)
      ? await implementation(original, ['definitions', id, 'implementation']) : original }
  }
  for (const [id, instance] of Object.entries(project.instances)) {
    check()
    const effective = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    let runtimeInstance = instance
    if (effective?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(effective.key)) {
      try {
        if (options.compilation) runtimeInstance = await projectWebModuleGraph(instance, input => options.compilation!.compile(input, options.signal, options.onProgress), (message, severity) => {
          diagnostics.push({ code: severity === 'error' ? 'source-compile-failed' : 'source-compile-warning', message, path: ['instances', id, 'data', 'modules'] })
        })
        else if (webModuleCompilationInput(instance.data as WebData)) diagnostics.push({
          code: 'source-not-compiled', message: 'HTML 模块源码已保留；独立运行所需编译服务尚未连接', path: ['instances', id, 'data', 'modules'],
        })
      } catch (error) {
        options.signal?.throwIfAborted()
        diagnostics.push({ code: 'source-compile-failed', message: error instanceof Error ? error.message : String(error),
          path: ['instances', id, 'data', 'modules'] })
      }
      check()
      const data = instance.data as WebData & { resourceSources?: readonly { url: string; usage: string }[] }
      for (const [index, resource] of (data.resourceSources ?? []).entries()) diagnostics.push({
        code: 'network-dependency', message: `内容使用在线${resource.usage}资源 ${resource.url}，离线运行需要该资源可达；原始内容已保留。`,
        path: ['instances', id, 'data', 'resourceSources', index],
      })
    }
    instances[id] = { ...runtimeInstance, ...(instance.implementationOverride ? {
      implementationOverride: await implementation(instance.implementationOverride, ['instances', id, 'implementationOverride']),
    } : {}) }
  }

  const assets: PublishedCourseV3['assets'] = {}
  for (const origin of project.logic?.network?.connectOrigins ?? []) diagnostics.push({
    code: 'network-dependency', message: `课程声明网络地址 ${origin}；导出保留网络行为，相应功能在离线时需要网络。`, path: ['logic', 'network', 'connectOrigins'],
  })
  for (const [id, asset] of Object.entries(project.assets)) {
    check()
    const { path: _authorPath, ...metadata } = asset
    assets[id] = metadata
    // remote.url is the delivery URL for these bytes; source.url remains attribution.
    if (!options.assetUrl && options.singleHtmlMode === 'online-lightweight' && asset.remote?.url) {
      assets[id]!.url = asset.remote.url
      diagnostics.push({ code: 'online-remote-asset', severity: 'info', message: `资源 ${id} 使用已登记的在线地址，需要网络可达。`, path: ['assets', id, 'remote', 'url'] })
      continue
    }
    const bytes = sources.assetBytes[id]
    if (!bytes) {
      diagnostics.push({ code: 'asset-bytes-missing', message: `离线资源字节缺失：${id}；素材引用已保留`, path: ['assets', id] })
      continue
    }
    try {
      const url = options.assetUrl ? await options.assetUrl(asset, Uint8Array.from(bytes)) : componentAssetDataUrl(bytes, asset.mimeType)
      check()
      if (portableUrl(url)) assets[id]!.url = url
      else diagnostics.push({ code: 'asset-url-unusable', message: `资源 ${id} 未获得可交付 URL；素材引用已保留`, path: ['assets', id, 'url'] })
    } catch (error) {
      options.signal?.throwIfAborted()
      diagnostics.push({ code: 'asset-url-unusable', message: error instanceof Error ? error.message : String(error), path: ['assets', id, 'url'] })
    }
  }

  const { schemaVersion: _version, revision: _revision, definitions: _definitions,
    instances: _instances, assets: _assets, ...runtimeData } = project
  const payload = publishedCourseV3Schema.parse({ ...runtimeData, schemaVersion: 3, definitions, instances, assets })
  check()
  return { payload, dependencies, diagnostics,
    offlineComplete: diagnostics.every(issue => issue.code === 'source-compile-warning')
      && Object.values(assets).every(asset => asset.url?.startsWith('data:') ||
        (!!asset.url && !/^[a-z][a-z\d+.-]*:/i.test(asset.url))),
  }
}
