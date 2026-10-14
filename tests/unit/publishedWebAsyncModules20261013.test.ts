// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compilePublishedScriptModule, compilePublishedWebProgram } from '../../src/core/publish/componentPlatform/compiledScript'
import { createWebModuleResolver, projectPublishedWebInitialization, projectWebModuleGraph, publishedWebInitializationBinding, publishedWebInitializationExport, publishedWebInitializationSource, publishedWebModuleCompilationInput, publishedWebModuleDocumentPaths, publishedWebRuntimeImportBinding, webModuleResolverSource, type WebRuntimeData } from '../../src/components/web/moduleGraph'
import type { WebData } from '../../src/components/web/data'
import { parse } from 'acorn'
import { projectWebModuleUrls } from '../../src/components/web/resources'
import { createPreparedJavaScriptImportOptionsValidator, preparedJavaScriptNativeImportBody } from '../../src/shared/browser/validatePreparedJavaScriptImportOptions'
import { compileFunction, constants } from 'node:vm'
import { JSDOM } from 'jsdom'
import { createCompiledContentEnvironment } from '../../src/player/componentPlatform/compiledContentEnvironment'

async function publishData(data: WebData) {
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const projected = await projectWebModuleGraph({ id: 'web', definitionId: 'web', data }, input => compilation.compile(input))
  const prepared = publishedWebModuleCompilationInput(projected.data as unknown as WebRuntimeData)!
  const bundled = await compilation.compile(prepared.input)
  expect(bundled.status).toBe('ready')
  if (bundled.status !== 'ready') throw new Error(JSON.stringify(bundled.diagnostics))
  return { prepared, data: { ...(projected.data as unknown as WebRuntimeData), publishedModuleBundle: projectPublishedWebInitialization(bundled.artifact.code, prepared) } as WebRuntimeData }
}

/** Only the bounded test programs below execute; production compilation never runs author source. */
function run(data: WebRuntimeData, probe: Record<string, unknown>, document = new EventTarget()) {
  const compiled = compilePublishedWebProgram(data)
  expect(compiled.diagnostics).toEqual([])
  expect(compiled.scriptFactories).toHaveLength(1)
  const globals = { Object, Promise, Error, String, URL, setTimeout, clearTimeout, window: probe, globalThis: probe, document,
    __eventMethod: (target: Record<string, (...args: unknown[]) => unknown>, key: string) => target[key].bind(target) }
  const factory = new Function(`return (${compiled.scriptFactories[0]})`)() as (globals: unknown) => { ready: Promise<unknown[]>; startAll(isActive: ()=>boolean): Promise<unknown[]> }
  const program = factory(globals)
  expect(program.startAll(()=>true)).toBe(program.ready)
  return program.ready
}

it('retains indexed starts, TLA completion, empty and cached entries and failure retirement in one driver', async () => {
  const data = { html: '<script></script><script type="module" src="./sync.js"></script><script data-cw-defer></script><script type="module" src="./dependent.js"></script><script data-cw-defer></script><script type="module" src="./cached.js"></script><script type="module" src="./empty.js"></script><script type="module" src="./cached.js"></script>', modules: {
    'sync.js': 'import {inc} from "./shared.js";window.trace.push("module:"+document.readyState);inc();window.value++;export const seen=window.value;',
    'dependent.js': 'import {value} from "./dependency.js";window.trace.push("dependent:"+value);export const seen=value;',
    'dependency.js': 'window.trace.push("dependency:start");await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));window.trace.push("dependency:end");export const value=7;',
    'cached.js': 'import {inc,value} from "./shared.js";const __guolingPublishedWebInitialization="author";window.cachedStarts++;inc();export const seen=value;export {__guolingPublishedWebInitialization};',
    'shared.js': 'window.sharedStarts++;export let value=0;export function inc(){value++}',
    'empty.js': 'export {};',
  } }
  const before = structuredClone(data), projected = await publishData(data)
  expect(projected.prepared.initializationEntries.map(entry=>entry.index)).toEqual([1,3,5,6,7])
  expect(publishedWebInitializationBinding(projected.data.publishedModuleBundle!)).toBeDefined()
  const preparedFactory = (code: string) => {
    const result = compilePublishedScriptModule(code)
    expect(result.diagnostics).toEqual([])
    return new Function(`return (${result.factorySource})`)() as (globals: unknown)=>Record<string, any>
  }
  const factory = preparedFactory(projected.data.publishedModuleBundle!)
  const document = Object.assign(new EventTarget(), { readyState: 'interactive' })
  const probe = { trace: [] as string[], value: 0, sharedStarts: 0, cachedStarts: 0 }
  const globals = { Object, Promise, Error, window: probe, document, __eventMethod: (target: any, key: string)=>target[key].bind(target) }
  const namespace = factory(globals), program = namespace[publishedWebInitializationExport]
  expect(namespace.ready).toBe(program.ready)
  expect(probe.trace).toEqual([]) // neither factory preparation nor reading ready starts author entries.
  let complete = false
  void program.ready.then(()=>{complete=true})
  const first = program.entries[0].start(()=>true)
  await first.started
  expect(probe.trace).toEqual(['module:interactive'])
  probe.trace.push('defer:interactive'); probe.value=10
  const pending = program.entries[1].start(()=>true)
  await pending.started
  expect(probe.trace).toEqual(['module:interactive','defer:interactive','dependency:start'])
  probe.trace.push('defer-after-TLA:interactive')
  for (const entry of program.entries.slice(2)) await entry.start(()=>true).started
  expect(complete).toBe(false)
  expect(probe.value).toBe(10); expect(probe.sharedStarts).toBe(1); expect(probe.cachedStarts).toBe(1)
  expect(program.entries[0].start(()=>true).completion).toBe(first.completion)
  document.dispatchEvent(new Event('DOMContentLoaded'))
  const values = await program.ready
  expect(values.map((value: any)=>value.seen)).toEqual([1,7,2,undefined,2])
  expect(values[2]).toBe(values[4])
  expect(values[2][publishedWebInitializationExport]).toBe('author')
  expect(probe.trace).toEqual(['module:interactive','defer:interactive','dependency:start','defer-after-TLA:interactive','dependency:end','dependent:7'])
  expect(program.startAll(()=>true)).toBe(program.ready)
  expect(probe.sharedStarts).toBe(1); expect(probe.cachedStarts).toBe(1)

  const retired = factory(globals)[publishedWebInitializationExport]
  const rejected = retired.entries[0].start(()=>false)
  await rejected.started
  await expect(rejected.completion).rejects.toThrow('已退役')
  await expect(retired.ready).rejects.toThrow('已退役')
  expect(probe.sharedStarts).toBe(1)

  const recovered = publishedWebModuleCompilationInput(projected.data, {entryKeys:['1'],rejectedEntries:[{index:4,path:'failed.js',message:'closed preparation failed'}]})!
  expect(recovered.initializationEntries.map(entry=>entry.index)).toEqual([1,4])
  const compiled = await new InMemoryComponentCompilation(createEsbuildComponentCompiler()).compile(recovered.input)
  expect(compiled.status).toBe('ready')
  if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
  const recoveredProbe = { trace: [] as string[], value:0, sharedStarts:0 }
  const recoveredProgram = preparedFactory(projectPublishedWebInitialization(compiled.artifact.code,recovered))({ ...globals, window:recoveredProbe })[publishedWebInitializationExport]
  const ready = recoveredProgram.startAll(()=>true)
  await Promise.all(recoveredProgram.entries.map((entry: any)=>entry.start(()=>true).started))
  await expect(ready).rejects.toThrow('failed.js: closed preparation failed')
  expect(recoveredProbe.trace).toEqual(['module:interactive'])
  expect(recoveredProbe.sharedStarts).toBe(1)
  expect(data).toEqual(before)
})

