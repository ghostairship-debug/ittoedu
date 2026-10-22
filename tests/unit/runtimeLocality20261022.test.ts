import { afterEach, expect, it, vi } from 'vitest'
import { createComponentCompilationInputReader } from '../../src/core/components/compilation/componentCompilationInput'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentRuntimeHost } from '../../src/player/components/runtime/ComponentRuntimeHost'
import type { ComponentDefinition, ComponentInstance, ComponentRuntimeContext, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentResources } from '../../src/shared/workbench/document'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })
const project = (): CourseProjectV10 => ({ schemaVersion: 11, id: 'locality', title: 'Local changes', revision: 0,
  rootIds: ['probe'], entry: { rootInstanceId: 'probe' }, global: { underlay: [], overlay: [] }, assets: {},
  definitions: { probe: { id: 'probe', role: 'content', implementation: { kind: 'builtin', key: 'probe' } } },
  instances: { probe: { id: 'probe', definitionId: 'probe', data: {} } } })

it('reuses source preparation before decoding, but observes real files, dependency versions and dormant bindings', () => {
  let value = project()
  const source = { kind: 'source' as const, language: 'javascript' as const, workspace: { ownerId: 'root', entry: 'entry.js' }, moduleBindings: { helper: 'helper', dormant: 'missing' } }
  const helper = { id: 'helper', role: 'content' as const, version: '1', implementation: { kind: 'source' as const, language: 'javascript' as const, source: 'export const answer = 1' } }
  value.definitions.source = { id: 'source', role: 'content', implementation: source }; value.definitions.helper = helper
  const files = { 'entry.js': new TextEncoder().encode('export { answer } from "helper"'), 'image.bin': new Uint8Array([255, 0]) }
  const resources: DocumentResources = { assets: {}, components: { root: files } }
  const read = createComponentCompilationInputReader(), first = read(value, source, resources)
  value = { ...value, revision: 1, instances: { ...value.instances, probe: { ...value.instances.probe, data: { label: 'typed' } } } }
  expect(read(value, source, { ...resources, assets: { unrelated: new Uint8Array([1]) } })).toBe(first)
  files['entry.js'] = new TextEncoder().encode('export { answer as current } from "helper"')
  const changedFile = read(value, source, resources)
  expect(changedFile).not.toBe(first); expect(changedFile.files['entry.js']).toContain('current')
  helper.implementation.source = 'export const answer = 2'
  const changedDependency = read(value, source, resources)
  expect(changedDependency.dependencies!.helper.files['component.js']).toContain('2')
  value = { ...value, definitions: { ...value.definitions, missing: { id: 'missing', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default 3' } } } }
  expect(read(value, source, resources).dependencies!.missing).toBeTruthy()
  expect(first.binaryFiles!['image.bin']).toEqual(new Uint8Array([255, 0]))
  expect(files['image.bin'].byteLength).toBe(2)
})

it('avoids a full target snapshot for change-only observers and preserves explicit full subscriptions', async () => {
  let value = project(), context!: ComponentRuntimeContext
  const changed = vi.fn(), full = vi.fn()
  const runtime = new ComponentPlatformRuntime('target-locality', { mode: 'edit', builtins: new Map([['probe', {
    mount(input: ComponentRuntimeContext) { context = input; input.scope.events.subscribe('__runtime.targets.changed', changed); return { update() {}, dispose() {} } },
  }]]) })
  const root = document.createElement('div'); document.body.append(root); runtime.bind('probe', root)
  try {
    await runtime.sync(value, { assets: {}, components: {} })
    const snapshots = vi.spyOn(runtime, 'targetSnapshots')
    value = { ...value, revision: 1, instances: { ...value.instances, other: { id: 'other', definitionId: 'probe', data: { text: 'new' } } } }
    await runtime.sync(value, { assets: {}, components: {} })
    expect(changed).toHaveBeenCalledWith(null); expect(snapshots).not.toHaveBeenCalled()
    context.scope.events.subscribe('__runtime.targets', full)
    value = { ...value, revision: 2, instances: { ...value.instances, other: { ...value.instances.other, data: { text: 'current' } } } }
    await runtime.sync(value, { assets: {}, components: {} })
    expect(full).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ instanceId: 'other', value: { text: 'current' } })]))
  } finally { await runtime.dispose() }
})

