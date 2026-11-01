// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { setRootContainers } from '../helpers/glxWorkFixture'

it('the real offline export recognizes HTML shadow navigation before the first click and releases it with its mount', async () => {
  const project = createBlankCourseProjectV10('HTML navigation bridge')
  setRootContainers(project, [{ id: 'a', kind: 'slide', title: 'A', childIds: [], designSize: { width: 960, height: 600 },
    presentation: { states: [{ id: 'detail', title: 'Detail', overrides: {} }] } },
  { id: 'b', kind: 'slide', title: 'B', childIds: [], designSize: { width: 960, height: 600 } }])
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  project.instances.web = { id: 'web', definitionId: 'web', frame: { width: 960, height: 600, transform: [1, 0, 0, 1, 0, 0] },
    data: { html: `<!doctype html><html><body style="margin:0;background:#edf1ec"><section id="navigation"></section><script>
      courseNavigationReady.then(nav => {
        const shadow=document.getElementById('navigation').attachShadow({mode:'open'});
        shadow.innerHTML='<button id="back">Previous page</button><button id="next">Next page</button><output id="where"></output>';
        const next=shadow.getElementById('next'),back=shadow.getElementById('back');
        const off=[nav.bindControl(next,{type:'scene.next'}),nav.bindControl(back,{type:'scene.previous'})];
        const sync=()=>{next.disabled=!nav.canExecute({type:'scene.next'});back.disabled=!nav.canExecute({type:'scene.previous'});shadow.getElementById('where').textContent=nav.readLocation()};
        off.push(nav.subscribe(sync));sync();window.releaseNavigation=()=>off.forEach(release=>release());
      }).catch(error=>document.body.dataset.navigationError=String(error));
    </script></body></html>`, css: '', resourceBindings: {} } }
  project.global.overlay.push('web')
  const published = await buildPublishedCourseV3({ project, assetBytes: {} })
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document,
    renderBuiltin: async () => { throw new Error('Unexpected static builtin') } })
  dom.window.close()
  const runtime = (await build({ entryPoints: ['src/player/componentPlatform/compiledEntry.ts'], bundle: true, write: false,
    format: 'iife', globalName: 'CoursewareCompiledPlayer', platform: 'browser', target: 'es2022' })).outputFiles[0]!.text
  const output = resolve('output/navigation-diagnostics-20261030')
  await mkdir(output, { recursive: true })
  const html = buildCompiledSingleHtml(artifact, runtime)
  await writeFile(resolve(output, 'html-shadow-navigation.html'), html)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } }), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(new URL(`file:///${resolve(output, 'html-shadow-navigation.html').replace(/\\/g, '/')}`).href)
    await page.evaluate(() => Reflect.get(window, 'coursePlayerReady'))
    const child = page.frameLocator('[data-compiled-runtime-root="web"] iframe')
    await child.getByRole('button', { name: 'Next page', exact: true }).waitFor()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readControls().actions.map((value: { type: string }) => value.type)))
      .toEqual(['scene.next', 'scene.previous'])
    const beforeClick = await page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readControls())
    await child.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readLocation())).toBe('b')
    await child.getByRole('button', { name: 'Previous page', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readLocation())).toBe('a')
    expect(await child.locator('body').getAttribute('data-navigation-error')).toBeNull()
    await page.screenshot({ path: resolve(output, 'html-shadow-navigation.png') })
    await child.locator('body').evaluate(() => Reflect.get(window, 'releaseNavigation')())
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'coursePlayer').navigation.readControls().actions)).toEqual([])
    await page.evaluate(() => Reflect.get(window, 'coursePlayer').dispose())
    expect(errors).toEqual([])
    await writeFile(resolve(output, 'html-shadow-navigation.json'), JSON.stringify({ beforeClick, roundTrip: ['a', 'b', 'a'], released: true, errors }, null, 2))
  } finally { await browser.close() }
}, 45000)