it('starts all Web entries before settling TLA, retains one shared instance, and resolves literal lazy imports', async () => {
  const data = { html: '<script type="module" src="./a.js"></script><script type="module" src="./b.js"></script>', modules: {
    'a.js': 'import {inc,value} from "./shared.js";window.trace.push("a:start");await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));inc();window.trace.push("a:end:"+value);export async function lazy(){return (await import("./lazy.js")).value}',
    'b.js': 'import {inc,value} from "./shared.js";window.trace.push("b:start");inc();window.trace.push("b:end:"+value);',
    'shared.js': 'window.trace.push("shared:init");export let value=0;export function inc(){value++}',
    'lazy.js': 'window.lazyCount++;export const value=42;',
  } }
  const before = structuredClone(data), projected = await publishData(data)
  const probe = { trace: [] as string[], lazyCount: 0 }, document = new EventTarget()
  const ready = run(projected.data, probe, document)
  expect(ready).toBeInstanceOf(Promise)
  await Promise.resolve()
  expect(probe.trace).toEqual(['shared:init', 'a:start', 'b:start', 'b:end:1'])
  document.dispatchEvent(new Event('DOMContentLoaded'))
  const namespaces = await ready as [{ lazy(): Promise<number> }, unknown]
  expect(probe.trace).toEqual(['shared:init', 'a:start', 'b:start', 'b:end:1', 'a:end:2'])
  expect(await namespaces[0].lazy()).toBe(42)
  expect(await namespaces[0].lazy()).toBe(42)
  expect(probe.lazyCount).toBe(1)
  expect(data).toEqual(before)
})

it('keeps query/fragment module identities separate and excludes nested document entries from the published root', async () => {
  const data = { html: '<script type="module" src="./main.js"></script><iframe srcdoc="&lt;script type=&quot;module&quot; src=&quot;./child.js&quot;&gt;&lt;/script&gt;"></iframe>', modules: {
    'main.js': 'import {id as a} from "./dep.js?one#x";import {id as b} from "./dep.js?two#x";window.identities=[a,b];',
    'dep.js': 'export const id=++window.count;', 'child.js': 'window.childRan=true;',
  } }
  const before = structuredClone(data), projected = await publishData(data)
  expect(Object.values(projected.prepared.modulePaths).sort()).toEqual(['dep.js?one#x', 'dep.js?two#x', 'main.js'])
  // The independently unsupported iframe belongs to the HTML consumer; inspect
  // the exact prepared bundle through the same published root without that node.
  const probe = { count: 0, identities: [] as number[], childRan: false }
  await run({ ...projected.data, html: '<script type="module" src="./main.js"></script>' }, probe)
  expect(probe.identities).toEqual([1, 2])
  expect(probe.childRan).toBe(false)
  expect(data).toEqual(before)
})

it('uses the same compiler cache for base, duplicate and state Web snapshots without modifying author data', async () => {
  const project = createBlankCourseProjectV10('Async Web preparation')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  const data = { html: '<script type="module" src="./main.js"></script>', modules: {
    'main.js': 'await Promise.resolve();window.answer=(await import("./dep.js")).value;', 'dep.js': 'export const value=42;',
  } }
  project.instances.first = { id: 'first', definitionId: 'web', data: structuredClone(data) }
  project.instances.second = { id: 'second', definitionId: 'web', data: structuredClone(data) }
  project.surfaces[0].childIds = ['first', 'second']
  project.surfaces[0].presentation = { states: [{ id: 'state', title: 'State', overrides: { first: { data: structuredClone(data) } } }] }
  const before = structuredClone(project), compiler = createEsbuildComponentCompiler(), compile = vi.fn(compiler.compile.bind(compiler))
  const compilation = new InMemoryComponentCompilation({ ...compiler, compile })
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation })
  expect(published.diagnostics).toEqual([])
  expect(compile).toHaveBeenCalledTimes(2) // one native graph, one prepared bundle
  const base = published.payload.instances.first.data as unknown as WebRuntimeData
  const state = published.payload.surfaces[0].presentation!.states[0].overrides.first.data as unknown as WebRuntimeData
  expect(base.publishedModuleBundle).toBeTruthy()
  expect(state.publishedModuleBundle).toBe(base.publishedModuleBundle)
  for (const version of [base, state]) {
    const probe = { answer: 0 }
    await run(version, probe)
    expect(probe.answer).toBe(42)
  }
  expect(project).toEqual(before)
  expect(base.modules).toEqual(data.modules)
})

