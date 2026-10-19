// @vitest-environment node
import { transform } from 'esbuild'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentAuthorEnhancementEdits } from '../../src/core/components/source/componentAuthorSource'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { ComponentImplementation, ComponentRuntimeContext, ComponentRuntimeImplementation, JsonValue } from '../../src/shared/contracts/component-platform'

const driver = new CourseV10Driver()
const source = (text: string): Extract<ComponentImplementation, { kind: 'source' }> => ({ kind: 'source', language: 'javascript', source: text })
const baseSource = `
export const document = 'web';
export const marker = 'namespace-base';
export function mount(context) {
  if (this.marker !== 'namespace-base') throw new Error('base namespace this lost');
  const root = context.root;
  class Mounted {
    constructor() { this.root = root; this.paint(context.instance); }
    paint(instance) { this.root.innerHTML = '<button class="increment"><span>increment</span></button><output></output>'; this.root.dataset.version = instance.data.version; }
    update(instance) { if (this.root !== root) throw new Error('prototype update this lost'); this.paint(instance); root.dataset.updates = String(Number(root.dataset.updates || 0) + 1); }
    suspend() { this.root.dataset.suspended = 'yes'; }
    resume() { this.root.dataset.suspended = 'no'; }
    dispose() { this.root.dataset.disposed = String(Number(this.root.dataset.disposed || 0) + 1); }
  }
  return new Mounted();
}`
const enhancementSource = `export default ({root, instance, scope, listen, observe}) => {
  root.dataset.enhancement = instance.data.version;
  listen('click', '.increment', (_event, button) => { root.dataset.delegated = button.className; scope.state.set('count', Number(scope.state.get('count') || 0) + 1); });
  observe('count', value => { const output = root.querySelector('output'); if (output) output.textContent = String(value ?? ''); });
  scope.cleanup(() => { root.dataset.cleanups = String(Number(root.dataset.cleanups || 0) + 1); });
  return () => { root.dataset.retired = String(Number(root.dataset.retired || 0) + 1); };
};`

function model() {
  const project = createBlankCourseProjectV10('局部增强真实执行')
  project.definitions.shared = { id: 'shared', title: 'Shared', role: 'content', implementation: source(baseSource) }
  for (const id of ['a', 'b']) project.instances[id] = { id, definitionId: 'shared', data: { version: 'first' } }
  project.surfaces[0].childIds = ['a', 'b']
  return { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} as Record<string, Record<string, Uint8Array>> } }
}
function enhance(current: ReturnType<typeof model>, text = enhancementSource) {
  return driver.apply(current, captureComponentOperation(current.project,
    componentAuthorEnhancementEdits(current.project, current.resources, 'a', text))) as ReturnType<typeof model>
}
async function loadImplementation(current: ReturnType<typeof model>, dom: JSDOM, instanceId = 'a') {
  const instance = current.project.instances[instanceId]
  const implementation = instance.implementationOverride ?? current.project.definitions[instance.definitionId].implementation
  if (implementation.kind !== 'source') throw new Error('Expected real Source graph')
  const compiled = await createEsbuildComponentCompiler().compile(componentCompilationInput(current.project, implementation, current.resources))
  if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
  const wrapped = await transform(compiled.artifact.code, { format: 'cjs' })
  const loaded = { exports: {} as { default?: ComponentRuntimeImplementation; implementation?: ComponentRuntimeImplementation } & Partial<ComponentRuntimeImplementation> }
  // Run the serialized dependency, not the imported helper: unresolved toString helpers must fail here.
  Function('module', 'exports', 'Element', 'AbortController', wrapped.code)(loaded, loaded.exports, dom.window.Element, dom.window.AbortController)
  return loaded.exports.default ?? loaded.exports.implementation ?? loaded.exports as ComponentRuntimeImplementation
}
function contextFor(current: ReturnType<typeof model>) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>')
  const root = dom.window.document.getElementById('root')!
  const controller = new dom.window.AbortController()
  const state = new Map<string, JsonValue>([['count', 7]])
  const subscribers = new Map<string, Set<(value: JsonValue | undefined) => void>>()
  const events = new Map<string, Set<(value: JsonValue) => void>>()
  const cleanups: Array<() => void> = []
  const subscribe = <T,>(listeners: Map<string, Set<(value: T) => void>>, key: string, listener: (value: T) => void) => {
    const group = listeners.get(key) ?? new Set<(value: T) => void>(); listeners.set(key, group); group.add(listener)
    return () => { group.delete(listener) }
  }
  const context: ComponentRuntimeContext = {
    instance: current.project.instances.a, root,
    scope: { runScopeId: 'enhancement-test', instanceId: 'a', generation: 1, signal: controller.signal,
      isActive: () => !controller.signal.aborted, cleanup: cleanup => { cleanups.push(cleanup) }, target: () => null,
      state: { get: key => state.get(key), set: (key, value) => { state.set(key, value); for (const listener of subscribers.get(key) ?? []) listener(value) },
        subscribe: (key, listener) => subscribe(subscribers, key, listener) },
      events: { emit: (key, value) => { for (const listener of events.get(key) ?? []) listener(value) },
        subscribe: (key, listener) => subscribe(events, key, listener) } },
  }
  const click = () => root.querySelector('.increment span')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }))
  return { context, dom, root, state, subscribers, controller, click,
    close() { controller.abort(); for (const cleanup of cleanups.reverse()) cleanup(); dom.window.close() } }
}

