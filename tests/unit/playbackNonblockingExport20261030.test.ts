// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { setRootContainers } from '../helpers/glxWorkFixture'

it('saved offline exports keep authored navigation, bottom clicks and a folded fallback usable after nonblocking failures', async () => {
  const output = resolve('output/navigation-diagnostics-20261030')
  await mkdir(output, { recursive: true })
  const runtime = process.env.CREATION_BOUNDARY_USE_DIST_PLAYER === '1'
    ? await readFile('dist-player/compiled-player.iife.js', 'utf8')
    : (await build({ entryPoints: ['src/player/componentPlatform/compiledEntry.ts'], bundle: true, write: false,
      format: 'iife', globalName: 'CoursewareCompiledPlayer', platform: 'browser', target: 'es2022' })).outputFiles[0]!.text
  const browser = await chromium.launch({ headless: true }), results: unknown[] = []
  try {
    for (const authored of [true, false]) {
      const project = createBlankCourseProjectV10(authored ? '已有导航 · 非阻塞诊断验收' : '折叠控制台 · 非阻塞诊断验收')
      setRootContainers(project, [{ id: 'review', kind: 'slide', title: 'Review', childIds: [], designSize: { width: 1280, height: 720 },
        presentation: { states: [{ id: 'question', title: 'Question', overrides: {} }] } },
      { id: 'practice', kind: 'slide', title: 'Practice', childIds: [], designSize: { width: 1280, height: 720 } }])
      project.definitions.lesson = { id: 'lesson', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
      project.instances.lesson = { id: 'lesson', definitionId: 'lesson', frame: { width: 1280, height: 720, transform: [1, 0, 0, 1, 0, 0] },
        data: { html: `<!doctype html><html><head><style>
          *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:system-ui,sans-serif;background:#f6f8f2;color:#26213a}
          body{display:flex;flex-direction:column}header{padding:20px 30px;color:#584481;border-bottom:2px solid #ddd}
          nav{display:flex;gap:14px;align-items:center}button{font:inherit;padding:10px 18px;border-radius:12px;border:1px solid #584481;background:white;color:#584481;cursor:pointer}
          main{flex:1;padding:32px 6%;text-align:center}h1{font-size:38px}.questions{display:flex;gap:14px;justify-content:center;margin:36px 0}
          .card{padding:30px 15px;flex:1;max-width:220px;background:#584481;color:white;border-radius:22px;font-size:24px}
          footer{height:72px;background:#584481;color:white;display:flex;align-items:center;gap:20px;padding:10px 30px}footer button{background:#f1eaca}
          @media(max-width:600px){header{padding:12px}main{padding:12px}h1{font-size:25px}.questions{flex-wrap:wrap;margin:12px}.card{padding:15px;font-size:17px}footer{padding:8px 16px}}
          </style></head><body><header><nav>${authored ? '<button id="back">上一页</button><button id="next">下一页</button>' : '<strong>教师控制台按需展开</strong>'}<output id="location">Review</output></nav></header>
          <main><p>01 / REVIEW</p><h1>How do we get to know each other?</h1><p>页面应当保持完整，诊断不遮挡正文或底部操作。</p>
          <section class="questions"><div class="card">What is your name?</div><div class="card">Where are you from?</div><div class="card">What do you like?</div></section></main>
          <footer><button id="bottom">底部操作</button><output id="feedback">尚未操作</output></footer><script>
          document.getElementById('bottom').onclick=()=>document.getElementById('feedback').textContent='底部操作已完成';
          courseNavigationReady.then(nav=>{const sync=()=>{document.getElementById('location').textContent=nav.readLocation();
            ${authored ? "document.getElementById('back').disabled=!nav.canExecute({type:'scene.previous'});document.getElementById('next').disabled=!nav.canExecute({type:'scene.next'});" : ''}};
            ${authored ? "nav.bindControl(document.getElementById('back'),{type:'scene.previous'});nav.bindControl(document.getElementById('next'),{type:'scene.next'});" : ''}
            nav.subscribe(sync);sync();});
          </script></body></html>`, css: '', resourceBindings: {} } }
      project.global.overlay.push('lesson')
      const published = await buildPublishedCourseV3({ project, assetBytes: {} })
      const dom = new JSDOM('<!doctype html>')
      const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document,
        renderBuiltin: async () => { throw new Error('Unexpected static builtin') } })
      dom.window.close()
      const file = resolve(output, authored ? 'authored-navigation.html' : 'fallback-controller.html')
      await writeFile(file, buildCompiledSingleHtml(artifact, runtime))
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors: string[] = [], network: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
      try {
        await page.goto(pathToFileURL(file).href)
        await page.evaluate(() => Reflect.get(window, 'coursePlayerReady'))
        const content = page.frameLocator('[data-compiled-runtime-root="lesson"] iframe')
        await content.getByRole('button', { name: '底部操作', exact: true }).waitFor()
        await page.evaluate(() => {
          for (let index = 0; index < 12; index++) Reflect.get(window, '__coursePlaybackDiagnostic')('重复的非阻塞诊断', { severity: 'warning', code: 'repeated' })
          Reflect.get(window, '__coursePlaybackDiagnostic')('可选组件的局部失败', { severity: 'error', code: 'local-failure' })
          window.dispatchEvent(new ErrorEvent('error', { message: '非致命浏览器事件' }))
          const rejection = new Event('unhandledrejection');Object.defineProperty(rejection, 'reason', { value: new Error('可选异步任务失败') });window.dispatchEvent(rejection)
        })
        expect(await page.locator('#course-diagnostic').isVisible()).toBe(false)
        await content.getByRole('button', { name: '底部操作', exact: true }).click()
        expect(await content.locator('#feedback').textContent()).toBe('底部操作已完成')
        const chrome = page.locator('[data-playback-chrome="navigation"]')
        if (authored) {
          await content.getByRole('button', { name: '下一页', exact: true }).click()
          await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readLocation())).toBe('practice')
          await content.getByRole('button', { name: '上一页', exact: true }).click()
          await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readLocation())).toBe('review')
          // Wait for the same readiness grace used by the real fallback, rather than checking before it can appear.
          await page.waitForTimeout(2100)
          expect(await chrome.count()).toBe(0)
        } else {
          await chrome.getByRole('button', { name: '展开全局控制台', exact: true }).waitFor()
          expect(await chrome.locator('button').count()).toBe(1)
          expect(await chrome.evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, pointerEvents: getComputedStyle(node).pointerEvents })))
            .toEqual({ width: 52, height: 52, pointerEvents: 'none' })
          await page.screenshot({ path: resolve(output, 'fallback-folded.png') })
          await chrome.getByRole('button', { name: '展开全局控制台', exact: true }).click()
          await chrome.getByRole('button', { name: '下一步', exact: true }).click()
          await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.read().progress.stepIndex)).toBe(1)
          await chrome.getByRole('button', { name: '下一步', exact: true }).click()
          await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readLocation())).toBe('practice')
          await chrome.getByRole('button', { name: '展开全局控制台', exact: true }).waitFor()
          await page.setViewportSize({ width: 390, height: 700 })
          await page.screenshot({ path: resolve(output, 'fallback-narrow.png') })
          await page.setViewportSize({ width: 340, height: 240 })
          const launcher=chrome.getByRole('button', { name: '展开全局控制台', exact: true })
          const start=(await launcher.boundingBox())!
          await page.mouse.move(start.x+start.width/2,start.y+start.height/2)
          await page.mouse.down();await page.mouse.move(60,32,{steps:6});await page.mouse.up()
          await chrome.getByRole('button', { name: '展开全局控制台', exact: true }).click()
          const panelBounds=await chrome.locator('.guoling-controller').boundingBox()
          expect(panelBounds!.y).toBeGreaterThanOrEqual(0)
          expect(panelBounds!.y+panelBounds!.height).toBeLessThanOrEqual(240)
          await page.screenshot({path:resolve(output,'fallback-expanded-after-drag.png')})
          await chrome.getByRole('button', { name: '上一步', exact: true }).click()
          await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readLocation())).toBe('review')
          await chrome.getByRole('button', { name: '展开全局控制台', exact: true }).waitFor()
        }
        if(authored)await page.screenshot({ path: resolve(output, 'authored-navigation.png') })
        expect(errors).toEqual([]);expect(network).toEqual([])
        results.push({ authored, file, roundTrip: ['review', 'practice', 'review'], diagnosticsHidden: true, bottomClicked: true, errors, network })
      } finally { await page.close() }
    }
    await writeFile(resolve(output, 'offline-export-acceptance.json'), JSON.stringify({ productionBundle: process.env.CREATION_BOUNDARY_USE_DIST_PLAYER === '1', results }, null, 2))
  } finally { await browser.close() }
}, 60000)
