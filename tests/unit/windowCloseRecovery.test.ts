// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../src/main/appState'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'

const controls = vi.hoisted(() => ({ choice: 1, dirty: true, clearRecovery: vi.fn(async () => undefined) }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWindow extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      executeJavaScript: vi.fn(async () => controls.dirty),
      send: vi.fn(),
      mainFrame: { detached: false, send: vi.fn() },
    })
    loadURL = vi.fn(async () => undefined)
    show = vi.fn()
    isDestroyed() { return this.destroyed }
    close = vi.fn(() => {
      let prevented = false
      this.emit('close', { preventDefault() { prevented = true } })
      if (!prevented) { this.destroyed = true; this.emit('closed') }
    })
  }
  return { app: { isPackaged: true, getAppPath: () => process.cwd() }, BrowserWindow: FakeWindow,
    dialog: { showMessageBoxSync: vi.fn(() => controls.choice) }, ipcMain: new EventEmitter(), session: { defaultSession: {} } }
})
vi.mock('../../src/main/security', () => ({ configureRestrictedSession: vi.fn(), hardenWebContents: vi.fn(), isAllowedDocumentUrl: vi.fn(), isAllowedEditorPreviewFrameUrl: vi.fn() }))
vi.mock('../../src/main/protocols', () => ({ editorEntryUrl: () => 'courseware://editor/index.html' }))
vi.mock('../../src/main/projectPersistence', () => ({ clearRecoveryProject: controls.clearRecovery }))
vi.mock('../../src/main/previewNetworkPolicy', () => ({ mainPreviewNetworkPolicy: { replaceBaseOrigins: vi.fn(), beginDocumentNavigation: vi.fn(), allowsRequest: vi.fn(), activateDocument: vi.fn() } }))
vi.mock('../../src/main/windowVisibility', () => ({ BACKGROUND_E2E_WINDOW_ORIGIN: -10000, shouldShowApplicationWindows: () => false }))

import { ipcMain } from 'electron'
import { createMainWindow } from '../../src/main/createWindow'

async function openWindow() {
  const state = { attachWindow: vi.fn(), detachWindow: vi.fn(), isDirty: () => controls.dirty, setDirty: vi.fn() }
  const { window } = await createMainWindow(state as unknown as AppState)
  return { window, state }
}
function requestId(window: { webContents: { send: unknown } }): string { return vi.mocked(window.webContents.send as (...args: unknown[]) => void).mock.calls.at(-1)?.[1] as string }
async function settle() { await vi.advanceTimersByTimeAsync(0) }
beforeEach(() => { vi.useFakeTimers(); controls.choice = 1; controls.dirty = true; controls.clearRecovery.mockClear() })
afterEach(() => { ipcMain.removeAllListeners(); vi.useRealTimers() })

describe('window close recovery handshake', () => {
  it('requires the matching renderer preserve success before discard closes or clears project recovery', async () => {
    const { window, state } = await openWindow()
    window.close()
    await settle()
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.requestPreserveAndClose, expect.any(String))
    expect(window.isDestroyed()).toBe(false)
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: {} }, requestId(window), true)
    ipcMain.emit(IPC_CHANNELS.saveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(true)
    expect(controls.clearRecovery).toHaveBeenCalledTimes(1)
    expect(state.setDirty).toHaveBeenCalledWith(false)
    expect(ipcMain.listenerCount(IPC_CHANNELS.preserveAndCloseResult)).toBe(0)
  })
  it.each([false, 'true', null])('keeps the window and recovery on unsuccessful preserve result %s', async result => {
    const { window, state } = await openWindow()
    window.close(); await settle()
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), result)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    expect(state.setDirty).not.toHaveBeenCalled()
    expect(ipcMain.listenerCount(IPC_CHANNELS.preserveAndCloseResult)).toBe(0)
  })
  it('times out without closing and ignores a late result until a fresh request', async () => {
    const { window } = await openWindow()
    window.close(); await settle()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(window.isDestroyed()).toBe(false)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    expect(ipcMain.listenerCount(IPC_CHANNELS.preserveAndCloseResult)).toBe(0)
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    window.close(); await settle()
    expect(window.webContents.send).toHaveBeenCalledTimes(2)
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(true)
  })
  it.each(['preserve', 'save'] as const)('rejects a timed-out %s success after a newer close has started', async mode => {
    controls.choice = mode === 'save' ? 0 : 1
    const resultChannel = mode === 'save' ? IPC_CHANNELS.saveAndCloseResult : IPC_CHANNELS.preserveAndCloseResult
    const { window } = await openWindow()
    window.close(); await settle()
    const oldRequestId = requestId(window)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    window.close(); await settle()
    const currentRequestId = requestId(window)
    expect(currentRequestId).not.toBe(oldRequestId)
    ipcMain.emit(resultChannel, { sender: window.webContents }, oldRequestId, true)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    ipcMain.emit(resultChannel, { sender: window.webContents }, currentRequestId, true)
    await settle()
    expect(window.isDestroyed()).toBe(true)
  })
  it('also preserves drafts on an apparently clean close', async () => {
    controls.dirty = false
    const { window } = await openWindow()
    window.close(); await settle()
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.requestPreserveAndClose, expect.any(String))
    expect(window.isDestroyed()).toBe(false)
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(true)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
  })
  it('retains the save handshake and only closes after save success', async () => {
    controls.choice = 0
    const { window } = await openWindow()
    window.close(); await settle()
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.requestSaveAndClose, expect.any(String))
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    ipcMain.emit(IPC_CHANNELS.saveAndCloseResult, { sender: window.webContents }, requestId(window), false)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    window.close(); await settle()
    ipcMain.emit(IPC_CHANNELS.saveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(true)
  })
})
