import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { DocumentModel } from '../../shared/workbench/document'
import { componentCompilationInput } from '../../core/components/compilation/componentCompilationInput'
import type { ComponentPlatformRuntime } from '../../player/components/ComponentPlatformRuntime'
import { createV10ModelPlayer, type ComponentModelPlayer, type ComponentProjectionCommit } from '../../player/componentPlatform/ModelPlayer'
import { prepareSandboxComponent } from './SandboxComponentImplementation'
import { CourseV10DocumentView, InstanceView } from '../documents/CourseV10DocumentView'
import type { CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import type { ComponentSpatialCameraPort } from '../../player/surfaces/spatial/componentSpatialAdapter'
import type { ComponentAuthorGeometry, ComponentEdit, CourseProjectV10 } from '../../shared/contracts/component-platform'
import type { DocumentOperation } from '../document/editorSession'
import { webContentRealmSource } from '../../components/web/contentRealmImplementation'
import { projectWebModuleGraph } from '../../components/web/moduleGraph'
import { resolveWebResourceBindings } from '../../components/web/resources'
import { ComponentNavigationOwner, type ComponentCameraBinding, type ComponentObservationBinding } from './ComponentNavigationOwner'
import { resolveComponentPresentation } from '../../shared/contracts/component-platform'
import { onComponentMotionPreview } from '../interactions/componentMotionPreview'
import { registerRuntimeLightEditDocument } from '../composition/runtime/runtimeLightEditCommands'
import { attachComponentPlatformNavigationKeys } from '../../player/behaviors/navigation/shortcuts'

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
  onElement(instanceId: string, element: HTMLElement | null): void
  onTargetElement(instanceId: string, element: HTMLElement | null): void
  edit(edits: ComponentEdit[], historyGroup?: string): Promise<unknown>
  onEdits(edits: ComponentEdit[], operation?: DocumentOperation): void
  onComposition(instanceId: string, active: boolean): void
  selectInstances(ids: readonly string[], surfaceId?: string): void
  registerCamera(surfaceId: string, camera: ComponentSpatialCameraPort, binding?: ComponentCameraBinding): () => void
  registerObservation(surfaceId: string, binding: ComponentObservationBinding): () => void
  setPlaying(active: boolean): void
  resetPlayback(playing?: boolean): Promise<void>
  previewAuthorSpot(id: string, geometry: ComponentAuthorGeometry | null): boolean
  /** Free placement includes authored frames; flow placement continues reading order through document sections. */
  renderInstance(instanceId: string, projection?: CourseProjectV10, placement?: 'free' | 'flow'): ReactNode
}

const RuntimeContext = createContext<CourseV10RuntimePorts | null>(null)
interface ProjectionView { surfaceId: string | null; stateId?: string | null }
interface ProjectionNavigationCommit {
  view: ProjectionView | null
  pending?: { target: ProjectionView; finish(accepted: boolean): void }
}
export function useCourseV10Runtime(): CourseV10RuntimePorts {
  const ports = useContext(RuntimeContext)
  if (!ports) throw new Error('工作区需要挂载在 CourseV10RuntimeView 内')
  return ports
}

