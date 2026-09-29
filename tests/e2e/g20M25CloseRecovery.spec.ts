import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionSubmissionStore } from '../../src/main/workbench/execution/ExecutionSubmissionStore'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import type { ExecutionStart } from '../../src/shared/workbench/execution'

const root = resolve(__dirname, '../..')
const base = join(root, 'output/g20/b19/m25-close-recovery-e2e')

function fixture(name: string) {
  const parent = join(base, name)
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(join(parent, 'run-'))
  const workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  mkdirSync(workspace)
  return { directory, workspace, profile }
}

async function launch(profile: string) {
  return electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
}

async function closeApp(app?: ElectronApplication) {
  if (!app) return
  await app.evaluate(({ app, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach(window => { if (!window.isDestroyed()) window.destroy() })
    app.exit(0)
  }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

async function chooseWorkspace(app: ElectronApplication, workspace: string) {
  const page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
  }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  return page
}

test('M25-T01 destroyed main window releases its preview and reopens safely', async () => {
  test.skip(process.platform !== 'win32', 'The main-window lifecycle uses Windows Electron.')
  test.setTimeout(150_000)
  const f = fixture('window-reopen')
  writeFileSync(join(f.workspace, 'window.html'), '<!doctype html><h1>窗口重开页</h1>')
  const facts: Record<string, unknown> = { workspace: f.workspace }
  let app: ElectronApplication | undefined
  try {
    app = await launch(f.profile)
    const processLog: string[] = []
    app.process().stderr?.on('data', chunk => processLog.push(String(chunk)))
    const page = await chooseWorkspace(app, f.workspace)
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: 'window.html', exact: true }).dblclick()
    const frame = page.locator('iframe[title="HTML 预览"]')
    await expect(frame.contentFrame().getByRole('heading', { name: '窗口重开页' })).toBeVisible()
    const oldUrl = await frame.getAttribute('src')
    expect(oldUrl).toMatch(/^courseware-preview:\/\//)
    const oldId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL().startsWith('courseware-editor://'))?.id)
    expect(oldId).toBeTruthy()
    const keeperId = await app.evaluate(({ BrowserWindow }) => new BrowserWindow({ show: false }).id)
    const nextWindow = app.waitForEvent('window')
    await app.evaluate(({ app, BrowserWindow }, id) => {
      BrowserWindow.fromId(id!)!.destroy()
      app.emit('activate')
    }, oldId)
    const reopened = await nextWindow
    await expect(reopened.getByRole('button', { name: '新建会话', exact: true })).toBeEnabled()
    const state = await app.evaluate(async ({ BrowserWindow, net }, input) => {
      const response = await net.fetch(input.url)
      return { oldDestroyed: BrowserWindow.fromId(input.oldId) === null,
        keeperAlive: BrowserWindow.fromId(input.keeperId) !== null,
        windows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, url: window.webContents.getURL() })),
        revokedStatus: response.status }
    }, { url: oldUrl!, oldId: oldId!, keeperId })
    expect(state).toMatchObject({ oldDestroyed: true, keeperAlive: true, revokedStatus: 404 })
    expect(state.windows.filter(window => window.url.startsWith('courseware-editor://'))).toHaveLength(1)
    expect(processLog.join('')).not.toContain('Object has been destroyed')
    facts.state = state
    facts.processError = processLog.filter(line => line.includes('Object has been destroyed'))
  } finally {
    writeFileSync(join(f.directory, 'evidence.json'), JSON.stringify(facts, null, 2))
    await closeApp(app)
  }
})

