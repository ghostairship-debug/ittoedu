import type { ComponentRuntimeContext, ComponentPresentationPort, CourseProjectV10, JsonValue, TeacherControllerPort } from '../../../shared/contracts/component-platform'
import type { InteractionAction, InteractionTrigger, NodeMotionAction } from '../../../shared/interactionTypes'
import type { ComponentInteractionPorts } from '../../../renderer/interactions/componentInteractionRuntime'
import { runComponentNodeMotion } from '../../../renderer/runtime/componentMotionAuthoring'
import { MotionScope } from '../../behaviors/motion/MotionScope'
import type { AudioManager } from '../../AudioManager'
import { isComponentVisibleAtSurface, owningContainer } from '../../../shared/contracts/component-platform'
import { spatialSemanticVisible } from '../../surfaces/spatial/componentPlatform/graph'
import type { ComponentMotionPort, ComponentMotionTask } from '../../../shared/contracts/component-platform/motion'
import { isGlobalTeacherController } from '../../../shared/teacherControllerViewportGeometry'

type ActionContext = Parameters<ComponentInteractionPorts['executeAction']>[1]
type TriggerListener = Parameters<ComponentInteractionPorts['subscribeTrigger']>[1]
export interface ComponentInteractionWorld {
  project(): CourseProjectV10 | undefined
  element(id: string): HTMLElement | undefined
  document(): Document | undefined
  audio(): AudioManager | undefined
  video?(action: Extract<InteractionAction, { type: `video.${string}` }>, signal: AbortSignal): Promise<boolean | undefined>
  navigation?: TeacherControllerPort & { currentStateId?(): string | null }
  report(message: string): void
  active(): boolean
  playback(): boolean
  controlsVisible?(): boolean
}

/** Targets, events and transient values come from the single document world. */
export class ComponentWorldInteractions {
  private readonly motions = new Map<string, MotionScope>()
  private readonly visibility = new Map<string, boolean>()
  private readonly leases = new Map<string, symbol>()
  private readonly presentationVisibility = new Map<string, Map<symbol, { element: HTMLElement; visible: boolean }>>()
  private readonly presentationCleanup = new Map<string, Set<() => void>>()
  private readonly presenterListeners = new Map<'next' | 'previous', Set<() => ReturnType<TriggerListener>>>()
  constructor(private readonly world: ComponentInteractionWorld) {}
  currentSurfaceId(): string { return this.world.navigation?.read().locationId ?? '' }
  private canPresent(id: string): boolean {
    const project = this.world.project(), instance = project?.instances[id]
    if (!project || !instance) return false
    if (!this.world.navigation) return true
    const surfaceId = this.currentSurfaceId()
    let owner = owningContainer(project, id)
    while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
    return (owner?.kind === 'global' || owner?.kind === 'surface' && owner.surfaceId === surfaceId)
      && isComponentVisibleAtSurface(instance, surfaceId)
  }
  surfaceChanged(): void {
    for (const id of this.motions.keys()) if (!this.canPresent(id)) this.cancelMotions(id)
    for (const id of this.presentationCleanup.keys()) if (!this.canPresent(id)) this.retirePresentation(id)
  }

  motionPort(id: string): ComponentMotionPort {
    return { replace: (channel, program): ComponentMotionTask => {
      const element = this.world.element(id)
      if (!element || !element.isConnected || !this.canPresent(id) || !this.world.active())
        return { finished: Promise.resolve({ status: 'cancelled' }), cancel() {} }
      let scope = this.motions.get(id)
      if (!scope) { scope = new MotionScope(); this.motions.set(id, scope) }
      let task: ComponentMotionTask
      const current = () => this.world.active() && this.world.element(id) === element && element.isConnected && this.canPresent(id)
      task = scope.replace(channel, element, context => program({
        signal: context.signal, reducedMotion: context.reducedMotion,
        write: async frame => { if (!current()) { task?.cancel(); return false } return context.write(frame) },
        nextFrame: async () => { const frame = await context.nextFrame(); if (!current()) { task?.cancel(); return null } return frame },
        animate: async (frames, timing) => { if (!current()) { task?.cancel(); return false } return await context.animate(frames, timing) && current() },
        onCleanup: context.onCleanup,
      }))
      return task
    } }
  }
  cancelMotions(id: string): void { this.leases.delete(id); this.motions.get(id)?.dispose(); this.motions.delete(id) }

