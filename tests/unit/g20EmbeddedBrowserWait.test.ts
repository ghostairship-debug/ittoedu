// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElectronEmbeddedBrowserFactory } from '../../src/main/workbench/browserEmbedded/ElectronEmbeddedBrowser'
import type { EmbeddedBrowserBackend } from '../../src/main/workbench/browserEmbedded/EmbeddedBrowserBackend'

const state = vi.hoisted(() => ({ text: '', loading: false, browserSession: undefined as any,
  contents: undefined as any, dispatch: undefined as (() => void) | undefined, navigation: undefined as Promise<void> | undefined }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const browserSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() }, setProxy: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}),
  })
  state.browserSession = browserSession
  class WebContentsView {
    webContents: any
    constructor() {
      let destroyed = false
      const debuggerApi = Object.assign(new EventEmitter(), {
        attach: vi.fn(), detach: vi.fn(), isAttached: () => true,
        sendCommand: vi.fn(async (method: string, args: Record<string, unknown> = {}) => {
          if (method === 'Accessibility.getFullAXTree') return { nodes: [{ nodeId: 'root', name: { value: state.text } }] }
          if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
          if (method === 'DOM.querySelector') return { nodeId: 2 }
          if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } }
          if (method === 'Input.dispatchMouseEvent' && args.type === 'mouseReleased') state.dispatch?.()
          return {}
        }),
      })
      this.webContents = Object.assign(new EventEmitter(), {
        id: 1, session: browserSession, debugger: debuggerApi, setWindowOpenHandler: vi.fn(),
        isDestroyed: () => destroyed, isLoading: () => state.loading, getURL: () => 'https://example.test/', getTitle: () => '测试页',
        loadURL: vi.fn(async (url: string) => { if (url !== 'about:blank') await state.navigation }),
        close: () => { destroyed = true }, focus: vi.fn(),
      })
      state.contents = this.webContents
    }
    setBounds() {}
    setVisible() {}
  }
  class BaseWindow extends EventEmitter {
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    private destroyed = false
    isDestroyed() { return this.destroyed }
    setContentSize() {}
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  return { BaseWindow, WebContentsView, session: { fromPartition: () => browserSession } }
})

let browser: EmbeddedBrowserBackend | undefined
beforeEach(() => {
  vi.useFakeTimers()
  state.text = ''; state.loading = false; state.dispatch = undefined; state.navigation = undefined
  state.browserSession.removeAllListeners()
})
afterEach(async () => { await browser?.stop(); browser = undefined; vi.useRealTimers() })
async function create() {
  browser = await createElectronEmbeddedBrowserFactory(() => null)({ runId: 'run', scratch: 'C:/scratch',
    proxyUrl: 'http://127.0.0.1:1', allowedUrl: () => true, onPageChanged: () => {} })
  return browser
}
function call(browser: EmbeddedBrowserBackend, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  return browser.invoke({ operationId: 'operation', name: `mcp.browser.${name}`, arguments: args, signal })
}
function download() {
  const item = Object.assign(new EventEmitter(), { getFilename: () => 'lesson.pdf', setSavePath: vi.fn(),
    cancel: vi.fn(() => item.emit('done', {}, 'cancelled')) })
  state.browserSession.emit('will-download', {}, item, state.contents)
  return item
}

it('waits for text beyond the old 30 seconds and supports a caller-selected longer wait', async () => {
  const browser = await create()
  const returned = vi.fn()
  const pending = call(browser, 'browser_wait_for', { text: '登录成功' }).then(result => { returned(result); return result })
  await vi.advanceTimersByTimeAsync(35_000)
  expect(returned).not.toHaveBeenCalled()
  state.text = '登录成功'
  await vi.advanceTimersByTimeAsync(100)
  expect(await pending).toMatchObject({ status: 'returned' })
  const timed = call(browser, 'browser_wait_for', { time: 60 }).then(returned)
  await vi.advanceTimersByTimeAsync(31_000)
  expect(returned).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(29_000)
  await timed
  expect(returned).toHaveBeenCalledTimes(2)
  const discovery = await browser.discover(true)
  if (discovery.status !== 'available') throw new Error('浏览器工具发现失败')
  expect(discovery.tools.find(tool => tool.remoteName === 'browser_wait_for')?.inputSchema)
    .toMatchObject({ properties: { time: { type: 'number', minimum: 0 } } })
})

it('releases a pending text wait on caller cancellation or browser Stop', async () => {
  const browser = await create(), controller = new AbortController()
  const pending = call(browser, 'browser_wait_for', { text: '尚未出现' }, controller.signal)
  await vi.advanceTimersByTimeAsync(35_000)
  controller.abort()
  expect(await pending).toMatchObject({ status: 'failed', reason: '任务浏览器已停止' })
  const stopped = call(browser, 'browser_wait_for', { text: '尚未出现' })
  await vi.advanceTimersByTimeAsync(100)
  await browser.stop()
  expect(await stopped).toMatchObject({ status: 'failed', reason: '任务浏览器已停止' })
})

