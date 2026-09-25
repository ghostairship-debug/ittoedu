import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const helper = join(__dirname, 'helpers/g20WindowsImeInput.ps1')
type NativeSnapshot = { foreground: number; processId: number; keyboardLayout: number }
type Target = { hwnd: number; processId: number }
type Rect = { left: number; top: number; right: number; bottom: number }
type PhysicalGeometry = { window: Rect; monitor: Rect; workArea: Rect; dpi: number }
type CandidateSnapshot = { visible: boolean; lists: { automationId: string; name: string; candidates: string[] }[] }
type CandidatePixels = { changed: number; blueBefore: number; blueAfter: number; visible: boolean;
  region: { left: number; top: number; width: number; height: number } }
type ImeEvent = { type: string; key?: string; keyCode?: number; isComposing?: boolean; isTrusted: boolean; data?: string; value: string }

function native(action: 'snapshot'): NativeSnapshot
function native(action: 'geometry', target: Target, capturePath?: string): PhysicalGeometry
function native(action: 'candidate', target: Target, capturePath?: string): CandidateSnapshot
function native(action: 'focus' | 'type' | 'enter' | 'shift-enter' | 'space' | 'down' | 'restore', target: Target, extra?: string | number): void
function native(action: string, target?: Target, extra?: string | number): NativeSnapshot | PhysicalGeometry | CandidateSnapshot | void {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Action', action]
  if (target) args.push('-Window', String(target.hwnd), '-ProcessId', String(target.processId))
  if (action === 'type') args.push('-Text', String(extra))
  if (action === 'restore') args.push('-Previous', String(extra))
  if ((action === 'candidate' || action === 'geometry') && extra) args.push('-CapturePath', String(extra))
  const result = execFileSync('powershell.exe', args, { encoding: 'utf8', timeout: 20_000 }).trim()
  if (action === 'snapshot') return JSON.parse(result) as NativeSnapshot
  if (action === 'geometry') return JSON.parse(result) as PhysicalGeometry
  if (action === 'candidate') return JSON.parse(result) as CandidateSnapshot
}

async function target(app: ElectronApplication): Promise<Target> {
  return app.evaluate(({ BrowserWindow }) => ({
    hwnd: Number(BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle().readBigUInt64LE()),
    processId: process.pid,
  }))
}

async function observeIme(page: Page): Promise<void> {
  await page.evaluate(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="给创作助手发消息"]')
    if (!textarea) throw new Error('Composer textarea is absent')
    const events: ImeEvent[] = []
    ;(window as unknown as { g20ImeEvents: ImeEvent[] }).g20ImeEvents = events
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'keydown', 'keyup', 'beforeinput', 'input']) {
      textarea.addEventListener(type, raw => {
        const event = raw as KeyboardEvent & CompositionEvent & InputEvent
        events.push({ type, key: event.key, keyCode: event.keyCode, isComposing: event.isComposing,
          isTrusted: event.isTrusted, data: event.data ?? undefined, value: textarea.value })
      })
    }
  })
}

async function imeEvents(page: Page): Promise<ImeEvent[]> {
  return page.evaluate(() => (window as unknown as { g20ImeEvents: ImeEvent[] }).g20ImeEvents)
}

async function candidatePixels(before: string, during: string, cropPath: string, composer: Rect, monitor: Rect): Promise<CandidatePixels> {
  const left = Math.max(monitor.left, Math.floor(composer.left - 40))
  const top = Math.max(monitor.top, Math.floor(composer.top + 20))
  const right = Math.min(monitor.right, Math.ceil(composer.right + 300))
  const bottom = Math.min(monitor.bottom, Math.ceil(composer.bottom + 140))
  const region = { left: left - monitor.left, top: top - monitor.top, width: right - left, height: bottom - top }
  const first = await sharp(before).extract(region).ensureAlpha().raw().toBuffer()
  const second = await sharp(during).extract(region).ensureAlpha().raw().toBuffer()
  await sharp(during).extract(region).png().toFile(cropPath)
  let changed = 0; let blueBefore = 0; let blueAfter = 0
  for (let i = 0; i < first.length; i += 4) {
    const blue = (pixels: Buffer) => pixels[i + 2]! > pixels[i]! * 1.4 && pixels[i + 2]! > pixels[i + 1]! * 1.1
      && pixels[i + 2]! > 90 && pixels[i]! < 100 && pixels[i + 1]! < 180
    if (blue(first)) blueBefore++
    if (blue(second)) blueAfter++
    if (Math.max(Math.abs(first[i]! - second[i]!), Math.abs(first[i + 1]! - second[i + 1]!),
      Math.abs(first[i + 2]! - second[i + 2]!)) > 60) changed++
  }
  return { changed, blueBefore, blueAfter, visible: changed > 5_000 && blueAfter - blueBefore > 1_000, region }
}