it('rejects an unclosed runtime request locally and a rejected entry does not prevent a healthy sibling from starting', async () => {
  const dynamic = await publishData({ html: '<script type="module" src="./main.js"></script>', modules: {
    'main.js': 'export async function lazy(name){return import(name)}',
  } })
  expect(compilePublishedWebProgram(dynamic.data).diagnostics).toEqual([])
  const result = compilePublishedScriptModule(dynamic.data.publishedModuleBundle!)
  expect(result.diagnostics).toEqual([])
  const namespace = new Function(`return (${result.factorySource})`)()({ Object, Promise, Error })
  const program = namespace[publishedWebInitializationExport]
  const reject = vi.fn(() => Promise.reject(new TypeError('运行时请求尚未闭合')))
  program.configureRuntimeImport({ assertActive() {}, validate: async () => {}, resolve: () => undefined, reject })
  const [entry] = await program.startAll(() => true)
  await expect(entry.lazy('./not-provided.js')).rejects.toThrow('尚未闭合')
  expect(reject).toHaveBeenCalledOnce()
  const projected = await publishData({ html: '<script type="module" src="./bad.js"></script><script type="module" src="./good.js"></script>', modules: {
    'bad.js': 'await Promise.resolve();throw new Error("local rejection");',
    'good.js': 'window.started=true;await new Promise(resolve=>setTimeout(resolve,0));window.finished=true;',
  } })
  const probe = { started: false, finished: false }
  await expect(run(projected.data, probe)).rejects.toThrow('local rejection')
  expect(probe.started).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(probe.finished).toBe(true)
})

class CounterDocument extends EventTarget {
  button = new EventTarget()
  counter = { textContent: '0' }
  querySelector(selector: string) { return selector === '#good' ? this.button : selector === '#counter' ? this.counter : undefined }
}
function localityProject(data: WebData) {
  const project = createBlankCourseProjectV10('Entry locality')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  project.instances.web = { id: 'web', definitionId: 'web', data }
  project.surfaces[0].childIds = ['web']
  return project
}

it.each(['missing-independent-package', './missing.js'])('recovers an independent entry after failed closure compilation: %s', async missing => {
  const data = { html: '<button id="good">Independent +1</button><output id="counter">0</output><script type="module" src="./bad.js"></script><script type="module" src="./good.js"></script>', modules: {
    'bad.js': `import {value} from ${JSON.stringify(missing)};window.badValue=value;`,
    'good.js': 'let counter=0;window.goodStarted=true;document.querySelector("#good").addEventListener("click",()=>document.querySelector("#counter").textContent=String(++counter));',
  } }
  const project = localityProject(data), before = structuredClone(project)
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  expect(published.offlineComplete).toBe(false)
  expect(published.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'source-compile-failed', path: expect.arrayContaining(['bad.js']) })]))
  const runtime = published.payload.instances.web.data as unknown as WebRuntimeData
  expect(runtime.publishedModuleBundle).toBeTruthy()
  expect(runtime.modules).toEqual(data.modules)
  expect(runtime.moduleGraph!.entries).toEqual({ '0': 'bad.js', '1': 'good.js' })
  const probe = { goodStarted: false }, document = new CounterDocument()
  await expect(run(runtime, probe, document)).rejects.toThrow('bad.js')
  expect(probe.goodStarted).toBe(true)
  document.button.dispatchEvent(new Event('click')); document.button.dispatchEvent(new Event('click'))
  expect(document.counter.textContent).toBe('2')
  expect(project).toEqual(before)
})

it('recovers healthy shared entries in one final bundle with one initialization and live bindings', async () => {
  const data = { html: '<button id="good">Shared +1</button><output id="counter">0</output><script type="module" src="./bad.js"></script><script type="module" src="./good.js"></script><script type="module" src="./buddy.js"></script>', modules: {
    'bad.js': 'import {value} from "./shared.js";import {missing} from "missing-independent-package";window.badValue=value+missing;',
    'good.js': 'import {inc,value} from "./shared.js";inc();window.goodStarted=true;document.querySelector("#good").addEventListener("click",()=>{inc();document.querySelector("#counter").textContent=String(value)});',
    'buddy.js': 'import {inc,value} from "./shared.js";inc();window.readLive=()=>value;',
    'shared.js': 'window.sharedInitializations++;export let value=0;export function inc(){value++}',
  } }
  const project = localityProject(data), before = structuredClone(project)
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const runtime = published.payload.instances.web.data as unknown as WebRuntimeData
  const document = new CounterDocument(), probe: { goodStarted: boolean; sharedInitializations: number; readLive?: () => number } = { goodStarted: false, sharedInitializations: 0 }
  await expect(run(runtime, probe, document)).rejects.toThrow('bad.js')
  expect(probe.goodStarted).toBe(true); expect(probe.sharedInitializations).toBe(1); expect(probe.readLive?.()).toBe(2)
  document.button.dispatchEvent(new Event('click')); document.button.dispatchEvent(new Event('click'))
  expect(document.counter.textContent).toBe('4'); expect(probe.readLive?.()).toBe(4); expect(probe.sharedInitializations).toBe(1)
  expect(runtime.moduleGraph!.entries).toEqual({ '0': 'bad.js', '1': 'good.js', '2': 'buddy.js' })
  expect(runtime.modules).toEqual(data.modules)
  expect(project).toEqual(before)
})