  presentationPort(id: string): ComponentPresentationPort {
    const own = (dispose: () => void) => {
      const cleanups = this.presentationCleanup.get(id) ?? new Set<() => void>()
      this.presentationCleanup.set(id, cleanups); cleanups.add(dispose)
      return () => { cleanups.delete(dispose); if (!cleanups.size) this.presentationCleanup.delete(id) }
    }
    return {
      feedback: (text = '') => {
        const element = this.world.element(id), output = element?.ownerDocument.createElement('output')
        let disposed = false
        const current = () => !disposed && Boolean(element?.isConnected) && this.world.element(id) === element && this.canPresent(id)
        if (output && current()) { output.setAttribute('aria-live', 'polite'); output.textContent = text; element!.append(output) }
        const dispose = () => { if (disposed) return; disposed = true; output?.remove(); forget() }
        const forget = own(dispose)
        return { setText: async value => { if (!current() || !output) { dispose(); return false } output.textContent = value; return true }, dispose }
      },
      visibility: (visible = true) => {
        const element = this.world.element(id), lease = Symbol(id)
        let disposed = false
        const current = () => !disposed && Boolean(element?.isConnected) && this.world.element(id) === element && this.canPresent(id)
        const set = (value: boolean) => {
          if (!current() || !element) return false
          const leases = this.presentationVisibility.get(id) ?? new Map()
          leases.delete(lease); leases.set(lease, { element, visible: value }); this.presentationVisibility.set(id, leases)
          this.applyVisibility(id); return true
        }
        const dispose = () => {
          if (disposed) return; disposed = true
          const leases = this.presentationVisibility.get(id); leases?.delete(lease)
          if (!leases?.size) this.presentationVisibility.delete(id)
          forget(); this.applyVisibility(id)
        }
        const forget = own(dispose); set(visible)
        return { setVisible: async value => { if (!set(value)) { dispose(); return false } return true }, dispose }
      },
    }
  }
  retirePresentation(id: string): void {
    for (const dispose of [...(this.presentationCleanup.get(id) ?? [])]) dispose()
    this.presentationCleanup.delete(id); this.presentationVisibility.delete(id)
  }

  applyVisibility(id: string, snapshot = this.world.navigation?.read()): void {
    const element = this.world.element(id), project = this.world.project(), instance = project?.instances[id]
    const surfaceId = snapshot?.locationId ?? '', surface = project?.surfaces.find(value => value.id === surfaceId)
    const presentation = [...(this.presentationVisibility.get(id)?.values() ?? [])].filter(value => value.element === element).at(-1)?.visible
    if (element && instance && project) element.hidden = !isComponentVisibleAtSurface(instance, surfaceId)
      || this.world.controlsVisible?.() === false && isGlobalTeacherController(project, id)
      || !spatialSemanticVisible(surface?.spatial, id, snapshot?.zoom ?? 1)
      || !(presentation ?? (this.leases.has(id) ? true : undefined) ?? this.visibility.get(id) ?? (!this.world.playback() || instance.playbackInitialVisibility !== 'hidden'))
  }
  applyAllVisibility(): void { const state = this.world.navigation?.read(); for (const id of Object.keys(this.world.project()?.instances ?? {})) this.applyVisibility(id, state) }
  async motion(action: NodeMotionAction, context: ActionContext, preview = false): Promise<boolean> {
    const element = this.world.element(action.nodeId)
    if (!element || !element.isConnected || !this.canPresent(action.nodeId) || context.signal.aborted) return false
    let motion = this.motions.get(action.nodeId)
    if (!motion) { motion = new MotionScope(); this.motions.set(action.nodeId, motion) }
    const hidden = element.hidden, previous = this.visibility.get(action.nodeId)
    const lease = Symbol(action.nodeId); this.leases.set(action.nodeId, lease)
    element.hidden = false
    const success = await runComponentNodeMotion(motion, 'visibility', element, action, context.signal)
    if (this.leases.get(action.nodeId) !== lease || !element.isConnected || !this.canPresent(action.nodeId)) return false
    this.leases.delete(action.nodeId)
    if (preview || !success) {
      if (previous === undefined) this.visibility.delete(action.nodeId)
      else this.visibility.set(action.nodeId, previous)
      element.hidden = hidden
    } else { this.visibility.set(action.nodeId, action.type === 'node.enter'); this.applyVisibility(action.nodeId) }
    return success
  }
  reset(): void {
    for (const id of [...this.presentationCleanup.keys()]) this.retirePresentation(id)
    this.leases.clear()
    for (const motion of this.motions.values()) motion.dispose()
    this.motions.clear(); this.visibility.clear()
    for (const id of Object.keys(this.world.project()?.instances ?? {})) this.applyVisibility(id)
  }
  resetSurface(surfaceId: string): void {
    const project = this.world.project()
    if (!project) return
    for (const id of Object.keys(project.instances)) {
      let owner = owningContainer(project, id)
      while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
      if (owner?.kind !== 'surface' || owner.surfaceId !== surfaceId) continue
      this.retire(id); this.applyVisibility(id)
    }
  }
  retire(id: string): void { this.retirePresentation(id); this.leases.delete(id); this.motions.get(id)?.dispose(); this.motions.delete(id); this.visibility.delete(id) }
  pause(): void {
    this.leases.clear()
    for (const [id, motion] of this.motions) { motion.dispose(); this.applyVisibility(id) }
    this.motions.clear()
  }
  dispose(): void { this.reset(); this.presenterListeners.clear() }
  async dispatchPresenterCommand(command: 'next' | 'previous'): Promise<boolean> {
    if (!this.world.active()) return false
    const results = await Promise.all([...(this.presenterListeners.get(command) ?? [])].map(async listener => {
      try { return await listener() }
      catch (error) { this.world.report(error instanceof Error ? error.message : String(error)); return false }
    }))
    // A void callback confirms delivery only; professional rules return their actual outcome.
    return results.some(value => value !== false)
  }

