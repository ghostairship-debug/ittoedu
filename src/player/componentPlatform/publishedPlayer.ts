import { publishedCourseV3Schema, type PublishedCourseV3, type PublishedImplementation } from '../../shared/contracts/component-platform/published'
import { nanoid } from 'nanoid'
import { resolveComponentPresentation } from '../../shared/contracts/component-platform'
import type { DocumentResources } from '../../shared/workbench/document'
import { mountV10Model } from './ModelPlayer'
import { prepareSandboxComponent, type ComponentBootstrapTransport } from '../../renderer/components/SandboxComponentImplementation'
import { ComponentNavigationOwner } from '../../renderer/components/ComponentNavigationOwner'
import { webContentRealmSource } from '../../components/web/contentRealmImplementation'
import { resolveWebResourceBindings } from '../../components/web/resources'
import { attachComponentPlatformNavigationKeys } from '../behaviors/navigation/shortcuts'
import type { PresenterInputFeedback } from '../PlayerPresenterInput'
import { waitForPublishedObservationReady } from '../surfaces/publishedCapture'

/** One read-only P0 projection into R0; never saved as an author document. */
export function publishedComponentModel(payload: PublishedCourseV3) {
  return { kind: 'course-v10' as const, project: { schemaVersion: 10 as const, revision: 0, id: payload.id, title: payload.title,
    definitions: payload.definitions, instances: payload.instances, surfaces: payload.surfaces, global: payload.global,
    background: payload.background, theme: payload.theme, designTokens: payload.designTokens, playback: payload.playback, media: payload.media, logic: payload.logic,
    assets: Object.fromEntries(Object.entries(payload.assets).map(([id, asset]) => { const { url: _url, ...metadata } = asset; return [id, { ...metadata, path: `assets/${encodeURIComponent(id)}` }] })) },
    resources: { assets: {}, components: {} } as DocumentResources }
}

export interface PublishedComponentPlayerOptions {
  report?(message: string): void
  onFeedback?(feedback: PresenterInputFeedback): void
  initialSurfaceId?: string
  initialStateId?: string | null
  capture?: boolean
  keyboardNavigation?: boolean
  /** A package host may supply captured local bytes; the existing runtime owns their URLs and lifetime. */
  preparedAssetBytes?: Readonly<Record<string, Uint8Array>>
  /** Font rules explicitly supplied by the export host for its isolated content documents. */
  fontFaceCss?: string
  /** Internal isolated capture transport; no privileged API is installed in its renderer. */
  componentBootstrap?: ComponentBootstrapTransport
}

/** Embedded bytes are local content, so decoding them needs no network/CSP connection. */
function embeddedAssetBytes(url: string): Uint8Array {
  const comma = url.indexOf(',')
  if (comma < 0) throw new Error('内嵌资源缺少数据分隔符')
  const payload = url.slice(comma + 1)
  if (/;base64$/i.test(url.slice(5, comma))) {
    return Uint8Array.from(atob(decodeURIComponent(payload)), character => character.charCodeAt(0))
  }
  // Percent escapes represent bytes, including binary values that are not UTF-8.
  const encoded = new TextEncoder().encode(payload), bytes = new Uint8Array(encoded.length)
  let length = 0
  for (let index = 0; index < encoded.length; index++) {
    const escape = String.fromCharCode(encoded[index + 1] ?? 0, encoded[index + 2] ?? 0)
    if (encoded[index] === 37 && /^[0-9a-f]{2}$/i.test(escape)) {
      bytes[length++] = Number.parseInt(escape, 16); index += 2
    } else bytes[length++] = encoded[index]!
  }
  return bytes.subarray(0, length)
}

