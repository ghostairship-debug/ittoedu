// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import { ViewObservationDesktopService } from '../../src/main/workbench/observation/ViewObservationDesktopService'

const state = vi.hoisted(() => ({ windows: [] as any[], clearStorage: vi.fn(async () => undefined), unhandle: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false
    readonly contents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, executeJavaScript: vi.fn() })
    get webContents() {
      if (this.destroyed) throw new TypeError('Object has been destroyed')
      return this.contents
    }
    constructor() { super(); state.windows.push(this) }
    loadURL() { return new Promise<void>(() => undefined) }
    isDestroyed() { return this.destroyed }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
  }
  return { BrowserWindow: Window, session: { fromPartition: () => ({
    protocol: { unhandle: state.unhandle }, clearStorageData: state.clearStorage,
  }) } }
})
vi.mock('../../src/main/protocols', () => ({ installEditorProtocol() {} }))
vi.mock('../../src/main/security', () => ({ configureRestrictedSession() {} }))

afterEach(() => {
  state.windows.splice(0)
  state.clearStorage.mockClear()
  state.unhandle.mockClear()
  vi.useRealTimers()
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