it('retains syntax throw stubs without treating ready error diagnostics as a failed shared bundle', async () => {
  const data = { html: '<script type="module" src="./bad.js"></script><script type="module" src="./good.js"></script>', modules: {
    'bad.js': 'export const broken = ;', 'good.js': 'window.started=true;',
  } }
  const compiler = createEsbuildComponentCompiler(), compile = vi.fn(compiler.compile.bind(compiler))
  const published = await buildPublishedCourseV3({ project: localityProject(data), assetBytes: {} }, { compilation: new InMemoryComponentCompilation({ ...compiler, compile }) })
  expect(compile).toHaveBeenCalledTimes(2) // native graph + successful shared bundle; no recovery scan
  expect(published.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'source-compile-failed', path: ['instances', 'web', 'data', 'modules', 'bad.js'] })]))
  const probe = { started: false }
  await expect(run(published.payload.instances.web.data as unknown as WebRuntimeData, probe)).rejects.toThrow('bad.js')
  expect(probe.started).toBe(true)
})

const srcdocAttribute = (html: string) => html.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

it('prepares Published provided runtime roots lazily and recovers bad target closures without changing native author entries', async () => {
  const child = '<base href="./b/"><script type="importmap">{"imports":{"provided":"./provided.js"}}</script><script type="module" src="./main.js"></script>'
  const data = { html: `<base href="./a/"><script type="importmap">{"imports":{"provided":"./provided.js"}}</script><script type="module" src="./main.js"></script><iframe srcdoc="${srcdocAttribute(child)}"></iframe>`, modules: {
    'a/main.js': 'import {value} from "../shared.js";import * as one from "./identity.js?one#x";import * as two from "./identity.js?two#x";window.startups=(window.startups??0)+1;export {one,two};export function request(path){return import(path)}export function shared(){return value}',
    'b/main.js': 'export function request(path){return import(path)}',
    './a/provided.js': 'import {inc,value} from "../shared.js";window.providedInit=(window.providedInit??0)+1;inc();export function read(){return value}export function incShared(){inc()}',
    './b/provided.js': 'window.providedInit=(window.providedInit??0)+1;export const value=17',
    'shared.js': 'window.sharedInit=(window.sharedInit??0)+1;export let value=0;export function inc(){value++}',
    'a/identity.js': 'window.identityInit=(window.identityInit??0)+1;export const id=window.identityInit',
    'broken.js': 'import {missing} from "absent-provided-package";window.brokenInit=1;export const value=missing',
    'syntax.js': 'export const broken=;',
    'theme.css': 'p{color:rgb(1,2,3)}',
    'late.js': 'window.lateInit=(window.lateInit??0)+1;export const value=99',
  } }
  const project = localityProject(data), before = structuredClone(project), compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const author = await projectWebModuleGraph(project.instances.web, input => compilation.compile(input))
  const original = (author.data as unknown as WebRuntimeData).moduleGraph!
  expect(original.modules['a/provided.js']).toBeUndefined()
  expect(original.modules['__guoling_parser_doc_0/b/provided.js']).toBeUndefined()
  expect(original.runtimeRoots).toBeUndefined()
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation })
  const runtime = published.payload.instances.web.data as unknown as WebRuntimeData
  expect(published.offlineComplete).toBe(false) // exact unsupported bad files remain explicit diagnostics.
  expect(published.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'source-compile-failed', path: expect.arrayContaining(['broken.js']) }),
    expect.objectContaining({ code: 'source-compile-failed', path: expect.arrayContaining(['syntax.js']) }),
  ]))
  expect(runtime.moduleGraph!.entries).toEqual(original.entries)
  expect(runtime.moduleGraph!.runtimeRoots!['']).toContain('a/provided.js')
  expect(runtime.moduleGraph!.runtimeRoots!['0']).toContain('__guoling_parser_doc_0/b/provided.js')
  const childPrepared = publishedWebModuleCompilationInput(runtime, { documentPath: '0' })!
  expect(childPrepared.runtimeImports!.contexts['__guoling_parser_doc_0/b/provided.js']).toEqual({
    importer: 'b/provided.js', namespace: '__guoling_parser_doc_0/', bindings: { provided: 'b/provided.js' },
  })
  expect(runtime.publishedDocumentBundles!['0']).toBeTruthy()
  const compiled = compilePublishedWebProgram(runtime)
  expect(compiled.diagnostics).toEqual([])
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://producer-test.invalid/' })
  // No options are used here. The mature constructor captures its software URL
  // ports; a request must not create a dummy module lease for undefined options.
  const createUrl = vi.fn(() => 'data:text/javascript,export%20%7B%7D')
  dom.window.URL.createObjectURL = createUrl; dom.window.URL.revokeObjectURL = vi.fn()
  const controller = new AbortController(), events: unknown[] = []
  const context: any = { root: dom.window.document.getElementById('root'), instance: { id: 'web', definitionId: 'web', data: {} },
    scope: { signal: controller.signal, isActive: () => !controller.signal.aborted,
      events: { emit(type: string, payload: unknown) { events.push({ type, payload }) } }, state: { get() {}, set() {} } } }
  const env = createCompiledContentEnvironment(context, { html: compiled.html, css: compiled.css })
  let program: any
  try {
    const factories = compiled.scriptFactories.map(source => new Function(`return (${source})`)())
    await env.initialize(factories.map(factory => globals => { program = factory(globals); return program }), {
      classicPrograms: compiled.classicPrograms.map(entry => ({ ...entry, activate: new Function(`return (${entry.factorySource})`)() })),
      handlerFactories: compiled.handlerFactories.map(source => new Function(`return (${source})`)()),
    })
    const [entry] = await program.ready
    expect(program.entries.map((entry: any) => entry.index)).toEqual([1])
    expect(env.globals.startups).toBe(1)
    expect(env.globals.providedInit).toBeUndefined(); expect(env.globals.lateInit).toBeUndefined()
    const provided = await entry.request('provided')
    expect(await entry.request('./provided.js')).toBe(provided)
    expect(env.globals.providedInit).toBe(1); expect(env.globals.sharedInit).toBe(1)
    expect(provided.read()).toBe(1); provided.incShared(); expect(entry.shared()).toBe(2)
    expect(entry.one).not.toBe(entry.two)
    expect(await entry.request('./identity.js?one#x')).toBe(entry.one)
    expect(await entry.request('./identity.js?two#x')).toBe(entry.two)
    const css = await entry.request('../theme.css')
    expect(typeof css.default).toBe('string')
    await expect(entry.request('../broken.js')).rejects.toThrow('absent-provided-package')
    await expect(entry.request('../syntax.js')).rejects.toThrow('syntax.js')
    expect(env.globals.brokenInit).toBeUndefined()
    expect(await entry.request('provided')).toBe(provided)
    await expect(entry.request('./missing.js')).rejects.toThrow('未闭合')
    expect(events).toHaveLength(1)
    const pending = entry.request('../late.js'); controller.abort()
    await expect(pending).rejects.toThrow('已结束'); expect(env.globals.lateInit).toBeUndefined()
    expect(createUrl).not.toHaveBeenCalled()
    expect(project).toEqual(before)
  } finally { controller.abort(); env.dispose(); dom.window.close() }
})

