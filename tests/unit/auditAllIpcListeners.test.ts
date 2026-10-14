// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IpcMain, IpcMainEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { installDocumentExportBuildListeners } from '../../src/main/workbench/delivery/DocumentExportBuildListeners'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'

it('CA080 GUI promotion/reinstall/disposal preserves pending worker progress and reply listeners', async () => {
  const events = new EventEmitter(), ipc = events as unknown as Pick<IpcMain, 'on' | 'removeListener'>
  const workerProgress = vi.fn(), firstGuiProgress = vi.fn(), nextGuiProgress = vi.fn(), nextGuiReply = vi.fn()
  const reply = new Promise<unknown>(resolve => events.once(IPC_CHANNELS.documentExportBuildReply, (_event, raw) => resolve(raw)))
  events.on(IPC_CHANNELS.documentExportBuildProgress, workerProgress)
  const first = installDocumentExportBuildListeners(ipc, { progress: firstGuiProgress, reply() {} })
  first()
  const next = installDocumentExportBuildListeners(ipc, { progress: nextGuiProgress, reply: nextGuiReply })
  const event = { sender: { id: 42 } } as IpcMainEvent
  events.emit(IPC_CHANNELS.documentExportBuildProgress, event, { requestId: 'pending', phase: 'rendering' })
  expect(workerProgress).toHaveBeenCalledTimes(1); expect(firstGuiProgress).not.toHaveBeenCalled()
  expect(nextGuiProgress).toHaveBeenCalledTimes(1)
  next()
  events.emit(IPC_CHANNELS.documentExportBuildReply, event, { requestId: 'pending', status: 'completed' })
  expect(await reply).toEqual({ requestId: 'pending', status: 'completed' })
  expect(nextGuiReply).not.toHaveBeenCalled()
})
