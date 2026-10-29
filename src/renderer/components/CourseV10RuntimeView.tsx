import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { resolveComponentContainerSizing } from '../../shared/componentPresentation'
import type { DocumentModel } from '../../shared/workbench/document'
import type { ComponentCompilationInput, ComponentCompilationResult } from '../../core/components/compilation/types'
import type { ComponentPlatformRuntime } from '../../player/components/ComponentPlatformRuntime'
import { createV10ModelPlayer, type ComponentModelPlayer, type ComponentProjectionCommit } from '../../player/componentPlatform/ModelPlayer'
import { prepareSandboxComponent } from './SandboxComponentImplementation'
import { CourseV10DocumentView, InstanceView } from '../documents/CourseV10DocumentView'
import { projectContainerPresentationStates, type CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import type { ComponentSpatialCameraPort } from '../../player/surfaces/spatial/componentSpatialAdapter'
import type { ComponentAuthorGeometry, ComponentEdit, CourseProjectV10 } from '../../shared/contracts/component-platform'
import type { DocumentOperation } from '../document/editorSession'
import { webContentRealmSource } from '../../components/web/contentRealmImplementation'
import { projectWebModuleGraph, type WebRuntimeData } from '../../components/web/moduleGraph'
import { hasWebContentData } from '../../components/web/sourcePreparation'
import { resolveWebResourceBindings } from '../../components/web/resources'
import { webRuntimeResourceAddress } from '../../components/web/resourceUrlLease'
import { ComponentNavigationOwner, type ComponentCameraBinding, type ComponentObservationBinding } from './ComponentNavigationOwner'
import { installedBundledFontFaceCss } from '../../shared/fonts/installedBundledFontFaceCss'
import { componentContainers, componentSurface, resolveComponentPresentation, componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform'
import { onComponentMotionPreview } from '../interactions/componentMotionPreview'
import { registerRuntimeLightEditDocument } from '../composition/runtime/runtimeLightEditCommands'
import { attachComponentPlatformNavigationKeys } from '../../player/behaviors/navigation/shortcuts'
import { mountPlaybackNavigationChrome } from '../../player/componentPlatform/playbackNavigationChrome'
import { createComponentModelProjection } from '../../player/componentPlatform/modelProjection'
import type { ComponentPlayerProjection } from '../../player/componentPlatform/ModelPlayer'

/** Temporary reading/observation state for an editor scope, never author content. */
export interface ContainerEditorViewState {
  scrollTop?: number
  scrollLeft?: number
  zoom?: number
  pan?: { x: number; y: number }
  observationContext?: string
}

export interface CourseV10RuntimePorts {
  documentId: string
  project: CourseProjectV10
  resources: Extract<DocumentModel, { kind: 'course-v10' }>['resources']
  surfaceId: string | null
  selectedInstanceId: string | null
  selectedInstanceIds: readonly string[]
  player: boolean
  world: ComponentPlatformRuntime
  navigation: ComponentNavigationOwner
  onElement(instanceId: string, element: HTMLElement | null, expectedDefault?: HTMLElement): void
  onTargetElement(instanceId: string, element: HTMLElement | null, expectedDefault?: HTMLElement): void
  edit(edits: ComponentEdit[], historyGroup?: string): Promise<unknown>
  onEdits(edits: ComponentEdit[], operation?: DocumentOperation): void
  onComposition(instanceId: string, active: boolean): void
  selectInstances(ids: readonly string[], surfaceId?: string): void
  registerCamera(surfaceId: string, camera: ComponentSpatialCameraPort, binding?: ComponentCameraBinding): () => void
  registerObservation(surfaceId: string, binding: ComponentObservationBinding): () => void
  containerViewState?(containerId: string): ContainerEditorViewState
  setPlaying(active: boolean): void
  resetPlayback(playing?: boolean, containerId?: string): Promise<void>
  previewAuthorSpot(id: string, geometry: ComponentAuthorGeometry | null): boolean
  /** A pre-laid-out host delegates a real container to the same local projection. */
  renderContainer(containerId: string, projection?: CourseProjectV10, placement?: 'free' | 'flow'): ReactNode
  /** Free placement includes authored frames; flow placement continues reading order through document sections. */
  renderInstance(instanceId: string, projection?: CourseProjectV10, placement?: 'free' | 'flow' | 'program'): ReactNode
}

const RuntimeContext = createContext<CourseV10RuntimePorts | null>(null)
interface ProjectionView { surfaceId: string | null; stateId?: string | null; containerStates?: Readonly<Record<string, string | null>> }
interface ProjectionNavigationCommit {
  view: ProjectionView | null
  pending: Map<string, { target: ProjectionView; finish(accepted: boolean): void }>
}
export function useCourseV10Runtime(): CourseV10RuntimePorts {
  const ports = useContext(RuntimeContext)
  if (!ports) throw new Error('工作区需要挂载在 CourseV10RuntimeView 内')
  return ports
}

export interface CourseV10RuntimeViewProps {
  documentId: string; model: Extract<DocumentModel, { kind: 'course-v10' }>; surfaceId: string | null
  active?: boolean
  selectedInstanceId: string | null; player: boolean; onSelect(id: string | null): void; report(message: string): void
  selectedInstanceIds?: readonly string[]
  activeStateId?: string | null
  /** An object is already prepared; a callback adds drafts after the shared navigation's state projection. */
  renderProject?: CourseProjectV10 | ((effectiveProject: CourseProjectV10) => CourseProjectV10)
  onSurfaceSelect(id: string): void
  onSelectInstances?(ids: readonly string[], surfaceId?: string): void
  bridge?: CourseV10DocumentBridge
  children?: ReactNode
  renderWorkspace?(ports: CourseV10RuntimePorts): ReactNode
  /** Changes when the original workspace replaces projection ancestors (light/deep or surface). */
  projectionKey?: string
}

export function CourseV10RuntimeView(props: CourseV10RuntimeViewProps) {
  const { documentId, model, surfaceId, selectedInstanceId, player, projectionKey } = props
  const current = useRef(model)
  const activeState = useRef(props.activeStateId ?? null), runtimeRef = useRef<ComponentPlatformRuntime | null>(null)
  const callbacks = useRef(props), surface = useRef(surfaceId), wrapper = useRef<HTMLDivElement>(null)
  const playbackContent = useRef<HTMLDivElement>(null)
  const projectionNavigation = useMemo<ProjectionNavigationCommit>(() => ({ view: null, pending: new Map() }), [documentId])
  const composing = useRef<string | null>(null)
  const compositionUpdate = useRef<Promise<void>>(Promise.resolve())
  current.current = model
  callbacks.current = props
  const bridgeView = props.bridge?.read().views.find(view => view.documentId === documentId)
  const rootInstanceId = bridgeView?.rootInstanceId ?? (surfaceId && model.project.rootIds.includes(surfaceId) ? surfaceId : model.project.entry?.rootInstanceId ?? model.project.rootIds[0] ?? null)
  // Local inspection may replace a workspace; ordinary work-root navigation still starts fresh.
  const editorViews = useMemo(() => new Map<string, ContainerEditorViewState>(), [documentId, rootInstanceId])
  const containerViewState = useCallback((id: string) => {
    let view = editorViews.get(id)
    if (!view) { view = {}; editorViews.set(id, view) }
    return view
  }, [editorViews])
  surface.current = rootInstanceId
  activeState.current = bridgeView?.presentationStates?.[rootInstanceId ?? ''] ?? (surfaceId === rootInstanceId ? props.activeStateId ?? null : null)
  const navigation = useMemo(() => new ComponentNavigationOwner({ project: () => current.current.project, surfaceId: () => surface.current,
    interactive: () => runtimeRef.current?.isPlaying() ?? Boolean(player),
    presentationRoot: id => id && id !== surface.current
      ? Array.from(wrapper.current?.querySelectorAll<HTMLElement>('[data-component-container-preview]') ?? []).find(element => element.dataset.componentContainerPreview === id)
        ?? (callbacks.current.surfaceId === id ? wrapper.current ?? undefined : undefined)
      : wrapper.current ?? undefined,
    stateId: () => activeState.current,
    containerStateId: id => {
      const view = callbacks.current.bridge?.read().views.find(value => value.documentId === documentId)
      return view?.presentationStates && Object.hasOwn(view.presentationStates, id) ? view.presentationStates[id]
        : view?.surfaceId === id ? view.activeStateId : undefined
    },
    select: (id, signal, onCommit) => selectProjection({ surfaceId: id }, () => { surface.current = id; onCommit?.(); callbacks.current.onSurfaceSelect(id) }, signal),
    selectState: (id, nextSurfaceId, signal, onCommit) => {
      if (!callbacks.current.bridge && id !== (callbacks.current.activeStateId ?? null)) return false
      return selectProjection({ surfaceId: nextSurfaceId, stateId: id }, () => {
        if (nextSurfaceId === surface.current) activeState.current = id
        onCommit?.(); callbacks.current.bridge?.selectPresentationState(documentId, id, nextSurfaceId)
      }, signal)
    },
    courseState: { get: <T,>(key: string) => runtimeRef.current?.getState(key) as T | undefined, set: (key, value) => runtimeRef.current?.setState(key, value) },
    viewportBounds: id => {
      const preview = id && id !== surface.current
        ? Array.from(wrapper.current?.querySelectorAll<HTMLElement>('[data-component-container-preview]') ?? []).find(element => element.dataset.componentContainerPreview === id) : undefined
      return (preview ?? wrapper.current?.querySelector<HTMLElement>('.flow-workspace')
        ?? wrapper.current?.querySelector<HTMLElement>('.canvas-viewport')
        ?? wrapper.current?.querySelector<HTMLElement>('[data-program-viewport]') ?? wrapper.current)?.getBoundingClientRect()
    },
    restart: () => runtimeRef.current?.resetPlayback(true, { preserveNavigation: true }), audio: () => runtimeRef.current?.audio(), report: message => callbacks.current.report(message) }), [documentId])
  const host = useMemo(() => {
    const teacherController = navigation.teacherPort()
    const compilations = new WeakMap<ComponentCompilationInput, { consumers: Set<AbortSignal>; promise: Promise<ComponentCompilationResult> }>()
    const compileSource = async (input: ComponentCompilationInput, signal: AbortSignal) => {
      signal.throwIfAborted()
      let entry = compilations.get(input)
      if (!entry) {
        const consumers = new Set<AbortSignal>()
        const promise = Promise.resolve().then(() => {
          if (![...consumers].some(consumer => !consumer.aborted)) throw new Error('组件源码准备已取消')
          return window.desktopAPI.compileComponent(input)
        })
        entry = { consumers, promise }; compilations.set(input, entry)
        void promise.catch(() => { if (compilations.get(input) === entry) compilations.delete(input) })
      }
      entry.consumers.add(signal)
      try {
        const result = await entry.promise
        if (result.status === 'failed' && compilations.get(input) === entry) compilations.delete(input)
        return result
      }
      finally { entry.consumers.delete(signal) }
    }
    const mounted = createV10ModelPlayer({ runScopeId: `document:${documentId}:${crypto.randomUUID()}`,
      fontFaceCss: installedBundledFontFaceCss(document),
      report: message => callbacks.current.report(message),
      mode: player ? 'play' : 'edit', presentationPrepared: true,
      teacherController, studentNavigation: navigation,
      onDispose: () => { for (const pending of projectionNavigation.pending.values()) pending.finish(false); navigation.dispose() },
      resolveBuiltin: async (_key, signal, instance) => {
        const projected = await projectWebModuleGraph(instance, input => window.desktopAPI.compileComponent(input), message => callbacks.current.report(message))
        const graph = (projected.data as unknown as WebRuntimeData).moduleGraph
        if (signal.aborted) throw new Error('组件源码准备已取消')
        const prepared = await prepareSandboxComponent({ format: 'esm', code: webContentRealmSource(), css: '', diagnostics: [] }, signal,
        { builtinKey: _key, state: () => runtime.stateSnapshot(), targetChanges: true, targets: profile => runtime.targetSnapshots(profile), instance: async value => resolveWebResourceBindings((value.data as unknown as WebRuntimeData).moduleGraph ? value : await projectWebModuleGraph(value, input => window.desktopAPI.compileComponent(input), message => callbacks.current.report(message)), id => runtime.contentAssetUrl(id) ? webRuntimeResourceAddress(id) : undefined, message => callbacks.current.report(message)), htmlAuthoring: true, teacherController,
          connectOrigins: () => current.current.project.logic?.network?.connectOrigins ?? [], themeCss: () => runtime.themeCss(), resources: () => runtime.resourceUrls() })
        return { ...prepared, webModuleGraph: graph }
      },
      resolveSource: async (implementation, signal) => {
        signal.throwIfAborted()
        const input = runtime.sourceCompilationInput(implementation)
        const compilation = await compileSource(input, signal)
        if (signal.aborted) throw new Error('组件源码准备已取消')
        if (compilation.status === 'failed') throw new Error(compilation.diagnostics.map(value => `${value.file ?? ''}:${value.line ?? ''} ${value.message}`).join('\n'))
        return prepareSandboxComponent(compilation.artifact, signal, { htmlAuthoring: true,
          webInstance: async value => hasWebContentData(value.data) ? resolveWebResourceBindings(value.data.moduleGraph ? value : await projectWebModuleGraph(value, input => window.desktopAPI.compileComponent(input), message => callbacks.current.report(message)), id => runtime.contentAssetUrl(id) ? webRuntimeResourceAddress(id) : undefined, message => callbacks.current.report(message), implementation.resourceBindings) : value, state: () => runtime.stateSnapshot(), targetChanges: true, targets: profile => runtime.targetSnapshots(profile), teacherController,
          authorHtml: instance => {
            const key = componentDefinitionBuiltinKey(current.current.project.definitions[instance.definitionId]), data = instance.data
            return ['guoling.web', 'guoling.html-program'].includes(key ?? '') && data && typeof data === 'object' && !Array.isArray(data) && typeof data.html === 'string' ? data.html : undefined
          },
          connectOrigins: () => current.current.project.logic?.network?.connectOrigins ?? [], themeCss: () => runtime.themeCss(), resources: () => runtime.resourceUrls(), resourceBindings: implementation.resourceBindings })
      },
    })
    const runtime = mounted.runtime
    return mounted
  }, [documentId, navigation])
  const world = host.runtime
  runtimeRef.current = world
  const navigationStates = useSyncExternalStore(navigation.subscribe, () => JSON.stringify(Object.fromEntries(
    Object.values(current.current.project.instances).filter(instance => instance.container).map(container => [container.id, navigation.currentStateId(container.id)]))))
  const renderProject = useMemo(() => typeof props.renderProject === 'function'
    ? props.renderProject(projectContainerPresentationStates(model.project, JSON.parse(navigationStates) as Record<string, string | null>))
    : props.renderProject ?? projectContainerPresentationStates(model.project, JSON.parse(navigationStates) as Record<string, string | null>),
  [model.project, props.renderProject, navigationStates])
  const matchesProjection = (target: ProjectionView) => target.stateId === undefined
    ? projectionNavigation.view?.surfaceId === target.surfaceId
    : Boolean(target.surfaceId && projectionNavigation.view?.containerStates
      && Object.hasOwn(projectionNavigation.view.containerStates, target.surfaceId)
      && projectionNavigation.view.containerStates[target.surfaceId] === target.stateId)
  function selectProjection(target: ProjectionView, select: () => void, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false)
    return new Promise((resolve, reject) => {
      const key = target.stateId === undefined ? '@work' : target.surfaceId ?? '@work'
      projectionNavigation.pending.get(key)?.finish(false)
      const finish = (accepted: boolean) => {
        signal?.removeEventListener('abort', abort)
        if (projectionNavigation.pending.get(key) === pending) projectionNavigation.pending.delete(key)
        resolve(accepted)
      }
      const abort = () => finish(false), pending = { target, finish }
      projectionNavigation.pending.set(key, pending)
      signal?.addEventListener('abort', abort, { once: true })
      try { select(); if (matchesProjection(target)) finish(true) }
      catch (error) {
        signal?.removeEventListener('abort', abort)
        if (projectionNavigation.pending.get(key) === pending) projectionNavigation.pending.delete(key)
        reject(error)
      }
    })
  }
  useEffect(() => {
    // Child camera/observation effects have installed their ports at this real React commit.
    // Navigation waits for this projection, not for arbitrary source mounts in the runtime queue.
    projectionNavigation.view = { surfaceId: rootInstanceId, stateId: activeState.current, containerStates: JSON.parse(navigationStates) as Record<string, string | null> }
    for (const pending of projectionNavigation.pending.values()) if (matchesProjection(pending.target)) pending.finish(true)
  }, [projectionNavigation, rootInstanceId, navigationStates])
  useEffect(() => host.retain(), [host])
  useEffect(() => {
    const root = wrapper.current, content = playbackContent.current
    // Author workspaces keep their controls; preview uses live authored coverage rather than presence of settings.
    if (!player || !root || !content) return
    const chrome = mountPlaybackNavigationChrome(root, navigation, { content, playback: model.project.playback, active: () => callbacks.current.active !== false,
      report: message => callbacks.current.report(message),onAuthoredCommand:command=>world.dispatchPresenterCommand(command),authoredCommands:()=>world.readPresenterCommands(),canAuthoredCommand:command=>world.canDispatchPresenterCommand(command) })
    return () => chrome.destroy()
  }, [player, navigation, model.project.playback])
  useEffect(() => {
    const root = wrapper.current
    if (!root) return
    const tasks = navigation.createKeyTasks()
    let keys: ReturnType<typeof attachComponentPlatformNavigationKeys> | undefined
    const syncKeys = () => {
      if (!world.isPlaying()) { keys?.destroy(); keys = undefined; tasks.cancel(); return }
      if (keys) return
      keys = attachComponentPlatformNavigationKeys({ root, navigation: tasks,
        keyboardNavigation: model.project.playback?.keyboardNavigation ?? true,
        presenter: model.project.playback?.presenter ?? { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
        onAuthoredCommand: command => world.dispatchPresenterCommand(command),
        onFeedback: feedback => callbacks.current.report(feedback.message), onError: error => callbacks.current.report(String(error)),
      })
    }
    const off = navigation.subscribe(syncKeys); syncKeys()
    return () => { off(); keys?.destroy(); tasks.dispose() }
  }, [world, navigation, model.project.playback])
  useEffect(() => props.bridge ? registerRuntimeLightEditDocument(documentId, world, props.bridge) : undefined, [documentId, world, props.bridge])
  useEffect(() => {
    const pending = new Set<AbortController>(), timers = new Set<ReturnType<typeof setTimeout>>()
    const stop = onComponentMotionPreview(request => {
      const { bridge } = callbacks.current
      if (!bridge || request.target.documentId !== documentId) return
      const matches = () => { try { const target = bridge.captureTarget(documentId); return target.epoch === request.target.epoch && target.project.id === request.target.project.id } catch { return false } }
      if (!matches()) return
      const controller = new AbortController(); pending.add(controller)
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!matches()) { controller.abort(); pending.delete(controller); return }
        void world.previewMotion(request.action, controller.signal).catch(error => callbacks.current.report(String(error))).finally(() => pending.delete(controller))
      }, Math.max(0, request.delayMs))
      timers.add(timer)
    })
    return () => { stop(); timers.forEach(timer => clearTimeout(timer)); pending.forEach(controller => controller.abort()) }
  }, [documentId, world])
  useEffect(() => { navigation.changed() }, [navigation, rootInstanceId, surfaceId, model.project])
  const edit = useCallback((edits: ComponentEdit[], historyGroup?: string) => {
    const { bridge, report } = callbacks.current
    if (!bridge) return Promise.reject(new Error('文档编辑入口不可用'))
    return bridge.edit(edits, historyGroup, documentId).catch(error => { report(error instanceof Error ? error.message : String(error)); throw error })
  }, [documentId])
  const flowEdit = useCallback((edits: ComponentEdit[], operation?: DocumentOperation): void => {
    const { bridge } = callbacks.current
    const content = edits.find(value => value.type === 'data.set' && value.instanceId === composing.current && value.path.length === 1 && value.path[0] === 'content')
    if (content?.type === 'data.set' && bridge) {
      compositionUpdate.current = compositionUpdate.current.then(() => bridge.updateComposition(content.value, documentId))
      const independent = edits.filter(value => value !== content)
      if (independent.length) void edit(independent, operation?.historyGroup).catch(() => {})
    } else void edit(edits, operation?.historyGroup).catch(() => {})
  }, [documentId, edit])
  const compose = useCallback((instanceId: string, active: boolean): void => {
    const { bridge, report } = callbacks.current
    if (!bridge) return
    if (active) { bridge.beginComposition(instanceId, ['content'], documentId); composing.current = instanceId }
    else void compositionUpdate.current.then(() => bridge.endComposition(documentId)).catch(error => report(String(error))).finally(() => { composing.current = null; compositionUpdate.current = Promise.resolve() })
  }, [documentId])
  const selectInstances = useCallback((ids: readonly string[], nextSurfaceId?: string) => {
    const owner = callbacks.current
    if (owner.onSelectInstances) owner.onSelectInstances(ids, nextSurfaceId)
    else if (owner.bridge) owner.bridge.selectInstances(documentId, ids, nextSurfaceId)
    else owner.onSelect(ids.at(-1) ?? null)
  }, [documentId])
  const onSelect = useCallback((id: string | null) => selectInstances(id ? [id] : []), [selectInstances])
  const registerCamera = useCallback((id: string, camera: ComponentSpatialCameraPort, binding?: ComponentCameraBinding) => navigation.registerCamera(id, camera, binding), [navigation])
  const registerObservation = useCallback((id: string, binding: ComponentObservationBinding) => navigation.registerObservation(id, binding), [navigation])
  const setPlaying = useCallback((active: boolean) => {
    const before = world.isPlaying()
    world.setPlaying(active)
    if (world.isPlaying() !== before) navigation.changed()
  }, [world, navigation])
  useEffect(() => {
    if (props.active === false) { navigation.cancel(); setPlaying(false) }
  }, [props.active, navigation, setPlaying])
  const resetPlayback = useCallback(async (playing?: boolean, containerId?: string) => {
    const resetSurfaceId = navigation.readLocation()
    world.setPlaying(playing ?? false)
    const resetRoot = containerId ?? callbacks.current.bridge?.read().views.find(view => view.documentId === documentId)?.rootInstanceId
      ?? current.current.project.entry?.rootInstanceId ?? resetSurfaceId
    if (resetRoot && componentSurface(current.current.project, resetRoot)) {
      const restored = containerId && !current.current.project.rootIds.includes(containerId)
        ? await navigation.editorPort().forContainer!(containerId).execute({ type: 'scene.replay' }) : await navigation.replayCurrentSurface()
      if (!restored) throw new Error('当前容器未能返回初始状态')
    }
    if (resetRoot) await world.resetSurfacePrograms(resetRoot)
    navigation.changed()
  }, [world, navigation, documentId])
  const selectedInstanceIds = props.selectedInstanceIds ?? (selectedInstanceId ? [selectedInstanceId] : [])
  const selectionView = props.bridge?.read()
  const selectionKind = selectionView?.activeDocumentId === documentId ? selectionView.interactionSelection?.kind : undefined
  const renderContainer = (containerId: string, project = renderProject, placement: 'free' | 'flow' = 'free') => <ContainerPreview containerId={containerId} model={{ ...model, project }} world={world} navigation={navigation} report={props.report} placement={placement} />
  const ports: CourseV10RuntimePorts = {
    documentId, project: renderProject, resources: model.resources, surfaceId, selectedInstanceId, selectedInstanceIds, player,
    world, navigation, onElement: world.bind, onTargetElement: world.bindTarget, edit, onEdits: flowEdit,
    onComposition: compose, selectInstances, registerCamera, registerObservation, containerViewState,
    setPlaying, resetPlayback, previewAuthorSpot: world.previewAuthorSpot, renderContainer,
    renderInstance: (id, projection = renderProject, placement = 'free') => projection.instances[id] && <InstanceView key={id} instance={projection.instances[id]} project={projection} authorProject={model.project} surfaceId={surfaceId ?? rootInstanceId} placement={placement}
      selectedInstanceId={selectedInstanceId} selectedInstanceIds={selectedInstanceIds} selectionKind={selectionKind} player={player} isPlaying={() => world.isPlaying()} onSelect={onSelect} onElement={world.bind} onTargetElement={world.bindTarget}
      renderContainer={renderContainer} />,
  }
  const view = props.renderWorkspace ? props.renderWorkspace(ports) : props.children ?? <CourseV10DocumentView project={renderProject} authorProject={model.project} surfaceId={surfaceId} rootInstanceId={rootInstanceId}
    selectedInstanceId={selectedInstanceId} selectedInstanceIds={selectedInstanceIds} selectionKind={selectionKind} player={player} isPlaying={() => world.isPlaying()} onSelect={onSelect} onElement={world.bind} onTargetElement={world.bindTarget}
    renderContainer={renderContainer} />
  return <RuntimeContext.Provider value={ports}><ProjectionMutationBoundary model={{ ...model, project: renderProject }} host={host} projectionKey={projectionKey}
    report={error => callbacks.current.report(error instanceof Error ? error.message : '组件运行未完成')}>
    <div ref={wrapper} style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
      {player ? <div ref={playbackContent} style={{ position: 'absolute', inset: 0, minWidth: 0, minHeight: 0 }}>{view}</div> : view}
    </div>
  </ProjectionMutationBoundary></RuntimeContext.Provider>
}