it.each(['browser_click', 'browser_type'])('prevents late %s input after a cancelled DOM lookup', async tool => {
  const browser = await create(), controller = new AbortController()
  let finishLookup!: (value: unknown) => void
  const lookup = new Promise(resolve => { finishLookup = resolve })
  const command = state.contents.debugger.sendCommand
  const original = command.getMockImplementation()
  command.mockImplementation((method: string, args: Record<string, unknown>) => method === 'DOM.querySelector' ? lookup : original(method, args))
  const pending = call(browser, tool, { target: '#input', text: 'old agent input', submit: true }, controller.signal)
  await vi.waitFor(() => expect(command).toHaveBeenCalledWith('DOM.querySelector', expect.anything()))
  controller.abort()
  expect(await pending).toMatchObject({ status: 'failed' })
  finishLookup({ nodeId: 2 })
  await vi.advanceTimersByTimeAsync(1000)
  expect(command.mock.calls.some(([method]: [string]) => method.startsWith('Input.') || method === 'DOM.focus')).toBe(false)
})

it('keeps new element references when a cancelled AX snapshot returns late', async () => {
  const browser = await create(), controller = new AbortController()
  let finishOld!: (value: unknown) => void
  const oldTree = new Promise(resolve => { finishOld = resolve })
  const command = state.contents.debugger.sendCommand
  const original = command.getMockImplementation()
  let reads = 0
  command.mockImplementation((method: string, args: Record<string, unknown>) => method !== 'Accessibility.getFullAXTree' ? original(method, args)
    : ++reads === 1 ? oldTree : Promise.resolve({ nodes: [{ nodeId: 'fresh', backendDOMNodeId: 42, name: { value: 'Current input' } }] }))
  const oldSnapshot = call(browser, 'browser_snapshot', {}, controller.signal)
  await vi.waitFor(() => expect(reads).toBe(1))
  controller.abort()
  expect(await oldSnapshot).toMatchObject({ status: 'failed' })
  expect(await call(browser, 'browser_snapshot', {})).toMatchObject({ status: 'returned' })
  finishOld({ nodes: [{ nodeId: 'stale', backendDOMNodeId: 99, name: { value: 'Old input' } }] })
  await vi.advanceTimersByTimeAsync(1)
  const click = call(browser, 'browser_click', { target: 'e1' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(await click).toMatchObject({ status: 'returned' })
  expect(command).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', { backendNodeId: 42 })
})

it('waits for actual post-action navigation beyond 15 seconds and reports dispatched cancellation as unknown', async () => {
  const browser = await create(), returned = vi.fn()
  state.loading = true
  const pending = call(browser, 'browser_click', { target: '#link' }).then(result => { returned(result); return result })
  await vi.advanceTimersByTimeAsync(20_000)
  expect(returned).not.toHaveBeenCalled()
  state.loading = false
  await vi.advanceTimersByTimeAsync(50)
  expect(await pending).toMatchObject({ status: 'returned' })
  state.loading = true
  const controller = new AbortController()
  const canceled = call(browser, 'browser_click', { target: '#link' }, controller.signal)
  await vi.advanceTimersByTimeAsync(100)
  controller.abort()
  expect(await canceled).toMatchObject({ status: 'unknown', reason: '任务浏览器已停止' })
})

it('releases an unresolved native navigation on cancellation without waiting for a deadline', async () => {
  const browser = await create(), controller = new AbortController(), returned = vi.fn()
  let finish!: () => void
  state.navigation = new Promise<void>(resolve => { finish = resolve })
  const pending = call(browser, 'browser_navigate', { url: 'https://example.test/slow' }, controller.signal)
    .then(result => { returned(result); return result })
  await vi.advanceTimersByTimeAsync(45_000)
  expect(returned).not.toHaveBeenCalled()
  controller.abort()
  expect(await pending).toMatchObject({ status: 'failed', reason: '任务浏览器已停止' })
  finish()
})

it('awaits a real download completion past 15 seconds and keeps cancellation and native failure truthful', async () => {
  const browser = await create(), returned = vi.fn()
  let item!: ReturnType<typeof download>
  state.dispatch = () => { item = download() }
  const pending = call(browser, 'browser_click', { target: '#download' }).then(result => { returned(result); return result })
  await vi.advanceTimersByTimeAsync(25_000)
  expect(returned).not.toHaveBeenCalled()
  item.emit('done', {}, 'completed')
  expect(await pending).toMatchObject({ status: 'returned', content: expect.arrayContaining([
    expect.objectContaining({ text: '- Downloaded file lesson.pdf to "lesson.pdf"' }),
  ]) })

  const controller = new AbortController()
  const canceled = call(browser, 'browser_click', { target: '#download' }, controller.signal)
  await vi.advanceTimersByTimeAsync(100)
  controller.abort()
  expect(await canceled).toMatchObject({ status: 'unknown' })
  item.emit('done', {}, 'interrupted')
  const failure = await call(browser, 'browser_find', { text: '页面' })
  expect(failure).toMatchObject({ status: 'returned', content: expect.arrayContaining([
    expect.objectContaining({ text: expect.stringContaining('下载未完成（interrupted）') }),
  ]) })
  if (failure.status !== 'returned') throw new Error('下载结果未返回')
  expect(failure.content.some(content => content.type === 'text' && content.text.startsWith('- Downloaded file'))).toBe(false)

  const stopped = call(browser, 'browser_click', { target: '#download' })
  await vi.advanceTimersByTimeAsync(100)
  await browser.stop()
  expect(await stopped).toMatchObject({ status: 'unknown' })
  expect(item.cancel).toHaveBeenCalledOnce()
})
