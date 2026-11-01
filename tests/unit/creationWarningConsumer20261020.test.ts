// @requires-player-bundle CREATION_BOUNDARY_USE_DIST_PLAYER=1
// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { JSDOM, VirtualConsole } from 'jsdom'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { compilePublishedWebProgram } from '../../src/core/publish/componentPlatform/compiledScript'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import type { CompiledCoursePlayback } from '../../src/core/publish/componentPlatform/compiledContract'

let browser: Browser, artifact: CompiledCoursePlayback, runtimeBundle: string

beforeAll(async () => {
  const project = createBlankCourseProjectV10('F01 warning consumer')
  const published = await buildPublishedCourseV3({ project, assetBytes: {} })
  const dom = new JSDOM('<!doctype html>')
  try {
    artifact = await compileCoursePlayback(published.payload, { document: dom.window.document,
      renderBuiltin: async () => { throw new Error('Unexpected static builtin') } })
  } finally { dom.window.close() }
  expect(artifact.diagnostics).toEqual([])
  // This is a conditional consumer probe. The current producer routes this
  // source to nativeData; replay its real nonblocking diagnostic on an otherwise
  // valid compiled artifact rather than claiming normal exports all trigger it.
  const warning = compilePublishedWebProgram({ html: '<script>if(false)import("optional")</script>', css: '' })
    .diagnostics.find(issue => issue.blocking === false)
  expect(warning).toBeDefined()
  artifact.diagnostics.push(warning!)
  runtimeBundle = process.env.CREATION_BOUNDARY_USE_DIST_PLAYER === '1'
    ? await readFile('dist-player/compiled-player.iife.js', 'utf8')
    : (await build({ entryPoints: ['src/player/componentPlatform/compiledEntry.ts'], bundle: true, write: false,
      format: 'iife', globalName: 'CoursewareCompiledPlayer', platform: 'browser', target: 'es2022' })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 30_000)

afterAll(async () => { await browser?.close() })

async function record(name: string, value: unknown) {
  const directory = resolve('output/creation-boundary-implementation-20261020/E-F')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, `F01-${name}-${process.env.CREATION_BOUNDARY_PHASE || 'latest'}.json`), JSON.stringify(value, null, 2))
}

it('keeps reports and browser diagnostics out of the real compiled export while bottom content remains clickable', async () => {
  const page = await browser.newPage()
  const messages: string[] = []
  page.on('console', message => messages.push(message.text()))
  try {
    await page.setContent(buildCompiledSingleHtml(artifact, runtimeBundle))
    const result = await page.evaluate(async () => {
      await Reflect.get(window, 'coursePlayerReady')
      const button = document.createElement('button')
      button.id = 'bottom-action'; button.textContent = '底部操作'
      Object.assign(button.style, { position: 'fixed', bottom: '0', left: '0', width: '100%', height: '28px' })
      button.onclick = () => { button.textContent = '底部操作已完成' }
      document.getElementById('course-root')!.append(button)
      const report = Reflect.get(window, '__coursePlaybackDiagnostic')
      for (let index = 0; index < 5; index++) report('导航通路缺失；普通诊断不进入画面')
      report('可选脚本局部失败', { severity: 'error', code: 'optional-component' })
      window.dispatchEvent(new ErrorEvent('error', { message: '局部事件处理失败', error: new Error('局部事件处理失败') }))
      const rejection = new Event('unhandledrejection')
      Object.defineProperty(rejection, 'reason', { value: new Error('可选异步任务失败') })
      window.dispatchEvent(rejection)
      const resource = document.createElement('script'); resource.src = 'data:text/javascript,'
      document.body.append(resource); resource.dispatchEvent(new Event('error'))
      const diagnostic = document.getElementById('course-diagnostic')!
      const result = { playerReady: Boolean(Reflect.get(window, 'coursePlayer')), hidden: diagnostic.hidden,
        diagnostic: diagnostic.textContent, fatal: Reflect.get(window, '__coursePlaybackError'),
        bottomHit: document.elementFromPoint(innerWidth / 2, innerHeight - 4)?.id }
      return result
    })
    await page.getByRole('button', { name: '底部操作', exact: true }).click()
    expect(await page.locator('#bottom-action').textContent()).toBe('底部操作已完成')
    await record('warning', result)
    expect(result.playerReady).toBe(true)
    expect(result.hidden).toBe(true)
    expect(result.diagnostic).toBe('')
    expect(result.fatal).toBeUndefined()
    expect(result.bottomHit).toBe('bottom-action')
    expect(messages.some(message => message.includes(artifact.diagnostics[0]!.message))).toBe(true)
    expect(messages.some(message => message.includes('[optional-component]'))).toBe(true)
    expect(messages.some(message => message.includes('局部事件处理失败'))).toBe(true)
    expect(messages.some(message => message.includes('可选异步任务失败'))).toBe(true)
    expect(messages.some(message => message.includes('脚本资源加载失败'))).toBe(true)
    await page.evaluate(() => Reflect.get(window, 'coursePlayer').dispose())
  } finally { await page.close() }
})

