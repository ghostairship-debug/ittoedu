// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { ViewObservationDesktopService } from '../../src/main/workbench/observation/ViewObservationDesktopService'
import { TaskHtmlPreview } from '../../src/main/workbench/observation/TaskHtmlPreview'
import { HtmlPreviewUnavailableError } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { DynamicContentFallbackCaptureService } from '../../src/main/workbench/observation/DynamicContentFallbackCaptureService'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { discoverDynamicContentTargets } from '../../src/core/tools/DynamicContentEditPlanner'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

const state = vi.hoisted(() => ({ windows: [] as any[], load: async () => undefined as void,
  execute: async (_source: string) => ({ locationId: 'page', structure: ['ready'], diagnostics: [] }) as unknown }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), { id: 1, setWindowOpenHandler() {},
      executeJavaScript: (source: string) => state.execute(source),
      mainFrame: { detached: false, processId: 1, frameToken: 'frame',
        executeJavaScript: (source: string) => state.execute(source),
        framesInSubtree: [{ detached: false, executeJavaScript: async () => undefined }] },
      capturePage: async () => ({ getSize: () => ({ width: 1280, height: 720 }), isEmpty: () => false,
        toPNG: () => Buffer.from('png') }),
    })
    constructor() { super(); state.windows.push(this) }
    loadURL() { return state.load() }
    isDestroyed() { return this.destroyed }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
  }
  return { BrowserWindow: Window, session: { fromPartition: () => ({ protocol: { handle() {}, unhandle() {} },
    clearStorageData: async () => undefined }) } }
})
vi.mock('../../src/main/protocols', () => ({ installEditorProtocol() {}, HTML_PREVIEW_SCHEME: 'courseware-html-preview' }))
vi.mock('../../src/main/security', () => ({ configureRestrictedSession() {}, hardenWebContents() {},
  isAllowedHtmlPreviewFrameUrl: () => true, isAllowedHtmlPreviewChildFrameUrl: () => true }))
vi.mock('sharp', () => ({ default: () => ({ metadata: async () => ({ format: 'png', width: 100, height: 100 }),
  raw: () => ({ toBuffer: async () => Buffer.from('pixels') }) }) }))
vi.mock('../../src/main/workbench/htmlPreview/HtmlPreviewService', () => {
  class Unavailable extends Error { constructor(readonly reason: string) { super('missing') } }
  class Preview {
    handleProtocolRequest() {}
    async open() { return { leaseId: 'lease', loadId: 'load', url: 'courseware-html-preview://app/page' } }
    async automationContext() { return { lease: { leaseId: 'lease', loadId: 'load' }, webContentsId: 1, tabId: 'task', bindingPath: 'lesson.html' } }
    dispose() {}
  }
  return { HtmlPreviewService: Preview, HtmlPreviewUnavailableError: Unavailable }
})

