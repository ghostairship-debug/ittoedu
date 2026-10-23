import { hasWebContentData } from '../../components/web/sourcePreparation'
import { ComponentRuntimeHost, type PreparedComponentRuntime, type ComponentRuntimeHandle, type ComponentRuntimeNavigationPort } from './runtime/ComponentRuntimeHost'
import { nanoid } from 'nanoid'
import type { ComponentDefinition, ComponentImplementation, ComponentRuntimeImplementation, ComponentTarget, JsonValue, CourseProjectV10, ComponentAuthorSpot, ComponentAuthorSpotInput, ComponentAuthorGeometry, ComponentAuthorPreviewCallbacks } from '../../shared/contracts/component-platform'
import type { DocumentResources } from '../../shared/workbench/document'
import type { TeacherControllerPort } from '../../shared/contracts/component-platform/teacherController'
import { createAudioRuntimeImplementation, createVideoRuntimeImplementation } from '../../components/media'
import { AudioManager, type AudioPlaybackEvent } from '../AudioManager'
import { CourseEventBus } from '../CourseEventBus'
import { createComponentInteractionRuntime } from '../../renderer/interactions/componentInteractionRuntime'
import { ComponentWorldInteractions } from './runtime/ComponentWorldInteractions'
import { ComponentWorldMedia } from './runtime/ComponentWorldMedia'
import { componentContainers, componentSurface, isComponentVisibleAtSurface } from '../../shared/contracts/component-platform'
import { courseThemeStyleText } from '../../shared/contracts/design-v1/theme'
import { componentLayoutInput } from '../../components/web/measuredFragmentBox'
import { nativeFlowMediaBlockSize } from '../../shared/flowNativeLayout'
import { createComponentCompilationInputReader } from '../../core/components/compilation/componentCompilationInput'
import type { ComponentCompilationInput } from '../../core/components/compilation/types'
import { flowObjectExtent } from '../../core/components/geometry/flowObjectExtent'
import type { ComponentLayoutInput, ComponentLayoutPort, ComponentInstance, ComponentRuntimeActivity } from '../../shared/contracts/component-platform'
import type { RuntimeTargetProfile } from '../../components/web/moduleGraph'
import { allDocumentTextSlots,inlineComponentIds,documentTextAt,documentTextRanges,documentRangeElements,documentRangeAt } from '../../shared/document/textInteraction'
import { isGlobalTeacherController } from '../../shared/teacherControllerViewportGeometry'
import { instanceContainerId, instanceWorkRootId, isWithinContainer, runtimeInstanceOwner } from './runtime/containerScopes'
import { measureComponentGeometry } from './runtime/componentGeometry'

type Listener = (value: JsonValue | undefined) => void
const snapshotValue = <Value extends JsonValue | undefined>(value: Value): Value => value !== null && typeof value === 'object' ? structuredClone(value) : value
const usesContentRealm = (implementation: ComponentImplementation): boolean => implementation.kind === 'source'
  || implementation.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key)
/** A run owns transient state and leases. It never writes author data or History. */
export class ComponentRuntimeWorld {
  readonly host: ComponentRuntimeHost
  private project?: CourseProjectV10
  private documentResources?: DocumentResources
  private readonly readCompilationInput = createComponentCompilationInputReader()
  private readonly compilationInputIds = new WeakMap<ComponentCompilationInput, string>()
  private compilationInputSequence = 0
  private readonly layouts = new Map<string, { generation: number; notify(): void; sync(): void }>()
  private roots = new Map<string, HTMLElement>()
  private projectionRoots = new Map<string, HTMLElement>()
  private readonly defaultProjectionRoots = new Map<string, HTMLElement>()
  private readonly defaultTargetElements = new Map<string, HTMLElement>()
  private readonly inlineBindings = new Map<string, { root: HTMLElement; ownerId: string }>()
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
  private readonly assetContents = new Map<string, { source: Uint8Array; mimeType: string }>()
  private readonly themeMarker = `component-${nanoid()}`
  private readonly fontFaceCss: string
  private themeStyle?: HTMLStyleElement
  private themeText = ''
  private resourceVersion = 0
  private publishedResourceVersion = -1
  private readonly synced = new Set<string>()
  private readonly pendingSync = new Set<string>()
  private readonly implementations: Map<string, ComponentRuntimeImplementation>
  private readonly audioEvents = new CourseEventBus()
  private audioManager?: AudioManager
  private mediaSettings?: CourseProjectV10['media']
  private readonly interactions: ComponentWorldInteractions
  private readonly media: ComponentWorldMedia
  private playing: boolean
  private playbackEpoch = 0
  private resumeMedia?: () => void
  private readonly mode: 'edit' | 'play' | 'capture'
  private readonly report: (message: string) => void
  private readonly spots = new Map<string, ComponentAuthorSpot>()
  private readonly spotPreviews = new Map<string, ComponentAuthorPreviewCallbacks>()
  private readonly spotListeners = new Set<() => void>()
  private spotSequence = 0
  private readonly cancelNavigation?: () => void
  private readonly stopNavigation?: () => void
  private readonly notifyNavigationCapabilities?: () => void
  private readonly disconnectNavigationRuntime?: () => void
  private reset?: Promise<void>
  private retired = false
  private disposal?: Promise<void>
  private readonly surfaceId?: () => string | null
  private readonly navigation?: TeacherControllerPort
  private readonly readInstanceData?:(instance:ComponentInstance)=>JsonValue
  private readonly authoringEnabled:boolean
  private readonly fixedViewport?:(instance:ComponentInstance)=>boolean|undefined
  private readonly projectionManaged: boolean
  private readonly onProjectionCommit?: () => void
  private projectionTargetsChanged = false
  private targetProject?: CourseProjectV10
  private readonly activities = new Map<string, ComponentRuntimeActivity>()
  private readonly observed = new Map<string, HTMLElement>()
  private readonly visibilityIds = new WeakMap<Element, string>()
  private readonly intersections = new Map<string, boolean>()
  private visibilityObserver?: IntersectionObserver

