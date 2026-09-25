import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const fixtureText = (text: string) => `data: ${JSON.stringify({ id: 'm08-fixture', model: 'fixture-selection', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`

test('M08-T04 selected files: failed read retries, large read cancels and removes, only successful snapshots send', async () => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/m08/attachment-ui'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'failure-cancel-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const goodPath = join(workspace, 'good.txt'), retryPath = join(workspace, 'retry.txt'), largePath = join(workspace, 'large.txt')
  const goodBytes = Buffer.from('M08-good-unique: 保留第一项。')
  const retryBytes = Buffer.from('M08-retry-unique: 修复读取后加入。')
  const largeBytes = Buffer.alloc(8 * 1024 * 1024, 65)
  writeFileSync(goodPath, goodBytes); writeFileSync(largePath, largeBytes)
  expect(existsSync(retryPath)).toBe(false)

  const requests: unknown[] = [], serverErrors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected local request ${request.method} ${request.url}`)
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(fixtureText('M08 本地发送完成'))
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  let app: ElectronApplication | undefined
  try {
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await setupSelectionUI(app, page, endpoint, workspace)

    // The real main-process attachment reader uses node:fs promises.open. Hold
    // only this source's second 64 KiB read, after one genuine progress event.
    await app.evaluate((_, filename) => {
      const fs = process.getBuiltinModule('node:fs')!.promises
      const originalOpen = fs.open.bind(fs)
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const state = globalThis as typeof globalThis & { __m08ReadGate?: { entered: boolean; release(): void; restore(): void } }
      state.__m08ReadGate = { entered: false, release, restore() { fs.open = originalOpen; release(); delete state.__m08ReadGate } }
      fs.open = (async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args)
        if (String(args[0]).toLowerCase() === filename.toLowerCase()) {
          const read = handle.read.bind(handle)
          let reads = 0
          Object.defineProperty(handle, 'read', { configurable: true, value: async (buffer: Buffer) => {
            if (++reads === 2) { state.__m08ReadGate!.entered = true; await gate }
            return read(buffer)
          } })
        }
        return handle
      }) as typeof fs.open
    }, largePath)

    await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, [goodPath, retryPath, largePath])
    await page.getByRole('button', { name: '添加', exact: true }).click(); await page.getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true }).click()

    const failed = page.getByLabel('附件准备：retry.txt')
    await expect(failed).toContainText('失败，此项不会发送')
    await expect.poll(() => app!.evaluate(() => (globalThis as typeof globalThis & { __m08ReadGate?: { entered: boolean } }).__m08ReadGate?.entered)).toBe(true)
    const large = page.getByLabel('附件准备：large.txt')
    await expect(large).toContainText('读取中')
    await expect.poll(() => large.getByLabel('large.txt读取进度').evaluate(element => (element as HTMLProgressElement).value)).toBeGreaterThan(0)
    expect(await large.getByLabel('large.txt读取进度').evaluate(element => (element as HTMLProgressElement).value)).toBeLessThan(1)
    await expect(page.getByLabel('good.txt用途')).toBeVisible()

    writeFileSync(retryPath, retryBytes)
    await failed.getByRole('button', { name: '重试', exact: true }).click()
    await expect(failed).toBeHidden()
    await expect(page.getByLabel('retry.txt用途')).toBeVisible()
    await large.getByRole('button', { name: '取消处理', exact: true }).click()
    await expect(large).toContainText('已取消，此项不会发送')
    await app.evaluate(() => (globalThis as typeof globalThis & { __m08ReadGate?: { release(): void } }).__m08ReadGate?.release())
    await expect(large).toContainText('已取消，此项不会发送')
    await large.getByRole('button', { name: '移除失败项', exact: true }).click()
    await expect(large).toBeHidden()
    await expect(page.getByLabel('large.txt用途')).toBeHidden()

    const composer = page.getByLabel('给创作助手发消息')
    await composer.fill('M08 仅发送已成功的两项附件')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => requests.length).toBe(1)
    await expect(page.getByText('M08 本地发送完成', { exact: true })).toBeVisible()

    const wire = JSON.stringify(requests[0])
    expect(wire).toContain('M08-good-unique')
    expect(wire).toContain('M08-retry-unique')
    expect(wire).not.toContain('large.txt')
    const conversations = await page.evaluate(async workspace => {
      const opened = await window.desktopAPI.execution!.workspace(workspace)
      return window.desktopAPI.execution!.conversations(opened.workspace.workspaceId)
    }, workspace)
    const conversation = conversations.find(item => item.messages.some(message => message.text === 'M08 仅发送已成功的两项附件'))
    expect(conversation).toBeDefined()
    const run = await page.evaluate(id => window.desktopAPI.execution!.run(id), conversation!.runIndex.builtinRunIds[0]!)
    const refs = run?.input.inputContext?.attachments ?? []
    expect(refs).toHaveLength(2)
    const snapshots = await page.evaluate(ids => Promise.all(ids.map(id => window.desktopAPI.attachments!.snapshot(id))), refs.map(ref => ref.attachmentId))
    expect(snapshots.map(snapshot => snapshot.name).sort()).toEqual(['good.txt', 'retry.txt'])
    expect(snapshots.map(snapshot => snapshot.digest).sort()).toEqual([goodBytes, retryBytes].map(bytes => createHash('sha256').update(bytes).digest('hex')).sort())
    expect(conversation!.messages.find(message => message.text === 'M08 仅发送已成功的两项附件')?.attachmentIds.sort()).toEqual(snapshots.map(snapshot => snapshot.id).sort())
    expect(readFileSync(goodPath)).toEqual(goodBytes)
    expect(readFileSync(retryPath)).toEqual(retryBytes)
    expect(createHash('sha256').update(readFileSync(largePath)).digest('hex')).toBe(createHash('sha256').update(largeBytes).digest('hex'))
    expect(serverErrors).toEqual([])
  } finally {
    if (app) {
      await app.evaluate(() => (globalThis as typeof globalThis & { __m08ReadGate?: { restore(): void } }).__m08ReadGate?.restore()).catch(() => {})
      await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
