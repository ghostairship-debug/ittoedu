import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'vite'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { enterIndependentEditor as enterStandaloneEditorFromLanding } from './lessonWorkspaceEntry'
import { openReferenceSelect } from './chatReferenceTarget'

// Local delivery baseline only. The deterministic Node subprocess replaces the
// native executable; Codex transport, Harness, IPC, Store and React UI stay real.
// This is development-renderer evidence, never model or teacher acceptance.
const testRoot = resolve(__dirname, '../..')
const productRoot = process.env.COURSEWARE_PERFORMANCE_PRODUCT_ROOT || testRoot
const prefix = 'ittoedu-r18-local-performance-'

function statistics(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b)
  return { count: ordered.length, minMs: ordered[0], medianMs: (ordered[14]! + ordered[15]!) / 2,
    p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1], maxMs: ordered.at(-1), samplesMs: values }
}

async function closeApp(app: ElectronApplication) {
  await app.evaluate(async ({ app, BrowserWindow }) => {
    try {
      const requireMain = (process as any).getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`)
      await requireMain('./dist-electron/main/localAgent/service.js').closeLocalAgents()
    } finally {
      BrowserWindow.getAllWindows().forEach(window => window.destroy())
      setTimeout(() => app.exit(0), 0)
    }
  }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

const protocol = String.raw`
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
if (process.argv.includes('--version')) { console.log('codex 0.153.4'); process.exit(0); }
if (process.argv.includes('login')) { console.log('Logged in using local deterministic protocol fixture'); process.exit(0); }
let threadId = 'local-baseline-' + process.pid, turnId = 'turn-baseline', requestId, started = false;
const model = 'local-deterministic-baseline';
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const {id, method, params={}} = JSON.parse(line);
  if (method === 'initialize') send({id,result:{userAgent:'codex/0.153.4'}});
  else if (method === 'model/list') send({id,result:{data:[{id:model,model,displayName:model,isDefault:true,inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}]}});
  else if (method === 'thread/start' || method === 'thread/resume') send({id,result:{thread:{id:threadId},model,reasoningEffort:'medium'}});
  else if (method === 'turn/start') {
    // The schema is request-independent; the formal staging request owns this ID.
    const candidateRoot = process.env.COURSEWARE_CANDIDATE_ROOT;
    if (!candidateRoot) throw new Error('Local baseline requires the current candidate root');
    requestId = JSON.parse(require('node:fs').readFileSync(require('node:path').join(candidateRoot, 'request.json'), 'utf8')).requestId;
    if (typeof requestId !== 'string' || !requestId) throw new Error('Local baseline request ID is missing');
    send({id,result:{turn:{id:turnId,status:'inProgress'}}});
    send({method:'turn/started',params:{threadId,turn:{id:turnId}}});
    if (started) return;
    started=true;
    for (let index=0; index<30; index++) setTimeout(() => {
      const text='LOCAL EVENT '+String(index).padStart(2,'0')+' SENT '+Date.now();
      send({method:'item/completed',params:{threadId,turnId,item:{id:'baseline-'+index,type:'agentMessage',phase:'commentary',text}}});
    }, 100 + index*137);
    setTimeout(() => {
      send({method:'item/completed',params:{threadId,turnId,item:{id:'baseline-final',type:'agentMessage',phase:'final_answer',text:JSON.stringify({version:1,requestId,kind:'reply',reply:'本地事件传递基线完成，课件未修改。',candidate:null})}}});
      send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
    }, 100+30*137);
  } else if (method === 'thread/read') {
    send({id,result:{thread:{id:threadId,model,reasoningEffort:'medium'}}});
  } else if (method === 'turn/interrupt') {
    send({id,result:{}});
    send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'interrupted'}}});
  }
});
process.stdin.on('end',()=>process.exit(0));
`

test('records 30 context changes and 30 native protocol events through the real hidden UI', async () => {
  test.setTimeout(120_000)
  const runRoot = mkdtempSync(join(tmpdir(), prefix))
  const output = join(testRoot, 'output/r18-local-performance', `run-${Date.now()}`)
  mkdirSync(output, { recursive: true })
  const script = join(runRoot, 'deterministic-codex.cjs')
  writeFileSync(script, protocol)
  const fixture = createBlankCourseProject({ title: '本地传递基线', includeDefaultController: false, controls: 'none' })
  const surface = fixture.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Expected Slide factory')
  for (let index = 0; index < 2; index++) {
    const item = sceneNodeToCourseLayerItem(createTextNode({ id: `baseline-${index}`, text: `选区基线 ${index}`,
      x: 120, y: 120 + index * 160, width: 500, height: 100, style: { fontSize: 38 } }), index)
    item.label = `选区基线 ${index}`
    surface.scenes[0]!.layerItems.push(item)
  }
  const projectPath = join(runRoot, 'baseline.h5lesson')
  writeFileSync(projectPath, createCourseProjectArchive({ project: fixture, assetFiles: {}, componentFiles: {} }))
  const server = await createServer({ root: productRoot, configFile: join(productRoot, 'vite.renderer.config.ts'),
    cacheDir: join(output, 'vite-cache'), optimizeDeps: { entries: [join(productRoot, 'index.html'), join(productRoot, 'admission.html')] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, fs: { allow: [productRoot, testRoot] },
      watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  let app: ElectronApplication | undefined
  try {
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing renderer address')
    const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      COURSEWARE_E2E_BACKGROUND: '1', VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ args: [productRoot, `--user-data-dir=${join(runRoot, 'profile')}`], cwd: testRoot, env })
    await expectBackgroundWindowsIsolated(app, true)
    await app.evaluate(({ app, dialog }, input) => {
      const requireMain = (process as any).getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`)
      const processModule = requireMain('./dist-electron/main/localAgent/process.js')
      processModule.resolveAgentExecutable = async (id: string) => {
        if (id !== 'codex') throw new Error('Local baseline authorizes only the deterministic Codex subprocess')
        return { executable: input.node, prefix: [input.script] }
      }
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.projectPath] })
    }, { node: process.execPath, script, projectPath })
    console.log('Local protocol process resolver installed; real transport and IPC retained')
    const page = await app.firstWindow()
    const rendererErrors: string[] = []
    page.on('pageerror', error => { rendererErrors.push(error.message); console.log(`Renderer error: ${error.message}`) })
    page.on('console', message => { if (message.type() === 'error') rendererErrors.push(message.text()) })
    try {
      const open = page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true })
      await (async () => {
        await enterStandaloneEditorFromLanding(page)
        await open.waitFor({ timeout: 10_000 })
      })().catch(async error => {
        if (!rendererErrors.some(message => message.includes('Outdated Optimize Dep'))) throw error
        // A fresh isolated dependency cache invalidates its initial module URLs.
        // hmr=false disables Vite's automatic reload; finish startup once before
        // collecting any latency sample. Never retry a measured operation.
        console.log('Cold dependency cache stabilized; reloading once before measurement')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await enterStandaloneEditorFromLanding(page)
        await open.waitFor({ timeout: 15_000 })
      })
    }
    catch (error) {
      writeFileSync(join(output, 'startup-failure.json'), JSON.stringify({ url: page.url(), errors: rendererErrors, body: await page.locator('body').innerText() }, null, 2))
      throw error
    }
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const reference = await openReferenceSelect(
      page.getByRole('complementary', { name: 'CLI 创作助手' }),
    )
    await expect(reference).toBeVisible()
    await reference.selectOption('selection')
    console.log('Real saved fixture and chat panel ready')
    const state = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      return JSON.stringify(selectActiveCourseProjectDocument(useEditorStore.getState()))
    })
    const contextSamples = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore } = await load('/src/renderer/store/editorStore.ts')
      const target = document.querySelector('[aria-label="本轮引用摘要"]')!
      const samples: number[] = []
      for (let i = 0; i < 30; i++) {
        await new Promise<void>((resolveUpdate, reject) => {
          const start = performance.now(), expected = `选区基线 ${i % 2}`
          const timeout = setTimeout(() => { observer.disconnect(); reject(new Error(`Context did not update: ${expected}`)) }, 5_000)
          const observer = new MutationObserver(() => {
            if (!target.textContent?.includes(expected)) return
            samples.push(performance.now() - start); observer.disconnect(); clearTimeout(timeout); resolveUpdate()
          })
          observer.observe(target, { childList: true, characterData: true, subtree: true })
          useEditorStore.getState().selectNodes([`baseline-${i % 2}`])
        })
      }
      return samples
    })
    console.log(`Context samples collected: ${contextSamples.length}`)
    writeFileSync(join(output, 'context-measurements.json'), JSON.stringify({ measuredAt: new Date().toISOString(),
      boundary: '30 alternating real Store selection Owner calls to matching CourseChatPanel reference summary DOM commits; no model, IPC or Store mock.',
      contextHint: { ...statistics(contextSamples), budgetMs: 500 } }, null, 2))
    await page.evaluate(() => {
      const readings: Array<{ index: number; emittedAt: number; renderedAt: number; elapsedMs: number }> = []
      const observer = new MutationObserver(() => {
        const now = Date.now()
        for (const element of document.querySelectorAll('.course-chat .chat-message')) {
          for (const match of element.textContent!.matchAll(/LOCAL EVENT (\d{2}) SENT (\d{13})/g)) {
            const index = Number(match[1]), emittedAt = Number(match[2])
            if (!readings.some(item => item.index === index)) readings.push({ index, emittedAt, renderedAt: now, elapsedMs: now - emittedAt })
          }
        }
      })
      observer.observe(document.querySelector('.course-chat .chat-scroll')!, { childList: true, characterData: true, subtree: true })
      Object.assign(window, { __localDeliveryReadings: readings, __localDeliveryObserver: observer })
    })
    await page.getByRole('combobox', { name: '意图', exact: true }).selectOption('discuss')
    await page.getByRole('textbox', { name: '发送给创作助手', exact: true }).fill('测量本地事件传递，不修改课件。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    try {
      await expect.poll(async () => page.evaluate(() => (window as any).__localDeliveryReadings.length), { timeout: 15_000 }).toBe(30)
    } catch (error) {
      const failure = await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path)
        const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
        const state = useEditorStore.getState()
        return { body: document.querySelector('.course-chat')?.textContent, readings: (window as any).__localDeliveryReadings,
          sessions: await window.desktopAPI!.localAgent({ operation: 'list', projectId: selectActiveCourseProjectDocument(state).id, projectPath: state.projectPath }) }
      })
      writeFileSync(join(output, 'event-failure.json'), JSON.stringify(failure, null, 2))
      throw error
    }
    const events = await page.evaluate(() => {
      ;(window as any).__localDeliveryObserver.disconnect()
      return (window as any).__localDeliveryReadings as Array<{ index: number; emittedAt: number; renderedAt: number; elapsedMs: number }>
    })
    writeFileSync(join(output, 'event-measurements.json'), JSON.stringify({ measuredAt: new Date().toISOString(),
      boundary: '30 deterministic Node protocol subprocess messages through real transport, Harness, IPC and React DOM; no model.',
      nativeEventToUi: { ...statistics(events.map(event => event.elapsedMs)), budgetMs: 300, fixedIntervalMs: 137, events } }, null, 2))
    await expect(page.locator('.course-chat .chat-scroll > p[role="status"]')).toContainText('讨论完成', { timeout: 15_000 })
    const after = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      return JSON.stringify(selectActiveCourseProjectDocument(useEditorStore.getState()))
    })
    expect(after).toBe(state)
    await expectBackgroundWindowsIsolated(app, true)
    const report = { measuredAt: new Date().toISOString(), productRoot, renderer: 'Vite development renderer',
      boundary: 'Real Electron Main, Codex transport, Harness, IPC, Store, React. Deterministic Node protocol process; no model. DOM commit timing, not physical screen presentation.',
      contextHint: { ...statistics(contextSamples), budgetMs: 500 }, nativeEventToUi: { ...statistics(events.map(e => e.elapsedMs)), budgetMs: 300, fixedIntervalMs: 137, events },
      documentUnchanged: after === state, windows: 'hidden, unfocused, opacity 0, offscreen, isolated profile',
      currentControllerHas250msPause: readFileSync(join(productRoot, 'src/renderer/authoring/generation/generationTaskController.ts'), 'utf8').includes('setTimeout(resolve, 250)') }
    writeFileSync(join(output, 'measurements.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ output, contextHint: report.contextHint, nativeEventToUi: { ...report.nativeEventToUi, events: undefined } }))
  } finally {
    if (app) await closeApp(app)
    await server.close()
    const scoped = relative(resolve(tmpdir()), resolve(runRoot))
    if (!scoped || scoped.startsWith('..') || isAbsolute(scoped) || !scoped.split(/[\\/]/)[0]!.startsWith(prefix)) throw new Error(`Unscoped profile: ${runRoot}`)
    rmSync(runRoot, { recursive: true, force: true })
  }
})
