import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

test('r19 actual file AI reopen and selective undo preserves teacher changes', async ({}, testInfo) => {
 test.skip(process.env.R19_FILE_AI_UNDO_RUN !== '1', 'Requires an actual native AI change journal in retained manual lesson')
 test.setTimeout(120_000)
 const root = resolve(__dirname, '../..'), evidence = join(root, 'output/r19-manual-luna/manual-parallel-20260915-170551'), workspace = join(evidence, 'workspace')
 const output = join(evidence, 'file-ai-reopen-undo', new Date().toISOString().replace(/[:.]/g, '-')); mkdirSync(output, { recursive: true })
 const app = await electron.launch({ args: ['.', `--user-data-dir=${join(evidence, 'profile')}`], cwd: root, env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
 const page = await app.firstWindow()
 try {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  const emptyRecovery = page.getByRole('button', { name: '丢弃副本', exact: true })
  if (await emptyRecovery.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
   const filename = join(evidence, 'profile/project-data/recovery.h5lesson')
   const project = JSON.parse(Buffer.from(unzipSync(readFileSync(filename))['project.json']!).toString('utf8'))
   expect(project.title).toBe('未命名课件')
   expect(project.surfaces.every((surface: any) => surface.type === 'slide' && surface.scenes.every((scene: any) => scene.layerItems.length === 0))).toBe(true)
   copyFileSync(filename, join(output, 'untouched-blank-course-recovery.h5lesson')); await emptyRecovery.click()
  }

  const lesson = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!, workspace)
  await page.locator('.lesson-workspace-lessons').getByRole('button', { name: /并联支路证据推理手动课例/ }).click()
  await page.locator('.lesson-workspace-files').getByRole('button', { name: /并联支路证据推理手动课例$/ }).click()
  await page.locator('.lesson-workspace-files').getByRole('button', { name: 'teaching-brief.md', exact: true }).click()
  const ref = { lessonId: lesson.identity.lessonId, lessonDirectory: lesson.identity.normalizedDirectory, relativePath: 'teaching-brief.md' }
  const editor = page.getByRole('region', { name: '教学文档 teaching-brief.md', exact: true })
  const marker = editor.getByRole('complementary', { name: 'AI 改动记录' })
  await expect(marker).toBeVisible()
  const disk = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)
  const records = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.readAiRecords(ref), ref)
  const record = records.at(-1)!, first = record.applied[0]!
  expect(record.applied.length).toBeGreaterThan(0)
  expect(disk.diagnostics).toEqual([])
  writeFileSync(join(output, 'reopened.json'), JSON.stringify({ disk, records }, null, 2))
  const conversations = await page.evaluate(lesson => window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson }), lesson.identity)
  const scope = { version: 1 as const, kind: 'lesson' as const, lessonId: lesson.identity.lessonId, normalizedDirectory: lesson.identity.normalizedDirectory, conversationId: conversations.conversations![0]!.conversationId }
  const history = await page.evaluate(workspace => window.desktopAPI!.localAgent({ operation: 'lesson-list', workspace }), scope)
  const details = await page.evaluate(async ({ scope, ids }) => Promise.all(ids.map(sessionId => window.desktopAPI!.localAgent({ operation: 'lesson-read', workspace: scope, sessionId, after: 0 }))), { scope, ids: history.records!.map(item => item.id) })
  writeFileSync(join(output, 'native-history.json'), JSON.stringify(details, null, 2))
  if (await editor.getByRole('button', { name: '源文', exact: true }).isVisible()) await editor.getByRole('button', { name: '源文', exact: true }).click()
  const source = editor.locator('.cm-content')
  async function replaceThroughUI(text: string) {
   await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), text)
   await source.click(); await source.press('Control+a'); await source.press('Control+v')
   await editor.getByRole('button', { name: '保存', exact: true }).click()
   await expect.poll(() => page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref).then(value => value.source), ref)).toBe(text)
  }
  const teacherToken = '教师复核：'
  const teacherSource = disk.source.slice(0, first.from) + teacherToken + disk.source.slice(first.from)
  await replaceThroughUI(teacherSource)
  await marker.getByRole('button', { name: '撤回本次 AI 修改', exact: true }).last().click()
  await expect(editor.getByRole('status').filter({ hasText: /已撤回.*未撤回/ })).toBeVisible()
  const undone = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)
  expect(undone.source).toContain(teacherToken)
  const undoStatus = await editor.getByRole('status').filter({ hasText: /已撤回.*未撤回/ }).innerText()
  expect(undoStatus).toMatch(/未撤回 [1-9]/)
  writeFileSync(join(output, 'selective-undo.json'), JSON.stringify({ undoStatus, undone }, null, 2))
  await page.screenshot({ path: join(output, 'selective-undo.png') })
  // Restore the exact AI-produced valid source through the editor after the reversible acceptance exercise.
  await replaceThroughUI(disk.source)
  expect((await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)).diagnostics).toEqual([])
  expect(await page.evaluate(ref => window.desktopAPI!.lessonFiles!.readRecovery(ref), ref)).toBeNull()
  await testInfo.attach('reopen-undo-evidence', { body: output, contentType: 'text/plain' })
 } finally { await app.close() }
})
