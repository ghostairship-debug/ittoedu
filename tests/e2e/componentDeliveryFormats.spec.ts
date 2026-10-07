import { _electron as electron, expect, test } from '@playwright/test'
import { build as buildRenderer, loadConfigFromFile, preview } from 'vite'
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'

test('V10 real headless worker includes PNG/GIF images and embeds fonts for offline HTML/ZIP', async ({ browser }, info) => {
  test.setTimeout(120_000)
  const root = resolve(__dirname, '../..'), output = info.outputPath('delivery')
  mkdirSync(join(output, 'main/workbench/delivery'), { recursive: true })
  mkdirSync(join(output, 'preload'), { recursive: true })
  const rendererOutput = join(output, 'renderer')
  const rendererConfig = (await loadConfigFromFile({ command: 'build', mode: 'production' }, join(root, 'vite.renderer.config.ts')))!.config
  // Override the complete input object rather than Vite-merging it with every app entry.
  await buildRenderer({ ...rendererConfig, configFile: false, logLevel: 'warn', build: { ...rendererConfig.build, outDir: rendererOutput,
    rollupOptions: { ...rendererConfig.build?.rollupOptions, input: { documentExport: join(root, 'document-export.html') } } } })
  const server = await preview({ configFile: join(root, 'vite.renderer.config.ts'), build: { outDir: rendererOutput }, preview: { port: 0, strictPort: false, host: '127.0.0.1' } })
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Vite address')
  const renderer = `http://127.0.0.1:${address.port}/index.html`
  await build({ entryPoints: [join(root, 'src/preload/documentExport.ts')], outfile: join(output, 'preload/documentExport.js'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  const harness = join(output, 'main/workbench/delivery/harness.cjs')
  await build({ stdin: { resolveDir: root, contents: `
    import { app } from 'electron';
    import { writeFileSync } from 'node:fs';
    import { HeadlessDocumentExportWorker } from './src/main/workbench/delivery/HeadlessDocumentExportWorker';
    import { createBlankCourseProjectV10 } from './src/core/course/createCourseProjectV10';
    import { createImageData } from './src/components/image/data';
    import { createTextComponentData } from './src/components/text/data';
    app.setPath('userData', ${JSON.stringify(join(output, 'profile'))});
    app.on('window-all-closed', () => {});
    app.whenReady().then(async () => {
      const worker = new HeadlessDocumentExportWorker(${JSON.stringify(renderer)}, { compile: async () => { throw Error('No source in sample') } });
      const project = createBlankCourseProjectV10('真实格式交付');
      project.instances = {}; project.global.overlay = []; project.definitions = {
        image: {id:'image',role:'content',implementation:{kind:'builtin',key:'guoling.image'}},
        text: {id:'text',role:'content',implementation:{kind:'builtin',key:'guoling.text'}}
      };
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6kAAAAASUVORK5CYII=', 'base64');
      const gif = Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
      project.assets = {png:{id:'png',path:'assets/sample.png',mimeType:'image/png'},gif:{id:'gif',path:'assets/sample.gif',mimeType:'image/gif'}};
      const text = createTextComponentData('离线中文字体'); text.appearance.fontFamily = 'Noto Sans SC';
      project.instances.text = {id:'text',definitionId:'text',data:text,frame:{width:300,height:80,transform:[1,0,0,1,10,10]}};
      for (const id of ['png','gif']) project.instances[id] = {id,definitionId:'image',data:createImageData(id),frame:{width:100,height:100,transform:[1,0,0,1,id==='png'?20:160,120]}};
      project.surfaces[0].childIds = ['text','png','gif'];
      const snapshot = {documentId:'delivery',epoch:'epoch',revision:0,binding:{kind:'untitled'},model:{kind:'course-v10',project,resources:{assets:{png:new Uint8Array(png),gif:new Uint8Array(gif)},components:{}}},dirty:false,saving:false,recoverable:true,undoDepth:0,redoDepth:0};
      const identity = {documentId:'delivery',epoch:'epoch',revision:0,projectId:project.id};
      const results = [];
      try {
        for (const format of ['pptx','html-offline','web-package']) {
          const reply = await worker.build({requestId:format,identity,format,snapshot});
          results.push({format,status:reply.status,reason:reply.reason,warnings:reply.warnings});
          if (reply.files) writeFileSync(${JSON.stringify(output)} + '/' + reply.files[0].relativePath,reply.files[0].bytes);
          if (reply.status !== 'generated') throw Error(reply.reason || format);
        }
        writeFileSync(${JSON.stringify(join(output, 'facts.json'))}, JSON.stringify(results,null,2));
      } catch(error) { writeFileSync(${JSON.stringify(join(output, 'facts.json'))},JSON.stringify({results,error:String(error)},null,2)); }
      finally {worker.dispose();}
    });
  ` }, outfile: harness, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE'))
    app = await electron.launch({ args: [harness], cwd: root, env })
    await expect.poll(() => { try { return JSON.parse(readFileSync(join(output, 'facts.json'), 'utf8')) } catch { return null } }, { timeout: 100_000 }).not.toBeNull()
    const facts = JSON.parse(readFileSync(join(output, 'facts.json'), 'utf8'))
    expect(facts).toEqual(expect.arrayContaining([expect.objectContaining({ format: 'pptx', status: 'generated' })]))
    expect(facts[0].warnings.some((warning: string) => /缺失|无法|未提供|不支持|捕获失败/.test(warning))).toBe(false)
    const pptx = unzipSync(new Uint8Array(readFileSync(join(output, 'course.pptx'))))
    const media = Object.entries(pptx).filter(([name]) => name.startsWith('ppt/media/') && name.endsWith('.png'))
    expect(media).toHaveLength(2)
    const slide = strFromU8(pptx['ppt/slides/slide1.xml']!)
    expect(slide).toContain('name="png"'); expect(slide).toContain('name="gif"')
    for (const [, bytes] of media) expect([...bytes.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10])
    expect(facts[0].warnings).toContainEqual(expect.stringContaining('GIF 已解码'))
    const zip = unzipSync(new Uint8Array(readFileSync(join(output, 'course.zip')))), extracted = join(output, 'web')
    for (const [name, bytes] of Object.entries(zip)) { const filename = join(extracted, name); mkdirSync(resolve(filename, '..'), { recursive: true }); writeFileSync(filename, bytes) }
    const context = await browser.newContext({ offline: true })
    try {
      const pixels = await context.newPage()
      for (const [, bytes] of media) {
        const rgba = await pixels.evaluate(async source => {
          const image = new Image(); image.src = source; await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
          const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
          return [...ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data]
        }, `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`)
        expect(rgba[3]).toBeGreaterThan(0)
      }
      await pixels.close()
      for (const filename of [join(output, 'index.html'), join(extracted, 'index.html')]) {
        const page = await context.newPage()
        await page.goto(pathToFileURL(filename).toString())
        await expect.poll(() => page.evaluate(async () => (await document.fonts.load('20px "Noto Sans SC"', '离线中文字体')).length)).toBeGreaterThan(0)
        const fontFaces = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(face => face.family.replaceAll('"', '') === 'Noto Sans SC').map(face => face.status) })
        expect(fontFaces).toContain('loaded')
        await page.screenshot({ path: `${filename}.png` })
        await page.close()
      }
    } finally { await context.close() }
    await info.attach('headless delivery facts', { path: join(output, 'facts.json'), contentType: 'application/json' })
  } finally { await app?.close(); await new Promise<void>(resolveClose => server.httpServer.close(() => resolveClose())) }
})
