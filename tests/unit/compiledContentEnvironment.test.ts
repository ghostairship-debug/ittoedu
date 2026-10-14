// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { expect, it } from 'vitest'
import { compilePublishedScriptModule, compilePublishedWebProgram } from '../../src/core/publish/componentPlatform/compiledScript'
import { parse, serialize } from 'parse5'
import { createCompiledClassicGlobals } from '../../src/player/componentPlatform/compiledContentEnvironment'
import { parse as parseJavaScript } from 'acorn'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import type { WebRuntimeData } from '../../src/components/web/moduleGraph'
import { projectWebModuleGraph, publishedWebRuntimeImportBinding } from '../../src/components/web/moduleGraph'

function activateBlockingPrograms(output: ReturnType<typeof compilePublishedWebProgram>, globals: Record<string, unknown>): void {
  const window = globals.window as Record<string, unknown>
  const base = new Proxy(globals, { get: (target, name) => Reflect.has(target, name) ? Reflect.get(target, name) : Reflect.get(window, name), set: (_target, name, value) => Reflect.set(window, name, value) })
  const shared = createCompiledClassicGlobals(base)
  for (const program of output.classicPrograms) if (program.kind === 'blocking') Function(`return (${program.factorySource})`)()(shared)
}

it('loads provided runtime modules lazily in the original Root and native child context', async () => {
  const source = (target:string) => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:">
    <script type="importmap">${JSON.stringify({imports:{chosen:`./${target}/known.js`}})}</script>
    <script>window.URL=function(){throw new Error('author-URL')};</script><script type="module" src="./a/main.js"></script>`
  const data={html:`${source('a')}<iframe id="child" srcdoc="${source('b').replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`,modules:{
    'a/main.js':`import * as known from 'chosen';window.staticNamespace=known;
      window.request=(path,options)=>import(path,options);window.literalKnown=()=>import('./known.js');
      window.literalOptions=options=>import('chosen',options);
      window.ready=true;`,
    'a/known.js':'window.aInit=(window.aInit||0)+1;export let value=7;export function inc(){value++}',
    'b/known.js':'window.bInit=(window.bInit||0)+1;export let value=17;export function inc(){value++}',
    'a/lazy.js':'window.lazyInit=(window.lazyInit||0)+1;export const value=41;',
    'a/late.js':'window.lateInit=(window.lateInit||0)+1;export const value=99;',
    'provided.js':'window.providedInit=1;export const value=88;',
    'unused-broken.js':'import value from "not-provided";window.brokenInit=1;export {value}',
    'unused-syntax.js':'export const incomplete=',
  }}
  const project=createBlankCourseProjectV10('Runtime import context')
  project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'}}
  project.instances.web={id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const original=structuredClone(data)
  const compilation=new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const author=await projectWebModuleGraph(project.instances.web,input=>compilation.compile(input))
  expect(Object.hasOwn((author.data as unknown as WebRuntimeData).moduleGraph!.modules,'a/lazy.js')).toBe(false)
  expect(Object.hasOwn((author.data as unknown as WebRuntimeData).moduleGraph!.modules,'provided.js')).toBe(false)
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation})
  expect(published.diagnostics.some(issue=>issue.message.includes('not-provided'))).toBe(true)
  expect(published.diagnostics.some(issue=>issue.message.includes('unused-syntax.js'))).toBe(true)
  expect(data).toEqual(original)
  // Use the actual serialized native-import primitive rather than Vitest's dynamic-import shim.
  const producer=await build({stdin:{contents:"export {compilePublishedWebProgram} from './src/core/publish/componentPlatform/compiledScript'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',target:'es2022'})
  const consumer={exports:{} as {compilePublishedWebProgram:typeof compilePublishedWebProgram}}
  Function('module','exports',producer.outputFiles[0].text)(consumer,consumer.exports)
  const output=consumer.exports.compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.diagnostics).toEqual([]);expect(output.scriptFactories).toHaveLength(1)
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try{
    const context=await browser.newContext({offline:true}),page=await context.newPage(),errors:string[]=[],requests:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())})
    await page.setContent('<!doctype html><main id="root"></main>');await page.addScriptTag({content:bundle.outputFiles[0].text})
    await page.evaluate(async output=>{
      const runtime=(window as any).CompiledProbe,events:any[]=[];let active=true
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'runtime-context'},scope:{isActive:()=>active,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:output.classicPrograms.map(program=>({index:program.index,kind:program.kind,activate:Function(`return (${program.factorySource})`)()})),handlerFactories:[]})
      ;(window as any).runtimeContextProbe={env,events,retire:()=>{active=false}}
    },output)
    await page.waitForFunction(()=>(window as any).runtimeContextProbe.env.root.querySelector('#child').contentWindow.ready===true)
    const observed=await page.evaluate(async()=>{
      const probe=(window as any).runtimeContextProbe,root=probe.env.globals,child=probe.env.root.querySelector('#child').contentWindow,results:any[]=[]
      for(const target of [root,child]){
        const initial={a:target.aInit??0,b:target.bInit??0,lazy:target.lazyInit??0},alias=await target.request('chosen'),relative=await target.request('./known.js'),literal=await target.literalKnown()
        const lazy=await target.request('./lazy.js'),lazyAgain=await target.request('./lazy.js'),options=await target.literalOptions({}),provided=await target.request('../provided.js')
        alias.inc();const json=await target.request('chosen',{with:{type:'json'}}).then(()=>'',(error:any)=>error.name)
        const bad=await target.request('../unused-broken.js').then(()=>'',(error:any)=>error.message),syntax=await target.request('../unused-syntax.js').then(()=>'',(error:any)=>error.message)
        results.push({initial,value:alias.value,same:alias===target.staticNamespace&&alias===options,relative:relative.value,relativeSame:relative===literal,lazy:lazy.value,lazySame:lazy===lazyAgain,a:target.aInit,b:target.bInit??0,lazyInit:target.lazyInit,json,provided:provided.value,providedInit:target.providedInit,bad:bad.includes('not-provided'),syntax:syntax.includes('unused-syntax.js'),brokenInit:target.brokenInit??0,healthyAfterFailure:await target.request('chosen')===alias})
      }
      const missing=await root.request('./missing.js').then(()=>'',(error:any)=>error.name),before=probe.events.length
      // Resolve without options: the target's actual import microtask must still check retirement.
      const late=root.request('./late.js');probe.retire();const retired=await late.then(()=>'',(error:any)=>error.name)
      const final={lateInit:root.lateInit??0,providedInit:root.providedInit??0,before,after:probe.events.length,retired,missing}
      probe.env.dispose();return {results,final,outer:{...document.body.dataset},online:navigator.onLine}
    })
    expect(observed.results).toEqual([
      {initial:{a:1,b:0,lazy:0},value:8,same:true,relative:8,relativeSame:true,lazy:41,lazySame:true,a:1,b:0,lazyInit:1,json:'TypeError',provided:88,providedInit:1,bad:true,syntax:true,brokenInit:0,healthyAfterFailure:true},
      {initial:{a:0,b:1,lazy:0},value:18,same:true,relative:7,relativeSame:true,lazy:41,lazySame:true,a:1,b:1,lazyInit:1,json:'TypeError',provided:88,providedInit:1,bad:true,syntax:true,brokenInit:0,healthyAfterFailure:true},
    ])
    expect(observed.final).toMatchObject({lateInit:0,providedInit:1,before:1,after:1,missing:'TypeError'});expect(observed.final.retired).not.toBe('')
    expect(observed.outer).toEqual({});expect(observed.online).toBe(false);expect(errors).toEqual([]);expect(requests).toEqual([])
  }finally{await browser.close()}
},30000)

it('starts prepared module and defer in source order without awaiting dependency TLA', async () => {
  const data = { html: `<script>window.trace=[];window.mixedValue=0;document.addEventListener('DOMContentLoaded',()=>window.trace.push('DCL:'+document.readyState));window.addEventListener('load',()=>window.trace.push('load:'+document.readyState));</script>
    <script type="module" src="./sync.js"></script>
    <script id="deferred" data-cw-defer>window.trace.push('defer:'+document.readyState);window.deferScript=document.currentScript.id;window.mixedValue=10;</script>
    <script>window.trace.push('inline-tail:'+document.readyState)</script>
    <script type="module" src="./dependent.js"></script>
    <script data-cw-defer>window.trace.push('after-defer:'+document.readyState)</script>
    <script type="module" src="./tail.js"></script>`, modules: {
      'sync.js': 'import {inc} from "./shared.js";inc();window.trace.push("module:"+document.readyState);window.moduleScript=document.currentScript;window.mixedValue++;',
      'dependent.js': 'import {value} from "./dependency.js";window.trace.push("dependent:"+value);window.dependent=value;',
      'dependency.js': 'window.trace.push("dependency:start");await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));window.trace.push("dependency:end");export const value=7;',
      'tail.js': 'import {inc,value} from "./shared.js";inc();window.sharedValue=value;window.trace.push("tail:"+document.readyState);',
      'shared.js': 'window.sharedInit=(window.sharedInit||0)+1;export let value=0;export function inc(){value++}',
    } }
  const project=createBlankCourseProjectV10('Module/defer source order')
  project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'}}
  project.instances.web={id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  expect(published.diagnostics).toEqual([])
  const output=compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.diagnostics).toEqual([]);expect(output.scriptFactories).toHaveLength(1)
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
    await page.setContent('<!doctype html><main id="outer"></main>');await page.addScriptTag({content:bundle.outputFiles[0].text})
    const observed=await page.evaluate(async output=>{
      const runtime=(window as any).CompiledProbe,events:any[]=[]
      const make=(id:string)=>{const root=document.createElement('section');document.getElementById('outer')!.append(root);return runtime.createCompiledContentEnvironment({root,instance:{id,definitionId:'web',data:{}},scope:{signal:new AbortController().signal,isActive:()=>true,events:{emit(type:string,payload:any){events.push({type,...payload})}},state:{get(){},set(){}}}},output)}
      const prepare={classicPrograms:output.classicPrograms.map(program=>({index:program.index,kind:program.kind,activate:Function(`return (${program.factorySource})`)()})),handlerFactories:output.handlerFactories.map(code=>Function(`return (${code})`)())}
      const factories=output.scriptFactories.map(code=>Function(`return (${code})`)()),env=make('normal')
      await env.initialize(factories,prepare)
      const normal={trace:[...env.globals.trace],value:env.globals.mixedValue,dependent:env.globals.dependent,sharedInit:env.globals.sharedInit,sharedValue:env.globals.sharedValue,deferScript:env.globals.deferScript,moduleScript:env.globals.moduleScript,ready:env.globals.document.readyState};env.dispose()
      const retired=make('retired');let completion:Promise<unknown>|undefined
      const retireAtStart=(globals:any)=>{
        const program=factories[0](globals);completion=program.ready
        const first=program.entries[0],start=first.start
        first.start=(isActive:()=>boolean)=>{const result=start(isActive);retired.dispose();return result}
        return program
      }
      await retired.initialize([retireAtStart],prepare)
      const failure=await completion!.then(()=>'',error=>String(error))
      return {normal,retired:{trace:[...retired.globals.trace],value:retired.globals.mixedValue,connected:retired.root.isConnected,failure},events,outer:{...document.body.dataset}}
    },output)
    expect(observed.normal).toEqual({trace:['inline-tail:loading','module:interactive','defer:interactive','dependency:start','after-defer:interactive','tail:interactive','DCL:interactive','dependency:end','dependent:7','load:complete'],value:10,dependent:7,sharedInit:1,sharedValue:2,deferScript:'deferred',moduleScript:null,ready:'complete'})
    expect(observed.retired).toMatchObject({trace:['inline-tail:loading'],value:0,connected:false})
    expect(observed.retired.failure).not.toBe('');expect(observed.events).toEqual([]);expect(observed.outer).toEqual({});expect(errors).toEqual([])
  } finally { await browser.close() }
},30000)