it('does not create an opaque-realm representation for native-only assets and retains every dynamic asset when requested', async () => {
  const value = project()
  value.assets = { first: { id: 'first', path: 'first.bin', mimeType: 'application/octet-stream' }, second: { id: 'second', path: 'second.bin' } }
  const resources = { assets: { first: new Uint8Array([1]), second: new Uint8Array([2]) }, components: {} }
  let sequence = 0
  const NativeURL = URL
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL() { return `blob:world-${++sequence}` }; static revokeObjectURL() {} })
  const encode = vi.spyOn(globalThis, 'btoa')
  const runtime = new ComponentPlatformRuntime('resource-locality', { mode: 'edit' })
  try {
    await runtime.sync(value, resources)
    expect(runtime.assetUrl('first')).toMatch(/^blob:/); expect(encode).not.toHaveBeenCalled()
    const all = runtime.resourceUrls()
    expect(Object.keys(all).sort()).toEqual(['first', 'second']); expect(encode).toHaveBeenCalledTimes(2)
    expect(runtime.contentAssetUrl('second')).toBe(all.second); expect(encode).toHaveBeenCalledTimes(2)
    const second = runtime.assetUrl('second')
    await runtime.sync(value, { ...resources, assets: { ...resources.assets, first: new Uint8Array([3]) } })
    expect(runtime.assetUrl('second')).toBe(second); expect(encode).toHaveBeenCalledTimes(2)
    expect(runtime.contentAssetUrl('first')).not.toBe(all.first); expect(encode).toHaveBeenCalledTimes(3)
    expect(resources.assets.first.byteLength).toBe(1)
  } finally { await runtime.dispose() }
})

it('keeps distinct Source updates ordered, shares exact duplicate waits and permits retry after a failed update', async () => {
  const definition: ComponentDefinition = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  const first: ComponentInstance = { id: 'one', definitionId: definition.id, data: { label: 'first' } }
  const calls: string[] = []
  let release!: () => void, rejectOnce = true
  const host = new ComponentRuntimeHost({ resolveImplementation: () => ({ mount() { return {
    update: async next => {
      const label = (next.data as { label: string }).label; calls.push(label)
      if (label === 'slow') await new Promise<void>(resolve => { release = resolve })
      if (label === 'retry' && rejectOnce) { rejectOnce = false; throw new Error('once') }
    }, dispose() {},
  } } }), ports: () => ({ target: () => null, events: { emit() {}, subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} } }) })
  const request = (instance: ComponentInstance) => ({ runScopeId: 'ordered', instance, definition })
  try {
    await host.sync(request(first))
    const slow = host.sync(request({ ...first, data: { label: 'slow' } }))
    await vi.waitFor(() => expect(calls).toEqual(['slow']))
    const latest = { ...first, data: { label: 'latest' } }, after = host.sync(request(latest)), duplicate = host.sync(request(latest))
    release(); await Promise.all([slow, after, duplicate]); expect(calls).toEqual(['slow', 'latest'])
    const retry = { ...first, data: { label: 'retry' } }
    await expect(host.sync(request(retry))).rejects.toThrow('once')
    await host.sync(request(retry)); expect(calls.slice(-2)).toEqual(['retry', 'retry'])
  } finally { await host.disposeScope('ordered') }
})

it('applies the same author instance after a projection-skipped update becomes eligible', async () => {
  const definition: ComponentDefinition = { id: 'behavior', role: 'behavior', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  const first: ComponentInstance = { id: 'one', definitionId: definition.id, data: { label: 'first' } }
  const updates: string[] = []
  const host = new ComponentRuntimeHost({ resolveImplementation: () => ({ mount() { return {
    update: next => { updates.push((next.data as { label: string }).label) }, dispose() {},
  } } }), ports: () => ({ target: () => null, events: { emit() {}, subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} } }) })
  let visible = true
  const request = (instance: ComponentInstance) => ({ runScopeId: 'projection-eligibility', instance, definition, canProject: () => visible })
  try {
    await host.sync(request(first))
    const changed = { ...first, data: { label: 'changed while hidden' } }
    visible = false; await host.sync(request(changed)); expect(updates).toEqual([])
    visible = true; await host.sync(request(changed))
    expect(updates).toEqual(['changed while hidden'])
    await host.sync(request(changed)); expect(updates).toEqual(['changed while hidden'])
  } finally { await host.disposeScope('projection-eligibility') }
})
