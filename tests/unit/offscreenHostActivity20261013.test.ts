import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ComponentDefinition, ComponentInstance, ComponentRuntimeContext, ComponentRuntimeTarget, JsonValue, MountedComponent,
} from '../../src/shared/contracts/component-platform'
import { ComponentRuntimeHost, type ComponentRuntimeRequest } from '../../src/player/components/runtime/ComponentRuntimeHost'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

const hosts: ComponentRuntimeHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.disposeScope('offscreen-host')))
  document.body.replaceChildren()
})

function harness(mount: (context: ComponentRuntimeContext) => MountedComponent | Promise<MountedComponent>, target?: ComponentRuntimeTarget) {
  const definition: ComponentDefinition = { id: 'counter', role: 'content', implementation: { kind: 'builtin', key: 'counter' } }
  const instance: ComponentInstance = { id: 'counter-one', definitionId: definition.id, data: { label: 'first' } }
  const root = document.createElement('div')
  document.body.append(root)
  let activity: JsonValue = { active: true, visible: true, playing: true }, canInteract = true
  const listeners = new Set<(value: JsonValue) => void>()
  const eventsEmit = vi.fn(), stateSet = vi.fn(), stateGet = vi.fn(() => 3)
  const host = new ComponentRuntimeHost({
    resolveImplementation: () => ({ mount }), canInteract: () => canInteract,
    ports: () => ({ target: () => target ?? null,
      events: { emit: eventsEmit, subscribe(name, listener) {
        if (name !== '__runtime.activity') return () => {}
        listeners.add(listener); listener(activity)
        return () => listeners.delete(listener)
      } },
      state: { get: stateGet, set: stateSet, subscribe: () => () => {} },
    }),
  })
  hosts.push(host)
  const request = (label = 'first'): ComponentRuntimeRequest => ({ runScopeId: 'offscreen-host', root,
    definition, instance: { ...instance, data: { label } } })
  return { host, root, request, listeners, eventsEmit, stateSet, stateGet,
    activity(next: { active: boolean; visible: boolean; playing: boolean }) {
      activity = next
      for (const listener of listeners) listener(activity)
    },
    canInteract(value: boolean) { canInteract = value },
  }
}