it('keeps source lexical bindings and named/default ESM exports while diagnosing unsupported program inputs', async () => {
  const output = compilePublishedScriptModule(`const document='local'; export function mount(){const value={document};return value.document} export default {mount};`)
  expect(output.diagnostics).toEqual([])
  const exports = Function(`return (${output.factorySource})`)()({})
  expect(exports.mount()).toBe('local')
  expect(exports.default.mount).toBe(exports.mount)
  const anonymous = compilePublishedScriptModule('export default function(){return 3}\nexport const value=4')
  expect(Function(`return (${anonymous.factorySource})`)()({}).default()).toBe(3)
  const lexicalThis = compilePublishedScriptModule('export const root=()=>this;export const object={method(){const arrow=()=>this;return arrow()}}')
  const lexicalExports = Function(`return (${lexicalThis.factorySource})`)()({})
  expect(lexicalExports.root()).toBeUndefined()
  expect(lexicalExports.object.method()).toBe(lexicalExports.object)
  const awaited = compilePublishedScriptModule('export const result=await Promise.resolve(1)')
  expect(awaited.diagnostics).toEqual([])
  expect(await Function(`return (${awaited.factorySource})`)()({ Promise })).toMatchObject({ result: 1 })
  const loop = compilePublishedScriptModule('export let result=0;for await (const value of [1,2]) result+=value;')
  expect(loop.diagnostics).toEqual([])
  expect(await Function(`return (${loop.factorySource})`)()({})).toMatchObject({ result: 3 })
  expect(compilePublishedWebProgram({ html: '<p>可读内容</p><script src="missing.js"></script>' }).diagnostics[0].code).toBe('script-source')
  expect(compilePublishedWebProgram({ html: '<template><script>window.wrong=true</script></template>' })).toMatchObject({scriptFactories:[],diagnostics:[{code:'template-program'}]})
  const templateSibling = compilePublishedWebProgram({ html: '<template><script>window.wrong=true</script></template><script>window.good=7</script>' }), localWindow: Record<string, unknown> = {}
  activateBlockingPrograms(templateSibling, { window: localWindow })
  expect(localWindow).toEqual({good:7})
  expect(templateSibling.diagnostics[0].code).toBe('template-program')
  expect(compilePublishedScriptModule(`export function mount(){setTimeout('window.dynamic=true',1)}`).diagnostics[0].code).toBe('string-timer')
  const matureJit = 'export const compiled=new Function("value","return value+1")'
  expect(compilePublishedScriptModule(matureJit).diagnostics[0].code).toBe('dynamic-program')
  const builtin = compilePublishedScriptModule(matureJit,{trustedBuiltin:true})
  expect(builtin.diagnostics).toEqual([])
  expect(Function(`return (${builtin.factorySource})`)()({Function}).compiled(3)).toBe(4)
  for (const expression of ['window.eval("document.body.dataset.outside=1")', 'window["Function"]("document.body.dataset.outside=1")()', 'self.Function("return 1")()', 'globalThis.eval("1")'])
    expect(compilePublishedScriptModule(`export function mount(){${expression}}`).diagnostics[0].code).toBe('dynamic-program')
  const localMethods = compilePublishedScriptModule('export function mount(){const window={eval:value=>value,Function:value=>()=>value};return window.eval(3)+window.Function(4)()}')
  expect(localMethods.diagnostics).toEqual([])
  expect(Function(`return (${localMethods.factorySource})`)()({}).mount()).toBe(7)
  expect(compilePublishedScriptModule('export const compiled=window.Function("value","return value+1")',{trustedBuiltin:true}).diagnostics).toEqual([])
})

it('preserves constructor new.target instead of diagnosing it as import.meta', () => {
  const output = compilePublishedScriptModule(`export class AuthoredError extends Error {
    constructor(message){super(message);Object.setPrototypeOf(this,new.target.prototype);this.createdBy=new.target}
  } export class DetailedError extends AuthoredError {}`)
  expect(output.diagnostics).toEqual([])
  const exports = Function(`return (${output.factorySource})`)()({ Error, Object })
  const error = new exports.DetailedError('原错误')
  expect(error).toBeInstanceOf(exports.AuthoredError)
  expect(error).toBeInstanceOf(exports.DetailedError)
  expect(error.createdBy).toBe(exports.DetailedError)
  expect(error.message).toBe('原错误')
})

it('ignores async and defer attributes on ordinary inline classic scripts', () => {
  const output = compilePublishedWebProgram({ html: '<script async defer>let shared=4;window.order=[shared]</script><script defer>window.order.push(++shared)</script><script async>window.order.push(shared)</script>' })
  expect(output.diagnostics).toEqual([])
  const localWindow: Record<string, unknown> = {}
  activateBlockingPrograms(output, { window: localWindow })
  expect(localWindow.order).toEqual([4, 5, 5])
  const external = compilePublishedWebProgram({ html: '<script data-cw-async>window.originallyExternal=true</script>' })
  expect(external.diagnostics).toEqual([])
  expect(external.classicPrograms.map(program => program.kind)).toEqual(['async'])
})

it('keeps direct authored native child documents while protecting unsupported outer ancestor programs', () => {
  const markup = (child: string) => {
    const tree = parse('<iframe></iframe>')
    const find = (node: any): any => node.tagName === 'iframe' ? node : node.childNodes?.map(find).find(Boolean)
    find(tree).attrs.push({ name: 'srcdoc', value: child })
    return serialize(tree) + '<script>window.parentProgram=1</script>'
  }
  const author = markup('<button onclick="parent.document.body.dataset.local=1">父根</button>')
  const child = compilePublishedWebProgram({ html: author })
  expect(child.diagnostics).toEqual([])
  expect(child.classicPrograms).toHaveLength(1)
  expect(child.html).toContain('data-guoling-native-parent-bridge')
  expect(author).not.toContain('data-guoling-native-parent-bridge')
  const cloned = compilePublishedWebProgram({ html: '<template>' + author.replace('<script>window.parentProgram=1</script>', '') + '</template><script>window.parentProgram=1</script>' })
  expect(cloned.diagnostics).toEqual([])
  expect(cloned.html).toContain('data-guoling-native-parent-bridge')
  const read = compilePublishedScriptModule('export function mount(){const frame=document.querySelector("iframe");return [frame.contentWindow.parent,frame.contentDocument.defaultView.parent]}')
  expect(read.diagnostics).toEqual([])
  expect(read.factorySource).toContain('__nativeChild')
  const optional = compilePublishedScriptModule('export function mount(){const frame=null;return frame?.contentWindow.parent}')
  expect(Function(`return (${optional.factorySource})`)()({ __nativeChild: (value: unknown) => value }).mount()).toBeUndefined()
  expect(compilePublishedScriptModule('export function mount(){return frame.contentWindow}', { trustedBuiltin: true }).factorySource).not.toContain('__nativeChild(')
  const top = compilePublishedWebProgram({ html: markup('<button onclick="top.document.body.dataset.outer=1">祖先</button><script>window.good=1</script>') })
  expect(top.diagnostics.map(issue => issue.code)).toEqual(['nested-ancestor'])
  expect(top.html).not.toContain('onclick=')
  expect(top.html).toContain('window.good=1')
  expect(top.classicPrograms).toHaveLength(1)
  const shadowed = compilePublishedWebProgram({ html: markup('<script>function local(top){top.value=3}local({})</script>') })
  expect(shadowed.diagnostics).toEqual([])
  const future = compilePublishedWebProgram({ html: markup('<template><script>const top={}</script></template><button onclick="top.document.body.dataset.outer=1">祖先</button>') })
  expect(future.diagnostics.map(issue => issue.code)).toEqual(['nested-ancestor'])
  expect(future.html).not.toContain('onclick=')
  const restricted = compilePublishedWebProgram({ html: markup('<script>const top={}</script><button onclick="top.document.body.dataset.outer=1">祖先</button>') })
  expect(restricted.diagnostics.map(issue => issue.code)).toEqual(['nested-ancestor'])
  expect(restricted.html).not.toContain('onclick=')
  for (const source of ['var top;top.document.body.dataset.outer=1', 'var window;window.top.document.body.dataset.outer=1', 'const window={};']) {
    const globals = compilePublishedWebProgram({ html: markup(`<script>${source}</script><button onclick="window.top.document.body.dataset.outer=1">祖先</button>`) })
    expect(globals.diagnostics.map(issue => issue.code)).toEqual(['nested-ancestor'])
    expect(globals.html).not.toContain('onclick=')
  }
  expect(compilePublishedWebProgram({ html: markup('<script type="module" src="./child.js"></script>') }).diagnostics[0].code).toBe('nested-content')
})

it('disables unsupported native javascript navigation without rejecting non-URL text or inert links', () => {
  const html = `<a id="unsafe" href="javascript:void(document.body.dataset.outsideWrite='wrong')">局部链接</a>
    <svg><a xlink:href="javascript:void(document.body.dataset.outsideWrite='wrong')">SVG链接</a></svg>
    <form action="javascript:void(document.body.dataset.outsideWrite='wrong')"><button formaction="javascript:void(document.body.dataset.outsideWrite='wrong')">提交</button></form>
    <script>window.usable=true</script>`
  const output = compilePublishedWebProgram({ html })
  expect(output.diagnostics.map(issue => issue.code)).toEqual(['javascript-url', 'javascript-url', 'javascript-url', 'javascript-url'])
  expect(output.html).not.toContain('="javascript:')
  expect(output.classicPrograms).toHaveLength(1)
  const localWindow: Record<string, unknown> = {}
  activateBlockingPrograms(output, { window: localWindow })
  expect(localWindow.usable).toBe(true)
  expect(html).toContain('href="javascript:void(document.body.dataset.outsideWrite=')
  const inert = compilePublishedWebProgram({ html: '<p title="javascript:void(0)" data-note="javascript:arbitrary()">说明</p><a href="javascript:void(0)">占位链接</a><script>window.usable=true</script>' })
  expect(inert.diagnostics).toEqual([])
  expect(inert.html).toContain('href="javascript:void(0)"')
  expect(inert.html).toContain('title="javascript:void(0)"')
  expect(inert.classicPrograms).toHaveLength(1)
})

it('keeps inert template text while stopping unsupported native execution when cloned into the local root', () => {
  const output = compilePublishedWebProgram({ html: `<template id="future"><button onclick="document.body.dataset.outside='wrong'">模板动作</button>
    <a href="javascript:void(document.body.dataset.outside='wrong')">模板导航</a><script>document.body.dataset.outside='wrong'</script>
    <script type="application/json">{"ordinary":"data"}</script><p title="javascript:void(0)">正常内容</p></template><script>window.usable=true</script>` })
  expect(output.diagnostics.map(issue => issue.code)).toEqual(['template-program'])
  expect(output.html).not.toContain('onclick=')
  expect(output.html).not.toContain('href="javascript:')
  expect(output.html).toContain('type="application/x-guoling-uncompiled-script"')
  expect(output.html).toContain('type="application/json"')
  expect(output.html).toContain('模板动作')
  expect(output.classicPrograms).toHaveLength(1)
  const data = compilePublishedWebProgram({ html: '<template><script type="application/json">{"ordinary":"data"}</script></template>' })
  expect(data.diagnostics).toEqual([])
  const noModule = compilePublishedWebProgram({ html: '<script type="module" nomodule>window.executable=true</script><script nomodule>window.ignored=true</script>' })
  expect(noModule.diagnostics).toEqual([])
  const localWindow: Record<string, unknown> = {}
  Function(`return (${noModule.scriptFactories[0]})`)()({ window: localWindow }).startAll(()=>true)
  expect(localWindow).toEqual({ executable: true })
})