it('resolves runtime requests in the same prepared namespace with lazy targets, document bindings and retirement guards', async () => {
  const child = '<base href="./b/"><script type="importmap">{"imports":{"chosen":"./known.js"}}</script><script type="module" src="./main.js"></script>'
  const data = { html: `<base href="./a/"><script type="importmap">{"imports":{"chosen":"./known.js"}}</script><script type="module" src="./main.js"></script><iframe srcdoc="${srcdocAttribute(child)}"></iframe>`, modules: {
    'a/main.js': 'import * as known from "chosen";import {value} from "../shared.js";const reserved="guoling:request-prepared-js:0";export {known,reserved};export function request(path,options){return import(path,options)}export function lazy(){return import("./lazy.js")}export function late(){return import("./late.js")}export function failed(){return import("./failed.js")}export function undefinedFile(){return import("../undefined")}export function shared(){return value}',
    'b/main.js': 'import * as known from "chosen";export {known};export function request(path,options){return import(path,options)}',
    'a/known.js': 'window.knownStarts++;export const value=7',
    'b/known.js': 'window.knownStarts++;export const value=17',
    'shared.js': 'window.sharedStarts++;export let value=0;export function inc(){value++}',
    'a/lazy.js': 'import {inc,value} from "../shared.js";window.lazyStarts++;inc();export const seen=value',
    'a/late.js': 'window.lateStarts++;export const value=99',
    'a/failed.js': 'window.failedStarts++;throw new Error("prepared target failed");export const value=0',
    'a/provided-only.js': 'window.notClosedStarts++;export const value=123',
    'undefined': 'window.undefinedStarts++;export const value=456',
  } }
  const before = structuredClone(data), cache = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const projected = await projectWebModuleGraph({ id: 'web', definitionId: 'web', data }, input => cache.compile(input))
  const runtime = projected.data as unknown as WebRuntimeData
  const instantiate = async (documentPath: string) => {
    const prepared = publishedWebModuleCompilationInput(runtime, { documentPath })!
    const compiled = await cache.compile(prepared.input)
    expect(compiled.status).toBe('ready')
    if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
    const code = projectPublishedWebInitialization(compiled.artifact.code, prepared)
    expect(publishedWebRuntimeImportBinding(code)).toBeDefined()
    const source = compilePublishedScriptModule(code)
    expect(source.diagnostics).toEqual([])
    const probe = { knownStarts: 0, sharedStarts: 0, lazyStarts: 0, lateStarts: 0, failedStarts: 0, undefinedStarts: 0 }
    const namespace = new Function(`return (${source.factorySource})`)()({ Object, Promise, Error, window: probe })
    const program = namespace[publishedWebInitializationExport]
    let active = true, created = 0, revoked = 0
    class SoftwareURL extends URL {
      static createObjectURL() { created++; return 'data:text/javascript,export%20%7B%7D' }
      static revokeObjectURL() { revoked++ }
    }
    // Vitest's VM Function has no dynamic-import callback. The existing fixed
    // software primitive uses Node's real loader for this empty data module.
    const nativeImport = compileFunction(preparedJavaScriptNativeImportBody, ['url', 'options'],
      { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }) as (url: string, options: unknown) => Promise<unknown>
    const validator = createPreparedJavaScriptImportOptionsValidator({ Blob, URL: SoftwareURL, TypeError }, () => active, nativeImport)
    const validate = vi.fn(validator.validate), reject = vi.fn(() => Promise.reject(new TypeError('当前运行时请求尚未闭合')))
    // Serialize the actual producer factory as the child consumer must do. No
    // module loader or binding rule is replaced by this software port.
    const resolver = new Function(`return ${webModuleResolverSource()}`)()({ URL, decodeURI }) as ReturnType<typeof createWebModuleResolver>
    program.configureRuntimeImport({ assertActive: validator.assertActive, validate,
      resolve: (specifier: string, key: string) => {
        const context = prepared.runtimeImports!.contexts[key]
        return context && resolver(specifier, context.importer, false, context)
      }, reject })
    const [entry] = await program.startAll(() => active)
    return { entry, prepared, probe, validate, reject, retired() { active = false }, dispose: validator.dispose,
      leases: () => ({ created, revoked }) }
  }
  const root = await instantiate(''), nested = await instantiate('0')
  try {
    expect(root.prepared.runtimeImports!.operation).toBe('guoling:request-prepared-js:1')
    expect(nested.prepared.runtimeImports!.contexts).toEqual(expect.objectContaining({
      '__guoling_parser_doc_0/b/main.js': { importer: 'b/main.js', namespace: '__guoling_parser_doc_0/', bindings: { chosen: 'b/known.js' } },
    }))
    expect(root.entry.reserved).toBe('guoling:request-prepared-js:0')
    expect(root.probe).toEqual({ knownStarts: 1, sharedStarts: 1, lazyStarts: 0, lateStarts: 0, failedStarts: 0, undefinedStarts: 0 })
    expect(nested.probe.knownStarts).toBe(1)
    expect(await root.entry.request('chosen')).toBe(root.entry.known)
    expect(await root.entry.request('./known.js')).toBe(root.entry.known)
    expect(await nested.entry.request('chosen')).toBe(nested.entry.known)
    expect(await nested.entry.request('./known.js')).toBe(nested.entry.known)
    expect(root.entry.known.value).toBe(7); expect(nested.entry.known.value).toBe(17)
    expect(root.entry.known).not.toBe(nested.entry.known)
    expect(root.validate).not.toHaveBeenCalled() // undefined options have no attributes to validate.
    const lazy = await root.entry.request('./lazy.js')
    expect(await root.entry.request('./lazy.js')).toBe(lazy)
    expect(await root.entry.lazy()).toBe(lazy)
    expect(await root.entry.request('./lazy.js', { with: {} })).toBe(lazy)
    expect(root.probe.lazyStarts).toBe(1); expect(root.probe.sharedStarts).toBe(1)
    expect(root.entry.shared()).toBe(1)
    await expect(root.entry.request('./failed.js')).rejects.toThrow('prepared target failed')
    expect(root.probe.failedStarts).toBe(1)
    expect(await root.entry.request('chosen', {})).toBe(root.entry.known)
    await expect(root.entry.request('./provided-only.js')).rejects.toThrow('尚未闭合')
    await expect(root.entry.request('./missing.js')).rejects.toThrow('尚未闭合')
    await expect(root.entry.request('unmapped-bare-request')).rejects.toThrow('尚未闭合')
    expect(root.probe.undefinedStarts).toBe(0)
    expect(root.reject).toHaveBeenCalledTimes(3)
    expect(runtime.moduleGraph!.modules['a/provided-only.js']).toBeUndefined()
    await expect(root.entry.request('./late.js', { with: { type: 'json' } })).rejects.toThrow()
    expect(root.probe.lateStarts).toBe(0)
    // No-options call has already selected a thunk, but has not invoked its
    // real initializer yet. The actual initializer guard must stop it.
    const pending = root.entry.request('./late.js')
    root.retired()
    await expect(pending).rejects.toThrow('已结束')
    expect(root.probe.lateStarts).toBe(0)
    expect(root.leases()).toEqual({ created: 3, revoked: 3 })
    expect(data).toEqual(before)
  } finally { root.dispose(); nested.dispose() }
})

