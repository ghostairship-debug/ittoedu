import { ComponentRuntimeHost, type PreparedComponentRuntime } from './runtime/ComponentRuntimeHost'
import type { ComponentDefinition, ComponentImplementation, ComponentRuntimeImplementation, ComponentTarget, JsonValue, CourseProjectV10, ComponentAuthorSpot, ComponentAuthorSpotInput, ComponentAuthorGeometry, ComponentAuthorPreviewCallbacks } from '../../shared/contracts/component-platform'
import type { DocumentResources } from '../../shared/workbench/document'
import { textRuntimeImplementation, formulaRuntimeImplementation } from '../../components/text/runtime'
import { createImageRuntimeImplementation } from '../../components/image/runtime'
import { shapeRuntimeImplementation } from '../../components/shape/render'
import { tableRuntimeImplementation } from '../../components/table/runtime'
import { chartRuntimeImplementation } from '../../components/chart/runtime'
import { createTeacherControllerRuntimeImplementation } from '../../components/teacher-controller'
import type { TeacherControllerPort } from '../../shared/contracts/component-platform/teacherController'
import { inputRuntimeImplementation, feedbackRuntimeImplementation, visibilityRuntimeImplementation } from '../../components/input'
import { choiceRuntimeImplementation } from '../../components/choice'
import { disclosureRuntimeImplementation } from '../../components/disclosure'
import { popoverRuntimeImplementation } from '../../components/popover'
import { documentBlockRuntimeImplementation } from '../../components/document-block'
import { createAudioRuntimeImplementation, createVideoRuntimeImplementation } from '../../components/media'
import { AudioManager, type AudioPlaybackEvent } from '../AudioManager'
import { CourseEventBus } from '../CourseEventBus'
import { createComponentInteractionRuntime } from '../../renderer/interactions/componentInteractionRuntime'
import { ComponentWorldInteractions } from './runtime/ComponentWorldInteractions'
import { ComponentWorldMedia } from './runtime/ComponentWorldMedia'
import { isComponentVisibleAtSurface, owningContainer } from '../../shared/contracts/component-platform'
import { courseThemeStyleText } from '../../shared/contracts/design-v1/theme'
import { componentLayoutInput } from '../../components/web/measuredFragmentBox'
import { componentCompilationInput } from '../../core/components/compilation/componentCompilationInput'
import { flowObjectExtent } from '../../core/components/geometry/flowObjectExtent'
import type { ComponentLayoutInput, ComponentLayoutPort, ComponentInstance } from '../../shared/contracts/component-platform'
import type { RuntimeTargetProfile } from '../../components/web/moduleGraph'

type Listener = (value: JsonValue | undefined) => void
/** A run owns transient state and leases. It never writes author data or History. */
export class ComponentPlatformRuntime {
  readonly host: ComponentRuntimeHost
  private project?: CourseProjectV10
  private documentResources?: DocumentResources
  private readonly layouts = new Map<string, { generation: number; notify(): void }>()
  private roots = new Map<string, HTMLElement>()
  private projectionRoots = new Map<string, HTMLElement>()
  private parking?: HTMLElement
  private targetElements = new Map<string, HTMLElement>()
  private readonly state = new Map<string, JsonValue>()
  private readonly stateListeners = new Map<string, Set<Listener>>()
  private readonly eventListeners = new Map<string, Set<(value: JsonValue) => void>>()
  private readonly assetUrls = new Map<string, string>()
  private readonly contentAssetUrls = new Map<string, string>()
  private readonly referencedAssetUrls = new Map<string, string>()
  private readonly resolveAssetUrl?: (id: string) => string | undefined
  private readonly isAssetPending?: (id: string) => boolean
  private readonly assetContents = new Map<string, { bytes: Uint8Array; mimeType: string }>()
  private readonly themeMarker = `component-${crypto.randomUUID()}`
  private themeStyle?: HTMLStyleElement
  private themeText = ''
  private resourceVersion = 0
  private publishedResourceVersion = -1
  private readonly synced = new Set<string>()
  private readonly implementations: Map<string, ComponentRuntimeImplementation>
  private readonly audioEvents = new CourseEventBus()
  private audioManager?: AudioManager
  private mediaSettings?: CourseProjectV10['media']
  private readonly interactions: ComponentWorldInteractions
  private readonly media: ComponentWorldMedia
  private playing: boolean
  private resumeMedia?: () => void
  private readonly mode: 'edit' | 'play' | 'capture'
  private readonly report: (message: string) => void
  private readonly spots = new Map<string, ComponentAuthorSpot>()
  private readonly spotPreviews = new Map<string, ComponentAuthorPreviewCallbacks>()
  private readonly spotListeners = new Set<() => void>()
  private spotSequence = 0
  private readonly stopNavigation?: () => void
  private reset?: Promise<void>
  private retired = false
  private disposal?: Promise<void>
  private readonly surfaceId?: () => string | null
  private readonly projectionManaged: boolean
  private readonly onProjectionCommit?: () => void
  private projectionTargetsChanged = false