it('runs two real same-document programs with native DOM/CSS/form scope and cleans callbacks on retirement', async () => {
  const web = compilePublishedWebProgram({ html: `<!doctype html><html><head><style>
    :root{--ink:rgb(17, 34, 51)}#status{color:var(--ink)}.choice:checked+label{font-weight:700}
    @keyframes pulse{from{opacity:1}to{opacity:.5}}.spin{animation:pulse 2s linear infinite}
    </style></head><body><form id="form"><input class="choice" id="answer" name="answer" type="checkbox"><label id="label" for="answer">局部标签</label></form>
    <button id="increment" aria-labelledby="label">+</button><output id="status">0</output><span class="spin">动画</span>
    <svg width="20" height="20"><defs><linearGradient id="gradient"><stop stop-color="red"/></linearGradient></defs><rect width="20" height="20" fill="url(#gradient)"/></svg>
    <script>var count=0;function paint(){document.getElementById('status').textContent=String(count)}
    document.addEventListener('DOMContentLoaded',function(event){window.dcl=(window.dcl||0)+1;window.initRoot=this===document&&event.target===document;document.getElementById('increment')['addEventListener']('click',function(){count++;paint()})});
    window.onload=function(event){window.loaded=(window.loaded||0)+1;window.loadRoot=this===window&&event.target===window};window.ticks=0;setInterval(function(){window.ticks++},10);requestAnimationFrame(function(){window.raf=true});</script>
    <script>window.shared=typeof paint==='function'&&window.count===count;document.body.dataset.root=document.body.ownerDocument===document?'local':'wrong';const arrow=()=>this.document.getElementById('status');window.arrowRoot=arrow()===document.getElementById('status');window.selectorRoot=document.querySelector(':root')===document.documentElement&&document.querySelectorAll(':root').length===1&&document.querySelector(':root > body')===document.body;document.querySelector(':root').style.setProperty('--ink','rgb(11, 22, 33)');</script></body></html>`, css: 'body{background:rgb(240, 241, 242)}' })
  expect(web.diagnostics).toEqual([])
  const source = compilePublishedScriptModule(`export function mount({root,scope}){
    const button=document.createElement('button');button.id='increment';root.append(button);
    const key=scope.instanceId+':count';let count=scope.state.get(key)||0;button.textContent=String(count);
    button['onclick']=()=>{scope.state.set(key,++count);button.textContent=String(count)};
    const timer=setInterval(()=>scope.state.set(scope.instanceId+':tick',(scope.state.get(scope.instanceId+':tick')||0)+1),10);
    document.addEventListener('DOMContentLoaded',()=>root.dataset.initialized='yes');
    return{update(){},dispose(){clearInterval(timer)}};}`)
  expect(source.diagnostics).toEqual([])
  const graph = compilePublishedWebProgram({ html: '<div id="status"></div><script type="module"></script><script type="module"></script>', moduleGraph: {
    entries: { '0': 'one.js', '1': 'two.js' }, modules: {
      'shared.js': { code: 'export let count=0;export function next(){return ++count}', imports: [] },
      'one.js': { code: 'import {next} from "./shared.js";document.getElementById("status").textContent=String(next());', imports: [{ start: 19, end: 32, path: 'shared.js' }] },
      'two.js': { code: 'import {next} from "./shared.js";document.getElementById("status").textContent+=String(next());', imports: [{ start: 19, end: 32, path: 'shared.js' }] },
    } } })
  expect(graph.diagnostics).toEqual([])
  const bundle = await build({ stdin: { contents: "export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'CompiledProbe', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<!doctype html><div id="outer"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const initial = await page.evaluate(async ({ web, source, graph }) => {
      const runtime = (window as any).CompiledProbe, outer = document.getElementById('outer')!, state = new Map<string, any>()
      const make = (id: string) => {
        const root = document.createElement('section');root.style.cssText='width:300px;height:200px';outer.append(root)
        return { root, instance: { id, definitionId: 'test', data: {} }, scope: { instanceId:id,runScopeId:'probe',generation:1,signal:new AbortController().signal,isActive:()=>true,cleanup(){},state:{get:(key:string)=>state.get(key),set:(key:string,value:any)=>state.set(key,value)},events:{emit(){},subscribe(){return()=>{}}},target(){return null} } }
      }
      const factories = web.scriptFactories.map(code => Function(`return (${code})`)())
      const preparedWeb = { classicPrograms: web.classicPrograms.map(program => ({ index: program.index, kind: program.kind, activate: Function(`return (${program.factorySource})`)() })), handlerFactories: web.handlerFactories.map(code => Function(`return (${code})`)()) }
      const a = runtime.createCompiledContentEnvironment(make('a'),web), b = runtime.createCompiledContentEnvironment(make('b'),{...web,css:web.css+'#status{color:rgb(90,80,70)}@keyframes pulse{from{opacity:.7}to{opacity:.9}}'})
      await a.initialize(factories, preparedWeb);await b.initialize(factories, preparedWeb);await a.initialize(factories, preparedWeb)
      const sourceFactory = Function(`return (${source.factorySource})`)()
      const sourceContext=make('source'), sourceEnv=runtime.createCompiledContentEnvironment(sourceContext)
      const sourceMount=sourceFactory(sourceEnv.globals).mount({...sourceContext,root:sourceEnv.root});await sourceEnv.initialize([])
      const graphEnv=runtime.createCompiledContentEnvironment(make('graph'),graph)
      await graphEnv.initialize(graph.scriptFactories.map(code => Function(`return (${code})`)()), { classicPrograms: [], handlerFactories: [] })
      ;(window as any).compiledProbe={a,b,state,sourceContext,sourceFactory,sourceEnv,sourceMount,sourceButton:sourceEnv.root.querySelector('button'),factories,runtime,make,graphEnv}
      const status=(env:any)=>env.globals.document.getElementById('status')
      const aButton=a.globals.document.getElementById('increment'),bButton=b.globals.document.getElementById('increment'),aBox=aButton.getBoundingClientRect(),bBox=bButton.getBoundingClientRect()
      const hitTest=[a.globals.document.elementFromPoint(aBox.x+aBox.width/2,aBox.y+aBox.height/2)===aButton,a.globals.document.elementsFromPoint(aBox.x+aBox.width/2,aBox.y+aBox.height/2).includes(aButton),a.globals.document.elementFromPoint(bBox.x+bBox.width/2,bBox.y+bBox.height/2)===null,a.globals.document.elementsFromPoint(bBox.x+bBox.width/2,bBox.y+bBox.height/2).length===0]
      return { dcl:[a.globals.dcl,b.globals.dcl],load:[a.globals.loaded,b.globals.loaded],initRoot:[a.globals.initRoot,b.globals.initRoot],loadRoot:[a.globals.loadRoot,b.globals.loadRoot],arrowRoot:[a.globals.arrowRoot,b.globals.arrowRoot],selectorRoot:[a.globals.selectorRoot,b.globals.selectorRoot],shared:[a.globals.shared,b.globals.shared],roots:[a.root.dataset.root,b.root.dataset.root],css:[getComputedStyle(status(a)).color,getComputedStyle(status(b)).color],keyframes:[a.root.querySelector('.spin').getAnimations()[0].effect.getKeyframes()[0].opacity,b.root.querySelector('.spin').getAnimations()[0].effect.getKeyframes()[0].opacity],
        label:[a.globals.document.getElementById('label').control===a.globals.document.getElementById('answer'),b.globals.document.getElementById('label').control===b.globals.document.getElementById('answer')],
        form:a.globals.document.getElementById('answer').form===a.globals.document.getElementById('form'),hitTest,idOutside:document.getElementById('answer'),graph:status(graphEnv).textContent,sourceInitialized:sourceEnv.root.dataset.initialized }
    }, { web, source, graph })
    expect(initial).toMatchObject({dcl:[1,1],load:[1,1],initRoot:[true,true],loadRoot:[true,true],arrowRoot:[true,true],selectorRoot:[true,true],shared:[true,true],roots:['local','local'],css:['rgb(11, 22, 33)','rgb(90, 80, 70)'],keyframes:['1','0.7'],label:[true,true],form:true,hitTest:[true,true,true,true],idOutside:null,graph:'12',sourceInitialized:'yes'})
    await page.waitForFunction(() => (window as any).compiledProbe.a.globals.ticks>1 && (window as any).compiledProbe.a.globals.raf)
    const changed = await page.evaluate(() => {
      const p=(window as any).compiledProbe;p.a.globals.document.getElementById('increment').click();p.a.globals.document.getElementById('answer').click();p.sourceButton.click()
      return { count:[p.a.globals.document.getElementById('status').textContent,p.b.globals.document.getElementById('status').textContent],checked:[p.a.globals.document.getElementById('answer').checked,p.b.globals.document.getElementById('answer').checked],weight:getComputedStyle(p.a.globals.document.getElementById('label')).fontWeight }
    })
    expect(changed).toEqual({count:['1','0'],checked:[true,false],weight:'700'})
    const stopped = await page.evaluate(() => {
      const p=(window as any).compiledProbe;p.oldButton=p.a.globals.document.getElementById('increment');p.a.dispose();p.sourceMount.dispose();p.sourceEnv.dispose()
      return {a:p.a.globals.ticks,b:p.b.globals.ticks,source:p.state.get('source:tick')}
    })
    await page.waitForFunction(value => (window as any).compiledProbe.b.globals.ticks>value+2, stopped.b)
    const returned = await page.evaluate(async () => {
      const p=(window as any).compiledProbe;p.oldButton.click();p.sourceButton.click()
      const after={a:p.a.globals.ticks,b:p.b.globals.ticks,source:p.state.get('source:tick'),oldCount:p.a.globals.count}
      const env=p.runtime.createCompiledContentEnvironment(p.sourceContext), mounted=p.sourceFactory(env.globals).mount({...p.sourceContext,root:env.root});await env.initialize([])
      const button=env.root.querySelector('button'),before=button.textContent;button.click();const once=button.textContent
      env.dispose();mounted.dispose();p.state.clear()
      const reset=p.runtime.createCompiledContentEnvironment(p.sourceContext),resetMount=p.sourceFactory(reset.globals).mount({...p.sourceContext,root:reset.root});await reset.initialize([])
      const resetCount=reset.root.querySelector('button').textContent;resetMount.dispose();reset.dispose();p.b.dispose();p.graphEnv.dispose()
      return {after,before,once,resetCount,iframes:document.querySelectorAll('iframe').length}
    })
    expect(returned.after.a).toBe(stopped.a)
    expect(returned.after.source).toBe(stopped.source)
    expect(returned.after.b).toBeGreaterThan(stopped.b)
    expect(returned).toMatchObject({before:'1',once:'2',resetCount:'0',iframes:0,after:{oldCount:1}})
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 30000)

it('activates separate classic programs with owned defer and async phases while preserving callable and declaration semantics', async () => {
  const output = compilePublishedWebProgram({ html: `<section id="script-scope"><button id="early" onclick="window.handlerValue=shared">初始化按钮</button><script>
    window.order=[];let shared=4;window.order.push('start:'+shared+':'+document.readyState);
    window.currentScriptScope=document.currentScript.closest('section').id;
    document.addEventListener('readystatechange',event=>event.stopImmediatePropagation());
    document.addEventListener('DOMContentLoaded',()=>{window.order.push('dcl:'+document.readyState);window.callbackScriptNull=document.currentScript===null});
    window.addEventListener('load',()=>window.order.push('load:'+document.readyState));
    document.getElementById('early').click();</script>
    <script data-cw-defer>let deferredOnly=2;shared++;window.order.push('defer1:'+shared+':'+document.readyState);document.currentScript.closest('section').dataset.deferred='yes'</script>
    <script>window.order.push('blocking:'+shared+':'+typeof deferredOnly);window.futureRead=typeof laterLexical;
    function plain(){this.document.body.dataset.fromPlain='local';return this===window}
    function strict(){'use strict';return this}const object={method(){return this}};
    function Construct(){this.value=3}window.receivers=[plain(),strict()===undefined,object.method()===object,new Construct().value];
    window.shapes=[];for(var i=0;i<2;i++)window.shapes.push(i);window.shapes.push(i);
    var {value:destructured=7}={value:3};window.shapes.push(destructured);
    if(true){function blockFunction(){return 4}}window.shapes.push(blockFunction());
    let CoursewareCompiledPlayer=7;window.outerCollision=CoursewareCompiledPlayer;
    window.newVarDescriptor=Object.getOwnPropertyDescriptor(window,'i').configurable;window.deleteDeclared=delete i;
    window.order.push('end:'+shared);</script>
    <script data-cw-defer>shared+=3;window.order.push('defer2:'+shared+':'+document.readyState)</script>
    <script async data-cw-async>window.asyncPhase=document.readyState;window.order.push('async:'+shared+':'+document.readyState);document.currentScript.closest('section').dataset.async='yes'</script>
    <script>let laterLexical=8;window.laterValue=laterLexical;let shadow=6;</script>
    <script>if(true){function shadow(){return 9}window.blockLocal=shadow()}window.lexicalShadow=shadow;
    if(false){function inactiveBlock(){return 1}}window.inactiveBlock=typeof inactiveBlock;</script></section>` })
  expect(output.diagnostics).toEqual([])
  const broken = compilePublishedWebProgram({ html: '<script>throw new Error("single program failed")</script><script>window.healthy=1</script>' })
  const sharedModule = compilePublishedWebProgram({ html: '<script>let classicLexical=4</script><script type="module">function strictDefault(){return this}window.moduleThis=strictDefault()===undefined;window.moduleRead=classicLexical;window.moduleUnknown=typeof neverProvided;window.moduleScriptNull=document.currentScript===null</script>' })
  expect(sharedModule.diagnostics).toEqual([])
  const bundle = await build({ stdin: { contents: "export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'CompiledProbe', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    // A real unrelated course-shell global must not constrain the component's lexical declarations.
    await page.addScriptTag({ content: 'var CoursewareCompiledPlayer={outer:true}' })
    const observed = await page.evaluate(async ({ output, broken, sharedModule }) => {
      const runtime = (window as any).CompiledProbe, events: any[] = [], root = document.getElementById('root')!
      const prepare = (program: typeof output) => ({ factories: program.scriptFactories.map(code => Function(`return (${code})`)()), web: { classicPrograms: program.classicPrograms.map(value => ({ index: value.index, kind: value.kind, activate: Function(`return (${value.factorySource})`)() })), handlerFactories: program.handlerFactories.map(code => Function(`return (${code})`)()) } })
      const prepared = prepare(output), preparedBroken = prepare(broken)
      const make = (id: string, program: typeof output) => {
        const node = document.createElement('section');root.append(node)
        return runtime.createCompiledContentEnvironment({ root: node, instance: { id }, scope: { signal: new AbortController().signal, isActive: () => true, events: { emit: (type: string, payload: unknown) => events.push({ id, type, payload }) } } }, program)
      }
      const first = make('first', output), second = make('second', output)
      await first.initialize(prepared.factories, prepared.web);await second.initialize(prepared.factories, prepared.web)
      const read = (env: any) => ({ order: env.globals.order, handlerValue: env.globals.handlerValue, futureRead: env.globals.futureRead, laterValue: env.globals.laterValue, receivers: env.globals.receivers, shapes: env.globals.shapes, outerCollision: env.globals.outerCollision, blockLocal: env.globals.blockLocal, lexicalShadow: env.globals.lexicalShadow, inactiveBlock: env.globals.inactiveBlock, newVarDescriptor: env.globals.newVarDescriptor, deleteDeclared: env.globals.deleteDeclared, localBody: env.root.dataset.fromPlain, asyncPhase: env.globals.asyncPhase, lexicalWindowValue: env.globals.shared, currentScriptScope: env.globals.currentScriptScope, callbackScriptNull: env.globals.callbackScriptNull, scriptScope: { ...env.root.querySelector('#script-scope').dataset } })
      const failed = make('failed', broken);await failed.initialize(preparedBroken.factories, preparedBroken.web)
      const moduleEnv = make('module', sharedModule), preparedModule = prepare(sharedModule);await moduleEnv.initialize(preparedModule.factories, preparedModule.web)
      const pending = make('retired', output), pendingInitialization = pending.initialize(prepared.factories, prepared.web);pending.dispose();await pendingInitialization
      const result = { first: read(first), second: read(second), healthy: failed.globals.healthy, moduleThis: moduleEnv.globals.moduleThis, moduleRead: moduleEnv.globals.moduleRead, moduleUnknown: moduleEnv.globals.moduleUnknown, moduleScriptNull: moduleEnv.globals.moduleScriptNull, events, retiredAsync: pending.globals.asyncPhase ?? null, outerBody: { ...document.body.dataset }, outerGlobal: (window as any).CoursewareCompiledPlayer, iframes: document.querySelectorAll('iframe').length }
      first.dispose();second.dispose();failed.dispose();moduleEnv.dispose();return result
    }, { output, broken, sharedModule })
    for (const result of [observed.first, observed.second]) {
      expect(result).toMatchObject({ handlerValue: 4, futureRead: 'undefined', laterValue: 8, receivers: [true, true, true, 3], shapes: [0, 1, 2, 3, 4], outerCollision: 7, blockLocal: 9, lexicalShadow: 6, inactiveBlock: 'undefined', newVarDescriptor: false, deleteDeclared: false, localBody: 'local', asyncPhase: 'interactive', currentScriptScope: 'script-scope', callbackScriptNull: true, scriptScope: { deferred: 'yes', async: 'yes' } })
      expect(result.lexicalWindowValue).toBeUndefined()
      expect(result.order.filter((value: string) => !value.startsWith('async:'))).toEqual(['start:4:loading', 'blocking:4:undefined', 'end:4', 'defer1:5:interactive', 'defer2:8:interactive', 'dcl:interactive', 'load:complete'])
      expect(result.order.findIndex((value: string) => value.startsWith('async:'))).toBeLessThan(result.order.findIndex((value: string) => value.startsWith('load:')))
    }
    expect(observed).toMatchObject({ healthy: 1, moduleThis: true, moduleRead: 4, moduleUnknown: 'undefined', moduleScriptNull: true, retiredAsync: null, outerBody: {}, outerGlobal: { outer: true }, iframes: 0 })
    expect(observed.events).toHaveLength(1)
    expect(observed.events[0]).toMatchObject({ id: 'failed', type: 'component.diagnostic' })
    expect(observed.events[0].payload.message).toContain('script[0]')
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 30000)

it('keeps guarded native module references legal without changing module-local or imported names', () => {
  const child = '<script type="importmap">{"imports":{}}</script><script type="module" src="./entry.js"></script>'
  const markup = `<iframe srcdoc="${child.replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></iframe>`
  const output = compilePublishedWebProgram({ html: markup, publishedDocumentBundles: { '0': `
    import {top as importedTop} from './already-prepared.js';
    export function local(top,window,frameElement){return {top,value:window.top,owner:frameElement.ownerDocument,importedTop}}
    export function targets(rhs,input){top=rhs();++top;({top}=input);({top=1}=input);for(top of []){};for(top in {}){};return {top}}
    export function uncalled(){return window?.top?.document || frameElement?.ownerDocument}
  ` } })
  expect(output.diagnostics).toEqual([])
  const tree = parse(output.html)
  const find = (node: any): any => node.tagName === 'iframe' ? node : node.childNodes?.map(find).find(Boolean)
  const native = parse(find(tree).attrs.find((attr: any) => attr.name === 'srcdoc').value)
  const scripts: any[] = []
  const collect = (node: any) => { if (node.tagName === 'script') scripts.push(node);node.childNodes?.forEach(collect) }
  collect(native)
  const source = scripts.find(node => node.attrs.some((attr: any) => attr.name === 'type' && attr.value === 'module')).childNodes[0].value
  expect(() => parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
  expect(source).toContain('function local(top,window,frameElement){return {top,value:window.top,owner:frameElement.ownerDocument,importedTop}}')
  expect(source).toContain('top:(function(){throw')
  expect(source).toContain('child[0]')
  expect(output.scriptFactories).toEqual([])
  expect(scripts.some(node => node.attrs.some((attr: any) => attr.name === 'type' && attr.value === 'application/x-guoling-prepared-importmap'))).toBe(true)
})

it('runs prepared native child ESM with local parent, healthy shared exports and call-time Scope diagnostics', async () => {
  const child = '<button id="add">增加</button><button id="lazy">延后访问</button><script type="application/json">{"data":1}</script><script type="module" src="./bad.js"></script><script type="module" src="./good.js"></script>'
  const data = { html: `<iframe srcdoc="&lt;p&gt;占位子文档&lt;/p&gt;"></iframe><iframe id="child" srcdoc="${child.replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></iframe><script type="module" src="./root.js"></script>`, modules: {
    'root.js': 'import {value} from "./shared.js";window.rootValue=value;',
    'bad.js': 'top.document.body.dataset.badOuter="wrong";',
    'good.js': `import {value,inc} from './shared.js';const top=5,window={value:7};globalThis.moduleLocal=top+window.value;globalThis.goodValue=value;globalThis.lazyCount=0;document.body.dataset.ready='yes';
      document.getElementById('add').onclick=()=>{inc();globalThis.goodValue=value;parent.document.body.dataset.childValue=String(value)};
      document.getElementById('lazy').onclick=async()=>{const namespace=await import('./lazy.js');namespace.access()};
      globalThis.ticks=0;setInterval(()=>globalThis.ticks++,10);`,
    'shared.js': 'globalThis.sharedInit=(globalThis.sharedInit||0)+1;export let value=3;export function inc(){value++}export function unused(){top.document.body.dataset.deadOuter="wrong"}',
    'lazy.js': 'globalThis.lazyCount++;export function access(){return top.document.body}',
  } }
  const project = createBlankCourseProjectV10('Native child ESM')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  project.instances.web = { id: 'web', definitionId: 'web', data }
  project.surfaces[0].childIds = ['web']
  const before = structuredClone(data)
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation })
  expect(published.diagnostics).toEqual([])
  const runtimeData = published.payload.instances.web.data as unknown as WebRuntimeData
  expect(runtimeData.publishedDocumentBundles?.['1']).not.toContain('deadOuter')
  expect(Object.keys(runtimeData.publishedDocumentBundles ?? {})).toEqual(['1'])
  const output = compilePublishedWebProgram(runtimeData)
  expect(output.diagnostics).toEqual([])
  expect(data).toEqual(before)
  const bundle = await build({ stdin: { contents: "export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'CompiledProbe', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route(/^https?:/, route => route.abort())
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.evaluate(async output => {
      const events: any[] = [], runtime = (window as any).CompiledProbe
      const env = runtime.createCompiledContentEnvironment({ root: document.getElementById('root'), instance: { id: 'native-child' }, scope: { isActive: () => true, events: { emit: (type: string, payload: unknown) => events.push({ type, payload }) } } }, output)
      await env.initialize(output.scriptFactories.map(code => Function(`return (${code})`)()), { classicPrograms: [], handlerFactories: [] })
      ;(window as any).nativeProbe = { env, events }
    }, output)
    await page.waitForFunction(() => { const p=(window as any).nativeProbe,child=p.env.root.querySelector('#child').contentWindow;return child.goodValue===3 && child.ticks>1 && p.events.length===1 })
    const initial = await page.evaluate(() => {
      const p=(window as any).nativeProbe,child=p.env.root.querySelector('#child').contentWindow
      return { rootValue:p.env.globals.rootValue,rootInit:p.env.globals.sharedInit,childValue:child.goodValue,childInit:child.sharedInit,moduleLocal:child.moduleLocal,lazyCount:child.lazyCount,parentLocal:child.parent===p.env.globals.window,outer:{...document.body.dataset},events:p.events }
    })
    expect(initial).toMatchObject({ rootValue:3,rootInit:1,childValue:3,childInit:1,moduleLocal:12,lazyCount:0,parentLocal:true,outer:{} })
    expect(initial.events[0]).toMatchObject({ type:'component.diagnostic' })
    expect(initial.events[0].payload.message).toContain('组件 native-child 的 child[1]')
    await page.evaluate(() => { const p=(window as any).nativeProbe,child=p.env.root.querySelector('#child').contentWindow;child.document.getElementById('add').click();child.document.getElementById('add').click();child.document.getElementById('lazy').click() })
    await page.waitForFunction(() => (window as any).nativeProbe.events.length===2)
    const changed = await page.evaluate(() => {
      const p=(window as any).nativeProbe,frame=p.env.root.querySelector('#child'),child=frame.contentWindow
      const result={value:child.goodValue,parentValue:p.env.root.dataset.childValue,lazyCount:child.lazyCount,rootValue:p.env.globals.rootValue,outer:{...document.body.dataset},events:p.events};p.oldChild=child;p.oldFrame=frame;p.env.dispose();p.oldTicks=child.ticks;return result
    })
    expect(changed).toMatchObject({ value:5,parentValue:'5',lazyCount:1,rootValue:3,outer:{} })
    expect(changed.events[1].payload.message).toContain('child[1]')
    await page.waitForTimeout(60)
    expect(await page.evaluate(() => { const p=(window as any).nativeProbe;return {connected:p.oldFrame.isConnected,frozen:p.oldChild.ticks===p.oldTicks,events:p.events.length} })).toEqual({connected:false,frozen:true,events:2})
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 30000)

it('keeps healthy Web modules live when an unprepared dynamic import is untriggered or rejects locally', async () => {
  const data = { html: '<button id="good">增加</button><output id="counter">0</output><script type="module" src="./request.js"></script><script type="module" src="./good.js"></script>', modules: {
    'request.js': `import {inc,value} from './shared.js';inc();window.requestReady=value;
      export function request(source,options){return import(source)}window.request=request;
      export async function suspended(){return import(await Promise.resolve('missing.js'))}window.suspended=suspended;
      export function* yielded(){return import(yield 'source')}window.yielded=yielded;`,
    'good.js': 'import {inc,value} from "./shared.js";inc();window.goodReady=value;document.getElementById("good").onclick=()=>{inc();document.getElementById("counter").textContent=String(value)};',
    'shared.js': 'window.sharedInit=(window.sharedInit||0)+1;export let value=0;export function inc(){value++}',
  } }
  const project = createBlankCourseProjectV10('Dynamic request locality')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  project.instances.web = { id: 'web', definitionId: 'web', data };project.surfaces[0].childIds = ['web']
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const output = compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.diagnostics).toEqual([])
  expect(output.scriptFactories).toHaveLength(1)
  expect(output.scriptFactories[0]).not.toMatch(/\bimport\s*\(/)
  expect(compilePublishedScriptModule('export function request(name){return import(name)}').factorySource).toBe('')
  expect(compilePublishedWebProgram({html:'<script type="module">window.meta=import.meta</script>'}).scriptFactories).toEqual([])
  // Keep the B17 final-AST context check independent of producer support;
  // the following test covers options through the actual two-phase producer.
  const argumentProgram=compilePublishedWebProgram({html:`<script type="module">
    window.argumentOrder=[];export async function suspended(){return import(await Promise.resolve((window.argumentOrder.push('source'),'missing.js')),await Promise.resolve((window.argumentOrder.push('options'),{})))}window.suspended=suspended;
    export function* yielded(){return import(yield 'source',yield 'options')}window.yielded=yielded;
  </script>`})
  expect(argumentProgram.diagnostics).toHaveLength(2)
  expect(argumentProgram.scriptFactories).toHaveLength(1)
  const bundle = await build({ stdin: { contents: "export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'CompiledProbe', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage(), errors: string[] = [], requests: string[] = []
    page.on('pageerror', error => errors.push(error.message));page.on('request', request => {if (/^https?:/.test(request.url())) requests.push(request.url())})
    await page.route(/^https?:/, route => route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true)
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const observed = await page.evaluate(async ({output,argumentProgram}) => {
      const events: any[] = [], runtime=(window as any).CompiledProbe
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'request-locality'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:[],handlerFactories:[]})
      const initial={requestReady:env.globals.requestReady,goodReady:env.globals.goodReady,sharedInit:env.globals.sharedInit,diagnostics:events.length}
      env.root.querySelector('#good').click();const first=env.root.querySelector('#counter').textContent
      const order:string[]=[];let synchronous=false,result:any
      try {result=env.globals.request((order.push('source'),'missing.js'),(order.push('options'),{}))} catch {synchronous=true}
      const returnedPromise=result instanceof Promise,message=await result.then(()=>null,(error:any)=>error.message)
      await env.globals.suspended().catch(()=>{})
      const iterator=env.globals.yielded(),yielded=[iterator.next().value],completion=iterator.next('missing.js');await completion.value.catch(()=>{})
      const argumentEvents:any[]=[]
      const argumentEnv=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'argument-context'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>argumentEvents.push({type,payload})}}},argumentProgram)
      await argumentEnv.initialize(argumentProgram.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:[],handlerFactories:[]})
      await argumentEnv.globals.suspended().catch(()=>{})
      const argumentIterator=argumentEnv.globals.yielded(),argumentYielded=[argumentIterator.next().value,argumentIterator.next('missing.js').value],argumentCompletion=argumentIterator.next({});await argumentCompletion.value.catch(()=>{})
      const argumentOrder=argumentEnv.globals.argumentOrder;argumentEnv.dispose()
      env.root.querySelector('#good').click();const second=env.root.querySelector('#counter').textContent
      const beforeDispose=events.length;env.dispose();await env.globals.request('missing.js').catch(()=>{})
      return {initial,first,second,order,synchronous,returnedPromise,message,yielded,completionDone:completion.done,argumentOrder,argumentYielded,argumentEvents,events,beforeDispose,afterDispose:events.length,online:navigator.onLine,outer:{...document.body.dataset}}
    },{output,argumentProgram})
    expect(observed).toMatchObject({initial:{requestReady:1,goodReady:2,sharedInit:1,diagnostics:0},first:'3',second:'4',order:['source','options'],synchronous:false,returnedPromise:true,yielded:['source'],completionDone:true,argumentOrder:['source','options'],argumentYielded:['source','options'],beforeDispose:3,afterDispose:3,online:false,outer:{}})
    expect(observed.argumentEvents).toHaveLength(2)
    expect(observed.argumentEvents.every((event:any)=>event.payload.message.includes('组件 argument-context'))).toBe(true)
    expect(observed.message).toContain('组件 request-locality')
    expect(observed.events.every((event:any)=>event.type==='component.diagnostic'&&event.payload.message.includes('组件 request-locality'))).toBe(true)
    expect(errors).toEqual([]);expect(requests).toEqual([])
  } finally {await browser.close()}
},30000)

it('preserves dynamic import options through both producer phases and their caller context', async () => {
  const data = { html: '<button id="good">增加</button><output id="counter">0</output><script type="module" src="./request.js"></script><script type="module" src="./good.js"></script>', modules: {
    'request.js': `import {inc,value} from './shared.js';inc();window.requestReady=value;window.argumentOrder=[];
      export function request(source,options){return import(source,options)}window.request=request;
      export async function suspended(){return import(await Promise.resolve((window.argumentOrder.push('source'),'missing.js')),await Promise.resolve((window.argumentOrder.push('options'),{})))}window.suspended=suspended;
      export function* yielded(){return import(yield 'source',yield 'options')}window.yielded=yielded;`,
    'good.js': 'import {inc,value} from "./shared.js";inc();window.goodReady=value;document.getElementById("good").onclick=()=>{inc();document.getElementById("counter").textContent=String(value)};',
    'shared.js': 'window.sharedInit=(window.sharedInit||0)+1;export let value=0;export function inc(){value++}',
  } }
  const project = createBlankCourseProjectV10('Dynamic import options')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  project.instances.web = { id: 'web', definitionId: 'web', data };project.surfaces[0].childIds = ['web']
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  expect(published.diagnostics.every(issue=>issue.code==='source-compile-warning')).toBe(true)
  const runtimeData = published.payload.instances.web.data as unknown as WebRuntimeData
  const runtimeBinding=publishedWebRuntimeImportBinding(runtimeData.publishedModuleBundle!)
  expect(runtimeBinding).toBeTruthy()
  const importOptions: string[] = [], queue: any[] = [parseJavaScript(runtimeData.publishedModuleBundle!, {ecmaVersion:'latest',sourceType:'module'})]
  while (queue.length) {
    const node=queue.pop()
    if (node.type==='CallExpression' && node.callee.type==='MemberExpression' && node.callee.object.type==='Identifier'
      && node.callee.object.name===runtimeBinding && node.callee.property.name==='request') importOptions.push(node.arguments[2]?.type ?? 'missing')
    for (const value of Object.values(node)) if (value && typeof value==='object') queue.push(...(Array.isArray(value) ? value : [value]))
  }
  expect(importOptions.sort()).toEqual(['AwaitExpression','Identifier','YieldExpression'])
  const output=compilePublishedWebProgram(runtimeData)
  expect(output.scriptFactories).toHaveLength(1)
  expect(output.diagnostics).toEqual([])
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage(), errors:string[]=[], requests:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if (/^https?:/.test(request.url())) requests.push(request.url())})
    await page.route(/^https?:/,route=>route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true)
    await page.addScriptTag({content:bundle.outputFiles[0].text})
    const observed=await page.evaluate(async output=>{
      const events:any[]=[],runtime=(window as any).CompiledProbe
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'import-options'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:[],handlerFactories:[]})
      const initial={requestReady:env.globals.requestReady,goodReady:env.globals.goodReady,sharedInit:env.globals.sharedInit,diagnostics:events.length}
      env.root.querySelector('#good').click();const first=env.root.querySelector('#counter').textContent
      let synchronous=false,result:any
      try {result=env.globals.request('missing.js',{})} catch {synchronous=true}
      const returnedPromise=result instanceof Promise,message=await result.then(()=>null,(error:any)=>error.message)
      await env.globals.suspended().catch(()=>{})
      const iterator=env.globals.yielded(),yielded=[iterator.next().value,iterator.next('missing.js').value],completion=iterator.next({});await completion.value.catch(()=>{})
      env.root.querySelector('#good').click();const second=env.root.querySelector('#counter').textContent
      const order=env.globals.argumentOrder,beforeDispose=events.length;env.dispose();await env.globals.request('missing.js',{}).catch(()=>{})
      return {initial,first,second,synchronous,returnedPromise,message,order,yielded,completionDone:completion.done,events,beforeDispose,afterDispose:events.length,online:navigator.onLine,outer:{...document.body.dataset}}
    },output)
    expect(observed).toMatchObject({initial:{requestReady:1,goodReady:2,sharedInit:1,diagnostics:0},first:'3',second:'4',synchronous:false,returnedPromise:true,order:['source','options'],yielded:['source','options'],completionDone:true,beforeDispose:3,afterDispose:3,online:false,outer:{}})
    expect(observed.message).toContain('组件 import-options')
    expect(observed.events.every((event:any)=>event.type==='component.diagnostic' && event.payload.message.includes('组件 import-options'))).toBe(true)
    expect(errors).toEqual([]);expect(requests).toEqual([])
  } finally {await browser.close()}
},30000)

