// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { NativeCapabilityCache } from '../../src/main/localAgent/capabilityCache'
import { localAgentCapabilitiesSchema, type LocalAgentCapabilities } from '../../src/shared/localAgentContract'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) {
  if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
  await fs.rm(directory, { recursive: true, force: true })
} })
async function directory() { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cap-cache-')); directories.push(value); return value }
function caps(version: string, ids = ['native-model']): LocalAgentCapabilities {
  return { version: 1, adapter: 'opencode', cliVersion: version, models: ids.map(id => ({ id, label: id, resolvedModel: null, image: 'unknown', effort: { kind: 'unknown' } })),
    current: { model: ids[0] ?? null, resolvedModel: null, effort: null }, input: { image: 'unknown', readFile: 'supported', question: 'structured', correction: 'turn-boundary', cancel: 'supported' } }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept }); return { promise, resolve } }

it('coalesces the same directory discovery and refresh while retaining distinct workspace and configuration identities', async () => {
  const cache = new NativeCapabilityCache(), first = await directory(), second = await directory(), gate = deferred<LocalAgentCapabilities>()
  let calls = 0
  const discover = () => { calls++; return gate.promise }
  const one = cache.read('opencode', first, false, discover), two = cache.read('opencode', first, true, discover)
  await expect.poll(() => calls).toBe(1)
  gate.resolve(caps('1'))
  expect(await one).toEqual(await two)
  await cache.read('opencode', first, false, discover)
  expect(calls).toBe(1)
  await cache.read('opencode', second, false, discover)
  expect(calls).toBe(2)
  await fs.writeFile(path.join(first, 'opencode.json'), '{"model":"a"}')
  await cache.read('opencode', first, false, discover)
  expect(calls).toBe(3)
})
it('does not publish or cache a stale in-flight discovery after a native version change', async () => {
  const cache = new NativeCapabilityCache(), cwd = await directory(), old = deferred<LocalAgentCapabilities>()
  let started = false
  const pending = cache.read('opencode', cwd, false, () => { started = true; return old.promise })
  const outcome = pending.catch(error => error)
  await expect.poll(() => started).toBe(true)
  cache.invalidate('opencode', 'new')
  expect((await cache.read('opencode', cwd, true, async () => caps('new'))).cliVersion).toBe('new')
  old.resolve(caps('old'))
  expect(await outcome).toMatchObject({ message: '原生CLI目录已变化，请刷新后重试' })
  expect((await cache.read('opencode', cwd, false, async () => { throw new Error('should use new cache') })).cliVersion).toBe('new')
})
it('merges a delayed selected-model effort discovery into the latest refreshed catalog without dropping new models', async () => {
  const cache = new NativeCapabilityCache(), cwd = await directory()
  const initial = await cache.read('opencode', cwd, false, async () => caps('1', ['selected']))
  await cache.read('opencode', cwd, true, async () => caps('1', ['selected', 'new-model']))
  const result = await cache.merge('opencode', cwd, initial, latest => ({ ...latest, models: latest.models.map(model => model.id === 'selected'
    ? { ...model, effort: { kind: 'supported', values: ['high'], default: 'high' } } : model) }))
  expect(result.models.map(model => model.id)).toEqual(['selected', 'new-model'])
  expect(result.models[0]!.effort).toMatchObject({ kind: 'supported', values: ['high'] })
})
it('expires cached discovery and surfaces refresh failure without relabeling old data as current', async () => {
  const cache = new NativeCapabilityCache(0), cwd = await directory()
  await cache.read('opencode', cwd, false, async () => caps('1'))
  await expect(cache.read('opencode', cwd, false, async () => { throw new Error('directory failed') })).rejects.toThrow('directory failed')
  expect((await cache.read('opencode', cwd, true, async () => caps('2'))).cliVersion).toBe('2')
})

function catalog(version: string, ids = ['default', 'selected']): LocalAgentCapabilities {
  const value = caps(version, ids)
  return { ...value, models: value.models.map(model => ({ ...model,
    effort: { kind: 'supported', values: ['low', 'high', 'max'], default: 'low' } })),
  current: { ...value.current, effort: ids.length ? 'low' : null } }
}
async function confirm(cache: NativeCapabilityCache, cwd: string, confirmation: LocalAgentCapabilities) {
  return cache.merge('opencode', cwd, confirmation, latest => ({ ...latest,
    current: confirmation.current, requestedConfiguration: confirmation.requestedConfiguration }), 'native-session')
}

