// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

it('an actual compiled source realm resolves an assetId without optional bindings and only its real image consumer requests the URL', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWPQrdrxHwAElgJfcgSp1AAAAABJRU5ErkJggg==', 'base64')
  const bundle = await build({ stdin: { contents: "export { mountPublishedCourseV3 } from './src/player/componentPlatform/publishedPlayer';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'ResourceConsumerProbe', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw-text' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw-text' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const requests: string[] = []
  const server = createServer((request, response) => {
    if (request.url === '/image.png' || request.url === '/unused.png') {
      requests.push(request.url); response.setHeader('Content-Type', 'image/png'); response.end(png); return
    }
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle.outputFiles[0]!.text : '<!doctype html><section id="player" style="width:640px;height:360px"></section><script src="/probe.js"></script>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const directory = await mkdtemp(join(tmpdir(), 'followup-source-resource-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const project = createBlankCourseProjectV10('Source资源实际消费')
    const source = `export default { mount({root,instance,resources,scope}) {
      const url=resources.url(instance.data.assetId);
      scope.state.set('observedAssetUrl',url??'missing');
      const image=document.createElement('img');image.alt='源码组件图片';if(url)image.src=url;root.append(image);
      return {update(){},dispose(){image.remove()}};
    } }`
    project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
    project.instances.source = { id: 'source', definitionId: 'source', data: { assetId: 'current' }, frame: { width: 320, height: 200, transform: [1, 0, 0, 1, 0, 0] } }
    project.surfaces[0].childIds = ['source']
    project.assets.current = { id: 'current', path: 'assets/current.png', mimeType: 'image/png' }
    project.assets.unused = { id: 'unused', path: 'assets/unused.png', mimeType: 'image/png' }
    const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    const published = await buildPublishedCourseV3({ project, assetBytes: { current: png, unused: png } },
      { compilation, assetUrl: asset => `${origin}/${asset.id === 'current' ? 'image' : 'unused'}.png` })
    expect(published.payload.definitions.source.implementation).not.toHaveProperty('resourceBindings')
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
      app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadURL(${JSON.stringify(origin)}));`)
    const nativeEnv: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 5000, env: nativeEnv })
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean((window as any).ResourceConsumerProbe), undefined, { timeout: 5000 })
    const observed = await page.evaluate(async payload => {
      const root = document.getElementById('player')!, fetches: string[] = [], nativeFetch = window.fetch.bind(window)
      window.fetch = (input, options) => { fetches.push(String(input)); return nativeFetch(input, options) }
      const player = await (window as any).ResourceConsumerProbe.mountPublishedCourseV3(payload, root)
      ;(window as any).__resourceConsumer = player
      return { url: player.stateSnapshot().observedAssetUrl, fetches }
    }, published.payload)
    expect(observed.url).toBe(`${origin}/image.png`)
    expect(observed.fetches).toEqual([])
    const image = page.frameLocator('[data-component-object="source"] iframe').getByAltText('源码组件图片')
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(frame => [...(frame.contentDocument?.images ?? [])].some(image => image.alt === '源码组件图片' && image.naturalWidth === 1)), undefined, { timeout: 3000 })
    expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1)
    expect(await image.getAttribute('src')).toBe(`${origin}/image.png`)
    expect(requests).toEqual(['/image.png'])
    await page.evaluate(async () => { await (window as any).__resourceConsumer.dispose() })
    expect(await page.locator('#player iframe').count()).toBe(0)
  } finally {
    await app?.close()
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected fixture directory')
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)