it('loads prepared Web and native child modules with native import options and the original active Scope', async () => {
  const child = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob:"><script>const Boolean=()=>false,Function=()=>false</script><script type="module" src="./entry.js"></script>'
  const data = { html: `<iframe id="child" srcdoc="${child.replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></iframe><script type="module" src="./entry.js"></script>`, modules: {
    'entry.js': `const Blob=0,URL=0,globalThis={local:9};window.locals=[Blob,URL,globalThis.local];
      window.originalMarker='guoling:validate-prepared-js-options:0';window.optionsOrder=[];
      export function known(options){return import('./known.js',options)}window.known=known;
      export function directEmpty(){return import('./known.js',{})}window.directEmpty=directEmpty;
      export function directAttrs(){return import('./known.js',{with:{}})}window.directAttrs=directAttrs;
      export function directJson(){return import('./known.js',{with:{type:'json'}})}window.directJson=directJson;
      export async function awaited(){return import('./known.js',await Promise.resolve((window.optionsOrder.push('options'),{})))}window.awaited=awaited;
      export function* yielded(){return import('./known.js',yield 'options')}window.yielded=yielded;`,
    'known.js': 'globalThis.knownInit=(globalThis.knownInit||0)+1;export const value=7;',
  } }
  const project = createBlankCourseProjectV10('Prepared import options')
  project.definitions.web = { id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'} }
  project.instances.web = {id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const before=structuredClone(data)
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  expect(published.diagnostics).toEqual([]);expect(data).toEqual(before)
  const runtimeData=published.payload.instances.web.data as unknown as WebRuntimeData
  // Vitest intercepts dynamic imports; native srcdoc serializes the actual built consumer instead.
  const producer=await build({stdin:{contents:"export {compilePublishedWebProgram} from './src/core/publish/componentPlatform/compiledScript'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',target:'es2022'})
  const consumer={exports:{} as {compilePublishedWebProgram:typeof compilePublishedWebProgram}}
  Function('module','exports',producer.outputFiles[0].text)(consumer,consumer.exports)
  const output=consumer.exports.compilePublishedWebProgram(runtimeData)
  expect(output.diagnostics).toEqual([]);expect(output.scriptFactories).toHaveLength(1)
  expect(output.scriptFactories[0]).not.toContain('import.meta')
  const childOnlyProject=structuredClone(project)
  childOnlyProject.instances.web.data={...data,html:data.html.replace('<script type="module" src="./entry.js"></script>','')}
  const childOnly=await buildPublishedCourseV3({project:childOnlyProject,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  expect(childOnly.diagnostics).toEqual([])
  expect(consumer.exports.compilePublishedWebProgram(childOnly.payload.instances.web.data as unknown as WebRuntimeData).diagnostics).toEqual([])
  const html=parse(output.html), frames:any[]=[]
  const collect=(node:any)=>{if(node.tagName==='iframe')frames.push(node);node.childNodes?.forEach(collect)};collect(html)
  const native=parse(frames[0].attrs.find((attr:any)=>attr.name==='srcdoc').value), scripts:any[]=[]
  const collectScripts=(node:any)=>{if(node.tagName==='script')scripts.push(node);node.childNodes?.forEach(collectScripts)};collectScripts(native)
  const prefix=scripts.find(node=>node.attrs.some((attr:any)=>attr.name==='data-guoling-native-parent-bridge')).childNodes[0].value
  const syntax:any=parseJavaScript(prefix,{ecmaVersion:'latest',sourceType:'script'}), imports:any[]=[], queue=[syntax]
  while(queue.length){const node=queue.pop();if(node.type==='ImportExpression')imports.push(node);for(const value of Object.values(node))if(value&&typeof value==='object')queue.push(...(Array.isArray(value)?value:[value]))}
  expect(imports.map(node=>node.options?.type)).toEqual(['Identifier'])
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage(), errors:string[]=[], requests:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())})
    await page.route(/^https?:/,route=>route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true)
    await page.addScriptTag({content:bundle.outputFiles[0].text})
    await page.evaluate(async output=>{
      const runtime=(window as any).CompiledProbe, probes:any[]=[]
      for(const id of ['normal','pending-root','pending-child','callback-root','callback-child']){
        let active=true;const root=document.createElement('section');document.getElementById('root')!.append(root)
        const events:any[]=[],env=runtime.createCompiledContentEnvironment({root,instance:{id},scope:{isActive:()=>active,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
        await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:[],handlerFactories:[]})
        probes.push({id,env,events,retire:()=>{active=false}})
      }
      ;(window as any).preparedOptionsProbes=probes
    },output)
    await page.waitForFunction(()=>(window as any).preparedOptionsProbes.every((probe:any)=>probe.env.root.querySelector('#child').contentWindow.locals?.[2]===9))
    const observed=await page.evaluate(async()=>{
      const probes=(window as any).preparedOptionsProbes, normal=probes[0], results:any[]=[]
      for(const target of [normal.env.globals,normal.env.root.querySelector('#child').contentWindow]){
        let cspEvalBlocked:boolean|null=null
        if(target!==normal.env.globals){try{target.Function('return 1')();cspEvalBlocked=false}catch(error:any){cspEvalBlocked=error.name==='EvalError'}}
        const initial=target.knownInit??0, first=await target.known(undefined), second=await target.known({}), attrs=await target.known({with:{}})
        const direct=[(await target.directEmpty()).value,(await target.directAttrs()).value], awaited=await target.awaited()
        const iterator=target.yielded(), yielded=iterator.next().value, completed=iterator.next({}), generated=await completed.value
        const failures:any[]=[], trace:string[]=[]
        const getterError=new Error('getter-sentinel'), getter={get with(){trace.push('getter');throw getterError}}
        for(const [label,options] of [['json',{with:{type:'json'}}],['unknown',{with:{unavailable:'yes'}}],['getter',getter]] as const){
          let synchronous=false,promise:any
          try{promise=target.known(options)}catch{synchronous=true}
          if(label==='getter')trace.push('returned')
          const error=await promise.then(()=>null,(error:any)=>error)
          failures.push({label,synchronous,promise:typeof promise?.then==='function',name:error?.name,message:error?.message,sameError:error===getterError})
        }
        const directJson=await target.directJson().then(()=>null,(error:any)=>error.name)
        results.push({initial,cspEvalBlocked,locals:target.locals,value:first.value,sameNamespace:first===second&&second===attrs&&attrs===awaited&&awaited===generated,direct,order:target.optionsOrder,yielded,done:completed.done,init:target.knownInit,failures,trace,directJson})
      }
      const retired:any[]=[]
      for(const probe of probes.slice(1)){
        const child=probe.id.endsWith('child'), target=child?probe.env.root.querySelector('#child').contentWindow:probe.env.globals
        let resolveCalls=0,restore=()=>{}
        let options:any={get with(){probe.retire();return {}}}
        if(probe.id.startsWith('callback')){
          const Constructor=target.Promise, original=Constructor.resolve
          Constructor.resolve=function(value:any){resolveCalls++;probe.retire();return original.call(Constructor,value)}
          restore=()=>{Constructor.resolve=original};options={}
        }
        let error:any
        try{error=await target.known(options).then(()=>null,(error:any)=>error)}finally{restore()}
        retired.push({id:probe.id,init:target.knownInit??0,connected:probe.env.root.querySelector('#child').isConnected,name:error?.name,message:error?.message,resolveCalls})
      }
      const events=probes.map((probe:any)=>({id:probe.id,count:probe.events.length})), outer={...document.body.dataset}
      probes.forEach((probe:any)=>probe.env.dispose())
      return {results,retired,events,outer,online:navigator.onLine,iframes:document.querySelectorAll('iframe').length}
    })
    for(const result of observed.results){
      expect(result).toMatchObject({initial:0,locals:[0,0,9],value:7,sameNamespace:true,direct:[7,7],order:['options'],yielded:'options',done:true,init:1,trace:['getter','returned'],directJson:'TypeError'})
      expect(result.failures.map((failure:any)=>({label:failure.label,synchronous:failure.synchronous,promise:failure.promise,name:failure.name}))).toEqual([{label:'json',synchronous:false,promise:true,name:'TypeError'},{label:'unknown',synchronous:false,promise:true,name:'TypeError'},{label:'getter',synchronous:false,promise:true,name:'Error'}])
      expect(result.failures[2].sameError).toBe(true)
    }
    expect(observed.results.map(result=>result.cspEvalBlocked)).toEqual([null,true])
    for(const retired of observed.retired){expect(retired).toMatchObject({init:0,connected:true,name:'TypeError'});expect(retired.message).toContain('已结束的组件实例');expect(retired.resolveCalls).toBe(retired.id.startsWith('callback')?1:0)}
    expect(observed).toMatchObject({events:[{id:'normal',count:0},{id:'pending-root',count:0},{id:'pending-child',count:0},{id:'callback-root',count:0},{id:'callback-child',count:0}],outer:{},online:false,iframes:0})
    expect(errors).toEqual([]);expect(requests).toEqual([])
  } finally {await browser.close()}
},30000)

it('keeps healthy Web modules live until an unsupported Worker constructor is actually called', async () => {
  const data={html:'<button id="good">增加</button><output id="counter">0</output><script type="module" src="./worker-entry.js"></script><script type="module" src="./healthy.js"></script>',modules:{
    'worker-entry.js':`import {inc,value} from './shared.js';inc();window.workerEntryReady=value;
      export function bare(order){return new Worker((order.push('source'),'missing.js'),...(order.push('spread'),[{}]))}window.bare=bare;
      export function member(order){return new window['SharedWorker']((order.push('source'),'missing.js'),...(order.push('spread'),[{}]))}window.member=member;
      export function argumentFails(){return new Worker((()=>{throw new Error('argument-sentinel')})())}window.argumentFails=argumentFails;
      export function local(order){class Worker{constructor(value){this.value=value}}return new Worker((order.push('local'),9)).value}window.local=local;`,
    'healthy.js':'import {inc,value} from "./shared.js";inc();window.healthyReady=value;document.getElementById("good").onclick=()=>{inc();document.getElementById("counter").textContent=String(value)};',
    'shared.js':'window.sharedInit=(window.sharedInit||0)+1;export let value=0;export function inc(){return ++value}',
  }}
  const project=createBlankCourseProjectV10('Worker diagnostic locality')
  project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'}}
  project.instances.web={id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const before=structuredClone(data)
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  expect(published.diagnostics).toEqual([]);expect(data).toEqual(before)
  const output=compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.scriptFactories).toHaveLength(1);expect(output.diagnostics).toHaveLength(3)
  expect(output.diagnostics.every(issue=>issue.code==='dynamic-program'&&issue.blocking===false)).toBe(true)
  expect(compilePublishedScriptModule("export function dormant(){return new Worker('missing.js')}").factorySource).toBe('')
  const dormantClassic=compilePublishedWebProgram({html:"<script>function dormant(){return new Worker('missing.js')}window.healthy=1</script>"})
  expect(dormantClassic.classicPrograms).toHaveLength(1)
  expect(dormantClassic.diagnostics).toMatchObject([{code:'dynamic-program',blocking:false}])
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage(),errors:string[]=[],requests:string[]=[],workers:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())});page.on('worker',worker=>workers.push(worker.url()))
    await page.route(/^https?:/,route=>route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true);await page.addScriptTag({content:bundle.outputFiles[0].text})
    const observed=await page.evaluate(async output=>{
      const events:any[]=[],runtime=(window as any).CompiledProbe
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'worker-locality'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:[],handlerFactories:[]})
      const initial={worker:env.globals.workerEntryReady,healthy:env.globals.healthyReady,init:env.globals.sharedInit,events:events.length}
      env.root.querySelector('#good').click();const first=env.root.querySelector('#counter').textContent
      let argumentError:any;try{env.globals.argumentFails()}catch(error:any){argumentError={name:error.name,message:error.message}}
      const afterArgument=events.length,failures:any[]=[]
      for(const kind of ['bare','member']){const order:string[]=[];let error:any;try{env.globals[kind](order)}catch(value:any){error=value}failures.push({kind,order,name:error?.name,message:error?.message})}
      const localOrder:string[]=[],local=env.globals.local(localOrder)
      env.root.querySelector('#good').click();const second=env.root.querySelector('#counter').textContent,beforeDispose=events.length,outer={...document.body.dataset}
      env.dispose();try{env.globals.bare([])}catch{}
      return {initial,first,second,argumentError,afterArgument,failures,local,localOrder,events,beforeDispose,afterDispose:events.length,outer,online:navigator.onLine,iframes:document.querySelectorAll('iframe').length}
    },output)
    expect(observed).toMatchObject({initial:{worker:1,healthy:2,init:1,events:0},first:'3',second:'4',argumentError:{name:'Error',message:'argument-sentinel'},afterArgument:0,local:9,localOrder:['local'],beforeDispose:2,afterDispose:2,outer:{},online:false,iframes:0})
    expect(observed.failures.map((failure:any)=>({kind:failure.kind,order:failure.order,name:failure.name}))).toEqual([{kind:'bare',order:['source','spread'],name:'TypeError'},{kind:'member',order:['source','spread'],name:'TypeError'}])
    expect(observed.failures[0].message).toContain('组件 worker-locality 的 Worker');expect(observed.failures[1].message).toContain('组件 worker-locality 的 SharedWorker')
    expect(observed.events.every((event:any)=>event.type==='component.diagnostic'&&event.payload.message.includes('组件 worker-locality'))).toBe(true)
    expect(errors).toEqual([]);expect(requests).toEqual([]);expect(workers).toEqual([])
  }finally{await browser.close()}
},30000)