it('prepares native child document bundles from original parser slots with isolated shared state and retained resources', async () => {
  const child = '<script type="application/json">{"data":true}</script><script type="module" src="./child.js"></script><script type="module" src="./buddy.js"></script><img src="cw-resource:dot">'
  const html = `<script type="application/json">{}</script><script type="module" src="./root.js"></script><script type="module" src="./buddy.js"></script><iframe></iframe><template><iframe srcdoc="${srcdocAttribute(child)}"></iframe></template><iframe srcdoc="${srcdocAttribute(child)}"></iframe><iframe sandbox srcdoc="${srcdocAttribute(child)}"></iframe><iframe src="about:blank" srcdoc="${srcdocAttribute(child)}"></iframe><iframe srcdoc="${srcdocAttribute(child + '<iframe></iframe>')}"></iframe><iframe srcdoc="<p>no module</p>"></iframe>`
  const data = { html, resourceBindings: { 'cw-resource:dot': 'dot' }, modules: {
    'root.js': 'import {inc,value} from "./shared.js";inc();globalThis.live=()=>value;globalThis.increment=()=>inc();globalThis.resourceToken="cw-resource:dot";',
    'child.js': 'import {inc,value} from "./shared.js";inc();const top={value:5};const window={value:7};globalThis.localSum=top.value+window.value;globalThis.live=()=>value;globalThis.increment=()=>inc();globalThis.resourceToken="cw-resource:dot";',
    'buddy.js': 'import {inc} from "./shared.js";inc();',
    'shared.js': 'globalThis.initializations++;export let value=0;export function inc(){return ++value}',
  } }
  expect(publishedWebModuleDocumentPaths(data)).toEqual(['1', '3', '5'])
  const project = localityProject(data), bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="blue"/></svg>')
  project.assets.dot = { id: 'dot', kind: 'image', path: 'assets/dot.svg', filename: 'dot.svg', mimeType: 'image/svg+xml', byteLength: bytes.length }
  const before = structuredClone(project), published = await buildPublishedCourseV3({ project, assetBytes: { dot: bytes } }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  expect(published.diagnostics).toEqual([])
  const runtime = published.payload.instances.web.data as unknown as WebRuntimeData
  expect(runtime.publishedModuleBundle).toBeTruthy(); expect(Object.keys(runtime.publishedDocumentBundles!)).toEqual(['1', '3'])
  expect(runtime.moduleGraph!.entries['3:1']).toBe('child.js') // srcdoc takes precedence over src="about:blank".
  expect(runtime.moduleGraph!.entries['1:1']).toBe('child.js'); expect(runtime.moduleGraph!.entries['1:2']).toBe('buddy.js')
  expect(runtime.moduleGraph!.entries['0:0']).toBeUndefined(); expect(runtime.moduleGraph!.entries['1:0']).toBeUndefined()
  expect(publishedWebModuleCompilationInput(runtime)!.modulePaths).not.toEqual(expect.objectContaining({ '__published_module_0.js': 'child.js' }))
  expect(Object.values(publishedWebModuleCompilationInput(runtime, { documentPath: '1' })!.modulePaths).sort()).toEqual(['buddy.js', 'child.js', 'shared.js'])
  expect(published.payload.assets.dot.url).toMatch(/^data:image\/svg\+xml;base64,/)
  expect(runtime.resourceBindings).toEqual(data.resourceBindings); expect(runtime.publishedDocumentBundles!['1']).toContain('cw-resource:dot')
  const root: { initializations: number; live?: () => number; increment?: () => number; localSum?: number } = { initializations: 0 }, nested = { initializations: 0 } as typeof root
  // Producer/module-factory scope proof only. The final native HTML consumer is
  // covered separately; unsupported placeholder frames are not admitted here.
  await run({ ...runtime, html: '<script type="module"></script>' }, root)
  await run({ ...runtime, html: '<script type="module"></script>', publishedModuleBundle: runtime.publishedDocumentBundles!['1'] }, nested)
  expect(root.initializations).toBe(1); expect(nested.initializations).toBe(1); expect(root.live?.()).toBe(2); expect(nested.live?.()).toBe(2)
  expect(nested.localSum).toBe(12); expect(root.localSum).toBeUndefined(); expect(root.increment?.()).toBe(3); expect(nested.live?.()).toBe(2)
  expect(runtime.html).toBe(data.html); expect(runtime.modules).toEqual(data.modules); expect(project).toEqual(before)
})

it('orders native child entries by local numeric script suffix and preserves the document path during entry recovery', () => {
  const data: WebRuntimeData = { html: '', moduleGraph: { entries: { '1:10': 'b.js', '1:2': 'a.js', '0': 'root.js' }, modules: {
    'a.js': { code: 'export const a=1;', imports: [] }, 'b.js': { code: 'export const b=2;', imports: [] }, 'root.js': { code: 'export const root=3;', imports: [] },
  } } }
  const prepared = publishedWebModuleCompilationInput(data, { documentPath: '1', entryKeys: ['1:10', '1:2'] })!
  expect(prepared.input.files[prepared.input.entry]).toBe(publishedWebInitializationSource([
    {index:2,loadSource:'begin=>import("./__published_module_0.js")'},
    {index:10,loadSource:'begin=>import("./__published_module_1.js")'},
  ])+`\nexport {ready,${publishedWebInitializationExport}};`)
  expect(prepared.initializationEntries).toEqual([{index:2,file:'__published_module_0.js'},{index:10,file:'__published_module_1.js'}])
  expect(Object.values(prepared.modulePaths)).toEqual(['a.js', 'b.js'])
  expect(Object.values(publishedWebModuleCompilationInput(data)!.modulePaths)).toEqual(['root.js'])
})

it('recovers a native child failed entry through the same compiler without adding a root artifact', async () => {
  const child = '<script type="application/json">{}</script><script type="module" src="./bad.js"></script><script type="module" src="./good.js"></script>'
  const data = { html: `<iframe></iframe><iframe srcdoc="${srcdocAttribute(child)}"></iframe>`, modules: {
    'bad.js': 'import {missing} from "missing-child-package";globalThis.bad=missing;',
    'good.js': 'let value=0;window.goodStarted=true;document.querySelector("#good").addEventListener("click",()=>document.querySelector("#counter").textContent=String(++value));',
  } }
  const project = localityProject(data), before = structuredClone(project)
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const runtime = published.payload.instances.web.data as unknown as WebRuntimeData
  expect(runtime.publishedModuleBundle).toBeUndefined(); expect(Object.keys(runtime.publishedDocumentBundles!)).toEqual(['1'])
  expect(runtime.moduleGraph!.entries).toEqual({ '1:1': 'bad.js', '1:2': 'good.js' })
  expect(published.offlineComplete).toBe(false); expect(published.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'source-compile-failed', path: expect.arrayContaining(['bad.js']) })]))
  const document = new CounterDocument(), probe = { goodStarted: false }
  await expect(run({ ...runtime, html: '<script type="module"></script>', publishedModuleBundle: runtime.publishedDocumentBundles!['1'] }, probe, document)).rejects.toThrow('bad.js')
  expect(probe.goodStarted).toBe(true); document.button.dispatchEvent(new Event('click')); expect(document.counter.textContent).toBe('1')
  expect(runtime.modules).toEqual(data.modules); expect(runtime.html).toBe(data.html); expect(project).toEqual(before)
})