  constructor(readonly runScopeId: string, options: {
    resolveSource?(implementation: Extract<ComponentImplementation, { kind: 'source' }>, signal: AbortSignal): Promise<PreparedComponentRuntime>
    report?(message: string): void
    builtins?: ReadonlyMap<string, ComponentRuntimeImplementation>
    teacherController?: TeacherControllerPort & { subscribeSceneReplay?(listener: (surfaceId: string) => void): () => void }
    /** Student/authored actions never inherit the teacher directory's force-jump capability. */
    studentNavigation?: TeacherControllerPort
    resolveBuiltin?(key: string, signal: AbortSignal): Promise<PreparedComponentRuntime>
    /** Published resource owner resolves only actual consumer requests. */
    resolveAssetUrl?(id: string): string | undefined
    isAssetPending?(id: string): boolean
    mode?: 'edit' | 'play' | 'capture'
    /** ModelPlayer performs synchronization only after an actual projection commit. */
    projectionManaged?: boolean
    /** A connected ref / completed NodeView mutation can commit after its parent React tree. */
    onProjectionCommit?(): void
  } = {}) {
    this.mode = options.mode ?? 'play'; this.playing = this.mode === 'play'
    this.projectionManaged = options.projectionManaged ?? false
    this.onProjectionCommit = options.onProjectionCommit
    this.resolveAssetUrl = options.resolveAssetUrl
    this.isAssetPending = options.isAssetPending
    this.surfaceId = options.teacherController && (() => options.teacherController!.read().locationId)
    this.report = message => options.report?.(message)
    this.audioEvents.on<AudioPlaybackEvent>('audio:ended', event => {
      if (event && !this.retired) this.emit('audio.ended', { soundId: event.soundId })
    })
    this.media = new ComponentWorldMedia(() => this.audioManager, this.report)
    this.interactions = new ComponentWorldInteractions({ project: () => this.project, element: id => this.targetElement(id),
      document: () => this.targetElements.values().next().value?.ownerDocument ?? this.roots.values().next().value?.ownerDocument,
      audio: () => this.audioManager, video: (action, signal) => this.media.executeVideo(action, signal), navigation: options.studentNavigation ?? options.teacherController, report: this.report, active: () => this.playing, playback: () => this.mode !== 'capture',
      controlsInitiallyVisible: () => this.mode === 'edit' && !this.playing || this.project?.playback?.controls !== 'none' })
    const image = createImageRuntimeImplementation(id => {
      const url = this.assetUrl(id)
      return url ? { url } : undefined
    }, diagnostic => {
      if (diagnostic.code === 'image-resource-missing' && options.isAssetPending?.(diagnostic.assetId)) return
      options.report?.(diagnostic.message)
    })
    // Professional implementations are shared; no per-instance default compilation.
    this.implementations = new Map([
      ['guoling.text', textRuntimeImplementation], ['guoling.formula', formulaRuntimeImplementation],
      ['guoling.image', image as ComponentRuntimeImplementation],
      ['guoling.shape', shapeRuntimeImplementation as ComponentRuntimeImplementation],
      ['guoling.table', tableRuntimeImplementation], ['guoling.chart', chartRuntimeImplementation],
      ['guoling.group', { mount: () => ({ update() {}, dispose() {} }) }],
      ['guoling.navigation', createTeacherControllerRuntimeImplementation(options.teacherController)],
      ['guoling.input', inputRuntimeImplementation as ComponentRuntimeImplementation], ['guoling.choice', choiceRuntimeImplementation as ComponentRuntimeImplementation],
      ['guoling.disclosure', disclosureRuntimeImplementation as ComponentRuntimeImplementation], ['guoling.popover', popoverRuntimeImplementation as ComponentRuntimeImplementation],
      ['guoling.feedback', feedbackRuntimeImplementation as ComponentRuntimeImplementation], ['guoling.visibility', visibilityRuntimeImplementation as ComponentRuntimeImplementation],
      ['guoling.document-block', documentBlockRuntimeImplementation],
      ['guoling.interactions', createComponentInteractionRuntime(context => this.interactions.ports(context))],
      ...(options.builtins ?? []),
    ])
    this.host = new ComponentRuntimeHost({
      resources: { url: id => this.contentAssetUrl(id) },
      media: scope => this.media.port(scope),
      interactions: context => this.interactions.ports(context),
      authoring: (_scope, instanceId, generation) => ({ register: (spot, callbacks) => this.registerAuthorSpot(instanceId, generation, spot, callbacks) }),
      layout: (_scope, instance, generation) => this.layoutPort(instance, generation),
      resolveImplementation: (implementation, _definition, signal) => {
        if (implementation.kind === 'source') {
          if (!options.resolveSource) throw new Error('源码运行环境尚未连接；源码和参数已保留')
          return options.resolveSource(implementation, signal)
        }
        if (['guoling.web', 'guoling.html-program'].includes(implementation.key) && options.resolveBuiltin) return options.resolveBuiltin(implementation.key, signal)
        const resolved = this.implementations.get(implementation.key)
        if (!resolved) throw new Error(`组件实现尚未接入：${implementation.key}`)
        return { mount: async context => {
          const mounted = await resolved.mount({ ...context, teacherController: options.teacherController })
          if (!['guoling.image', 'guoling.audio', 'guoling.video', 'guoling.navigation'].includes(implementation.key)) return mounted
          let current = context.instance
          context.scope.events.subscribe('__runtime.resources', () => {
            try { void Promise.resolve(mounted.update(current)).catch(error => this.report(String(error))) }
            catch (error) { this.report(String(error)) }
          })
          return { ...mounted, update: next => { current = next; return mounted.update(next) } }
        } }
      },
      ports: (_scope, instanceId) => ({
        target: reference => this.target(reference),
        events: { emit: (name, value) => {
          if (name === 'component.diagnostic' && value && typeof value === 'object' && !Array.isArray(value) && typeof value.message === 'string') this.report(`${instanceId}：${value.message}`)
          this.emit(name, value); this.emit('__component.event', { instanceId, name, value })
        }, subscribe: (name, listener) => {
          const listeners = this.eventListeners.get(name) ?? new Set()
          this.eventListeners.set(name, listeners); listeners.add(listener)
          return () => { listeners.delete(listener) }
        } },
        state: { get: name => this.state.get(name), set: (name, value) => this.setState(name, value), subscribe: (name, listener) => {
          const listeners = this.stateListeners.get(name) ?? new Set()
          this.stateListeners.set(name, listeners); listeners.add(listener)
          return () => { listeners.delete(listener) }
        } },
      }),
      reportError: (error, phase, _scope, id) => options.report?.(`${id} ${phase}：${error instanceof Error ? error.message : String(error)}`),
    })
    let locationId: string | null | undefined
    const stopNavigation = options.teacherController?.subscribe(() => {
      const current = options.teacherController!.read().locationId
      if (locationId !== current) {
        if (locationId) this.audioEvents.emit('scene:leave', { sceneId: locationId })
        if (current) this.audioEvents.emit('scene:enter', { sceneId: current })
        locationId = current
        this.interactions.surfaceChanged()
      }
      if (this.mode !== 'edit' || this.playing) this.interactions.applyAllVisibility()
    })
    const stopReplay = options.teacherController?.subscribeSceneReplay?.(surfaceId => {
      if (this.retired || options.teacherController!.read().locationId !== surfaceId) return
      this.emit('__runtime.scene.reset', surfaceId)
      this.interactions.resetSurface(surfaceId)
      // Same-scene replay retires only that scene's audio, retaining global playback and mounts.
      this.audioEvents.emit('scene:leave', { sceneId: surfaceId })
      this.audioEvents.emit('scene:enter', { sceneId: surfaceId })
      this.emit('__runtime.scene.replay', surfaceId)
      this.interactions.applyAllVisibility()
    })
    this.stopNavigation = () => { stopNavigation?.(); stopReplay?.() }
  }