it('keeps classic programs and HTML handlers with dormant Worker constructors usable', async () => {
  const data={html:`<section id="script-scope"><button id="classic">增加</button><output id="classic-count">4</output>
    <button id="handler" onclick="function dormantHandler(order){return new window['SharedWorker']((order.push('source'),'missing.js'),...(order.push('spread'),[{}]))}window.requestHandler=dormantHandler;window.handlerClicks=(window.handlerClicks||0)+1">handler</button>
    <script id="owner-script">let count=4;var globalValue=8;
    function dormantWorker(order){return new Worker((order.push('source'),'missing.js'),...(order.push('spread'),[{}]))}
    window.classicReady=count;window.readClassic=()=>count;window.requestClassic=dormantWorker;
    document.currentScript.closest('section').dataset.classic='ready';window.currentScriptId=document.currentScript.id;
    document.getElementById('classic').onclick=()=>{count++;document.getElementById('classic-count').textContent=String(count)};</script>
    <script>window.laterRead=count;window.independentSibling=1;</script></section>`}
  const project=createBlankCourseProjectV10('Classic Worker locality')
  project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'}}
  project.instances.web={id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const before=structuredClone(data)
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  expect(published.diagnostics).toEqual([]);expect(data).toEqual(before)
  const output=compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.classicPrograms.map(program=>program.index)).toEqual([0,1]);expect(output.handlerFactories).toHaveLength(1)
  expect(output.diagnostics).toHaveLength(2);expect(output.diagnostics.every(issue=>issue.code==='dynamic-program'&&issue.blocking===false)).toBe(true)
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage(),errors:string[]=[],requests:string[]=[],workers:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())});page.on('worker',worker=>workers.push(worker.url()))
    await page.route(/^https?:/,route=>route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true);await page.addScriptTag({content:bundle.outputFiles[0].text})
    const observed=await page.evaluate(async output=>{
      const events:any[]=[],runtime=(window as any).CompiledProbe
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'classic-worker'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      await env.initialize([],{classicPrograms:output.classicPrograms.map(program=>({index:program.index,kind:program.kind,activate:Function(`return (${program.factorySource})`)()})),handlerFactories:output.handlerFactories.map(code=>Function(`return (${code})`)())})
      const initial={ready:env.globals.classicReady,read:env.globals.readClassic(),lexicalWindow:env.globals.count??null,globalValue:env.globals.globalValue,later:env.globals.laterRead,sibling:env.globals.independentSibling,currentScriptId:env.globals.currentScriptId,scriptScope:env.root.querySelector('#script-scope').dataset.classic,events:events.length}
      env.root.querySelector('#classic').click();env.root.querySelector('#handler').click()
      const first={count:env.root.querySelector('#classic-count').textContent,handlerClicks:env.globals.handlerClicks,read:env.globals.readClassic(),events:events.length}
      const failures:any[]=[]
      for(const name of ['requestClassic','requestHandler']){const order:string[]=[];let error:any;try{env.globals[name](order)}catch(value:any){error=value}failures.push({name,order,error:error?.name,message:error?.message})}
      env.root.querySelector('#classic').click();env.root.querySelector('#handler').click()
      const after={count:env.root.querySelector('#classic-count').textContent,handlerClicks:env.globals.handlerClicks,read:env.globals.readClassic(),currentScriptNull:env.globals.document.currentScript===null,events:events.length},outer={...document.body.dataset}
      env.dispose();try{env.globals.requestClassic([])}catch{}
      return {initial,first,failures,after,events,afterDispose:events.length,outer,online:navigator.onLine,iframes:document.querySelectorAll('iframe').length}
    },output)
    expect(observed).toMatchObject({initial:{ready:4,read:4,lexicalWindow:null,globalValue:8,later:4,sibling:1,currentScriptId:'owner-script',scriptScope:'ready',events:0},first:{count:'5',handlerClicks:1,read:5,events:0},after:{count:'6',handlerClicks:2,read:6,currentScriptNull:true,events:2},afterDispose:2,outer:{},online:false,iframes:0})
    expect(observed.failures.map((failure:any)=>({name:failure.name,order:failure.order,error:failure.error}))).toEqual([{name:'requestClassic',order:['source','spread'],error:'TypeError'},{name:'requestHandler',order:['source','spread'],error:'TypeError'}])
    expect(observed.failures[0].message).toContain('组件 classic-worker 的 Worker');expect(observed.failures[1].message).toContain('组件 classic-worker 的 SharedWorker')
    expect(observed.events.every((event:any)=>event.type==='component.diagnostic'&&event.payload.message.includes('组件 classic-worker'))).toBe(true)
    expect(errors).toEqual([]);expect(requests).toEqual([]);expect(workers).toEqual([])
  }finally{await browser.close()}
},30000)

