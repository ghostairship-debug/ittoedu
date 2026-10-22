import { appendRootContainers, setRootContainers, createTestPublishedFromLegacy } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
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
      capturePage: vi.fn(async () => ({ getSize: () => ({ width: 320, height: 180 }), isEmpty: () => false, toPNG: () => new Uint8Array([1, 2, 3]) })),
      mainFrame: { detached: false, processId: 1, frameToken: 'frame', isDestroyed: () => false } })
    get webContents() {
      if (this.destroyed) throw new TypeError('Object has been destroyed')
      return this.contents
    }
    constructor() { super(); state.windows.push(this) }
    loadURL = vi.fn(() => state.load())
    setContentSize = vi.fn()
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
  setRootContainers(project, [{ ...componentSurfaces(project)[0], id: 'page' }])
  appendRootContainers(project, { id: 'other', kind: 'slide', title: 'Other', childIds: [], designSize: { width: 320, height: 180 } })
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
  const payloadUrl = /__COURSEWARE_OBSERVATION_RUN__\("([^"]+)"\)/.exec(state.windows[0].contents.executeJavaScript.mock.calls[0][0])![1]
  const input = await (await state.resource!(new URL(payloadUrl), new Request(payloadUrl)))!.json()
  const actual = new URL('component-fixture', input.bootstrapBaseUrl)
  const pending = state.resource!(actual, { method: 'POST', headers: new Headers({ Origin: 'courseware-editor://app' }), text: () => new Promise<string>(resolve => { finish = resolve }) } as Request)
  service.releaseContext(context)
  finish('<!doctype html><p>late source</p>')
  expect((await pending)!.status).toBe(410)
  expect((await state.resource!(actual, new Request(actual)))!.status).toBe(410)
})

it('keeps the observation timeout after destroying its window and still releases its isolated session', async () => {
  vi.useFakeTimers()
  const published: PublishedCourseV3 = createTestPublishedFromLegacy({
    schemaVersion: 3, id: 'cleanup-course', title: 'Cleanup', definitions: {}, instances: {}, assets: {},
    surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: [], designSize: { width: 320, height: 180 } }],
    global: { underlay: [], overlay: [] },
  })
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

it('reads the private payload by nonce URL without putting publication content into evaluated JavaScript', async () => {
  const { service, context, snapshot } = await interactive()
  const source = state.windows[0].contents.executeJavaScript.mock.calls[0][0] as string
  const payloadUrl = /__COURSEWARE_OBSERVATION_RUN__\("([^"]+)"\)/.exec(source)![1]
  expect(source.length).toBeLessThan(512)
  expect(source).not.toContain(snapshot.model.project.title)
  expect((await state.resource!(new URL(payloadUrl), new Request(payloadUrl, { headers: { Origin: 'https://foreign.invalid' } })))!.status).toBe(403)
  const response = (await state.resource!(new URL(payloadUrl), new Request(payloadUrl)))!
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect((await response.json()).published.id).toBe(snapshot.model.project.id)
  service.releaseContext(context)
  expect((await state.resource!(new URL(payloadUrl), new Request(payloadUrl)))!.status).toBe(410)
})

function exportPublication(): PublishedCourseV3 {
  return createTestPublishedFromLegacy({ schemaVersion: 3, id: 'capture-job-course', title: 'Capture job', definitions: {}, instances: {}, assets: {},
    surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: [], designSize: { width: 320, height: 180 } },
      { id: 'other', kind: 'spatial', title: 'Other', childIds: [], designSize: { width: 640, height: 360 } }], global: { underlay: [], overlay: [] } })
}

it('reuses one hidden window inside a capture job while sending every target through a fresh render', async () => {
  state.load = async () => undefined
  const inputs: any[] = []
  state.execute = async source => {
    const payloadUrl = /__COURSEWARE_OBSERVATION_RUN__\("([^"]+)"\)/.exec(source)![1]
    const input = await (await state.resource!(new URL(payloadUrl), new Request(payloadUrl)))!.json()
    inputs.push(input)
    return { locationId: input.locationId, stateId: input.stateId, structure: [input.locationId], diagnostics: [] }
  }
  const service = new ViewObservationDesktopService({ rendererEntryUrl: 'courseware-editor://app/index.html' })
  const published = exportPublication(), job = service.createPublishedCaptureJob()
  try {
    await job.capture({ published, locationId: 'page', instanceId: 'target', stateId: null, staticExport: true })
    await job.capture({ published, locationId: 'other', spatialFrameId: 'camera', stateId: 'state', staticExport: true })
    expect(state.windows).toHaveLength(1)
    expect(state.windows[0].loadURL).toHaveBeenCalledOnce()
    expect(state.windows[0].setContentSize).toHaveBeenLastCalledWith(640, 360)
    expect(inputs.map(input => [input.locationId, input.stateId, input.instanceId, input.spatialFrameId, input.staticExport])).toEqual([
      ['page', null, 'target', undefined, true], ['other', 'state', undefined, 'camera', true],
    ])
  } finally { await job.close() }
  expect(state.windows[0].isDestroyed()).toBe(true)
  const otherJob = service.createPublishedCaptureJob()
  try { await otherJob.capture({ published, locationId: 'page' }); expect(state.windows).toHaveLength(2) }
  finally { await otherJob.close() }
})

it('cancels the active reset and queued captures when their export job stops', async () => {
  state.load = async () => undefined
  state.execute = async () => ({ locationId: 'page', stateId: null, structure: [], diagnostics: [] })
  const service = new ViewObservationDesktopService({ rendererEntryUrl: 'courseware-editor://app/index.html' })
  const controller = new AbortController(), job = service.createPublishedCaptureJob(controller.signal), published = exportPublication()
  await job.capture({ published, locationId: 'page' })
  state.execute = () => new Promise(() => undefined)
  const resetting = job.capture({ published, locationId: 'page' }), resetFailure = expect(resetting).rejects.toThrow(/观察已取消|观察宿主已关闭/)
  const queued = job.capture({ published, locationId: 'other' }), queueFailure = expect(queued).rejects.toThrow('输出捕获已结束')
  await vi.waitFor(() => expect(state.windows[0].contents.executeJavaScript).toHaveBeenCalledTimes(2))
  controller.abort()
  await Promise.all([resetFailure, queueFailure, job.close()])
  expect(state.windows).toHaveLength(1)
  expect(state.windows[0].isDestroyed()).toBe(true)
  expect(state.clearStorage).toHaveBeenCalledOnce()
})
