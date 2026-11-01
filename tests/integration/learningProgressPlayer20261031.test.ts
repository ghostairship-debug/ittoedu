// @vitest-environment node
import { beforeAll, afterAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, expect as browserExpect, type BrowserContext, type Page } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { buildComponentSingleHtml, buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { compilePublishedWebProgram } from '../../src/core/publish/componentPlatform/compiledScript'
import type { WebRuntimeData } from '../../src/components/web/moduleGraph'

const carriers = ['published-native', 'compiled-native', 'compiled-semantic'] as const
type Carrier = typeof carriers[number]
let directory: string
const files = new Map<Carrier, string>()
const routes = new Map<Carrier, { native: boolean; nativeReasons: readonly string[] }>()
const initialState = { step: 0, scene: 'briefing', oxygen: 100, unlocked: [] as string[], result: null }

function authorHtml(native: boolean) {
  // A real viewport-dependent stylesheet deliberately retains native document
  // semantics; the plain sibling exercises the compiled local DOM adapter.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:20px sans-serif;padding:24px;color:#164e63}button{font:inherit;margin:8px;padding:10px}
    ${native ? '@media (min-width:1px){body{background:#ecfeff}}' : ''}
  </style></head><body><h1>本设备实验进度</h1><p id="status" data-ready="false">恢复中</p>
    <output id="step">0</output><pre id="stored"></pre><span id="isolation"></span>
    <button id="advance" disabled>完成一步并保存</button><button id="reset" disabled>重新开始</button>
    <button id="invalid" disabled>验证无效快照</button><button id="nullable" disabled>验证 JSON 空值</button><script>
    (async function(){
      var status=document.getElementById('status');
      ${native ? "try{window.localStorage.setItem('__progress_probe__','no');document.getElementById('isolation').textContent='allowed'}catch(error){document.getElementById('isolation').textContent=error.name}" : ''}
      var port=await window.courseProgressReady;
      var loaded=await port.read('learner',1);
      if(loaded.status==='incompatible')throw Object.assign(new Error('版本不兼容'),{code:'progress-incompatible'});
      var revision=loaded.revision;
      var fresh=function(){return ${JSON.stringify(initialState)}};
      var state=loaded.status==='ready'?loaded.value:fresh();
      var render=function(message){document.getElementById('step').textContent=String(state.step);document.getElementById('stored').textContent=JSON.stringify(state);status.textContent=message};
      var report=function(error){status.textContent=String(error.code||error.message||error)};
      document.getElementById('advance').onclick=async function(){
        this.disabled=true;
        try{var step=state.step+1;var next={step:step,scene:'ecosystem',oxygen:Math.max(0,100-step*9),unlocked:['dive','ecosystem'],result:{valid:true,ratio:0.35}};
          var ack=await port.write('learner',1,next,revision);revision=ack.revision;state=next;render('已保存');
        }catch(error){report(error)}finally{this.disabled=false}
      };
      document.getElementById('reset').onclick=async function(){
        this.disabled=true;
        try{var ack=await port.clear('learner',1,revision);revision=ack.revision;state=fresh();render('新游戏')}
        catch(error){report(error)}finally{this.disabled=false}
      };
      document.getElementById('invalid').onclick=async function(){
        try{await port.write('learner',1,undefined,revision);status.textContent='incorrectly cleared'}catch(error){report(error)}
      };
      document.getElementById('nullable').onclick=async function(){
        try{var empty=await port.read('nullable',1);await port.write('nullable',1,null,empty.revision);
          var saved=await port.read('nullable',1);status.textContent=saved.status==='ready'&&saved.value===null?'null-saved':'incorrect null result'
        }catch(error){report(error)}
      };
      render(loaded.status==='ready'?'已恢复':'新游戏');
      for(var id of ['advance','reset','invalid','nullable'])document.getElementById(id).disabled=false;
      status.dataset.ready='true';
    })().catch(function(error){var status=document.getElementById('status');status.textContent=String(error.code||error.message||error);status.dataset.ready='error'});
  </script></body></html>`
}

beforeAll(async () => {
  directory = process.env.PROGRESS_PLAYER_AUDIT_ROOT ?? await mkdtemp(join(tmpdir(), 'guoling-progress-player-'))
  await mkdir(directory, { recursive: true })
  const [publishedBundle, compiledBundle] = await Promise.all([
    build({ stdin: { contents: 'export * from "./src/player/componentPlatform/entry"', resolveDir: process.cwd() }, bundle: true,
      platform: 'browser', format: 'iife', globalName: 'CoursewarePlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' }),
    build({ stdin: { contents: 'export {mountCompiledCourse} from "./src/player/componentPlatform/compiledPlayer"', resolveDir: process.cwd() }, bundle: true,
      platform: 'browser', format: 'iife', globalName: 'CoursewareCompiledPlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' }),
  ])
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  try {
    // Declaring the explicit progress API must not promise native browser storage.
    expect(compilePublishedWebProgram({ html: '<script>window.localStorage.getItem("progress")</script>' }, { routing: true }).nativeReasons)
      .toContain('window-member:localStorage')
    for (const carrier of carriers) {
      const project = createBlankCourseProjectV10(`Progress ${carrier}`)
      project.definitions = { program: { id: 'program', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } } }
      project.instances = { program: { id: 'program', definitionId: 'program', data: { html: authorHtml(carrier !== 'compiled-semantic') } } }
      project.rootIds = ['program']; project.entry = { rootInstanceId: 'program' }
      const publication = await buildPublishedCourseV3({ project, assetBytes: {}, componentFiles: {} })
      expect(publication.diagnostics).toEqual([])
      let html: string
      if (carrier === 'published-native') html = buildComponentSingleHtml(publication.payload, publishedBundle.outputFiles[0]!.text)
      else {
        const artifact = await compileCoursePlayback(publication.payload, { document: dom.window.document, renderBuiltin: async () => '' })
        expect(artifact.diagnostics).toEqual([])
        const route = { native: Boolean(artifact.webPrograms.program[0]!.program.nativeData),
          nativeReasons: compilePublishedWebProgram(publication.payload.instances.program!.data as unknown as WebRuntimeData, { routing: true }).nativeReasons }
        routes.set(carrier, route)
        await writeFile(join(directory, `${carrier}-routing.json`), JSON.stringify(route, null, 2))
        html = buildCompiledSingleHtml(artifact, compiledBundle.outputFiles[0]!.text)
      }
      const file = join(directory, `${carrier}.html`)
      await writeFile(file, html); files.set(carrier, file)
    }
  } finally { dom.window.close() }
}, 45_000)

afterAll(async () => {
  if (!process.env.PROGRESS_PLAYER_AUDIT_ROOT && directory) await rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 })
})

const controls = (page: Page, carrier: Carrier) => {
  const content = carrier === 'compiled-semantic' ? page : page.frameLocator('iframe')
  return { status: content.locator('#status'), step: content.locator('#step'), stored: content.locator('#stored'), isolation: content.locator('#isolation'),
    advance: content.getByRole('button', { name: '完成一步并保存' }), reset: content.getByRole('button', { name: '重新开始' }),
    invalid: content.getByRole('button', { name: '验证无效快照' }), nullable: content.getByRole('button', { name: '验证 JSON 空值' }) }
}
async function waitForPlayer(page: Page, carrier: Carrier) {
  await page.waitForFunction(() => Boolean((window as any).coursePlayer) || Boolean((window as any).__coursePlaybackFailed), undefined, { timeout: 15_000 })
  expect(await page.evaluate(() => (window as any).__coursePlaybackFailed ?? false)).toBe(false)
  const ui = controls(page, carrier)
  await browserExpect(ui.status).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  return ui
}
const authorSnapshot = (page: Page) => page.evaluate(() => JSON.stringify((document.getElementById('course-data') as any).__courseDecodedPayload))

it.each(carriers)('%s restores actual player state offline and rejects invalid or stale writes without changing author data', async carrier => {
  if (carrier !== 'published-native') expect(routes.get(carrier)?.native, JSON.stringify(routes.get(carrier))).toBe(carrier === 'compiled-native')
  const profile = join(directory, `${carrier}-profile`), url = pathToFileURL(files.get(carrier)!).href
  const errors: string[] = [], networkRequests: string[] = []
  const open = async (): Promise<BrowserContext> => {
    const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 960, height: 720 } })
    await context.setOffline(true)
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
    context.on('request', request => { if (/^https?:/i.test(request.url())) networkRequests.push(request.url()) })
    return context
  }
  let context = await open()
  try {
    let first = await context.newPage(); await first.goto(url)
    let ui = await waitForPlayer(first, carrier)
    const original = await authorSnapshot(first)
    await browserExpect(ui.step).toHaveText('0')
    if (carrier !== 'compiled-semantic') {
      expect(await first.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts')
      await browserExpect(ui.isolation).toHaveText('SecurityError')
    } else expect(await first.locator('iframe').count()).toBe(0)
    await ui.advance.click(); await browserExpect(ui.step).toHaveText('1')
    const saved = JSON.parse(await ui.stored.innerText())
    expect(saved).toEqual({ step: 1, scene: 'ecosystem', oxygen: 91, unlocked: ['dive', 'ecosystem'], result: { valid: true, ratio: 0.35 } })
    await ui.invalid.click(); await browserExpect(ui.status).toHaveText('progress-invalid')
    await ui.nullable.click(); await browserExpect(ui.status).toHaveText('null-saved')
    await first.reload(); ui = await waitForPlayer(first, carrier)
    expect(JSON.parse(await ui.stored.innerText())).toEqual(saved)
    expect(await authorSnapshot(first)).toBe(original)

    await context.close(); context = await open()
    first = await context.newPage(); await first.goto(url); ui = await waitForPlayer(first, carrier)
    expect(JSON.parse(await ui.stored.innerText())).toEqual(saved)
    await first.screenshot({ path: join(directory, `${carrier}-reopened.png`) })

    const second = await context.newPage(); await second.goto(url)
    let secondUi = await waitForPlayer(second, carrier)
    await ui.advance.click(); await browserExpect(ui.step).toHaveText('2')
    await secondUi.advance.click(); await browserExpect(secondUi.status).toHaveText('progress-conflict')
    await browserExpect(secondUi.step).toHaveText('1')
    await second.reload(); secondUi = await waitForPlayer(second, carrier)
    await browserExpect(secondUi.step).toHaveText('2')
    await ui.reset.click(); await browserExpect(ui.step).toHaveText('0')
    await secondUi.advance.click(); await browserExpect(secondUi.status).toHaveText('progress-conflict')
    await second.reload(); secondUi = await waitForPlayer(second, carrier)
    expect(JSON.parse(await secondUi.stored.innerText())).toEqual(initialState)
    expect(await authorSnapshot(first)).toBe(original)
    await second.screenshot({ path: join(directory, `${carrier}-reset.png`) })

    // Use the actual player option to represent a non-persistent preview. The
    // author must see an unavailable capability, not an empty saved game.
    await first.evaluate(async compiled => {
      const w = window as any
      await w.coursePlayer.dispose(); w.coursePlayer = undefined
      const payload = (document.getElementById('course-data') as any).__courseDecodedPayload
      const mount = compiled ? w.CoursewareCompiledPlayer.mountCompiledCourse : w.CoursewarePlayer.mountPublishedCourseV4
      w.coursePlayerReady = mount(payload, document.getElementById('course-root'), { progressPersistence: false })
        .then((player: unknown) => { w.coursePlayer = player; return player }, (error: unknown) => { w.__coursePlaybackFailure(error); throw error })
      w.coursePlayerReady.catch(() => {})
    }, carrier !== 'published-native')
    const unavailable = controls(first, carrier)
    await browserExpect(unavailable.status).toHaveText('progress-disabled', { timeout: 15_000 })
    await browserExpect(unavailable.advance).toBeDisabled()
    expect(await authorSnapshot(first)).toBe(original)
    expect(networkRequests).toEqual([])
    expect(errors).toEqual([])
    await writeFile(join(directory, `${carrier}-result.json`), JSON.stringify({ passed: true, carrier, offline: true, reopened: saved,
      invalidWrite: 'progress-invalid', nullIsJson: true, concurrentWrite: 'progress-conflict', resetBlocksStaleWrite: true,
      disabledPreview: 'progress-disabled', authorUnchanged: true, networkRequests, modelCalls: 0 }, null, 2))
  } finally { await context.close() }
}, 60_000)