it('keeps Web modules, classic programs and handlers with dormant Function and eval usable', async () => {
  const data={html:`<button id="good">module</button><output id="counter">0</output><button id="classic">classic</button><output id="classic-count">4</output>
    <button id="handler" onclick="function dormantHandler(){return window.Function('return 7')}window.requestHandler=dormantHandler;window.handlerClicks=(window.handlerClicks||0)+1">handler</button>
    <script>let count=4;var globalValue=8;function dormantClassic(){return Function('return 7')}function dormantClassicEval(){return window.eval('7')}
    window.classicReady=count;document.getElementById('classic').onclick=()=>{count++;document.getElementById('classic-count').textContent=String(count)};</script>
    <script>window.laterRead=count;window.independentSibling=1</script>
    <script type="module" src="./dynamic-entry.js"></script><script type="module" src="./healthy.js"></script>`,modules:{
    'dynamic-entry.js':`import {inc,value} from './shared.js';inc();window.dynamicEntryReady=value;
      export function create(order){return window['Function']((order.push('source'),'document.body.dataset.outside=1'),...(order.push('spread'),[]))}window.createDynamic=create;
      export function evaluate(order){return eval((order.push('source'),'document.body.dataset.outside=1'),...(order.push('spread'),[]))}window.evaluateDynamic=evaluate;
      export function argumentFails(){return Function((()=>{throw new Error('argument-sentinel')})())}window.argumentFails=argumentFails;`,
    'healthy.js':'import {inc,value} from "./shared.js";inc();window.healthyReady=value;document.getElementById("good").onclick=()=>{inc();document.getElementById("counter").textContent=String(value)};',
    'shared.js':'window.sharedInit=(window.sharedInit||0)+1;export let value=0;export function inc(){return ++value}',
  }}
  const project=createBlankCourseProjectV10('Dynamic program locality')
  project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'}}
  project.instances.web={id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const before=structuredClone(data)
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  expect(published.diagnostics.some(issue=>issue.code==='source-compile-warning'&&issue.message.includes('Using direct eval'))).toBe(true)
  expect(published.diagnostics.every(issue=>issue.code==='source-compile-warning')).toBe(true);expect(data).toEqual(before)
  const output=compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.scriptFactories).toHaveLength(1);expect(output.classicPrograms.map(program=>program.index)).toEqual([0,1]);expect(output.handlerFactories).toHaveLength(1)
  expect(output.diagnostics.length).toBeGreaterThanOrEqual(5);expect(output.diagnostics.every(issue=>issue.code==='dynamic-program'&&issue.blocking===false)).toBe(true)
  expect(compilePublishedScriptModule('export function mount(){return Function("return 7")}').factorySource).toBe('')
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage(),errors:string[]=[],requests:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())})
    await page.route(/^https?:/,route=>route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true);await page.addScriptTag({content:bundle.outputFiles[0].text})
    const observed=await page.evaluate(async output=>{
      const events:any[]=[],runtime=(window as any).CompiledProbe
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'dynamic-locality'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:output.classicPrograms.map(program=>({index:program.index,kind:program.kind,activate:Function(`return (${program.factorySource})`)()})),handlerFactories:output.handlerFactories.map(code=>Function(`return (${code})`)())})
      const initial={dynamic:env.globals.dynamicEntryReady,healthy:env.globals.healthyReady,init:env.globals.sharedInit,classic:env.globals.classicReady,var:env.globals.globalValue,later:env.globals.laterRead,sibling:env.globals.independentSibling,events:events.length}
      const click=()=>{env.root.querySelector('#good').click();env.root.querySelector('#classic').click();env.root.querySelector('#handler').click();return{module:env.root.querySelector('#counter').textContent,classic:env.root.querySelector('#classic-count').textContent,handler:env.globals.handlerClicks,events:events.length}}
      const first=click();let argumentError:any;try{env.globals.argumentFails()}catch(error:any){argumentError={name:error.name,message:error.message}}
      const afterArgument=events.length,failures:any[]=[]
      for(const name of ['createDynamic','evaluateDynamic']){const order:string[]=[];let error:any;try{env.globals[name](order)}catch(value:any){error=value}failures.push({name,order,error:error?.name,message:error?.message})}
      const after=click(),outer={...document.body.dataset};env.dispose()
      return {initial,first,argumentError,afterArgument,failures,after,events,outer,online:navigator.onLine,iframes:document.querySelectorAll('iframe').length}
    },output)
    expect(observed).toMatchObject({initial:{dynamic:1,healthy:2,init:1,classic:4,var:8,later:4,sibling:1,events:0},first:{module:'3',classic:'5',handler:1,events:0},argumentError:{name:'Error',message:'argument-sentinel'},afterArgument:0,after:{module:'4',classic:'6',handler:2,events:2},outer:{},online:false,iframes:0})
    expect(observed.failures.map((failure:any)=>({name:failure.name,order:failure.order,error:failure.error}))).toEqual([{name:'createDynamic',order:['source','spread'],error:'TypeError'},{name:'evaluateDynamic',order:['source','spread'],error:'TypeError'}])
    expect(observed.failures[0].message).toContain('组件 dynamic-locality 的 Function');expect(observed.failures[1].message).toContain('组件 dynamic-locality 的 eval')
    expect(observed.events.every((event:any)=>event.type==='component.diagnostic'&&event.payload.message.includes('组件 dynamic-locality'))).toBe(true)
    expect(errors).toEqual([]);expect(requests).toEqual([])
  }finally{await browser.close()}
},30000)