/** A local view supplies geometry only; its descendants keep this document's one runtime. */
function ContainerPreview({ containerId, model, world, navigation, report, placement }: {
  containerId: string; model: Extract<DocumentModel, { kind: 'course-v10' }>; world: ComponentPlatformRuntime
  navigation: ComponentNavigationOwner; report(message: string): void
  placement: 'free' | 'flow'
}) {
  const naturalHeight = resolveComponentContainerSizing(model.project.instances[containerId], placement)?.naturalHeight ?? false
  const sizing = useRef(naturalHeight)
  sizing.current = naturalHeight
  const root = useRef<HTMLDivElement>(null), mounted = useRef<ComponentPlayerProjection | null>(null)
  const observationBindings = useRef(new Map<string, { observation: NonNullable<ReturnType<NonNullable<ComponentPlayerProjection['observation']>>>; release(): void }>())
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const controller = new AbortController()
    const projection = createComponentModelProjection({ root: element, runtime: world, containerId, get naturalHeight() { return sizing.current }, signal: controller.signal,
      onCamera: (id, camera) => navigation.registerCamera(id, camera) })
    mounted.current = projection
    return () => {
      controller.abort(); mounted.current = null
      for (const binding of observationBindings.current.values()) binding.release()
      observationBindings.current.clear()
      void projection.dispose()
    }
  }, [containerId, world, navigation])
  useLayoutEffect(() => {
    const projection = mounted.current
    if (!projection) return
    try {
      const synchronized = projection.sync(model)
      void Promise.resolve(synchronized).then(() => {
        if (mounted.current !== projection) return
        const bindings = observationBindings.current
        for (const [id, binding] of bindings) if (projection.observation?.(id) !== binding.observation) { binding.release(); bindings.delete(id) }
        for (const container of componentContainers(model.project)) {
          const observation = projection.observation?.(container.id)
          if (observation && !bindings.has(container.id)) bindings.set(container.id,
            { observation, release: navigation.registerObservation(container.id, observation) })
        }
      }).catch(error => report(error instanceof Error ? error.message : String(error)))
    } catch (error) { report(error instanceof Error ? error.message : String(error)) }
  }, [model, navigation, report])
  return <div ref={root} data-component-container-preview={containerId} style={{ position: 'relative', width: '100%', height: naturalHeight ? 'auto' : '100%', minWidth: 0, overflow: naturalHeight ? 'visible' : 'hidden' }} />
}