it('projects fixed import.meta url properties through the graph owner without capturing other metadata', async () => {
  const data = { html: '<script type="module" src="./meta.js?one#scope"></script>', modules: {
    'meta.js': `export function dot(){return import.meta.url}
      export function fixed(){return import.meta['url']}
      export function localTarget(){return new URL('./known.js?worker#target',import.meta['url'])}
      function Constructor(){this.seen=new.target.url}Constructor.url='constructor-sentinel';
      export function constructorUrl(){return new Constructor().seen}`,
    'known.js': 'export const value=7',
  } }
  const before = structuredClone(data), projected = await publishData(data)
  const graph = projected.data.moduleGraph!, module = graph.modules['meta.js?one#scope']!
  expect(module.moduleUrls).toEqual(['known.js?worker#target'])
  expect(graph.modules['known.js?worker#target']).toBeDefined()
  expect(Object.values(projected.prepared.modulePaths).sort()).toEqual(['known.js?worker#target', 'meta.js?one#scope'])
  expect(module.code).toContain('new.target.url')
  expect(module.code).not.toContain('import.meta')
  const withMap = projectWebModuleUrls(module.code, 'softwareModuleUrls')
  expect(withMap).toContain('softwareModuleUrls["known.js?worker#target"]')
  expect(withMap).not.toContain('guoling-module-url:')
  const [namespace] = await run(projected.data, {}) as [{ dot(): string; fixed(): string; constructorUrl(): string }]
  expect(namespace.dot()).toBe('https://guoling.local/meta.js?one#scope')
  expect(namespace.fixed()).toBe(namespace.dot())
  expect(namespace.constructorUrl()).toBe('constructor-sentinel')
  expect(data).toEqual(before)

  const unsupported = { html: '<script type="module" src="./dynamic.js"></script>', modules: {
    'dynamic.js': `export function dynamic(url){return import.meta[url]}
      export function object(){return import.meta}
      export function reserved(){return import.meta['guoling:validate-prepared-js-options:0']}`,
  } }
  const dynamic = await publishData(unsupported), source = dynamic.data.moduleGraph!.modules['dynamic.js']!.code
  const properties: unknown[] = []
  const visit = (node: any): void => {
    if (node.type === 'MemberExpression' && node.object.type === 'MetaProperty')
      properties.push({ type: node.property.type, name: node.property.name, value: node.property.value })
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(item => { if (item && typeof item === 'object' && 'type' in item) visit(item) })
      else if (value && typeof value === 'object' && 'type' in value) visit(value)
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }))
  expect(properties).toEqual([{ type: 'Identifier', name: 'url', value: undefined }, { type: 'Literal', name: undefined, value: 'guoling:validate-prepared-js-options:0' }])
  expect(source).toContain('return import.meta;')
  const blocked = compilePublishedWebProgram(dynamic.data)
  expect(blocked.scriptFactories).toEqual([])
  expect(blocked.diagnostics).toHaveLength(3)
  expect(blocked.diagnostics.every(issue => issue.code === 'dynamic-module' && issue.blocking !== false)).toBe(true)
})