  ports(context: ComponentRuntimeContext): ComponentInteractionPorts {
    const { scope } = context, world = this.world
    const currentSurfaceId = () => world.navigation?.read().locationId ?? null
    const currentStateId = () => world.navigation?.currentStateId?.() ?? null
    const subscribeTrigger = (trigger: InteractionTrigger, listener: TriggerListener): (() => void) => {
      if (trigger.type === 'animation.completed') return () => {}
      if (trigger.type === 'scene.enter' || trigger.type === 'presentation.enter') {
        let last = trigger.type === 'scene.enter' ? currentSurfaceId() : currentStateId()
        let stopped = false, initialized = false
        const initialize = () => {
          if (stopped || initialized || !scope.isActive() || !world.active() || trigger.type === 'presentation.enter' && last !== trigger.stateId) return
          initialized = true; void listener()
        }
        const notify = () => {
          const value = trigger.type === 'scene.enter' ? currentSurfaceId() : currentStateId()
          if (value === last) return
          last = value; initialized = false
          initialize()
        }
        const off = world.navigation?.subscribe(notify) ?? (() => {})
        queueMicrotask(initialize)
        const run = scope.events.subscribe('__runtime.playing', value => {
          if (value === true) initialize()
        })
        const replay = trigger.type === 'scene.enter' ? scope.events.subscribe('__runtime.scene.replay', surfaceId => {
          if (stopped || !scope.isActive() || surfaceId !== currentSurfaceId()) return
          const project = world.project()
          if (!project) return
          let owner = owningContainer(project, scope.instanceId)
          while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
          if (owner?.kind === 'surface' && owner.surfaceId === surfaceId) { initialized = true; void listener() }
        }) : () => {}
        return () => { stopped = true; off(); run(); replay() }
      }
      if (trigger.type === 'component.event' || trigger.type === 'runtime.event') {
        return scope.events.subscribe('__component.event', value => {
          if (!world.active() || !value || typeof value !== 'object' || Array.isArray(value) || value.name !== trigger.eventName) return
          if (trigger.type === 'component.event' && value.instanceId !== trigger.nodeId) return
          if (trigger.type === 'runtime.event') {
            const project = world.project(), id = String(value.instanceId)
            const global = project?.global.underlay.includes(id) || project?.global.overlay.includes(id)
            if ((trigger.scope === 'global') !== Boolean(global)) return
          }
          listener(value.value)
        })
      }
      if (trigger.type === 'presenter.command') {
        const callbacks = this.presenterListeners.get(trigger.command) ?? new Set()
        this.presenterListeners.set(trigger.command, callbacks)
        const invoke = () => scope.isActive() && world.active() && this.canPresent(scope.instanceId) ? listener() : false
        callbacks.add(invoke)
        const stop = () => { callbacks.delete(invoke); if (!callbacks.size) this.presenterListeners.delete(trigger.command) }
        scope.cleanup(stop); return stop
      }
      if (trigger.type === 'input.submit' || trigger.type === 'node.activated') {
        return scope.events.subscribe(trigger.type, value => {
          if (world.active() && this.canPresent(trigger.nodeId) && value && typeof value === 'object' && !Array.isArray(value) && value.instanceId === trigger.nodeId) listener(value)
        })
      }
      if (trigger.type === 'node.click') {
        const document = world.document()
        const click = (event: Event) => {
          const element = world.element(trigger.nodeId)
          if (world.active() && this.canPresent(trigger.nodeId) && element && !element.hidden && event.composedPath().includes(element)) listener()
        }
        document?.addEventListener('click', click)
        const off = scope.events.subscribe('__runtime.node-click', value => {
          const element = world.element(trigger.nodeId)
          if (world.active() && this.canPresent(trigger.nodeId) && element && !element.hidden && value && typeof value === 'object' && !Array.isArray(value) && value.instanceId === trigger.nodeId) listener()
        })
        return () => { document?.removeEventListener('click', click); off() }
      }
      // Media controls emit into the same R0 event port, including programmatic playback.
      const name = trigger.type
      let previousSeconds = 0, crossed = false
      const rearm = trigger.type === 'video.time' ? scope.events.subscribe('__runtime.scene.reset', surfaceId => {
        if (surfaceId === currentSurfaceId() && this.canPresent(trigger.nodeId)) { previousSeconds = 0; crossed = false }
      }) : () => {}
      const stop = scope.events.subscribe(name, value => {
        if (!scope.isActive() || !world.active() || !value || typeof value !== 'object' || Array.isArray(value)) return
        if (trigger.type === 'audio.ended') {
          if (value.soundId !== trigger.soundId) return
        } else if (value.instanceId !== trigger.nodeId || !this.canPresent(trigger.nodeId)) return
        if (trigger.type === 'video.time') {
          const seconds = value.seconds
          if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return
          if (seconds < previousSeconds && seconds < trigger.seconds) crossed = false
          previousSeconds = seconds
          if (crossed || seconds < trigger.seconds) return
          crossed = true
        }
        listener(value)
      })
      return () => { stop(); rearm() }
    }
    return { currentSurfaceId, currentStateId,
      courseState: { get: key => scope.state.get(key), set: (key, value) => scope.state.set(key, structuredClone(value) as JsonValue) },
      subscribeTrigger, report: world.report,
      executeAction: async (action: InteractionAction, actionContext: ActionContext) => {
        if (actionContext.signal.aborted || !scope.isActive() || !world.active()) return false
        if (action.type === 'course-state.set') { scope.state.set(action.key, action.value); return true }
        if (action.type === 'node.enter' || action.type === 'node.exit') return this.motion(action, actionContext)
        if (action.type.startsWith('audio.')) return world.audio()?.execute(action as Extract<InteractionAction, { type: `audio.${string}` }>) ?? false
        if (action.type.startsWith('video.')) {
          const videoAction = action as Extract<InteractionAction, { type: `video.${string}` }>
          if (!this.canPresent(videoAction.nodeId)) return false
          const remote = await world.video?.(videoAction, actionContext.signal)
          if (remote !== undefined) return remote
          if (actionContext.signal.aborted || !scope.isActive() || !world.active()) return false
          const video = world.element(videoAction.nodeId)?.querySelector('video')
          if (!video) return false
          if (videoAction.type === 'video.seek') video.currentTime = videoAction.seconds
          else if (videoAction.type === 'video.pause') video.pause()
          else if (videoAction.type === 'video.stop') { video.pause(); video.currentTime = 0 }
          else if (videoAction.type === 'video.toggle' && !video.paused) video.pause()
          else {
            if (videoAction.type === 'video.restart') video.currentTime = 0
            await video.play()
            if (actionContext.signal.aborted || !scope.isActive()) { video.pause(); return false }
          }
          return true
        }
        if (action.type === 'location.go') {
          const surface = world.project()?.surfaces.find(value => value.id === action.locationId)
          return surface ? world.navigation?.execute({ type: 'scene.go', sceneId: surface.id }) ?? false : false
        }
        if (action.type === 'presentation.set') {
          const switched = await (world.navigation?.execute({ type: 'scene.go', sceneId: currentSurfaceId() ?? '', targetStateId: action.stateId }) ?? false)
          if (switched && (action.transition?.duration ?? 0) > 0 && !actionContext.signal.aborted && scope.isActive() && world.active())
            world.report('状态已立即切换，指定过渡尚未执行')
          return switched
        }
        if (action.type === 'course.restart') this.reset()
        return world.navigation?.execute(action as Parameters<TeacherControllerPort['execute']>[0]) ?? false
      },
    }
  }
}