it('executes the serialized Source graph with namespace base and prototype lifecycle, delegated clicks and first/subsequent state paints after redraw', async () => {
  const current = enhance(model()), harness = contextFor(current)
  try {
    // Exercise host keepNames/minification too: serializing a transformed function once leaked __name.
    const host = await transform(readFileSync(new URL('../../src/core/components/source/componentEnhancement.ts', import.meta.url), 'utf8'),
      { loader: 'ts', format: 'cjs', keepNames: true, minify: true })
    const loadedHost = { exports: {} as { componentEnhancementRuntimeSource: string } }
    Function('module', 'exports', host.code)(loadedHost, loadedHost.exports)
    const implementationSource = current.project.instances.a.implementationOverride!
    if (implementationSource.kind !== 'source') throw new Error('Expected Source')
    current.project.definitions[implementationSource.moduleBindings!['./enhancement-runtime']].implementation = source(loadedHost.exports.componentEnhancementRuntimeSource)
    const implementation = await loadImplementation(current, harness.dom)
    expect(implementation.document).toBe('web')
    const mounted = await implementation.mount(harness.context)
    expect(harness.root.querySelector('output')!.textContent).toBe('7')
    harness.click()
    expect(harness.root.dataset.delegated).toBe('increment')
    expect(harness.state.get('count')).toBe(8)
    expect(harness.root.querySelector('output')!.textContent).toBe('8')
    const previous = harness.root.querySelector('button')!
    await mounted.update({ ...current.project.instances.a, data: { version: 'redrawn' } })
    expect(previous.isConnected).toBe(false)
    expect(harness.root.dataset).toMatchObject({ version: 'redrawn', enhancement: 'redrawn', updates: '1', cleanups: '1', retired: '1' })
    expect(harness.root.querySelector('output')!.textContent).toBe('8')
    expect(harness.subscribers.get('count')!.size).toBe(1)
    harness.click()
    expect(harness.root.querySelector('output')!.textContent).toBe('9')
    await mounted.dispose()
    expect(harness.root.dataset.disposed).toBe('1')
  } finally { harness.close() }
})

it('retains enhancement during ordinary suspend and releases its listeners and subscriptions on scope cancellation', async () => {
  const current = enhance(model()), harness = contextFor(current)
  try {
    const mounted = await (await loadImplementation(current, harness.dom)).mount(harness.context)
    await mounted.suspend?.()
    expect(harness.root.dataset.suspended).toBe('yes')
    harness.click()
    expect(harness.root.querySelector('output')!.textContent).toBe('8')
    await mounted.resume?.()
    expect(harness.root.dataset.suspended).toBe('no')
    expect(harness.root.dataset.cleanups).toBeUndefined()
    harness.controller.abort()
    expect(harness.root.dataset).toMatchObject({ cleanups: '1', retired: '1' })
    expect(harness.subscribers.get('count')!.size).toBe(0)
    harness.click()
    expect(harness.state.get('count')).toBe(8)
    harness.context.scope.state.set('count', 30)
    expect(harness.root.querySelector('output')!.textContent).toBe('8')
    await mounted.dispose(); await mounted.dispose()
    expect(harness.root.dataset.disposed).toBe('1')
    expect(harness.root.dataset.cleanups).toBe('1')
  } finally { harness.close() }
})