describe('ComponentRuntimeHost offscreen cooperation', () => {
  it('applies an offscreen change during async mount, then revisits the same instance and clicked state', async () => {
    const mounting = deferred<MountedComponent>()
    const suspend = vi.fn(), resume = vi.fn(), dispose = vi.fn()
    let clicks = 0
    const mount = vi.fn((context: ComponentRuntimeContext) => {
      const button = document.createElement('button')
      button.textContent = '0'
      button.onclick = () => { button.textContent = String(++clicks) }
      context.root!.append(button)
      return mounting.promise
    })
    const runtime = harness(mount)
    const pending = runtime.host.sync(runtime.request())
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce())
    const button = runtime.root.querySelector('button')!
    button.click()
    runtime.activity({ active: false, visible: false, playing: true })
    mounting.resolve({ update() {}, suspend, resume, dispose })
    const handle = await pending
    expect(suspend).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    expect(handle!.scope.isActive()).toBe(true)
    runtime.activity({ active: true, visible: true, playing: true })
    expect(await runtime.host.sync(runtime.request())).toBe(handle)
    expect(resume).toHaveBeenCalledOnce()
    expect(mount).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
    expect(runtime.root.querySelector('button')).toBe(button)
    expect(button.textContent).toBe('1')
  })

  it('serializes async hooks with data updates and follows the latest activity without remounting', async () => {
    const suspending = deferred<void>(), calls: string[] = []
    const mounted: MountedComponent = {
      update(instance) { calls.push(`update:${(instance.data as { label: string }).label}`) },
      async suspend() { calls.push('suspend:start'); await suspending.promise; calls.push('suspend:end') },
      resume() { calls.push('resume') }, dispose() {},
    }
    const mount = vi.fn(() => mounted), runtime = harness(mount)
    const handle = await runtime.host.sync(runtime.request())
    expect(calls).toEqual([])
    runtime.activity({ active: true, visible: false, playing: true })
    await vi.waitFor(() => expect(calls).toEqual(['suspend:start']))
    const update = runtime.host.sync(runtime.request('second'))
    runtime.activity({ active: true, visible: true, playing: true })
    suspending.resolve()
    expect(await update).toBe(handle)
    expect(calls).toEqual(['suspend:start', 'suspend:end', 'resume', 'update:second'])
    expect(mount).toHaveBeenCalledOnce()
  })

  it('cancels synchronously on real disposal and never resumes after a pending suspend completes', async () => {
    const suspending = deferred<void>(), calls: string[] = []
    const runtime = harness(() => ({ update() {},
      async suspend() { calls.push('suspend:start'); await suspending.promise; calls.push('suspend:end') },
      resume() { calls.push('resume') }, dispose() { calls.push('dispose') },
    }))
    const handle = await runtime.host.sync(runtime.request())
    runtime.activity({ active: false, visible: false, playing: true })
    await vi.waitFor(() => expect(calls).toEqual(['suspend:start']))
    runtime.activity({ active: true, visible: true, playing: true })
    const disposing = runtime.host.dispose('offscreen-host', 'counter-one')
    expect(handle!.scope.isActive()).toBe(false)
    expect(runtime.listeners.size).toBe(0)
    await disposing
    expect(calls).toEqual(['suspend:start', 'dispose'])
    expect(runtime.root.childElementCount).toBe(0)
    suspending.resolve()
    await vi.waitFor(() => expect(calls).toEqual(['suspend:start', 'dispose', 'suspend:end']))
  })

  it('retires without waiting for an author update whose awaited work has been cancelled', async () => {
    const updating = deferred<void>(), calls: string[] = []
    const runtime = harness(() => ({
      async update() { calls.push('update:start'); await updating.promise; calls.push('update:end') },
      dispose() { calls.push('dispose') },
    }))
    const handle = await runtime.host.sync(runtime.request())
    const pendingUpdate = runtime.host.sync(runtime.request('second'))
    await vi.waitFor(() => expect(calls).toEqual(['update:start']))
    await runtime.host.dispose('offscreen-host', 'counter-one')
    expect(handle!.scope.isActive()).toBe(false)
    expect(calls).toEqual(['update:start', 'dispose'])
    expect(runtime.root.childElementCount).toBe(0)
    updating.resolve()
    expect(await pendingUpdate).toBeNull()
    expect(calls).toEqual(['update:start', 'dispose', 'update:end'])
    expect(runtime.root.childElementCount).toBe(0)
  })

  it('keeps dormant reads and local state alive while cached host write ports cannot affect another scene', async () => {
    const emit = vi.fn(), replace = vi.fn(() => ({ finished: Promise.resolve({ status: 'completed' as const }), cancel: vi.fn() }))
    const setText = vi.fn(async () => true), setVisible = vi.fn(async () => true)
    const feedback = vi.fn(() => ({ setText, dispose: vi.fn() })), visibility = vi.fn(() => ({ setVisible, dispose: vi.fn() }))
    const target: ComponentRuntimeTarget = { instanceId: 'other', read: () => 7, emit,
      motion: { replace }, presentation: { feedback, visibility } }
    let context!: ComponentRuntimeContext
    const runtime = harness(value => { context = value; return { update() {}, dispose() {} } }, target)
    await runtime.host.sync(runtime.request())
    const cached = context.scope.target({ kind: 'instance', instanceId: 'other' })!
    const oldFeedback = cached.presentation!.feedback('before'), oldVisibility = cached.presentation!.visibility(true)
    runtime.canInteract(false)
    runtime.activity({ active: false, visible: false, playing: true })
    expect(context.scope.isActive()).toBe(true)
    expect(cached.read()).toBe(7)
    expect(context.scope.state.get('counter')).toBe(3)
    cached.emit('navigation', 1)
    context.scope.events.emit('navigation', 1)
    context.scope.state.set('counter', 4)
    const task = cached.motion!.replace('test', () => {})
    expect(await task.finished).toEqual({ status: 'cancelled' })
    expect(await oldFeedback.setText('wrong scene')).toBe(false)
    expect(await oldVisibility.setVisible(false)).toBe(false)
    cached.presentation!.feedback('new')
    cached.presentation!.visibility(false)
    expect(emit).not.toHaveBeenCalled()
    expect(runtime.eventsEmit).not.toHaveBeenCalled()
    expect(runtime.stateSet).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(feedback).toHaveBeenCalledOnce()
    expect(visibility).toHaveBeenCalledOnce()
    expect(setText).not.toHaveBeenCalled()
    expect(setVisible).not.toHaveBeenCalled()
    runtime.canInteract(true)
    context.scope.state.set('counter', 4)
    expect(runtime.stateSet).toHaveBeenCalledWith('counter', 4)
  })
})
