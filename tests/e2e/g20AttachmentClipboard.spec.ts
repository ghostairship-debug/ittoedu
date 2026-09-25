import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { answerG20VisionCapabilityProbe } from '../helpers/g20CapabilityProbeFixture'

const root = resolve(__dirname, '../..')
async function clipboardKeeper() {
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests/e2e/helpers/g20ClipboardFixture.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const lines: string[] = [], waiters: Array<(line: string) => void> = []
  let errors = ''
  child.stderr.on('data', data => { errors += data.toString() })
  createInterface({ input: child.stdout }).on('line', line => { const waiter = waiters.shift(); if (waiter) waiter(line); else lines.push(line) })
  const next = () => new Promise<string>((resolveLine, reject) => {
    if (lines.length) return resolveLine(lines.shift()!)
    const timer = setTimeout(() => reject(new Error(`Clipboard keeper timed out: ${errors}`)), 15_000)
    waiters.push(line => { clearTimeout(timer); resolveLine(line) })
  })
  expect(JSON.parse(await next())).toEqual({ ready: true })
  return {
    async set(command: unknown) { child.stdin.write(`${JSON.stringify(command)}\n`); expect(JSON.parse(await next())).toEqual({ set: true }) },
    async restore() {
      const exited = new Promise<number | null>(resolveExit => child.once('exit', resolveExit))
      child.stdin.end(); expect(JSON.parse(await next())).toEqual({ restored: true })
      expect(await exited, errors).toBe(0)
    },
  }
}

