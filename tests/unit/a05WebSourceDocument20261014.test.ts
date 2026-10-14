// @vitest-environment node
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'
import { chromium } from '@playwright/test'
import { expect, it } from 'vitest'

const workspace = process.cwd()
const candidate = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Candidate leaves override their original peers; packages keep normal resolution. */
function candidateSources(): Plugin {
  const inside = (root: string, path: string) => {
    const value = relative(root, path)
    return value === '' || !value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)
  }
  const file = (path: string) => ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']
    .map(extension => path + extension).find(value => existsSync(value) && statSync(value).isFile())
  return { name: 'a05-candidate-relative-fallback', setup(plugin) {
    plugin.onResolve({ filter: /^\./ }, args => {
      const raw = args.path.endsWith('?raw'), requested = resolve(args.resolveDir, raw ? args.path.slice(0, -4) : args.path)
      const original = inside(candidate, requested) ? resolve(workspace, relative(candidate, requested)) : requested
      if (!inside(workspace, original) || relative(workspace, original).split(sep).includes('node_modules')) return undefined
      const chosen = file(resolve(candidate, relative(workspace, original))) ?? file(original)
      return chosen ? { path: chosen, ...(raw ? { namespace: 'a05-raw' } : {}) } : undefined
    })
    plugin.onLoad({ filter: /.*/, namespace: 'a05-raw' }, async args => ({
      contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path),
    }))
  } }
}

const wrappedSource = `
import mature from './src/components/builtin-source/web';
window.__a05SourceImports=(window.__a05SourceImports||0)+1;
window.__a05BootTrace=['source-import:'+document.readyState];
let count=40;
const token=Math.random();
window.__a05SourceInspect=()=>({count,token,imports:window.__a05SourceImports});
export default {...mature, async mount(context){
  window.__a05BootTrace.push('source-mount:'+document.readyState);
  window.__a05Trace.push('source-mount:'+document.readyState);
  const mounted=await mature.mount(context);
  window.__a05SeenData=context.instance.data.business;
  window.__a05SeenBinding=context.instance.data.resourceBindings;
  const button=document.createElement('button'),output=document.createElement('output');
  button.id='business-button';output.id='business-count';button.textContent=context.instance.data.business.label;output.textContent=String(count);
  button.addEventListener('click',()=>{output.textContent=String(++count);context.scope.events.emit('business.changed',{count})});
  context.root.append(button,output);
  return {...mounted,async update(next){await mounted.update(next);window.__a05SeenData=next.data.business;button.textContent=next.data.business.label},
    dispose(){window.__a05SourceDisposed=true;mounted.dispose()}};
}};`

// Importing the mature module alone is not permission to execute retained HTML.
const replacedSource = `
import mature from './src/components/builtin-source/web';
window.__a05SourceImports=(window.__a05SourceImports||0)+1;
let clicks=0;
export default {mount(context){
  window.__a05Replacement={matureHasDocument:mature.document==='web',business:context.instance.data.business};
  const button=document.createElement('button');button.id='replacement';button.textContent='replacement:0';
  button.addEventListener('click',()=>{button.textContent='replacement:'+ ++clicks});context.root.append(button);
  return {update(next){window.__a05Replacement.business=next.data.business},dispose(){button.remove()}};
}};`