test('M25-T02 failed HTML draft can cancel then confirm discard without overwriting the disk', async () => {
  test.skip(process.platform !== 'win32', 'The document-close dialog uses Windows Electron.')
  test.setTimeout(150_000)
  const f = fixture('failed-draft')
  const filename = join(f.workspace, 'failed.html')
  const original = '<!doctype html><p>磁盘原文</p>'
  writeFileSync(filename, original)
  const facts: Record<string, unknown> = { filename }
  let app: ElectronApplication | undefined
  try {
    app = await launch(f.profile)
    const page = await chooseWorkspace(app, f.workspace)
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: 'failed.html', exact: true }).dblclick()
    const region = page.getByRole('region', { name: '教学文档 failed.html' })
    await region.getByRole('toolbar', { name: 'HTML 视图', exact: true }).getByRole('button', { name: '源码', exact: true }).click()
    const source = region.getByLabel('纯文本编辑', { exact: true })
    await source.fill('<!doctype html><p>当前未保存稿</p>')
    const documentId = await page.evaluate(async path => (await window.desktopAPI.documents!.list())
      .find(snapshot => snapshot.binding.kind === 'file' && snapshot.binding.path.toLowerCase() === path.toLowerCase())?.documentId, filename)
    if (!documentId) throw new Error('HTML document did not bind a DocumentSession')
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), documentId)).dirty).toBe(true)
    chmodSync(filename, 0o444)
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect(region.getByRole('alert').filter({ hasText: '放弃未保存更改并关闭' })).toBeVisible()
    const dialogs: Array<{ title: string; buttons: string[]; response: number }> = []
    await app.evaluate(({ dialog }) => {
      const main = globalThis as typeof globalThis & { m25CloseResponses?: number[]; m25CloseDialogs?: Array<{ title: string; buttons: string[]; response: number }> }
      main.m25CloseResponses = [1, 0]
      main.m25CloseDialogs = []
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.at(-1) as { title: string; buttons: string[] }
        const response = options.title === '放弃未保存更改' ? main.m25CloseResponses!.shift()! : 2
        main.m25CloseDialogs!.push({ title: options.title, buttons: options.buttons, response })
        return { response, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    })
    const discard = region.getByRole('button', { name: '放弃未保存更改并关闭', exact: true })
    await discard.click()
    await expect.poll(() => app!.evaluate(() => (globalThis as any).m25CloseDialogs.length)).toBe(1)
    await expect(discard).toBeVisible()
    expect(readFileSync(filename, 'utf8')).toBe(original)
    await page.waitForTimeout(100) // The first dialog promise must leave the Main per-document close queue.
    await discard.click()
    await expect.poll(() => app!.evaluate(() => (globalThis as any).m25CloseDialogs.length)).toBe(2)
    facts.dialogs = await app.evaluate(() => (globalThis as any).m25CloseDialogs)
    facts.alerts = await region.getByRole('alert').allTextContents()
    facts.documentStillOpen = await page.evaluate(id => window.desktopAPI.documents!.list().then(items => items.some(item => item.documentId === id)), documentId)
    facts.tabCount = await page.getByRole('tab', { name: /^failed\.html/ }).count()
    await expect(page.getByRole('tab', { name: /^failed\.html/ })).toHaveCount(0)
    expect(readFileSync(filename, 'utf8')).toBe(original)
    dialogs.push(...await app.evaluate(() => (globalThis as any).m25CloseDialogs))
    expect(dialogs).toEqual([
      { title: '放弃未保存更改', buttons: ['放弃未保存更改并关闭', '取消'], response: 1 },
      { title: '放弃未保存更改', buttons: ['放弃未保存更改并关闭', '取消'], response: 0 },
    ])
    facts.dialogs = dialogs
    facts.diskAfter = readFileSync(filename, 'utf8')
  } finally {
    writeFileSync(join(f.directory, 'evidence.json'), JSON.stringify(facts, null, 2))
    await closeApp(app)
  }
})

test('M25-T02 terminal orphan in an isolated profile keeps its receipt and does not restore a deleted conversation', async () => {
  test.skip(process.platform !== 'win32', 'Recovery is checked in the Windows Electron owner.')
  test.setTimeout(150_000)
  const f = fixture('orphan-terminal')
  const directory = join(f.profile, 'workbench-v2')
  const runs = new ExecutionRunStore(join(directory, 'runs'))
  const submissions = new ExecutionSubmissionStore(join(directory, 'submissions'))
  const now = Date.now(), runId = 'm25-terminal-run', submissionId = 'm25-terminal-submission'
  const conversationId = 'm25-deleted-conversation', workspaceId = 'm25-workspace'
  await new ConversationStore({ directory: join(directory, 'conversations') })
    .registerWorkspace({ workspaceId, rootPath: f.workspace, managed: false, authorization: 'user-selected' })
  const input: ExecutionStart = { conversationId, taskId: submissionId, instruction: '已结束的旧任务', documents: [],
    selection: { model: 'fixture-terminal', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture-only' },
      billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } } }
  await runs.save({ schemaVersion: 1, runId, version: 1, input,
    budget: { maxRequests: 5, maxToolCalls: 5, maxContextBytes: 1_000_000 }, status: 'completed',
    createdAt: now, updatedAt: now, messages: [], initialMessageCount: 0,
    requests: [{ requestId: 'known-finished', state: 'completed' }], tools: [] })
  await submissions.create({ schemaVersion: 1, submissionId, workspaceId, conversationId,
    state: 'accepted', mode: 'queue', text: input.instruction, documents: [], attachments: [], attachmentIds: [],
    model: { provider: 'fixture', model: 'fixture-terminal', accountId: 'fixture', billing: 'unknown' },
    createdAt: now, updatedAt: now, digest: 'm25-terminal-fixture', start: input, runId })
  const facts: Record<string, unknown> = { runId, submissionId, conversationId }
  let app: ElectronApplication | undefined
  try {
    app = await launch(f.profile)
    const page = await chooseWorkspace(app, f.workspace)
    const recovered = await page.evaluate(async workspace => {
      const execution = window.desktopAPI.execution!
      const space = await execution.workspace(workspace)
      return { workspaceId: space.workspace.workspaceId, conversations: space.conversations.length }
    }, f.workspace)
    const record = await submissions.read(submissionId)
    expect(record).toMatchObject({ state: 'accepted', runId, failure: { code: 'conversation-deleted' } })
    expect(await runs.read(runId)).toMatchObject({ status: 'completed', requests: [{ state: 'completed' }] })
    const current = await page.evaluate(async ({ workspaceId, conversationId }) =>
      window.desktopAPI.execution!.conversation(workspaceId, conversationId), { workspaceId, conversationId })
    expect(current).toBeNull()
    expect(recovered.conversations).toBe(0)
    facts.recovered = recovered
    facts.submission = { state: record!.state, runId: record!.runId, failure: record!.failure }
  } finally {
    writeFileSync(join(f.directory, 'evidence.json'), JSON.stringify(facts, null, 2))
    await closeApp(app)
  }
})
