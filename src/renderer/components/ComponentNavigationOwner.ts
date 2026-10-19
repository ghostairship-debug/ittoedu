import type { CourseProjectV10, TeacherControllerAction, TeacherControllerPort, TeacherControllerSnapshot } from '../../shared/contracts/component-platform'
import { navigationGuardHasSource } from '../../shared/courseNavigationGuards'
import type { ComponentSpatialCameraPort } from '../../player/surfaces/spatial/componentSpatialAdapter'
import type { ComponentRuntimeNavigationPort } from '../../player/components/runtime/ComponentRuntimeHost'
import { spatialFramePose, spatialTourSteps, spatialPlaybackPathId, spatialFragmentProgress, type SpatialTourStep } from '../../player/surfaces/spatial/componentPlatform/graph'
import { componentSurfaceGeometryTargets } from '../../player/componentPlatform/spatialTargets'
import { componentFragmentStateKey } from '../../player/componentPlatform/fragments'
import { matchesPublishedCourseStateCondition } from '../../player/surfaces/publishedCourseState'
import type { AudioManager } from '../../player/AudioManager'
import { createTeacherControllerHudGeometry, isGlobalTeacherController, teacherControllerAuthoredCollapsed, teacherControllerExpandedWidth, teacherControllerFrameOrigin, teacherControllerIsCollapsed, teacherControllerReferenceSize, teacherControllerViewportFrame } from '../../shared/teacherControllerViewportGeometry'
import { multiplyMatrices } from '../../core/components/geometry'
import { plainDocumentText, documentTextContentSchema } from '../../shared/document/content'
import { componentDefinitionBuiltinKey, isComponentVisibleAtSurface, owningContainer } from '../../shared/contracts/component-platform'
import { NavigationTasks } from '../../player/behaviors/navigation/NavigationTasks'
import type { PlaybackKeyCommand } from '../../player/PlayerPresenterInput'
import type { ComponentCameraMotion } from '../../shared/contracts/component-platform/navigationMotion'
import { presentNavigationTransition } from '../../player/behaviors/navigation/navigationTransition'

export interface ComponentCameraBinding {
  frameId(): string | null
  selectFrame(frameId: string | null): void
  pathId?(): string | null | undefined
  stepIndex?(): number | null
  selectStep?(index: number | null): void
  viewport?(): { width: number; height: number }
}
/** A surface's existing observation state remains its only view owner. */
export interface ComponentObservationBinding {
  readZoom(): number
  setZoom(zoom: number): void
  reset(): void
  /** The mounted Flow owns scrolling and expanding the requested formal body target. */
  goToInstance?(instanceId: string | null, signal?: AbortSignal): boolean | Promise<boolean>
}

interface NavigationPorts {
  project(): CourseProjectV10
  surfaceId(): string | null
  interactive?(): boolean
  select(surfaceId: string, signal?: AbortSignal, onCommit?: () => void): boolean | void | Promise<boolean | void>
  stateId?(): string | null
  selectState?(stateId: string | null, surfaceId: string, signal?: AbortSignal, onCommit?: () => void): boolean | void | Promise<boolean | void>
  courseState?: { get<T = unknown>(key: string): T | undefined; set?(key: string, value: number): void }
  audio?(): AudioManager | undefined
  report?(message: string): void
  restart?(): void | Promise<void>
  presentationRoot?(): HTMLElement | undefined
  /** Static capture changes view geometry without advancing playback fragments. */
  capture?: boolean
  viewportBounds?(): { left: number; top: number; right: number; bottom: number } | undefined
}

