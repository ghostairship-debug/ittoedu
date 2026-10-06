import { readFile } from 'node:fs/promises'
import { URL as NodeURL } from 'node:url'
import { Blob as NodeBlob } from 'node:buffer'
import { MessageChannel } from 'node:worker_threads'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { expect, it, vi } from 'vitest'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentRuntimeHost, type ComponentRuntimeRequest } from '../../src/player/components/runtime/ComponentRuntimeHost'
import { prepareSandboxComponent } from '../../src/renderer/components/SandboxComponentImplementation'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { CourseProjectV10, ComponentImplementation, ComponentRuntimeContext, ComponentRuntimeImplementation } from '../../src/shared/contracts/component-platform'
import type { DocumentResources } from '../../src/shared/workbench/document'

it('retains the UI6 clicked generation for an unused opaque edit, visibly and while hidden, but replaces changed helper/environment', async () => {
  // esbuild executes in Node; use its real typed-array realm before loading the native compiler.
  vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor)
  const { transform } = await import('esbuild')
  const sample = JSON.parse(await readFile('D:/果铃恢复候选/samples/20261006-q0-ui6/prepared-14611556/sample.input.json', 'utf8'))
  const project = sample.project as CourseProjectV10
  const resources: DocumentResources = { assets: Object.fromEntries(Object.entries(sample.resources.assets).map(([id, bytes]) => [id, Uint8Array.from(bytes as number[])])),
    components: Object.fromEntries(Object.entries(sample.resources.components).map(([owner, files]) => [owner,
      Object.fromEntries(Object.entries(files as Record<string, number[]>).map(([name, bytes]) => [name, Uint8Array.from(bytes)]))])) }
  const authorBefore = structuredClone({ project, resources })
  let currentResources = resources, builds = 0, mounts = 0, updates = 0, releases = 0, cleanups = 0
  const generations: number[] = [], live = new Set<number>()
  const compiler = createEsbuildComponentCompiler()
  const compilation = new InMemoryComponentCompilation({ ...compiler, async compile(input) { builds++; return compiler.compile(input) } })
  const errors: string[] = []
  vi.stubGlobal('URL', NodeURL); vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('MessageChannel', MessageChannel)
  const prepare = async (implementation: Extract<ComponentImplementation, { kind: 'source' }>, signal: AbortSignal) => {
    const result = await compilation.compile(componentCompilationInput(project, implementation, currentResources))
    if (result.status !== 'ready') throw new Error(result.diagnostics.map(item => item.message).join('\n'))
    const prepared = await prepareSandboxComponent(result.artifact, signal, { state: () => ({}), targets: () => [] })
    // Execute the real compiler output in this DOM carrier; the browser realm/lease is verified separately in Main.
    return { ...prepared, release: async () => { releases++; await prepared.release?.() }, implementation: { async mount(context: ComponentRuntimeContext) {
      mounts++; generations.push(context.scope.generation); live.add(context.scope.generation)
      context.scope.cleanup(() => { cleanups++; live.delete(context.scope.generation) })
      const code = await transform(result.artifact.code, { format: 'cjs', target: 'es2022' })
      const module = { exports: {} as ComponentRuntimeImplementation }
      new Function('module', 'exports', 'document', code.code)(module, module.exports, document)
      const mounted = await module.exports.mount(context)
      return { ...mounted, update: (instance: typeof context.instance) => { updates++; return mounted.update(instance) } }
    } } }
  }
  const a = document.createElement('div'), b = document.createElement('div'), hiddenRoot = document.createElement('div')
  document.body.append(a, b, hiddenRoot)
  const world = new ComponentPlatformRuntime('ui6-artifact', { mode: 'edit', resolveSource: prepare, report: error => errors.push(error) })
  let hidden: ComponentRuntimeHost | undefined
  try {
    world.bind('ui6-a', a); world.bind('ui6-b', b)
    await world.sync(project, currentResources)
    expect(errors).toEqual([])
    const button = a.querySelector('button')!, output = a.querySelector('output')!
    button.click(); expect(output.textContent).toContain('clicks 1')
    const firstGenerations = [...generations], initialMounts = mounts
    currentResources = structuredClone(resources)
    currentResources.components['ui6-shared-files']!['opaque.bin'] = Uint8Array.from([0,255,128,17,65])
    await world.sync(project, currentResources)
    expect.soft(a.querySelector('button')).toBe(button); expect.soft(a.querySelector('output')!.textContent).toContain('clicks 1')
    expect.soft(mounts).toBe(initialMounts); expect.soft(generations).toEqual(firstGenerations)
    expect.soft(updates).toBe(0); expect.soft(cleanups).toBe(0); expect(builds).toBe(2)
    currentResources.components['ui6-shared-files']!['helper.js'] = new TextEncoder().encode('export const step = 2;\n')
    await world.sync(project, currentResources)
    expect(a.querySelector('button')).not.toBe(button); expect(a.querySelector('output')!.textContent).toContain('step 2 | clicks 0')
    expect(mounts).toBe(initialMounts + 2); expect(cleanups).toBe(initialMounts)

    let visible = true
    hidden = new ComponentRuntimeHost({ resolveImplementation: (implementation, _definition, signal) => prepare(implementation as Extract<ComponentImplementation, { kind: 'source' }>, signal),
      resources: { url: id => world.resourceUrls()[id] }, ports: () => ({ target: () => null, events: { emit() {}, subscribe: () => () => {} },
        state: { get: () => undefined, set() {}, subscribe: () => () => {} } }) })
    const implementation = project.definitions['ui6-counter']!.implementation as Extract<ComponentImplementation, { kind: 'source' }>
    const request = (label = 'A', environmentSignature = 'origins:[]'): ComponentRuntimeRequest => ({ runScopeId: 'ui6-hidden', root: hiddenRoot,
      definition: project.definitions['ui6-counter']!, instance: { ...project.instances['ui6-a']!, data: { ...project.instances['ui6-a']!.data as object, label } },
      canProject: () => visible, environmentSignature,
      ...{ preparationSignature: JSON.stringify(componentCompilationInput(project, implementation, currentResources)) } })
    const handle = await hidden.sync(request())
    const hiddenButton = hiddenRoot.querySelector('button')!, hiddenOutput = hiddenRoot.querySelector('output')!
    hiddenButton.click(); expect(hiddenOutput.textContent).toContain('clicks 2')
    const hiddenMounts = mounts, hiddenCleanup = cleanups, hiddenUpdates = updates, beforeRelease = releases
    visible = false
    currentResources = structuredClone(currentResources)
    currentResources.components['ui6-shared-files']!['opaque.bin'] = Uint8Array.from([0,255,128,17,65,66])
    const same = await hidden.sync(request('deferred'))
    expect.soft(same).toBe(handle); expect.soft(handle!.scope.isActive()).toBe(true)
    expect.soft(mounts).toBe(hiddenMounts); expect.soft(cleanups).toBe(hiddenCleanup); expect.soft(updates).toBe(hiddenUpdates)
    expect.soft(hiddenOutput.textContent).toContain('A | step 2 | clicks 2'); expect.soft(releases).toBe(beforeRelease + 1)
    visible = true
    const resumed = await hidden.sync(request('deferred'))
    expect.soft(resumed).toBe(handle); expect.soft(hiddenRoot.querySelector('button')).toBe(hiddenButton)
    expect.soft(hiddenOutput.textContent).toContain('deferred | step 2 | clicks 2'); expect.soft(updates).toBe(hiddenUpdates + 1)
    visible = false
    currentResources.components['ui6-shared-files']!['helper.js'] = new TextEncoder().encode('export const step = 3;\n')
    await hidden.sync(request('deferred'))
    expect(handle!.scope.isActive()).toBe(false); expect(mounts).toBe(hiddenMounts)
    visible = true
    const changed = await hidden.sync(request('deferred'))
    expect(changed!.scope.generation).not.toBe(handle!.scope.generation)
    expect(hiddenRoot.querySelector('output')!.textContent).toContain('step 3 | clicks 0')
    visible = false
    const revoking = hidden.sync(request('deferred', 'origins:[https://changed.example]'))
    expect(changed!.scope.isActive()).toBe(false)
    await revoking
    expect({ project, resources }).toEqual(authorBefore)
  } finally { await hidden?.disposeScope('ui6-hidden'); await world.dispose(); a.remove(); b.remove(); hiddenRoot.remove(); vi.unstubAllGlobals() }
  expect(live.size).toBe(0)
})
