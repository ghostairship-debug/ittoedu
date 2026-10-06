import { publishedCourseV3Schema, type PublishedCourseV3, type PublishedImplementation } from '../../shared/contracts/component-platform/published'
import { componentDefinitionBuiltinKey, resolveComponentPresentation, type TeacherControllerAction } from '../../shared/contracts/component-platform'
import type { DocumentResources } from '../../shared/workbench/document'
import { mountV10Model } from './ModelPlayer'
import { prepareSandboxComponent, type ComponentBootstrapTransport } from '../../renderer/components/SandboxComponentImplementation'
import { ComponentNavigationOwner } from '../../renderer/components/ComponentNavigationOwner'
import { webContentRealmSource } from '../../components/web/contentRealmImplementation'
import { resolveWebResourceBindings } from '../../components/web/resources'
import { NavigationTasks } from '../behaviors/navigation/NavigationTasks'
import { attachComponentPlatformNavigationKeys } from '../behaviors/navigation/shortcuts'
import type { PlaybackKeyCommand, PresenterInputFeedback } from '../PlayerPresenterInput'

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
  for (const [id, asset] of Object.entries(payload.assets)) {
    if (!asset.url) { options.report?.(`素材字节缺失：${id}`); continue }
    try {
      if (/^data:/i.test(asset.url)) model.resources.assets[id] = embeddedAssetBytes(asset.url)
      else {
        const response = await fetch(asset.url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        model.resources.assets[id] = new Uint8Array(await response.arrayBuffer())
      }
    } catch (error) { options.report?.(`${id}资源不可用：${String(error)}`) }
  }
  let surfaceId = payload.surfaces.find(surface => surface.id === options.initialSurfaceId)?.id ?? payload.surfaces[0]?.id ?? null
  let stateId = options.initialStateId === undefined ? payload.surfaces.find(surface => surface.id === surfaceId)?.presentation?.initialStateId ?? null : options.initialStateId
  let player!: ReturnType<typeof mountV10Model>, stopped = false
  const renderModel = () => ({ ...model, project: resolveComponentPresentation(model.project, surfaceId, stateId) })
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
  player = mountV10Model({ model: renderModel(), root, mode: options.capture ? 'capture' : 'play', runScopeId: `published:${payload.id}:${crypto.randomUUID()}`,
    teacherController: navigation, report: options.report, initialSurfaceId: surfaceId ?? undefined,
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
        { state: () => player.runtime.stateSnapshot(), targets: () => player.runtime.targetSnapshots(), teacherController: navigation,
          connectOrigins: () => model.project.logic?.network?.connectOrigins ?? [], themeCss: () => player.runtime.themeCss(), resources: () => player.runtime.resourceUrls(), resourceBindings: source.resourceBindings, bootstrap: options.componentBootstrap })
    },
    resolveBuiltin: (_key, signal) => prepareSandboxComponent({ format: 'esm', code: webContentRealmSource(), css: '', diagnostics: [] }, signal,
      { builtinKey: _key, state: () => player.runtime.stateSnapshot(), targets: () => player.runtime.targetSnapshots(), teacherController: navigation,
        instance: instance => resolveWebResourceBindings(instance, id => player.runtime.contentAssetUrl(id) ?? payload.assets[id]?.url, options.report), htmlAuthoring: true,
        connectOrigins: () => model.project.logic?.network?.connectOrigins ?? [], themeCss: () => player.runtime.themeCss(), resources: () => player.runtime.resourceUrls(), bootstrap: options.componentBootstrap }),
  })
  await player.ready
  if (surfaceId) player.revealSurface(surfaceId)
  if (!options.capture) navigation.changed()
  const tasks = new NavigationTasks<PlaybackKeyCommand, TeacherControllerAction>({
    resolve: request => {
      const action: TeacherControllerAction = request.kind === 'edge'
        ? { type: 'scene.go', sceneId: model.project.surfaces[request.edge === 'first' ? 0 : model.project.surfaces.length - 1]?.id ?? '' }
        : { type: request.kind === 'scene'
          ? request.direction === 'next' ? 'scene.next' : 'scene.previous'
          : request.direction === 'next' ? 'step.next' : 'step.previous' }
      return navigation.canExecute(action) ? action : null
    },
    prepare() {}, commit: (action, signal) => !signal.aborted && !stopped && navigation.canExecute(action),
    transition: (action, signal) => navigation.execute(action, signal).then(() => {}),
  })
  const stopKeys = options.capture || options.keyboardNavigation === false ? undefined : attachComponentPlatformNavigationKeys({ root, navigation: tasks,
    keyboardNavigation: model.project.playback?.keyboardNavigation ?? true,
    presenter: model.project.playback?.presenter ?? { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    onAuthoredCommand: command => player.runtime.dispatchPresenterCommand(command), onFeedback: options.onFeedback,
    onError: error => options.report?.(String(error)) })
  const placement = navigation.subscribe(() => {
    const offset = navigation.placement()
    const shell = root.querySelector<HTMLElement>('[data-component-model-player]')
    const fittedScale = shell?.offsetWidth ? shell.getBoundingClientRect().width / shell.offsetWidth : 1
    const scale = fittedScale > 0 ? fittedScale : 1
    for (const id of model.project.global.overlay) {
      const instance = model.project.instances[id], definition = instance && model.project.definitions[instance.definitionId]
      const target = player.runtime.targetElement(id)
      if (target && componentDefinitionBuiltinKey(definition) === 'guoling.navigation') target.style.translate = `${offset.x / scale}px ${offset.y / scale}px`
    }
  })
  let disposal: Promise<void> | undefined
  const dispose = () => {
    if (disposal) return disposal
    stopped = true; stopKeys?.destroy(); tasks.dispose(); navigation.dispose(); placement()
    disposal = player.dispose()
    return disposal
  }
  return { ...player, get ready() { return player.ready }, navigation,
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