/** Surface and camera view state are supplied by their owner; no author data is changed here. */
export class ComponentNavigationOwner implements TeacherControllerPort {
  private readonly listeners = new Set<() => void>()
  private readonly replayListeners = new Set<(surfaceId: string) => void>()
  /** Playback overrides the authored default; the editor always follows its formal quick-bar value. */
  private readonly views = new Map<string, { offset: { x: number; y: number }; collapsed?: boolean; listeners: Set<() => void> }>()
  private readonly placementListeners = new Set<() => void>()
  private readonly instancePorts = new Map<string, TeacherControllerPort>()
  private zoom = 1
  private readonly states = new Map<string, string | null>()
  private readonly fragmentCache = new Map<string, { html: string; count: number }>()
  private fragmentProject?: CourseProjectV10
  private readonly surfaceFragments = new Map<string, ReadonlyMap<string, number>>()
  private runtime?: ComponentRuntimeNavigationPort
  private fragmentRevision = 0
  private readonly cameras = new Map<string, { camera: ComponentSpatialCameraPort; binding?: ComponentCameraBinding; frameId: string | null; stepIndex: number | null; off(): void }>()
  private readonly observations = new Map<string, ComponentObservationBinding>()
  private directoryProject?: CourseProjectV10
  private readonly directories = new Map<string, NonNullable<TeacherControllerSnapshot['scenes'][number]['targets']>>()
  private readonly cursorSteps = new Map<string, { project: CourseProjectV10; pathId: string | null; fragmentRevision: number; steps: readonly SpatialTourStep[] }>()
  private transition?: AbortController
  private teacherNavigation?: TeacherControllerPort & { subscribeSceneReplay: ComponentNavigationOwner['subscribeSceneReplay']; placement: ComponentNavigationOwner['placement'] }
  private editorNavigation?: TeacherControllerPort & Pick<ComponentNavigationOwner, 'placement'>
  private retired = false
  constructor(private readonly ports: NavigationPorts) {}
  /** World owns preparation; navigation consumes only the actual loaded generation. */
  connectRuntime = (runtime: ComponentRuntimeNavigationPort): (() => void) => {
    if (this.retired) return () => {}
    this.runtime = runtime; this.surfaceFragments.clear(); this.fragmentRevision++; this.changed()
    return () => {
      if (this.runtime !== runtime) return
      this.runtime = undefined; this.surfaceFragments.clear(); this.fragmentRevision++; this.changed()
    }
  }
  runtimeCapabilitiesChanged = (instanceId: string): void => {
    if (this.retired || !this.runtime) return
    const project = this.ports.project()
    let owner = owningContainer(project, instanceId)
    while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
    if (owner?.kind === 'surface') this.surfaceFragments.delete(owner.surfaceId)
    this.fragmentRevision++; this.changed()
  }
  subscribe = (listener: () => void) => { if (this.retired) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /** Explicit same-scene entry, after navigation/presentation succeeds. */
  subscribeSceneReplay = (listener: (surfaceId: string) => void) => {
    if (this.retired) return () => {}
    this.replayListeners.add(listener)
    return () => { this.replayListeners.delete(listener) }
  }
  changed = () => {
    if (this.retired) return
    const surface = this.activeSurface(), entry = this.cameras.get(surface?.id ?? '')
    if (surface?.kind === 'spatial' && entry) this.spatialCursorIndex(surface.id, entry)
    if (!this.ports.capture) this.applyFragments()
    for (const listener of this.listeners) listener()
  }
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
    if (surface?.kind === 'spatial') return spatialTourSteps(surface.spatial, entry?.binding?.pathId?.(),
      this.viewport(surface.id), componentSurfaceGeometryTargets(project, surface.id), this.fragmentCounts(surfaceId))
    return (surface?.presentation?.states ?? []).map(state => ({ frameId: state.id, title: state.title }))
  }
  private fragmentCounts(surfaceId = this.ports.surfaceId()): ReadonlyMap<string, number> {
    const counts = new Map<string, number>()
    const project = this.ports.project()
    if (project !== this.fragmentProject) { this.fragmentProject = project; this.surfaceFragments.clear() }
    const previous = this.surfaceFragments.get(surfaceId ?? '')
    if (previous) return previous
    const visit = (id: string) => {
      const instance = project.instances[id]
      if (!instance) return
      for (const child of instance.childIds ?? []) visit(child)
      const capability = this.runtime?.read(id)
      if (!capability || !['ready', 'preparing'].includes(capability.status) || capability.document !== 'web' || typeof capability.html !== 'string') return
      const count = this.htmlFragmentCount(id, capability.html)
      if (count) counts.set(instance.id, count)
    }
    for (const id of project.surfaces.find(surface => surface.id === surfaceId)?.childIds ?? []) visit(id)
    this.surfaceFragments.set(surfaceId ?? '', counts)
    return counts
  }
  private htmlFragmentCount(id: string, html: string): number {
    let cached = this.fragmentCache.get(id)
    if (cached?.html !== html) { cached = { html, count: new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.fragment').length }; this.fragmentCache.set(id, cached) }
    return cached.count
  }
  private stepTargetId(surfaceId: string, step: SpatialTourStep): string | undefined {
    return step.frameId ? this.ports.project().surfaces.find(surface => surface.id === surfaceId)?.spatial?.frames.find(frame => frame.id === step.frameId)?.targetInstanceId : step.instanceId
  }
  private pendingStepTarget(surfaceId: string, step: SpatialTourStep | undefined): string | undefined {
    if (!this.runtime || !step) return
    const id = this.stepTargetId(surfaceId, step)
    if (!id) return
    const capability = this.runtime.read(id)
    if (capability.status === 'ready' || capability.status === 'failed') return
    const data = this.ports.project().instances[id]?.data
    const html = capability.html ?? (data && typeof data === 'object' && !Array.isArray(data) ? data.html : undefined)
    return typeof html === 'string' && this.htmlFragmentCount(id, html) > 0 ? id : undefined
  }
  private currentStepPending(): boolean {
    const surface = this.activeSurface()
    return surface?.kind === 'spatial' && Boolean(this.pendingStepTarget(surface.id, (this.steps() as SpatialTourStep[])[this.stepIndex()]))
  }
  private async prepareStepTarget(surfaceId: string, step: SpatialTourStep, signal?: AbortSignal): Promise<boolean> {
    const id = this.pendingStepTarget(surfaceId, step)
    if (!id || !this.runtime) return !signal?.aborted
    const runtime = this.runtime, cancelled = signal ?? new AbortController().signal
    if (!await runtime.prepare(id, cancelled) || cancelled.aborted || this.runtime !== runtime) return false
    this.runtimeCapabilitiesChanged(id)
    return true
  }
  private applyFragments(): void {
    if (!this.ports.courseState?.set) return
    const surface = this.activeSurface(), counts = this.fragmentCounts()
    if (surface?.kind !== 'spatial') { for (const [id, count] of counts) if (this.ports.courseState.get(componentFragmentStateKey(id)) !== count) this.ports.courseState.set(componentFragmentStateKey(id), count); return }
    const entry = this.cameras.get(surface.id), index = entry?.binding?.stepIndex?.() ?? entry?.stepIndex ?? null
    const steps = spatialTourSteps(surface.spatial, entry?.binding?.pathId?.(), this.viewport(surface.id), componentSurfaceGeometryTargets(this.ports.project(), surface.id), counts)
    const progress = spatialFragmentProgress(steps, index, counts)
    for (const [id, count] of progress) if (this.ports.courseState.get(componentFragmentStateKey(id)) !== count) this.ports.courseState.set(componentFragmentStateKey(id), count)
  }
  private stepIndex(): number {
    const surface = this.activeSurface(), entry = this.cameras.get(surface?.id ?? '')
    if (surface?.kind === 'spatial') {
      const index = entry ? this.spatialCursorIndex(surface.id, entry) : null
      if (index !== null && index !== undefined) return index
      const id = entry?.binding?.frameId() ?? entry?.frameId
      return this.steps().findIndex(step => step.frameId === id && id !== null)
    }
    return this.steps().findIndex(step => step.frameId === this.currentStateId()) + 1
  }
  private spatialCursorIndex(surfaceId: string, entry: { binding?: ComponentCameraBinding; frameId: string | null; stepIndex: number | null }): number | null {
    const project = this.ports.project(), pathId = spatialPlaybackPathId(project.surfaces.find(surface => surface.id === surfaceId)?.spatial, entry.binding?.pathId?.()), steps = this.steps(surfaceId) as SpatialTourStep[]
    let index = entry.binding?.stepIndex?.() ?? entry.stepIndex
    const previous = this.cursorSteps.get(surfaceId)
    if (previous && (previous.project !== project || previous.pathId !== pathId || previous.fragmentRevision !== this.fragmentRevision) && index !== null) {
      const old = previous.steps[index]
      const rebased = previous.pathId !== pathId || !old ? -1 : this.relocateStep(steps, old, this.stopOccurrence(previous.steps, index))
      index = rebased < 0 ? null : rebased
      entry.binding?.selectStep?.(index); entry.stepIndex = index
      const frameId = index === null ? null : steps[index].frameId
      entry.binding?.selectFrame(frameId); entry.frameId = frameId
    }
    this.cursorSteps.set(surfaceId, { project, pathId, fragmentRevision: this.fragmentRevision, steps })
    return index
  }
  private stopOccurrence(steps: readonly SpatialTourStep[], index: number): number {
    const target = steps[index]!
    return steps.slice(0, index + 1).filter(step => step.frameId === target.frameId && step.instanceId === target.instanceId && (step.fragmentStep ?? 0) === 0).length - 1
  }
  private relocateStep(steps: readonly SpatialTourStep[], target: SpatialTourStep, occurrence: number, edge?: 'last'): number {
    let at = -1
    const candidates = steps.flatMap((step, index) => {
      if (step.frameId !== target.frameId || step.instanceId !== target.instanceId) return []
      if ((step.fragmentStep ?? 0) === 0) at++
      return at === occurrence ? [index] : []
    })
    if (!candidates.length) return -1
    if (edge === 'last') return candidates[candidates.length - 1]!
    // First discovery expands the same stop at fragment zero; loss/reduction of
    // Web capability stays at this stop rather than resetting the whole cursor.
    return candidates[Math.min(target.fragmentStep ?? 0, candidates.length - 1)]!
  }
  private async presentState(surfaceId: string, stateId: string | null, signal?: AbortSignal, motion?: ComponentCameraMotion, onCommit?: () => void): Promise<boolean> {
    if (signal?.aborted) return false
    const surface = this.ports.project().surfaces.find(value => value.id === surfaceId)
    if (!surface) return false
    if (surface.kind !== 'spatial' || stateId && surface.presentation?.states.some(state => state.id === stateId)) {
      const selected = await this.ports.selectState?.(stateId, surfaceId, signal, onCommit)
      if (selected === false || signal?.aborted) return false
      this.states.set(surfaceId, stateId); onCommit?.()
      this.changed(); return true
    }
    const entry = this.cameras.get(surfaceId)
    if (!entry || !surface.spatial) return stateId === null
    const step = stateId ? this.steps(surfaceId).findIndex(value => value.frameId === stateId) : -1
    if (step >= 0) return this.presentStep(step, signal, surfaceId, true, motion, onCommit)
    const frame = surface.spatial.frames.find(value => value.id === stateId)
    const pose = stateId ? frame && spatialFramePose(frame, this.viewport(surfaceId), componentSurfaceGeometryTargets(this.ports.project(), surfaceId)) : surface.spatial.home
    if (!pose || !await entry.camera.present(pose, { ...motion, signal }) || signal?.aborted) return false
    if (entry.binding) entry.binding.selectFrame(stateId)
    else entry.frameId = stateId
    entry.binding?.selectStep?.(null); entry.stepIndex = null; onCommit?.()
    this.changed(); return true
  }
  private async presentStep(index: number, signal?: AbortSignal, surfaceId = this.ports.surfaceId(), forcePose = false, motion?: ComponentCameraMotion, onCommit?: () => void, edge?: 'last'): Promise<boolean> {
    if (signal?.aborted) return false
    const initialSteps = this.steps(surfaceId), surface = this.ports.project().surfaces.find(value => value.id === surfaceId), step = initialSteps[index]
    if (!surface || !step) return false
    if (surface.kind !== 'spatial') return this.presentState(surface.id, step.frameId, signal, motion, onCommit)
    const entry = this.cameras.get(surface.id)
    if (!entry || !('pose' in step)) return false
    const occurrence = this.stopOccurrence(initialSteps as SpatialTourStep[], index)
    const pathId = spatialPlaybackPathId(surface.spatial, entry.binding?.pathId?.())
    const previousIndex = this.spatialCursorIndex(surface.id, entry)
    const previous = previousIndex === null ? undefined : this.steps(surfaceId)[previousIndex]
    const sameFragmentStop = previous && 'pose' in previous && step.fragmentInstanceId !== undefined
      && previous.fragmentInstanceId === step.fragmentInstanceId && previous.frameId === step.frameId && previous.instanceId === step.instanceId
    // Revealing another fragment at this stop keeps the teacher's current pan/zoom.
    if ((forcePose || !sameFragmentStop) && !await entry.camera.present(step.pose, { ...motion, signal }) || signal?.aborted) return false
    const selectTarget = (): boolean => {
      const project = this.ports.project(), current = project.surfaces.find(value => value.id === surface.id)
      if (signal?.aborted || this.cameras.get(surface.id) !== entry || spatialPlaybackPathId(current?.spatial, entry.binding?.pathId?.()) !== pathId) return false
      const steps = this.steps(surface.id) as SpatialTourStep[], selected = this.relocateStep(steps, step, occurrence, edge)
      if (selected < 0) return false
      this.cursorSteps.set(surface.id, { project, pathId, fragmentRevision: this.fragmentRevision, steps })
      entry.frameId = steps[selected].frameId; entry.stepIndex = selected
      entry.binding?.selectFrame(entry.frameId); entry.binding?.selectStep?.(selected)
      this.changed(); return true
    }
    // Arrive through the existing camera/projection first, then wait only for
    // this stop. Stable target/edge intent survives any newly discovered steps.
    if (!selectTarget()) return false
    onCommit?.()
    if (!await this.prepareStepTarget(surface.id, step, signal) || signal?.aborted) return false
    return selectTarget()
  }
  private async presentSpatialStart(surfaceId: string, signal?: AbortSignal, motion?: ComponentCameraMotion, onCommit?: () => void): Promise<boolean> {
    return this.steps(surfaceId).length ? this.presentStep(0, signal, surfaceId, true, motion, onCommit) : this.presentState(surfaceId, null, signal, motion, onCommit)
  }
  private async presentSurfaceStart(surfaceId: string, signal?: AbortSignal, motion?: ComponentCameraMotion, onCommit?: () => void): Promise<boolean> {
    const surface = this.ports.project().surfaces.find(value => value.id === surfaceId)
    if (!surface) return false
    if (surface.kind !== 'spatial') {
      if (!await this.presentState(surfaceId, surface.presentation?.initialStateId ?? null, signal, motion, onCommit)) return false
      return surface.kind !== 'flow' || await this.observations.get(surfaceId)?.goToInstance?.(null, signal) !== false
    }
    const initial = surface.presentation?.initialStateId ?? null
    if (await this.ports.selectState?.(initial, surfaceId, signal, onCommit) === false || signal?.aborted) return false
    this.states.set(surfaceId, initial); onCommit?.()
    return this.presentSpatialStart(surfaceId, signal, motion, onCommit)
  }
  /** Initial author try-run and Published mount use the same authored tour, without replaying programs. */
  initializeSpatialPlayback = (signal?: AbortSignal, initialFrameId?: string): Promise<boolean> => {
    const surface = this.activeSurface()
    if (this.retired || signal?.aborted) return Promise.resolve(false)
    if (this.ports.capture || surface?.kind !== 'spatial') return Promise.resolve(true)
    if (this.transition) return Promise.resolve(true)
    return this.runTransition(next => initialFrameId && surface.spatial?.frames.some(frame => frame.id === initialFrameId)
      ? this.presentState(surface.id, initialFrameId, next) : this.presentSpatialStart(surface.id, next), signal)
  }
  private blocked(destination: string, report = false): boolean {
    const guard = this.ports.project().logic?.navigationGuards.find(value => value.toSurfaceIds.includes(destination)
      && navigationGuardHasSource(value, this.ports.surfaceId() ?? '')
      && (value.match === 'all' ? value.conditions.every(condition => matchesPublishedCourseStateCondition(this.ports.courseState ?? { get: () => undefined }, condition))
        : value.conditions.some(condition => matchesPublishedCourseStateCondition(this.ports.courseState ?? { get: () => undefined }, condition))))
    if (guard && report) this.ports.report?.(guard.message)
    return Boolean(guard)
  }
  private directoryTargets(surfaceId: string): NonNullable<TeacherControllerSnapshot['scenes'][number]['targets']> {
    const project = this.ports.project(), surface = project.surfaces.find(value => value.id === surfaceId)
    if (this.directoryProject !== project) { this.directoryProject = project; this.directories.clear() }
    const cached = this.directories.get(surfaceId)
    if (cached && surface?.kind !== 'spatial') return cached
    if (!surface) return []
    if (surface.kind === 'slide') return (surface.presentation?.states ?? []).map(state => ({ id: state.id, name: state.title, kind: 'state' as const,
      action: { type: 'scene.go' as const, sceneId: surfaceId, targetStateId: state.id } }))
    if (surface.kind === 'spatial') {
      const targets: NonNullable<TeacherControllerSnapshot['scenes'][number]['targets']>[number][] = []
      for (const frame of surface.spatial?.frames ?? []) targets.push({ id: `frame:${frame.id}`, name: frame.title || project.instances[frame.targetInstanceId ?? '']?.name || '镜头', kind: 'camera',
        action: { type: 'scene.go', sceneId: surfaceId, targetStateId: frame.id } })
      for (const step of this.steps(surfaceId) as SpatialTourStep[]) if (!step.frameId && step.instanceId && !targets.some(target => target.id === `instance:${step.instanceId}`)) {
        targets.push({ id: `instance:${step.instanceId}`, name: step.title || project.instances[step.instanceId]?.name || '镜头目标', kind: 'camera',
          action: { type: 'scene.go', sceneId: surfaceId, targetInstanceId: step.instanceId } })
      }
      return targets
    }
    const targets: NonNullable<TeacherControllerSnapshot['scenes'][number]['targets']>[number][] = []
    const visit = (id: string, depth: number) => {
      const instance = project.instances[id]
      if (!instance || instance.flowPlacement || !isComponentVisibleAtSurface(instance, surfaceId)) return
      const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : {}
      const type = data.type, block = componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.document-block'
      if (block && (type === 'heading' || type === 'section')) {
        const text = documentTextContentSchema.safeParse(type === 'heading' ? data.content : data.title)
        targets.push({ id, name: (text.success ? plainDocumentText(text.data).trim() : '') || instance.name || '标题', kind: 'heading', depth,
          action: { type: 'scene.go', sceneId: surfaceId, targetInstanceId: id } })
      }
      for (const child of instance.childIds ?? []) visit(child, depth + (type === 'section' ? 1 : 0))
    }
    surface.childIds.forEach(id => visit(id, 0))
    this.directories.set(surfaceId, targets)
    return targets
  }
  readLocation = (): string | null => this.ports.surfaceId()
  read = (): TeacherControllerSnapshot => {
    const project = this.ports.project(), id = this.ports.surfaceId(), sceneIndex = project.surfaces.findIndex(surface => surface.id === id)
    const steps = this.steps(), cursor = this.stepIndex(), spatial = this.activeSurface()?.kind === 'spatial'
    const stepIndex = Math.max(0, cursor)
    const interactive = this.ports.interactive?.() ?? true
    return { locationId: id, interactive, scenes: project.surfaces.map(surface => ({ id: surface.id, name: surface.title, targets: this.directoryTargets(surface.id) })),
      progress: sceneIndex < 0 ? null : { sceneIndex, sceneCount: project.surfaces.length, sceneName: project.surfaces[sceneIndex].title,
        stepIndex, stepCount: spatial ? Math.max(1, steps.length) : steps.length + 1, stepName: steps[spatial ? cursor : stepIndex - 1]?.title ?? '' },
      zoom: this.observations.get(id ?? '')?.readZoom() ?? this.cameras.get(id ?? '')?.camera.read().zoom ?? this.zoom,
      camera: this.cameras.get(id ?? '')?.camera.read(),
      muted: this.ports.audio?.()?.muted() ?? false, fullscreen: typeof document !== 'undefined' && Boolean(document.fullscreenElement) }
  }
  canExecute = (action: TeacherControllerAction): boolean => this.canExecuteAction(action)
  private canExecuteAction(action: TeacherControllerAction, teacher = false, pausedNavigation = false): boolean {
    if (this.retired || this.ports.interactive?.() === false && !pausedNavigation) return false
    if (action.type === 'camera.present') return Boolean(this.cameras.get(this.ports.surfaceId() ?? ''))
    const state = this.read(), index = state.progress?.sceneIndex ?? -1
    const lastStep = this.steps().length - (this.activeSurface()?.kind === 'spatial' ? 1 : 0)
    if (action.type === 'step.next' && this.currentStepPending()) return true
    if (action.type === 'step.previous' && this.stepIndex() > 0 || action.type === 'step.next' && this.stepIndex() < lastStep) return true
    if (action.type === 'scene.previous' || action.type === 'step.previous') return index > 0 && !this.blocked(state.scenes[index - 1].id)
    if (action.type === 'scene.next' || action.type === 'step.next') return index >= 0 && index < state.scenes.length - 1 && !this.blocked(state.scenes[index + 1].id)
    if (action.type === 'scene.go') return this.ports.project().surfaces.some(surface => surface.id === action.sceneId
      && (!action.targetStateId || surface.presentation?.states.some(value => value.id === action.targetStateId) || surface.spatial?.frames.some(frame => frame.id === action.targetStateId))
      && (!action.targetInstanceId || this.directoryTargets(surface.id).some(target => target.action.targetInstanceId === action.targetInstanceId)))
      && (teacher || action.sceneId === state.locationId || !this.blocked(action.sceneId))
    return action.type === 'scene.replay' && index >= 0 || action.type === 'course.restart' && state.scenes.length > 0
      || action.type === 'audio.toggle-mute' && Boolean(this.ports.audio?.()) || action.type === 'scene.open-picker' || action.type === 'player.fullscreen.toggle'
  }
  /** Only the teacher directory receives forced scene.go; authored/student navigation keeps guards. */
  teacherPort = () => this.teacherNavigation ??= {
    read: this.read, readLocation: this.readLocation, subscribe: this.subscribe, subscribeSceneReplay: this.subscribeSceneReplay,
    viewportBounds: this.viewportBounds, placement: this.placement, subscribePlacement: this.subscribePlacement,
    forInstance: id => this.instancePort(id, true),
    canExecute: action => this.canExecuteAction(action, true), execute: (action, signal, onCommit) => this.executeAction(action, signal, true, false, onCommit), cancel: this.cancel,
    setCollapsed: this.setCollapsed, moveBy: this.moveBy, setZoom: this.setZoom, resetView: this.resetView,
  }
  /** The host's editor chrome navigates the same paused scene; authored controls stay paused. */
  editorPort = () => this.editorNavigation ??= {
    read: this.read, readLocation: this.readLocation, subscribe: this.subscribe, viewportBounds: this.viewportBounds, placement: this.placement, subscribePlacement: this.subscribePlacement,
    forInstance: this.forInstance,
    canExecute: action => this.canExecuteAction(action, false, this.editorNavigationAction(action)),
    execute: (action, signal, onCommit) => this.executeAction(action, signal, false, this.editorNavigationAction(action), onCommit), cancel: this.cancel,
    setCollapsed: this.setCollapsed, moveBy: this.moveBy, setZoom: this.setZoom, resetView: this.resetView,
  }
  private editorNavigationAction(action: TeacherControllerAction): boolean {
    return ['step.previous', 'step.next', 'scene.previous', 'scene.next', 'scene.go', 'scene.replay'].includes(action.type)
  }
  execute = (action: TeacherControllerAction, signal?: AbortSignal, onCommit?: () => void): Promise<boolean> => this.executeAction(action, signal, false, false, onCommit)
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
  private async executeAction(action: TeacherControllerAction, signal?: AbortSignal, teacher = false, pausedNavigation = false, onCommit?: () => void): Promise<boolean> {
    if (this.retired || signal?.aborted) return false
    if (!this.canExecuteAction(action, teacher, pausedNavigation)) { if (action.type === 'scene.go') this.blocked(action.sceneId, true); return false }
    if (action.type === 'audio.toggle-mute' || action.type === 'player.fullscreen.toggle' || action.type === 'scene.open-picker') return this.executeNavigation(action, signal)
    return this.runTransition(async next => {
      if (action.type === 'camera.present') return this.cameras.get(this.ports.surfaceId() ?? '')?.camera.present(action.pose, { ...action.motion, signal: next }) ?? false
      let committed = false
      const commit = () => { if (!committed) { committed = true; onCommit?.() } }
      const navigate = () => this.executeNavigation(action, next, teacher, commit)
      if ('transition' in action && action.transition) {
        if (this.ports.capture || action.transition.effect === 'none' || action.transition.durationMs === 0) return navigate()
        const root = this.ports.presentationRoot?.()
        if (!root) throw new Error('当前宿主没有页面转场画面；页面尚未切换。')
        return presentNavigationTransition(root, action.transition, navigate, next)
      }
      return navigate()
    }, signal).catch(error => { this.ports.report?.(error instanceof Error ? error.message : String(error)); return false })
  }
  private async runTransition(run: (signal: AbortSignal) => Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
    const request = new AbortController(), previous = this.transition
    this.transition = request
    previous?.abort()
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try { return await run(request.signal) }
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
    this.views.clear(); this.instancePorts.clear(); this.placementListeners.clear(); this.cameras.clear(); this.observations.clear(); this.listeners.clear(); this.replayListeners.clear(); this.states.clear(); this.fragmentCache.clear(); this.surfaceFragments.clear(); this.fragmentProject = undefined; this.cursorSteps.clear(); this.runtime = undefined
  }
  private async executeNavigation(action: TeacherControllerAction, signal?: AbortSignal, teacher = false, onCommit?: () => void): Promise<boolean> {
    if (signal?.aborted) return false
    if (action.type === 'step.next' || action.type === 'step.previous') {
      const current = this.activeSurface(), step = (this.steps() as SpatialTourStep[])[this.stepIndex()]
      if (current?.kind === 'spatial' && step && !await this.prepareStepTarget(current.id, step, signal)) return false
      if (signal?.aborted) return false
    }
    const state = this.read(), index = state.progress?.sceneIndex ?? -1
    const motion = 'camera' in action ? action.camera : undefined
    const spatial = this.activeSurface()?.kind === 'spatial', cursor = this.stepIndex(), lastStep = this.steps().length - (spatial ? 1 : 0)
    if (action.type === 'step.previous' && cursor > 0) return spatial ? this.presentStep(cursor - 1, signal, undefined, false, motion, onCommit)
      : cursor === 1 ? this.presentState(state.locationId!, null, signal, motion, onCommit) : this.presentStep(cursor - 2, signal, undefined, false, motion, onCommit)
    if (action.type === 'step.next' && cursor < lastStep) return this.presentStep(cursor + (spatial ? 1 : 0), signal, undefined, false, motion, onCommit)
    let destination: string | undefined, stateId: string | null | undefined
    if (action.type === 'scene.previous' || action.type === 'step.previous') destination = state.scenes[index - 1]?.id
    else if (action.type === 'scene.next' || action.type === 'step.next') destination = state.scenes[index + 1]?.id
    else if (action.type === 'scene.go') { destination = action.sceneId; stateId = action.targetStateId }
    else if (action.type === 'scene.replay') { destination = state.locationId!; stateId = this.activeSurface()?.presentation?.initialStateId ?? null }
    else if (action.type === 'course.restart') destination = state.scenes[0].id
    else if (action.type === 'scene.open-picker') return false // The builtin opens its own directory from read().scenes.
    else if (action.type === 'audio.toggle-mute') this.ports.audio?.()?.toggleMuted()
    else if (action.type === 'player.fullscreen.toggle') {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    }
    if (destination) {
      // A course reset must reach its start even when reset state blocks ordinary visits there.
      if (destination !== state.locationId && action.type !== 'course.restart' && action.type !== 'scene.replay' && !(teacher && action.type === 'scene.go') && this.blocked(destination, true)) return false
      // Replay keeps the current surface and its mounted program; only its transient view is reset.
      if (destination !== state.locationId && await this.ports.select(destination, signal, onCommit) === false) return false
      if (signal?.aborted) return false
      // Restart generations only after the location owner has selected the first surface.
      if (action.type === 'course.restart') { onCommit?.(); await this.ports.restart?.(); if (signal?.aborted) return false }
      const last = action.type === 'step.previous' ? this.steps(destination).length - 1 : -1
      const targetInstanceId = action.type === 'scene.go' ? action.targetInstanceId : undefined
      if (targetInstanceId) {
        const surface = this.ports.project().surfaces.find(value => value.id === destination)
        if (surface?.kind === 'flow') {
          if (!await this.observations.get(destination)?.goToInstance?.(targetInstanceId, signal)) return false
        } else {
          const target = (this.steps(destination) as SpatialTourStep[]).findIndex(step => step.instanceId === targetInstanceId)
          if (target < 0 || !await this.presentStep(target, signal, destination, true, motion, onCommit)) return false
        }
      } else if (!(last >= 0 ? await this.presentStep(last, signal, destination, false, motion, onCommit, 'last')
        : action.type === 'scene.replay' || stateId === undefined ? await this.presentSurfaceStart(destination, signal, motion, onCommit)
        : await this.presentState(destination, stateId, signal, motion, onCommit))) return false
      if (signal?.aborted) return false
      onCommit?.()
      if (action.type === 'scene.replay') {
        this.resetViewState(this.activeSurface()?.kind !== 'spatial', true)
        for (const listener of this.replayListeners) listener(destination)
      }
    }
    else if (action.type === 'step.next' || action.type === 'step.previous' || action.type === 'scene.next' || action.type === 'scene.previous') return false
    this.changed(); return true
  }
  subscribePlacement = (listener: () => void) => {
    this.placementListeners.add(listener)
    return () => { this.placementListeners.delete(listener) }
  }
  private placementChanged() { for (const listener of this.placementListeners) listener() }
  forInstance = (id: string): TeacherControllerPort => this.instancePort(id)
  private instancePort(id: string, teacher = false): TeacherControllerPort {
    const key = `${teacher}:${id}`, existing = this.instancePorts.get(key)
    if (existing) return existing
    let view = this.views.get(id)
    if (!view) { view = { offset: { x: 0, y: 0 }, listeners: new Set() }; this.views.set(id, view) }
    const state = view
    const privileged = () => teacher && isGlobalTeacherController(this.ports.project(), id)
    const port: TeacherControllerPort = {
      readLocation: this.readLocation,
      read: () => {
        const shared = this.read(), project = this.ports.project()
        const authored = isGlobalTeacherController(project, id) ? teacherControllerAuthoredCollapsed(project, id, shared.locationId ?? '') : false
        return { ...shared, collapsed: shared.interactive ? state.collapsed ?? authored : authored }
      },
      subscribe: listener => { const off = this.subscribe(listener); state.listeners.add(listener); return () => { off(); state.listeners.delete(listener) } },
      subscribePlacement: this.subscribePlacement, viewportBounds: this.viewportBounds,
      placement: () => ({ ...state.offset }),
      canExecute: action => this.canExecuteAction(action, privileged()),
      execute: (action, signal, onCommit) => this.executeAction(action, signal, privileged(), false, onCommit), cancel: this.cancel,
      setCollapsed: value => { if (this.retired || state.collapsed === value) return; state.collapsed = value; this.placementChanged(); for (const listener of state.listeners) listener() },
      moveBy: (dx, dy) => this.moveInstance(id, state, port, dx, dy),
      setZoom: this.setZoom, resetView: () => { state.offset = { x: 0, y: 0 }; this.placementChanged(); this.resetView() },
    }
    this.instancePorts.set(key, port)
    return port
  }
  private moveInstance(id: string, view: { offset: { x: number; y: number } }, port: TeacherControllerPort, dx: number, dy: number) {
    if (this.retired || !Number.isFinite(dx) || !Number.isFinite(dy)) return
    const project = this.ports.project(), bounds = this.ports.viewportBounds?.(), frame = project.instances[id]?.frame
    if (frame && bounds && bounds.right > bounds.left && bounds.bottom > bounds.top) {
      const viewport = { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }, collapsed = teacherControllerIsCollapsed(project, id, port)
      const geometry = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(project), viewportRect: { x: 0, y: 0, ...viewport } })
      const projected = { ...frame, transform: [...multiplyMatrices(geometry.authorToViewport, frame.transform)] as typeof frame.transform }
      const expandedWidth = teacherControllerExpandedWidth(project, id, this.ports.surfaceId() ?? '')
      const shown = teacherControllerViewportFrame(projected, viewport, view.offset, collapsed, expandedWidth)
      const origin = teacherControllerFrameOrigin(projected, collapsed, expandedWidth)
      view.offset = { x: dx === 0 ? view.offset.x : shown.transform[4] + dx - origin.x,
        y: dy === 0 ? view.offset.y : shown.transform[5] + dy - origin.y }
    } else view.offset = { x: view.offset.x + dx, y: view.offset.y + dy }
    this.placementChanged()
  }
  // Unbound host chrome has no component placement of its own.
  setCollapsed = (_value: boolean) => {}
  moveBy = (_dx: number, _dy: number) => {}
  setZoom = (value: number) => {
    if (this.retired || !Number.isFinite(value) || value <= 0) return
    const id = this.ports.surfaceId() ?? '', observation = this.observations.get(id), camera = this.cameras.get(id)?.camera
    if (observation) observation.setZoom(value)
    else if (camera) camera.set({ ...camera.read(), zoom: value })
    else this.zoom = value
    this.changed()
  }
  private resetViewState(resetCamera: boolean, resetPlacement = false) {
    if (this.retired) return
    this.zoom = 1
    if (resetPlacement) { for (const view of this.views.values()) view.offset = { x: 0, y: 0 }; this.placementChanged() }
    const surface = this.activeSurface(), id = surface?.id ?? '', observation = this.observations.get(id), camera = this.cameras.get(id)?.camera
    if (observation) observation.reset()
    else if (resetCamera && camera && surface?.spatial) camera.set(surface.spatial.home)
    this.changed()
  }
  resetView = () => this.resetViewState(true)
  viewportBounds = () => this.retired ? undefined : this.ports.viewportBounds?.()
  placement = () => ({ x: 0, y: 0, zoom: this.zoom })
}