it('retains mutable fixed metadata URL references across writes, modules and early cyclic reads', async () => {
  const data = { html: '<script type="module" src="./a.js"></script><script type="module" src="./c.js"></script><script type="module" src="./field.js"></script>', modules: {
    'a.js': `#!/usr/bin/env node
      import {before,after} from './peer.js';
      const __guoling_meta_url_cell0='author-cell',__guoling_meta_url_get0='author-getter';
      export function privateNames(){return [__guoling_meta_url_cell0,__guoling_meta_url_get0]}
      export function read(){return import.meta.url}
      export function fixed(){return import.meta['url']}
      export function set(value){return import.meta['url']=value}
      export function once(next){return import.meta.url=next()}
      export function relative(){return new URL('./asset.js',import.meta['url']).href}
      export function pattern(value){({value:import.meta.url}={value});return import.meta.url}
      export function loop(values){for([import.meta['url']] of values){}return import.meta.url}
      export function keys(){for(import.meta.url in {first:1,last:2}){}return import.meta.url}
      export function increment(){return import.meta.url++}
      export function remove(){return delete import.meta['url']}
      window.cycle={before,after};`,
    'peer.js': `import {read,set} from './a.js';export const before=read();set('https://cycle.example/start.js');export const after=read();`,
    'c.js': `export function read(){return import.meta['url']}export function set(value){return import.meta.url=value}`,
    'field.js': `export function dormantField(){import.meta.url.extra=1}export function read(){return import.meta.url}`,
  } }
  const before = structuredClone(data), projected = await publishData(data), graph = projected.data.moduleGraph!
  expect(graph.modules['a.js'].code.startsWith('#!/usr/bin/env node\n')).toBe(true)
  expect(() => parse(graph.modules['a.js'].code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })).not.toThrow()
  expect(graph.modules['a.js'].moduleUrls).toBeUndefined()
  expect(graph.modules['a.js'].code).toContain('new URL("./asset.js",')
  expect(graph.modules['a.js'].code).not.toContain('guoling-module-url:')
  const fieldTree = parse(graph.modules['field.js'].code, { ecmaVersion: 'latest', sourceType: 'module' }) as any
  const fieldDeclaration = fieldTree.body.map((node: any) => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .find((node: any) => node?.type === 'FunctionDeclaration' && node.id?.name === 'dormantField')
  const fieldWrite = fieldDeclaration.body.body[0].expression
  expect(fieldWrite.left.object.type).toBe('Literal')
  expect(fieldWrite.left.object.value).toBe('https://guoling.local/field.js')
  const probe: {cycle?: {before: string; after: string}} = {}
  const [a,c,field] = await run(projected.data, probe) as [
    {read(): unknown; fixed(): unknown; set(value: unknown): unknown; once(next: ()=>unknown): unknown; relative(): string; pattern(value: unknown): unknown; loop(values: unknown[][]): unknown; keys(): unknown; increment(): number; remove(): boolean; privateNames(): string[]},
    {read(): unknown; set(value: unknown): unknown}, {read(): string},
  ]
  expect(probe.cycle).toEqual({before:'https://guoling.local/a.js',after:'https://cycle.example/start.js'})
  expect(a.read()).toBe('https://cycle.example/start.js')
  expect(a.fixed()).toBe(a.read())
  expect(c.read()).toBe('https://guoling.local/c.js')
  expect(field.read()).toBe('https://guoling.local/field.js')
  expect(a.privateNames()).toEqual(['author-cell','author-getter'])
  let calls=0
  expect(a.once(()=>{calls++;return 'https://changed.example/dir/main.js'})).toBe('https://changed.example/dir/main.js')
  expect(calls).toBe(1)
  expect(a.fixed()).toBe('https://changed.example/dir/main.js')
  expect(a.relative()).toBe('https://changed.example/dir/asset.js')
  expect(c.set('other-module')).toBe('other-module')
  expect(a.read()).toBe('https://changed.example/dir/main.js')
  expect(a.pattern('pattern-value')).toBe('pattern-value')
  expect(a.loop([['first-value'],['last-value']])).toBe('last-value')
  expect(a.keys()).toBe('last')
  expect(a.set(7)).toBe(7)
  expect(a.increment()).toBe(7)
  expect(a.read()).toBe(8)
  expect(a.remove()).toBe(true)
  expect(a.fixed()).toBeUndefined()
  expect(a.set('restored')).toBe('restored')
  expect(a.read()).toBe('restored')
  expect(c.read()).toBe('other-module')
  expect(data).toEqual(before)
})