test('M07-T02 native Windows IME Enter, multiline, @ reference and one HTTP send', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows native IME and foreground HWND are required')
  test.setTimeout(150_000)
  const output = join(root, 'output/g20/m07/ime-windows')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'native-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const referenceText = '# 参考资料\n\n先预测再观察。'
  writeFileSync(join(workspace, '参考资料.md'), referenceText)
  const requests: { messages?: { role?: string; content?: string | { type: string; text?: string }[] }[] }[] = []
  const errors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected ${request.method} ${request.url}`)
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'ime-local', model: 'fixture-selection', choices: [{ index: 0, delta: { role: 'assistant', content: '本地输入验证完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(error => { errors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  const previous = native('snapshot')
  let app: ElectronApplication | undefined
  let testWindow: Target | undefined
  let page: Page | undefined
  const observedCandidates: CandidateSnapshot[] = []
  let lastCandidate: CandidateSnapshot | undefined
  let inputLayout: NativeSnapshot | undefined
  let preImeGeometry: PhysicalGeometry | undefined
  let physicalComposer: Rect | undefined
  let firstCandidateVisible = false
  let firstCandidatePixels: CandidatePixels | undefined
  let secondCandidateVisible = false
  let secondCandidatePixels: CandidatePixels | undefined
  let enterCommitted = ''
  let selectedCandidate = ''
  const nativeCandidateCapture = join(directory, 'native-candidate.png')
  const nativeCandidateCrop = join(directory, 'native-candidate-crop.png')
  const spaceCandidateCapture = join(directory, 'native-space-candidate.png')
  const spaceCandidateCrop = join(directory, 'native-space-candidate-crop.png')
  const preImeCapture = join(directory, 'pre-ime-native.png')
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    // The system-owned Pinyin candidate popup is positioned from the physical
    // caret. Keep the complete Composer and space below it on the real monitor.
    await app.evaluate(({ BrowserWindow, screen }) => {
      const area = screen.getPrimaryDisplay().workArea
      BrowserWindow.getAllWindows()[0]!.setBounds({ x: area.x + 20, y: area.y + 20,
        width: Math.min(1240, area.width - 40), height: Math.min(740, area.height - 100) })
    })
    await setupSelectionUI(app, page, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, workspace)
    const composer = page.getByRole('textbox', { name: '给创作助手发消息' })
    await expect(composer).toBeEnabled()
    await observeIme(page)
    await composer.click()
    testWindow = await target(app)
    native('focus', testWindow)

    const electronGeometry = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return { bounds: window.getBounds(), contentBounds: window.getContentBounds(),
        scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor }
    })
    const composerGeometry = await composer.evaluate(input => {
      const rect = input.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, devicePixelRatio: window.devicePixelRatio }
    })
    preImeGeometry = native('geometry', testWindow, preImeCapture)
    const physicalScale = (preImeGeometry.window.right - preImeGeometry.window.left) / electronGeometry.bounds.width
    expect(Math.abs(physicalScale - electronGeometry.scaleFactor)).toBeLessThan(0.1)
    expect(Math.abs(composerGeometry.devicePixelRatio - electronGeometry.scaleFactor)).toBeLessThan(0.1)
    const left = preImeGeometry.window.left + (electronGeometry.contentBounds.x - electronGeometry.bounds.x + composerGeometry.x) * physicalScale
    const top = preImeGeometry.window.top + (electronGeometry.contentBounds.y - electronGeometry.bounds.y + composerGeometry.y) * physicalScale
    physicalComposer = { left, top, right: left + composerGeometry.width * physicalScale,
      bottom: top + composerGeometry.height * physicalScale }
    const { monitor, window: nativeWindow } = preImeGeometry
    expect(nativeWindow.left).toBeGreaterThanOrEqual(monitor.left)
    expect(nativeWindow.top).toBeGreaterThanOrEqual(monitor.top)
    expect(nativeWindow.right).toBeLessThanOrEqual(monitor.right)
    expect(nativeWindow.bottom).toBeLessThanOrEqual(monitor.bottom)
    expect(physicalComposer.left).toBeGreaterThanOrEqual(monitor.left)
    expect(physicalComposer.top).toBeGreaterThanOrEqual(monitor.top)
    expect(physicalComposer.right + 300, 'Leave 300 physical pixels for the native candidate popup').toBeLessThanOrEqual(monitor.right)
    expect(physicalComposer.bottom + 240, 'Leave 240 physical pixels below the Composer for the native candidate popup').toBeLessThanOrEqual(monitor.bottom)

    native('type', testWindow, 'nihao')
    await expect.poll(async () => (await imeEvents(page!)).some(event => event.type === 'compositionstart' && event.isTrusted)).toBe(true)
    await expect.poll(() => composer.inputValue()).toContain('hao')
    inputLayout = native('snapshot')
    lastCandidate = native('candidate', testWindow, nativeCandidateCapture)
    if (lastCandidate.visible) observedCandidates.push(lastCandidate)
    firstCandidatePixels = await candidatePixels(preImeCapture, nativeCandidateCapture, nativeCandidateCrop,
      physicalComposer, preImeGeometry.monitor)
    firstCandidateVisible = firstCandidatePixels.visible
    expect(firstCandidateVisible, 'Native screenshot must show a new blue conversion candidate panel at the Composer').toBe(true)
    expect(requests).toHaveLength(0)
    native('enter', testWindow)
    // On this Microsoft Pinyin profile, Enter commits raw nihao and ends the
    // first composition. That is still an IME key, never a message submit.
    await expect.poll(async () => (await imeEvents(page!)).some(event => event.type === 'compositionend')).toBe(true)
    enterCommitted = await composer.inputValue()
    expect(enterCommitted.length).toBeGreaterThan(0)
    expect(requests).toHaveLength(0)

    // Reset only the local test draft. In a fresh native composition, Space
    // selects the visible Chinese candidate without an intervening Enter.
    await composer.fill('')
    await expect(composer).toHaveValue('')
    native('focus', testWindow)
    native('type', testWindow, 'nihao')
    await expect.poll(async () => (await imeEvents(page!)).filter(event => event.type === 'compositionstart' && event.isTrusted).length).toBe(2)
    await expect.poll(() => composer.inputValue()).toContain('hao')
    lastCandidate = native('candidate', testWindow, spaceCandidateCapture)
    if (lastCandidate.visible) observedCandidates.push(lastCandidate)
    secondCandidatePixels = await candidatePixels(preImeCapture, spaceCandidateCapture, spaceCandidateCrop,
      physicalComposer, preImeGeometry.monitor)
    secondCandidateVisible = secondCandidatePixels.visible
    expect(secondCandidateVisible, 'A second native Chinese candidate panel must precede Space selection').toBe(true)
    native('space', testWindow)
    await expect.poll(() => composer.inputValue()).toBe('你好')
    await expect.poll(async () => (await imeEvents(page!)).filter(event => event.type === 'compositionend').length).toBe(2)
    const committed = await composer.inputValue()
    expect(requests).toHaveLength(0)
    const eventsAfterCandidate = await imeEvents(page)
    expect(eventsAfterCandidate.some(event => event.type === 'keydown' && event.key === 'Process' && event.keyCode === 229 && event.isComposing && event.isTrusted)).toBe(true)
    expect(eventsAfterCandidate.some(event => (event.type === 'compositionupdate' || event.type === 'input')
      && event.isTrusted && event.data?.includes('你好'))).toBe(true)

    native('shift-enter', testWindow)
    await expect(composer).toHaveValue(`${committed}\n`)
    expect(requests).toHaveLength(0)
    native('type', testWindow, 'ceshi')
    await expect.poll(async () => (await imeEvents(page!)).filter(event => event.type === 'compositionstart' && event.isTrusted).length).toBe(3)
    native('space', testWindow)
    await expect.poll(async () => (await imeEvents(page!)).filter(event => event.type === 'compositionend').length).toBe(3)
    const multiline = await composer.inputValue()
    expect(multiline).toMatch(/^你好\n[\u3400-\u9fff]+$/u)
    selectedCandidate = committed
    expect(requests).toHaveLength(0)

    await page.getByRole('button', { name: '添加', exact: true }).click(); await page.getByRole('menuitem', { name: '引用工作空间文件', exact: true }).click()
    const referenceDialog = page.getByRole('dialog', { name: '引用空间文件' })
    await expect(referenceDialog).toBeVisible()
    const reference = referenceDialog.getByRole('button', { name: '引用：参考资料.md', exact: true })
    await expect(reference).toBeVisible()
    await reference.focus()
    native('focus', testWindow)
    native('enter', testWindow)
    await expect(referenceDialog).toBeHidden()
    await expect(page.getByRole('button', { name: '预览发送内容', exact: true })).toBeEnabled()
    expect(requests).toHaveLength(0)
    await expect(composer).toHaveValue(multiline)

    await composer.click()
    native('focus', testWindow)
    native('enter', testWindow)
    expect(requests).toHaveLength(0)
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => requests.length).toBe(1)
    const sentUserContent = requests[0]?.messages?.find(message => message.role === 'user')?.content
    expect(Array.isArray(sentUserContent)).toBe(true)
    expect(sentUserContent).toContainEqual({ type: 'text', text: multiline })
    expect(sentUserContent).toContainEqual({ type: 'text', text: referenceText })
    await expect(page.getByText('本地输入验证完成', { exact: true })).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(errors).toEqual([])

    const evidence = { previous, inputLayout, preImeGeometry, physicalComposer, target: testWindow,
      enterCommitted, committed, multiline, requests: requests.length, imeEvents: await imeEvents(page),
      selectedCandidate, firstCandidateVisible, firstCandidatePixels, secondCandidateVisible, secondCandidatePixels, observedCandidates,
      note: 'Two native screenshots show 你好 as a visible candidate; Enter ends the first preedit without send, and Space selects 你好 from a fresh composition.' }
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await page.screenshot({ path: join(directory, 'composer.png') })
    await info.attach('native IME event trace', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    await info.attach('native Chinese candidate crop', { path: nativeCandidateCrop, contentType: 'image/png' })
    await info.attach('native Space candidate crop', { path: spaceCandidateCrop, contentType: 'image/png' })
    expect(selectedCandidate).toContain('你好')
  } catch (error) {
    if (page) await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ requests, errors, inputLayout, preImeGeometry, physicalComposer,
      lastCandidate, observedCandidates,
      firstCandidateVisible, firstCandidatePixels, secondCandidateVisible, secondCandidatePixels,
      enterCommitted, selectedCandidate,
      imeEvents: page ? await imeEvents(page).catch(() => []) : [] }, null, 2))
    throw error
  } finally {
    let restorationFailure: unknown
    if (testWindow) {
      try { native('restore', testWindow, previous.foreground) } catch (error) { restorationFailure = error }
    }
    if (app) {
      await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    const restored = native('snapshot')
    if (restored.foreground !== previous.foreground || restored.keyboardLayout !== previous.keyboardLayout) {
      throw new Error(`Original foreground/input layout was not restored: ${JSON.stringify({ previous, restored, restorationFailure: String(restorationFailure ?? '') })}`)
    }
  }
})
