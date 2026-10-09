import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pptxMediaFixture } from '../fixtures/pptxMedia'
import type { PptxImportDraft } from '../../src/renderer/project/pptxImport'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { planPptxImportTransaction } from '../../src/renderer/project/pptxImportTransaction'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { buildComponentSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'

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
  const project = createBlankCourseProjectV10('内嵌媒体')
  const resources = { assets: {}, components: {} }, driver = new CourseV10Driver()
  const session = await DocumentSession.create({ documentId: 'pptx-media', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: '内嵌媒体.h5lesson' },
    model: { kind: 'course-v10', project, resources } }, driver, {
      append: async () => {}, save: async () => { throw new Error('Archive save is exercised directly below') },
    })
  const step = planPptxImportTransaction({ documentId: session.documentId, epoch: 'epoch', project, resources, editingProject: project,
    activeStateId: null, surfaceId: project.surfaces[0].id, instanceIds: [], instanceId: null }, draft, '内嵌媒体')
  const dispatch = (mutation: import('../../src/shared/workbench/document').DocumentOperation['mutation']) => session.execute({
    documentId: session.documentId, epoch: 'epoch', baseRevision: session.read().revision, operationId: crypto.randomUUID(), actor: 'human', mutation,
  })
  const receipt = await dispatch({ type: 'command', command: { type: 'component-platform.apply', edits: step.edits, expected: step.expected } })
  expect(receipt, JSON.stringify(receipt)).toMatchObject({ status: 'applied' })
  const applied = session.read().model
  expect(await dispatch({ type: 'undo' })).toMatchObject({ status: 'applied' })
  expect(session.read().model).toMatchObject({ kind: 'course-v10', project: { instances: project.instances, assets: {} }, resources })
  expect(await dispatch({ type: 'redo' })).toMatchObject({ status: 'applied' })
  const redone = session.read().model
  if (redone.kind !== 'course-v10' || applied.kind !== 'course-v10') throw new Error('V10 required')
  expect(redone.project.instances).toEqual(applied.project.instances)
  expect(redone.resources).toEqual(applied.resources)
  const reopened = openCourseProjectV10Archive(createCourseProjectV10Archive({ project: redone.project, resources: redone.resources }))
  // Project JSON has one representation for zero, including rotated frame -0.
  expect(reopened.project).toEqual(JSON.parse(JSON.stringify(redone.project)))
  const imported = reopened.project.surfaces.find(surface => surface.id === step.createdSurfaceId)!
  const outputProject = { ...reopened.project, surfaces: [imported, ...reopened.project.surfaces.filter(surface => surface.id !== imported.id && surface.id !== project.surfaces[0].id)] }
  const published = await buildPublishedCourseV3({ project: outputProject, assetBytes: reopened.resources.assets })
  expect(published.diagnostics).toEqual([])
  const html = buildComponentSingleHtml(published.payload, readFileSync(resolve('dist-player/player.iife.js'), 'utf8'))
  const path = testInfo.outputPath('media.html')
  mkdirSync(testInfo.outputDir, { recursive: true }); writeFileSync(path, html)
  await page.evaluate(() => {
    const original = HTMLMediaElement.prototype.play
    ;(window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia = []
    HTMLMediaElement.prototype.play = function () {
      ;(window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.push(this)
      return original.call(this)
    }
  })
  await page.setContent(readFileSync(path, 'utf8'))
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
  const shapeId = Object.values(outputProject.instances).find(instance => {
    const implementation = outputProject.definitions[instance.definitionId]?.implementation
    return implementation?.kind === 'builtin' && implementation.key === 'guoling.shape'
  })!.id
  const shape = page.locator(`[data-component-object="${shapeId}"]`)
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
  await expect(video).toBeHidden()
  await expect.poll(() => page.evaluate(() => (window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.every(element => element.paused))).toBe(true)
  await page.keyboard.press('ArrowLeft')
  await expect(video).toBeVisible()
  // The current Player retains visited roots and interaction state; leaving pauses media.
  await expect(shape).toBeVisible()
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
