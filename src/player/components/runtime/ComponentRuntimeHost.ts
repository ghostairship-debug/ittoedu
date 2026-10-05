import type {
  ComponentDefinition, ComponentImplementation, ComponentInstance, ComponentRuntimeImplementation,
  ComponentRuntimeScope, ComponentRuntimeTarget, JsonValue, MountedComponent,
  ComponentRuntimeContext, ComponentLayoutPort,
} from '../../../shared/contracts/component-platform'

export type ComponentRuntimePorts = Pick<ComponentRuntimeScope, 'target' | 'events' | 'state'>

/** A transient loaded module, not a second author definition or source store. */
export interface PreparedComponentRuntime {
  implementation: ComponentRuntimeImplementation
  release?(): void | Promise<void>
}

export interface ComponentRuntimeHostOptions {
  /** Builtins resolve directly; source modules use the supplied L04 content-realm loader. */
  resolveImplementation(
    implementation: ComponentImplementation, definition: ComponentDefinition, signal: AbortSignal,
  ): ComponentRuntimeImplementation | PreparedComponentRuntime
    | Promise<ComponentRuntimeImplementation | PreparedComponentRuntime>
  ports(runScopeId: string, instanceId: string): ComponentRuntimePorts
  authoring?(runScopeId: string, instanceId: string, generation: number): ComponentRuntimeContext['authoring']
  layout?(runScopeId: string, instance: ComponentInstance, generation: number): ComponentLayoutPort | undefined
  resources?: ComponentRuntimeContext['resources']
  media?(scope: ComponentRuntimeScope): ComponentRuntimeContext['media']
  interactions?(context: ComponentRuntimeContext): ComponentRuntimeContext['interactions']
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
  updates: Promise<void>
  cancel(): void
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
  retiring: Promise<void>
}

function implementationSignature(request: ComponentRuntimeRequest): string {
  const implementation = request.instance.implementationOverride ?? request.definition.implementation
  const data = request.instance.data
  // HTML and local modules jointly own their iframe generation. Source replacement
  // retires old globals, timers and pending module evaluation through the existing realm lifecycle.
  const webSource = implementation.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key)
    && data && typeof data === 'object' && !Array.isArray(data) ? [data.html, data.modules, data.moduleGraph] : undefined
  return JSON.stringify([
    request.definition.id, request.definition.version,
    implementation, webSource, request.environmentSignature,
  ])
}

function contentSignature(instance: ComponentInstance): string {
  const { frame: _frame, ...content } = instance
  return JSON.stringify(content)
}

/** Runtime state only; DocumentSession remains the sole author-data writer. */
export class ComponentRuntimeHost {
  private readonly scopes = new Map<string, Map<string, RuntimeSlot>>()
  private generation = 0

  constructor(private readonly options: ComponentRuntimeHostOptions) {}

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
    const signature = implementationSignature(request)
    if (request.canProject?.() === false) {
      const pending = slot.preparing
      pending?.controller.abort(); slot.preparing = undefined
      const previous = slot.active
      // A hidden surface defers presentation updates, not source revocation.
      // Source/environment replacement still retires the old generation now.
      if (previous && (previous.signature !== signature || previous.request.root !== request.root)) {
        slot.active = undefined; previous.cancel()
        slot.retiring = Promise.all([slot.retiring, previous.release(), pending?.record?.release()]).then(() => {})
      } else if (pending?.record) {
        slot.retiring = Promise.all([slot.retiring, pending.record.release()]).then(() => {})
      }
      return Promise.resolve(slot.active ?? null)
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
      // A failed update is reported to its caller without poisoning subsequent corrected data.
      active.updates = active.updates.catch(() => {}).then(() => this.update(active, request))
      return active.updates.then(() => active.scope.isActive() ? active : null)
    }
    const preparation: Preparation = {
      request, signature, controller: new AbortController(), promise: Promise.resolve(null),
    }
    slot.preparing = preparation
    preparation.promise = this.prepare(slot, preparation)
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
    active?.cancel()
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
        request.definition, controller.signal,
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
      if (pending.request.canProject?.() === false) {
        const previous = slot.active
        if (previous && (previous.signature !== pending.signature || previous.request.root !== pending.request.root)) {
          slot.active = undefined; previous.cancel()
          slot.retiring = Promise.all([slot.retiring, previous.release()]).then(() => {})
        }
        if (slot.preparing === pending) slot.preparing = undefined
        await releasePrepared()
        return null
      }

      // Preparation has succeeded. Old host calls stop before any new lifecycle starts.
      const previous = slot.active
      if (previous) {
        slot.active = undefined
        previous.cancel()
        slot.retiring = previous.release()
      }
      await slot.retiring
      if (controller.signal.aborted || slot.preparing !== pending) {
        await releasePrepared()
        return null
      }
      if (pending.request.canProject?.() === false) {
        if (slot.preparing === pending) slot.preparing = undefined
        await releasePrepared()
        return null
      }

