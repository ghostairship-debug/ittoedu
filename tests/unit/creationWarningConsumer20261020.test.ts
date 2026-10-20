// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { JSDOM } from 'jsdom'
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

it('keeps a retained nonblocking diagnostic visible while the real compiled export mounts successfully', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent(buildCompiledSingleHtml(artifact, runtimeBundle))
    const result = await page.evaluate(async () => {
      await Reflect.get(window, 'coursePlayerReady')
      const diagnostic = document.getElementById('course-diagnostic')!
      const result = { playerReady: Boolean(Reflect.get(window, 'coursePlayer')), hidden: diagnostic.hidden,
        diagnostic: diagnostic.textContent, fatal: Reflect.get(window, '__coursePlaybackError') }
      await Reflect.get(window, 'coursePlayer').dispose()
      return result
    })
    await record('warning', result)
    expect(result.playerReady).toBe(true)
    expect(result.hidden).toBe(false)
    expect(result.diagnostic).toContain(artifact.diagnostics[0]!.message)
    expect(result.diagnostic).not.toContain('课件加载失败')
    expect(result.fatal).toBeUndefined()
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

it('keeps falsey fatal reasons visible after mount resolves and a later warning arrives', async () => {
  const results: unknown[] = []
  for (const reason of [undefined, null, 0, false, '']) {
    const literal = reason === undefined ? 'undefined' : JSON.stringify(reason)
    // Only the generated early-script consumer is under test here. The stub
    // dispatches the browser event explicitly; it is not a runtime execution.
    const bundle = `var CoursewareCompiledPlayer={mountCompiledCourse:function(course,root,options){
      window.F01Report=options.report;
      var event=new Event('unhandledrejection');Object.defineProperty(event,'reason',{value:${literal}});
      window.dispatchEvent(event);return Promise.resolve({});
    }};`
    const dom = new JSDOM(buildCompiledSingleHtml(artifact, bundle), { runScripts: 'dangerously' })
    try {
      await Reflect.get(dom.window, 'coursePlayerReady')
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