test('M08 Windows real Ctrl+V sends an in-memory image and both Explorer file-list snapshots', async ({}, info) => {
  test.setTimeout(150_000)
  const output = join(root, 'output/g20/b07/clipboard'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const first = join(directory, '资料甲.md'), second = join(directory, '资料乙.txt')
  writeFileSync(first, '# ORIGINAL_ALPHA\n'); writeFileSync(second, 'ORIGINAL_BETA\n')
  const requests: any[] = [], wireErrors: string[] = []
  let probeRequests = 0
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/v1/models') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'fixture-attachments' }] }))
        return
      }
      let body = ''; for await (const part of request) body += part.toString()
      const payload = JSON.parse(body)
      expect(payload.model).toBe('fixture-attachments')
      const probeAnswer = await answerG20VisionCapabilityProbe(payload)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (probeAnswer !== null) {
        probeRequests++
        const message = { id: `vision-probe-${probeRequests}`, model: 'fixture-attachments', choices: [{ index: 0, delta: { role: 'assistant', content: probeAnswer }, finish_reason: 'stop' }] }
        response.end(`data: ${JSON.stringify(message)}\n\ndata: [DONE]\n\n`)
        return
      }
      requests.push(payload)
      const message = { id: `attachment-${requests.length}`, model: 'fixture-attachments', choices: [{ index: 0, delta: { role: 'assistant', content: `已收到第 ${requests.length} 次附件快照。` }, finish_reason: 'stop' }] }
      response.end(`data: ${JSON.stringify(message)}\n\ndata: [DONE]\n\n`)
    } catch (error) { wireErrors.push(String(error)); response.writeHead(500); response.end('fixture failed') }
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const keeper = await clipboardKeeper()
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    const rendererErrors: string[] = []; page.on('pageerror', error => rendererErrors.push(error.message))
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByLabel('供应商标识', { exact: true }).fill('fixture-controlled-http')
    await page.getByLabel('账号标识', { exact: true }).fill('local-fixture')
    await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
    await page.getByLabel('API Key', { exact: true }).fill('fixture-local-not-secret')
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
    const settings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    const connectionId = settings.connections.find(entry => entry.connection.provider === 'fixture-controlled-http')?.connection.id
    expect(connectionId).toBeTruthy()
    await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
    await page.getByLabel('对话与规划连接', { exact: true }).selectOption(connectionId!)
    await page.getByLabel('对话与规划模型', { exact: true }).selectOption('fixture-attachments')
    await page.getByLabel('视觉理解连接', { exact: true }).selectOption(connectionId!)
    await page.getByLabel('视觉理解模型', { exact: true }).selectOption('fixture-attachments')
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '模型角色已保存' })).toBeVisible()
    await page.getByRole('button', { name: '验证视觉理解视觉能力', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '视觉能力已验证' })).toBeVisible()
    expect(probeRequests).toBe(1)
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    const input = page.getByLabel('给创作助手发消息'), composer = page.locator('.attachment-composer')
    await expect(input).toBeVisible()
    const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#227755' } }).png().toBuffer()
    await keeper.set({ kind: 'image', base64: png.toString('base64') })
    await input.click(); await input.press('Control+V')
    await expect(composer.getByRole('button', { name: '预览发送内容', exact: true })).toHaveCount(1)
    await composer.getByRole('button', { name: '预览发送内容', exact: true }).click()
    await expect(composer.getByRole('dialog').getByRole('img')).toBeVisible()
    await page.screenshot({ path: join(directory, 'image-clipboard-preview.png') })
    await composer.getByRole('button', { name: '关闭预览', exact: true }).click()
    await expect(input).toHaveValue('')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect(page.getByText('已收到第 1 次附件快照。', { exact: true })).toBeVisible()
    expect(requests).toHaveLength(1)
    const imageParts = requests[0].messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []).filter((part: any) => part.type === 'image_url')
    expect(imageParts).toHaveLength(1)
    expect(imageParts[0].image_url.url).toMatch(/^data:image\//)
    expect(await sharp(Buffer.from(imageParts[0].image_url.url.split(',')[1], 'base64')).metadata()).toMatchObject({ width: 32, height: 24 })

    await keeper.set({ kind: 'files', paths: [first, second] })
    await input.click(); await input.press('Control+V')
    await expect(composer.getByRole('button', { name: '预览发送内容', exact: true })).toHaveCount(2)
    await expect(composer.getByText('资料甲.md', { exact: true })).toBeVisible()
    await expect(composer.getByText('资料乙.txt', { exact: true })).toBeVisible()
    // A later disk edit must not change what was attached by this paste gesture.
    writeFileSync(first, '# CHANGED_AFTER_PASTE\n')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(() => requests.length).toBe(2)
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect(page.getByText('已收到第 2 次附件快照。', { exact: true })).toBeVisible()
    expect(requests).toHaveLength(2); expect(probeRequests).toBe(1)
    const lastUser = requests[1].messages.filter((message: any) => message.role === 'user').at(-1)
    expect(JSON.stringify(lastUser)).toContain('ORIGINAL_ALPHA'); expect(JSON.stringify(lastUser)).toContain('ORIGINAL_BETA')
    expect(JSON.stringify(lastUser)).not.toContain('CHANGED_AFTER_PASTE')
    expect(readFileSync(first, 'utf8')).toContain('CHANGED_AFTER_PASTE'); expect(readFileSync(second, 'utf8')).toBe('ORIGINAL_BETA\n')
    await keeper.set({ kind: 'text', text: '普通粘贴保留为输入' })
    await input.click(); await input.press('Control+V')
    await expect(input).toHaveValue('普通粘贴保留为输入')
    await expect(composer.getByRole('button', { name: '预览发送内容', exact: true })).toHaveCount(0)
    await page.screenshot({ path: join(directory, 'files-sent-and-text-paste.png') })
    expect(rendererErrors).toEqual([]); expect(wireErrors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ provider: 'fixture-controlled-http', model: 'fixture-attachments', probeRequests, attachmentRequests: requests.length, inMemoryImage: { width: 32, height: 24 }, files: ['资料甲.md', '资料乙.txt'], immutableSnapshotAfterDiskEdit: true, rendererErrors, wireErrors }, null, 2))
    await info.attach('attachment-evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } catch (error) {
    const page = app?.windows()[0]; if (page) await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined)
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ probeRequests, attachmentRequests: requests.length, wireErrors }, null, 2)); throw error
  } finally {
    try { await keeper.restore() } finally {
      const ownedApp = app
      if (ownedApp) {
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          ownedApp.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined),
          new Promise<void>(resolveStop => { timer = setTimeout(() => { ownedApp.process().kill(); resolveStop() }, 5_000) }),
        ])
        if (timer) clearTimeout(timer)
      }
      server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    }
  }
})
