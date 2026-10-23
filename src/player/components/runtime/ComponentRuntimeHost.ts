import { hasWebContentData } from '../../../components/web/sourcePreparation'
import { ownedDocumentExecutionSource } from '../../../components/web/ownedDocumentIdentity'
import type {
  ComponentDefinition, ComponentImplementation, ComponentInstance, ComponentRuntimeImplementation,
  ComponentRuntimeScope, ComponentRuntimeTarget, JsonValue, MountedComponent,
  ComponentRuntimeContext, ComponentLayoutPort,
} from '../../../shared/contracts/component-platform'
import type { WebModuleGraph } from '../../../components/web/moduleGraph'

export type ComponentRuntimePorts = Pick<ComponentRuntimeScope, 'target' | 'events' | 'state' | 'measure'>

/** An observation of the existing runtime slot, never author metadata. */
export interface ComponentRuntimeCapabilities {
  status: 'unprepared' | 'preparing' | 'ready' | 'failed'
  generation?: number
  document?: 'web'
  html?: string
}

export interface ComponentRuntimeNavigationPort {
  read(instanceId: string): ComponentRuntimeCapabilities
  /** The navigation owner makes its target visible before asking for readiness. */
  prepare(instanceId: string, signal: AbortSignal): Promise<boolean>
}

/** A transient loaded module, not a second author definition or source store. */
export interface PreparedComponentRuntime {
  implementation: ComponentRuntimeImplementation
  /** Web's prepared executable closure, separate from its complete author modules. */
  webModuleGraph?: WebModuleGraph
  /** Observed after the real Source import; never inferred from professional author identity. */
  isWebDocument?(): boolean
  /** Exact loaded code/CSS/modules; preparation inputs remain independently tracked. */
  artifactIdentity?: string
  release?(): void | Promise<void>
}

export interface ComponentRuntimeHostOptions {
  /** Builtins resolve directly; source modules use the supplied L04 content-realm loader. */
  resolveImplementation(
    implementation: ComponentImplementation, definition: ComponentDefinition, signal: AbortSignal, instance: ComponentInstance,
  ): ComponentRuntimeImplementation | PreparedComponentRuntime
    | Promise<ComponentRuntimeImplementation | PreparedComponentRuntime>
  ports(runScopeId: string, instanceId: string): ComponentRuntimePorts
  authoring?(runScopeId: string, instanceId: string, generation: number): ComponentRuntimeContext['authoring']
  layout?(runScopeId: string, instance: ComponentInstance, generation: number): ComponentLayoutPort | undefined
  resources?: ComponentRuntimeContext['resources']
  inline?(scope: ComponentRuntimeScope): ComponentRuntimeContext['inline']
  media?(scope: ComponentRuntimeScope): ComponentRuntimeContext['media']
  interactions?(context: ComponentRuntimeContext): ComponentRuntimeContext['interactions']
  /** Dormant instances stay alive, while the World owns whether they may affect the current scene. */
  canInteract?(runScopeId: string, instanceId: string): boolean
  /** A carrier may materialize compact delivery data through its existing reader. */
  documentHtml?(instance: ComponentInstance): string | undefined
  capabilitiesChanged?(runScopeId: string, instanceId: string): void
  reportError?(error: unknown, phase: 'prepare' | 'update' | 'dispose', runScopeId: string, instanceId: string): void
}

export interface ComponentRuntimeRequest {
  runScopeId: string
  instance: ComponentInstance
  definition: ComponentDefinition
  /** Editor/Player container. Each generation owns a child; the outer author frame stays untouched. */
  root?: HTMLElement
  /** Content-environment changes retire only the affected source generation. */
  environmentSignature?: string
  /** Complete compiler input, including stored files not reached by the loaded module. */
  preparationSignature?: string
  /** Inactive surface behaviors keep their generation without reconnecting absent visuals. */
  canProject?(): boolean
}

export interface ComponentRuntimeHandle {
  readonly scope: ComponentRuntimeScope
  readonly root?: HTMLElement
}

