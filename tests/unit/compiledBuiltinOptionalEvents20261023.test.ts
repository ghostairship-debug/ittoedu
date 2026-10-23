// @vitest-environment node
import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { compilePublishedScriptModule } from '../../src/core/publish/componentPlatform/compiledScript'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
import { createChartData } from '../../src/components/chart/data'
import type { ComponentRuntimeContext, ComponentRuntimeImplementation } from '../../src/shared/contracts/component-platform'

const nativeHelpers = {
  __eventMethod: (target: any, method: string) => target[method].bind(target),
  __eventProperty: (target: any, name: string, value: unknown) => (target[name] = value),
  __ownerDocument: (node: Node) => node.ownerDocument,
}

it('keeps trusted native optional event access/calls, receiver identity and lazy arguments', () => {
  const output = compilePublishedScriptModule(`
    export function access(read,arg){return read()?.removeEventListener(arg(),()=>{})}
    export function call(read,arg){return read().removeEventListener?.(arg(),()=>{})}
    export function both(read,arg){return read()?.removeEventListener?.(arg(),()=>{})}
    export function ordinary(read,arg){return read().removeEventListener(arg(),()=>{})}
  `, { trustedBuiltin: true })
  expect(output.diagnostics).toEqual([])
  const api = Function(`return (${output.factorySource})`)()(nativeHelpers)
  let receiverReads = 0, argumentReads = 0, methodReads = 0, calls = 0
  const absent = () => { receiverReads++; return undefined }
  const argument = () => { argumentReads++; return 'click' }
  expect(api.access(absent, argument)).toBeUndefined()
  expect(api.both(absent, argument)).toBeUndefined()
  expect(receiverReads).toBe(2)
  expect(argumentReads).toBe(0)
  expect(() => api.call(absent, argument)).toThrow(TypeError)
  expect(() => api.ordinary(absent, argument)).toThrow(TypeError)
  expect(argumentReads).toBe(0)
  expect(api.call(() => ({}), argument)).toBeUndefined()
  expect(() => api.access(() => ({}), argument)).toThrow(TypeError)
  expect(argumentReads).toBe(1)
  const target = { get removeEventListener() { methodReads++; return function(this: unknown, type: string) {
    expect(this).toBe(target); expect(type).toBe('click'); calls++
  } } }
  receiverReads = 0; argumentReads = 0
  const read = () => { receiverReads++; return target }
  for (const method of ['access', 'call', 'both', 'ordinary']) api[method](read, argument)
  expect([receiverReads, argumentReads, methodReads, calls]).toEqual([4, 4, 4, 4])
})

it('compiles the real generated chart builtin and paints, updates and disposes its native runtime', async () => {
  const source = await loadBuiltinComponentSource('guoling.chart')
  if (!source?.source) throw new Error('Expected the generated chart source')
  const compiled = compilePublishedScriptModule(source.source, { trustedBuiltin: true })
  expect(compiled.diagnostics).toEqual([])
  const dom = new JSDOM('<!doctype html><main></main>'), browser = dom.window
  const globals = new Proxy(nativeHelpers, { get(target, key) {
    if (Object.hasOwn(target, key)) return Reflect.get(target, key)
    const value = Reflect.get(browser, key, browser)
    return typeof value === 'function' && !value.prototype ? value.bind(browser) : value
  } })
  const module = await Function(`return (${compiled.factorySource})`)()(globals)
  const implementation: ComponentRuntimeImplementation = module.default ?? module
  const controller = new AbortController(), cleanups: Array<() => void> = []
  const scope: ComponentRuntimeContext['scope'] = { runScopeId: 'compiled-chart', instanceId: 'chart', generation: 1,
    signal: controller.signal, isActive: () => !controller.signal.aborted, cleanup: fn => cleanups.push(fn), target: () => null,
    events: { emit() {}, subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} } }
  const root = browser.document.querySelector('main')!, instance = { id: 'chart', definitionId: 'chart', data: createChartData(),
    frame: { width: 480, height: 300, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] } }
  try {
    const mounted = await implementation.mount({ instance, root, scope })
    expect(root.querySelector('svg[data-native-chart-id]')).not.toBeNull()
    await mounted.update({ ...instance, data: { ...instance.data, title: '更新后的图表' } })
    expect(root.textContent).toContain('更新后的图表')
    await mounted.dispose()
    expect(root.querySelector('svg')).toBeNull()
    controller.abort()
    for (const cleanup of cleanups) cleanup()
  } finally { dom.window.close() }
})
