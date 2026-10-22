import { beforeEach, expect, it, vi } from 'vitest'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'

const observed = vi.hoisted(() => ({ windows: 0, executions: [] as ((result: unknown) => void)[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Contents extends EventEmitter {
    setWindowOpenHandler() {}
    executeJavaScript() { return new Promise(resolve => observed.executions.push(resolve)) }
  }
  class Window extends EventEmitter {
    webContents = new Contents(); destroyed = false
    constructor() { super(); observed.windows++ }
    loadURL() { return Promise.resolve() }
    isDestroyed() { return this.destroyed }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed') }
  }
  return { app: { whenReady: () => Promise.resolve() }, BrowserWindow: Window, session: {
    fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } }),
  } }
})
import { createElectronNativeTextMeasurement } from '../../src/main/workbench/nativeText/ElectronNativeTextMeasurement'

beforeEach(() => { observed.windows = 0; observed.executions.length = 0 })
const spec = () => { const node = createTextNode({ text: '本次测量', width: 180 }); return { node, width: node.width, axis: 'height' as const } }
const result = { measurementMode: 'browser-canvas', requiredWidth: 180, requiredHeight: 36 }

it('removes a cancelled waiting measurement immediately without disturbing the active reused window', async () => {
  const host = createElectronNativeTextMeasurement({ rendererURL: 'http://127.0.0.1/native-text-measurement.html' })
  try {
    const first = host.measure(spec())
    await vi.waitFor(() => expect(observed.executions).toHaveLength(1))
    const controller = new AbortController(), second = host.measure(spec(), { signal: controller.signal })
    controller.abort(new Error('cancel queued only'))
    await expect(second).rejects.toThrow('cancel queued only')
    expect(observed.windows).toBe(1)
    observed.executions[0]!(result)
    await expect(first).resolves.toEqual(result)
    const third = host.measure(spec())
    await vi.waitFor(() => expect(observed.executions).toHaveLength(2))
    expect(observed.windows).toBe(1)
    observed.executions[1]!(result)
    await expect(third).resolves.toEqual(result)
  } finally { host.dispose() }
})

it('ends both active and queued callers when their measurement owner is disposed', async () => {
  const host = createElectronNativeTextMeasurement({ rendererURL: 'http://127.0.0.1/native-text-measurement.html' })
  const active = host.measure(spec()), activeResult = expect(active).rejects.toThrow('文字测量宿主已关闭')
  await vi.waitFor(() => expect(observed.executions).toHaveLength(1))
  const waiting = host.measure(spec()), waitingResult = expect(waiting).rejects.toThrow('文字测量宿主已关闭')
  host.dispose()
  await Promise.all([activeResult, waitingResult])
  expect(observed.executions).toHaveLength(1)
})
