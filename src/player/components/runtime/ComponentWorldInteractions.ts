import type { ComponentRuntimeContext, ComponentPresentationPort, CourseProjectV10, JsonValue, TeacherControllerPort, TeacherControllerSnapshot } from '../../../shared/contracts/component-platform'
import type { InteractionAction, InteractionTrigger, NodeMotionAction } from '../../../shared/interactionTypes'
import type { ComponentInteractionPorts } from '../../../renderer/interactions/componentInteractionRuntime'
import { runComponentNodeMotion } from '../../../renderer/runtime/componentMotionAuthoring'
import { MotionScope } from '../../behaviors/motion/MotionScope'
import type { AudioManager } from '../../AudioManager'
import { isComponentVisibleAtSurface, owningContainer } from '../../../shared/contracts/component-platform'
import { spatialSemanticVisible } from '../../surfaces/spatial/componentPlatform/graph'
import type { ComponentMotionPort, ComponentMotionTask } from '../../../shared/contracts/component-platform/motion'
import { isGlobalTeacherController } from '../../../shared/teacherControllerViewportGeometry'
import { componentAudioSounds } from '../../../shared/componentAudioSounds'
import { resolveComponentEase } from './componentEasing'

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
  instanceActive?(id: string): boolean
  playback(): boolean
  waitForAsset?(assetId: string, signal: AbortSignal): Promise<boolean>
  notifyVisibility?(id?: string): void
  activated?(instanceId: string): void
  controlsInitiallyVisible?(): boolean
}