it('keeps Web modules, classic programs and handlers with dormant string timers usable', async () => {
  const data={html:`<button id="good">module</button><output id="counter">0</output><button id="classic">classic</button><output id="classic-count">4</output>
    <button id="handler" onclick="function dormantHandler(){return window.setTimeout('document.body.dataset.outside=1',0)}window.requestHandler=dormantHandler;window.handlerClicks=(window.handlerClicks||0)+1">handler</button>
    <script>let count=4;var globalValue=8;function dormantClassic(){return window.setInterval('document.body.dataset.outside=1',0)}
    window.classicReady=count;document.getElementById('classic').onclick=()=>{count++;document.getElementById('classic-count').textContent=String(count)};</script>
    <script>window.laterRead=count;window.independentSibling=1</script>
    <script type="module" src="./timer-entry.js"></script><script type="module" src="./healthy.js"></script>`,modules:{
    'timer-entry.js':`import {inc,value} from './shared.js';inc();window.timerEntryReady=value;
      export function dormantTimer(order){return setTimeout('document.body.dataset.outside=1',(order.push('delay'),0),...(order.push('args'),[7]))}window.requestTimer=dormantTimer;`,
    'healthy.js':'import {inc,value} from "./shared.js";inc();window.healthyReady=value;document.getElementById("good").onclick=()=>{inc();document.getElementById("counter").textContent=String(value)};',
    'shared.js':'window.sharedInit=(window.sharedInit||0)+1;export let value=0;export function inc(){return ++value}',
  }}
  const project=createBlankCourseProjectV10('String timer locality')
  project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'}}
  project.instances.web={id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const before=structuredClone(data)
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  expect(published.diagnostics).toEqual([]);expect(data).toEqual(before)
  const output=compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.scriptFactories).toHaveLength(1);expect(output.classicPrograms.map(program=>program.index)).toEqual([0,1]);expect(output.handlerFactories).toHaveLength(1)
  expect(output.diagnostics).toHaveLength(3);expect(output.diagnostics.every(issue=>issue.code==='string-timer'&&issue.blocking===false)).toBe(true)
  expect(compilePublishedScriptModule('export function mount(){return setTimeout("window.dynamic=1",0)}').factorySource).toBe('')
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage(),errors:string[]=[],requests:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())})
    await page.route(/^https?:/,route=>route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true);await page.addScriptTag({content:bundle.outputFiles[0].text})
    const observed=await page.evaluate(async output=>{
      const events:any[]=[],runtime=(window as any).CompiledProbe
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'timer-locality'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:output.classicPrograms.map(program=>({index:program.index,kind:program.kind,activate:Function(`return (${program.factorySource})`)()})),handlerFactories:output.handlerFactories.map(code=>Function(`return (${code})`)())})
      const initial={timer:env.globals.timerEntryReady,healthy:env.globals.healthyReady,init:env.globals.sharedInit,classic:env.globals.classicReady,var:env.globals.globalValue,later:env.globals.laterRead,sibling:env.globals.independentSibling,events:events.length}
      const click=()=>{env.root.querySelector('#good').click();env.root.querySelector('#classic').click();env.root.querySelector('#handler').click();return{module:env.root.querySelector('#counter').textContent,classic:env.root.querySelector('#classic-count').textContent,handler:env.globals.handlerClicks,events:events.length}}
      const first=click(),order:string[]=[];let timerError:any;try{env.globals.requestTimer(order)}catch(error:any){timerError={name:error.name,message:error.message}}
      await new Promise(resolve=>window.setTimeout(resolve,20))
      const after=click(),outer={...document.body.dataset};env.dispose()
      return {initial,first,order,timerError,after,events,outer,online:navigator.onLine,iframes:document.querySelectorAll('iframe').length}
    },output)
    expect(observed).toMatchObject({initial:{timer:1,healthy:2,init:1,classic:4,var:8,later:4,sibling:1,events:0},first:{module:'3',classic:'5',handler:1,events:0},order:['delay','args'],timerError:{name:'TypeError',message:'同文档程序的计时器需要函数回调'},after:{module:'4',classic:'6',handler:2,events:0},events:[],outer:{},online:false,iframes:0})
    expect(errors).toEqual([]);expect(requests).toEqual([])
  }finally{await browser.close()}
},30000)

