// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'

const mocked = vi.hoisted(() => ({ message: vi.fn(), ipc: undefined as unknown as EventEmitter }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  mocked.ipc = new EventEmitter()
  return { dialog: { showMessageBox: mocked.message }, ipcMain: mocked.ipc }
})
vi.mock('../../src/main/workbench/execution/ExecutionDesktopService', () => ({ executionDesktopService: async () => ({ writableTasksForDocument: async () => ({ runIds: [], submissionIds: [] }) }) }))
vi.mock('../../src/main/workbench/external/externalDesktopService', () => ({ externalMcpService: async () => ({ writableSessionsForDocument: () => [] }) }))
vi.mock('../../src/main/workbench/documentSaveDialog', () => ({ saveDocumentWithDialog: vi.fn() }))
import { closeDocumentWithDialog } from '../../src/main/workbench/documentCloseDialog'

afterEach(() => { mocked.ipc.removeAllListeners(); vi.useRealTimers() })
it('honors cancel from an already displayed wait dialog even when renderer readiness arrives first', async () => {
  vi.useFakeTimers()
  let choose!: (value: { response: number }) => void
  mocked.message.mockImplementation(() => new Promise(resolve => { choose = resolve }))
  const send = vi.fn(), contents = Object.assign(new EventEmitter(), { send })
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false }) as unknown as BrowserWindow
  const operate = vi.fn(), snapshot = { documentId: 'slow', epoch: 'epoch', revision: 0, dirty: false }
  const host = { registry: { get: () => ({ drain: async () => snapshot }) }, tools: { withWriteTaskBarrier: async (_ids: string[], work: () => Promise<unknown>) => work() }, operate } as unknown as DocumentHostService
  let settled = false
  const closing = closeDocumentWithDialog(window, host, 'slow').then(value => { settled = true; return value })
  await vi.advanceTimersByTimeAsync(3000)
  expect(mocked.message).toHaveBeenCalledOnce()
  const request = send.mock.calls.find(([channel]) => channel === IPC_CHANNELS.requestPreserveAndClose)!
  mocked.ipc.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: contents }, request[1], true)
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toBe(false)
  expect(operate).not.toHaveBeenCalled()
  choose({ response: 1 })
  expect(await closing).toBe(false)
  expect(operate).not.toHaveBeenCalled()
  expect(send).toHaveBeenLastCalledWith(IPC_CHANNELS.requestResumeClose, ['slow'])
})
