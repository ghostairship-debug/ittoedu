import type { CourseProjectV10, TeacherControllerAction, TeacherControllerPort, TeacherControllerSnapshot } from '../../shared/contracts/component-platform'
import { owningContainer } from '../../shared/contracts/component-platform'
import type { ComponentSpatialCameraPort } from '../../player/surfaces/spatial/componentSpatialAdapter'
import { spatialFramePose, spatialTourSteps, spatialFragmentProgress } from '../../player/surfaces/spatial/componentPlatform/graph'
import { componentSurfaceGeometryTargets } from '../../player/componentPlatform/spatialTargets'
import { componentFragmentStateKey } from '../../player/componentPlatform/fragments'
import { matchesPublishedCourseStateCondition } from '../../player/surfaces/publishedCourseState'
import type { AudioManager } from '../../player/AudioManager'
import { createTeacherControllerHudGeometry, isGlobalTeacherController, teacherControllerAuthoredCollapsed, teacherControllerFrameOrigin, teacherControllerIsCollapsed, teacherControllerReferenceSize, teacherControllerViewportFrame } from '../../shared/teacherControllerViewportGeometry'
import { multiplyMatrices } from '../../core/components/geometry'
import { NavigationTasks } from '../../player/behaviors/navigation/NavigationTasks'
import type { PlaybackKeyCommand } from '../../player/PlayerPresenterInput'

export interface ComponentCameraBinding {
  frameId(): string | null
  selectFrame(frameId: string | null): void
  pathId?(): string | null
  stepIndex?(): number | null
  selectStep?(index: number | null): void
  viewport?(): { width: number; height: number }
}
/** A surface's existing observation state remains its only view owner. */
export interface ComponentObservationBinding {
  readZoom(): number
  setZoom(zoom: number): void
  reset(): void
}

interface NavigationPorts {
  project(): CourseProjectV10
  surfaceId(): string | null
  interactive?(): boolean
  select(surfaceId: string, signal?: AbortSignal): boolean | void | Promise<boolean | void>
  stateId?(): string | null
  selectState?(stateId: string | null, surfaceId: string, signal?: AbortSignal): boolean | void | Promise<boolean | void>
  courseState?: { get<T = unknown>(key: string): T | undefined; set?(key: string, value: number): void }
  audio?(): AudioManager | undefined
  report?(message: string): void
  restart?(): void | Promise<void>
  viewportBounds?(): { left: number; top: number; right: number; bottom: number } | undefined
}