it('disposes the mounted base and partial enhancement when its initial enhancement throws', async () => {
  const current = enhance(model(), `export default ({root, scope, listen, observe}) => {
    listen('click', '.increment', () => scope.state.set('count', 99));
    observe('count', value => { root.querySelector('output').textContent = String(value); });
    scope.cleanup(() => { root.dataset.failedCleanup = 'done'; });
    throw new Error('enhancement failed');
  };`), harness = contextFor(current)
  try {
    const implementation = await loadImplementation(current, harness.dom)
    await expect(implementation.mount(harness.context)).rejects.toThrow('enhancement failed')
    expect(harness.root.dataset).toMatchObject({ disposed: '1', failedCleanup: 'done' })
    expect(harness.subscribers.get('count')!.size).toBe(0)
    harness.click()
    expect(harness.state.get('count')).toBe(7)
  } finally { harness.close() }
})

it('replaces an existing enhancement without stacking wrappers and preserves the shared peer through save and reopen', async () => {
  const before = model(), once = enhance(before), firstRoot = once.project.instances.a.implementationOverride
  const changed = enhance(once, enhancementSource.replace('export default', 'export const enhance =').replace('instance.data.version;', "'replacement';"))
  expect(Object.keys(changed.project.definitions)).toHaveLength(Object.keys(once.project.definitions).length)
  expect(changed.project.instances.a.implementationOverride).toEqual(firstRoot)
  expect(changed.project.instances.b).toEqual(before.project.instances.b)
  expect(changed.project.definitions.shared).toEqual(before.project.definitions.shared)
  const reopened = driver.load(driver.serialize(changed)) as ReturnType<typeof model>
  expect(reopened.project.instances.b).toEqual(before.project.instances.b)
  expect(reopened.project.definitions.shared).toEqual(before.project.definitions.shared)
  const harness = contextFor(reopened)
  try {
    const mounted = await (await loadImplementation(reopened, harness.dom)).mount(harness.context)
    expect(harness.root.dataset.enhancement).toBe('replacement')
    expect(harness.root.querySelector('output')!.textContent).toBe('7')
    harness.click()
    expect(harness.state.get('count')).toBe(8)
    expect(harness.subscribers.get('count')!.size).toBe(1)
    await mounted.dispose()
    harness.root.innerHTML = ''
    delete harness.root.dataset.enhancement
    const peer = await loadImplementation(reopened, harness.dom, 'b')
    const peerMounted = await peer.mount({ ...harness.context, instance: reopened.project.instances.b })
    expect(harness.root.dataset.version).toBe('first')
    expect(harness.root.dataset.enhancement).toBeUndefined()
    expect(harness.root.querySelector('output')!.textContent).toBe('')
    await peerMounted.dispose()
  } finally { harness.close() }
})

it('resolves binding aliases through the current instance and rebinds their first paint and subscription after update', async () => {
  const original = model()
  Object.assign(original.project.instances.a, { stateBindings: { counter: 'count' } })
  const current = enhance(original, `export default ({root, listen, bindings}) => {
    bindings.observe('counter', value => { root.querySelector('output').textContent = String(value); });
    listen('click', '.increment', () => bindings.set('counter', Number(bindings.get('counter')) + 1));
  };`), harness = contextFor(current)
  try {
    const mounted = await (await loadImplementation(current, harness.dom)).mount(harness.context)
    expect(harness.root.querySelector('output')!.textContent).toBe('7')
    harness.click()
    expect(harness.state.get('count')).toBe(8)
    harness.state.set('renamed-count', 20)
    const next = { ...current.project.instances.a, stateBindings: { counter: 'renamed-count' } }
    await mounted.update(next)
    expect(harness.subscribers.get('count')!.size).toBe(0)
    expect(harness.root.querySelector('output')!.textContent).toBe('20')
    harness.click()
    expect(harness.state.get('count')).toBe(8)
    expect(harness.state.get('renamed-count')).toBe(21)
    await mounted.dispose()
    expect(harness.subscribers.get('renamed-count')!.size).toBe(0)
  } finally { harness.close() }
})
