import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

test('r19 real conversation navigation branch and scoped record deletion preserve lesson files and recovery', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const root = resolve(__dirname, '../..')
  const evidence = join(root, 'output', 'r19-conversation-navigation', new Date().toISOString().replace(/[:.]/g, '-'))
  const workspace = join(evidence, 'workspace'); mkdirSync(workspace, { recursive: true })
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(evidence, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await page.getByRole('button', { name: '新建课例', exact: true }).click()
    await page.getByRole('textbox', { name: '课例名称' }).fill('导航删除验证课例')
    await page.getByRole('button', { name: '创建课例', exact: true }).click()
    const nav = page.getByRole('region', { name: '课例对话导航' })
    await expect(nav.getByRole('button', { name: '新对话', exact: true }).first()).toBeVisible()
    const lesson = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!, workspace)
    const records = () => page.evaluate(async identity => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson: identity })).conversations!, lesson.identity)
    const original = (await records())[0]!
    await page.getByRole('tab', { name: '课件', exact: true }).click()
    const projectPath = join(lesson.identity.normalizedDirectory, 'course.h5lesson')
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, projectPath)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await records())[0]?.projectTarget?.normalizedPath).toBe(projectPath.replace(/\\/g, '/').toLowerCase())
    const bound = (await records())[0]!
    await nav.getByRole('button', { name: `从${original.title}创建讨论分支`, exact: true }).click()
    await expect.poll(async () => (await records()).length).toBe(2)
    const branch = (await records()).find(record => record.parentConversationId === original.conversationId)!
    expect(branch).toBeDefined(); expect(branch.conversationId).not.toBe(original.conversationId)
    expect(branch.projectTarget).toEqual(bound.projectTarget); expect(branch.sessionIds).toEqual([])
    await nav.getByRole('textbox', { name: '搜索对话' }).fill('讨论分支')
    await expect(nav.getByRole('button', { name: branch.title, exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: original.title, exact: true })).toHaveCount(1) // Only the new-conversation action remains, not the filtered row.
    await page.screenshot({ path: join(evidence, 'branch-search.png') })
    await nav.getByRole('textbox', { name: '搜索对话' }).fill('')
    const ref = { lessonId: lesson.identity.lessonId, lessonDirectory: lesson.identity.normalizedDirectory, relativePath: 'notes.md' }
    const source = '# 真实课例文件\n\n删除聊天仍保留。\n'
    const flowTarget = { projectId: 'recovery-project', projectPath: null, surfaceId: 'flow-recovery', epoch: 'navigation-proof' }
    const prepared = await page.evaluate(async ({ ref, source, flowTarget }) => {
      const file = await window.desktopAPI!.lessonFiles!.saveDocument({ ref, expectedVersion: null, source, operationId: 'navigation-create-document', attachments: [] })
      if (file.status !== 'saved') throw new Error('Failed to prepare actual document')
      await window.desktopAPI!.lessonFiles!.preserveDraft!(ref, '# 尚未保存的 Markdown 恢复稿\n', file.version)
      await window.desktopAPI!.flowDocumentRecovery!.read(flowTarget)
      await window.desktopAPI!.flowDocumentRecovery!.write({ ...flowTarget, revision: 0, source: '# 尚未保存的 Flow 恢复稿', diagnostics: [], composing: false })
      return file
    }, { ref, source, flowTarget })
    expect(prepared.status).toBe('saved')
    const attachment = join(lesson.identity.normalizedDirectory, 'teacher-attachment.txt'); writeFileSync(attachment, '真实附件')
    await nav.getByRole('button', { name: `删除${branch.title}的应用记录`, exact: true }).click()
    await page.getByRole('button', { name: '确认删除记录', exact: true }).click()
    await expect.poll(async () => (await records()).length).toBe(1)
    expect((await records())[0]!.conversationId).toBe(original.conversationId)
    await nav.getByRole('button', { name: '删除本课例对话记录', exact: true }).click()
    await page.getByRole('button', { name: '确认删除记录', exact: true }).click()
    await expect.poll(async () => (await records()).length).toBe(0)
    await nav.getByRole('button', { name: '新对话', exact: true }).click()
    await expect.poll(async () => (await records()).length).toBe(1)
    const fresh = (await records())[0]!
    expect(fresh.conversationId).not.toBe(original.conversationId)
    expect(fresh.sessionIds).toEqual([])
    expect(fresh.projectTarget).toEqual(bound.projectTarget)
    await nav.getByRole('button', { name: '删除全部应用对话记录', exact: true }).click()
    await page.getByRole('button', { name: '确认删除记录', exact: true }).click()
    await expect.poll(async () => (await records()).length).toBe(0)
    const retained = await page.evaluate(async ({ ref, flowTarget }) => ({ file: await window.desktopAPI!.lessonFiles!.openDocument(ref), markdown: await window.desktopAPI!.lessonFiles!.readRecovery!(ref), flow: await window.desktopAPI!.flowDocumentRecovery!.read(flowTarget) }), { ref, flowTarget })
    expect(retained.file.source).toBe(source)
    expect(retained.markdown?.source).toContain('尚未保存的 Markdown')
    expect(retained.flow?.source).toContain('尚未保存的 Flow')
    expect(readFileSync(attachment, 'utf8')).toBe('真实附件')
    expect(readFileSync(projectPath).subarray(0, 2).toString()).toBe('PK')
    await nav.getByRole('button', { name: '新对话', exact: true }).click()
    await expect.poll(async () => (await records()).length).toBe(1)
    expect((await records())[0]!.projectTarget).toEqual(bound.projectTarget)
    await page.screenshot({ path: join(evidence, 'after-delete-new-conversation.png') })
    writeFileSync(join(evidence, 'verification.json'), JSON.stringify({ lesson, bound, branch, fresh, retained, finalConversations: await records(), checks: ['title-search', 'independent-branch-target-reference', 'single-delete', 'lesson-delete', 'all-record-delete', 'real-file-and-project-retained', 'markdown-and-flow-recovery-retained', 'new-conversation-after-delete'] }, null, 2))
    await testInfo.attach('evidence-directory', { body: evidence, contentType: 'text/plain' })
  } catch (error) {
    const page = app?.windows()[0]
    if (page) { await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}); writeFileSync(join(evidence, 'failure-ui.txt'), await page.locator('body').innerText().catch(() => '')) }
    throw error
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {}); await app.close().catch(() => {}) }
  }
})