it('preserves native confirmation across refresh and expiry even when it initially equals the directory default', async () => {
  const cache = new NativeCapabilityCache(0), cwd = await directory()
  const initial = await cache.read('opencode', cwd, false, async () => catalog('1'))
  await confirm(cache, cwd, { ...initial, requestedConfiguration: null })
  const refreshed = await cache.read('opencode', cwd, true, async () => catalog('1', ['selected', 'default', 'new']))
  expect(refreshed.models.map(model => model.id)).toEqual(['selected', 'default', 'new'])
  expect(refreshed.current).toEqual(initial.current)
  expect(refreshed.requestedConfiguration).toBeNull()

  const confirmation = { ...refreshed, current: { model: 'selected', resolvedModel: null, effort: 'high' },
    requestedConfiguration: { model: 'selected', effort: 'max' } }
  await confirm(cache, cwd, confirmation)
  const expired = await cache.read('opencode', cwd, false, async () => catalog('1'))
  expect(expired.current).toEqual(confirmation.current)
  expect(expired.requestedConfiguration).toEqual({ model: 'selected', effort: 'max' })
  expect(localAgentCapabilitiesSchema.parse(expired).current.effort).toBe('high')
})

it('keeps unavailable native confirmation unknown without changing empty catalogs errors or identity boundaries', async () => {
  const cache = new NativeCapabilityCache(), cwd = await directory(), other = await directory()
  const initial = await cache.read('opencode', cwd, false, async () => catalog('1'))
  const confirmation = { ...initial, current: { model: 'selected', resolvedModel: null, effort: 'high' }, requestedConfiguration: null }
  await confirm(cache, cwd, confirmation)
  for (const unavailable of [catalog('1', []), catalog('1', ['default']),
    { ...catalog('1'), models: caps('1', ['default', 'selected']).models }]) {
    const result = await cache.read('opencode', cwd, true, async () => unavailable)
    expect(result.models).toEqual(unavailable.models)
    expect(localAgentCapabilitiesSchema.parse(result).current).toEqual({ model: null, resolvedModel: null, effort: null })
  }
  await expect(cache.read('opencode', cwd, true, async () => { throw new Error('refresh failed') })).rejects.toThrow('refresh failed')
  expect((await cache.read('opencode', cwd, true, async () => catalog('1'))).current).toEqual(confirmation.current)
  expect((await cache.read('opencode', other, false, async () => catalog('1'))).current.model).toBe('default')
  await fs.writeFile(path.join(cwd, 'opencode.json'), '{"model":"configured-elsewhere"}')
  expect((await cache.read('opencode', cwd, false, async () => catalog('1'))).current.model).toBe('default')
  await confirm(cache, cwd, confirmation)
  expect((await cache.read('opencode', cwd, true, async () => catalog('2'))).current.model).toBe('default')
  expect((await cache.read('opencode', cwd, true, async () => catalog('1'))).current.model).toBe('default')
})

it('does not confirm directory-only updates and lets the latest native confirmation win over an in-flight refresh', async () => {
  const cache = new NativeCapabilityCache(), cwd = await directory()
  const initial = await cache.read('opencode', cwd, false, async () => catalog('1'))
  await cache.merge('opencode', cwd, initial, latest => ({ ...latest, models: [...latest.models] }))
  expect((await cache.read('opencode', cwd, true, async () => catalog('1', ['selected', 'default']))).current.model).toBe('selected')

  const gate = deferred<LocalAgentCapabilities>()
  let started = false
  const pending = cache.read('opencode', cwd, true, () => { started = true; return gate.promise })
  await expect.poll(() => started).toBe(true)
  const confirmation = { ...initial, current: { model: 'selected', resolvedModel: null, effort: 'high' }, requestedConfiguration: null }
  const accepted = await confirm(cache, cwd, confirmation)
  expect(accepted.current).toEqual(confirmation.current)
  gate.resolve(catalog('1', ['new', 'selected']))
  const refreshed = await pending
  expect(refreshed.models.map(model => model.id)).toEqual(['new', 'selected'])
  expect(localAgentCapabilitiesSchema.parse(refreshed).current).toEqual(confirmation.current)
})