  constructor(readonly runScopeId: string, options: {
    resolveSource?(implementation: Extract<ComponentImplementation, { kind: 'source' }>, signal: AbortSignal): Promise<PreparedComponentRuntime>
    report?(message: string): void
    builtins?: ReadonlyMap<string, ComponentRuntimeImplementation>
    builtinFactory?(ports: { assetUrl(id: string): string | undefined; teacherController?: TeacherControllerPort; reportImage(message: string, assetId: string): void }): ReadonlyMap<string, ComponentRuntimeImplementation>
    teacherController?: TeacherControllerPort & { subscribeSceneReplay?(listener: (surfaceId: string) => void): () => void }
    /** Student/authored actions never inherit the teacher directory's force-jump capability. */
    studentNavigation?: TeacherControllerPort & { changed?(): void; connectRuntime?(runtime: ComponentRuntimeNavigationPort): () => void; runtimeCapabilitiesChanged?(instanceId: string): void }
    resolveBuiltin?(key: string, signal: AbortSignal, instance: ComponentInstance): Promise<PreparedComponentRuntime>
    /** Published resource owner resolves only actual consumer requests. */
    resolveAssetUrl?(id: string): string | undefined
    isAssetPending?(id: string): boolean
    waitForAsset?(id: string, signal: AbortSignal): Promise<boolean>
    /** Host-owned bundled faces for isolated content documents; not author theme data. */
    fontFaceCss?: string
    mode?: 'edit' | 'play' | 'capture'
    authoring?:boolean
    readInstanceData?(instance:ComponentInstance):JsonValue
    fixedViewport?(instance:ComponentInstance):boolean|undefined
    /** ModelPlayer performs synchronization only after an actual projection commit. */
    projectionManaged?: boolean
    /** A connected ref / completed NodeView mutation can commit after its parent React tree. */
    onProjectionCommit?(): void
  } = {}) {
    this.mode = options.mode ?? 'play'; this.playing = this.mode === 'play'
    this.readInstanceData=options.readInstanceData
    this.authoringEnabled=options.authoring!==false;this.fixedViewport=options.fixedViewport
    this.projectionManaged = options.projectionManaged ?? false
    this.onProjectionCommit = options.onProjectionCommit
    this.resolveAssetUrl = options.resolveAssetUrl
    this.notifyNavigationCapabilities = options.studentNavigation?.changed
    this.cancelNavigation = (options.studentNavigation ?? options.teacherController)?.cancel
    this.isAssetPending = options.isAssetPending
    this.fontFaceCss = options.fontFaceCss ?? ''
    this.navigation = options.studentNavigation ?? options.teacherController
    this.surfaceId = this.navigation?.readLocation
    this.report = message => options.report?.(message)
    this.audioEvents.on<AudioPlaybackEvent>('audio:ended', event => {
      if (event && !this.retired) this.emit('audio.ended', { soundId: event.soundId })
    })
    this.media = new ComponentWorldMedia(() => this.audioManager, this.report, id => {
      return this.playing && this.instanceActive(id)
    }, () => this.playbackEpoch)
    this.interactions = new ComponentWorldInteractions({ project: () => this.project, element: id => this.targetElement(id),
      document: () => this.targetElements.values().next().value?.ownerDocument ?? this.roots.values().next().value?.ownerDocument,
      audio: () => this.audioManager, video: (action, signal) => this.media.executeVideo(action, signal), navigation: options.studentNavigation ?? options.teacherController, report: this.report, active: () => this.playing, playback: () => this.mode !== 'capture',
      waitForAsset: async (id, signal) => Boolean(!signal.aborted && (this.assetUrl(id) || await options.waitForAsset?.(id, signal))),
      instanceActive: id => this.instanceActive(id),
      notifyVisibility: id => {
        this.emit('__runtime.visibility', null); this.refreshActivity()
        if (id && (!this.synced.has(id) || this.pendingSync.has(id))) void this.syncInstance(id).catch(error => this.report(String(error)))
      },
      activated: instanceId => this.emit('node.activated', { instanceId }),
      controlsInitiallyVisible: () => this.mode === 'edit' && !this.playing || this.project?.playback?.controls !== 'none' })
    // The World owns actions/state/media/lifetimes. Entry owners provide only
    // the professional implementations this carrier actually consumes.
    this.implementations = new Map<string, ComponentRuntimeImplementation>([
      ['guoling.group', { mount: () => ({ update() {}, dispose() {} }) }],
      ...(['slide', 'flow', 'spatial'] as const).map(kind => [`guoling.container.${kind}`, { mount: () => ({ update() {}, dispose() {} }) }] as const),
      ['guoling.interactions', createComponentInteractionRuntime(context => this.interactions.ports(context))],
      ...(options.builtinFactory?.({assetUrl: id => this.assetUrl(id), teacherController: options.teacherController,
        reportImage: (message,assetId) => { if (!options.isAssetPending?.(assetId)) options.report?.(message) }}) ?? []),
      ...(options.builtins ?? []),
    ])
    this.host = new ComponentRuntimeHost({
      documentHtml: instance => { const data = this.readInstanceData?.(instance) ?? instance.data; return hasWebContentData(data) ? data.html : undefined },
      capabilitiesChanged: (_scope, id) => {
        if (options.studentNavigation?.runtimeCapabilitiesChanged) options.studentNavigation.runtimeCapabilitiesChanged(id)
        else options.studentNavigation?.changed?.()
      },
      canInteract: (_scope, id) => this.instanceActive(id),
      resources: { url: id => this.contentAssetUrl(id) },
      media: scope => this.media.port(scope),
      interactions: context => this.interactions.ports(context),
      authoring: options.authoring===false?undefined:(_scope, instanceId, generation) => ({ register: (spot, callbacks) => this.registerAuthorSpot(instanceId, generation, spot, callbacks) }),
      layout: (_scope, instance, generation) => this.layoutPort(instance, generation),
      inline: scope => ({ mount: (id,root) => {
        const project = this.project, owner = project?.instances[scope.instanceId]
        const implementation = owner && (owner.implementationOverride ?? project?.definitions[owner.definitionId]?.implementation)
        const ownsSlot = Boolean(owner?.container || implementation?.kind === 'source'
          || implementation?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key))
        if (!scope.isActive() || !owner?.childIds?.includes(id)
          || !ownsSlot && !allDocumentTextSlots(owner.data).some(slot => inlineComponentIds(slot.content).includes(id))) return () => {}
        const binding = { root, ownerId: scope.instanceId }
        this.inlineBindings.set(id, binding)
        this.bindProjection(id, root); this.bindEffectiveTarget(id, root)
        let bound = true
        const release = () => {
          if (!bound) return
          bound = false
          if (this.inlineBindings.get(id) !== binding) return
          this.inlineBindings.delete(id)
          if (this.retired || !this.project?.instances[id]) return
          this.bindProjection(id, this.defaultProjectionRoots.get(id) ?? null)
          this.bindEffectiveTarget(id, this.defaultTargetElements.get(id) ?? null)
        }
        scope.cleanup(release)
        return release
      }}),
      resolveImplementation: (implementation, _definition, signal, instance) => {
        const navigation = this.project && isGlobalTeacherController(this.project, instance.id) ? options.teacherController : options.studentNavigation
        const originalController = navigation?.forInstance?.(instance.id) ?? navigation
        const canAct = () => this.instanceActive(instance.id) && this.playing
        const canView = () => this.instanceActive(instance.id) && (this.playing || this.mode === 'edit')
        const controllerForScope = (scope: import('../../shared/contracts/component-platform').ComponentRuntimeScope): TeacherControllerPort | undefined => {
          if (!originalController) return undefined
          const wrappers = new WeakMap<TeacherControllerPort, TeacherControllerPort>()
          const alive = () => scope.isActive() && !scope.signal.aborted
          const wrap = (port: TeacherControllerPort): TeacherControllerPort => {
            const previous = wrappers.get(port)
            if (previous) return previous
            const subscribe = (register: (listener: () => void) => () => void, listener: () => void) => {
              if (!alive()) return () => {}
              let listening = true
              const unsubscribe = register(() => { if (listening && alive()) listener() })
              const off = () => { if (listening) { listening = false; unsubscribe() } }
              scope.cleanup(off)
              return off
            }
            const guarded: TeacherControllerPort = { ...port,
              readLocation: () => alive() ? port.readLocation() : null,
              read: () => alive() ? port.read() : { locationId: null, interactive: false, scenes: [], progress: null, zoom: 1, muted: false, fullscreen: false },
              subscribe: listener => subscribe(port.subscribe, listener),
              ...(port.subscribePlacement ? { subscribePlacement: (listener: () => void) => subscribe(port.subscribePlacement!, listener) } : {}),
              ...(port.forContainer ? { forContainer: (id: string) => alive() ? wrap(port.forContainer!(id)) : guarded } : {}),
              ...(port.forInstance ? { forInstance: (id: string) => alive() ? wrap(port.forInstance!(id)) : guarded } : {}),
              ...(port.currentStateId ? { currentStateId: () => alive() ? port.currentStateId!() : null } : {}),
              ...(port.isContainerActive ? { isContainerActive: (id: string) => alive() && port.isContainerActive!(id) } : {}),
              ...(port.readVisibility ? { readVisibility: () => alive() ? port.readVisibility!() : { zoom: 1, stateId: null } } : {}),
              canExecute: action => alive() && canAct() && port.canExecute(action),
              execute: async (action, signal, onCommit) => {
                if (!alive() || !canAct() || signal?.aborted) return false
                const request = new AbortController(), abort = () => request.abort()
                scope.signal.addEventListener('abort', abort, { once: true }); signal?.addEventListener('abort', abort, { once: true })
                if (scope.signal.aborted || signal?.aborted) abort()
                try { return await port.execute(action, request.signal, () => { if (alive()) onCommit?.() }) }
                finally { scope.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort) }
              },
              cancel: () => { if (alive() && canAct()) port.cancel?.() },
              setCollapsed: value => { if (alive() && canView()) port.setCollapsed(value) },
              moveBy: (dx, dy) => { if (alive() && canView()) port.moveBy(dx, dy) },
              setZoom: value => { if (alive() && canView()) port.setZoom(value) },
              resetView: () => { if (alive() && canView()) port.resetView() },
            }
            wrappers.set(port, guarded)
            return guarded
          }
          return wrap(originalController)
        }
        const connectNavigation = async (prepared: PreparedComponentRuntime | Promise<PreparedComponentRuntime>): Promise<PreparedComponentRuntime> => {
          const loaded = await prepared
          return { ...loaded, implementation: { ...loaded.implementation, mount: context => loaded.implementation.mount({ ...context, teacherController: controllerForScope(context.scope),
            resources: { url: name => {
              const binding = this.project?.instances[context.instance.id]?.authoring?.resourceBindings?.[name]
              return binding ? this.contentAssetUrl(binding) : context.resources?.url(name)
            } },
          }) } }
        }
        if (implementation.kind === 'source') {
          if (!options.resolveSource) throw new Error('源码运行环境尚未连接；源码和参数已保留')
          return connectNavigation(options.resolveSource(implementation, signal))
        }
        if (['guoling.web', 'guoling.html-program'].includes(implementation.key) && options.resolveBuiltin) return connectNavigation(options.resolveBuiltin(implementation.key, signal, instance))
        const resolved = this.implementations.get(implementation.key)
        if (!resolved) throw new Error(`组件实现尚未接入：${implementation.key}`)
        return { ...resolved, mount: async context => {
          const mounted = await resolved.mount({ ...context, teacherController: controllerForScope(context.scope) })
          if (implementation.key !== 'guoling.navigation') return mounted
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
        measure: async references => measureComponentGeometry(references, {
          target: reference => this.target(reference),
          flows: reference => {
            const project = this.project
            if (!project) return []
            let id = reference.kind === 'instance' || reference.kind === 'text-range' ? reference.instanceId
              : reference.kind === 'surface' ? reference.surfaceId : undefined
            const result: { containerId: string; root: HTMLElement }[] = [], visited = new Set<string>()
            while (id && !visited.has(id)) {
              visited.add(id)
              const root = this.targetElement(id)
              if (project.instances[id]?.container?.kind === 'flow' && root) result.push({ containerId: id, root })
              const owner = runtimeInstanceOwner(project, id)
              id = owner?.kind === 'instance' ? owner.instanceId : undefined
            }
            return result
          },
        }),
        events: { emit: (name, value) => {
          if (name === 'component.diagnostic' && value && typeof value === 'object' && !Array.isArray(value) && typeof value.message === 'string') this.report(`${instanceId}：${value.message}`)
          if (name === '__runtime.text-ranges' && value && typeof value === 'object' && !Array.isArray(value) && typeof value.instanceId === 'string') this.notifyTextRanges(value.instanceId)
          else this.emit(name, value)
          this.emit('__component.event', { instanceId, name, value })
        }, subscribe: (name, listener) => {
          const eventKey = name === '__runtime.activity' ? `__runtime.activity:${instanceId}` : name
          const listeners = this.eventListeners.get(eventKey) ?? new Set()
          this.eventListeners.set(eventKey, listeners); listeners.add(listener)
          if (name === '__runtime.playing') listener(this.playing)
          if (name === '__runtime.activity') {
            const activity = this.runtimeActivity(instanceId)
            this.activities.set(instanceId, activity)
            listener({ ...activity })
          }
          return () => { listeners.delete(listener); if (!listeners.size && name === '__runtime.activity') this.activities.delete(instanceId) }
        } },
        state: { get: name => this.getState(name), set: (name, value) => this.setState(name, value), subscribe: (name, listener) => {
          const listeners = this.stateListeners.get(name) ?? new Set()
          this.stateListeners.set(name, listeners); listeners.add(listener)
          return () => { listeners.delete(listener) }
        } },
      }),
      reportError: (error, phase, _scope, id) => options.report?.(`${id} ${phase}：${error instanceof Error ? error.message : String(error)}`),
    })
    this.disconnectNavigationRuntime = options.studentNavigation?.connectRuntime?.({
      read: id => {
        const capability = this.host.capabilities(this.runScopeId, id), instance = this.project?.instances[id]
        if (capability.status !== 'unprepared' || !instance) return capability
        const data = this.readInstanceData?.(instance) ?? instance.data
        return hasWebContentData(data) ? { ...capability, html: data.html } : capability
      },
      prepare: (id, signal) => this.prepareNavigationInstance(id, signal),
    })
    let locationId: string | null | undefined
    let visibilityProject: CourseProjectV10 | undefined
    let visibilityBindings: Array<{ id: string; navigation: TeacherControllerPort }> = []
    const visibilitySignatures = new Map<string, string>()
    let workVisibilitySignature: string | undefined
    this.audioEvents.on('audio:change', () => options.studentNavigation?.changed?.())
    const stopNavigation = this.navigation?.subscribe(() => {
      const snapshot = this.navigation!.read(), current = snapshot.locationId
      const previous = locationId, changed = previous !== current
      if (locationId !== current) {
        if (locationId) this.audioEvents.emit('scene:leave', { sceneId: locationId })
        if (current) this.audioEvents.emit('scene:enter', { sceneId: current })
        locationId = current
        this.interactions.surfaceChanged()
      }
      if (this.mode !== 'edit' || this.playing) {
        const project = this.project
        if (project !== visibilityProject) {
          visibilityProject = project
          visibilityBindings = project && this.navigation?.forContainer ? Object.values(project.instances)
            .filter(instance => instance.container).map(instance => ({ id: instance.id, navigation: this.navigation!.forContainer!(instance.id) })) : []
          visibilitySignatures.clear()
        }
        const workSignature = JSON.stringify([current, snapshot.zoom, this.navigation?.currentStateId?.() ?? null])
        const workChanged = workSignature !== workVisibilitySignature
        workVisibilitySignature = workSignature
        const changedScopes = new Set<string>(workChanged ? [previous, current].filter((id): id is string => Boolean(id)) : [])
        for (const binding of visibilityBindings) {
          const visibility = binding.navigation.readVisibility?.() ?? { zoom: binding.navigation.read().zoom, stateId: binding.navigation.currentStateId?.() ?? null }
          const signature = JSON.stringify([visibility.zoom, visibility.stateId])
          if (visibilitySignatures.get(binding.id) !== signature) { visibilitySignatures.set(binding.id, signature); changedScopes.add(binding.id) }
        }
        if (changedScopes.size || workChanged) this.interactions.applyAllVisibility(snapshot, changedScopes, workChanged)
      }
      this.emit('__runtime.presentation', current ?? null)
      this.refreshActivity()
    })
    const stopReplay = options.teacherController?.subscribeSceneReplay?.(surfaceId => {
      if (this.retired || this.navigation?.isContainerActive?.(surfaceId) === false
        || !this.navigation?.isContainerActive && this.navigation?.readLocation() !== surfaceId) return
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
    const authored = (withAuthoredHeight = true) => {
      const instance = this.project?.instances[id] ?? mounted
      const target = this.targetElements.get(id), root = this.projectionRoots.get(id)
      const inline = this.inlineBindings.has(id), program = target?.dataset.componentPlacement === 'program'
      let input: ComponentLayoutInput
      let extent: ReturnType<typeof flowObjectExtent> = null
      if (inline) input = { mode: 'free-frame', inlineSize: instance.frame?.width ?? 1, blockSize: instance.frame?.height ?? 1 }
      else if (program) input = { mode: 'program-viewport', inlineSize: 1, blockSize: 1 }
      else {
        const host = { project: this.project!, kind: target?.dataset.componentPlacement === 'flow' ? 'flow' as const : 'free-frame' as const,
          inlineSize: 1, viewport: { width: 1, height: 1 }, definition: this.project?.definitions[instance.definitionId] }
        const fixed = this.fixedViewport?.(instance)
        input = componentLayoutInput(instance, host, fixed)
        if (input.mode !== 'flow-content' && !instance.frame && instance.childIds?.length && this.project) {
          extent = flowObjectExtent(this.project, id)
          if (extent) input = componentLayoutInput(instance, { ...host, viewport: extent }, fixed)
        }
      }
      const authoredHeight = withAuthoredHeight && input.mode === 'flow-content' && this.project ? nativeFlowMediaBlockSize(this.project, instance) : undefined
      return { instance, target, root, inline, program, input, extent, authoredHeight }
    }
    const measuredInput = (facts: ReturnType<typeof authored>, usedFallback?: () => void): ComponentLayoutInput => {
      const { instance, target, root, inline, program, input, extent } = facts
      const width = () => {
        const value = target?.clientWidth
        if (value) return value
        usedFallback?.()
        return root?.parentElement?.clientWidth || instance.frame?.width || 1
      }
      const height = (fallback: () => number) => {
        const value = target?.clientHeight
        if (value) return value
        usedFallback?.()
        return fallback()
      }
      if (inline) return { mode: 'free-frame', inlineSize: width(), blockSize: height(() => instance.frame?.height || 1) }
      if (program) return { mode: 'program-viewport', inlineSize: width(), blockSize: height(() => root?.parentElement?.clientHeight || 1) }
      if (input.mode === 'flow-content') return { mode: 'flow-content', inlineSize: width() }
      // These branches use author dimensions in the existing layout contract.
      // Reading a client box before returning the same frame forces needless layout.
      if (instance.frame || extent) return input
      return { mode: input.mode, inlineSize: width(), blockSize: height(() => 1) }
    }
    const read = (): ComponentLayoutInput => measuredInput(authored(false))
    const authorSignature = (facts: ReturnType<typeof authored>) => JSON.stringify([facts.inline, facts.program,
      facts.instance.frame?.width, facts.instance.frame?.height, facts.input, facts.authoredHeight])
    let last = '', lastAuthor = '', lastTargetGeometry = false, ownsAuthoredFlowHeight = false
    const notify = (facts = authored()) => {
      let targetGeometry = true
      const input = measuredInput(facts, () => { targetGeometry = false }), { authoredHeight } = facts
      lastTargetGeometry = targetGeometry
      lastAuthor = authorSignature(facts)
      const signature = JSON.stringify([input, authoredHeight])
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
        root.style.height = authoredHeight ? '100%' : input.mode === 'flow-content' ? 'var(--component-flow-height, auto)'
          : input.mode === 'flow-viewport' ? `${input.blockSize}px` : '100%'
        mount.style.height = input.mode === 'flow-content' && !authoredHeight ? 'auto' : '100%'
        // The runtime host adds its own retained child and consumes this same
        // inherited height variable. Keep the CSS-owned size through that layer.
        if (authoredHeight) {
          root.style.setProperty('--component-flow-height', '100%')
          ownsAuthoredFlowHeight = true
        } else if (ownsAuthoredFlowHeight || input.mode !== 'flow-content') {
          root.style.removeProperty('--component-flow-height')
          ownsAuthoredFlowHeight = false
        }
      }
      for (const listener of listeners) listener(input)
      this.refreshProfessionalBounds(id)
    }
    const slot = { generation, notify: () => notify(), sync: () => {
      const facts = authored()
      // The live target observer owns DOM-size changes, including ancestor CSS,
      // font reflow and reconnect. Without it retain the original sync sampling.
      // A zero-sized target can fall back to a parent box outside this observer.
      // Only the last actual notification can establish this sampling boundary.
      if (observer && observed && lastTargetGeometry && authorSignature(facts) === lastAuthor) return
      notify(facts)
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
        if (input.mode !== 'flow-content' || this.project && nativeFlowMediaBlockSize(this.project, this.project.instances[id] ?? mounted) || !Number.isFinite(report.inlineSize) || !Number.isFinite(report.blockSize) || report.blockSize < 0
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
    if(reference.kind==='text-range'){
      const instance=project.instances[reference.instanceId],range=instance&&documentRangeAt(instance.data,reference.dataPath,reference.rangeId)
      if(!range)return null
      const runtime=this,read=()=>JSON.parse(JSON.stringify({inlines:documentRangeAt(runtime.project?.instances[reference.instanceId]?.data,reference.dataPath,reference.rangeId)?.content.inlines.filter(inline=>inline.rangeIds?.includes(reference.rangeId))??[]})) as JsonValue
      const elements=()=>documentRangeElements(runtime.targetElements.get(reference.instanceId)??runtime.projectionRoots.get(reference.instanceId),reference.rangeId,documentRangeAt(runtime.project?.instances[reference.instanceId]?.data,reference.dataPath,reference.rangeId)?.path)
      return {instanceId:reference.instanceId,get element(){return elements()[0]},get elements(){return elements()},read,emit:(name:string,value:JsonValue)=>runtime.emit(name,value)}
    }
    const read = () => {
      if (reference.kind === 'project') return JSON.parse(JSON.stringify(this.readInstanceData&&this.project?{...this.project,instances:Object.fromEntries(Object.entries(this.project.instances).map(([id,instance])=>[id,{...instance,data:this.readInstanceData!(instance)}]))}:this.project)) as JsonValue
       if (reference.kind === 'surface') return JSON.parse(JSON.stringify(this.project && componentSurface(this.project, reference.surfaceId) || null)) as JsonValue
      const instance=this.project?.instances[reference.instanceId];return structuredClone(instance?(this.readInstanceData?.(instance)??instance.data):null)
    }
    const id = reference.kind === 'instance' ? reference.instanceId : reference.kind === 'surface' ? reference.surfaceId : project.id
    if (reference.kind === 'instance' && !project.instances[id] || reference.kind === 'surface' && !componentSurface(project, id)) return null
    const runtime = this
    return { instanceId: id, get element() { return runtime.targetElements.get(id) ?? runtime.projectionRoots.get(id)?.parentElement ?? undefined }, read,
      emit: (name: string, value: JsonValue) => this.emit(name, value),
      ...(reference.kind === 'instance' && this.targetElements.has(id) ? { motion: this.interactions.motionPort(id), presentation: this.interactions.presentationPort(id) } : {}) }
  }
  notifyTextRanges(instanceId: string): void {
    this.emit('__runtime.text-ranges', { instanceId })
    for (const instance of this.rangeAttachmentInstances(instanceId)) {
      if (!this.behaviorCanProject(instance.id)) continue
      if (this.projectionManaged) { this.projectionTargetsChanged = true; this.onProjectionCommit?.(); continue }
      void this.syncInstance(instance.id).then(() => this.host.refreshTargets(this.runScopeId, instance.id,
        () => this.behaviorCanProject(instance.id))).catch(error => this.report(String(error)))
    }
  }
  private rangeAttachmentInstances(instanceId: string): ComponentInstance[] {
    return Object.values(this.project?.instances ?? {}).filter(instance => instance.attachments?.some(attachment =>
      attachment.target.kind === 'text-range' && attachment.target.instanceId === instanceId))
  }

  private emit(name: string, value: JsonValue): void {
    for (const listener of this.eventListeners.get(name) ?? []) listener(snapshotValue(value))
    if (['__runtime.state', '__runtime.presentation', '__runtime.playing', '__runtime.visibility'].includes(name))
      this.interactions.refreshClickAffordances(name !== '__runtime.state')
  }
  private instanceActive(id: string): boolean {
    if (this.retired || !this.project?.instances[id]) return false
    if (this.mode === 'edit' && !this.playing) return true
    const rootId = this.instanceSurfaceId(id)
    if (rootId === null || !this.surfaceId) return true
    const current = this.surfaceId() ?? this.project.entry?.rootInstanceId
    if (rootId !== current) return false
    const containerId = instanceContainerId(this.project, id, true)
    return !containerId || this.navigation?.isContainerActive?.(containerId) !== false
  }
  private runtimeActivity(id: string, currentViewport = false): ComponentRuntimeActivity {
    const active = this.instanceActive(id), instance = this.project?.instances[id]
    const element = this.targetElements.get(id) ?? this.projectionRoots.get(id)
    let visible = active && Boolean(element?.isConnected)
    if (!element && instance && this.project?.definitions[instance.definitionId]?.role === 'behavior') visible = active
    for (let ancestor = element; ancestor && visible; ancestor = ancestor.parentElement ?? undefined) {
      if (ancestor.hidden || ancestor.style.display === 'none' || ancestor.style.visibility === 'hidden') visible = false
    }
    if (visible && element && this.mode !== 'capture') {
      const intersection = this.intersections.get(id)
      if (!currentViewport && intersection !== undefined) visible = intersection
      else {
        const rect = element.getBoundingClientRect(), view = element.ownerDocument.defaultView
        // Zero-size DOMs (including non-layout test hosts) have no viewport fact yet.
        if (view && rect.width > 0 && rect.height > 0) visible = rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth
      }
    }
    return { active, visible, playing: this.playing }
  }
  private refreshActivity(id?: string): void {
    for (const instanceId of id ? [id] : this.activities.keys()) {
      const previous = this.activities.get(instanceId)
      if (!previous) continue
      const next = this.runtimeActivity(instanceId)
      if (previous.active === next.active && previous.visible === next.visible && previous.playing === next.playing) continue
      this.activities.set(instanceId, next)
      this.emit(`__runtime.activity:${instanceId}`, { ...next })
    }
  }
  private observeVisibility(id: string): void {
    const element = this.targetElements.get(id) ?? this.projectionRoots.get(id)
    const previous = this.observed.get(id)
    if (previous === element) return
    if (previous) this.visibilityObserver?.unobserve(previous)
    this.observed.delete(id); this.intersections.delete(id)
    const Observer = element?.ownerDocument.defaultView?.IntersectionObserver
    if (element && Observer && this.mode !== 'capture') {
      this.visibilityObserver ??= new Observer(entries => {
        for (const entry of entries) {
          const instanceId = this.visibilityIds.get(entry.target)
          if (!instanceId || this.observed.get(instanceId) !== entry.target) continue
          this.intersections.set(instanceId, entry.isIntersecting)
          this.refreshActivity(instanceId)
          if (entry.isIntersecting && (!this.synced.has(instanceId) || this.pendingSync.has(instanceId))) void this.syncInstance(instanceId).catch(error => this.report(String(error)))
        }
      })
      this.observed.set(id, element); this.visibilityIds.set(element, id); this.visibilityObserver.observe(element)
    }
    this.refreshActivity(id)
  }
  bind = (instanceId: string, element: HTMLElement | null, expectedDefault?: HTMLElement): void => {
    if (this.retired || element === null && expectedDefault && this.defaultProjectionRoots.get(instanceId) !== expectedDefault) return
    if (element) this.defaultProjectionRoots.set(instanceId, element)
    else this.defaultProjectionRoots.delete(instanceId)
    if (!this.inlineBindings.has(instanceId)) this.bindProjection(instanceId, element)
  }
  private bindProjection(instanceId: string, element: HTMLElement | null): void {
    const previous = this.projectionRoots.get(instanceId) ?? null
    let moved = false
    if (element) {
      element.dataset.componentCourseWorld = this.themeMarker
      this.projectionRoots.set(instanceId, element)
      let root = this.roots.get(instanceId)
      if (!root) {
        root = element.ownerDocument.createElement('div')
        root.dataset.componentRuntimeRoot = instanceId
        root.style.width = '100%'; root.style.height = '100%'
        this.roots.set(instanceId, root)
      }
      // Moving author ownership changes the projection parent, not the run slot or its DOM.
      if (root.parentElement !== element) { this.placeRoot(element, root); moved = true }
    } else {
      const root = this.roots.get(instanceId)
      if (root) {
        if (!this.parking) { this.parking = root.ownerDocument.createElement('div'); this.parking.hidden = true; root.ownerDocument.body.append(this.parking) }
        if (root.parentElement !== this.parking) { this.placeRoot(this.parking, root); moved = true }
      }
      this.projectionRoots.delete(instanceId)
    }
    if (element && this.project && !this.projectionManaged) void this.syncInstance(instanceId).catch(() => {})
    if (element?.isConnected && this.projectionManaged) this.onProjectionCommit?.()
    const layout = this.layouts.get(instanceId)
    if (previous !== element || moved) layout?.notify()
    else layout?.sync()
    this.refreshProfessionalBounds(instanceId)
    this.observeVisibility(instanceId)
    this.refreshActivity(instanceId)
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
  beforeProjectionMutation(instanceIds?: ReadonlySet<string>): void {
    for (const [id, root] of this.roots) {
      if (instanceIds && !instanceIds.has(id)) continue
      if (!root.querySelector('iframe')) continue
      if (!this.parking) { this.parking = root.ownerDocument.createElement('div'); this.parking.hidden = true; root.ownerDocument.body.append(this.parking) }
      if (root.parentElement !== this.parking) this.placeRoot(this.parking, root)
    }
  }
  /** A deferred React unmount reports refs after its disposable wrapper can be
   * removed. Park this retiring subtree's current roots first, including empty
   * roots whose pending Source mount may create its iframe on the next turn. */
  beforeProjectionRemoval(retiring: HTMLElement): void {
    for (const [id, root] of this.roots) {
      const projection = this.projectionRoots.get(id)
      if (!projection || !retiring.contains(projection) || !retiring.contains(root)) continue
      if (!this.parking) { this.parking = root.ownerDocument.createElement('div'); this.parking.hidden = true; root.ownerDocument.body.append(this.parking) }
      if (root.parentElement !== this.parking) this.placeRoot(this.parking, root)
    }
  }
  afterProjectionMutation(): void {
    for (const [id, element] of this.projectionRoots) {
      const root = this.roots.get(id)
      if (root && element.isConnected && root.parentElement !== element) { this.placeRoot(element, root); this.layouts.get(id)?.notify() }
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
    const implementation = project.instances[id].implementationOverride ?? project.definitions[project.instances[id].definitionId]?.implementation
    if (implementation?.kind === 'builtin' && implementation.key === 'guoling.popover') {
      const references = project.instances[id].attachments?.filter(attachment => attachment.instanceId === id && attachment.target.kind === 'text-range').map(attachment => attachment.target)
      if (references?.length) return references.some(reference => this.target(reference)?.element?.isConnected)
    }
    // Only these professional behaviors reconnect a visual presentation lease.
    // Event/state behaviors keep their document-wide subscriptions, including
    // scene.enter before the next surface's React projection has mounted.
    if (implementation?.kind !== 'builtin' || !['guoling.feedback', 'guoling.visibility'].includes(implementation.key)) return true
    // A low-level runtime without a surface navigation owner keeps its original
    // document scope. Editor and Player both supply their one navigation owner.
    if (!this.surfaceId) return true
    return this.instanceActive(id)
  }
  private instanceSurfaceId(id: string): string | null | undefined {
    const project = this.project
    if (!project) return undefined
    return instanceWorkRootId(project, id)
  }
  bindTarget = (instanceId: string, element: HTMLElement | null, expectedDefault?: HTMLElement): void => {
    if (this.retired || element === null && expectedDefault && this.defaultTargetElements.get(instanceId) !== expectedDefault) return
    if (element) this.defaultTargetElements.set(instanceId, element)
    else this.defaultTargetElements.delete(instanceId)
    if (!this.inlineBindings.has(instanceId)) this.bindEffectiveTarget(instanceId, element)
  }
  private bindEffectiveTarget(instanceId: string, element: HTMLElement | null): void {
    const previous = this.targetElements.get(instanceId)
    if (previous && previous !== element) { this.interactions.cancelMotions(instanceId); this.interactions.retirePresentation(instanceId) }
    if (element) { element.dataset.componentCourseWorld = this.themeMarker; this.targetElements.set(instanceId, element) }
    else this.targetElements.delete(instanceId)
    this.interactions.refreshClickAffordances()
    const layout = this.layouts.get(instanceId)
    if (previous !== element) layout?.notify()
    else layout?.sync()
    if (this.mode !== 'edit') this.interactions.applyVisibility(instanceId)
    this.observeVisibility(instanceId)
    this.refreshActivity(instanceId)
    if (element?.isConnected && this.projectionManaged && (previous !== element || this.rangeAttachmentInstances(instanceId).length > 0)) {
      this.projectionTargetsChanged = true; this.onProjectionCommit?.()
    }
  }
  private async syncInstance(id: string, restarting = false, navigationTarget = false): Promise<ComponentRuntimeHandle | null | undefined> {
    if (this.reset && !restarting) { await this.reset; return this.syncInstance(id, false, navigationTarget) }
    if (this.retired) return
    const instance = this.project?.instances[id]
    if (!instance) return
    const definition: ComponentDefinition | undefined = this.project?.definitions[instance.definitionId]
    if (!definition) return
    const root = this.roots.get(id)
    if (!root && definition.role !== 'behavior') return
    const effective = instance.implementationOverride ?? definition.implementation
    const sourceRealm = usesContentRealm(effective)
    this.refreshActivity(id)
    // Temporary absence preserves the existing generation; first use is lazy.
    // Retirement still belongs to deletion, changed implementation, reset or close.
    if (sourceRealm && this.mode !== 'capture' && !this.runtimeActivity(id, navigationTarget).visible) {
      // A retained generation can still have pending author changes. Visibility
      // must sync the latest project before treating that generation as current.
      this.pendingSync.add(id)
      return
    }
    this.pendingSync.delete(id)
    this.synced.add(id)
    let sourceSignature: string | undefined
    if (effective.kind === 'source' && this.project) {
      try {
        const input = this.sourceCompilationInput(effective)
        sourceSignature = this.compilationInputIds.get(input)
        if (!sourceSignature) { sourceSignature = `source-input:${++this.compilationInputSequence}`; this.compilationInputIds.set(input, sourceSignature) }
      }
      catch (error) { sourceSignature = String(error) }
    }
    const web = hasWebContentData(instance.data) && (effective.kind === 'source' || ['guoling.web', 'guoling.html-program'].includes(effective.key))
    const resourceSources = web && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data.resourceSources : undefined
    const sourceOrigins = Array.isArray(resourceSources) ? resourceSources.flatMap(source => {
      if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.url !== 'string') return []
      try { const url = new URL(source.url); return /^https?:$/.test(url.protocol) ? [`${source.usage}:${url.origin}`] : [] } catch { return [] }
    }).sort() : []
    const environmentSignature = effective.kind === 'source' || web
      ? JSON.stringify([[...(this.project?.logic?.network?.connectOrigins ?? [])].sort(), sourceOrigins,
        Boolean(this.project && isGlobalTeacherController(this.project, id))]) : undefined
    const handle = await this.host.sync({ runScopeId: this.runScopeId, instance, definition, root, environmentSignature,
      preparationSignature: sourceSignature,
      canProject: definition.role === 'behavior' ? () => this.behaviorCanProject(id) : undefined })
    if (!handle?.scope.isActive()) return handle
    const implementation = instance.implementationOverride ?? definition.implementation
    const key = implementation.kind === 'builtin' ? implementation.key : null
    const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : null
    const field = key === 'guoling.text' ? 'content' : key === 'guoling.image' ? 'assetId' : null
    const spotId = `professional:${id}`, previous = this.spots.get(spotId)
    if (this.authoringEnabled && field && data && data[field] !== undefined && root) {
      const spot: ComponentAuthorSpot = { id: spotId, instanceId: id, mountGeneration: handle.scope.generation,
        kind: field === 'content' ? 'text' : 'image', dataPath: [field], initialValue: structuredClone(data[field]),
        localBounds: this.professionalBounds(instance, root) }
      if (!previous || JSON.stringify(previous) !== JSON.stringify(spot)) { this.spots.set(spotId, spot); this.notifySpots() }
    } else if (previous) { this.spots.delete(spotId); this.notifySpots() }
    return handle
  }
  private professionalBounds(instance: ComponentInstance, root: HTMLElement): ComponentAuthorSpot['localBounds'] {
    const slot = this.inlineBindings.has(instance.id) ? this.targetElements.get(instance.id) : undefined
    return { width: slot?.clientWidth || instance.frame?.width || root.clientWidth,
      height: slot?.clientHeight || instance.frame?.height || root.scrollHeight, transform: [1, 0, 0, 1, 0, 0] }
  }
  private refreshProfessionalBounds(id: string): void {
    const spot = this.spots.get(`professional:${id}`), instance = this.project?.instances[id], root = this.roots.get(id)
    if (!spot || !instance || !root) return
    const localBounds = this.professionalBounds(instance, root)
    if (JSON.stringify(spot.localBounds) === JSON.stringify(localBounds)) return
    this.spots.set(spot.id, { ...spot, localBounds }); this.notifySpots()
  }
  /** Wait only for the selected visible target; cancellation stops waiting, not its living program. */
  private prepareNavigationInstance(id: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || this.retired) return Promise.resolve(false)
    return new Promise<boolean>(resolve => {
      let settled = false
      const finish = (ready: boolean) => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', abort); resolve(ready)
      }
      const abort = () => finish(false)
      signal.addEventListener('abort', abort, { once: true })
      // Camera presentation can precede IntersectionObserver delivery. Re-read
      // this target's actual viewport geometry without starting hidden peers.
      void this.syncInstance(id, false, true).then(handle => finish(!signal.aborted && Boolean(handle?.scope.isActive())),
        () => finish(false))
      if (signal.aborted) abort()
    })
  }
  async sync(project: CourseProjectV10, resources: DocumentResources): Promise<void> {
    if (this.reset) await this.reset
    if (this.retired) return
    this.project = project; this.documentResources = resources
    for (const [id, binding] of this.inlineBindings) {
      if (project.instances[binding.ownerId]?.childIds?.includes(id)) continue
      this.inlineBindings.delete(id)
      if (!project.instances[id]) continue
      this.bindProjection(id, this.defaultProjectionRoots.get(id) ?? null)
      this.bindEffectiveTarget(id, this.defaultTargetElements.get(id) ?? null)
    }
    if (this.targetProject !== project) {
      this.targetProject = project
      // Managed realms resolve their own existing target profile on this small
      // invalidation. Explicit author subscriptions keep the full event value.
      this.emit('__runtime.targets.changed', null)
      if (this.eventListeners.get('__runtime.targets')?.size) this.emit('__runtime.targets', this.targetSnapshots('full') as unknown as JsonValue)
    }
    for (const layout of this.layouts.values()) layout.sync()
    this.prepareResources(project, resources)
    if (this.publishedResourceVersion !== this.resourceVersion) {
      this.publishedResourceVersion = this.resourceVersion
      if (this.eventListeners.get('__runtime.resources')?.size) this.emit('__runtime.resources', this.resourceUrls())
    }
    const themeText = this.themeCss()
    const owner = this.roots.values().next().value?.ownerDocument ?? this.targetElements.values().next().value?.ownerDocument
    if (owner) {
      if (!this.themeStyle) { this.themeStyle = owner.createElement('style'); owner.head.append(this.themeStyle) }
      // The outer host already declares its faces. Scope only author theme rules;
      // isolated content documents receive their own faces through themeCss/events.
      if (themeText !== this.themeText || !this.themeStyle.textContent) this.themeStyle.textContent = `[data-component-course-world="${this.themeMarker}"][hidden]{display:none!important}@scope ([data-component-course-world="${this.themeMarker}"]) {${this.courseThemeCss().replace(/:root\b/g, ':scope')}}`
    }
    if (themeText !== this.themeText) { this.themeText = themeText; this.emit('__runtime.theme', themeText) }
    if (!this.audioManager) {
      this.audioManager = new AudioManager(project, id => this.assetUrl(id), this.audioEvents, {
        mode: this.mode === 'capture' ? 'capture' : 'preview', unlockTarget: owner,
        sceneIdForNode: id => this.instanceSurfaceId(id), isPlaybackActive: () => this.playing && !this.retired,
      })
      this.mediaSettings = project.media
      const mediaOptions = { resolveAssetUrl: (id: string) => this.assetUrl(id), audioManager: this.audioManager,
        isPlaying: () => this.playing && !this.retired,
        subscribeAudioChange: (listener: () => void) => this.audioEvents.on('audio:change', listener),
        report: (diagnostic: { code: string; assetId: string; message: string }) => {
          if (diagnostic.code === 'media-resource-missing' && this.isAssetPending?.(diagnostic.assetId)) return
          this.report(diagnostic.message)
        } }
      this.implementations.set('guoling.audio', createAudioRuntimeImplementation(mediaOptions) as ComponentRuntimeImplementation)
      this.implementations.set('guoling.video', createVideoRuntimeImplementation(mediaOptions) as ComponentRuntimeImplementation)
    } else if (this.mediaSettings !== project.media) { this.audioManager.updateProject(project); this.mediaSettings = project.media }
    for (const declaration of project.logic?.courseState ?? []) if (!this.state.has(declaration.key)) this.state.set(declaration.key, structuredClone(declaration.defaultValue))
    const boundIds = new Set([...this.synced, ...this.pendingSync, ...this.roots.keys(), ...this.defaultProjectionRoots.keys(), ...this.defaultTargetElements.keys(), ...this.inlineBindings.keys()])
    for (const id of boundIds) if (!project.instances[id]) {
      this.inlineBindings.delete(id); this.defaultProjectionRoots.delete(id); this.defaultTargetElements.delete(id)
      this.synced.delete(id); this.pendingSync.delete(id); await this.host.dispose(this.runScopeId, id)
      if (this.retired) return
      this.roots.get(id)?.remove(); this.roots.delete(id); this.projectionRoots.delete(id); this.targetElements.delete(id)
      const observed = this.observed.get(id); if (observed) this.visibilityObserver?.unobserve(observed)
      this.observed.delete(id); this.intersections.delete(id); this.activities.delete(id)
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
    this.refreshActivity()
  }
  stateSnapshot(): Record<string, JsonValue> { return Object.fromEntries([...this.state].map(([name, value]) => [name, snapshotValue(value)])) }
  /** Shared by signature preparation and the renderer's actual compiler call. */
  sourceCompilationInput(implementation: Extract<ComponentImplementation, { kind: 'source' }>): ComponentCompilationInput {
    if (!this.project) throw new Error('组件作品尚未准备')
    return this.readCompilationInput(this.project, implementation, this.documentResources)
  }
  /** Prepare local assets before a placement paints its background. */
  prepareResources(project: CourseProjectV10, resources: DocumentResources): void {
    if (this.retired) return
    for (const [id, url] of this.assetUrls) if (!project.assets[id] || !resources.assets[id]) { URL.revokeObjectURL(url); this.assetUrls.delete(id); this.contentAssetUrls.delete(id); this.assetContents.delete(id); this.resourceVersion++ }
    for (const [id, asset] of Object.entries(project.assets)) if (resources.assets[id]) {
      const source = resources.assets[id], mimeType = asset.mimeType ?? 'application/octet-stream'
      const previous = this.assetContents.get(id)
      // Document/Published inputs retain immutable bytes. Navigation can reuse
      // their identity before making the one detached Blob/data-URL snapshot.
      if (previous?.mimeType === mimeType && previous.source === source) continue
      const bytes = Uint8Array.from(source)
      const previousUrl = this.assetUrls.get(id)
      if (previousUrl) URL.revokeObjectURL(previousUrl)
      this.assetContents.set(id, { source, mimeType })
      this.assetUrls.set(id, URL.createObjectURL(new Blob([bytes], { type: mimeType })))
      // A native-only consumer needs a Blob, not an additional data URL. A
      // content realm still receives all authorized assets when it asks below.
      this.contentAssetUrls.delete(id)
      this.resourceVersion++
    }
  }
  /** Same-document content uses the host's installed fonts and only scopes course rules. */
  courseThemeCss(): string { return this.project ? courseThemeStyleText({ designTokens: this.project.designTokens ?? { fonts: [], colors: [] }, theme: this.project.theme }, id => this.contentAssetUrl(id)) : '' }
  themeCss(): string {
    return [this.fontFaceCss, this.courseThemeCss()].filter(Boolean).join('\n')
  }
  private referencedAssetUrl(id: string): string | undefined {
    if (this.retired) return undefined
    const url = this.resolveAssetUrl?.(id)
    if (url && this.referencedAssetUrls.get(id) !== url) { this.referencedAssetUrls.set(id, url); this.resourceVersion++ }
    return url
  }
  assetUrl(id: string): string | undefined { return this.assetUrls.get(id) ?? this.referencedAssetUrl(id) }
  contentAssetUrl(id: string): string | undefined {
    const existing = this.contentAssetUrls.get(id)
    if (existing) return existing
    const asset = this.assetContents.get(id)
    if (!asset) return this.referencedAssetUrl(id)
    // Opaque component realms cannot dereference their parent's Blob storage key.
    let binary = ''
    for (let at = 0; at < asset.source.length; at += 8192) binary += String.fromCharCode(...asset.source.subarray(at, at + 8192))
    const url = `data:${asset.mimeType};base64,${btoa(binary)}`
    this.contentAssetUrls.set(id, url)
    return url
  }
  resourceUrls(): Record<string, string> {
    // Keep the existing synchronous dynamic-asset contract. Until the carrier
    // supplies stable authorized URLs, a realm conservatively gets the full
    // available directory; native consumers no longer pay this representation.
    for (const id of this.assetContents.keys()) this.contentAssetUrl(id)
    return Object.fromEntries([...this.referencedAssetUrls, ...this.contentAssetUrls].filter(([id]) => this.project?.assets[id]))
  }
  targetElement(id: string): HTMLElement | undefined { return this.targetElements.get(id) ?? this.projectionRoots.get(id)?.parentElement ?? undefined }
  contentElement(id: string): HTMLElement | undefined { return this.projectionRoots.get(id) }
  getState(name: string): JsonValue | undefined { return snapshotValue(this.state.get(name)) }
  setState(name: string, value: JsonValue): void {
    if ((value === null || typeof value !== 'object') && Object.is(this.state.get(name), value)) return
    const stored = snapshotValue(value)
    this.state.set(name, stored)
    for (const listener of this.stateListeners.get(name) ?? []) listener(snapshotValue(stored))
    this.emit('__runtime.state', { name, value: stored })
    // Runtime state is delivered to its exact subscribers and interaction rules
    // above. Only navigation guards consume it in the navigation owner. Sending
    // every animation/measurement write through changed() re-enters every Flow
    // reading subscriber, which can itself publish another measured state.
    if (this.project?.logic?.navigationGuards.some(guard => guard.conditions.some(condition => condition.key === name)))
      this.notifyNavigationCapabilities?.()
  }
  /** Explicit editor reset retires this scene's programs; ordinary navigation keeps them alive. */
  resetSurfacePrograms = (surfaceId: string): Promise<void> => {
    if (this.retired) return this.disposal ?? Promise.resolve()
    if (this.reset) return this.reset.then(() => this.resetSurfacePrograms(surfaceId))
    const ids = Object.values(this.project?.instances ?? {}).filter(instance => {
      const definition = this.project?.definitions[instance.definitionId]
      return definition && this.project && isWithinContainer(this.project, instance.id, surfaceId)
        && usesContentRealm(instance.implementationOverride ?? definition.implementation)
    }).map(instance => instance.id)
    this.reset = (async () => {
      for (const id of ids) { this.synced.delete(id); this.pendingSync.delete(id) }
      await Promise.all(ids.map(id => this.host.dispose(this.runScopeId, id)))
      if (this.retired) return
      await Promise.allSettled(ids.map(id => this.syncInstance(id, true)))
      this.refreshActivity()
    })().finally(() => { this.reset = undefined })
    return this.reset
  }
  /** Explicitly restart component generations; a pause keeps the existing generations. */
  resetPlayback = (playing = false, options: { preserveNavigation?: boolean } = {}): Promise<void> => {
    if (this.retired) return this.disposal ?? Promise.resolve()
    if (this.reset) {
      const requestEpoch = this.playbackEpoch
      return this.reset.then(() => this.resetPlayback(requestEpoch === this.playbackEpoch ? playing : this.playing, options))
    }
    this.changePlaying(false, !options.preserveNavigation); this.audioManager?.stop({ kind: 'all' }); this.interactions.reset()
    const resetEpoch = this.playbackEpoch
    this.reset = (async () => {
      await this.host.disposeScope(this.runScopeId)
      if (this.retired || !this.project) return
      this.synced.clear(); this.pendingSync.clear()
      this.spots.clear(); this.spotPreviews.clear(); this.notifySpots(); this.state.clear()
      for (const declaration of this.project.logic?.courseState ?? []) this.setState(declaration.key, declaration.defaultValue)
      if (resetEpoch === this.playbackEpoch) this.playing = playing
      if (this.playing) { this.resumeMedia?.(); this.resumeMedia = undefined }
      await Promise.allSettled(Object.keys(this.project.instances).map(id => this.syncInstance(id, true)))
      if (this.playing || this.mode !== 'edit') this.interactions.applyAllVisibility()
      else for (const [id, element] of this.targetElements) {
        const instance = this.project.instances[id]
        if (instance) element.hidden = !isComponentVisibleAtSurface(instance, this.interactions.currentSurfaceId())
      }
      this.refreshActivity()
    })().finally(() => { this.reset = undefined })
    return this.reset
  }
  audio(): AudioManager | undefined { return this.audioManager }
  isPlaying(): boolean { return this.playing }
  dispatchPresenterCommand(command: 'next' | 'previous'): Promise<boolean> {
    return this.interactions.dispatchPresenterCommand(command)
  }
  setPlaying = (active: boolean): void => {
    this.changePlaying(active, true)
  }
  private changePlaying(active: boolean, cancelNavigation: boolean): void {
    if (this.retired || this.mode === 'capture') return
    if (!active) {
      this.playbackEpoch++
      if (cancelNavigation) this.cancelNavigation?.()
    }
    if (active === this.playing) return
    this.playing = active
    if (active) {
      this.resumeMedia?.(); this.resumeMedia = undefined; this.interactions.applyAllVisibility(); this.emit('__runtime.playing', true)
      void Promise.allSettled(Object.keys(this.project?.instances ?? {}).map(id => this.syncInstance(id)))
    }
    else {
      this.interactions.pause(); this.resumeMedia = this.audioManager?.pauseActive()
      this.emit('__runtime.playing', false)
      if (this.mode === 'edit') this.interactions.applyAllVisibility()
    }
    this.refreshActivity()
  }
  previewMotion(action: import('../../shared/interactionTypes').NodeMotionAction, signal: AbortSignal): Promise<boolean> {
    return this.interactions.motion(action, { signal, ruleId: 'editor-preview', stepId: 'editor-preview', restartFromBeginning: true }, true)
  }
  targetSnapshots(): Array<{ reference: ComponentTarget; instanceId: string; value: JsonValue }>
  targetSnapshots(profile: 'full'): Array<{ reference: ComponentTarget; instanceId: string; value: JsonValue }>
  targetSnapshots(profile: RuntimeTargetProfile): Array<{ reference: ComponentTarget; instanceId: string; value?: JsonValue }>
  targetSnapshots(profile: RuntimeTargetProfile = 'full'): Array<{ reference: ComponentTarget; instanceId: string; value?: JsonValue }> {
    if (!this.project) return []
    const references: ComponentTarget[] = [{ kind: 'project' }, ...componentContainers(this.project).map(surface => ({ kind: 'surface' as const, surfaceId: surface.id })),
      ...Object.keys(this.project.instances).map(instanceId => ({ kind: 'instance' as const, instanceId })),
      ...Object.values(this.project.instances).flatMap(instance=>allDocumentTextSlots(instance.data).flatMap(slot=>[...documentTextRanges(slot.content).keys()].map(rangeId=>({kind:'text-range' as const,instanceId:instance.id,dataPath:slot.path,rangeId}))))]
    if (profile === 'references') return references.map(reference => ({ reference,
      instanceId: reference.kind === 'instance'||reference.kind==='text-range' ? reference.instanceId : reference.kind === 'surface' ? reference.surfaceId : this.project!.id }))
    return references.flatMap(reference => { const target = this.target(reference); return target ? [{ reference, instanceId: target.instanceId, value: target.read() }] : [] })
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.retired = true; this.playing = false
    return this.disposal = this.disposeWorld()
  }
  private async disposeWorld(): Promise<void> {
    this.project = undefined; this.documentResources = undefined
    this.stopNavigation?.(); this.disconnectNavigationRuntime?.(); this.spots.clear(); this.spotPreviews.clear(); this.notifySpots(); this.spotListeners.clear()
    this.interactions.dispose(); this.audioManager?.destroy(); this.audioEvents.dispose(); this.resumeMedia = undefined
    await this.host.disposeScope(this.runScopeId)
    this.layouts.clear()
    this.visibilityObserver?.disconnect(); this.visibilityObserver = undefined
    this.observed.clear(); this.intersections.clear(); this.activities.clear()
    for (const root of this.roots.values()) root.remove()
    this.roots.clear(); this.projectionRoots.clear(); this.targetElements.clear(); this.defaultProjectionRoots.clear(); this.defaultTargetElements.clear(); this.inlineBindings.clear(); this.synced.clear(); this.pendingSync.clear(); this.eventListeners.clear(); this.stateListeners.clear(); this.state.clear()
    for (const url of this.assetUrls.values()) URL.revokeObjectURL(url)
    this.assetUrls.clear(); this.contentAssetUrls.clear(); this.referencedAssetUrls.clear(); this.assetContents.clear(); this.themeStyle?.remove(); this.themeStyle = undefined
    this.parking?.remove(); this.parking = undefined
  }
}