  /** A mount owns one measured layout projection; reports never become author operations. */
  private layoutPort(mounted: ComponentInstance, generation: number): ComponentLayoutPort {
    const id = mounted.id, listeners = new Set<(input: ComponentLayoutInput) => void>()
    let observer: ResizeObserver | undefined
    let observed: HTMLElement | undefined, projected: HTMLElement | undefined
    let measured: { inlineSize: number; blockSize: number } | undefined
    const read = (): ComponentLayoutInput => {
      const instance = this.project?.instances[id] ?? mounted
      const target = this.targetElements.get(id), root = this.projectionRoots.get(id)
      const width = target?.clientWidth || root?.parentElement?.clientWidth || instance.frame?.width || 1
      const extent = !instance.frame && instance.childIds?.length && this.project ? flowObjectExtent(this.project, id) : null
      return componentLayoutInput(instance, { kind: target?.dataset.componentPlacement === 'flow' ? 'flow' : 'free-frame',
        inlineSize: width, viewport: extent ?? { width, height: target?.clientHeight || instance.frame?.height || 1 },
        definition: this.project?.definitions[instance.definitionId] })
    }
    let last = ''
    const slot = { generation, notify: () => {
      const input = read(), signature = JSON.stringify(input)
      const target = this.targetElements.get(id)
      if (observer && target !== observed) { observer.disconnect(); if (target) observer.observe(target); observed = target }
      const root = this.projectionRoots.get(id), mount = this.roots.get(id)
      if (root && root !== projected) {
        projected = root
        if (input.mode === 'flow-content' && measured && Math.abs(measured.inlineSize - input.inlineSize) <= 0.5)
          root.style.setProperty('--component-flow-height', `${Math.ceil(measured.blockSize)}px`)
      }
      if (signature === last) return
      last = signature
      if (root && mount) {
        root.style.height = input.mode === 'flow-content' ? 'var(--component-flow-height, auto)'
          : input.mode === 'flow-viewport' ? `${input.blockSize}px` : '100%'
        mount.style.height = input.mode === 'flow-content' ? 'auto' : '100%'
        if (input.mode !== 'flow-content') root.style.removeProperty('--component-flow-height')
      }
      for (const listener of listeners) listener(input)
    } }
    this.layouts.set(id, slot)
    this.projectionRoots.get(id)?.style.removeProperty('--component-flow-height')
    slot.notify()
    return {
      read,
      subscribe: listener => {
        listeners.add(listener)
        if (!observer) {
          const target = this.targetElements.get(id), Observer = target?.ownerDocument.defaultView?.ResizeObserver
          if (target && Observer) { observer = new Observer(slot.notify); observer.observe(target); observed = target }
        }
        return () => {
          listeners.delete(listener)
          if (!listeners.size) { observer?.disconnect(); observer = undefined; if (this.layouts.get(id) === slot) this.layouts.delete(id) }
        }
      },
      reportSize: report => {
        if (this.layouts.get(id) !== slot) return
        const input = read()
        if (input.mode !== 'flow-content' || !Number.isFinite(report.inlineSize) || !Number.isFinite(report.blockSize) || report.blockSize < 0
          || Math.abs(report.inlineSize - input.inlineSize) > 0.5) return
        const root = this.projectionRoots.get(id), mount = this.roots.get(id)
        if (!root || !mount) return
        measured = { ...report }
        root.style.setProperty('--component-flow-height', `${Math.ceil(report.blockSize)}px`)
        root.style.height = 'var(--component-flow-height, auto)'
        mount.style.height = '100%'
      },
    }
  }

