import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openSelectionFile } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const imeHelper = join(root, 'tests/e2e/helpers/g20WindowsImeInput.ps1')
type NativeTarget = { hwnd: number; processId: number }
type NativeSnapshot = { foreground: number; processId: number; keyboardLayout: number }
function native(action: 'snapshot'): NativeSnapshot
function native(action: 'focus' | 'type' | 'restore', target: NativeTarget, extra?: string | number): void
function native(action: string, target?: NativeTarget, extra?: string | number): NativeSnapshot | void {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', imeHelper, '-Action', action]
  if (target) args.push('-Window', String(target.hwnd), '-ProcessId', String(target.processId))
  if (action === 'type') args.push('-Text', String(extra))
  if (action === 'restore') args.push('-Previous', String(extra))
  const value = execFileSync('powershell.exe', args, { encoding: 'utf8', timeout: 20_000 }).trim()
  if (action === 'snapshot') return JSON.parse(value) as NativeSnapshot
}

async function preserveClipboard() {
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests/e2e/helpers/g20ClipboardFixture.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const lines: string[] = [], waiting: Array<(line: string) => void> = []
  let stderr = ''
  child.stderr.on('data', data => { stderr += data.toString() })
  createInterface({ input: child.stdout }).on('line', line => { const next = waiting.shift(); if (next) next(line); else lines.push(line) })
  const next = () => new Promise<string>((resolveLine, reject) => {
    if (lines.length) return resolveLine(lines.shift()!)
    const timer = setTimeout(() => reject(new Error(`Clipboard helper timed out: ${stderr}`)), 15_000)
    waiting.push(line => { clearTimeout(timer); resolveLine(line) })
  })
  expect(JSON.parse(await next())).toEqual({ ready: true })
  return {
    async set(command: unknown) { child.stdin.write(`${JSON.stringify(command)}\n`); expect(JSON.parse(await next())).toEqual({ set: true }) },
    async restore() {
      const exited = new Promise<number | null>(resolveExit => child.once('exit', resolveExit))
      child.stdin.end(); expect(JSON.parse(await next())).toEqual({ restored: true })
      expect(await exited, stderr).toBe(0)
    },
  }
}

