import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pptxMediaFixture } from '../fixtures/pptxMedia'
import type { PptxImportDraft } from '../../src/renderer/project/pptxImport'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { planPptxImportTransaction } from '../../src/renderer/project/pptxImportTransaction'
import { applyEditorTransactionStep } from '../../src/renderer/authoring/editorTransaction'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'

for (const kind of ['video', 'audio'] as const) test(`PPTX embedded ${kind} decodes, survives save/reopen, and plays in offline HTML`, async ({ page }, testInfo) => {
  const bundle = await build({ stdin: { contents: "export { parsePptxImport } from './src/renderer/project/pptxImport'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'iife', globalName: 'pptxImportTest', platform: 'browser', write: false })
  const media = kind === 'video' ? new Uint8Array(readFileSync(resolve('tests/fixtures/r18CommonTasks/materials/motion.webm'))) : wave()
  const bytes = pptxMediaFixture({ kind, secondPage: true, visibilityEffect: kind === 'video', extension: kind === 'video' ? 'webm' : 'wav', bytes: media })
  await page.goto('about:blank')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const staged = await page.evaluate(async input => {
    const api = (window as unknown as { pptxImportTest: { parsePptxImport(bytes: Uint8Array): Promise<PptxImportDraft> } }).pptxImportTest
    const draft = await api.parsePptxImport(new Uint8Array(input))
    return { ...draft, assets: draft.assets.map(asset => ({ ...asset, bytes: Array.from(asset.bytes) })) }
  }, Array.from(bytes))
  const draft: PptxImportDraft = { ...staged, assets: staged.assets.map(asset => ({ ...asset, bytes: new Uint8Array(asset.bytes) })) }
  expect(draft.assets).toHaveLength(1)
  expect(draft.assets[0].meta.duration).toBeGreaterThan(0)
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const initial = { document: project, resources: { assetFiles: {}, componentPackages: {} } }
  const step = planPptxImportTransaction(project, draft, '内嵌视频')
  const applied = applyEditorTransactionStep(initial, step, 'forward')
  expect(applyEditorTransactionStep(applied, step, 'inverse')).toEqual(initial)
  const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: applied.document, assetFiles: applied.resources.assetFiles, componentFiles: {} }))
  expect(reopened.project).toEqual(applied.document)
  const imported = reopened.project.surfaces.find(surface => surface.type === 'slide' && surface.scenes.some(scene => scene.layerItems.some(item => item.label.startsWith('内嵌视频'))))!
  reopened.project.startLocationId = reopened.project.locations.find(location => location.surfaceId === imported.id)!.id
  const html = buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} }, { playerBundle: readFileSync(resolve('dist-player/player.iife.js'), 'utf8') })
  const path = testInfo.outputPath('media.html')
  mkdirSync(testInfo.outputDir, { recursive: true }); writeFileSync(path, html)
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play
    ;(window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia = []
    HTMLMediaElement.prototype.play = function () {
      ;(window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.push(this)
      return original.call(this)
    }
  })
  await page.goto(pathToFileURL(path).href)
  if (kind === 'audio') {
    await page.getByText('▶ 播放音频', { exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.some(element => element.tagName === 'AUDIO' && element.currentTime > 0.1 && !element.error))).toBe(true)
    await page.keyboard.press('ArrowRight')
    await expect(page.getByText('第二页', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.every(element => element.paused))).toBe(true)
    await page.keyboard.press('ArrowLeft')
    await page.getByText('▶ 播放音频', { exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.at(-1)?.currentTime ?? 0)).toBeGreaterThan(0.1)
    expect(await page.evaluate(() => (window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.at(-1)?.error)).toBeNull()
    return
  }
  const video = page.locator('video').first()
  await expect(video).toBeVisible()
  const shape = page.locator('[data-native-type="shape"]').first()
  await expect(shape).toBeHidden()
  await page.getByText('知识 😀', { exact: true }).click()
  await expect(shape).toBeVisible()
  await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play() })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1)
  await video.evaluate((element: HTMLVideoElement) => element.pause())
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull()
  const pausedTime = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
  await video.evaluate(async (element: HTMLVideoElement) => { await element.play() })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(pausedTime + 0.05)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('第二页', { exact: true })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.every(element => element.paused))).toBe(true)
  await page.keyboard.press('ArrowLeft')
  await expect(video).toBeVisible()
  await expect(shape).toBeHidden()
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play() })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1)
  expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull()
})

function wave(): Uint8Array {
  const count = 16000
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer)
  const chars = (offset: number, value: string) => [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
  chars(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); chars(8, 'WAVE'); chars(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  chars(36, 'data'); view.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / 8000) * 8000), true)
  return bytes
}
