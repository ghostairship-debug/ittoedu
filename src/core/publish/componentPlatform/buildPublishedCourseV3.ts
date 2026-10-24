import {createComponentReferenceCapture} from '../../components/library/references'
import { componentBackgroundAssetIds } from '../../../shared/componentBackgroundPaint'
import { resolveComponentPresentation, resolveComponentBackground } from '../../../shared/contracts/component-platform/project'
import type { ComponentAsset, ComponentImplementation, CourseProjectV10, JsonObject } from '../../../shared/contracts/component-platform/project'
import type { PublishedCourseV4, PublishedDefinition, PublishedImplementation, PublishedInstance } from '../../../shared/contracts/component-platform/published'
import { publishedCourseV4Schema } from '../../../shared/contracts/component-platform/published'
import { courseProjectV11Schema } from '../../../shared/contracts/component-platform/schema'
import type { DocumentResources } from '../../../shared/workbench/document'
import { componentCompilationInput } from '../../components/compilation/componentCompilationInput'
import { componentPublishDependencies, type ComponentPublishDependencies } from './dependencies'
import { componentAssetDataUrl } from './resourceUrl'
import { projectPublishedWebInitialization, projectPublishedWebRuntimeModules, projectWebModuleGraph, publishedWebModuleCompilationInput, publishedWebModuleDocumentPaths, webModuleGraphForDocument, webModuleCompilationInput, type WebRuntimeData } from '../../../components/web/moduleGraph'
import { hasWebContentData } from '../../../components/web/sourcePreparation'
import { isContentProgramImplementation } from '../../../shared/contentProgramImplementation'
import type { WebData } from '../../../components/web/data'
import { collectWebNetworkResourceFacts } from '../../../components/web/resources'
import type { ComponentCompilationDiagnostic, ComponentCompilationInput, ComponentCompilationResult } from '../../components/compilation/types'
import { prepareBrowserScripts } from './prepareBrowserScripts'
import { publishedImageDemands, runtimeImageAssetIds } from './imageDemand'
import type { ImageDerivativeDemand } from '../../../shared/imageDerivative'
import { resourceContentSha256Async } from '../../../shared/resourceContent'

export interface ComponentPublishDiagnostic {
  code: 'asset-bytes-missing' | 'asset-url-unusable' | 'source-not-compiled' | 'source-compile-failed' | 'source-compile-warning' | 'online-remote-asset' | 'network-dependency' | 'asset-encoding-warning'
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
  deliveryAsset?(asset:Readonly<ComponentAsset>,bytes:Uint8Array,demand?:ImageDerivativeDemand):Promise<{bytes:Uint8Array;mimeType:string;filename?:string;width?:number;height?:number}|undefined>
  /** Optional measured requirements/quality exceptions override the canonical native display estimate. */
  imageDemands?: Readonly<Record<string, ImageDerivativeDemand>>
  assetUrl?: (asset: Readonly<ComponentAsset>, bytes: Uint8Array) => string | undefined | Promise<string | undefined>
}

export interface ComponentPublishResult {
  payload: PublishedCourseV4
  dependencies: ComponentPublishDependencies
  diagnostics: ComponentPublishDiagnostic[]
  /** Embedded assets, compiled effective sources and no source-observed network dependency.
   * This is preparation evidence, not a verdict on arbitrary runtime/offline playback. */
  offlineComplete: boolean
}

function portableUrl(value: string | undefined): value is string {
  return !!value && !/^(?:blob:|file:|[a-z]:[\\/]|[\\/])/i.test(value)
}