afterEach(() => {
  for (const window of state.windows.splice(0)) window.destroy()
  state.load = async () => undefined
  state.execute = async () => ({ locationId: 'page', structure: ['ready'], diagnostics: [] })
  vi.useRealTimers()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const identity = { documentId: 'document', epoch: 'epoch', revision: 0, locationId: 'page', viewGeneration: 'view-1' }
const project = createBlankCourseProjectV10('Observation lifecycle')
project.surfaces[0]!.id = identity.locationId
const snapshot = { model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } } as any
function fallbackInput() {
  const candidate = new CourseV9Driver().load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/surface-runtime.h5lesson')))
  if (candidate.kind !== 'course-v9') throw new Error('Fixture is not a course')
  const current = { documentId: 'document', epoch: 'epoch', revision: candidate.project.revision, model: candidate,
    binding: { kind: 'untitled', suggestedName: 'fixture.h5lesson' }, dirty: false, saving: false, recoverable: true,
    undoDepth: 0, redoDepth: 0 } as DocumentSnapshot
  const target = discoverDynamicContentTargets(current, { target: { kind: 'course-object', locationId: 'location-scene-1',
    itemId: 'slide-surface-runtime' } }).find(value => value.field.kind === 'runtime.value')
  if (!target) throw new Error('Fixture target missing')
  return { runId: 'run', documentId: 'document', target, candidate }
}

it('lets an isolated observation finish after healthy loading within the local operation fault wait', async () => {
  const load = deferred<void>()
  state.load = () => load.promise
  vi.useFakeTimers()
  const service = new ViewObservationDesktopService({ rendererEntryUrl: 'http://localhost:5173/index.html' })
  let settled = false
  const work = service.captureIsolated({ identity, snapshot }).then(result => { settled = true; return result })
  await vi.advanceTimersByTimeAsync(10_000)
  expect(settled).toBe(false)
  expect(state.windows[0].destroyed).toBe(false)
  load.resolve()
  expect(await work).toMatchObject({ identity, width: 1280, structure: ['ready'] })
  expect(state.windows[0].destroyed).toBe(true)
})

it('cancels an isolated observation promptly when its owning task aborts', async () => {
  state.load = () => new Promise(() => undefined)
  const controller = new AbortController()
  const service = new ViewObservationDesktopService({ rendererEntryUrl: 'http://localhost:5173/index.html' })
  const work = service.captureIsolated({ identity, snapshot, signal: controller.signal })
  const rejected = expect(work).rejects.toThrow('观察已取消')
  await vi.waitFor(() => expect(state.windows).toHaveLength(1))
  controller.abort()
  await rejected
  expect(state.windows[0].destroyed).toBe(true)
})

it('reports a genuinely unresponsive isolated observation operation', async () => {
  state.load = () => new Promise(() => undefined)
  vi.useFakeTimers()
  const service = new ViewObservationDesktopService({ rendererEntryUrl: 'http://localhost:5173/index.html' })
  const work = service.captureIsolated({ identity, snapshot })
  const rejected = expect(work).rejects.toThrow('观察宿主准备或截图无响应')
  await vi.waitFor(() => expect(state.windows).toHaveLength(1))
  await vi.advanceTimersByTimeAsync(20_000)
  await rejected
  expect(state.windows[0].destroyed).toBe(true)
})

it.each(['closed', 'render-process-gone'])('ends pending observation on actual %s', async event => {
  state.load = () => new Promise(() => undefined)
  const service = new ViewObservationDesktopService({ rendererEntryUrl: 'http://localhost:5173/index.html' })
  const work = service.captureIsolated({ identity, snapshot })
  const rejected = expect(work).rejects.toThrow(event === 'closed' ? '已关闭' : '异常退出')
  await vi.waitFor(() => expect(state.windows).toHaveLength(1))
  if (event === 'closed') state.windows[0].destroy()
  else state.windows[0].webContents.emit(event)
  await rejected
  expect(state.windows[0].destroyed).toBe(true)
})

it('keeps an awaiting task HTML preview alive within its load fault wait and closes it on explicit task release', async () => {
  const entered = deferred<void>()
  state.execute = () => { entered.resolve(); return new Promise(() => undefined) }
  const preview = new TaskHtmlPreview({ live: { automationContextForDocument: async () => { throw new HtmlPreviewUnavailableError('missing') } } as any,
    readDocument: async () => ({ documentId: 'document', epoch: 'epoch', revision: 0,
      binding: { kind: 'file', bindingVersion: 1, path: 'lesson.html' } }) as DocumentSnapshot,
    agentBundlePath: 'fixture' })
  vi.useFakeTimers()
  const work = preview.automationContextForDocument({ documentId: 'document', epoch: 'epoch', revision: 0, runId: 'run' })
  let settled = false
  void work.then(() => { settled = true }, () => { settled = true })
  await entered.promise
  await vi.advanceTimersByTimeAsync(10_000)
  expect(settled).toBe(false)
  expect(state.windows[0].destroyed).toBe(false)
  const rejected = expect(work).rejects.toThrow('HTML 任务预览已关闭')
  preview.releaseRun('run')
  await rejected
  expect(state.windows[0].destroyed).toBe(true)
})

it('allows an exact-layer fallback capture to complete after healthy loading within the local operation fault wait', async () => {
  const input = fallbackInput(), load = deferred<void>()
  state.load = () => load.promise
  state.execute = async source => {
    const encoded = JSON.parse(source.slice(source.indexOf('(') + 1, -1))
    const request = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    return { ...request, dataUrl: 'data:image/png;base64,cG5n' }
  }
  const service = new DynamicContentFallbackCaptureService({ rendererEntryUrl: () => 'http://localhost:5173/index.html' })
  vi.useFakeTimers()
  let settled = false
  const work = service.capture(input).then(result => { settled = true; return result })
  await vi.advanceTimersByTimeAsync(10_000)
  expect(settled).toBe(false)
  expect(state.windows[0].destroyed).toBe(false)
  load.resolve()
  expect(await work).toMatchObject({ asset: { mimeType: 'image/png', width: 100, height: 100 }, bytes: Uint8Array.from(Buffer.from('png')) })
  expect(state.windows[0].destroyed).toBe(true)
})

it('cancels an exact-layer fallback capture when its task explicitly stops', async () => {
  state.load = () => new Promise(() => undefined)
  const service = new DynamicContentFallbackCaptureService({ rendererEntryUrl: () => 'http://localhost:5173/index.html' })
  const work = service.capture(fallbackInput())
  const rejected = expect(work).rejects.toThrow('动态图文截图已取消')
  service.stopRun('run')
  await rejected
  expect(state.windows[0].destroyed).toBe(true)
})

it('reports a genuinely unresponsive exact-layer fallback operation', async () => {
  state.load = () => new Promise(() => undefined)
  vi.useFakeTimers()
  const service = new DynamicContentFallbackCaptureService({ rendererEntryUrl: () => 'http://localhost:5173/index.html' })
  const work = service.capture(fallbackInput())
  const rejected = expect(work).rejects.toThrow('候选图层截图宿主无响应')
  await vi.advanceTimersByTimeAsync(20_000)
  await rejected
  expect(state.windows[0].destroyed).toBe(true)
})

it('reports an unresponsive task HTML iframe from its actual load callback script', async () => {
  const entered = deferred<void>()
  const frame = { title: '', referrerPolicy: '', style: { cssText: '' }, src: '', setAttribute() {},
    remove: vi.fn(), onload: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined }
  state.execute = source => {
    entered.resolve()
    return new Function('document', `return (${source})`)({ createElement: () => frame, body: { append() {} } })
  }
  const preview = new TaskHtmlPreview({ live: { automationContextForDocument: async () => { throw new HtmlPreviewUnavailableError('missing') } } as any,
    readDocument: async () => ({ documentId: 'document', epoch: 'epoch', revision: 0,
      binding: { kind: 'file', bindingVersion: 1, path: 'lesson.html' } }) as DocumentSnapshot,
    agentBundlePath: 'fixture' })
  vi.useFakeTimers()
  const work = preview.automationContextForDocument({ documentId: 'document', epoch: 'epoch', revision: 0, runId: 'run' })
  const rejected = expect(work).rejects.toThrow('HTML 任务预览无响应')
  await entered.promise
  await vi.advanceTimersByTimeAsync(15_000)
  await rejected
  expect(frame.remove).toHaveBeenCalledOnce()
  expect(state.windows[0].destroyed).toBe(true)
})