/** React ancestor moves must not reload an already mounted source iframe. */
class ProjectionMutationBoundary extends Component<{ model: Extract<DocumentModel, { kind: 'course-v10' }>; host: ComponentModelPlayer; projectionKey?: string; report(error: unknown): void; children: ReactNode }> {
  private readonly initial: ComponentProjectionCommit
  constructor(props: ProjectionMutationBoundary['props']) {
    super(props)
    this.initial = props.host.prepareProjection(props.model, props.projectionKey)
  }
  componentDidMount(): void {
    // StrictMode can remount this same retained host after its unmount parking.
    this.props.host.runtime.afterProjectionMutation()
    void this.props.host.commitProjection(this.initial).catch(this.props.report)
  }
  componentWillUnmount(): void {
    // Flow's observation session removes a portal ancestor in its layout
    // cleanup, before descendant NodeViews release their projection refs.
    // Park while those realms are still connected; the existing retain owner
    // decides whether this is a replacement mount or the end of the run.
    this.props.host.runtime.beforeProjectionMutation()
  }
  getSnapshotBeforeUpdate(previous: Readonly<ProjectionMutationBoundary['props']>): ComponentProjectionCommit | null {
    if (previous.host === this.props.host && previous.model.project === this.props.model.project
      && previous.model.resources === this.props.model.resources && previous.projectionKey === this.props.projectionKey) return null
    return this.props.host.prepareProjection(this.props.model, this.props.projectionKey)
  }
  componentDidUpdate(_previous: Readonly<ProjectionMutationBoundary['props']>, _state: unknown, receipt: ComponentProjectionCommit | null): void {
    if (receipt) void this.props.host.commitProjection(receipt).catch(this.props.report)
  }
  render() { return this.props.children }
}