it('keeps Web modules, classic programs and handlers with dormant document parser calls usable', async () => {
  const data={html:`<section id="preserved"><button id="good">module</button><output id="counter">0</output><button id="classic">classic</button><output id="classic-count">4</output>
    <button id="handler" onclick="function dormantClose(order){return document.close(...(order.push('close'),[7]))}window.requestClose=dormantClose;window.handlerClicks=(window.handlerClicks||0)+1">handler</button>
    <script>let count=4;var globalValue=8;function dormantOpen(order){return document.open((order.push('open'),'text/html'))}window.requestOpen=dormantOpen;
    window.classicReady=count;document.getElementById('classic').onclick=()=>{count++;document.getElementById('classic-count').textContent=String(count)};</script>
    <script>window.laterRead=count;window.independentSibling=1</script>
    <script type="module" src="./parser-entry.js"></script><script type="module" src="./healthy.js"></script></section>`,modules:{
    'parser-entry.js':`import {inc,value} from './shared.js';inc();window.parserEntryReady=value;
      export function dormantWrite(order){return document.write((order.push('write'),'<p id="unexpected">rewrite</p>'))}window.requestWrite=dormantWrite;
      export function dormantWriteln(order){return document.writeln((order.push('writeln'),'<p id="unexpected">rewrite</p>'))}window.requestWriteln=dormantWriteln;`,
    'healthy.js':'import {inc,value} from "./shared.js";inc();window.healthyReady=value;document.getElementById("good").onclick=()=>{inc();document.getElementById("counter").textContent=String(value)};',
    'shared.js':'window.sharedInit=(window.sharedInit||0)+1;export let value=0;export function inc(){return ++value}',
  }}
  const project=createBlankCourseProjectV10('Document parser locality')
  project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'}}
  project.instances.web={id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const before=structuredClone(data)
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  expect(published.diagnostics).toEqual([]);expect(data).toEqual(before)
  const output=compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.scriptFactories).toHaveLength(1);expect(output.classicPrograms.map(program=>program.index)).toEqual([0,1]);expect(output.handlerFactories).toHaveLength(1)
  expect(output.diagnostics).toHaveLength(4);expect(output.diagnostics.every(issue=>issue.code==='document-parser'&&issue.blocking===false)).toBe(true)
  expect(compilePublishedScriptModule('export function mount(){document.write("<p>content</p>")}').factorySource).toBe('')
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage(),errors:string[]=[],requests:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())})
    await page.route(/^https?:/,route=>route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true);await page.addScriptTag({content:bundle.outputFiles[0].text})
    const observed=await page.evaluate(async output=>{
      const events:any[]=[],runtime=(window as any).CompiledProbe
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'parser-locality'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:output.classicPrograms.map(program=>({index:program.index,kind:program.kind,activate:Function(`return (${program.factorySource})`)()})),handlerFactories:output.handlerFactories.map(code=>Function(`return (${code})`)())})
      const preserved=env.root.querySelector('#preserved')
      const initial={parser:env.globals.parserEntryReady,healthy:env.globals.healthyReady,init:env.globals.sharedInit,classic:env.globals.classicReady,var:env.globals.globalValue,later:env.globals.laterRead,sibling:env.globals.independentSibling,events:events.length}
      const click=()=>{env.root.querySelector('#good').click();env.root.querySelector('#classic').click();env.root.querySelector('#handler').click();return{module:env.root.querySelector('#counter').textContent,classic:env.root.querySelector('#classic-count').textContent,handler:env.globals.handlerClicks,events:events.length}}
      const first=click(),failures:any[]=[]
      for(const method of ['Write','Writeln','Open','Close']){const order:string[]=[];let error:any;try{env.globals['request'+method](order)}catch(value:any){error=value}failures.push({method:method.toLowerCase(),order,name:error?.name,message:error?.message})}
      const after=click(),rootPreserved=env.root.isConnected&&env.root.querySelector('#preserved')===preserved,unexpected=env.root.querySelector('#unexpected')!==null,outer={...document.body.dataset};env.dispose()
      return {initial,first,failures,after,events,rootPreserved,unexpected,outer,online:navigator.onLine,iframes:document.querySelectorAll('iframe').length}
    },output)
    expect(observed).toMatchObject({initial:{parser:1,healthy:2,init:1,classic:4,var:8,later:4,sibling:1,events:0},first:{module:'3',classic:'5',handler:1,events:0},after:{module:'4',classic:'6',handler:2,events:0},events:[],rootPreserved:true,unexpected:false,outer:{},online:false,iframes:0})
    expect(observed.failures.map((failure:any)=>({method:failure.method,order:failure.order,name:failure.name}))).toEqual(['write','writeln','open','close'].map(method=>({method,order:[method],name:'Error'})))
    observed.failures.forEach((failure:any)=>expect(failure.message).toContain(`document.${failure.method}()`))
    expect(errors).toEqual([]);expect(requests).toEqual([])
  }finally{await browser.close()}
},30000)

it('runs fixed import meta URL reads through the shared graph and Root Web and native child consumers', async () => {
  const body=`<button id="good">增加</button><output id="counter">0</output><button id="meta">metadata</button><output id="metadata">not called</output>
    <script type="module" src="./meta-entry.js?v=1#scope"></script><script type="module" src="./healthy.js"></script>`
  const child=`<!doctype html><html><body>${body}</body></html>`
  const data={html:`${body}<iframe id="child" srcdoc="${child.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`,modules:{
    'meta-entry.js':`import {inc,value} from './shared.js';inc();window.metaEntryReady=value;
      class Tagged{static url='constructor-sentinel';constructor(){this.seen=new.target.url}}
      window.readMeta=()=>({dot:import.meta.url,literal:import.meta['url'],constructor:new Tagged().seen});
      document.getElementById('meta').onclick=()=>{const result=window.readMeta();document.body.dataset.metadata=JSON.stringify(result);document.getElementById('metadata').textContent=JSON.stringify(result)};`,
    'healthy.js':'import {inc,value} from "./shared.js";inc();window.healthyReady=value;document.getElementById("good").onclick=()=>{inc();document.getElementById("counter").textContent=String(value)};',
    'shared.js':'window.sharedInit=(window.sharedInit||0)+1;export let value=0;export function inc(){return ++value}',
  }}
  const project=createBlankCourseProjectV10('Fixed meta URL')
  project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.html-program'}}
  project.instances.web={id:'web',definitionId:'web',data};project.surfaces[0].childIds=['web']
  const before=structuredClone(project),compilation=new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const author=await projectWebModuleGraph(project.instances.web,input=>compilation.compile(input))
  const authorData=author.data as unknown as WebRuntimeData
  expect(authorData.moduleGraph?.modules['meta-entry.js?v=1#scope'].code).toContain('https://guoling.local/meta-entry.js?v=1#scope')
  const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation})
  expect(published.diagnostics).toEqual([]);expect(project).toEqual(before)
  const output=compilePublishedWebProgram(published.payload.instances.web.data as unknown as WebRuntimeData)
  expect(output.scriptFactories).toHaveLength(1);expect(output.diagnostics).toEqual([])
  const bundle=await build({stdin:{contents:"export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CompiledProbe',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage(),errors:string[]=[],requests:string[]=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())})
    await page.route(/^https?:/,route=>route.abort());await page.setContent('<div id="root"></div>');await page.context().setOffline(true);await page.addScriptTag({content:bundle.outputFiles[0].text})
    await page.evaluate(async output=>{
      const events:any[]=[],runtime=(window as any).CompiledProbe
      const env=runtime.createCompiledContentEnvironment({root:document.getElementById('root'),instance:{id:'fixed-meta'},scope:{isActive:()=>true,events:{emit:(type:string,payload:unknown)=>events.push({type,payload})}}},output)
      ;(window as any).__metaProbe={env,events}
      await env.initialize(output.scriptFactories.map(code=>Function(`return (${code})`)()),{classicPrograms:[],handlerFactories:[]})
    },output)
    await page.waitForFunction(()=>{const frame=(window as any).__metaProbe.env.root.querySelector('#child');return frame?.contentWindow?.healthyReady===2})
    const observed=await page.evaluate(()=>{
      const {env,events}=(window as any).__metaProbe,frame=env.root.querySelector('#child'),targets=[{window:env.globals,document:env.globals.document},{window:frame.contentWindow,document:frame.contentDocument}]
      const results=targets.map(target=>{
        const initial={meta:target.window.metaEntryReady,healthy:target.window.healthyReady,init:target.window.sharedInit}
        target.document.getElementById('good').click();const first=target.document.getElementById('counter').textContent
        target.document.getElementById('meta').click();const metadata=JSON.parse(target.document.body.dataset.metadata)
        target.document.getElementById('good').click();const second=target.document.getElementById('counter').textContent
        return {initial,first,metadata,second,init:target.window.sharedInit}
      })
      const outer={...document.body.dataset},iframes=document.querySelectorAll('iframe').length,ownedFrames=env.root.querySelectorAll('iframe').length
      env.dispose();return {results,events,outer,iframes,ownedFrames,online:navigator.onLine}
    })
    for(const result of observed.results)expect(result).toEqual({initial:{meta:1,healthy:2,init:1},first:'3',metadata:{dot:'https://guoling.local/meta-entry.js?v=1#scope',literal:'https://guoling.local/meta-entry.js?v=1#scope',constructor:'constructor-sentinel'},second:'4',init:1})
    expect(observed).toMatchObject({events:[],outer:{},iframes:0,ownedFrames:1,online:false});expect(errors).toEqual([]);expect(requests).toEqual([])
  }finally{await browser.close()}
},30000)

it('uses existing layout modes for definite framed body height and natural Flow content height', async () => {
  const bundle = await build({ stdin: { contents: "export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'CompiledProbe', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<!doctype html><div id="frame" style="width:300px;height:200px"></div><div id="flow" style="width:300px;height:200px"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const result = await page.evaluate(() => {
      const runtime = (window as any).CompiledProbe
      const make = (id: string, initialMode: string) => {
        let mode = initialMode, listener: ((value: any) => void) | undefined, retired = 0
        const context = { root: document.getElementById(id), instance: { id, definitionId: 'web', data: {} }, scope: { isActive: () => true, signal: new AbortController().signal }, layout: { read: () => mode === 'flow-content' ? { mode, inlineSize: 300 } : { mode, inlineSize: 300, blockSize: 200 }, subscribe(fn: (value: any) => void) { listener = fn; return () => retired++ }, reportSize() {} } }
        return { context, change(next: string) { mode = next; listener!(context.layout.read()) }, retired: () => retired }
      }
      const framed = make('frame', 'free-frame'), natural = make('flow', 'flow-content')
      const frameEnv = runtime.createCompiledContentEnvironment(framed.context, { html: '<div id="lab" style="height:100%;display:flex;flex-direction:column"><div style="flex:1;min-height:0"></div><button id="reset">复位</button></div>', css: '' })
      const flowEnv = runtime.createCompiledContentEnvironment(natural.context, { html: '<div id="reading" style="height:540px">真实阅读高度</div>', css: '' })
      const height = (env: any) => ({ body: env.root.getBoundingClientRect().height, html: env.globals.document.documentElement.getBoundingClientRect().height, host: env.root.getRootNode().host.getBoundingClientRect().height })
      const frame = { ...height(frameEnv), lab: frameEnv.root.querySelector('#lab').getBoundingClientRect().height, resetWithinFrame: frameEnv.root.querySelector('#reset').getBoundingClientRect().bottom <= frameEnv.root.getBoundingClientRect().bottom }
      const flow = { ...height(flowEnv), reading: flowEnv.root.querySelector('#reading').getBoundingClientRect().height }
      framed.change('flow-viewport'); const viewport = height(frameEnv)
      natural.change('free-frame'); const switched = { ...height(flowEnv), reading: flowEnv.root.querySelector('#reading').getBoundingClientRect().height }
      frameEnv.dispose(); flowEnv.dispose()
      return { frame, flow, viewport, switched, retired: [framed.retired(), natural.retired()] }
    })
    expect(result).toEqual({ frame: { body: 200, html: 200, host: 200, lab: 200, resetWithinFrame: true }, flow: { body: 540, html: 540, host: 540, reading: 540 }, viewport: { body: 200, html: 200, host: 200 }, switched: { body: 200, html: 200, host: 200, reading: 540 }, retired: [1, 1] })
  } finally { await browser.close() }
}, 30000)