let bundles: Promise<{ host: string; wrapped: string; replaced: string }> | undefined
function compileFixtures() {
  bundles ??= Promise.all([
    build({ stdin: { contents: `
      export {preparePublishedNativeComponent} from './src/player/components/runtime/SandboxComponentRuntime';
      export {resolveWebResourceBindings} from './src/components/web/resources';`, resolveDir: candidate, loader: 'ts' },
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'A05Sandbox', target: 'es2022', plugins: [candidateSources()] }),
    ...[wrappedSource, replacedSource].map(contents => build({ stdin: { contents, resolveDir: candidate, loader: 'ts' },
      bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', plugins: [candidateSources()] })),
  ]).then(([host, wrapped, replaced]) => ({ host: host!.outputFiles[0]!.text, wrapped: wrapped!.outputFiles[0]!.text, replaced: replaced!.outputFiles[0]!.text }))
  return bundles
}

async function fixture() {
  const code = await compileFixtures(), browser = await chromium.launch({ headless: true })
  const page = await browser.newPage(), errors: string[] = []
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><main id="source" style="width:640px;height:360px"></main>')
  await page.addScriptTag({ content: code.host })
  await page.evaluate(() => {
    const abort = new AbortController(), events = new Map<string, Set<(value: any) => void>>(), cleanups = new Set<() => void>()
    const q: any = { abort, events, diagnostics: [], businessEvents: [], activity: { active: true, visible: true, playing: true } }
    q.emit = (name: string, value: any) => { for (const listener of events.get(name) ?? []) listener(value) }
    q.scope = { instanceId: 'source', runScopeId: 'a05-web-source-document', generation: 1, signal: abort.signal,
      isActive: () => !abort.signal.aborted, cleanup(callback: () => void) { cleanups.add(callback) }, target: () => null,
      state: { get: () => undefined, set() {}, subscribe: () => () => {} },
      events: { emit(name: string, value: any) {
        if (name === 'component.diagnostic') q.diagnostics.push(value)
        if (name === 'business.changed') q.businessEvents.push(value)
        q.emit(name, value)
      }, subscribe(name: string, listener: (value: any) => void) {
        const set = events.get(name) ?? new Set(); events.set(name, set); set.add(listener)
        if (name === '__runtime.activity') listener(q.activity)
        return () => set.delete(listener)
      } } }
    q.release = async () => { await q.mounted?.dispose(); q.prepared?.release(); abort.abort(); for (const cleanup of cleanups) cleanup() }
    ;(window as any).__a05Sandbox = q
  })
  return { page, errors, code, close: async () => { try { await page.evaluate(() => (window as any).__a05Sandbox.release()) } finally { await browser.close() } } }
}

it('inherits mature Web document preparation without replaying Source imports and preserves parser, nested modules, resources and business data', async () => {
  const f = await fixture()
  try {
    await f.page.evaluate(async code => {
      const q = (window as any).__a05Sandbox, api = (window as any).A05Sandbox
      const nested = '<!doctype html><html><body><output id="nested-output">pending</output><script type="module" src="nested.js"></script></body></html>'
      const html = `<!doctype html><html lang="zh-CN" data-authored="kept"><head data-owner="author"><title>Authored document</title>
        <script>window.__a05Trace=['classic:'+document.readyState];window.__a05BootTrace.push('authored-classic:'+document.readyState);window.__a05ClassicRuns=(window.__a05ClassicRuns||0)+1;
          document.addEventListener('readystatechange',()=>window.__a05Trace.push('ready:'+document.readyState));
          document.addEventListener('DOMContentLoaded',event=>{window.__a05DclTrusted=event.isTrusted;window.__a05Trace.push('dcl:'+document.readyState)});
          window.addEventListener('load',()=>window.__a05Trace.push('load:'+document.readyState));
          window.__a05Activity=[];window.addEventListener('__runtime.activity',event=>window.__a05Activity.push(event.detail));</script>
        <script type="module" src="root.js"></script></head><body><output id="module-output">pending</output><img id="bound-image" src="cw-resource:poster">
        <iframe id="owned" srcdoc="${nested.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body></html>`
      q.resources = { 'asset-poster': `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="red"/></svg>')}` }
      q.instance = { id: 'source', definitionId: 'professional-web-source', frame: { x: 0, y: 0, width: 640, height: 360 }, data: {
        html, css: '#module-output{font-weight:700}', resourceBindings: { 'cw-resource:poster': 'asset-poster' },
        business: { label: 'Increase order', order: { id: 'invoice-7', lines: [{ amount: 19, note: 'preserve nested business fields' }] }, enabled: false },
        moduleGraph: { entries: { '1': 'root.js', '0:0': 'nested.js' }, modules: {
          'root.js': { code: "window.__a05ModuleRuns=(window.__a05ModuleRuns||0)+1;document.getElementById('module-output').textContent='root module ready';window.__a05Trace.push('module:'+document.readyState)", imports: [] },
          'nested.js': { code: "window.__a05NestedRuns=(window.__a05NestedRuns||0)+1;document.getElementById('nested-output').textContent='nested module ready'", imports: [] },
        } },
      } }
      q.prepared = await api.preparePublishedNativeComponent({ format: 'esm', code, css: '#business-button{color:rgb(12,34,56)}', diagnostics: [] }, q.abort.signal, {
        state: () => ({}), targets: () => [], resources: () => q.resources,
        themeCss: () => 'body{--a05-theme:retained}', authorHtml: (value: any) => value.data.html,
        webInstance: (value: any) => api.resolveWebResourceBindings(value, (id: string) => q.resources[id], (message: string) => q.diagnostics.push(message)),
      })
      q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'), instance: q.instance, scope: q.scope })
      q.frame = document.querySelector('#source > iframe'); q.src = q.frame.src
    }, f.code.wrapped)
    const child = f.page.frameLocator('#source > iframe'), nested = child.frameLocator('#owned')
    await child.locator('#module-output').waitFor(); await nested.locator('#nested-output').waitFor()
    await expect.poll(() => child.locator('#module-output').textContent()).toBe('root module ready')
    await expect.poll(() => nested.locator('#nested-output').textContent()).toBe('nested module ready')
    await expect.poll(() => child.locator('#bound-image').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(2)
    await expect.poll(() => child.locator('body').evaluate(() => (window as any).__a05Trace.includes('load:complete'))).toBe(true)
    const initial = await child.locator('body').evaluate(() => ({
      source: (window as any).__a05SourceInspect(), trace: (window as any).__a05Trace, bootTrace: (window as any).__a05BootTrace,
      dclTrusted: (window as any).__a05DclTrusted,
      classicRuns: (window as any).__a05ClassicRuns, moduleRuns: (window as any).__a05ModuleRuns,
      business: (window as any).__a05SeenData, bindings: (window as any).__a05SeenBinding,
      lang: document.documentElement.lang, authored: document.documentElement.dataset.authored, headOwner: document.head.dataset.owner,
      color: getComputedStyle(document.getElementById('business-button')!).color,
      theme: getComputedStyle(document.body).getPropertyValue('--a05-theme').trim(), activity: (window as any).__a05Activity,
    }))
    expect(initial.source).toMatchObject({ count: 40, imports: 1 })
    expect(initial.trace[0]).toBe('classic:loading')
    // Chromium's script-created parser may report complete before its modules
    // and DCL. Require native events and initialization order, not that incidental state.
    const trace: string[] = initial.trace, observedTrace = JSON.stringify({ trace, bootTrace: initial.bootTrace })
    const dclIndex = trace.findIndex(entry => entry.startsWith('dcl:'))
    const moduleIndex = trace.findIndex(entry => entry.startsWith('module:'))
    expect(initial.dclTrusted).toBe(true)
    expect(trace.filter(entry => entry.startsWith('dcl:')), observedTrace).toHaveLength(1)
    expect(moduleIndex, observedTrace).toBeGreaterThan(-1)
    expect(moduleIndex, observedTrace).toBeLessThan(dclIndex)
    expect(dclIndex, observedTrace).toBeLessThan(trace.indexOf('load:complete'))
    expect(dclIndex, observedTrace).toBeLessThan(trace.findIndex(entry => entry.startsWith('source-mount:')))
    expect(initial).toMatchObject({ classicRuns: 1, moduleRuns: 1, lang: 'zh-CN', authored: 'kept', headOwner: 'author',
      color: 'rgb(12, 34, 56)', theme: 'retained', bindings: { 'cw-resource:poster': 'asset-poster' },
      business: { label: 'Increase order', order: { id: 'invoice-7', lines: [{ amount: 19, note: 'preserve nested business fields' }] }, enabled: false } })
    expect(initial.activity).toContainEqual({ active: true, visible: true, playing: true })
    expect(await nested.locator('body').evaluate(() => (window as any).__a05NestedRuns)).toBe(1)
    await child.locator('#business-button').click()
    expect(await child.locator('#business-count').textContent()).toBe('41')
    await expect.poll(() => f.page.evaluate(() => (window as any).__a05Sandbox.businessEvents)).toEqual([{ count: 41 }])
    await f.page.evaluate(async () => {
      const q = (window as any).__a05Sandbox
      q.instance = { ...q.instance, data: { ...q.instance.data, business: { ...q.instance.data.business, label: 'Continue order', next: { retained: true } } } }
      await q.mounted.update(q.instance)
      q.emit('__runtime.activity', { active: true, visible: true, playing: false })
    })
    await expect.poll(() => child.locator('#business-button').textContent()).toBe('Continue order')
    await expect.poll(() => child.locator('body').evaluate(() => (window as any).__a05Activity.at(-1))).toEqual({ active: true, visible: true, playing: false })
    await child.locator('#business-button').click()
    const final = await child.locator('body').evaluate(() => ({ source: (window as any).__a05SourceInspect(), business: (window as any).__a05SeenData,
      classicRuns: (window as any).__a05ClassicRuns, moduleRuns: (window as any).__a05ModuleRuns }))
    expect(final.source).toEqual({ ...initial.source, count: 42 })
    expect(final).toMatchObject({ classicRuns: 1, moduleRuns: 1, business: { ...initial.business, label: 'Continue order', next: { retained: true } } })
    expect(await f.page.evaluate(() => { const q = (window as any).__a05Sandbox; return {
      sameFrame: q.frame === document.querySelector('#source > iframe'), sameUrl: q.src === q.frame.src,
      originalToken: q.instance.data.html.includes('src="cw-resource:poster"'), diagnostics: q.diagnostics,
    } })).toEqual({ sameFrame: true, sameUrl: true, originalToken: true, diagnostics: [] })
    expect(f.errors).toEqual([])
  } finally { await f.close() }
}, 30000)

it('does not execute retained HTML when Source replaces the mature default without its document declaration', async () => {
  const f = await fixture()
  try {
    await f.page.evaluate(async code => {
      const q = (window as any).__a05Sandbox, api = (window as any).A05Sandbox
      q.instance = { id: 'source', definitionId: 'professional-web-source', data: {
        html: '<!doctype html><html><body><p id="legacy">legacy HTML</p><script>window.__a05LegacyExecuted=true;parent.postMessage("a05.legacy.executed","*")</script></body></html>',
        business: { replacement: true, untouched: { value: 73 } },
        modules: { 'unused-broken.js': 'import {' },
      } }
      q.legacyMessages = 0; window.addEventListener('message', event => { if (event.data === 'a05.legacy.executed') q.legacyMessages++ })
      q.prepared = await api.preparePublishedNativeComponent({ format: 'esm', code, css: '', diagnostics: [] }, q.abort.signal,
        { state: () => ({}), targets: () => [], authorHtml: (value: any) => value.data.html,
          webInstance: () => { throw new Error('Undeclared Web data must not be prepared') } })
      q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'), instance: q.instance, scope: q.scope })
    }, f.code.replaced)
    const child = f.page.frameLocator('#source > iframe')
    await child.locator('#replacement').click()
    expect(await child.locator('#replacement').textContent()).toBe('replacement:1')
    expect(await child.locator('body').evaluate(() => ({
      imports: (window as any).__a05SourceImports, replacement: (window as any).__a05Replacement,
      legacyExecuted: (window as any).__a05LegacyExecuted === true, legacyDom: Boolean(document.getElementById('legacy')),
    }))).toEqual({ imports: 1, replacement: { matureHasDocument: true, business: { replacement: true, untouched: { value: 73 } } }, legacyExecuted: false, legacyDom: false })
    expect(await f.page.evaluate(() => ({ messages: (window as any).__a05Sandbox.legacyMessages, diagnostics: (window as any).__a05Sandbox.diagnostics })))
      .toEqual({ messages: 0, diagnostics: [] })
    expect(f.errors).toEqual([])
  } finally { await f.close() }
}, 30000)
