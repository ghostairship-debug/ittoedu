// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { createTextComponentData } from '../../src/components/text/data'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

let bundle: string
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer';
    export {prepareComponentOutputRegion} from './src/player/componentPlatform/outputCapture';`, resolveDir: process.cwd() },
    platform: 'browser', target: 'es2022', bundle: true, write: false, format: 'iife', globalName: 'CaptureExtent' })).outputFiles[0]!.text
})

function project(tall = false): CourseProjectV11 {
  return { schemaVersion: 11, id: 'capture-extents', revision: 0, title: 'Capture regions', assets: {}, rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, global: { underlay: [], overlay: [] },
    definitions: Object.fromEntries(['container.flow', 'group', 'text'].map(key => [key, { id: key, role: 'content' as const, implementation: { kind: 'builtin' as const, key: `guoling.${key}` } }])),
    instances: {
      flow: { id: 'flow', definitionId: 'container.flow', data: {}, childIds: ['region', 'peer'], container: { kind: 'flow', flow: { layout: { readingWidth: 600, wideContentWidth: 600, toc: 'hidden' } } } },
      region: tall
        ? { id: 'region', definitionId: 'container.flow', data: {}, childIds: ['child', 'last'], container: { kind: 'flow', flow: { layout: { readingWidth: 600, wideContentWidth: 600, toc: 'hidden' } } } }
        : { id: 'region', definitionId: 'group', data: {}, frame: { width: 500, height: 240, transform: [1, 0, 0, 1, 0, 0] }, childIds: ['child'] },
      child: { id: 'child', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData(tall ? 'AUTHORED CHILD\n'.repeat(110) : 'AUTHORED CHILD'))),
        ...(!tall ? { frame: { width: 500, height: 200, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] } } : {}), style: { backgroundColor: '#00ff00' } },
      ...(tall ? { last: { id: 'last', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('BOTTOM MARKER'))),
        frame: { width: 500, height: 100, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }, style: { backgroundColor: '#ff0000' } } } : {}),
      peer: { id: 'peer', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('UNRELATED PEER'))) },
    } }
}

describe('local output capture owns full authored regions', () => {
  it.each([[false, 500], [false, 1000], [true, 500]] as const)('keeps group descendants and a readable uncompressed extent (natural Flow=%s, width=%s)', async (tall, frameWidth) => {
    const source = project(tall)
    if (!tall) { source.instances.region!.frame!.width = frameWidth; source.instances.child!.frame!.width = frameWidth }
    const expected = structuredClone(source)
    const publication = await buildPublishedCourseV4({ project: source, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
      await page.setContent('<!doctype html><style>html,body{margin:0}#root{position:fixed;width:640px;height:360px;overflow:hidden}</style><main id="root"></main>')
      await page.addScriptTag({ content: bundle })
      const result = await page.evaluate(async encoded => {
        const payload = JSON.parse(encoded), root = document.getElementById('root')!
        const api = (window as any).CaptureExtent
        const player = await api.mountPublishedCourseV4(payload, root, { capture: true, keyboardNavigation: false })
        ;(window as any).extentPlayer = player
        const rect = await api.prepareComponentOutputRegion({ payload, root, player, surfaceId: 'flow', instanceId: 'region', staticExport: true })
        const child = player.runtime.targetElement('child')!, last = player.runtime.targetElement('last')
        return { rect, childVisible: !child.hidden && child.checkVisibility(), text: child.textContent,
          childRect: child.getBoundingClientRect().toJSON(), lastRect: last?.getBoundingClientRect().toJSON(), rootHeight: root.clientHeight,
          peerHidden: player.runtime.targetElement('peer')!.closest('[style*="display: none"]') !== null }
      }, JSON.stringify(publication.payload))
      expect(result.childVisible).toBe(true)
      expect(result.text).toContain('AUTHORED CHILD')
      expect(result.rootHeight).toBe(360)
      expect(result.rect.width).toBeGreaterThanOrEqual(500)
      if (tall) {
        expect(result.rect.height).toBeGreaterThan(2200)
        expect(result.childRect.height).toBeGreaterThan(2100)
        await page.setViewportSize({ width: 640, height: Math.ceil(result.rect.height) })
        const png = await page.screenshot({ clip: result.rect })
        const bottom = await page.evaluate(async ({ image, x, y }) => {
          const bitmap = await createImageBitmap(await (await fetch(image)).blob()), canvas = document.createElement('canvas')
          canvas.width = bitmap.width; canvas.height = bitmap.height
          const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0)
          return [...context.getImageData(x, y, 1, 1).data]
        }, { image: `data:image/png;base64,${png.toString('base64')}`, x: Math.round(result.lastRect!.x - result.rect.x + result.lastRect!.width - 10), y: Math.round(result.lastRect!.y - result.rect.y + result.lastRect!.height / 2) })
        expect(bottom).toEqual([255, 0, 0, 255])
      } else {
        expect(result.rect.height).toBeCloseTo(240 * Math.min(1, 640 / frameWidth))
        expect(result.childRect.width).toBeCloseTo(frameWidth * Math.min(1, 640 / frameWidth))
      }
      await page.evaluate(() => (window as any).extentPlayer.dispose())
      expect(source).toEqual(expected)
    } finally { await browser.close() }
  }, 30_000)

  it('captures the bottom of a natural Flow in the actual hidden Electron viewport without shrinking the author region', async () => {
    const source = project(true)
    const publication = await buildPublishedCourseV4({ project: source, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
    const directory = await mkdtemp(resolve('output/editing-regressions-20261023/electron-capture-'))
    await writeFile(join(directory, 'player.js'), bundle)
    await writeFile(join(directory, 'publication.json'), JSON.stringify(publication.payload))
    await build({ entryPoints: ['src/main/workbench/observation/captureFramePaint.ts'], outfile: join(directory, 'paint.cjs'), platform: 'node', format: 'cjs', bundle: true })
    const script = `const {app,BrowserWindow}=require('electron'); const fs=require('node:fs'); const path=require('node:path');
