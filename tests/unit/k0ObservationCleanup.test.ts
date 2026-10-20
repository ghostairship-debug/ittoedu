// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import { ViewObservationDesktopService } from '../../src/main/workbench/observation/ViewObservationDesktopService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

const state = vi.hoisted(() => ({ windows: [] as any[], clearStorage: vi.fn(async () => undefined), unhandle: vi.fn(),
  load: () => new Promise<void>(() => undefined), execute: async (_source: string): Promise<unknown> => undefined,
  resource: undefined as undefined | ((url: URL, request: Request) => Promise<Response | undefined>) }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false
    readonly contents = Object.assign(new EventEmitter(), { id: 1, setWindowOpenHandler() {}, executeJavaScript: vi.fn((source: string) => state.execute(source)),
      mainFrame: { detached: false, processId: 1, frameToken: 'frame', isDestroyed: () => false } })
    get webContents() {
      if (this.destroyed) throw new TypeError('Object has been destroyed')
      return this.contents
    }
    constructor() { super(); state.windows.push(this) }
    loadURL() { return state.load() }
    setContentSize() {}
    isDestroyed() { return this.destroyed }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
  }
  return { BrowserWindow: Window, session: { fromPartition: () => ({
    protocol: { unhandle: state.unhandle }, clearStorageData: state.clearStorage,
  }) } }
})
vi.mock('../../src/main/protocols', () => ({ installEditorProtocol(_session: unknown, resource: typeof state.resource) { state.resource = resource } }))
vi.mock('../../src/main/security', () => ({ configureRestrictedSession() {} }))
vi.mock('../../src/main/workbench/observation/captureFramePaint', () => ({ waitForCaptureFramePaint: async () => undefined }))

afterEach(() => {
  state.windows.splice(0)
  state.clearStorage.mockClear()
  state.unhandle.mockClear()
  state.load = () => new Promise<void>(() => undefined)
  state.execute = async () => undefined
  state.resource = undefined
  vi.useRealTimers()
})

async function interactive() {
  const project = createBlankCourseProjectV10('Observation fault lifecycle')
  project.surfaces[0]!.id = 'page'
  project.surfaces.push({ id: 'other', kind: 'slide', title: 'Other', childIds: [], designSize: { width: 320, height: 180 } })
  const snapshot = { documentId: 'document', epoch: 'epoch', revision: 0, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } } as any
  const identity = { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: 0, projectId: project.id, locationId: 'page', stateId: null }
  state.load = async () => undefined
  state.execute = async () => ({ locationId: 'page', stateId: null, structure: ['ready'], diagnostics: [] })
  const service = new ViewObservationDesktopService({ rendererEntryUrl: 'courseware-editor://app/index.html', snapshot: async () => snapshot })
  const context = await service.contextForTarget({ runId: 'run', snapshot, identity })
  return { service, context, snapshot, identity }
}

it('rejects an already pending read when its observation host closes, without waiting for the renderer promise', async () => {
  const { service, context } = await interactive()
  state.windows[0].contents.executeJavaScript.mockClear()
  state.execute = () => new Promise(() => undefined)
  const read = service.readState(context), rejected = expect(read).rejects.toThrow('观察宿主已关闭')
  await vi.waitFor(() => expect(state.windows[0].contents.executeJavaScript).toHaveBeenCalledWith('window.__COURSEWARE_OBSERVATION_READ__()'))
  service.releaseContext(context)
  await rejected
  expect(state.windows[0].isDestroyed()).toBe(true)
  expect(state.clearStorage).toHaveBeenCalledOnce()
})

it('ends an unresponsive page selection using the existing local operation fault wait', async () => {
  vi.useFakeTimers()
  const { service, snapshot, identity } = await interactive()
  state.execute = source => source.includes('__COURSEWARE_OBSERVATION_SELECT__') ? new Promise(() => undefined)
    : Promise.resolve({ locationId: 'page', stateId: null, structure: ['ready'], diagnostics: [] })
  const select = service.contextForTarget({ runId: 'run', snapshot, identity: { ...identity, locationId: 'other' } })
  const rejected = expect(select).rejects.toThrow('观察宿主切换无响应')
  await vi.waitFor(() => expect(state.windows[0].contents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('__COURSEWARE_OBSERVATION_SELECT__')))
  await vi.advanceTimersByTimeAsync(20_000)
  await rejected
  expect(state.windows[0].isDestroyed()).toBe(true)
})

it('does not register bootstrap content if the host closed while its request body was arriving', async () => {
  const { service, context } = await interactive()
  let finish!: (html: string) => void
  // Use the live owner's exact bootstrap prefix rather than inventing a separate lease.
  const encoded = /__COURSEWARE_OBSERVATION_RUN__\("([^"]+)"\)/.exec(state.windows[0].contents.executeJavaScript.mock.calls[0][0])![1]
  const input = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  const actual = new URL('component-fixture', input.bootstrapBaseUrl)
  const pending = state.resource!(actual, { method: 'POST', headers: new Headers({ Origin: 'courseware-editor://app' }), text: () => new Promise<string>(resolve => { finish = resolve }) } as Request)
  service.releaseContext(context)
  finish('<!doctype html><p>late source</p>')
  expect((await pending)!.status).toBe(410)
  expect((await state.resource!(actual, new Request(actual)))!.status).toBe(410)
})

it('keeps the observation timeout after destroying its window and still releases its isolated session', async () => {
  vi.useFakeTimers()
  const published: PublishedCourseV3 = {
    schemaVersion: 3, id: 'cleanup-course', title: 'Cleanup', definitions: {}, instances: {}, assets: {},
    surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: [], designSize: { width: 320, height: 180 } }],
    global: { underlay: [], overlay: [] },
  }
  const service = new ViewObservationDesktopService({ rendererEntryUrl: 'courseware-editor://app/index.html' })
  const work = service.capturePublished({ published, locationId: 'page' })
  const rejected = expect(work).rejects.toThrow('观察宿主准备或截图无响应')
  await vi.advanceTimersByTimeAsync(20_000)
  await rejected
  const worker = state.windows[0]
  expect(worker.isDestroyed()).toBe(true)
  expect(worker.contents.listenerCount('render-process-gone')).toBe(0)
  expect(worker.listenerCount('closed')).toBe(0)
  expect(state.unhandle).toHaveBeenCalledWith('courseware-editor')
  expect(state.clearStorage).toHaveBeenCalledOnce()
})