export interface CourseV10RuntimeViewProps {
  documentId: string; model: Extract<DocumentModel, { kind: 'course-v10' }>; surfaceId: string | null
  selectedInstanceId: string | null; player: boolean; onSelect(id: string | null): void; report(message: string): void
  selectedInstanceIds?: readonly string[]
  activeStateId?: string | null
  /** The original workspace's one pure state/draft projection, supplied by its owner. */
  renderProject?: CourseProjectV10
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
  const projectionNavigation = useMemo<ProjectionNavigationCommit>(() => ({ view: null }), [documentId])
  const composing = useRef<string | null>(null)
  const compositionUpdate = useRef<Promise<void>>(Promise.resolve())
  current.current = model
  callbacks.current = props; surface.current = surfaceId; activeState.current = props.activeStateId ?? null
  const navigation = useMemo(() => new ComponentNavigationOwner({ project: () => current.current.project, surfaceId: () => surface.current,
    interactive: () => runtimeRef.current?.isPlaying() ?? Boolean(player),
    stateId: () => activeState.current,
    select: (id, signal) => selectProjection({ surfaceId: id }, () => { surface.current = id; callbacks.current.onSurfaceSelect(id) }, signal),
    selectState: (id, nextSurfaceId, signal) => {
      if (!callbacks.current.bridge && id !== (callbacks.current.activeStateId ?? null)) return false
      return selectProjection({ surfaceId: nextSurfaceId, stateId: id }, () => {
        activeState.current = id; callbacks.current.bridge?.selectPresentationState(documentId, id, nextSurfaceId)
      }, signal)
    },
    courseState: { get: <T,>(key: string) => runtimeRef.current?.getState(key) as T | undefined, set: (key, value) => runtimeRef.current?.setState(key, value) },
    viewportBounds: () => (wrapper.current?.querySelector<HTMLElement>('.flow-workspace') ?? wrapper.current?.querySelector<HTMLElement>('.canvas-viewport') ?? wrapper.current)?.getBoundingClientRect(),
    restart: () => runtimeRef.current?.resetPlayback(true), audio: () => runtimeRef.current?.audio(), report: message => callbacks.current.report(message) }), [documentId])
  const host = useMemo(() => {
    const teacherController = navigation.teacherPort()
    const mounted = createV10ModelPlayer({ runScopeId: `document:${documentId}:${crypto.randomUUID()}`,
      report: message => callbacks.current.report(message),
      mode: player ? 'play' : 'edit',
      teacherController, studentNavigation: navigation,
      onDispose: () => { projectionNavigation.pending?.finish(false); navigation.dispose() },
      resolveBuiltin: (_key, signal) => prepareSandboxComponent({ format: 'esm', code: webContentRealmSource(), css: '', diagnostics: [] }, signal,
        { builtinKey: _key, state: () => runtime.stateSnapshot(), targets: profile => runtime.targetSnapshots(profile), instance: async value => resolveWebResourceBindings(await projectWebModuleGraph(value, input => window.desktopAPI.compileComponent(input), message => callbacks.current.report(message)), id => runtime.contentAssetUrl(id), message => callbacks.current.report(message)), htmlAuthoring: true, teacherController,
          connectOrigins: () => current.current.project.logic?.network?.connectOrigins ?? [], themeCss: () => runtime.themeCss(), resources: () => runtime.resourceUrls() }),
      resolveSource: async (implementation, signal) => {
        const input = componentCompilationInput(current.current.project, implementation, current.current.resources)
        const compilation = await window.desktopAPI.compileComponent(input)
        if (signal.aborted) throw new Error('组件源码准备已取消')
        if (compilation.status === 'failed') throw new Error(compilation.diagnostics.map(value => `${value.file ?? ''}:${value.line ?? ''} ${value.message}`).join('\n'))
        return prepareSandboxComponent(compilation.artifact, signal, { state: () => runtime.stateSnapshot(), targets: () => runtime.targetSnapshots('full'), teacherController,
          connectOrigins: () => current.current.project.logic?.network?.connectOrigins ?? [], themeCss: () => runtime.themeCss(), resources: () => runtime.resourceUrls(), resourceBindings: implementation.resourceBindings })
      },
    })
    const runtime = mounted.runtime
    return mounted
  }, [documentId, navigation])
  const world = host.runtime
  runtimeRef.current = world
  const renderProject = props.renderProject ?? resolveComponentPresentation(model.project, surfaceId, props.activeStateId ?? null)
  const matchesProjection = (target: ProjectionView) => projectionNavigation.view?.surfaceId === target.surfaceId
    && (target.stateId === undefined || projectionNavigation.view.stateId === target.stateId)
  function selectProjection(target: ProjectionView, select: () => void, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false)
    return new Promise((resolve, reject) => {
      projectionNavigation.pending?.finish(false)
      const finish = (accepted: boolean) => {
        signal?.removeEventListener('abort', abort)
        if (projectionNavigation.pending === pending) projectionNavigation.pending = undefined
        resolve(accepted)
      }
      const abort = () => finish(false), pending = { target, finish }
      projectionNavigation.pending = pending
      signal?.addEventListener('abort', abort, { once: true })
      try { select(); if (matchesProjection(target)) finish(true) }
      catch (error) {
        signal?.removeEventListener('abort', abort)
        if (projectionNavigation.pending === pending) projectionNavigation.pending = undefined
        reject(error)
      }
    })
  }
  useEffect(() => {
    // Child camera/observation effects have installed their ports at this real React commit.
    // Navigation waits for this projection, not for arbitrary source mounts in the runtime queue.
    projectionNavigation.view = { surfaceId, stateId: props.activeStateId ?? null }
    const pending = projectionNavigation.pending
    if (pending && matchesProjection(pending.target)) pending.finish(true)
  }, [projectionNavigation, surfaceId, props.activeStateId])
  useEffect(() => host.retain(), [host])
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
  useEffect(() => { navigation.changed() }, [navigation, surfaceId, model.project.surfaces])
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
  const resetPlayback = useCallback(async (playing?: boolean) => {
    if (!await navigation.replayCurrentSurface()) throw new Error('当前页未能返回初始状态')
    world.setPlaying(playing ?? false)
    navigation.changed()
  }, [world, navigation])
  const selectedInstanceIds = props.selectedInstanceIds ?? (selectedInstanceId ? [selectedInstanceId] : [])
  const ports: CourseV10RuntimePorts = {
    documentId, project: renderProject, resources: model.resources, surfaceId, selectedInstanceId, selectedInstanceIds, player,
    world, navigation, onElement: world.bind, onTargetElement: world.bindTarget, edit, onEdits: flowEdit,
    onComposition: compose, selectInstances, registerCamera, registerObservation,
    setPlaying, resetPlayback, previewAuthorSpot: world.previewAuthorSpot,
    renderInstance: (id, projection = renderProject, placement = 'free') => projection.instances[id] && <InstanceView key={id} instance={projection.instances[id]} project={projection} surfaceId={surfaceId} placement={placement}
      selectedInstanceId={selectedInstanceId} selectedInstanceIds={selectedInstanceIds} player={player} onSelect={onSelect} onElement={world.bind} onTargetElement={world.bindTarget} />,
  }
  return <RuntimeContext.Provider value={ports}><ProjectionMutationBoundary model={{ ...model, project: renderProject }} host={host} projectionKey={projectionKey}
    report={error => callbacks.current.report(error instanceof Error ? error.message : '组件运行未完成')}>
    <div ref={wrapper} style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
      {props.renderWorkspace ? props.renderWorkspace(ports) : props.children ?? <CourseV10DocumentView project={renderProject} surfaceId={surfaceId}
        selectedInstanceId={selectedInstanceId} selectedInstanceIds={selectedInstanceIds} player={player} onSelect={onSelect} onElement={world.bind} onTargetElement={world.bindTarget} />}
    </div>
  </ProjectionMutationBoundary></RuntimeContext.Provider>
}

/** React ancestor moves must not reload an already mounted source iframe. */
class ProjectionMutationBoundary extends Component<{ model: Extract<DocumentModel, { kind: 'course-v10' }>; host: ComponentModelPlayer; projectionKey?: string; report(error: unknown): void; children: ReactNode }> {
  private readonly initial: ComponentProjectionCommit
  constructor(props: ProjectionMutationBoundary['props']) {
    super(props)
    this.initial = props.host.prepareProjection(props.model, props.projectionKey)
  }
  componentDidMount(): void {
    void this.props.host.commitProjection(this.initial).catch(this.props.report)
  }
  getSnapshotBeforeUpdate(): ComponentProjectionCommit {
    return this.props.host.prepareProjection(this.props.model, this.props.projectionKey)
  }
  componentDidUpdate(_previous: Readonly<ProjectionMutationBoundary['props']>, _state: unknown, receipt: ComponentProjectionCommit): void {
    void this.props.host.commitProjection(receipt).catch(this.props.report)
  }
  render() { return this.props.children }
}
