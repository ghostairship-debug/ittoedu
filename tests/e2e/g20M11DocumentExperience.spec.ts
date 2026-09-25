import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeSelectionApp, finishRound, heldRound, launchSelectionApp, markdownSource, openSelectionFile, readSelectionDocument,
  selectionFixtures, selectionServer, selectVisibleText, setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
async function sendSelectedInstruction(page: Page, instruction: string) {
  const card = page.getByLabel('当前编辑目标', { exact: true })
  await card.getByLabel('AI 指令', { exact: true }).fill(instruction)
  await card.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
}

test('M11-T02 Markdown recent AI undo respects later human edits and keyboard History', async ({}, info) => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'selection.md')
    const region = page.getByRole('region', { name: '教学文档 selection.md', exact: true })
    const body = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await selectVisibleText(page, body, '先预测😀')
    const first = server.arm('m11-ai-a', 'markdown-range', '先讨论😀')
    await sendSelectedInstruction(page, '将选中文字改为先讨论')
    await heldRound(first); await finishRound(page, first)
    const afterA = markdownSource.replace('先预测😀', '先讨论😀')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: afterA })

    await selectVisibleText(page, body, '保持原样')
    await page.keyboard.insertText('人工 B')
    const afterB = afterA.replace('保持原样', '人工 B')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: afterB })
    await selectVisibleText(page, body, '再观察')
    const second = server.arm('m11-ai-c', 'markdown-range', '再解释')
    await sendSelectedInstruction(page, '将选中文字改为再解释')
    await heldRound(second); await finishRound(page, second)
    const afterC = afterB.replace('再观察', '再解释')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: afterC })
    const recent = region.getByRole('button', { name: '撤销最近 AI 修改', exact: true })
    await expect(recent).toBeVisible()
    await recent.click()
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: afterB })
    await body.press('Control+Shift+z')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: afterC })
    await selectVisibleText(page, body, '人工 B')
    await page.keyboard.insertText('人工 D')
    const afterD = afterC.replace('人工 B', '人工 D')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: afterD })
    await expect(recent).toHaveCount(0)
    await body.press('Control+z')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: afterC })
    await expect(recent).toBeVisible()
    await recent.click()
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: afterB })
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(join(fixture.workspace, 'selection.md'), 'utf8')).toBe(afterB)
    expect(errors).toEqual([])
    const evidence = join(fixture.directory, 'm11-t02-markdown.json')
    writeFileSync(evidence, JSON.stringify({ afterA, afterB, afterC, afterD, final: readFileSync(join(fixture.workspace, 'selection.md'), 'utf8'),
      requests: server.requests.length, errors }, null, 2))
    await info.attach('M11-T02 Markdown History evidence', { path: evidence, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M11-T02 Flow course recent AI undo follows the same top-of-History rule', async ({}, info) => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'flow.h5lesson')
    const body = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    const texts = async () => {
      const snapshot = await readSelectionDocument(page, document.documentId)
      if (snapshot.model.kind !== 'course-v9') throw new Error('Flow course was not retained')
      const flow = snapshot.model.project.surfaces.find(surface => surface.type === 'flow')
      if (!flow || flow.type !== 'flow') throw new Error('Flow surface was not retained')
      return flow.blocks.filter(block => block.type === 'paragraph').map(block => block.content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join(''))
    }
    const baseline = await texts()
    await selectVisibleText(page, body, '先预测😀')
    const first = server.arm('m11-flow-ai-a', 'flow-range', '先讨论😀')
    await sendSelectedInstruction(page, '将选中文字改为先讨论')
    await heldRound(first); await finishRound(page, first)
    await expect.poll(texts).toEqual(baseline.map(value => value.replace('先预测😀', '先讨论😀')))

    await selectVisibleText(page, body, '保持原样')
    await page.keyboard.insertText('人工 B')
    const afterB = baseline.map(value => value.replace('先预测😀', '先讨论😀').replace('保持原样', '人工 B'))
    await expect.poll(texts).toEqual(afterB)
    await selectVisibleText(page, body, '再观察')
    const second = server.arm('m11-flow-ai-c', 'flow-range', '再解释')
    await sendSelectedInstruction(page, '将选中文字改为再解释')
    await heldRound(second); await finishRound(page, second)
    const afterC = afterB.map(value => value.replace('再观察', '再解释'))
    await expect.poll(texts).toEqual(afterC)
    const recent = page.getByRole('button', { name: '撤销最近 AI 修改', exact: true })
    await expect(recent).toBeVisible()
    await recent.click()
    await expect.poll(texts).toEqual(afterB)
    await body.press('Control+Shift+z')
    await expect.poll(texts).toEqual(afterC)
    await selectVisibleText(page, body, '人工 B')
    await page.keyboard.insertText('人工 D')
    const afterD = afterC.map(value => value.replace('人工 B', '人工 D'))
    await expect.poll(texts).toEqual(afterD)
    await expect(recent).toHaveCount(0)
    await body.press('Control+z')
    await expect.poll(texts).toEqual(afterC)
    await expect(recent).toBeVisible()
    await recent.click()
    await expect.poll(texts).toEqual(afterB)
    expect(errors).toEqual([])
    const evidence = join(fixture.directory, 'm11-t02-flow.json')
    writeFileSync(evidence, JSON.stringify({ baseline, afterB, afterC, afterD, final: await texts(), requests: server.requests.length, errors }, null, 2))
    await info.attach('M11-T02 Flow History evidence', { path: evidence, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M11-T01 distinguishes failed save, restored draft and an unfinished AI body during Save and Save As', async ({}, info) => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  let app = await launchSelectionApp(fixture.directory)
  let page = await app.firstWindow()
  const originalPath = join(fixture.workspace, 'selection.md')
  const savedCopy = join(fixture.workspace, '恢复稿另存.md')
  const confirmed = `${markdownSource}人工已确认。`
  const errors: string[] = []
  try {
    page.on('pageerror', error => errors.push(error.message))
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'selection.md')
    await page.evaluate(async ({ documentId, source, badPath }) => {
      const api = window.desktopAPI!.documents!, before = await api.read(documentId)
      const result = await api.dispatch({ documentId, epoch: before.epoch, baseRevision: before.revision,
        actor: 'human', operationId: crypto.randomUUID(), mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
      if (result.status !== 'applied') throw new Error(`Preparation failed: ${result.status}`)
      await api.save(documentId, badPath).catch(() => undefined)
    }, { documentId: document.documentId, source: confirmed, badPath: join(fixture.directory, 'missing-parent', 'fail.md') })
    await expect(page.getByRole('region', { name: '教学文档 selection.md', exact: true }).locator(':scope > header > span[role="status"]')).toContainText('保存失败')
    const failed = await readSelectionDocument(page, document.documentId)
    expect(failed).toMatchObject({ dirty: true, saveError: expect.any(String), model: { source: confirmed } })
    expect(readFileSync(originalPath, 'utf8')).toBe(markdownSource)
    await closeSelectionApp(app)

    app = await launchSelectionApp(fixture.directory)
    page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    const recovery = page.getByLabel('未保存文档的恢复稿')
    await expect(recovery).toBeVisible()
    await recovery.getByRole('button', { name: '恢复并打开', exact: true }).click()
    const header = page.getByRole('region', { name: '教学文档 selection.md', exact: true }).locator(':scope > header > span[role="status"]')
    await expect(header).toContainText('恢复稿 · 原文件未保存')
    const restored = await readSelectionDocument(page, document.documentId)
    expect(restored).toMatchObject({ dirty: true, recovered: true, model: { source: confirmed } })
    expect(readFileSync(originalPath, 'utf8')).toBe(markdownSource)

    const body = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await selectVisibleText(page, body, '先预测😀')
    const round = server.arm('m11-t01-generating', 'markdown-range', '临时生成片段')
    const card = page.getByLabel('当前编辑目标', { exact: true })
    await card.getByLabel('AI 指令', { exact: true }).fill('只替换选中内容并等待结束')
    await card.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await heldRound(round)
    await expect(body.locator('[data-edit-preview]')).toContainText('临时生成片段')
    await expect(page.getByRole('status').getByText('正文正在生成，生成部分尚未保存。')).toBeVisible()
    expect((await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: confirmed })
    await body.press('Control+s')
    await expect(header).toHaveText('已保存')
    await expect(body.locator('[data-edit-preview]')).toContainText('临时生成片段')
    expect(readFileSync(originalPath, 'utf8')).toBe(confirmed)
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    round.release()
    await expect(body.locator('[data-edit-preview]')).toHaveCount(0)

    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, savedCopy)
    await page.getByRole('region', { name: '教学文档 selection.md', exact: true }).getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(() => existsSync(savedCopy) ? readFileSync(savedCopy, 'utf8') : '').toBe(confirmed)
    const saved = await readSelectionDocument(page, document.documentId)
    expect(saved).toMatchObject({ dirty: false, recovered: false, binding: { kind: 'file', path: savedCopy } })
    expect(errors).toEqual([])
    const evidence = join(fixture.directory, 'm11-t01-evidence.json')
    writeFileSync(evidence, JSON.stringify({ failed: { dirty: failed.dirty, saveError: failed.saveError },
      restored: { dirty: restored.dirty, recovered: restored.recovered }, saved: { dirty: saved.dirty, recovered: saved.recovered },
      diskSource: readFileSync(savedCopy, 'utf8'), preview: round.held, errors }, null, 2))
    await info.attach('M11-T01 state evidence', { path: evidence, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})

// Real window/IPC/file persistence; no model fixture is claimed as model acceptance.
test('M11 real header failure/retry and per-location external Markdown conflict', async ({}, info) => {
  test.setTimeout(90_000)
  const base = join(root, 'output/g20/m11'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), filename = join(directory, '状态与冲突.md')
  writeFileSync(filename, 'A\nB\nC')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, directory)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '状态与冲突.md', exact: true }).dblclick()
    const header = page.locator('.workspace-document-status')
    await expect(header).toHaveText('已保存')
    const id = await page.evaluate(async filename => (await window.desktopAPI!.documents!.open(filename)).documentId, filename)
    const edit = (source: string) => page.evaluate(async ({ id, source }) => {
      const api = window.desktopAPI!.documents!, current = await api.read(id)
      await api.dispatch({ documentId: id, epoch: current.epoch, baseRevision: current.revision, actor: 'human', operationId: crypto.randomUUID(), mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
    }, { id, source })
    await edit('Ax\nB\nC')
    await page.evaluate(async ({ id, badPath }) => { await window.desktopAPI!.documents!.save(id, badPath).catch(() => {}) }, { id, badPath: join(directory, 'missing-parent', 'fail.md') })
    await expect(header).toContainText('保存失败')
    await expect(header).toContainText('当前稿仍保留')
    writeFileSync(filename, 'A\nB\nCy')
    // The actual editor observer merges separate locations and autosaves the merged formal revision.
    await expect.poll(() => readFileSync(filename, 'utf8')).toBe('Ax\nB\nCy')
    await expect(header).toHaveText('已保存')
    await edit('Ax local\nB teacher\nCy')
    writeFileSync(filename, 'Ax disk\nB\nCy external')
    const conflict = page.locator('.document-conflict-hunk')
    await expect(conflict).toHaveCount(1)
    await expect(conflict).toContainText('其余不冲突的修改已保留')
    await conflict.getByRole('button', { name: '此处采用磁盘稿', exact: true }).click()
    await expect.poll(() => readFileSync(filename, 'utf8')).toBe('Ax disk\nB teacher\nCy external')
    await expect(header).toHaveText('已保存')
    const screenshot = join(directory, 'saved-merged.png')
    await page.screenshot({ path: screenshot }); await info.attach('saved-merged', { path: screenshot, contentType: 'image/png' })
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})

test('M11 Windows readonly second save keeps every tab and focuses the failing document on window close', async () => {
  test.skip(process.platform !== 'win32', 'This case requires Windows FILE_ATTRIBUTE_READONLY and the real atomic replacement path.')
  test.setTimeout(90_000)
  const base = join(root, 'output/g20/m11'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'exit-'))
  const readonlyPath = join(directory, '失败稿.md')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(), tabs = page.locator('.workspace-document-tabs')
    for (const name of ['第一稿', '失败稿', '第三稿']) {
      await page.getByLabel('新建标签页').click()
      await page.getByLabel('Markdown 文档名').fill(name)
      await page.getByRole('button', { name: '创建文档', exact: true }).click()
      await expect(tabs.getByRole('tab', { name: new RegExp(`^${name}\\.md`) })).toHaveAttribute('aria-selected', 'true')
    }
    await page.evaluate(async readonlyPath => {
      const api = window.desktopAPI!.documents!
      const second = (await api.list()).find(document => document.binding.kind === 'untitled' && document.binding.suggestedName === '失败稿.md')!
      await api.dispatch({ documentId: second.documentId, epoch: second.epoch, baseRevision: second.revision, actor: 'human', operationId: crypto.randomUUID(), mutation: { type: 'command', command: { type: 'markdown.replace', source: '只读磁盘原稿' } } })
      await api.save(second.documentId, readonlyPath)
    }, readonlyPath)
    chmodSync(readonlyPath, 0o444)
    await page.evaluate(async () => {
      const api = window.desktopAPI!.documents!
      for (const current of (await api.list()).filter(document => document.model.kind === 'markdown')) await api.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, actor: 'human', operationId: crypto.randomUUID(), mutation: { type: 'command', command: { type: 'markdown.replace', source: `保留 ${current.binding.kind === 'untitled' ? current.binding.suggestedName : current.binding.path.split(/[\\/]/).pop()}` } } })
    })
    await app.evaluate(({ dialog, BrowserWindow }, directory) => {
      dialog.showMessageBoxSync = () => 0
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${directory}/first.md` })
      BrowserWindow.getAllWindows()[0]!.close()
    }, directory)
    await expect(tabs.getByRole('tab', { name: /^失败稿\.md/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.workspace-document-status')).toContainText('保存失败')
    await expect(tabs.getByRole('tab')).toHaveCount(3)
    const remaining = await page.evaluate(async () => (await window.desktopAPI!.documents!.list()).filter(document => document.model.kind === 'markdown'))
    expect(remaining).toHaveLength(3)
    expect(remaining.filter(document => document.dirty)).toHaveLength(2)
    expect(remaining.every(document => document.model.kind === 'markdown' && document.model.source.startsWith('保留 '))).toBe(true)
    expect(readFileSync(join(directory, 'first.md'), 'utf8')).toBe('保留 第一稿.md')
    expect(readFileSync(readonlyPath, 'utf8')).toBe('只读磁盘原稿')
    expect(remaining.find(document => document.binding.kind === 'file' && document.binding.path === readonlyPath)?.saveError).toContain('EPERM')
    await page.screenshot({ path: join(directory, 'exit-save-failed.png') })
  } finally {
    if (existsSync(readonlyPath)) chmodSync(readonlyPath, 0o666)
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