it('keeps a real compiled entry rejection prominent and traceable', async () => {
  const page = await browser.newPage()
  try {
    const invalid = { ...artifact, format: 'invalid-format' } as unknown as CompiledCoursePlayback
    await page.setContent(buildCompiledSingleHtml(invalid, runtimeBundle))
    const result = await page.evaluate(async () => {
      let rejected = ''
      try { await Reflect.get(window, 'coursePlayerReady') } catch (error) { rejected = String(error) }
      const diagnostic = document.getElementById('course-diagnostic')!
      return { rejected, hidden: diagnostic.hidden, role: diagnostic.getAttribute('role'), diagnostic: diagnostic.textContent,
        fatal: String(Reflect.get(window, '__coursePlaybackError')) }
    })
    await record('fatal', result)
    expect(result.rejected).toContain('未知编译播放制品')
    expect(result.fatal).toContain('未知编译播放制品')
    expect(result.hidden).toBe(false)
    expect(result.role).toBe('alert')
    expect(result.diagnostic).toContain('课件加载失败：未知编译播放制品')
  } finally { await page.close() }
})

it('does not promote unrelated rejections during mounting into a course failure', async () => {
  const bundle = `var CoursewareCompiledPlayer={mountCompiledCourse:function(course,root){
    var event=new Event('unhandledrejection');Object.defineProperty(event,'reason',{value:'optional task'});
    window.dispatchEvent(event);root.textContent='健康正文';return Promise.resolve({});
  }};`
  const dom = new JSDOM(buildCompiledSingleHtml(artifact, bundle), { runScripts: 'dangerously', virtualConsole: new VirtualConsole() })
  try {
    await Reflect.get(dom.window, 'coursePlayerReady')
    expect(dom.window.document.getElementById('course-root')!.textContent).toBe('健康正文')
    expect(dom.window.document.getElementById('course-diagnostic')!.hidden).toBe(true)
    expect(Reflect.get(dom.window, '__coursePlaybackFailed')).toBeUndefined()
  } finally { dom.window.close() }
})

it('keeps falsey entry rejection reasons visible when a later warning arrives', async () => {
  const results: unknown[] = []
  for (const reason of [undefined, null, 0, false, '']) {
    const literal = reason === undefined ? 'undefined' : JSON.stringify(reason)
    // A real rejected entry is fatal even when JavaScript allows a falsey reason.
    const bundle = `var CoursewareCompiledPlayer={mountCompiledCourse:function(course,root,options){
      window.F01Report=options.report;
      return Promise.reject(${literal});
    }};`
    const dom = new JSDOM(buildCompiledSingleHtml(artifact, bundle), { runScripts: 'dangerously', virtualConsole: new VirtualConsole() })
    try {
      let rejected = false
      try { await Reflect.get(dom.window, 'coursePlayerReady') } catch { rejected = true }
      expect(rejected).toBe(true)
      const diagnostic = dom.window.document.getElementById('course-diagnostic')!
      const firstMessage = `课件加载失败：${String(reason)}`
      expect(diagnostic.hidden).toBe(false)
      expect(diagnostic.getAttribute('role')).toBe('alert')
      expect(diagnostic.textContent).toBe(firstMessage)
      expect(Reflect.get(dom.window, '__coursePlaybackError')).toBe(reason)
      Reflect.get(dom.window, 'F01Report')('later warning', { severity: 'warning', code: 'late-warning' })
      expect(diagnostic.hidden).toBe(false)
      expect(diagnostic.getAttribute('role')).toBe('alert')
      expect(diagnostic.textContent).toBe(firstMessage)
      expect(Reflect.get(dom.window, '__coursePlaybackError')).toBe(reason)
      results.push({ reason: String(reason), hidden: diagnostic.hidden, role: diagnostic.getAttribute('role'), diagnostic: diagnostic.textContent })
    } finally { dom.window.close() }
  }
  await record('falsey-fatal', results)
})