      record = this.record(pending.request, pending.signature, controller, releasePrepared)
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
      const baseContext: ComponentRuntimeContext = { instance: record.request.instance, scope: record.scope, root: record.root,
        resources: resources && bindings ? { url: name => resources.url(Object.hasOwn(bindings, name) ? bindings[name] : name) } : resources,
        media: this.options.media?.(record.scope),
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
        authoring: authoring && { register: (spot: Parameters<typeof authoring.register>[0]) => {
          if (!record!.scope.isActive()) return () => {}
          const off = authoring.register(spot); record!.scope.cleanup(off); return off
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
        return null
      }
      if (!record.mounted || typeof record.mounted.update !== 'function' || typeof record.mounted.dispose !== 'function') {
        throw new Error('组件 mount() 必须返回含 update() 和 dispose() 的生命周期对象')
      }
      // Same-source changes during asynchronous mounting reuse this mounted generation.
      while (record.request !== pending.request && pending.request.canProject?.() !== false) {
        await this.update(record, pending.request)
        if (controller.signal.aborted || slot.preparing !== pending) {
          await record.release()
          return null
        }
      }
      slot.active = record
      slot.preparing = undefined
      return record
    } catch (error) {
      const cancelled = controller.signal.aborted
      controller.abort()
      if (record) await record.release()
      else await releasePrepared?.()
      if (slot.preparing === pending) slot.preparing = undefined
      if (cancelled) return null
      this.report(error, 'prepare', pending.request)
      throw error
    }
  }

  private async update(record: RuntimeRecord, request: ComponentRuntimeRequest): Promise<void> {
    if (!record.scope.isActive() || !record.mounted || request.canProject?.() === false) return
    try {
      if (contentSignature(record.request.instance) !== contentSignature(request.instance)) {
        await record.mounted.update(request.instance)
      }
      if (!record.scope.isActive()) return
      if (JSON.stringify(record.request.instance.frame) !== JSON.stringify(request.instance.frame)) {
        record.mounted.updatePlacement?.(request.instance.frame)
      }
      record.request = request
    } catch (error) {
      this.report(error, 'update', request)
      throw error
    }
  }

  private record(
    request: ComponentRuntimeRequest, signature: string, controller: AbortController,
    releaseModule: () => Promise<void>,
  ): RuntimeRecord {
    const ports = this.options.ports(request.runScopeId, request.instance.id)
    const cleanups = new Set<() => void>()
    let cancelled = false
    let release: Promise<void> | undefined
    const alive = () => !controller.signal.aborted
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
      target: reference => {
        if (!alive()) return null
        const target = ports.target(reference)
        if (!target) return null
        const scoped: ComponentRuntimeTarget = {
          instanceId: target.instanceId,
          get element() { return alive() ? target.element : undefined },
          read: () => alive() ? target.read() : null,
          emit: (name, value) => { if (alive()) target.emit(name, value) },
          ...(target.motion ? { motion: { replace: (channel: string, program: import('../../../shared/contracts/component-platform/motion').ComponentMotionProgram) => {
            if (!alive()) return { finished: Promise.resolve({ status: 'cancelled' as const }), cancel() {} }
            const task = target.motion!.replace(`source:${scope.instanceId}:${scope.generation}:${channel}`, program)
            cleanup(task.cancel)
            void task.finished.finally(() => { cleanups.delete(task.cancel) })
            return task
          } } } : {}),
          ...(target.presentation ? { presentation: {
            feedback: (text?: string) => {
              if (!alive()) return { setText: () => Promise.resolve(false), dispose() {} }
              const handle = target.presentation!.feedback(text); cleanup(handle.dispose)
              return { setText: (value: string) => alive() ? handle.setText(value) : Promise.resolve(false), dispose: handle.dispose }
            },
            visibility: (visible?: boolean) => {
              if (!alive()) return { setVisible: () => Promise.resolve(false), dispose() {} }
              const handle = target.presentation!.visibility(visible); cleanup(handle.dispose)
              return { setVisible: (value: boolean) => alive() ? handle.setVisible(value) : Promise.resolve(false), dispose: handle.dispose }
            },
          } } : {}),
        }
        return scoped
      },
      events: {
        emit: (name, value) => { if (alive()) ports.events.emit(name, value) },
        subscribe: (name, listener) => subscribe<JsonValue>(next => ports.events.subscribe(name, next), listener),
      },
      state: {
        get: name => alive() ? ports.state.get(name) : undefined,
        set: (name, value) => { if (alive()) ports.state.set(name, value) },
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
      scope, root, request, signature, updates: Promise.resolve(), cancel,
      release: () => release ??= (async () => {
        cancel()
        try { const mounted = await record.mount?.catch(() => null); await mounted?.dispose() }
        catch (error) { this.report(error, 'dispose', request) }
        finally { root?.remove(); await releaseModule() }
      })(),
    }
    return record
  }

  private report(error: unknown, phase: 'prepare' | 'update' | 'dispose', request: ComponentRuntimeRequest): void {
    try { this.options.reportError?.(error, phase, request.runScopeId, request.instance.id) }
    catch { /* Diagnostics cannot prevent cancellation and cleanup. */ }
  }
}
