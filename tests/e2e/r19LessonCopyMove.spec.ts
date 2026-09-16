import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { copyFileSync, readdirSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { r19ScannedMaterial } from '../fixtures/r19ScannedMaterial'
import { parallelCircuitPng } from '../fixtures/r19ParallelLessonMaterials'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

test('r19 lesson copy and move preserve adopted materials and relative files with independent conversations', async ({}, testInfo) => {
 test.setTimeout(120_000)
 const evidence = resolve('output/r19-lesson-copy-move', new Date().toISOString().replace(/[:.]/g, '-'))
 const workspace = join(evidence, 'workspace'), profile = join(evidence, 'profile'); mkdirSync(workspace, { recursive: true })
 let app: ElectronApplication | undefined
 try {
  const launch = () => electron.launch({ cwd: resolve(__dirname, '../..'), args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
  app = await launch()
  let page = await app.firstWindow()
  const choose = (filename: string) => app!.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, filename)
  await choose(workspace); await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  await page.getByRole('button', { name: '新建课例', exact: true }).click()
  await page.getByRole('textbox', { name: '课例名称' }).fill('原课例')
  await page.getByRole('button', { name: '创建课例', exact: true }).click()
  await expect(page.locator('.lesson-workspace-lessons').getByRole('button', { name: /原课例/ })).toBeVisible()
  const list = () => page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons!, workspace)
  const original = (await list())[0]!
  const conversations = (lesson: typeof original.identity) => page.evaluate(async lesson => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson })).conversations!, lesson)
  const originalConversation = (await conversations(original.identity))[0]!
  // Seed one real repository session reference without starting any native process.
  const sessionId = randomUUID()
  await new LessonConversationRepository(profile).attachSession(original.identity, originalConversation.conversationId, sessionId, originalConversation.epoch)
  const projectPath = join(original.identity.normalizedDirectory, 'course.h5lesson')
  await page.getByRole('tab', { name: '课件', exact: true }).click()
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, projectPath)
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
  await expect.poll(async () => (await conversations(original.identity))[0].projectTarget?.normalizedPath).toBe(projectPath.replace(/\\/g, '/').toLowerCase())
  const source = '# 电路课例\n\n![两条支路](assets/circuit.png)\n'
  const ref = { lessonId: original.identity.lessonId, lessonDirectory: original.identity.normalizedDirectory, relativePath: 'notes.md' }
  await page.evaluate(async ({ ref, source, bytes, lesson }) => {
   const result = await window.desktopAPI!.lessonFiles!.saveDocument({ ref, source, expectedVersion: null, operationId: 'copy-seed-file', attachments: [{ relativePath: 'assets/circuit.png', bytes: new Uint8Array(bytes) }] })
   if (result.status !== 'saved') throw new Error('fixture file save failed')
   await window.desktopAPI!.lesson!({ operation: 'register-document', lesson, role: 'teaching-plan', relativePath: ref.relativePath })
  }, { ref, source, bytes: Array.from(parallelCircuitPng()), lesson: original.identity })
  const pdf = join(evidence, 'source.pdf'); writeFileSync(pdf, r19ScannedMaterial())
  await page.getByRole('tab', { name: '材料', exact: true }).click(); await choose(pdf)
  await page.getByRole('button', { name: /^添加材料（PDF/ }).click()
  const material = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'source.pdf', exact: true }) })
  await material.getByRole('checkbox', { name: '采用片段 1', exact: true }).check()
  const panel = page.getByRole('region', { name: '课例创作流程' })
  await panel.getByRole('button', { name: '根据材料自动创作', exact: true }).click()
  await expect(panel.getByRole('button', { name: '根据材料自动创作', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const sourceFiles = ['.courseware/lesson.json', '.courseware/authoring-state.json', 'notes.md', 'assets/circuit.png', 'course.h5lesson']
  const originalBytes = sourceFiles.map(name => readFileSync(join(original.identity.normalizedDirectory, name)))
  const copyPath = join(workspace, '副本'), movedPath = join(workspace, '移动后的副本')
  const copyDirectory = (from: string, to: string) => { mkdirSync(to); for (const entry of readdirSync(from, { withFileTypes: true })) { if (entry.isDirectory()) copyDirectory(join(from, entry.name), join(to, entry.name)); else if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name)); else throw new Error('Unexpected fixture symlink') } }
  copyDirectory(original.identity.normalizedDirectory, copyPath)
  await page.getByRole('button', { name: '作为独立课例副本打开', exact: true }).click()
  await choose(copyPath); await page.getByRole('button', { name: '选择副本目录并打开', exact: true }).click()
  await expect.poll(async () => (await list()).some(item => item.identity.normalizedDirectory.endsWith('/副本') && item.identity.lessonId !== original.identity.lessonId)).toBe(true)
  const copied = (await list()).find(item => item.identity.normalizedDirectory.endsWith('/副本'))!
  const copyConversations = await conversations(copied.identity)
  expect(copyConversations[0].conversationId).not.toBe(originalConversation.conversationId)
  expect(copyConversations[0].sessionIds).toEqual([])
  const copiedState = await page.evaluate(async ({ lesson, conversationId }) => window.desktopAPI!.lessonAuthoring!({ operation: 'read', lesson, conversationId }), { lesson: copied.identity, conversationId: copyConversations[0].conversationId })
  expect(copiedState.run).toBeUndefined(); expect(copiedState.assembly).toBeUndefined(); expect(copiedState.view.state.materials).toEqual([])
  for (const [index, name] of sourceFiles.entries()) expect(readFileSync(join(original.identity.normalizedDirectory, name))).toEqual(originalBytes[index])
  const readMaterials = (lesson: typeof original.identity) => page.evaluate(async lesson => {
   const target = { lessonId: lesson.lessonId, rootPath: lesson.normalizedDirectory }, api = window.desktopAPI!.lessonMaterials!
   const records = await api.list(target)
   return Promise.all(records.map(async record => ({ record, read: await api.read(target, { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: record.fragments.map(f => f.id) }) })))
  }, lesson)
  const copyMaterials = await readMaterials(copied.identity)
  expect(copyConversations).toHaveLength(1)
  expect(copyMaterials).toHaveLength(1); expect(copyMaterials[0].read.assets[0].bytes.length).toBeGreaterThan(100)
  // Rename only the checked test-owned directory; never move a user lesson.
  for (const candidate of [copyPath, movedPath]) { const rel = relative(workspace, resolve(candidate)); if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Unsafe fixture move') }
  await app.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
  await app.close().catch(() => {}); app = undefined
  renameSync(copyPath, movedPath)
  app = await launch(); page = await app.firstWindow()
  await choose(workspace); await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  await choose(movedPath); await page.getByRole('button', { name: '打开课例', exact: true }).click()
  await expect.poll(async () => (await list()).find(item => item.identity.normalizedDirectory.endsWith('/移动后的副本'))?.identity.lessonId).toBe(copied.identity.lessonId)
  const moved = (await list()).find(item => item.identity.lessonId === copied.identity.lessonId)!
  const movedMaterials = await readMaterials(moved.identity)
  expect(movedMaterials[0].read.extractionVersion).toBe(copyMaterials[0].read.extractionVersion)
  const movedFile = await page.evaluate(async ref => window.desktopAPI!.lessonFiles!.openDocument(ref), { ...ref, lessonId: moved.identity.lessonId, lessonDirectory: moved.identity.normalizedDirectory })
  expect(movedFile.source).toBe(source); expect(movedFile.diagnostics).toEqual([])
  expect(movedFile.version.attachments[0].contentVersion).not.toBe('missing')
  const openedProject = await page.evaluate(async filename => window.desktopAPI!.lesson!({ operation: 'open-project', path: filename }), join(movedPath, 'course.h5lesson'))
  expect(openedProject.projectFile).toBeTruthy()
  expect((await conversations(moved.identity))[0].conversationId).toBe(copyConversations[0].conversationId)
  expect((await conversations(original.identity))[0].sessionIds).toContain(sessionId)
  writeFileSync(join(evidence, 'verification.json'), JSON.stringify({ original, copied, moved, copyConversations, copiedState, modelInvoked: false, checks: ['copy-entry', 'source-unchanged', 'conversation-isolation', 'adopted-material-copy-read', 'move-stable-identity', 'relative-document-image-and-project-read'] }, null, 2))
  await page.screenshot({ path: join(evidence, 'copy-moved.png') })
 } catch (error) {
  const page = app?.windows()[0]
  if (page) { await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}); writeFileSync(join(evidence, 'failure-ui.txt'), await page.locator('body').innerText().catch(() => '')) }
  await testInfo.attach('evidence-directory', { body: evidence, contentType: 'text/plain' }); throw error
 } finally { if (app) { await app.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {}); await app.close().catch(() => {}) } }
})
