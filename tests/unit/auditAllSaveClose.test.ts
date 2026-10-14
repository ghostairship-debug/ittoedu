// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'
vi.mock('electron', async () => { const { EventEmitter } = await import('node:events'); return { ipcMain: new EventEmitter(), dialog: {} } })
vi.mock('../../src/main/workbench/execution/ExecutionDesktopService', () => ({ executionDesktopService: vi.fn() }))
vi.mock('../../src/main/workbench/external/externalDesktopService', () => ({ externalMcpService: vi.fn() }))
vi.mock('../../src/main/workbench/documentSaveDialog', () => ({ saveDocumentWithDialog: vi.fn() }))
import { ipcMain } from 'electron'
import { requestRendererBeforeClose } from '../../src/main/workbench/documentCloseDialog'

describe('CA173 renderer close ownership', () => {
  it.each(['render-process-gone', 'did-start-navigation'])('settles false and cleans listeners when the renderer ends by %s', async event => {
    const webContents = Object.assign(new EventEmitter(), { send: vi.fn() }), window = Object.assign(new EventEmitter(), { webContents })
    const controller = new AbortController()
    const pending = requestRendererBeforeClose(window as any, 'save', controller.signal)
    if (event === 'did-start-navigation') webContents.emit(event, {}, 'app://editor', false, true)
    else webContents.emit(event, {}, { reason: 'crashed' })
    expect(await pending).toEqual({ ready: false, dirty: false })
    expect(ipcMain.listenerCount(IPC_CHANNELS.saveAndCloseResult)).toBe(0)
    expect(webContents.listenerCount('render-process-gone')).toBe(0)
    expect(webContents.listenerCount('did-start-navigation')).toBe(0)
    expect(window.listenerCount('closed')).toBe(0)
  })
  it('keeps an in-page navigation waiting for its ordinary renderer result', async () => {
    const webContents = Object.assign(new EventEmitter(), { send: vi.fn() }), window = Object.assign(new EventEmitter(), { webContents })
    const controller = new AbortController(), pending = requestRendererBeforeClose(window as any, 'save', controller.signal)
    webContents.emit('did-start-navigation', {}, 'app://editor#section', true, true)
    expect(ipcMain.listenerCount(IPC_CHANNELS.saveAndCloseResult)).toBe(1)
    const requestId = webContents.send.mock.calls[0]![1]
    ipcMain.emit(IPC_CHANNELS.saveAndCloseResult, { sender: webContents }, requestId, true)
    expect(await pending).toEqual({ ready: true, dirty: false })
  })
})