export async function mountPublishedCourseV3(value: unknown, root: HTMLElement, options: PublishedComponentPlayerOptions = {}) {
  const payload = publishedCourseV3Schema.parse(value), model = publishedComponentModel(payload)
  model.resources.assets = { ...options.preparedAssetBytes }
  const resourceController = new AbortController(), requested = new Set<string>()
  const resourceJobs = new Set<Promise<void>>(), pendingAssets = new Set<string>(), resourceFailures = new Map<string, Error>()
  // Public resources.url(assetId) is valid without optional source-token bindings.
  // Enumerating this read-only projection never fetches or decodes an asset.
  const publishedResourceUrls = Object.fromEntries(Object.entries(payload.assets).flatMap(([id, asset]) => {
    if (!asset.url) return []
    // Resource references are relative to the package host, never to an opaque component realm.
    try { return [[id, new URL(asset.url, root.ownerDocument.baseURI).href]] }
    catch { return [[id, asset.url]] }
  }))
  let surfaceId = payload.surfaces.find(surface => surface.id === options.initialSurfaceId)?.id ?? payload.surfaces[0]?.id ?? null
  let stateId = options.initialStateId === undefined ? payload.surfaces.find(surface => surface.id === surfaceId)?.presentation?.initialStateId ?? null : options.initialStateId
  let player!: ReturnType<typeof mountV10Model>, stopped = false
  const renderModel = () => ({ ...model, project: resolveComponentPresentation(model.project, surfaceId, stateId) })
  const resolveAssetUrl = (id: string): string | undefined => {
    if (stopped) return undefined
    const asset = payload.assets[id]
    if (asset?.url && /^data:/i.test(asset.url)) {
      if (!requested.has(id)) {
        requested.add(id)
        try { model.resources.assets[id] = embeddedAssetBytes(asset.url) }
        catch (error) { resourceFailures.set(id, new Error(`${id}资源不可用：${String(error)}`)); options.report?.(resourceFailures.get(id)!.message); return undefined }
      }
      return model.resources.assets[id] ? asset.url : undefined
    }
    if (requested.has(id)) return undefined
    requested.add(id)
    if (!asset?.url) { resourceFailures.set(id, new Error(`素材字节缺失：${id}`)); options.report?.(resourceFailures.get(id)!.message); return undefined }
    // Consumers request bytes independently; an unused or stalled later page
    // cannot delay mounting this page. The run owns every outstanding fetch.
    pendingAssets.add(id)
    const job = (async () => {
      try {
        const response = await fetch(publishedResourceUrls[id], { signal: resourceController.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (stopped) return
        model.resources.assets[id] = bytes
        pendingAssets.delete(id)
        // Read the current navigation projection, never the page that started loading.
        await player.update(renderModel())
      } catch (error) {
        if (!stopped) { resourceFailures.set(id, new Error(`${id}资源不可用：${String(error)}`)); options.report?.(resourceFailures.get(id)!.message) }
      } finally { pendingAssets.delete(id) }
    })()
    resourceJobs.add(job)
    void job.then(() => resourceJobs.delete(job))
    return undefined
  }
  const waitForResourceWork = async (work: Promise<unknown>) => {
    const signal = resourceController.signal
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('资源准备已取消')) }
      signal.addEventListener('abort', abort, { once: true })
      work.then(() => { signal.removeEventListener('abort', abort); resolve() }, error => { signal.removeEventListener('abort', abort); reject(error) })
      if (signal.aborted) abort()
    })
    signal.throwIfAborted()
  }
  const waitForCaptureReady = async (element: HTMLElement = root) => {
    // Drain work already requested by mounted consumers, including any resource
    // requests caused by their update. Unused assets never enter this set.
    do { await waitForResourceWork(Promise.all([...resourceJobs])); await waitForResourceWork(player.ready) } while (resourceJobs.size)
    const failure = resourceFailures.values().next().value
    if (failure) throw failure
    await waitForPublishedObservationReady(element, resourceController.signal)
  }
  const navigation = new ComponentNavigationOwner({ project: () => model.project, surfaceId: () => surfaceId, stateId: () => stateId,
    viewportBounds: () => { const rect = root.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } },
    courseState: { get: <T,>(key: string) => player?.runtime.getState(key) as T | undefined, set: (key, value) => player?.runtime.setState(key, value) },
    restart: () => player?.runtime.resetPlayback(true), audio: () => player?.runtime.audio(), report: options.report,
    select: async id => {
      if (stopped || !player.revealSurface(id)) return
      surfaceId = id
      stateId = model.project.surfaces.find(surface => surface.id === id)?.presentation?.initialStateId ?? null
      await player.update(renderModel())
    },
    selectState: async id => { if (stopped) return; stateId = id; await player.update(renderModel()) },
  })
  const teacherController = navigation.teacherPort()
  player = mountV10Model({ model: renderModel(), root, mode: options.capture ? 'capture' : 'play', runScopeId: `published:${payload.id}:${nanoid()}`,
    teacherController, studentNavigation: navigation, report: options.report, initialSurfaceId: surfaceId ?? undefined,
    resolveAssetUrl, isAssetPending: id => pendingAssets.has(id), fontFaceCss: options.fontFaceCss,
    onObservation: options.capture ? undefined : (id, observation) => {
      const unregister = navigation.registerObservation(id, observation)
      const unsubscribe = observation.subscribe?.(navigation.changed)
      return () => { unsubscribe?.(); unregister() }
    },
    onCamera: (id, camera) => {
      let frameId: string | null = null, stepIndex: number | null = null
      return navigation.registerCamera(id, camera, { frameId: () => frameId, selectFrame: value => { frameId = value },
        stepIndex: () => stepIndex, selectStep: value => { stepIndex = value },
        viewport: () => player?.viewport(id) ?? model.project.surfaces.find(surface => surface.id === id)?.designSize ?? { width: 960, height: 640 } })
    },
    resolveSource: async (source, signal) => {
      const compiled = (source as Extract<PublishedImplementation, { kind: 'source' }>).compiled
      if (!compiled) throw new Error('此源码未附可执行ESM；原始源码已保留')
      return prepareSandboxComponent({ format: 'esm', code: compiled.code, css: compiled.css ?? '', diagnostics: [] }, signal,
        { state: () => player.runtime.stateSnapshot(), targets: () => player.runtime.targetSnapshots('full'), teacherController,
          // URL bindings let the realm's actual img/media/fetch consumer request
          // the resource. Merely declaring a binding must not start a download.
          connectOrigins: () => model.project.logic?.network?.connectOrigins ?? [], themeCss: () => player.runtime.themeCss(), resources: () => ({ ...publishedResourceUrls, ...player.runtime.resourceUrls() }), resourceBindings: source.resourceBindings, bootstrap: options.componentBootstrap })
    },
    resolveBuiltin: (_key, signal) => prepareSandboxComponent({ format: 'esm', code: webContentRealmSource(), css: '', diagnostics: [] }, signal,
      { builtinKey: _key, state: () => player.runtime.stateSnapshot(), targets: profile => player.runtime.targetSnapshots(profile), teacherController,
        instance: instance => resolveWebResourceBindings(instance, id => player.runtime.contentAssetUrl(id) ?? publishedResourceUrls[id], options.report), htmlAuthoring: true,
        connectOrigins: () => model.project.logic?.network?.connectOrigins ?? [], themeCss: () => player.runtime.themeCss(), resources: () => ({ ...publishedResourceUrls, ...player.runtime.resourceUrls() }), bootstrap: options.componentBootstrap }),
  })
  try { await player.ready }
  catch (error) { stopped = true; resourceController.abort(); navigation.dispose(); await player.dispose(); throw error }
  if (surfaceId) player.revealSurface(surfaceId)
  if (!options.capture) navigation.changed()
  const tasks = navigation.createKeyTasks()
  const stopKeys = options.capture || options.keyboardNavigation === false ? undefined : attachComponentPlatformNavigationKeys({ root, navigation: tasks,
    keyboardNavigation: model.project.playback?.keyboardNavigation ?? true,
    presenter: model.project.playback?.presenter ?? { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    onAuthoredCommand: command => player.runtime.dispatchPresenterCommand(command), onFeedback: options.onFeedback,
    onError: error => options.report?.(String(error)) })
  let disposal: Promise<void> | undefined
  const dispose = () => {
    if (disposal) return disposal
    stopped = true; resourceController.abort(); stopKeys?.destroy(); tasks.dispose(); navigation.dispose()
    disposal = player.dispose()
    return disposal
  }
  return { ...player, get ready() { return player.ready }, navigation, waitForCaptureReady,
    next: () => stopped ? Promise.resolve(false) : navigation.execute({ type: 'step.next' }),
    previous: () => stopped ? Promise.resolve(false) : navigation.execute({ type: 'step.previous' }),
    go: (id: string, targetStateId?: string) => stopped ? Promise.resolve(false) : navigation.execute({ type: 'scene.go', sceneId: id, targetStateId }),
    revealSurface: (id: string) => {
      if (stopped || !player.revealSurface(id)) return false
      surfaceId = id
      void player.update(renderModel())
      navigation.changed()
      return true
    },
    dispose, destroy: dispose,
  }
}

