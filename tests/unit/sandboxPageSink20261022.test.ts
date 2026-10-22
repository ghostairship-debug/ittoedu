// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createSandboxedAttachmentExtractor } from '../../src/main/workbench/attachments/SandboxedAttachmentExtraction'
const windows = vi.hoisted(() => [] as any[])
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { BrowserWindow: class extends EventEmitter { gone = false
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, ipc: new EventEmitter(), send: vi.fn(), setWindowOpenHandler: vi.fn() })
    constructor() { super(); windows.push(this) } isDestroyed() { return this.gone } destroy() { this.gone = true; this.emit('closed') } async loadURL() {}
  }, session: { fromPartition: () => Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } }) } }
})
vi.mock('../../src/main/diagnosticLog', () => ({ diagnosticLog: { append: vi.fn(async () => {}) } }))
afterEach(() => { windows.splice(0); vi.restoreAllMocks() })
const extractor = () => createSandboxedAttachmentExtractor({ preloadPath: 'extract.js', rendererURL: 'http://127.0.0.1:5173/attachment-extraction.html' })
const ready = (worker: any) => worker.webContents.ipc.emit('attachment-extraction:ready', { senderFrame: worker.webContents.mainFrame })
it('acknowledges only after its own page sink and cancels only that host while draining the in-flight write', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), sink = vi.fn(() => gate), stop = new AbortController()
  const pending = extractor().streamPdfPages({ bytes: Uint8Array.of(1), filename: 'book.pdf' }, { signal: stop.signal, onPage: sink })
  const worker = windows[0]; ready(worker)
  worker.webContents.ipc.emit('attachment-extraction:page', { senderFrame: {} }, { page: 8 })
  expect(sink).not.toHaveBeenCalled()
  worker.webContents.ipc.emit('attachment-extraction:page', { senderFrame: worker.webContents.mainFrame }, { page: 1 })
  await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(1))
  expect(worker.webContents.send.mock.calls.map((call: unknown[]) => call[0])).not.toContain('attachment-extraction:page-saved')
  let settled = false
  const rejected = expect(pending.finally(() => { settled = true })).rejects.toThrow('取消')
  stop.abort(); await Promise.resolve(); expect(worker.isDestroyed()).toBe(true); expect(settled).toBe(false)
  release(); await rejected
  expect(worker.webContents.send.mock.calls.map((call: unknown[]) => call[0])).not.toContain('attachment-extraction:page-saved')
})
it('keeps the complete extraction entrance and acknowledges a saved stream page before final result', async () => {
  const host = extractor(), streamed = host.streamPdfPages({ bytes: Uint8Array.of(1), filename: 'book.pdf' }, { onPage: async () => {} }), worker = windows[0]
  ready(worker); worker.webContents.ipc.emit('attachment-extraction:page', { senderFrame: worker.webContents.mainFrame }, { page: 1 })
  await vi.waitFor(() => expect(worker.webContents.send).toHaveBeenCalledWith('attachment-extraction:page-saved'))
  const summary = { streamed: true, totalPages: 1, selectedPages: { from: 1, to: 1 } }
  worker.webContents.ipc.emit('attachment-extraction:result', { senderFrame: worker.webContents.mainFrame }, { ok: true, result: summary })
  await expect(streamed).resolves.toEqual(summary)
  const complete = host.extract({ bytes: Uint8Array.of(1), filename: 'book.pdf' }), other = windows[1]; ready(other)
  expect(other.webContents.send.mock.calls[0][1].streamPdfPages).toBeUndefined()
  const result = { material: { fragments: [] }, pageImages: [] }
  other.webContents.ipc.emit('attachment-extraction:result', { senderFrame: other.webContents.mainFrame }, { ok: true, result })
  await expect(complete).resolves.toEqual(result)
})
