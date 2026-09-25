import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { r19ScannedMaterial } from '../fixtures/r19ScannedMaterial'
import { decodeImageTransformPng } from '../../src/shared/imageTransform'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

test('r19 scanned PDF: real page extraction, selected PNG and readable provenance without a model', async ({}, testInfo) => {
 test.setTimeout(120_000)
 const directory = resolve('output/r19-scanned-material', new Date().toISOString().replace(/[:.]/g, '-'))
 const workspace = join(directory, 'workspace'); mkdirSync(workspace, { recursive: true })
 const source = join(directory, 'scanned-circuit.pdf'); writeFileSync(source, r19ScannedMaterial())
 let app: ElectronApplication | undefined
 try {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(directory, 'profile')}`], cwd: resolve(__dirname, '../..'), env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  const choose = async (filename: string) => app!.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, filename)
  const lesson = await page.evaluate(async directory => {
   const result = await window.desktopAPI!.lesson!({ operation: 'create-lesson', directory, name: '扫描电路材料' })
   if (!result.lesson) throw new Error('Lesson fixture missing')
   return result.lesson
  }, workspace)
  const project = createBlankCourseProject({ title: '扫描电路材料', includeDefaultController: false, controls: 'none' })
  writeFileSync(join(lesson.identity.normalizedDirectory, 'course.h5lesson'), createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
  writeFileSync(join(lesson.identity.normalizedDirectory, '.courseware', 'lesson.json'), JSON.stringify({ ...lesson.manifest, coursePath: 'course.h5lesson' }))
  await choose(workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  await page.locator('.lesson-directory-tree').getByRole('button', { name: '扫描电路材料', exact: true }).click()
  await page.locator('.lesson-directory-tree').getByRole('button', { name: 'course.h5lesson', exact: true }).click()
  await page.getByRole('tab', { name: '材料', exact: true }).click()
  await choose(source)
  await page.getByRole('button', { name: /^添加材料（PDF/ }).click()
  const article = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'scanned-circuit.pdf', exact: true }) })
  await expect(article).toBeVisible()
  await article.getByRole('button', { name: /第 1 页 · 图像/ }).click()
  const image = page.getByRole('img', { name: '材料原图或页面图像' })
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(100)
  await article.getByRole('checkbox', { name: '采用片段 1', exact: true }).check()
  await expect(article.getByRole('checkbox', { name: '采用片段 1', exact: true })).toBeChecked()
  const proof = await page.evaluate(async ({ lesson, workspace }) => {
   const target = { lessonId: lesson.identity.lessonId, rootPath: lesson.identity.normalizedDirectory }
   const records = await window.desktopAPI!.lessonMaterials!.list(target), record = records[0]!
   const read = await window.desktopAPI!.lessonMaterials!.read(target, { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: [record.fragments[0]!.id] })
   const conversations = (await window.desktopAPI!.execution!.workspace(workspace)).conversations
   return { lesson, record, read: { ...read, assets: read.assets.map(asset => ({ ...asset, bytes: Array.from(asset.bytes) })) }, runs: conversations.flatMap(value => value.runIndex.builtinRunIds) }
  }, { lesson, workspace })
  expect(proof.record.fragments).toHaveLength(1)
  expect(proof.record.fragments[0].kind).toBe('image')
  expect(proof.record.gaps[0].resolution).toEqual({ kind: 'read-page-image', assetId: proof.record.fragments[0].assetId })
  expect(proof.read.fragments[0].id).toBe(proof.record.fragments[0].id)
  expect(proof.read.assets[0].bytes.length).toBeGreaterThan(0)
  expect(proof.runs).toEqual([])
  const pixels = decodeImageTransformPng(readFileSync(join(proof.lesson.identity.normalizedDirectory, proof.record.assets[0].path)))
  expect(pixels.width).toBeGreaterThan(100)
  expect(new Set(pixels.data).size).toBeGreaterThan(10)
  writeFileSync(join(directory, 'verification.json'), JSON.stringify({ ...proof, pixels: { width: pixels.width, height: pixels.height }, modelInvoked: false }, null, 2))
  await page.screenshot({ path: join(directory, 'selected-scanned-page.png') })
 } catch (error) {
  const page = app?.windows()[0]
  if (page) await testInfo.attach('last-ui', { body: await page.screenshot(), contentType: 'image/png' })
  throw error
 } finally {
  if (app) { await app.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {}); await app.close().catch(() => {}) }
 }
})