/** Surface and camera view state are supplied by their owner; no author data is changed here. */
export class ComponentNavigationOwner implements TeacherControllerPort {
  private readonly listeners = new Set<() => void>()
  private readonly replayListeners = new Set<(surfaceId: string) => void>()
  /** Playback overrides the authored default; the editor always follows its formal quick-bar value. */
  private collapsed: boolean | undefined
  private zoom = 1
  private offset = { x: 0, y: 0 }
  private readonly states = new Map<string, string | null>()
  private readonly fragmentCache = new Map<string, { html: string; count: number }>()
  private readonly cameras = new Map<string, { camera: ComponentSpatialCameraPort; binding?: ComponentCameraBinding; frameId: string | null; stepIndex: number | null; off(): void }>()
  private readonly observations = new Map<string, ComponentObservationBinding>()
  private transition?: AbortController
  private teacherNavigation?: TeacherControllerPort & { subscribeSceneReplay: ComponentNavigationOwner['subscribeSceneReplay']; placement: ComponentNavigationOwner['placement'] }
  private editorNavigation?: TeacherControllerPort & Pick<ComponentNavigationOwner, 'placement'>
  private retired = false
  constructor(private readonly ports: NavigationPorts) {}
  subscribe = (listener: () => void) => { if (this.retired) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /** Explicit same-scene entry, after navigation/presentation succeeds. */
  subscribeSceneReplay = (listener: (surfaceId: string) => void) => {
    if (this.retired) return () => {}
    this.replayListeners.add(listener)
    return () => { this.replayListeners.delete(listener) }
  }
  changed = () => { if (!this.retired) { this.applyFragments(); for (const listener of this.listeners) listener() } }
  registerCamera = (surfaceId: string, camera: ComponentSpatialCameraPort, binding?: ComponentCameraBinding) => {
    if (this.retired) return () => {}
    this.cameras.get(surfaceId)?.off()
    const entry = { camera, binding, frameId: null as string | null, stepIndex: null as number | null, off: () => {} }
    this.cameras.set(surfaceId, entry)
    entry.off = camera.subscribe(this.changed)
    return () => { entry.off(); if (this.cameras.get(surfaceId) === entry) this.cameras.delete(surfaceId) }
  }
  registerObservation = (surfaceId: string, binding: ComponentObservationBinding): (() => void) => {
    if (this.retired) return () => {}
    this.observations.set(surfaceId, binding); this.changed()
    return () => { if (this.observations.get(surfaceId) === binding) this.observations.delete(surfaceId) }
  }
  currentStateId = (): string | null => {
    if (this.ports.stateId) return this.ports.stateId()
    const surface = this.activeSurface()
    return surface ? this.states.has(surface.id) ? this.states.get(surface.id)! : surface.presentation?.initialStateId ?? null : null
  }
  private activeSurface() { return this.ports.project().surfaces.find(value => value.id === this.ports.surfaceId()) }
  private viewport(surfaceId: string) {
    return this.cameras.get(surfaceId)?.binding?.viewport?.()
      ?? this.ports.project().surfaces.find(value => value.id === surfaceId)?.designSize ?? { width: 960, height: 640 }
  }
  private steps(surfaceId = this.ports.surfaceId()) {
    const project = this.ports.project(), surface = project.surfaces.find(value => value.id === surfaceId), entry = this.cameras.get(surface?.id ?? '')
    if (surface?.kind === 'spatial') return spatialTourSteps(surface.spatial, entry?.binding?.pathId?.() ?? null,
      this.viewport(surface.id), componentSurfaceGeometryTargets(project, surface.id), this.fragmentCounts(surfaceId))
    return (surface?.presentation?.states ?? []).map(state => ({ frameId: state.id, title: state.title }))
  }
  private fragmentCounts(surfaceId = this.ports.surfaceId()): ReadonlyMap<string, number> {
    const counts = new Map<string, number>()
    const project = this.ports.project()
    for (const instance of Object.values(project.instances)) {
      let owner = owningContainer(project, instance.id)
      while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
      if (owner?.kind !== 'surface' || owner.surfaceId !== surfaceId) continue
      const implementation = project.definitions[instance.definitionId]?.implementation
      const data = instance.data, html = data && typeof data === 'object' && !Array.isArray(data) ? data.html : undefined
      if (implementation?.kind !== 'builtin' || !['guoling.web', 'guoling.html-program'].includes(implementation.key) || typeof html !== 'string') continue
      let cached = this.fragmentCache.get(instance.id)
      if (cached?.html !== html) { cached = { html, count: new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.fragment').length }; this.fragmentCache.set(instance.id, cached) }
      if (cached.count) counts.set(instance.id, cached.count)
    }
    return counts
  }
  private applyFragments(): void {
    if (!this.ports.courseState?.set) return
    const surface = this.activeSurface(), counts = this.fragmentCounts()
    if (surface?.kind !== 'spatial') { for (const [id, count] of counts) this.ports.courseState.set(componentFragmentStateKey(id), count); return }
    const entry = this.cameras.get(surface.id), index = entry?.binding?.stepIndex ? entry.binding.stepIndex() : entry?.stepIndex ?? null
    const steps = spatialTourSteps(surface.spatial, entry?.binding?.pathId?.() ?? null, this.viewport(surface.id), componentSurfaceGeometryTargets(this.ports.project(), surface.id), counts)
    const progress = spatialFragmentProgress(steps, index, counts)
    for (const [id, count] of progress) if (this.ports.courseState.get(componentFragmentStateKey(id)) !== count) this.ports.courseState.set(componentFragmentStateKey(id), count)
  }
  private stepIndex(): number {
    const surface = this.activeSurface(), entry = this.cameras.get(surface?.id ?? '')
    if (surface?.kind === 'spatial') {
      const index = entry?.binding?.stepIndex ? entry.binding.stepIndex() : entry?.stepIndex
      if (index !== null && index !== undefined) return index + 1
      const id = entry?.binding?.frameId() ?? entry?.frameId
      return this.steps().findIndex(step => step.frameId === id && id !== null) + 1
    }
    return this.steps().findIndex(step => step.frameId === this.currentStateId()) + 1
  }
  private async presentState(surfaceId: string, stateId: string | null, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false
    const surface = this.ports.project().surfaces.find(value => value.id === surfaceId)
    if (!surface) return false
    if (surface.kind !== 'spatial' || stateId && surface.presentation?.states.some(state => state.id === stateId)) {
      const selected = await this.ports.selectState?.(stateId, surfaceId, signal)
      if (selected === false || signal?.aborted) return false
      this.states.set(surfaceId, stateId)
      this.changed(); return true
    }
    const entry = this.cameras.get(surfaceId)
    if (!entry || !surface.spatial) return stateId === null
    const frame = surface.spatial.frames.find(value => value.id === stateId)
    const pose = stateId ? frame && spatialFramePose(frame, this.viewport(surfaceId), componentSurfaceGeometryTargets(this.ports.project(), surfaceId)) : surface.spatial.home
    if (!pose || !await entry.camera.present(pose, { signal }) || signal?.aborted) return false
    if (entry.binding) entry.binding.selectFrame(stateId)
    else entry.frameId = stateId
    entry.binding?.selectStep?.(null); entry.stepIndex = null
    this.changed(); return true
  }
  private async presentStep(index: number, signal?: AbortSignal, surfaceId = this.ports.surfaceId()): Promise<boolean> {
    if (signal?.aborted) return false
    const surface = this.ports.project().surfaces.find(value => value.id === surfaceId), step = this.steps(surfaceId)[index]
    if (!surface || !step) return false
    if (surface.kind !== 'spatial') return this.presentState(surface.id, step.frameId, signal)
    const entry = this.cameras.get(surface.id)
    if (!entry || !('pose' in step)) return false
    const previousIndex = entry.binding?.stepIndex?.() ?? entry.stepIndex
    const previous = previousIndex === null ? undefined : this.steps(surfaceId)[previousIndex]
    const sameFragmentStop = previous && 'pose' in previous && step.fragmentInstanceId !== undefined
      && previous.fragmentInstanceId === step.fragmentInstanceId && previous.frameId === step.frameId && previous.instanceId === step.instanceId
    // Revealing another fragment at this stop keeps the teacher's current pan/zoom.
    if (!sameFragmentStop && !await entry.camera.present(step.pose, { signal }) || signal?.aborted) return false
    if (entry.binding) entry.binding.selectFrame(step.frameId)
    else entry.frameId = step.frameId
    if (entry.binding?.selectStep) entry.binding.selectStep(index)
    else entry.stepIndex = index
    this.changed(); return true
  }
  private blocked(destination: string, report = false): boolean {
    const guard = this.ports.project().logic?.navigationGuards.find(value => value.toSurfaceIds.includes(destination)
      && (!value.fromSurfaceIds?.length || value.fromSurfaceIds.includes(this.ports.surfaceId() ?? ''))
      && (value.match === 'all' ? value.conditions.every(condition => matchesPublishedCourseStateCondition(this.ports.courseState ?? { get: () => undefined }, condition))
        : value.conditions.some(condition => matchesPublishedCourseStateCondition(this.ports.courseState ?? { get: () => undefined }, condition))))
    if (guard && report) this.ports.report?.(guard.message)
    return Boolean(guard)
  }
  read = (): TeacherControllerSnapshot => {
    const project = this.ports.project(), id = this.ports.surfaceId(), sceneIndex = project.surfaces.findIndex(surface => surface.id === id)
    const steps = this.steps(), stepIndex = this.stepIndex()
    const interactive = this.ports.interactive?.() ?? true
    const teacher = [...project.global.underlay, ...project.global.overlay].find(value => isGlobalTeacherController(project, value))
    const authoredCollapsed = teacher ? teacherControllerAuthoredCollapsed(project, teacher, id ?? '') : true
    return { locationId: id, interactive, scenes: project.surfaces.map(surface => ({ id: surface.id, name: surface.title })),
      progress: sceneIndex < 0 ? null : { sceneIndex, sceneCount: project.surfaces.length, sceneName: project.surfaces[sceneIndex].title,
        stepIndex, stepCount: steps.length + 1, stepName: steps[stepIndex - 1]?.title ?? '' },
      collapsed: interactive ? this.collapsed ?? authoredCollapsed : authoredCollapsed, zoom: this.observations.get(id ?? '')?.readZoom() ?? this.cameras.get(id ?? '')?.camera.read().zoom ?? this.zoom,
      muted: this.ports.audio?.()?.muted() ?? false, fullscreen: typeof document !== 'undefined' && Boolean(document.fullscreenElement) }
  }
  canExecute = (action: TeacherControllerAction): boolean => this.canExecuteAction(action)
  private canExecuteAction(action: TeacherControllerAction, teacher = false, pausedNavigation = false): boolean {
    if (this.retired || this.ports.interactive?.() === false && !pausedNavigation) return false
    const state = this.read(), index = state.progress?.sceneIndex ?? -1
    if (action.type === 'step.previous' && this.stepIndex() > 0 || action.type === 'step.next' && this.stepIndex() < this.steps().length) return true
    if (action.type === 'scene.previous' || action.type === 'step.previous') return index > 0 && !this.blocked(state.scenes[index - 1].id)
    if (action.type === 'scene.next' || action.type === 'step.next') return index >= 0 && index < state.scenes.length - 1 && !this.blocked(state.scenes[index + 1].id)
    if (action.type === 'scene.go') return this.ports.project().surfaces.some(surface => surface.id === action.sceneId
      && (!action.targetStateId || surface.presentation?.states.some(value => value.id === action.targetStateId) || surface.spatial?.frames.some(frame => frame.id === action.targetStateId)))
      && (teacher || !this.blocked(action.sceneId))
    return action.type === 'scene.replay' && index >= 0 || action.type === 'course.restart' && state.scenes.length > 0
      || action.type === 'audio.toggle-mute' && Boolean(this.ports.audio?.()) || action.type === 'scene.open-picker' || action.type === 'player.fullscreen.toggle'
  }
  /** Only the teacher directory receives forced scene.go; authored/student navigation keeps guards. */
  teacherPort = () => this.teacherNavigation ??= {
    read: this.read, subscribe: this.subscribe, subscribeSceneReplay: this.subscribeSceneReplay,
    viewportBounds: this.viewportBounds, placement: this.placement,
    canExecute: action => this.canExecuteAction(action, true), execute: action => this.executeAction(action, undefined, true),
    setCollapsed: this.setCollapsed, moveBy: this.moveBy, setZoom: this.setZoom, resetView: this.resetView,
  }
  /** The host's editor chrome navigates the same paused scene; authored controls stay paused. */
  editorPort = () => this.editorNavigation ??= {
    read: this.read, subscribe: this.subscribe, viewportBounds: this.viewportBounds, placement: this.placement,
    canExecute: action => this.canExecuteAction(action, false, this.editorNavigationAction(action)),
    execute: action => this.executeAction(action, undefined, false, this.editorNavigationAction(action)),
    setCollapsed: this.setCollapsed, moveBy: this.moveBy, setZoom: this.setZoom, resetView: this.resetView,
  }
  private editorNavigationAction(action: TeacherControllerAction): boolean {
    return ['step.previous', 'step.next', 'scene.previous', 'scene.next', 'scene.go', 'scene.replay'].includes(action.type)
  }
  execute = (action: TeacherControllerAction, signal?: AbortSignal): Promise<boolean> => this.executeAction(action, signal)
  /** Explicit editor return-to-initial is allowed while this same run is paused. */
  replayCurrentSurface = (signal?: AbortSignal): Promise<boolean> => this.executeAction({ type: 'scene.replay' }, signal, false, true)
  /** Editor try-run and Published share the same key-to-navigation decisions and real completion. */
  createKeyTasks = () => new NavigationTasks<PlaybackKeyCommand, TeacherControllerAction>({
    resolve: request => {
      const surfaces = this.ports.project().surfaces
      const action: TeacherControllerAction = request.kind === 'edge'
        ? { type: 'scene.go', sceneId: surfaces[request.edge === 'first' ? 0 : surfaces.length - 1]?.id ?? '' }
        : { type: request.kind === 'scene' ? request.direction === 'next' ? 'scene.next' : 'scene.previous'
          : request.direction === 'next' ? 'step.next' : 'step.previous' }
      return this.canExecute(action) ? action : null
    },
    prepare() {}, commit: (action, signal) => !signal.aborted && this.canExecute(action),
    transition: (action, signal) => this.execute(action, signal),
  })
  private async executeAction(action: TeacherControllerAction, signal?: AbortSignal, teacher = false, pausedNavigation = false): Promise<boolean> {
    if (this.retired || signal?.aborted) return false
    if (!this.canExecuteAction(action, teacher, pausedNavigation)) { if (action.type === 'scene.go') this.blocked(action.sceneId, true); return false }
    if (action.type === 'audio.toggle-mute' || action.type === 'player.fullscreen.toggle' || action.type === 'scene.open-picker') return this.executeNavigation(action, signal)
    const request = new AbortController(), previous = this.transition
    this.transition = request
    previous?.abort()
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try { return await this.executeNavigation(action, request.signal, teacher) }
    finally {
      signal?.removeEventListener('abort', abort)
      if (this.transition === request) this.transition = undefined
      request.abort()
    }
  }
  /** Replaces pending navigation without changing the last committed location. */
  cancel = () => { const request = this.transition; this.transition = undefined; request?.abort() }
  dispose = () => {
    if (this.retired) return
    this.retired = true; this.cancel()
    for (const entry of this.cameras.values()) entry.off()
    this.cameras.clear(); this.observations.clear(); this.listeners.clear(); this.replayListeners.clear(); this.states.clear(); this.fragmentCache.clear()
  }
  private async executeNavigation(action: TeacherControllerAction, signal?: AbortSignal, teacher = false): Promise<boolean> {
    if (signal?.aborted) return false
    const state = this.read(), index = state.progress?.sceneIndex ?? -1
    if (action.type === 'step.previous' && this.stepIndex() > 0) return this.stepIndex() === 1 ? this.presentState(state.locationId!, null, signal) : this.presentStep(this.stepIndex() - 2, signal)
    if (action.type === 'step.next' && this.stepIndex() < this.steps().length) return this.presentStep(this.stepIndex(), signal)
    let destination: string | undefined, stateId: string | null | undefined
    if (action.type === 'scene.previous' || action.type === 'step.previous') destination = state.scenes[index - 1].id
    else if (action.type === 'scene.next' || action.type === 'step.next') destination = state.scenes[index + 1].id
    else if (action.type === 'scene.go') { destination = action.sceneId; stateId = action.targetStateId }
    else if (action.type === 'scene.replay') { destination = state.locationId!; stateId = this.activeSurface()?.presentation?.initialStateId ?? null }
    else if (action.type === 'course.restart') { await this.ports.restart?.(); if (signal?.aborted) return false; destination = state.scenes[0].id }
    else if (action.type === 'scene.open-picker') return false // The builtin opens its own directory from read().scenes.
    else if (action.type === 'audio.toggle-mute') this.ports.audio?.()?.toggleMuted()
    else if (action.type === 'player.fullscreen.toggle') {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    }
    if (destination) {
      // A course reset must reach its start even when reset state blocks ordinary visits there.
      if (action.type !== 'course.restart' && action.type !== 'scene.replay' && !(teacher && action.type === 'scene.go') && this.blocked(destination, true)) return false
      // Replay keeps the current surface and its mounted program; only its transient view is reset.
      if (action.type !== 'scene.replay' && await this.ports.select(destination, signal) === false) return false
      if (signal?.aborted) return false
      const surface = this.ports.project().surfaces.find(value => value.id === destination)
      const last = action.type === 'step.previous' ? this.steps(destination).length - 1 : -1
      if (!(last >= 0 ? await this.presentStep(last, signal, destination)
        : await this.presentState(destination, stateId === undefined ? surface?.presentation?.initialStateId ?? null : stateId, signal))) return false
      if (signal?.aborted) return false
      if (action.type === 'scene.replay') {
        // A spatial surface can also have presentation states; its tour cursor still returns to home.
        const entry = this.cameras.get(destination)
        if (entry) { entry.binding?.selectFrame(null); entry.binding?.selectStep?.(null); entry.frameId = null; entry.stepIndex = null }
        this.resetView()
        for (const listener of this.replayListeners) listener(destination)
      }
    }
    this.changed(); return true
  }
  setCollapsed = (value: boolean) => { if (!this.retired) { this.collapsed = value; this.changed() } }
  moveBy = (dx: number, dy: number) => {
    if (this.retired || !Number.isFinite(dx) || !Number.isFinite(dy)) return
    const project = this.ports.project(), bounds = this.ports.viewportBounds?.()
    const id = [...project.global.underlay, ...project.global.overlay].find(value => isGlobalTeacherController(project, value))
    const frame = id && project.instances[id]?.frame
    if (frame && bounds && bounds.right > bounds.left && bounds.bottom > bounds.top) {
      const viewport = { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }, collapsed = teacherControllerIsCollapsed(project, id!, this)
      const geometry = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(project), viewportRect: { x: 0, y: 0, ...viewport } })
      const projected = { ...frame, transform: [...multiplyMatrices(geometry.authorToViewport, frame.transform)] as typeof frame.transform }
      const shown = teacherControllerViewportFrame(projected, viewport, this.offset, collapsed)
      const origin = teacherControllerFrameOrigin(projected, collapsed)
      this.offset = { x: dx === 0 ? this.offset.x : shown.transform[4] + dx - origin.x,
        y: dy === 0 ? this.offset.y : shown.transform[5] + dy - origin.y }
    } else this.offset = { x: this.offset.x + dx, y: this.offset.y + dy }
    this.changed()
  }
  setZoom = (value: number) => {
    if (this.retired || !Number.isFinite(value) || value <= 0) return
    const id = this.ports.surfaceId() ?? '', observation = this.observations.get(id), camera = this.cameras.get(id)?.camera
    if (observation) observation.setZoom(value)
    else if (camera) camera.set({ ...camera.read(), zoom: value })
    else this.zoom = value
    this.changed()
  }
  resetView = () => {
    if (this.retired) return
    this.zoom = 1; this.offset = { x: 0, y: 0 }
    const surface = this.activeSurface(), id = surface?.id ?? '', observation = this.observations.get(id), camera = this.cameras.get(id)?.camera
    if (observation) observation.reset()
    else if (camera && surface?.spatial) camera.set(surface.spatial.home)
    this.changed()
  }
  viewportBounds = () => this.retired ? undefined : this.ports.viewportBounds?.()
  placement = () => ({ ...this.offset, zoom: this.zoom })
}