/** Targets, events and transient values come from the single document world. */
export class ComponentWorldInteractions {
  private readonly motions = new Map<string, MotionScope>()
  private readonly visibility = new Map<string, boolean>()
  private readonly leases = new Map<string, symbol>()
  private readonly presentationVisibility = new Map<string, Map<symbol, { element: HTMLElement; visible: boolean }>>()
  private readonly presentationCleanup = new Map<string, Set<() => void>>()
  private readonly presenterListeners = new Map<'next' | 'previous', Set<() => ReturnType<TriggerListener>>>()
  private readonly videoThresholds = new Set<{ nodeId: string; seconds: number; previous: number; crossed: boolean; scope: ComponentRuntimeContext['scope']; listener: TriggerListener }>()
  private readonly videoSamples = new WeakSet<object>()
  private readonly stableVisibility = new Map<string, { element: HTMLElement; visible: boolean }>()
  private readonly clickBindings = new Set<{ nodeId: string; enabled(): boolean }>()
  private readonly clickableElements = new Set<HTMLElement>()
  private readonly clickStyles = new Map<Document, HTMLStyleElement>()
  private ownershipProject?: CourseProjectV10
  private readonly surfaceOwners = new Map<string, string | null>()
  constructor(private readonly world: ComponentInteractionWorld) {}
  private clickTarget(nodeId: string): HTMLElement | undefined {
    const element = this.world.element(nodeId)
    if (!this.world.active() || this.world.instanceActive?.(nodeId) === false || !this.canPresent(nodeId) || !element?.isConnected) return
    const effective = element.ownerDocument.defaultView?.getComputedStyle(element)
    if (effective?.visibility === 'hidden' || effective?.pointerEvents === 'none') return
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.inert || ancestor.getAttribute('aria-disabled') === 'true' || ancestor.matches(':disabled')) return
      const style = ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor)
      if (style?.display === 'none') return
    }
    return element
  }
  /** Derived affordance only; authored CSS and the editor's gestures keep their ownership. */
  refreshClickAffordances(validateVisibility = true): void {
    const enabled = new Set<HTMLElement>()
    for (const binding of this.clickBindings) {
      if (!binding.enabled()) continue
      const current = this.world.element(binding.nodeId)
      // State-only ticks change rule admission, not the already projected DOM.
      const element = !validateVisibility && current && this.clickableElements.has(current) ? current : this.clickTarget(binding.nodeId)
      if (element) enabled.add(element)
    }
    for (const element of this.clickableElements) if (!enabled.has(element)) {
      element.removeAttribute('data-guoling-node-click'); this.clickableElements.delete(element)
    }
    for (const element of enabled) {
      const document = element.ownerDocument
      if (!this.clickStyles.has(document)) {
        const style = document.createElement('style')
        style.textContent = '@layer guoling-interaction-default{:where([data-guoling-node-click]){cursor:pointer}}'
        document.head.prepend(style); this.clickStyles.set(document, style)
      }
      element.setAttribute('data-guoling-node-click', ''); this.clickableElements.add(element)
    }
  }
  currentSurfaceId(): string { return this.world.navigation?.readLocation() ?? '' }
  private surfaceOwner(project: CourseProjectV10, id: string): string | null | undefined {
    if (this.ownershipProject !== project) { this.ownershipProject = project; this.surfaceOwners.clear() }
    if (this.surfaceOwners.has(id)) return this.surfaceOwners.get(id)
    let owner = owningContainer(project, id)
    while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
    const surface = owner?.kind === 'surface' ? owner.surfaceId : owner?.kind === 'global' ? null : undefined
    if (surface !== undefined) this.surfaceOwners.set(id, surface)
    return surface
  }
  private canPresent(id: string, surfaceId = this.currentSurfaceId()): boolean {
    const project = this.world.project(), instance = project?.instances[id]
    if (!project) return false
    if (!instance) return Boolean(project.surfaces.some(surface => surface.id === id) && surfaceId === id)
    if (!this.world.navigation) return true
    const owner = this.surfaceOwner(project, id)
    return (owner === null || owner === surfaceId)
      && isComponentVisibleAtSurface(instance, surfaceId)
  }
  surfaceChanged(): void {
    for (const id of this.motions.keys()) if (!this.canPresent(id)) this.cancelMotions(id)
    // Feedback belongs to the retained wrapper. Hiding a cached surface keeps its live handle.
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
          this.applyVisibility(id); this.publishStableVisibility(); return true
        }
        const dispose = () => {
          if (disposed) return; disposed = true
          const leases = this.presentationVisibility.get(id); leases?.delete(lease)
          if (!leases?.size) this.presentationVisibility.delete(id)
          forget(); this.applyVisibility(id); this.publishStableVisibility()
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

  applyVisibility(id: string, snapshot = this.world.navigation?.read(), notify = true): boolean {
    const element = this.world.element(id), project = this.world.project(), instance = project?.instances[id]
    const surfaceId = snapshot?.locationId ?? '', surface = project?.surfaces.find(value => value.id === surfaceId)
    const presentation = [...(this.presentationVisibility.get(id)?.values() ?? [])].filter(value => value.element === element).at(-1)?.visible
    const initial = Boolean(instance && project && (!this.world.playback() || instance.playbackInitialVisibility !== 'hidden')
      && (this.world.controlsInitiallyVisible?.() !== false || !isGlobalTeacherController(project, id)))
    const data = instance?.data, styles = data && typeof data === 'object' && !Array.isArray(data) ? data.sceneStyles : undefined
    const variant = styles && typeof styles === 'object' && !Array.isArray(styles) ? styles[surfaceId] : undefined
    const enabled = variant && typeof variant === 'object' && !Array.isArray(variant) && typeof variant.enabled === 'boolean'
      ? variant.enabled : data && typeof data === 'object' && !Array.isArray(data) ? data.enabled : undefined
    const teacherDisabled = Boolean(project && instance && isGlobalTeacherController(project, id) && enabled === false)
    const hidden = !instance || !isComponentVisibleAtSurface(instance, surfaceId)
      || teacherDisabled
      || !spatialSemanticVisible(surface?.spatial, id, snapshot?.zoom ?? 1)
      || !(presentation ?? (this.leases.has(id) ? true : undefined) ?? this.visibility.get(id) ?? initial)
    if (!element || !instance || element.hidden === hidden) return false
    element.hidden = hidden
    if (notify) this.world.notifyVisibility?.(id)
    return true
  }
  applyAllVisibility(state = this.world.navigation?.read(), surfaces?: ReadonlySet<string>): void {
    const project = this.world.project()
    if (!project) return
    const ids = Object.keys(project.instances).filter(id => !surfaces || this.surfaceOwner(project, id) === null || surfaces.has(this.surfaceOwner(project, id) ?? ''))
    let changed = false
    for (const id of ids) changed = this.applyVisibility(id, state, false) || changed
    if (changed) this.world.notifyVisibility?.()
    this.publishStableVisibility(state?.locationId ?? '', ids)
    this.refreshClickAffordances()
  }
  private publishStableVisibility(surfaceId = this.currentSurfaceId(), ids = Object.keys(this.world.project()?.instances ?? {})): void {
    const project = this.world.project()
    for (const id of ids) {
      const element = this.world.element(id)
      if (!element) continue
      let visible = this.world.active() && element.isConnected
      for (let ancestor: HTMLElement | null = element; ancestor && visible; ancestor = ancestor.parentElement) if (ancestor.hidden) visible = false
      if (visible) visible = this.canPresent(id, surfaceId)
      let owner = visible && project ? owningContainer(project, id) : undefined
      if (this.leases.has(id)) visible = false
      while (owner?.kind === 'instance') { if (this.leases.has(owner.instanceId)) visible = false; owner = owningContainer(this.world.project()!, owner.instanceId) }
      const previous = this.stableVisibility.get(id)
      this.stableVisibility.set(id, { element, visible })
      if (visible && (previous?.element !== element || !previous.visible)) this.world.activated?.(id)
    }
  }
  async motion(action: NodeMotionAction, context: ActionContext, preview = false): Promise<boolean> {
    const element = this.world.element(action.nodeId)
    if (!element || !element.isConnected || !this.canPresent(action.nodeId) || context.signal.aborted) return false
    let motion = this.motions.get(action.nodeId)
    if (!motion) { motion = new MotionScope(); this.motions.set(action.nodeId, motion) }
    const previous = this.visibility.get(action.nodeId)
    const lease = Symbol(action.nodeId); this.leases.set(action.nodeId, lease)
    this.applyVisibility(action.nodeId)
    const success = await runComponentNodeMotion(motion, 'visibility', element, action, context.signal)
    if (this.leases.get(action.nodeId) !== lease || !element.isConnected || !this.canPresent(action.nodeId)) return false
    this.leases.delete(action.nodeId)
    if (preview || !success) {
      if (previous === undefined) this.visibility.delete(action.nodeId)
      else this.visibility.set(action.nodeId, previous)
    } else this.visibility.set(action.nodeId, action.type === 'node.enter')
    this.applyVisibility(action.nodeId)
    if (!preview) this.publishStableVisibility()
    return success
  }
  reset(): void {
    for (const id of [...this.presentationCleanup.keys()]) this.retirePresentation(id)
    this.leases.clear()
    for (const motion of this.motions.values()) motion.dispose()
    this.motions.clear(); this.visibility.clear(); this.stableVisibility.clear()
    for (const id of Object.keys(this.world.project()?.instances ?? {})) this.applyVisibility(id)
  }
  resetSurface(surfaceId: string): void {
    const project = this.world.project()
    if (!project) return
    for (const id of Object.keys(project.instances)) {
      let owner = owningContainer(project, id)
      while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
      if (owner?.kind !== 'surface' || owner.surfaceId !== surfaceId) continue
      this.leases.delete(id); this.motions.get(id)?.dispose(); this.motions.delete(id); this.visibility.delete(id); this.stableVisibility.delete(id); this.applyVisibility(id)
    }
  }
  retire(id: string): void { this.retirePresentation(id); this.leases.delete(id); this.motions.get(id)?.dispose(); this.motions.delete(id); this.visibility.delete(id); this.stableVisibility.delete(id); this.refreshClickAffordances() }
  pause(): void {
    this.leases.clear()
    for (const [id, motion] of this.motions) { motion.dispose(); this.applyVisibility(id) }
    this.motions.clear()
    this.refreshClickAffordances()
  }
  dispose(): void {
    this.reset(); this.presenterListeners.clear(); this.clickBindings.clear(); this.refreshClickAffordances()
    for (const style of this.clickStyles.values()) style.remove()
    this.clickStyles.clear()
  }
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
    const active = () => scope.isActive() && world.active() && world.instanceActive?.(scope.instanceId) !== false
    const currentSurfaceId = () => world.navigation?.readLocation() ?? null
    const currentStateId = () => world.navigation?.currentStateId?.() ?? null
    const subscribeTrigger = (trigger: InteractionTrigger, listener: TriggerListener, isEnabled?: () => boolean): (() => void) => {
      if (trigger.type === 'animation.completed') return () => {}
      if (trigger.type === 'scene.enter' || trigger.type === 'presentation.enter') {
        const identity = () => trigger.type === 'scene.enter' ? currentSurfaceId() : JSON.stringify([currentSurfaceId(), currentStateId()])
        let last = identity()
        let stopped = false, initialized = false
        const initialize = () => {
          const project = world.project(), instance = project?.instances[scope.instanceId]
          const documentBehavior = instance && project?.definitions[instance.definitionId]?.role === 'behavior'
          if (stopped || initialized || !scope.isActive() || !world.active() || !documentBehavior && !this.canPresent(scope.instanceId) || trigger.type === 'presentation.enter' && currentStateId() !== trigger.stateId) return
          initialized = true; void listener()
        }
        const notify = () => {
          const value = identity()
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
            if (!project) return
            let owner = owningContainer(project, id)
            while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
            if (trigger.scope === 'global' ? owner?.kind !== 'global' : owner?.kind !== 'surface' || owner.surfaceId !== currentSurfaceId()) return
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
        const binding = { nodeId: trigger.nodeId, enabled: () => active() && isEnabled?.() !== false }
        this.clickBindings.add(binding)
        const refresh = () => this.refreshClickAffordances()
        refresh()
        const click = (event: Event) => {
          const element = world.element(trigger.nodeId)
          if (element && event.composedPath().includes(element) && binding.enabled() && this.clickTarget(trigger.nodeId)) listener()
        }
        document?.addEventListener('click', click, true)
        const off = scope.events.subscribe('__runtime.node-click', value => {
          if (value && typeof value === 'object' && !Array.isArray(value) && value.instanceId === trigger.nodeId
            && binding.enabled() && this.clickTarget(trigger.nodeId)) listener()
        })
        return () => {
          document?.removeEventListener('click', click, true); off(); this.clickBindings.delete(binding)
          refresh()
        }
      }
      // Media controls emit into the same R0 event port, including programmatic playback.
      if (trigger.type === 'video.time') {
        const threshold = { nodeId: trigger.nodeId, seconds: trigger.seconds, previous: 0, crossed: false, scope, listener }
        this.videoThresholds.add(threshold)
        const reset = scope.events.subscribe('__runtime.scene.reset', surfaceId => {
          if (surfaceId === currentSurfaceId() && this.canPresent(trigger.nodeId)) { threshold.previous = 0; threshold.crossed = false }
        })
        const stop = scope.events.subscribe('video.time', value => {
          if (!value || typeof value !== 'object' || Array.isArray(value) || this.videoSamples.has(value)) return
          this.videoSamples.add(value)
          if (typeof value.seconds !== 'number' || !Number.isFinite(value.seconds)) return
          for (const target of [...this.videoThresholds].filter(target => target.nodeId === value.instanceId).sort((a, b) => a.seconds - b.seconds)) {
            if (!world.active() || !target.scope.isActive() || !this.canPresent(target.nodeId)) continue
            if (value.seconds < target.previous && value.seconds < target.seconds) target.crossed = false
            target.previous = value.seconds
            if (target.crossed || value.seconds < target.seconds) continue
            target.crossed = true; void target.listener(value)
          }
        })
        return () => { this.videoThresholds.delete(threshold); stop(); reset() }
      }
      const name = trigger.type
      const stop = scope.events.subscribe(name, value => {
        if (!scope.isActive() || !world.active() || !value || typeof value !== 'object' || Array.isArray(value)) return
        if (trigger.type === 'audio.ended') {
          if (value.soundId !== trigger.soundId) return
        } else if (value.instanceId !== trigger.nodeId || !this.canPresent(trigger.nodeId)) return
        listener(value)
      })
      return stop
    }
    return { currentSurfaceId, currentStateId,
      courseState: { get: key => scope.state.get(key), set: (key, value) => scope.state.set(key, structuredClone(value) as JsonValue) },
      subscribeTrigger, report: world.report,
      executeAction: async (action: InteractionAction, actionContext: ActionContext) => {
        if (actionContext.signal.aborted || !active()) return false
        if (action.type === 'course-state.set') { scope.state.set(action.key, action.value); return true }
        if (action.type === 'node.enter' || action.type === 'node.exit') return this.motion(action, actionContext)
        if (action.type.startsWith('audio.')) {
          const audio = world.audio()
          if (!audio) return false
          if (action.type === 'audio.play') {
            const project = world.project(), assetId = project && componentAudioSounds(project)[action.soundId]?.assetId
            if (assetId && world.waitForAsset && !await world.waitForAsset(assetId, actionContext.signal)) return false
          }
          if (actionContext.signal.aborted || !active()) return false
          return audio.execute(action as Extract<InteractionAction, { type: `audio.${string}` }> )
        }
        if (action.type.startsWith('video.')) {
          const videoAction = action as Extract<InteractionAction, { type: `video.${string}` }>
          if (!this.canPresent(videoAction.nodeId)) return false
          const remote = await world.video?.(videoAction, actionContext.signal)
          if (remote !== undefined) return remote
          if (actionContext.signal.aborted || !active()) return false
          const video = world.element(videoAction.nodeId)?.querySelector('video')
          if (!video) return false
          if (videoAction.type === 'video.seek') video.currentTime = videoAction.seconds
          else if (videoAction.type === 'video.pause') video.pause()
          else if (videoAction.type === 'video.stop') { video.pause(); video.currentTime = 0 }
          else if (videoAction.type === 'video.toggle' && !video.paused) video.pause()
          else {
            if (videoAction.type === 'video.restart') video.currentTime = 0
            await video.play()
            if (actionContext.signal.aborted || !active()) { video.pause(); return false }
          }
          return true
        }
        if (action.type === 'location.go') {
          const surface = world.project()?.surfaces.find(value => value.id === action.locationId)
          return surface ? world.navigation?.execute({ type: 'scene.go', sceneId: surface.id, transition: action.transition }, actionContext.signal, actionContext.onNavigationCommit) ?? false : false
        }
        if (action.type === 'presentation.set') {
          const duration = action.transition?.duration ?? 0
          let easing = action.transition?.ease
          const css = world.document()?.defaultView?.CSS
          if (duration > 0 && easing && !css?.supports('animation-timing-function', easing)) {
            const curve = resolveComponentEase(easing)
            easing = `linear(${Array.from({ length: 101 }, (_, index) => curve(index / 100)).join(',')})`
          }
          if (actionContext.signal.aborted || !active()) return false
          // Both state snapshots are handled by the same navigation owner as page changes.
          return world.navigation?.execute({ type: 'scene.go', sceneId: currentSurfaceId() ?? '', targetStateId: action.stateId,
            ...(duration > 0 ? { transition: {
              outgoing: { keyframes: [{ opacity: 1 }, { opacity: 0 }], timing: { duration, easing } },
              incoming: { keyframes: [{ opacity: 0 }, { opacity: 1 }], timing: { duration, easing } },
            } } : {}) }, actionContext.signal, actionContext.onNavigationCommit) ?? false
        }
        if (action.type === 'course.restart') this.reset()
        return world.navigation?.execute(action as Parameters<TeacherControllerPort['execute']>[0], actionContext.signal, actionContext.onNavigationCommit) ?? false
      },
    }
  }
}
