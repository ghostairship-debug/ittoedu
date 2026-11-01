// @vitest-environment node
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { expect, it } from 'vitest'

it('adopts the late parser resource owner, rebinds author images in a fresh realm and releases both URL generations', async () => {
  const bundle = await build({ entryPoints: [resolve('src/player/components/runtime/SandboxComponentRuntime.ts')],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'LeaseProbe', target: 'es2022',
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle.outputFiles[0]!.text
      : '<!doctype html><div id="source" style="width:320px;height:160px"></div><script src="/probe.js"></script>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    // Observe the real Blob owner without changing its allocation/release or
    // resource bytes. document.open retains the same Window and these wrappers.
    await context.addInitScript(() => {
      if (window === parent || (window as any).__leaseTraceInstalled) return
      ;(window as any).__leaseTraceInstalled = true
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = object => {
        const url = create(object)
        parent.postMessage({ type: 'lease-probe.url', action: 'create', url, mime: object instanceof Blob ? object.type : '' }, '*')
        return url
      }
      URL.revokeObjectURL = url => { revoke(url); parent.postMessage({ type: 'lease-probe.url', action: 'revoke', url }, '*') }
    })
    const page = await context.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(8_000)
    await page.goto(`http://127.0.0.1:${address.port}/`)
    await page.evaluate(async () => {
      const svg = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="${color}" d="M0 0h8v8H0z"/></svg>`)}`
      const q: any = { urls: [], diagnostics: [], generation: 0, spots: new Map(), resources: {
        'asset-original': svg('#ff0000'), 'asset-replacement': svg('#0000ff'),
      }, instance: { id: 'late-document', definitionId: 'source-definition', data: {
        html: '<!doctype html><html><head></head><body><div id="prior-lease"></div><img id="picture" data-scene-key="picture" src="guoling-resource:asset-original" width="48" height="32"></body></html>',
        resourceBindings: { 'cw-resource:original': 'asset-original' },
      } } }
      window.addEventListener('message', event => { if (event.data?.type === 'lease-probe.url') q.urls.push(event.data) })
      q.mount = async () => {
        q.generation++; q.spots.clear()
        q.abort = new AbortController()
        const listeners = new Map<string, Set<(value: any) => void>>()
        const scope = { instanceId: q.instance.id, runScopeId: `lease-${q.generation}`, generation: q.generation,
          signal: q.abort.signal, isActive: () => !q.abort.signal.aborted, cleanup() {}, target: () => null,
          state: { get: () => null, set() {}, subscribe: () => () => undefined }, events: {
            emit(name: string, value: any) {
              if (name === 'component.diagnostic') q.diagnostics.push(value)
              for (const listener of listeners.get(name) ?? []) listener(value)
            }, subscribe(name: string, listener: (value: any) => void) {
              const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(listener)
              if (name === '__runtime.activity') listener({ active: true, visible: true, playing: false })
              return () => set.delete(listener)
            },
          } }
        q.prepared = await (window as any).LeaseProbe.preparePublishedNativeComponent({ format: 'esm', diagnostics: [],
          // This declaration deliberately selects the late parser lifecycle;
          // the initial Source mount is not labelled as a builtin Web object.
          code: 'export default {document:"web",mount(){return {update(){},dispose(){}}}}',
          css: '#prior-lease{width:16px;height:16px;background-image:url("guoling-resource:asset-original")}',
        }, q.abort.signal, { state: () => ({}), targets: () => [], resources: () => q.resources, htmlAuthoring: true })
        q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'), instance: q.instance, scope,
          authoring: { register(input: any) {
            const key = input.authorKey ?? `${input.kind}:${q.spots.size}`, value = structuredClone(input)
            q.spots.set(key, value)
            return () => { if (q.spots.get(key) === value) q.spots.delete(key) }
          } },
        })
      }
      q.dispose = async () => { await q.mounted.dispose(); q.prepared.release(); q.abort.abort() }
      ;(window as any).__leaseProbe = q
      await q.mount()
    })
    const content = () => page.frameLocator('#source iframe')
    const imageFacts = () => content().locator('#picture').evaluate(async element => {
      const picture = element as HTMLImageElement; await picture.decode()
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!; ctx.drawImage(picture, 0, 0, 1, 1)
      const prior = getComputedStyle(document.getElementById('prior-lease')!).backgroundImage.match(/url\(["']?(blob:[^"')]+)["']?\)/)?.[1]
      if (!prior) throw new Error('Prepared CSS lost its original resource address')
      const oldImage = new Image(); oldImage.src = prior; await oldImage.decode()
      return { src: picture.src, rgba: [...ctx.getImageData(0, 0, 1, 1).data], prior, oldCssDecoded: oldImage.naturalWidth }
    })
    await expect.poll(() => page.evaluate(() => [...(window as any).__leaseProbe.spots.values()].filter((spot: any) => spot.kind === 'image').length)).toBe(1)
    const binding = await page.evaluate(() => [...(window as any).__leaseProbe.spots.values()].find((spot: any) => spot.kind === 'image')) as any
    expect(binding.binding.baseline).toBe('cw-resource:original')
    const before = await imageFacts()
    expect(before.rgba).toEqual([255, 0, 0, 255]); expect(before.oldCssDecoded).toBe(8)
    expect(before.prior).not.toBe(before.src)
    await page.evaluate(async () => {
      const q = (window as any).__leaseProbe, spot = [...q.spots.values()].find((item: any) => item.kind === 'image') as any
      // A focused runtime fixture supplies a normal saved author record. The
      // separate Oasis full-App consumer verifies the actual UI author command.
      q.instance = { ...q.instance, authoring: { records: { [spot.authorKey]: { kind: 'image', binding: spot.binding,
        ...(spot.scope ? { scope: spot.scope } : {}), overrides: { src: 'cw-resource:replacement' } } },
        resourceBindings: { 'cw-resource:replacement': 'asset-replacement' } } }
      await q.mounted.update(q.instance)
    })
    await expect.poll(async () => (await imageFacts()).rgba).toEqual([0, 0, 255, 255])
    const changed = await imageFacts()
    expect(changed.prior).toBe(before.prior); expect(changed.oldCssDecoded).toBe(8)
    await expect.poll(() => page.evaluate(() => (window as any).__leaseProbe.urls.filter((entry: any) => entry.action === 'create' && entry.mime === 'image/svg+xml').length)).toBeGreaterThanOrEqual(3)
    const firstImages = await page.evaluate(() => (window as any).__leaseProbe.urls.filter((entry: any) => entry.action === 'create' && entry.mime === 'image/svg+xml').map((entry: any) => entry.url))
    expect(new Set(firstImages).size).toBeGreaterThanOrEqual(3)
    expect(await page.evaluate((urls: string[]) => (window as any).__leaseProbe.urls.filter((entry: any) => entry.action === 'revoke' && urls.includes(entry.url)), firstImages)).toEqual([])
    await page.evaluate(() => (window as any).__leaseProbe.dispose())
    await expect.poll(() => page.evaluate((urls: string[]) => urls.map(url => (window as any).__leaseProbe.urls.filter((entry: any) => entry.action === 'revoke' && entry.url === url).length), firstImages)).toEqual(firstImages.map(() => 1))
    await page.evaluate(() => (window as any).__leaseProbe.mount())
    await expect.poll(async () => (await imageFacts()).rgba).toEqual([0, 0, 255, 255])
    const cold = await imageFacts()
    expect(cold.src).not.toBe(changed.src); expect(cold.prior).not.toBe(before.prior)
    await page.evaluate(() => (window as any).__leaseProbe.dispose())
    await expect.poll(() => page.evaluate(() => {
      const entries = (window as any).__leaseProbe.urls
      return entries.filter((entry: any) => entry.action === 'create' && entry.mime === 'image/svg+xml')
        .every((entry: any) => entries.filter((other: any) => other.action === 'revoke' && other.url === entry.url).length === 1)
    })).toBe(true)
    expect(await page.evaluate(() => (window as any).__leaseProbe.diagnostics)).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await browser.close(); await new Promise<void>(done => server.close(() => done()))
  }
}, 30_000)