  private registerAuthorSpot(instanceId: string, generation: number, input: ComponentAuthorSpotInput, callbacks?: ComponentAuthorPreviewCallbacks): () => void {
    const id = `spot:${instanceId}:${generation}:${++this.spotSequence}`
    this.spots.set(id, { ...structuredClone(input), id, instanceId, mountGeneration: generation })
    if (callbacks) this.spotPreviews.set(id, callbacks)
    this.notifySpots()
    return () => { this.spotPreviews.delete(id); if (this.spots.delete(id)) this.notifySpots() }
  }
  /** Transient realm paint only; the gesture's final geometry still goes through the author transaction. */
  previewAuthorSpot = (id: string, geometry: ComponentAuthorGeometry | null): boolean => {
    const callback = !this.retired && this.spots.has(id) ? this.spotPreviews.get(id) : undefined
    if (!callback) return false
    callback.previewGeometry(geometry)
    return true
  }
  private notifySpots(): void { for (const listener of this.spotListeners) listener() }
  authorSpots(): readonly ComponentAuthorSpot[] { return [...this.spots.values()].map(spot => structuredClone(spot)) }
  subscribeAuthorSpots = (listener: () => void): (() => void) => { this.spotListeners.add(listener); return () => { this.spotListeners.delete(listener) } }