interface RuntimeRecord extends ComponentRuntimeHandle {
  mount?: Promise<MountedComponent | null>
  mounted?: MountedComponent
  request: ComponentRuntimeRequest
  signature: string
  generationSignature: string
  webDocument?: boolean
  updates: Promise<void>
  activityRunning: boolean
  appliedActivityRunning: boolean
  cancel(): void
  removeCleanup(dispose: () => void): void
  release(): Promise<void>
}

interface Preparation {
  request: ComponentRuntimeRequest
  signature: string
  controller: AbortController
  record?: RuntimeRecord
  promise: Promise<ComponentRuntimeHandle | null>
}

interface RuntimeSlot {
  active?: RuntimeRecord
  preparing?: Preparation
  failed?: boolean
  retiring: Promise<void>
  signatureInput?: { metadata: string; source?: string; html?: string; signature: string }
  queuedRequest?: ComponentRuntimeRequest
}

function webSource(request: ComponentRuntimeRequest, preparing = true, sourceWeb = false): unknown {
  const implementation = request.instance.implementationOverride ?? request.definition.implementation
  const data = request.instance.data
  // HTML and local modules jointly own their iframe generation. Source replacement
  // retires old globals, timers and pending module evaluation through the existing realm lifecycle.
  return hasWebContentData(data) && (implementation.kind === 'source' ? preparing || sourceWeb : ['guoling.web', 'guoling.html-program'].includes(implementation.key))
      ? preparing || implementation.kind === 'source' ? [ownedDocumentExecutionSource(data.html), data.modules, data.moduleGraph]
        : [ownedDocumentExecutionSource(data.html), data.moduleGraph] : undefined
}

function implementationSignature(request: ComponentRuntimeRequest): string {
  const implementation = request.instance.implementationOverride ?? request.definition.implementation
  return JSON.stringify([
    request.definition.id, request.definition.version,
    implementation, webSource(request), request.environmentSignature, request.preparationSignature,
  ])
}

