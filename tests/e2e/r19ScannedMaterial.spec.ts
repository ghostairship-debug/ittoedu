import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { r19ScannedMaterial } from '../fixtures/r19ScannedMaterial'
import { decodeImageTransformPng } from '../../src/shared/imageTransform'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

test('r19 scanned PDF: real page extraction and selected PNG enables preparation without a model', async ({}, testInfo) => {
 test.setTimeout(120_000)
 const directory = resolve('output/r19-scanned-material', new Date().toISOString().replace(/[:.]/g, '-'))
 const workspace = join(directory, 'workspace'); mkdirSync(workspace, { recursive: true })
 const source = join(directory, 'scanned-circuit.pdf'); writeFileSync(source, r19ScannedMaterial())
 let app: ElectronApplication | undefined
 try {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(directory, 'profile')}`], cwd: resolve(__dirname, '../..'), env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  const choose = async (filename: string) => app!.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, filename)
  await choose(workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  await page.getByRole('button', { name: '新建课例', exact: true }).click()
  await page.getByRole('textbox', { name: '课例名称' }).fill('扫描电路材料')
  await page.getByRole('button', { name: '创建课例', exact: true }).click()
  await expect(page.locator('.lesson-workspace-lessons').getByRole('button', { name: /扫描电路材料/ })).toBeVisible()
  await page.getByRole('tab', { name: '材料', exact: true }).click()
  await choose(source)
  await page.getByRole('button', { name: /^添加材料（PDF/ }).click()
  const article = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'scanned-circuit.pdf', exact: true }) })
  await expect(article).toBeVisible()
  await article.getByRole('button', { name: /第 1 页 · 图像/ }).click()
  const image = page.getByRole('img', { name: '材料原图或页面图像' })
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(100)
  await article.getByRole('checkbox', { name: '采用片段 1', exact: true }).check()
  const panel = page.getByRole('region', { name: '课例创作流程' })
  await panel.getByRole('button', { name: '根据材料自动创作', exact: true }).click()
  await expect(panel.getByRole('button', { name: '根据材料自动创作', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const proof = await page.evaluate(async directory => {
   const lesson = (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!
   const conversation = (await window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson: lesson.identity })).conversations![0]!
   const records = await window.desktopAPI!.lessonMaterials!.list({ lessonId: lesson.identity.lessonId, rootPath: lesson.identity.normalizedDirectory })
   const state = await window.desktopAPI!.lessonAuthoring!({ operation: 'read', lesson: lesson.identity, conversationId: conversation.conversationId })
   return { lesson, record: records[0], state, sessions: conversation.sessionIds }
  }, workspace)
  expect(proof.record.fragments).toHaveLength(1)
  expect(proof.record.fragments[0].kind).toBe('image')
  expect(proof.record.gaps[0].resolution).toEqual({ kind: 'read-page-image', assetId: proof.record.fragments[0].assetId })
  expect(proof.state.view.state.materials).toEqual([{ id: proof.record.id, extractionVersion: proof.record.extractionVersion, sourceVersion: proof.record.sourceVersion, fragmentIds: [proof.record.fragments[0].id] }])
  expect(proof.state.run).toBeUndefined(); expect(proof.sessions).toEqual([])
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