/** Project identity/ownership is checked; local resource or source problems remain recoverable. */
export async function buildPublishedCourseV4(
  sources: { project: CourseProjectV10; assetBytes: Readonly<Record<string, Uint8Array>>; componentFiles?: DocumentResources['components'] },
  options: ComponentPublishOptions = {},
): Promise<ComponentPublishResult> {
  const check = () => { options.signal?.throwIfAborted(); options.onProgress?.() }
  check()
  // Parse creates a detached snapshot and rejects actual wrong ownership before projection.
  const project = courseProjectV11Schema.parse(sources.project)
  if (!project.entry) throw new Error('作品尚未配置运行入口；请先指定已有顶层实例，原内容与资源已保留')
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
  async function prepareWebInstance(instance: CourseProjectV10['instances'][string], dataPath: Array<string | number>) {
    const effective = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    let runtimeInstance = instance
    if (isContentProgramImplementation(effective) && hasWebContentData(instance.data)) {
      try {
        if (options.compilation) {
          const compilation = options.compilation
          const reported = new Set<string>()
          const note = (issue: ComponentCompilationDiagnostic, paths?: Readonly<Record<string, string>>, fallbackPath?: string) => {
            const sourcePath = issue.file ? paths ? paths[issue.file] ?? fallbackPath : issue.file : fallbackPath
            const diagnostic: ComponentPublishDiagnostic = { code: issue.severity === 'error' ? 'source-compile-failed' : 'source-compile-warning',
              message: `${sourcePath ? `${sourcePath}: ` : ''}${issue.message}`,
              path: [...dataPath, 'modules', ...(sourcePath ? [sourcePath] : []), ...(issue.line === undefined ? [] : [issue.line])] }
            const key = JSON.stringify(diagnostic)
            if (!reported.has(key)) { reported.add(key); diagnostics.push(diagnostic) }
            return diagnostic.message
          }
          runtimeInstance = await projectWebModuleGraph(instance, input => compilation.compile(input, options.signal, options.onProgress), (_message, _severity, issue) => { note(issue) })
          const expanded = await projectPublishedWebRuntimeModules(runtimeInstance.data as unknown as WebRuntimeData,
            input => compilation.compile(input, options.signal, options.onProgress), (_message, _severity, issue) => { note(issue) })
          const { publishedDocumentBundles: _previousDocumentBundles, ...data } = expanded
          type Recovery = Parameters<typeof publishedWebModuleCompilationInput>[1]
          const prepareDocument = async (documentPath: string) => {
            const attempt = async (recovery?: Recovery): Promise<{ status: 'ready'; code: string } | { status: 'failed'; message: string } | undefined> => {
              const fallbackPath = recovery?.entryKeys?.length === 1 ? data.moduleGraph?.entries[recovery.entryKeys[0]!]
                : recovery?.runtimeTargetPaths?.length === 1 ? recovery.runtimeTargetPaths[0] : undefined
              let prepared: ReturnType<typeof publishedWebModuleCompilationInput>
              try { prepared = publishedWebModuleCompilationInput(data, { ...recovery, documentPath }) }
              catch (error) {
                options.signal?.throwIfAborted()
                return { status: 'failed', message: note({ stage: 'compile', severity: 'error', message: error instanceof Error ? error.message : String(error) }, undefined, fallbackPath) }
              }
              if (!prepared) return undefined
              const result = await compilation.compile(prepared.input, options.signal, options.onProgress)
              check()
              const issues = result.status === 'ready' ? result.artifact.diagnostics : result.diagnostics
              const messages = issues.map(issue => note(issue, prepared.modulePaths, fallbackPath))
              if (result.status === 'ready') return { status: 'ready', code: projectPublishedWebInitialization(result.artifact.code, prepared) }
              return { status: 'failed', message: messages.join('; ') || note({ stage: 'compile', severity: 'error', message: 'HTML 模块编译失败；原始源码已保留' }, undefined, fallbackPath) }
            }
            let bundled = await attempt()
            if (bundled?.status === 'failed') {
              // Diagnose individual original closures only after the shared fast
              // path actually failed. These artifacts never execute. Re-bundle
              // every usable entry together so shared state/live bindings stay one.
              const entries = webModuleGraphForDocument(data.moduleGraph, documentPath, [])?.entries ?? {}
              const entryKeys: string[] = [], rejectedEntries: Array<{ index: number; path: string; message: string }> = []
              const results = new Map<string, Awaited<ReturnType<typeof attempt>>>()
              for (const [key, path] of Object.entries(entries)) {
                check()
                const candidate = results.has(path) ? results.get(path) : await attempt({ entryKeys: [key], runtimeTargetPaths: [] })
                results.set(path, candidate)
                if (candidate?.status === 'ready') entryKeys.push(key)
                else if (candidate?.status === 'failed') rejectedEntries.push({ index: Number(key.slice(key.lastIndexOf(':') + 1)), path, message: candidate.message })
              }
              const runtimeTargetPaths: string[] = [], rejectedRuntimeTargets: Array<{ path: string; message: string }> = []
              for (const path of data.moduleGraph?.runtimeRoots?.[documentPath] ?? []) {
                check()
                const candidate = results.has(path) ? results.get(path) : await attempt({ entryKeys: [], runtimeTargetPaths: [path] })
                results.set(path, candidate)
                if (candidate?.status === 'ready') runtimeTargetPaths.push(path)
                else if (candidate?.status === 'failed') rejectedRuntimeTargets.push({ path, message: candidate.message })
              }
              bundled = await attempt({ entryKeys, rejectedEntries, runtimeTargetPaths, rejectedRuntimeTargets })
            }
            return bundled?.status === 'ready' ? bundled.code : undefined
            }
          const publishedModuleBundle = await prepareDocument(''), publishedDocumentBundles: Record<string, string> = {}
          for (const documentPath of publishedWebModuleDocumentPaths(data)) {
            check()
            const bundled = await prepareDocument(documentPath)
            if (bundled) publishedDocumentBundles[documentPath] = bundled
          }
          runtimeInstance = { ...runtimeInstance, data: { ...data,
            ...(publishedModuleBundle ? { publishedModuleBundle } : {}),
            ...(Object.keys(publishedDocumentBundles).length ? { publishedDocumentBundles } : {}),
          } as unknown as JsonObject }
          const preparedData = runtimeInstance.data as unknown as WebRuntimeData
          runtimeInstance = { ...runtimeInstance, data: { ...preparedData,
            html: await prepareBrowserScripts(preparedData.html, input => compilation.compile(input, options.signal, options.onProgress), issue => { note(issue) }),
          } as unknown as JsonObject }
        }
        else if (webModuleCompilationInput(instance.data as WebData)) diagnostics.push({
          code: 'source-not-compiled', message: 'HTML 模块源码已保留；独立运行所需编译服务尚未连接', path: [...dataPath, 'modules'],
        })
      } catch (error) {
        options.signal?.throwIfAborted()
        diagnostics.push({ code: 'source-compile-failed', message: error instanceof Error ? error.message : String(error),
          path: [...dataPath, 'modules'] })
      }
      check()
      const data = instance.data as WebData
      for (const resource of collectWebNetworkResourceFacts(data)) diagnostics.push({
        code: 'network-dependency', message: resource.url
          ? `当前内容使用在线${resource.usage} ${resource.url}；导出保留该内容，离线时相应资源或功能需要网络。`
          : `当前内容存在不能静态确定依赖的${resource.usage}；离线依赖尚未确定，原始程序与可用内容继续保留。`,
        path: [...dataPath, resource.source],
      })
    }
    return runtimeInstance
  }
  for (const [id, instance] of Object.entries(project.instances)) {
    check()
    const runtimeInstance = await prepareWebInstance(instance, ['instances', id, 'data'])
    instances[id] = { ...runtimeInstance,
      ...(instance.container ? { container: structuredClone(instance.container) } : {}), ...(instance.implementationOverride ? {
      implementationOverride: await implementation(instance.implementationOverride, ['instances', id, 'implementationOverride']),
    } : {}) }
  }

  // A state's effective Web program uses the same compiler and cache as its base.
  for (const [containerId, containerInstance] of Object.entries(instances)) for (const [stateIndex, state] of (containerInstance.container?.presentation?.states ?? []).entries()) {
    const effective = resolveComponentPresentation(project, containerId, state.id)
    for (const [id, override] of Object.entries(state.overrides)) if (override.data !== undefined && effective.instances[id])
      override.data = (await prepareWebInstance(effective.instances[id], ['instances', containerId, 'container', 'presentation', 'states', stateIndex, 'overrides', id, 'data'])).data
  }

  const assetIds=new Set<string>()
  const resources={assets:{...sources.assetBytes},components:sources.componentFiles??{}}
  const references=createComponentReferenceCapture(project,resources)
  const versions=[project,...Object.values(project.instances).flatMap(instance=>(instance.container?.presentation?.states??[]).map(state=>resolveComponentPresentation(project,instance.id,state.id)))]
  const runtimeAssets = (instance: typeof project.instances[string], version: CourseProjectV10) => {
    // Every effective state is visited below. Do not also collect its raw editor
    // override as a container dependency (including restore-original image refs).
    const current = instance.container?.presentation ? { ...instance, container: { ...instance.container, presentation: undefined } } : instance
    return runtimeImageAssetIds(current, version.definitions[current.definitionId], references.componentAssetIds(current,version.definitions[current.definitionId],version))
  }
  const demands = publishedImageDemands(versions, runtimeAssets)
  const embeddedUrls = new Map<string, string>()
  for(const version of versions)for(const instance of Object.values(version.instances)){
    for(const id of runtimeAssets(instance,version))assetIds.add(id)
    if(instance.container)for(const id of componentBackgroundAssetIds(resolveComponentBackground(version,instance.container)))assetIds.add(id)
  }
  for(const id of componentBackgroundAssetIds(project.background))assetIds.add(id)
  for(const asset of Object.values(project.theme?.assets??{}))assetIds.add(asset.assetId)
  for(const sound of Object.values(project.media?.audio.sounds??{}))assetIds.add(sound.assetId)
  const assets: PublishedCourseV4['assets'] = {}
  for (const origin of project.logic?.network?.connectOrigins ?? []) diagnostics.push({
    code: 'network-dependency', message: `课程声明网络地址 ${origin}；导出保留网络行为，相应功能在离线时需要网络。`, path: ['logic', 'network', 'connectOrigins'],
  })
  for (const [id, asset] of Object.entries(project.assets)) {
    if(!assetIds.has(id))continue
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
      let deliveryBytes:Uint8Array=Uint8Array.from(bytes),deliveryAsset=asset
      if(options.deliveryAsset)try{const encoded=await options.deliveryAsset(asset,deliveryBytes,options.imageDemands?.[id] ?? demands.get(id));check();if(encoded){deliveryBytes=encoded.bytes;deliveryAsset={...asset,mimeType:encoded.mimeType,byteLength:encoded.bytes.length,...(encoded.filename?{filename:encoded.filename}:{}),...(encoded.width ? {width:encoded.width} : {}),...(encoded.height ? {height:encoded.height} : {}),remote:undefined};const{path:_path,...metadata}=deliveryAsset;assets[id]=metadata}}
      catch(error){options.signal?.throwIfAborted();diagnostics.push({code:'asset-encoding-warning',severity:'warning',message:`资源 ${id} 的交付编码未完成，保留可用原始字节：${String(error)}`,path:['assets',id]})}
      let url: string | undefined
      if (options.assetUrl) url = await options.assetUrl(deliveryAsset,deliveryBytes)
      else {
        const key = `${deliveryAsset.mimeType ?? 'application/octet-stream'}:${await resourceContentSha256Async(deliveryBytes)}`
        url = embeddedUrls.get(key)
        if (!url) { url = componentAssetDataUrl(deliveryBytes,deliveryAsset.mimeType); embeddedUrls.set(key,url) }
      }
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
  const payload = publishedCourseV4Schema.parse({ ...runtimeData, schemaVersion: 4, definitions, instances, assets })
  check()
  return { payload, dependencies, diagnostics,
    offlineComplete: diagnostics.every(issue => ['source-compile-warning','asset-encoding-warning'].includes(issue.code))
      && Object.values(assets).every(asset => asset.url?.startsWith('data:') ||
        (!!asset.url && !/^[a-z][a-z\d+.-]*:/i.test(asset.url))),
  }
}

/** Existing internal imports use the same Published 4 producer; no Published 3 writer remains. */
export const buildPublishedCourseV3 = buildPublishedCourseV4