test('M08-T05 real Electron focus routes body text, chat text, HTML image and Explorer files once each', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows clipboard file list is required')
  test.setTimeout(150_000)
  const output = join(root, 'output/g20/m08/paste-focus'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'focus.md'), '# 正文粘贴检查\n\n原有内容。\n')
  const first = join(workspace, '甲.txt'), second = join(workspace, '乙.txt')
  writeFileSync(first, 'FIRST'); writeFileSync(second, 'SECOND')
  const keeper = await preserveClipboard()
  const previousFocus = native('snapshot')
  let app: ElectronApplication | undefined
  let nativeTarget: NativeTarget | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await openSelectionFile(page, workspace, 'focus.md')
    const body = page.getByRole('textbox', { name: '正文编辑' })
    const chat = page.getByRole('textbox', { name: '给创作助手发消息' })
    const cards = page.locator('.attachment-composer').getByRole('button', { name: '预览发送内容', exact: true })
    await expect(body).toBeVisible()

    await keeper.set({ kind: 'text', text: '正文专属粘贴' })
    await body.click(); await body.press('Control+V')
    await expect(body).toContainText('正文专属粘贴')
    await expect(chat).toHaveValue('')
    await expect(cards).toHaveCount(0)
    await keeper.set({ kind: 'text', text: '聊天专属粘贴' })
    await chat.click(); await chat.press('Control+V')
    await expect(chat).toHaveValue('聊天专属粘贴')
    await expect(cards).toHaveCount(0)
    await chat.fill('')

    const png = await sharp({ create: { width: 6, height: 4, channels: 4, background: '#527a55' } }).png().toBuffer()
    await app.evaluate(({ clipboard, nativeImage }, base64) => {
      clipboard.write({ text: '混合说明', html: `<p>混合说明<img src="data:image/png;base64,${base64}"></p>`,
        image: nativeImage.createFromDataURL(`data:image/png;base64,${base64}`) })
    }, png.toString('base64'))
    await chat.click(); await chat.press('Control+V')
    await expect(cards).toHaveCount(1)
    await expect(chat).toHaveValue('混合说明')
    await keeper.set({ kind: 'files', paths: [first, second] })
    await chat.fill('')
    await chat.click(); await chat.press('Control+V')
    await expect(cards).toHaveCount(3)
    await expect(page.locator('.attachment-composer').getByText('甲.txt', { exact: true })).toBeVisible()
    await expect(page.locator('.attachment-composer').getByText('乙.txt', { exact: true })).toBeVisible()
    await expect(chat).toHaveValue('')
    expect(readFileSync(first, 'utf8')).toBe('FIRST'); expect(readFileSync(second, 'utf8')).toBe('SECOND')

    // Exercise a real Windows IME composition while the chat textarea owns
    // focus. The same OS clipboard text must stay in chat, with no attachment
    // and no second paste into the document body.
    await keeper.set({ kind: 'text', text: 'IME阶段文字' })
    await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea[data-attachment-paste-target]')!
      const events: { type: string; trusted: boolean; focused: boolean }[] = []
      ;(window as unknown as { g20M08ImeEvents: typeof events }).g20M08ImeEvents = events
      for (const type of ['compositionstart', 'compositionend', 'paste']) input.addEventListener(type, event => {
        events.push({ type, trusted: event.isTrusted, focused: document.activeElement === input })
      })
    })
    await chat.click()
    nativeTarget = await app.evaluate(({ BrowserWindow }) => ({
      hwnd: Number(BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle().readBigUInt64LE()), processId: process.pid,
    }))
    await page.bringToFront()
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.show(); window.focus() })
    native('focus', nativeTarget)
    native('type', nativeTarget, 'nihao')
    await expect.poll(() => page.evaluate(() => (window as unknown as { g20M08ImeEvents: { type: string; trusted: boolean }[] }).g20M08ImeEvents
      .some(event => event.type === 'compositionstart' && event.trusted))).toBe(true)
    await page.keyboard.press('Control+V')
    await expect.poll(() => page.evaluate(() => (window as unknown as { g20M08ImeEvents: { type: string; trusted: boolean; focused: boolean }[] }).g20M08ImeEvents
      .some(event => event.type === 'paste' && event.trusted && event.focused))).toBe(true)
    await expect(chat).toHaveValue(/IME阶段文字/)
    await expect(cards).toHaveCount(3)
    await expect(body).toContainText('正文专属粘贴')
    const imeEvents = await page.evaluate(() => (window as unknown as { g20M08ImeEvents: { type: string; trusted: boolean; focused: boolean }[] }).g20M08ImeEvents)
    expect(errors).toEqual([])
    await page.screenshot({ path: join(directory, 'focus-and-three-attachments.png') })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ bodyText: '正文专属粘贴', chatText: '聊天专属粘贴', mixedHtmlText: '混合说明', htmlImageAttachments: 1,
      afterExplorerPaste: 3, files: ['甲.txt', '乙.txt'], sourceFilesUnchanged: true, nativeIme: { keyboardLayout: previousFocus.keyboardLayout, events: imeEvents }, rendererErrors: errors }, null, 2))
    await info.attach('M08 paste focus evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } catch (error) {
    const page = app?.windows()[0]
    if (page) await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined)
    throw error
  } finally {
    try { await keeper.restore() } finally {
      let restoreFailure: unknown
      if (nativeTarget) {
        try { native('restore', nativeTarget, previousFocus.foreground) }
        catch (error) { restoreFailure = error }
      }
      const owned = app
      if (owned) {
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          owned.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined),
          new Promise<void>(resolveStop => { timer = setTimeout(() => { owned.process().kill(); resolveStop() }, 5_000) }),
        ])
        if (timer) clearTimeout(timer)
      }
      if (restoreFailure) throw restoreFailure
    }
  }
})