const {waitForCaptureFramePaint}=require('./paint.cjs');
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:640,height:360,useContentSize:true,frame:false,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  try{
    await window.loadURL('data:text/html,'+encodeURIComponent('<style>html,body{margin:0}#root{position:fixed;width:640px;height:360px;overflow:hidden}</style><main id="root"></main>'));
    await window.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'player.js'),'utf8'));
    const payload=JSON.parse(fs.readFileSync(path.join(__dirname,'publication.json'),'utf8'));
    const facts=await window.webContents.executeJavaScript('(async()=>{const payload='+JSON.stringify(payload)+'; const root=document.getElementById("root"); const player=await CaptureExtent.mountPublishedCourseV4(payload,root,{capture:true,keyboardNavigation:false}); const rect=await CaptureExtent.prepareComponentOutputRegion({payload,root,player,surfaceId:"flow",instanceId:"region",staticExport:true}); const last=player.runtime.targetElement("last").getBoundingClientRect(); return {rect,last:last.toJSON(),rootHeight:root.clientHeight}})()');
    const rect=facts.rect;
    const [width,height]=window.getContentSize(); window.setContentSize(Math.max(width,Math.ceil(rect.x+rect.width)),Math.max(height,Math.ceil(rect.y+rect.height)));
    await waitForCaptureFramePaint(window.webContents.mainFrame,'capture-native-extent');
    const bitmap=await window.webContents.capturePage({x:Math.floor(rect.x),y:Math.floor(rect.y),width:Math.ceil(rect.width),height:Math.ceil(rect.height)});
    const size=bitmap.getSize(), bytes=bitmap.toBitmap(), sx=size.width/rect.width, sy=size.height/rect.height;
    const x=Math.round((facts.last.x-rect.x+facts.last.width-10)*sx), y=Math.round((facts.last.y-rect.y+facts.last.height/2)*sy), offset=(y*size.width+x)*4;
    fs.writeFileSync(path.join(__dirname,'natural-flow.png'),bitmap.toPNG());
    console.log(JSON.stringify({rect,size,rootHeight:facts.rootHeight,afterRootHeight:await window.webContents.executeJavaScript('document.getElementById("root").clientHeight'),bottom:[...bytes.slice(offset,offset+4)]}));
  }finally{window.destroy();app.quit()}
}).catch(error=>{console.error(error);app.exit(1)});`
    const main = join(directory, 'main.cjs'); await writeFile(main, script)
    const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE
    const result = await new Promise<string>((resolveResult, reject) => {
      const child = spawn(String(electronPath), [main], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', errors = ''
      child.stdout.on('data', value => { output += String(value) }); child.stderr.on('data', value => { errors += String(value) })
      child.once('error', reject)
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`Owned Electron capture timed out: ${errors}`)) }, 25_000)
      child.once('exit', code => { clearTimeout(timeout); if (code) reject(new Error(errors)); else resolveResult(output) })
    })
    const facts = JSON.parse(result.trim().split(/\r?\n/).find(line => line.startsWith('{'))!)
    expect(facts.rect.width).toBeGreaterThanOrEqual(500)
    expect(facts.rect.height).toBeGreaterThan(2200)
    expect(facts.size.height).toBeGreaterThan(2200)
    expect(facts.rootHeight).toBe(360); expect(facts.afterRootHeight).toBe(360)
    expect(facts.bottom).toEqual([0, 0, 255, 255])
  }, 30_000)
})
