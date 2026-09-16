import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

test('r19 real manual recovery then native Luna file format repair', async ({}, testInfo) => {
 test.skip(process.env.R19_RECOVERY_LUNA_RUN !== '1', 'Run only against the retained manual profile after the coordinated build')
 test.setTimeout(15 * 60_000)
 const root = resolve(__dirname, '../..')
 const evidence = resolve(process.env.R19_RECOVERY_LUNA_ROOT ?? join(root, 'output/r19-manual-luna/manual-parallel-20260915-170551'))
 const output = join(evidence, 'file-ai-recovery', new Date().toISOString().replace(/[:.]/g, '-')); mkdirSync(output, { recursive: true })
 const workspace = join(evidence, 'workspace')
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
   copyFileSync(filename, join(output, 'untouched-blank-course-recovery.h5lesson'))
   await emptyRecovery.click()
  }

  const lesson = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!, workspace)
  await page.locator('.lesson-workspace-lessons').getByRole('button', { name: /并联支路证据推理手动课例/ }).click()
  const ref = { lessonId: lesson.identity.lessonId, lessonDirectory: lesson.identity.normalizedDirectory, relativePath: 'teaching-brief.md' }
  const before = await page.evaluate(async ref => ({ disk: await window.desktopAPI!.lessonFiles!.openDocument(ref), recovery: await window.desktopAPI!.lessonFiles!.readRecovery(ref) }), ref)
  writeFileSync(join(output, 'before.json'), JSON.stringify(before, null, 2))
  await page.locator('.lesson-workspace-files').getByRole('button', { name: /并联支路证据推理手动课例$/ }).click()
  await page.locator('.lesson-workspace-files').getByRole('button', { name: 'teaching-brief.md', exact: true }).click()
  const editor = page.getByRole('region', { name: '教学文档 teaching-brief.md', exact: true })
  await expect(editor.locator('.cm-content')).toBeVisible()
  await editor.locator('.cm-content').click()
  await editor.locator('.cm-content').press('Control+a')
  await editor.locator('.cm-content').press('Control+c')
  const viewedSource = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(viewedSource.trim()).toBe(before.disk.source.trim())
  await page.screenshot({ path: join(output, 'recovery-reviewed.png') })
  if (before.recovery) {
   expect(before.recovery.baseSource, 'Retained recovery was an untouched old baseline; current disk is the newer candidate').toBe(before.recovery.source)
   await editor.getByRole('button', { name: '保留恢复稿并保存', exact: true }).click()
   await expect.poll(() => page.evaluate(ref => window.desktopAPI!.lessonFiles!.readRecovery(ref), ref)).toBeNull()
  }
  const capabilities = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'opencode', refresh: true }))
  const luna = capabilities.capabilities?.models.find(model => model.id === 'openai/gpt-5.6-luna-fast')
  expect(luna, 'Use only actual native Luna Fast directory entry').toBeTruthy()
  let configured = await page.evaluate(model => window.desktopAPI!.localAgent({ operation: 'configure', adapter: 'opencode', configuration: { model, effort: null } }), luna!.id)
  const selected = configured.capabilities?.models.find(model => model.id === luna!.id)
  if (selected?.effort.kind === 'supported' && selected.effort.values.includes('medium')) configured = await page.evaluate(model => window.desktopAPI!.localAgent({ operation: 'configure', adapter: 'opencode', configuration: { model, effort: 'medium' } }), luna!.id)
  writeFileSync(join(output, 'native-configuration.json'), JSON.stringify({ capabilities, configured }, null, 2))
  const chat = page.getByRole('complementary', { name: '课例创作助手' })
  await chat.getByLabel('CLI', { exact: true }).selectOption('opencode')
  await chat.getByRole('button', { name: '编辑当前文档', exact: true }).click()
  await chat.getByRole('textbox', { name: '给创作助手的消息', exact: true }).fill('上次空edits没有完成任务。请先实际读取本轮baseline.md和request.json，再用原生脚本计算修改范围。只修当前teaching-brief.md的Markdown格式：正式解析器已在第10行报告嵌套列表不支持；请把所有嵌套列表改为平铺单层列表或短小标题加普通段落，保留每个原有教学事实、问题和图像引用，不删减内容。不要引入HTML、制表符缩进或新的嵌套结构。用多个最小必要范围编辑，完成后由宿主保存；不再生成第二份教学简报，不改其他文件。完成真实格式修复并生成非空edits。')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(async () => {
   const status = await chat.locator(':scope > p[role="status"]').allTextContents()
   if (status.some(text => /too_small|未提供有效|校验失败|已中断/.test(text))) throw new Error(status.join('\n'))
   const disk = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)
   const records = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.readAiRecords(ref), ref)
   writeFileSync(join(output, 'current.json'), JSON.stringify({ disk, records }, null, 2))
   return disk.source !== before.disk.source && disk.diagnostics.length === 0 && records.length > 0
  }, { timeout: 10 * 60_000, intervals: [2000] }).toBe(true)
  await expect(editor.getByRole('complementary', { name: 'AI 改动记录' })).toBeVisible()
  await expect.poll(() => page.evaluate(ref => window.desktopAPI!.lessonFiles!.readRecovery(ref), ref)).toBeNull()
  await page.screenshot({ path: join(output, 'native-file-repaired.png') })
  await testInfo.attach('file-ai-evidence', { body: output, contentType: 'text/plain' })
 } finally { await app.close() }
})


