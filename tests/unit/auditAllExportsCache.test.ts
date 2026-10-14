// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import type { ComponentCompilationInput, ComponentCompilerResult } from '../../src/core/components/compilation/types'

const ready = (): ComponentCompilerResult => ({ status: 'ready', artifact: { format: 'esm', code: 'export default {}', css: '', diagnostics: [] } })
const input = (text: string, binary = new Uint8Array(1024).fill(255)): ComponentCompilationInput => ({ entry: 'main.js', files: { 'main.js': text }, binaryFiles: { 'font.woff': binary }, rootDefinitionId: 'root', htmlModuleBindings: { alias: 'main.js' } })

it('CA034: completed compilation versions use a compact bounded LRU and clear releases the last project', async () => {
  const compile = vi.fn(async () => ready()), cache = new InMemoryComponentCompilation({ identity: 'audit', compile }, 2)
  await cache.compile(input('one')); await cache.compile(input('two'))
  expect((await cache.compile(input('one'))).cacheHit).toBe(true)
  await cache.compile(input('three'))
  expect((await cache.compile(input('one'))).cacheHit).toBe(true)
  expect((await cache.compile(input('two'))).cacheHit).toBe(false)
  const probe = cache as unknown as { cache: Map<string, Promise<ComponentCompilerResult>> }
  expect(probe.cache.size).toBe(2)
  expect([...probe.cache.keys()].every(key => key.length === 64)).toBe(true)
  cache.clear()
  expect(probe.cache.size).toBe(0)
  expect((await cache.compile(input('two'))).cacheHit).toBe(false)
})

it('CA034: in-flight dedup survives completed-result capacity and all compiler-owned bindings reach the compiler', async () => {
  const pending: Array<(value: ComponentCompilerResult) => void> = []
  const compile = vi.fn((_source: ComponentCompilationInput) => new Promise<ComponentCompilerResult>(resolve => pending.push(resolve)))
  const cache = new InMemoryComponentCompilation({ identity: 'audit', compile }, 1)
  const first = cache.compile(input('one')), same = cache.compile(input('one')), second = cache.compile(input('two'))
  await Promise.resolve()
  expect(compile).toHaveBeenCalledTimes(2)
  expect(compile.mock.calls[0]![0]).toMatchObject({ rootDefinitionId: 'root', htmlModuleBindings: { alias: 'main.js' } })
  pending[0]!(ready()); pending[1]!(ready())
  const results = await Promise.all([first, same, second])
  expect(results.map(value => value.cacheHit)).toEqual([false, true, false])
  expect((cache as unknown as { cache: Map<string, unknown> }).cache.size).toBe(1)
})

it('CA034: changed binary bytes and changed HTML aliases cannot reuse another compiler input', async () => {
  const compile = vi.fn(async () => ready()), cache = new InMemoryComponentCompilation({ identity: 'audit', compile })
  await cache.compile(input('one', Uint8Array.of(1)))
  expect((await cache.compile(input('one', Uint8Array.of(2)))).cacheHit).toBe(false)
  expect((await cache.compile({ ...input('one', Uint8Array.of(2)), htmlModuleBindings: { alias: 'other.js' } })).cacheHit).toBe(false)
  expect(compile).toHaveBeenCalledTimes(3)
})
