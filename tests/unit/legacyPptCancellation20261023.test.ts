// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { operateLegacyPpt } from '../../src/main/pptImportService'

const ports = vi.hoisted(() => ({ select: vi.fn(), resave: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => 'temporary' }, dialog: { showOpenDialog: ports.select } }))
vi.mock('../../src/main/pptResave', () => ({ resaveLegacyPpt: ports.resave }))

beforeEach(() => { ports.select.mockReset(); ports.resave.mockReset() })

it('acknowledges legacy cancellation only after the original conversion has finished cleanup', async () => {
  const window = Object.assign(new EventEmitter(), { id: 20261023 }) as unknown as BrowserWindow
  let finish!: (value: Uint8Array) => void, signal!: AbortSignal
  ports.select.mockResolvedValue({ canceled: false, filePaths: ['original.ppt'] })
  ports.resave.mockImplementation((_source, _temporary, options) => {
    signal = options.signal
    return new Promise<Uint8Array>(resolve => { finish = resolve })
  })
  const original = operateLegacyPpt(window, { operation: 'select' })
  await vi.waitFor(() => expect(ports.resave).toHaveBeenCalledOnce())
  let acknowledged = false
  const cancelled = operateLegacyPpt(window, { operation: 'cancel' }).then(value => { acknowledged = true; return value })
  await Promise.resolve()
  expect(signal.aborted).toBe(true)
  expect(acknowledged).toBe(false)
  await expect(operateLegacyPpt(window, { operation: 'select' })).rejects.toThrow('正在转换')

  // This represents the current shared COM call returning and its finally
  // completing. A late successful buffer must not escape the cancelled job.
  finish(new Uint8Array([80, 75]))
  await expect(original).resolves.toBeNull()
  await expect(cancelled).resolves.toBeNull()
  expect(acknowledged).toBe(true)
  expect(window.listenerCount('closed')).toBe(0)

  ports.select.mockResolvedValue({ canceled: true, filePaths: [] })
  await expect(operateLegacyPpt(window, { operation: 'select' })).resolves.toBeNull()
})

it('treats the original cancellation rejection as cancellation, while ordinary conversion failures remain errors', async () => {
  const window = Object.assign(new EventEmitter(), { id: 20261024 }) as unknown as BrowserWindow
  ports.select.mockResolvedValue({ canceled: false, filePaths: ['original.ppt'] })
  ports.resave.mockImplementation((_source, _temporary, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('已取消 PPT 转换')), { once: true })
  }))
  const original = operateLegacyPpt(window, { operation: 'select' })
  await vi.waitFor(() => expect(ports.resave).toHaveBeenCalledOnce())
  await expect(operateLegacyPpt(window, { operation: 'cancel' })).resolves.toBeNull()
  await expect(original).resolves.toBeNull()

  ports.resave.mockRejectedValue(new Error('真实转换失败'))
  await expect(operateLegacyPpt(window, { operation: 'select' })).rejects.toThrow('真实转换失败')
})
