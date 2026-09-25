import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  closeSelectionApp, heldRound, launchSelectionApp, markdownSource, openSelectionFile,
  readSelectionDocument, selectionServer, selectVisibleText, setupSelectionUI,
} from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const body = (page: Page) => page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })

async function conversationIds(page: Page, workspace: string): Promise<string[]> {
  return page.evaluate(async directory => {
    const execution = window.desktopAPI!.execution!
    const opened = await execution.workspace(directory)
    return (await execution.conversations(opened.workspace.workspaceId)).map(item => item.conversationId)
  }, workspace)
}

test('M10-T05 deleting a dirty document cancels safely, then stops AI and retains a recoverable untitled draft', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The desktop recycle bin and native confirmation are Windows acceptance paths.')
  test.setTimeout(180_000)
  const base = join(root, 'output/g20/m10/delete-active'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const original = join(workspace, 'selection.md'), untouched = join(workspace, 'other.md')
  const savedAgain = join(workspace, 'recovered-draft.md')
  writeFileSync(original, markdownSource)
  writeFileSync(untouched, '# Other user file\n')
  const server = await selectionServer(), errors: string[] = []
  let app: ElectronApplication | undefined
  try {
    app = await launchSelectionApp(directory)
    let page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await setupSelectionUI(app, page, server.endpoint, workspace)
    const document = await openSelectionFile(page, workspace, 'selection.md')
    const region = page.getByRole('region', { name: '教学文档 selection.md', exact: true })

    // The Markdown editor auto-saves after 800 ms. First prove its real UI edit,
    // then leave a newer canonical human operation unsaved while the AI runs.
    await region.getByRole('button', { name: '源文', exact: true }).click()
    const source = page.getByRole('textbox', { name: '正文源文编辑', exact: true })
    await source.click(); await source.press('Control+End'); await page.keyboard.type('人工已保存补充。')
    const savedSource = `${markdownSource}人工已保存补充。`
    await expect.poll(() => readFileSync(original, 'utf8')).toBe(savedSource)
    const humanDraft = `${savedSource}未保存改动。`
    await page.evaluate(async ({ id, source }) => {
      const documents = window.desktopAPI!.documents!, current = await documents.read(id)
      await documents.dispatch({ documentId: id, epoch: current.epoch, baseRevision: current.revision,
        actor: 'human', operationId: 'm10-unsaved-human-edit', mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
    }, { id: document.documentId, source: humanDraft })
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).dirty).toBe(true)
    await region.getByRole('button', { name: '正文', exact: true }).click()
    await selectVisibleText(page, body(page), '先预测😀')
    const round = server.arm('m10-delete-held', 'markdown-range', '不应落盘的迟到正文')
    const card = page.getByLabel('当前编辑目标', { exact: true })
    await card.getByLabel('AI 指令', { exact: true }).fill('只改写选中的正文')
    await card.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await heldRound(round)
    expect(round.references?.[0].documentId).toBe(document.documentId)
    await expect(body(page).locator('[data-edit-preview]')).toContainText('不应落盘的迟到正文')
    const before = await readSelectionDocument(page, document.documentId)
    expect(before).toMatchObject({ dirty: true, binding: { kind: 'file', path: original }, model: { source: humanDraft } })
    const sessions = await conversationIds(page, workspace)
    expect(sessions.length).toBeGreaterThan(0)

    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async (...args: unknown[]) => {
      const options = args.at(-1) as { detail?: string }
      if (!options.detail?.includes('停止这些文档的写入任务') || !options.detail?.includes('未保存内容和撤销记录都会保留')) throw new Error('Missing active-writer and unsaved-draft disclosure')
      return { response: 1, checkboxChecked: false }
    } })
    await tree.getByRole('button', { name: 'selection.md', exact: true }).click()
    await tree.getByRole('button', { name: 'selection.md', exact: true }).press('Delete')
    await expect(page.getByRole('status').filter({ hasText: '操作已取消，原文件保留' })).toBeVisible()
    expect(readFileSync(original, 'utf8')).toBe(savedSource)
    expect(await readSelectionDocument(page, document.documentId)).toMatchObject({
      binding: { kind: 'file', path: original }, model: { source: humanDraft }, revision: before.revision,
    })
    await expect(body(page).locator('[data-edit-preview]')).toContainText('不应落盘的迟到正文')

    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await tree.getByRole('button', { name: 'selection.md', exact: true }).click()
    await tree.getByRole('button', { name: 'selection.md', exact: true }).press('Delete')
    await expect.poll(() => existsSync(original)).toBe(false)
    await expect(tree.getByRole('button', { name: 'selection.md', exact: true })).toHaveCount(0)
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).binding.kind).toBe('untitled')
    round.release() // The fixture attempts to finish the model's previously held tool arguments.
    await expect(body(page).locator('[data-edit-preview]')).toHaveCount(0)
    const retained = await readSelectionDocument(page, document.documentId)
    expect(retained).toMatchObject({ dirty: true, binding: { kind: 'untitled', suggestedName: 'selection.md' }, model: { source: humanDraft }, undoDepth: before.undoDepth })
    expect(existsSync(original)).toBe(false)
    expect(readFileSync(untouched, 'utf8')).toBe('# Other user file\n')
    expect(await conversationIds(page, workspace)).toEqual(sessions)
    const screenshot = join(directory, 'deleted-untitled-draft.png')
    await page.screenshot({ path: screenshot })
    await info.attach('deleted document retained as untitled draft', { path: screenshot, contentType: 'image/png' })

    // Restart against the same isolated profile to prove the unsaved draft is recoverable.
    await closeSelectionApp(app); app = undefined
    app = await launchSelectionApp(directory)
    page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    const recovery = page.getByRole('complementary', { name: '未保存文档的恢复稿' })
    await expect(recovery).toContainText('selection.md')
    const recoverable = await page.evaluate(() => window.desktopAPI!.documents!.recoverable())
    expect(recoverable.find(item => item.documentId === document.documentId)).toMatchObject({
      dirty: true, binding: { kind: 'untitled', suggestedName: 'selection.md' }, model: { source: humanDraft }, undoDepth: before.undoDepth,
    })
    await recovery.getByRole('button', { name: '恢复并打开', exact: true }).click()
    await expect.poll(() => page.evaluate(async id => (await window.desktopAPI!.documents!.list()).some(item => item.documentId === id), document.documentId)).toBe(true)
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /selection\.md/ })).toBeVisible()
    await expect(recovery).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ hasText: '恢复失败' })).toHaveCount(0)
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: humanDraft })
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, savedAgain)
    await page.getByRole('region', { name: '教学文档 selection.md', exact: true }).getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => existsSync(savedAgain)).toBe(true)
    expect(readFileSync(savedAgain, 'utf8')).toBe(humanDraft)
    expect(existsSync(original)).toBe(false)
    expect(readFileSync(untouched, 'utf8')).toBe('# Other user file\n')
    expect(await conversationIds(page, workspace)).toEqual(sessions)
    expect(errors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ original, savedAgain, documentId: document.documentId,
      cancelled: true, confirmed: true, heldToolArgumentsReleasedAfterTrash: true, beforeRevision: before.revision,
      retainedRevision: retained.revision, recovered: true, sessionsRetained: sessions.length, errors, provider: 'local fixture' }, null, 2))
  } finally {
    roundCleanup(server)
    if (app) await closeSelectionApp(app)
    await server.close()
  }
})

function roundCleanup(server: Awaited<ReturnType<typeof selectionServer>>) {
  for (const round of server.rounds) round.release()
}