function environmentIdentity(request: ComponentRuntimeRequest): string {
  const implementation = request.instance.implementationOverride ?? request.definition.implementation
  return JSON.stringify([
    request.definition.id, request.definition.version, request.definition.role,
    implementation.kind, implementation.kind === 'builtin' ? implementation.key
      : Object.entries(implementation.resourceBindings ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    request.environmentSignature,
  ])
}

function generationSignature(request: ComponentRuntimeRequest, prepared: PreparedComponentRuntime, sourceWeb = false): string {
  return prepared.artifactIdentity === undefined ? implementationSignature(request)
    : JSON.stringify([environmentIdentity(request), prepared.artifactIdentity, webSource(request, false, sourceWeb)])
}

function contentSignature(instance: ComponentInstance): string {
  // Implementation input is consumed by preparation; unchanged loaded code does not reset author data.
  const { frame: _frame, implementationOverride: _implementation, ...content } = instance
  return JSON.stringify(content)
}

function sameContentFields(before: ComponentInstance, after: ComponentInstance): boolean {
  const keys = Object.keys(before).filter(key => key !== 'frame' && key !== 'implementationOverride') as Array<keyof ComponentInstance>
  return keys.length === Object.keys(after).filter(key => key !== 'frame' && key !== 'implementationOverride').length
    && keys.every(key => Object.is(before[key], after[key]))
}

/** Keep large source strings out of repeated signatures, while still observing
 * in-place edits to the small declaration maps. Module graphs retain their
 * existing complete signature because their authored structure can vary. */
function requestSignature(request: ComponentRuntimeRequest, slot: RuntimeSlot): string {
  const implementation = request.instance.implementationOverride ?? request.definition.implementation
  const data = request.instance.data
  if (hasWebContentData(data) && (data.modules !== undefined || data.moduleGraph !== undefined)) return implementationSignature(request)
  const source = implementation.kind === 'source' ? implementation.source : undefined
  const html = hasWebContentData(data) ? data.html : undefined
  const metadata = JSON.stringify([request.definition.id, request.definition.version,
    implementation.kind === 'source' ? { ...implementation, source: undefined } : implementation,
    request.environmentSignature, request.preparationSignature])
  const previous = slot.signatureInput
  if (previous?.metadata === metadata && previous.source === source && previous.html === html) return previous.signature
  const signature = implementationSignature(request)
  slot.signatureInput = { metadata, source, html, signature }
  return signature
}

/** Runtime state only; DocumentSession remains the sole author-data writer. */
export class ComponentRuntimeHost {
  private readonly scopes = new Map<string, Map<string, RuntimeSlot>>()
  private generation = 0

  constructor(private readonly options: ComponentRuntimeHostOptions) {}

  capabilities(runScopeId: string, instanceId: string): ComponentRuntimeCapabilities {
    const slot = this.scopes.get(runScopeId)?.get(instanceId)
    const active = slot?.active
    // Preparation may retain the current executable generation. Its capability
    // remains factual until that generation is actually retired.
    if (active?.scope.isActive()) return { status: slot?.preparing ? 'preparing' : 'ready', generation: active.scope.generation,
      ...(active.webDocument ? { document: 'web', html: this.documentHtml(active.request.instance) } : {}) }
    if (slot?.preparing) return { status: 'preparing', generation: slot.preparing.record?.scope.generation,
      html: this.documentHtml(slot.preparing.request.instance) }
    return { status: slot?.failed ? 'failed' : 'unprepared' }
  }

  private documentHtml(instance: ComponentInstance): string | undefined {
    return this.options.documentHtml ? this.options.documentHtml(instance) : hasWebContentData(instance.data) ? instance.data.html : undefined
  }

  private notifyCapabilities(request: { runScopeId: string; instance: Pick<ComponentInstance, 'id'> }): void {
    try { this.options.capabilitiesChanged?.(request.runScopeId, request.instance.id) }
    catch { /* A view notification cannot change runtime ownership or cleanup. */ }
  }

  create(request: ComponentRuntimeRequest): Promise<ComponentRuntimeHandle | null> {
    return this.sync(request)
  }

  sync(request: ComponentRuntimeRequest): Promise<ComponentRuntimeHandle | null> {
    if (request.instance.definitionId !== request.definition.id) {
      return Promise.reject(new Error(`组件实例与定义不匹配：${request.instance.id}`))
    }
    let instances = this.scopes.get(request.runScopeId)
    if (!instances) {
      instances = new Map()
      this.scopes.set(request.runScopeId, instances)
    }
    let slot = instances.get(request.instance.id)
    if (!slot) {
      slot = { retiring: Promise.resolve() }
      instances.set(request.instance.id, slot)
    }
    const signature = requestSignature(request, slot)
    const previous = slot.active
    // Known permissions/bindings/root changes revoke immediately, even before preparation settles.
    if (previous && (environmentIdentity(previous.request) !== environmentIdentity(request) || previous.request.root !== request.root)) {
      slot.active = undefined; previous.cancel()
      slot.retiring = Promise.all([slot.retiring, previous.release()]).then(() => {})
    }
    if (slot.preparing?.signature === signature && slot.preparing.request.root === request.root) {
      slot.preparing.request = request
      return slot.preparing.promise
    }
    const superseded = slot.preparing
    superseded?.controller.abort()
    if (superseded?.record) {
      slot.retiring = Promise.all([slot.retiring, superseded.record.release()]).then(() => {})
    }
    slot.preparing = undefined
    if (slot.active?.signature === signature && slot.active.request.root === request.root) {
      const active = slot.active
      // Exact duplicate observations cannot invoke update in the original
      // content comparison either. Share their wait instead of adding another
      // link to the active queue; distinct author updates remain ordered.
      if ((slot.queuedRequest ?? active.request).instance === request.instance) return active.updates.then(() => active.scope.isActive() ? active : null)
      slot.queuedRequest = request
      // A failed update is reported to its caller without poisoning subsequent corrected data.
      active.updates = active.updates.catch(() => {}).then(() => this.update(active, request)).finally(() => {
        if (slot!.queuedRequest === request) slot!.queuedRequest = undefined
      })
      return active.updates.then(() => active.scope.isActive() ? active : null)
    }
    const preparation: Preparation = {
      request, signature, controller: new AbortController(), promise: Promise.resolve(null),
    }
    slot.queuedRequest = undefined
    slot.failed = false
    slot.preparing = preparation
    preparation.promise = this.prepare(slot, preparation)
    this.notifyCapabilities(request)
    return preparation.promise
  }

  async dispose(runScopeId: string, instanceId: string): Promise<void> {
    const instances = this.scopes.get(runScopeId)
    const slot = instances?.get(instanceId)
    if (!slot) return
    const pending = slot.preparing
    pending?.controller.abort()
    slot.preparing = undefined
    const active = slot.active
    slot.active = undefined
    slot.failed = false
    active?.cancel()
    this.notifyCapabilities({ runScopeId, instance: { id: instanceId } })
    // A resolver still in flight releases its returned module when it observes cancellation.
    slot.retiring = Promise.all([slot.retiring, active?.release(), pending?.record?.release()]).then(() => {})
    await slot.retiring
    // A recreate arriving during disposal uses this same retirement barrier.
    if (!slot.active && !slot.preparing && instances!.get(instanceId) === slot) {
      instances!.delete(instanceId)
      if (!instances!.size && this.scopes.get(runScopeId) === instances) this.scopes.delete(runScopeId)
    }
  }

  async disposeScope(runScopeId: string): Promise<void> {
    const ids = [...(this.scopes.get(runScopeId)?.keys() ?? [])]
    await Promise.all(ids.map(id => this.dispose(runScopeId, id)))
  }

  /** Rebind DOM target consumers after an editor replaces projection ancestors. */
  refreshTargets(runScopeId: string, instanceId: string, canProject?: () => boolean): Promise<void> {
    const record = this.scopes.get(runScopeId)?.get(instanceId)?.active
    if (!record) return Promise.resolve()
    record.updates = record.updates.catch(() => {}).then(async () => {
      if (record.scope.isActive() && (canProject?.() ?? true)) await record.mounted?.update(record.request.instance)
    })
    return record.updates
  }

  private async prepare(slot: RuntimeSlot, pending: Preparation): Promise<ComponentRuntimeHandle | null> {
    const { controller } = pending
    let record: RuntimeRecord | undefined
    let releasePrepared: (() => Promise<void>) | undefined
    try {
      const request = pending.request
      const implementation = request.instance.implementationOverride ?? request.definition.implementation
      const loaded = await this.options.resolveImplementation(
        implementation,
        request.definition, controller.signal, request.instance,
      )
      const prepared: PreparedComponentRuntime = 'mount' in loaded ? { implementation: loaded } : loaded
      let released: Promise<void> | undefined
      releasePrepared = () => released ??= Promise.resolve().then(() => prepared.release?.()).catch(error => {
        this.report(error, 'dispose', request)
      })
      if (controller.signal.aborted) {
        await releasePrepared()
        return null
      }
      const previous = slot.active
      // Same-source data updates can arrive during preparation. Keep their
      // latest author values and add only the independently prepared graph.
      const runtimeRequest = (request: ComponentRuntimeRequest): ComponentRuntimeRequest => prepared.webModuleGraph
        ? { ...request, instance: { ...request.instance,
          data: { ...request.instance.data as object, moduleGraph: prepared.webModuleGraph } as unknown as JsonValue } } : request
      const readySignature = generationSignature(runtimeRequest(pending.request), prepared, previous?.webDocument ?? prepared.isWebDocument?.())
      if (previous?.scope.isActive() && previous.generationSignature === readySignature && previous.request.root === pending.request.root) {
        // Detached preparation acquired no mounted lease. Release it and retain the active generation.
        await releasePrepared()
        if (controller.signal.aborted || slot.preparing !== pending || slot.active !== previous) return null
        previous.signature = pending.signature
        slot.preparing = undefined
        // Hidden data remains pending: do not advance record.request until it can be projected.
        if (pending.request.canProject?.() === false) { this.notifyCapabilities(pending.request); return previous }
        previous.updates = previous.updates.catch(() => {}).then(() => {
          const request = pending.request
          return this.update(previous, request, runtimeRequest(request).instance)
        })
        await previous.updates
        this.notifyCapabilities(pending.request)
        return previous.scope.isActive() ? previous : null
      }

      // A genuinely changed loaded module stops old host calls before any new lifecycle starts.
      if (previous) {
        slot.active = undefined
        previous.cancel()
        this.notifyCapabilities(pending.request)
        slot.retiring = Promise.all([slot.retiring, previous.release()]).then(() => {})
      }
      await slot.retiring
      if (controller.signal.aborted || slot.preparing !== pending) {
        await releasePrepared()
        return null
      }
      if (pending.request.canProject?.() === false) {
        if (slot.preparing === pending) slot.preparing = undefined
        await releasePrepared()
        this.notifyCapabilities(pending.request)
        return null
      }

      const mountRequest = pending.request, readyRequest = runtimeRequest(mountRequest)
      // Record the author input actually supplied to mount. Later same-source
      // input remains distinguishable after an asynchronous mount completes.
      record = this.record(mountRequest, pending.signature, readySignature, controller, releasePrepared)
      pending.record = record
      if (record.root) pending.request.root!.append(record.root)
      const authoring = this.options.authoring?.(record.scope.runScopeId, record.scope.instanceId, record.scope.generation)
      const resources = this.options.resources, bindings = implementation.kind === 'source' ? implementation.resourceBindings : undefined
      const layout = this.options.layout?.(record.scope.runScopeId, record.request.instance, record.scope.generation)
      if (layout && record.root) {
        const root = record.root, scope = record.scope
        const projectLayout = (input: ReturnType<typeof layout.read>) => {
          if (scope.isActive()) root.style.height = input.mode === 'flow-content' ? 'var(--component-flow-height, auto)' : '100%'
        }
        projectLayout(layout.read())
        scope.cleanup(layout.subscribe(projectLayout))
      }
      const baseContext: ComponentRuntimeContext = { instance: readyRequest.instance, scope: record.scope, root: record.root,
        resources: resources && bindings ? { url: name => resources.url(Object.hasOwn(bindings, name) ? bindings[name] : name) } : resources,
        media: this.options.media?.(record.scope),
        inline: this.options.inline?.(record.scope),
        layout: layout && {
          read: () => layout.read(),
          subscribe: listener => {
            if (!record!.scope.isActive()) return () => {}
            let listening = true
            const off = layout.subscribe(value => { if (record!.scope.isActive()) listener(value) })
            const dispose = () => { if (listening) { listening = false; off() } }
            record!.scope.cleanup(dispose)
            return dispose
          },
          reportSize: size => { if (record!.scope.isActive()) layout.reportSize(size) },
        },
        authoring: authoring && { register: (spot: Parameters<typeof authoring.register>[0], callbacks?: Parameters<typeof authoring.register>[1]) => {
          if (!record!.scope.isActive()) return () => {}
          const off = authoring.register(spot, callbacks)
          let registered = true
          const dispose = () => { if (!registered) return; registered = false; record!.removeCleanup(dispose); off() }
          record!.scope.cleanup(dispose); return dispose
        } } }
      const context: ComponentRuntimeContext = { ...baseContext, interactions: this.options.interactions?.(baseContext) }
      record.mount = Promise.resolve().then(() => controller.signal.aborted || pending.request.canProject?.() === false ? null : prepared.implementation.mount(context))
      record.mounted = await record.mount ?? undefined
      if (controller.signal.aborted || slot.preparing !== pending) {
        await record.release()
        return null
      }
      if (!record.mounted && pending.request.canProject?.() === false) {
        slot.preparing = undefined
        await record.release()
        this.notifyCapabilities(pending.request)
        return null
      }
      if (!record.mounted || typeof record.mounted.update !== 'function' || typeof record.mounted.dispose !== 'function') {
        throw new Error('组件 mount() 必须返回含 update() 和 dispose() 的生命周期对象')
      }
      // The Source chooses its document only after its one real import. Keep that
      // observation with this generation so ordinary Source data remains incremental.
      record.webDocument = prepared.isWebDocument?.() ?? prepared.implementation.document === 'web'
      record.generationSignature = generationSignature(readyRequest, prepared, record.webDocument)
      // Activity can change while mount is awaiting. Apply its latest value to
      // this same instance before accepting subsequent author-data updates.
      record.updates = record.updates.catch(() => {}).then(() => this.applyActivity(record!))
      await record.updates
      if (controller.signal.aborted || slot.preparing !== pending) {
        await record.release()
        return null
      }
      // Same-source changes during asynchronous mounting reuse this mounted generation.
      while (record.request !== pending.request && pending.request.canProject?.() !== false) {
        const request = pending.request
        record.updates = record.updates.catch(() => {}).then(() => this.update(record!, request, runtimeRequest(request).instance))
        await record.updates
        if (controller.signal.aborted || slot.preparing !== pending) {
          await record.release()
          return null
        }
      }
      slot.active = record
      slot.preparing = undefined
      this.notifyCapabilities(pending.request)
      return record
    } catch (error) {
      const cancelled = controller.signal.aborted
      controller.abort()
      if (record) await record.release()
      else await releasePrepared?.()
      if (slot.preparing === pending) {
        slot.preparing = undefined
        slot.failed = !cancelled
        this.notifyCapabilities(pending.request)
      }
      if (cancelled) return null
      this.report(error, 'prepare', pending.request)
      throw error
    }
  }

  private async applyActivity(record: RuntimeRecord): Promise<void> {
    while (record.scope.isActive() && record.mounted && record.activityRunning !== record.appliedActivityRunning) {
      const running = record.activityRunning
      try {
        const hook = running ? record.mounted.resume : record.mounted.suspend
        await hook?.call(record.mounted)
      } catch (error) {
        this.report(error, 'update', record.request)
        return
      }
      if (!record.scope.isActive()) return
      record.appliedActivityRunning = running
      // An asynchronous hook may have outlasted another visibility change.
      // Converge on the latest state without remounting or losing program state.
    }
  }

  private async update(record: RuntimeRecord, request: ComponentRuntimeRequest, preparedInstance = request.instance): Promise<void> {
    if (!record.scope.isActive() || !record.mounted || request.canProject?.() === false) return
    try {
      if (!sameContentFields(record.request.instance, request.instance)
        && contentSignature(record.request.instance) !== contentSignature(request.instance)) {
        await record.mounted.update(preparedInstance)
      }
      if (!record.scope.isActive()) return
      if (record.request.instance.frame !== request.instance.frame
        && JSON.stringify(record.request.instance.frame) !== JSON.stringify(request.instance.frame)) {
        record.mounted.updatePlacement?.(request.instance.frame)
      }
      const oldHtml = record.webDocument && hasWebContentData(record.request.instance.data) ? record.request.instance.data.html : undefined
      record.request = request
      if (record.webDocument && hasWebContentData(request.instance.data) && oldHtml !== request.instance.data.html) this.notifyCapabilities(request)
    } catch (error) {
      this.report(error, 'update', request)
      throw error
    }
  }

  private record(
    request: ComponentRuntimeRequest, signature: string, generationSignature: string, controller: AbortController,
    releaseModule: () => Promise<void>,
  ): RuntimeRecord {
    const ports = this.options.ports(request.runScopeId, request.instance.id)
    const cleanups = new Set<() => void>()
    let cancelled = false
    let release: Promise<void> | undefined
    const alive = () => !controller.signal.aborted
    const canAct = () => alive() && this.options.canInteract?.(request.runScopeId, request.instance.id) !== false
    const disposeCleanup = (dispose: () => void): void => {
      try { dispose() } catch (error) { this.report(error, 'dispose', request) }
    }
    const cleanup = (dispose: () => void): void => {
      if (controller.signal.aborted) disposeCleanup(dispose)
      else cleanups.add(dispose)
    }
    const cancel = (): void => {
      if (cancelled) return
      cancelled = true
      controller.abort()
      for (const dispose of [...cleanups]) disposeCleanup(dispose)
      cleanups.clear()
    }
    controller.signal.addEventListener('abort', cancel, { once: true })
    const subscribe = <Value>(
      register: (listener: (value: Value) => void) => () => void, listener: (value: Value) => void,
    ): (() => void) => {
      if (!alive()) return () => {}
      const off = register(value => { if (alive()) listener(value) })
      let listening = true
      const dispose = () => {
        if (!listening) return
        listening = false
        cleanups.delete(dispose)
        off()
      }
      cleanup(dispose)
      return dispose
    }
    const scope: ComponentRuntimeScope = {
      runScopeId: request.runScopeId,
      instanceId: request.instance.id,
      generation: ++this.generation,
      signal: controller.signal,
      isActive: alive,
      cleanup,
      ...(ports.measure ? { measure: async (references: Parameters<NonNullable<ComponentRuntimeScope['measure']>>[0]) => {
        if (!alive()) return null
        const sample = await ports.measure!(references)
        return alive() ? sample : null
      } } : {}),
      target: reference => {
        if (!alive()) return null
        const target = ports.target(reference)
        if (!target) return null
        const scoped: ComponentRuntimeTarget = {
          instanceId: target.instanceId,
          get element() { return alive() ? target.element : undefined },
          get elements() { return alive() ? target.elements : undefined },
          read: () => alive() ? target.read() : null,
          emit: (name, value) => { if (canAct()) target.emit(name, value) },
          ...(target.motion ? { motion: { replace: (channel: string, program: import('../../../shared/contracts/component-platform/motion').ComponentMotionProgram) => {
            if (!canAct()) return { finished: Promise.resolve({ status: 'cancelled' as const }), cancel() {} }
            const task = target.motion!.replace(`source:${scope.instanceId}:${scope.generation}:${channel}`, program)
            cleanup(task.cancel)
            void task.finished.finally(() => { cleanups.delete(task.cancel) })
            return task
          } } } : {}),
          ...(target.presentation ? { presentation: {
            feedback: (text?: string) => {
              if (!canAct()) return { setText: () => Promise.resolve(false), dispose() {} }
              const handle = target.presentation!.feedback(text); cleanup(handle.dispose)
              return { setText: (value: string) => canAct() ? handle.setText(value) : Promise.resolve(false), dispose: handle.dispose }
            },
            visibility: (visible?: boolean) => {
              if (!canAct()) return { setVisible: () => Promise.resolve(false), dispose() {} }
              const handle = target.presentation!.visibility(visible); cleanup(handle.dispose)
              return { setVisible: (value: boolean) => canAct() ? handle.setVisible(value) : Promise.resolve(false), dispose: handle.dispose }
            },
          } } : {}),
        }
        return scoped
      },
      events: {
        emit: (name, value) => { if (canAct()) ports.events.emit(name, value) },
        subscribe: (name, listener) => subscribe<JsonValue>(next => ports.events.subscribe(name, next), listener),
      },
      state: {
        get: name => alive() ? ports.state.get(name) : undefined,
        set: (name, value) => { if (canAct()) ports.state.set(name, value) },
        subscribe: (name, listener) => subscribe<JsonValue | undefined>(next => ports.state.subscribe(name, next), listener),
      },
    }
    const root = request.root?.ownerDocument.createElement('div')
    if (root) {
      root.dataset.componentInstanceId = request.instance.id
      root.style.width = '100%'
      root.style.height = '100%'
    }
    const record: RuntimeRecord = {
      scope, root, request, signature, generationSignature, updates: Promise.resolve(), cancel, removeCleanup: dispose => { cleanups.delete(dispose) },
      activityRunning: true, appliedActivityRunning: true,
      release: () => release ??= (async () => {
        cancel()
        try {
          const mounted = await record.mount?.catch(() => null)
          // Cancellation can remove the timer an author's update/hook awaits.
          // Observe its rejection without making retirement wait for that work.
          void record.updates.catch(() => {})
          await mounted?.dispose()
        }
        catch (error) { this.report(error, 'dispose', request) }
        finally { root?.remove(); await releaseModule() }
      })(),
    }
    scope.events.subscribe('__runtime.activity', value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.active !== 'boolean' || typeof value.visible !== 'boolean' || typeof value.playing !== 'boolean') return
      record.activityRunning = value.active && value.visible && value.playing
      if (record.mounted) record.updates = record.updates.catch(() => {}).then(() => this.applyActivity(record))
    })
    return record
  }

  private report(error: unknown, phase: 'prepare' | 'update' | 'dispose', request: ComponentRuntimeRequest): void {
    try { this.options.reportError?.(error, phase, request.runScopeId, request.instance.id) }
    catch { /* Diagnostics cannot prevent cancellation and cleanup. */ }
  }
}