  private target(reference: ComponentTarget) {
    const project = this.project
    if (!project) return null
    const read = () => {
      if (reference.kind === 'project') return JSON.parse(JSON.stringify(this.project)) as JsonValue
      if (reference.kind === 'surface') return JSON.parse(JSON.stringify(this.project?.surfaces.find(surface => surface.id === reference.surfaceId) ?? null)) as JsonValue
      return structuredClone(this.project?.instances[reference.instanceId]?.data ?? null)
    }
    const id = reference.kind === 'instance' ? reference.instanceId : reference.kind === 'surface' ? reference.surfaceId : project.id
    if (reference.kind === 'instance' && !project.instances[id] || reference.kind === 'surface' && !project.surfaces.some(surface => surface.id === id)) return null
    const runtime = this
    return { instanceId: id, get element() { return runtime.targetElements.get(id) ?? runtime.projectionRoots.get(id)?.parentElement ?? undefined }, read,
      emit: (name: string, value: JsonValue) => this.emit(name, value),
      ...(reference.kind === 'instance' && this.targetElements.has(id) ? { motion: this.interactions.motionPort(id), presentation: this.interactions.presentationPort(id) } : {}) }
  }
  private emit(name: string, value: JsonValue): void { for (const listener of this.eventListeners.get(name) ?? []) listener(structuredClone(value)) }
  bind = (instanceId: string, element: HTMLElement | null): void => {
    if (this.retired) return
    if (element) {
      element.dataset.componentCourseWorld = this.themeMarker
      this.projectionRoots.set(instanceId, element)
      let root = this.roots.get(instanceId)
      if (!root) {
        root = element.ownerDocument.createElement('div')
        root.style.width = '100%'; root.style.height = '100%'
        this.roots.set(instanceId, root)
      }
      // Moving author ownership changes the projection parent, not the run slot or its DOM.
      if (root.parentElement !== element) this.placeRoot(element, root)
    } else {
      const root = this.roots.get(instanceId)
      if (root) {
        if (!this.parking) { this.parking = root.ownerDocument.createElement('div'); this.parking.hidden = true; root.ownerDocument.body.append(this.parking) }
        this.placeRoot(this.parking, root)
      }
      this.projectionRoots.delete(instanceId)
    }
    if (element && this.project && !this.projectionManaged) void this.syncInstance(instanceId).catch(() => {})
    if (element?.isConnected && this.projectionManaged) this.onProjectionCommit?.()
    this.layouts.get(instanceId)?.notify()
  }
  private placeRoot(parent: HTMLElement, root: HTMLElement): void {
    if (root.parentElement === parent) return
    const connected = parent as HTMLElement & { moveBefore?(element: Element, before: Node | null): void }
    // Chromium's state-preserving DOM move also retains a source iframe's browsing context.
    const frames = [...root.querySelectorAll('iframe')].map(frame => ({ frame, parent: frame.parentElement!, next: frame.nextSibling }))
    if (frames.length) {
      if (!root.isConnected || !parent.isConnected || root.ownerDocument !== parent.ownerDocument || !connected.moveBefore)
        throw new Error('当前宿主无法保留已运行组件的内容环境，移动未执行')
      // Moving an ancestor with live frames corrupts Chromium 150's connected-frame counter.
      // Move the frames themselves while connected, then their empty wrapper, retaining each realm.
      let moved = 0
      try {
        for (const entry of frames) { connected.moveBefore(entry.frame, null); moved++ }
        connected.moveBefore(root, null)
      } finally {
        // Restore from the end so adjacent frames' saved next siblings are already back in place.
        for (let index = moved - 1; index >= 0; index--) {
          const entry = frames[index]!
          ;(entry.parent as typeof connected).moveBefore!(entry.frame, entry.next)
        }
      }
    } else if (root.isConnected && parent.isConnected && connected.moveBefore) connected.moveBefore(root, null)
    else parent.append(root)
  }
  /** Park before a projection moves/removes ancestors; source browsing contexts stay connected. */
  beforeProjectionMutation(): void {
    for (const root of this.roots.values()) {
      if (!root.querySelector('iframe')) continue
      if (!this.parking) { this.parking = root.ownerDocument.createElement('div'); this.parking.hidden = true; root.ownerDocument.body.append(this.parking) }
      if (root.parentElement !== this.parking) this.placeRoot(this.parking, root)
    }
  }
  afterProjectionMutation(): void {
    for (const [id, element] of this.projectionRoots) {
      const root = this.roots.get(id)
      if (root && element.isConnected && root.parentElement !== element) this.placeRoot(element, root)
    }
    if (this.projectionManaged) { this.projectionTargetsChanged = true; this.onProjectionCommit?.(); return }
    if ([...this.projectionRoots.values()].some(element => element.isConnected)) {
      for (const instance of Object.values(this.project?.instances ?? {})) {
        if (this.project?.definitions[instance.definitionId]?.role !== 'behavior') continue
        if (!this.behaviorCanProject(instance.id)) continue
        void this.syncInstance(instance.id).then(() => this.host.refreshTargets(this.runScopeId, instance.id,
          () => this.behaviorCanProject(instance.id))).catch(error => this.report(String(error)))
      }
    }
  }
  private behaviorCanProject(id: string): boolean {
    const project = this.project
    if (!project?.instances[id]) return false
    const implementation = project.definitions[project.instances[id].definitionId]?.implementation
    // Only these professional behaviors reconnect a visual presentation lease.
    // Event/state behaviors keep their document-wide subscriptions, including
    // scene.enter before the next surface's React projection has mounted.
    if (implementation?.kind !== 'builtin' || !['guoling.feedback', 'guoling.visibility'].includes(implementation.key)) return true
    // A low-level runtime without a surface navigation owner keeps its original
    // document scope. Editor and Player both supply their one navigation owner.
    if (!this.surfaceId) return true
    let container = owningContainer(project, id)
    while (container?.kind === 'instance') container = owningContainer(project, container.instanceId)
    return container?.kind === 'global' || container?.kind === 'surface' && container.surfaceId === this.surfaceId()
  }
  bindTarget = (instanceId: string, element: HTMLElement | null): void => {
    if (this.retired) return
    const previous = this.targetElements.get(instanceId)
    if (previous && previous !== element) { this.interactions.cancelMotions(instanceId); this.interactions.retirePresentation(instanceId) }
    if (element) { element.dataset.componentCourseWorld = this.themeMarker; this.targetElements.set(instanceId, element) }
    else this.targetElements.delete(instanceId)
    this.layouts.get(instanceId)?.notify()
    if (this.mode !== 'edit') this.interactions.applyVisibility(instanceId)
    if (element?.isConnected && previous !== element && this.projectionManaged) {
      this.projectionTargetsChanged = true; this.onProjectionCommit?.()
    }
  }
  private async syncInstance(id: string, restarting = false): Promise<unknown> {
    if (this.reset && !restarting) { await this.reset; return this.syncInstance(id) }
    if (this.retired) return
    const instance = this.project?.instances[id]
    if (!instance) return Promise.resolve()
    const definition: ComponentDefinition | undefined = this.project?.definitions[instance.definitionId]
    if (!definition) return Promise.resolve()
    const root = this.roots.get(id)
    if (!root && definition.role !== 'behavior') return Promise.resolve()
    this.synced.add(id)
    const effective = instance.implementationOverride ?? definition.implementation
    let sourceSignature: unknown
    if (effective.kind === 'source' && this.project) {
      try { sourceSignature = componentCompilationInput(this.project, effective, this.documentResources) }
      catch (error) { sourceSignature = String(error) }
    }
    const environmentSignature = effective.kind === 'source' || effective.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(effective.key)
      ? JSON.stringify([...(this.project?.logic?.network?.connectOrigins ?? [])].sort()) : undefined
    const handle = await this.host.sync({ runScopeId: this.runScopeId, instance, definition, root, environmentSignature,
      preparationSignature: effective.kind === 'source' ? JSON.stringify(sourceSignature) : undefined,
      canProject: definition.role === 'behavior' ? () => this.behaviorCanProject(id) : undefined })
    if (!handle?.scope.isActive()) return handle
    const implementation = instance.implementationOverride ?? definition.implementation
    const key = implementation.kind === 'builtin' ? implementation.key : null
    const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : null
    const field = key === 'guoling.text' ? 'content' : key === 'guoling.image' ? 'assetId' : null
    const spotId = `professional:${id}`, previous = this.spots.get(spotId)
    if (field && data && data[field] !== undefined && root) {
      const spot: ComponentAuthorSpot = { id: spotId, instanceId: id, mountGeneration: handle.scope.generation,
        kind: field === 'content' ? 'text' : 'image', dataPath: [field], initialValue: structuredClone(data[field]),
        localBounds: { width: instance.frame?.width ?? root.clientWidth, height: instance.frame?.height ?? root.scrollHeight, transform: [1, 0, 0, 1, 0, 0] } }
      if (!previous || JSON.stringify(previous) !== JSON.stringify(spot)) { this.spots.set(spotId, spot); this.notifySpots() }
    } else if (previous) { this.spots.delete(spotId); this.notifySpots() }
    return handle
  }
  async sync(project: CourseProjectV10, resources: DocumentResources): Promise<void> {
    if (this.reset) await this.reset
    if (this.retired) return
    this.project = project; this.documentResources = resources
    for (const layout of this.layouts.values()) layout.notify()
    this.prepareResources(project, resources)
    if (this.publishedResourceVersion !== this.resourceVersion) { this.publishedResourceVersion = this.resourceVersion; this.emit('__runtime.resources', this.resourceUrls()) }
    const themeText = this.themeCss()
    const owner = this.roots.values().next().value?.ownerDocument ?? this.targetElements.values().next().value?.ownerDocument
    if (owner) {
      if (!this.themeStyle) { this.themeStyle = owner.createElement('style'); owner.head.append(this.themeStyle) }
      this.themeStyle.textContent = `@scope ([data-component-course-world="${this.themeMarker}"]) {${themeText.replace(/:root\b/g, ':scope')}}`
    }
    if (themeText !== this.themeText) { this.themeText = themeText; this.emit('__runtime.theme', themeText) }
    if (!this.audioManager) {
      this.audioManager = new AudioManager(project, id => this.assetUrl(id), this.audioEvents, { mode: this.mode === 'capture' ? 'capture' : 'preview' })
      this.mediaSettings = project.media
      const mediaOptions = { resolveAssetUrl: (id: string) => this.assetUrl(id), audioManager: this.audioManager,
        subscribeAudioChange: (listener: () => void) => this.audioEvents.on('audio:change', listener),
        report: (diagnostic: { code: string; assetId: string; message: string }) => {
          if (diagnostic.code === 'media-resource-missing' && this.isAssetPending?.(diagnostic.assetId)) return
          this.report(diagnostic.message)
        } }
      this.implementations.set('guoling.audio', createAudioRuntimeImplementation(mediaOptions) as ComponentRuntimeImplementation)
      this.implementations.set('guoling.video', createVideoRuntimeImplementation(mediaOptions) as ComponentRuntimeImplementation)
    } else if (this.mediaSettings !== project.media) { this.audioManager.updateProject(project); this.mediaSettings = project.media }
    for (const declaration of project.logic?.courseState ?? []) if (!this.state.has(declaration.key)) this.state.set(declaration.key, structuredClone(declaration.defaultValue))
    for (const id of [...this.synced]) if (!project.instances[id]) {
      this.synced.delete(id); await this.host.dispose(this.runScopeId, id)
      if (this.retired) return
      this.roots.get(id)?.remove(); this.roots.delete(id); this.projectionRoots.delete(id); this.targetElements.delete(id)
      this.interactions.retire(id)
      for (const [spotId, spot] of this.spots) if (spot.instanceId === id) this.spots.delete(spotId)
      this.notifySpots()
    }
    // Each Host reports its located failure. Healthy peers remain mounted and usable.
    await Promise.allSettled(Object.keys(project.instances).map(id => this.syncInstance(id)))
    if (this.projectionTargetsChanged) {
      this.projectionTargetsChanged = false
      await Promise.allSettled(Object.values(project.instances).filter(instance => project.definitions[instance.definitionId]?.role === 'behavior')
        .map(instance => this.host.refreshTargets(this.runScopeId, instance.id, () => this.behaviorCanProject(instance.id))))
    }
    if (this.mode !== 'edit' || this.playing) this.interactions.applyAllVisibility()
  }
  stateSnapshot(): Record<string, JsonValue> { return Object.fromEntries(this.state) }
  /** Prepare local assets before a placement paints its background. */
  prepareResources(project: CourseProjectV10, resources: DocumentResources): void {
    if (this.retired) return
    for (const [id, url] of this.assetUrls) if (!project.assets[id] || !resources.assets[id]) { URL.revokeObjectURL(url); this.assetUrls.delete(id); this.contentAssetUrls.delete(id); this.assetContents.delete(id); this.resourceVersion++ }
    for (const [id, asset] of Object.entries(project.assets)) if (resources.assets[id]) {
      const bytes = Uint8Array.from(resources.assets[id]), mimeType = asset.mimeType ?? 'application/octet-stream'
      const previous = this.assetContents.get(id)
      if (previous?.mimeType === mimeType && previous.bytes.length === bytes.length && previous.bytes.every((byte, index) => byte === bytes[index])) continue
      const previousUrl = this.assetUrls.get(id)
      if (previousUrl) URL.revokeObjectURL(previousUrl)
      this.assetContents.set(id, { bytes, mimeType })
      this.assetUrls.set(id, URL.createObjectURL(new Blob([bytes], { type: mimeType })))
      // Opaque component realms cannot dereference their parent's Blob storage key.
      let binary = ''
      for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
      this.contentAssetUrls.set(id, `data:${mimeType};base64,${btoa(binary)}`)
      this.resourceVersion++
    }
  }
  themeCss(): string { return this.project ? courseThemeStyleText({ designTokens: this.project.designTokens ?? { fonts: [], colors: [] }, theme: this.project.theme }, id => this.contentAssetUrl(id)) : '' }
  private referencedAssetUrl(id: string): string | undefined {
    if (this.retired) return undefined
    const url = this.resolveAssetUrl?.(id)
    if (url && this.referencedAssetUrls.get(id) !== url) { this.referencedAssetUrls.set(id, url); this.resourceVersion++ }
    return url
  }
  assetUrl(id: string): string | undefined { return this.assetUrls.get(id) ?? this.referencedAssetUrl(id) }
  contentAssetUrl(id: string): string | undefined { return this.contentAssetUrls.get(id) ?? this.referencedAssetUrl(id) }
  resourceUrls(): Record<string, string> {
    // Enumerating resources for a realm is not itself a request to fetch every asset.
    return Object.fromEntries([...this.referencedAssetUrls, ...this.contentAssetUrls].filter(([id]) => this.project?.assets[id]))
  }
  targetElement(id: string): HTMLElement | undefined { return this.targetElements.get(id) ?? this.projectionRoots.get(id)?.parentElement ?? undefined }
  contentElement(id: string): HTMLElement | undefined { return this.projectionRoots.get(id) }
  getState(name: string): JsonValue | undefined { return this.state.get(name) }
  setState(name: string, value: JsonValue): void {
    this.state.set(name, structuredClone(value))
    for (const listener of this.stateListeners.get(name) ?? []) listener(structuredClone(value))
    this.emit('__runtime.state', { name, value })
  }
  /** Explicitly restart component generations; a pause keeps the existing generations. */
  resetPlayback = (playing = false): Promise<void> => {
    if (this.retired) return this.disposal ?? Promise.resolve()
    if (this.reset) return this.reset
    this.setPlaying(false); this.resumeMedia = undefined; this.audioManager?.stop({ kind: 'all' }); this.interactions.reset()
    this.reset = (async () => {
      await this.host.disposeScope(this.runScopeId)
      if (this.retired || !this.project) return
      this.spots.clear(); this.spotPreviews.clear(); this.notifySpots(); this.state.clear()
      for (const declaration of this.project.logic?.courseState ?? []) this.setState(declaration.key, declaration.defaultValue)
      this.playing = playing
      await Promise.allSettled(Object.keys(this.project.instances).map(id => this.syncInstance(id, true)))
      if (playing || this.mode !== 'edit') this.interactions.applyAllVisibility()
      else for (const [id, element] of this.targetElements) {
        const instance = this.project.instances[id]
        if (instance) element.hidden = !isComponentVisibleAtSurface(instance, this.interactions.currentSurfaceId())
      }
    })().finally(() => { this.reset = undefined })
    return this.reset
  }
  audio(): AudioManager | undefined { return this.audioManager }
  isPlaying(): boolean { return this.playing }
  dispatchPresenterCommand(command: 'next' | 'previous'): Promise<boolean> {
    return this.interactions.dispatchPresenterCommand(command)
  }
  setPlaying = (active: boolean): void => {
    if (this.retired || active === this.playing || this.mode === 'capture') return
    this.playing = active
    if (active) { this.resumeMedia?.(); this.resumeMedia = undefined; this.interactions.applyAllVisibility(); this.emit('__runtime.playing', true) }
    else {
      this.interactions.pause(); this.resumeMedia = this.audioManager?.pauseActive()
      if (this.mode === 'edit') this.interactions.applyAllVisibility()
    }
  }
  previewMotion(action: import('../../shared/interactionTypes').NodeMotionAction, signal: AbortSignal): Promise<boolean> {
    return this.interactions.motion(action, { signal, ruleId: 'editor-preview', stepId: 'editor-preview', restartFromBeginning: true }, true)
  }
  targetSnapshots(): Array<{ reference: ComponentTarget; instanceId: string; value: JsonValue }>
  targetSnapshots(profile: 'full'): Array<{ reference: ComponentTarget; instanceId: string; value: JsonValue }>
  targetSnapshots(profile: RuntimeTargetProfile): Array<{ reference: ComponentTarget; instanceId: string; value?: JsonValue }>
  targetSnapshots(profile: RuntimeTargetProfile = 'full'): Array<{ reference: ComponentTarget; instanceId: string; value?: JsonValue }> {
    if (!this.project) return []
    const references: ComponentTarget[] = [{ kind: 'project' }, ...this.project.surfaces.map(surface => ({ kind: 'surface' as const, surfaceId: surface.id })),
      ...Object.keys(this.project.instances).map(instanceId => ({ kind: 'instance' as const, instanceId }))]
    if (profile === 'references') return references.map(reference => ({ reference,
      instanceId: reference.kind === 'instance' ? reference.instanceId : reference.kind === 'surface' ? reference.surfaceId : this.project!.id }))
    return references.flatMap(reference => { const target = this.target(reference); return target ? [{ reference, instanceId: target.instanceId, value: target.read() }] : [] })
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.retired = true; this.playing = false
    return this.disposal = this.disposeWorld()
  }
  private async disposeWorld(): Promise<void> {
    this.project = undefined; this.documentResources = undefined
    this.stopNavigation?.(); this.spots.clear(); this.spotPreviews.clear(); this.notifySpots(); this.spotListeners.clear()
    this.interactions.dispose(); this.audioManager?.destroy(); this.audioEvents.dispose(); this.resumeMedia = undefined
    await this.host.disposeScope(this.runScopeId)
    this.layouts.clear()
    for (const root of this.roots.values()) root.remove()
    this.roots.clear(); this.projectionRoots.clear(); this.targetElements.clear(); this.synced.clear(); this.eventListeners.clear(); this.stateListeners.clear(); this.state.clear()
    for (const url of this.assetUrls.values()) URL.revokeObjectURL(url)
    this.assetUrls.clear(); this.contentAssetUrls.clear(); this.referencedAssetUrls.clear(); this.assetContents.clear(); this.themeStyle?.remove(); this.themeStyle = undefined
    this.parking?.remove(); this.parking = undefined
  }
}
