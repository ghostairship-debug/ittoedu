// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { PptxCourseImportProducer } from '../../src/main/workbench/pptxImport/PptxCourseImportProducer'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
const windows = vi.hoisted(() => [] as any[])
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { BrowserWindow: class extends EventEmitter {
    gone = false
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, ipc: new EventEmitter(), send: vi.fn(), setWindowOpenHandler: vi.fn() })
    constructor() { super(); windows.push(this) }
    isDestroyed() { return this.gone }
    destroy() { this.gone = true; this.emit('closed') }
    async loadURL() {}
  } }
})
afterEach(() => { windows.splice(0); vi.restoreAllMocks() })
function ready(worker: any) { worker.webContents.ipc.emit('pptx-import:ready', { senderFrame: worker.webContents.mainFrame }); return worker.webContents.send.mock.calls[0][1] }
function result(worker: any, reply: object) { worker.webContents.ipc.emit('pptx-import:result', { senderFrame: worker.webContents.mainFrame }, reply) }
const model = () => ({ kind: 'course-v10' as const, project: createBlankCourseProjectV10('Converted'), resources: { assets: {}, components: {} } })

it('accepts the converted model with original resource validation and never needs an intermediate archive', async () => {
  const producer = new PptxCourseImportProducer('http://127.0.0.1:5173/'), bytes = new Uint8Array([1, 2, 3])
  const pending = producer.prepare({ bytes, filename: 'D:/source.pptx' }), worker = windows[0], request = ready(worker), converted = model()
  result(worker, { requestId: request.requestId, status: 'converted', mode: 'course', course: { model: converted, suggestedName: 'source.glx', issues: [] } })
  const value = await pending
  expect(value.model).toBe(converted); expect('archiveBytes' in value).toBe(false)
  expect(worker.isDestroyed()).toBe(true); expect([...bytes]).toEqual([1, 2, 3])
})
it('freezes canvas/input bytes and cancelling one conversion destroys only its own worker', async () => {
  const producer = new PptxCourseImportProducer('http://127.0.0.1:5173/'), stop = new AbortController(), bytes = new Uint8Array([4, 5])
  const first = producer.prepare({ bytes, filename: 'one.pptx' }, stop.signal), rejection = expect(first).rejects.toThrow('取消')
  const canvas = { width: 1280, height: 720 }, second = producer.parse({ bytes, filename: 'two.pptx', canvas })
  bytes[0] = 9; canvas.width = 777
  const firstWindow = windows[0], secondWindow = windows[1], request = ready(secondWindow)
  expect([...request.bytes]).toEqual([4, 5]); expect(request.canvas).toEqual({ width: 1280, height: 720 })
  stop.abort(); await rejection
  expect(firstWindow.isDestroyed()).toBe(true); expect(secondWindow.isDestroyed()).toBe(false)
  const draft = { slides: [{ title: 'Slide', backgroundColor: '#fff', items: [] }], assets: [], issues: [], notes: [] }
  result(secondWindow, { requestId: request.requestId, status: 'converted', mode: 'draft', draft })
  await expect(second).resolves.toBe(draft)
})
it('rejects a converted model with a missing declared resource before any file writer is involved', async () => {
  const producer = new PptxCourseImportProducer('http://127.0.0.1:5173/'), pending = producer.prepare({ bytes: new Uint8Array([1]), filename: 'broken.pptx' })
  const rejected = expect(pending).rejects.toThrow('素材字节缺失'), worker = windows[0], request = ready(worker), converted = model()
  converted.project.assets.missing = { id: 'missing', path: 'assets/missing.png', mimeType: 'image/png', byteLength: 1 }
  result(worker, { requestId: request.requestId, status: 'converted', mode: 'course', course: { model: converted, suggestedName: 'broken.glx', issues: [] } })
  await rejected; expect(worker.isDestroyed()).toBe(true)
})
