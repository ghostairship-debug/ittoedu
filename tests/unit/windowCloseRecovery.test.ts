// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../src/main/appState'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'

type MessageBoxArguments = [Electron.MessageBoxOptions] | [Electron.BrowserWindow, Electron.MessageBoxOptions]

const controls = vi.hoisted(() => ({
  choice: 1, recoveryChoice: 0, dirty: true, crashed: false,
  documents: [] as DocumentSnapshot[], order: [] as string[], barrierDepth: 0, maxBarrierDepth: 0,
  stopExecution: vi.fn(), stopExternal: vi.fn(), operate: vi.fn(),
  clearRecovery: vi.fn(async () => undefined), clearFrames: vi.fn(), releaseLeases: vi.fn(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const os = await import('node:os')
  class FakeWindow extends EventEmitter {
    destroyed = false
    private contents = Object.assign(new EventEmitter(), {
      id: 7,
      isCrashed: () => controls.crashed,
      executeJavaScript: vi.fn(async () => controls.dirty),
      send: vi.fn(),
      mainFrame: { detached: false, send: vi.fn() },
    })
    get webContents() { if (this.destroyed) throw new Error('Object has been destroyed'); return this.contents }
    loadURL = vi.fn(async () => undefined)
    show = vi.fn()
    setProgressBar = vi.fn()
    focus = vi.fn()
    isDestroyed() { return this.destroyed }
    close = vi.fn(() => {
      let prevented = false
      this.emit('close', { preventDefault() { prevented = true } })
      if (!prevented) { this.destroyed = true; this.emit('closed') }
    })
  }
  return { app: { isPackaged: true, getAppPath: () => process.cwd(), getPath: () => (os.tmpdir()) }, BrowserWindow: FakeWindow,
    dialog: { showMessageBox: vi.fn(async (_window, options) => ({ response: options.title === '保存未完成的修改？' ? controls.choice : controls.recoveryChoice, checkboxChecked: false })) }, ipcMain: new EventEmitter(), session: { defaultSession: {} } }
})
vi.mock('../../src/main/security', () => ({ configureRestrictedSession: vi.fn(), hardenWebContents: vi.fn(), isAllowedDocumentUrl: vi.fn(), isAllowedEditorPreviewFrameUrl: vi.fn(), isAllowedHtmlPreviewFrameUrl: vi.fn(), isAllowedHtmlPreviewChildFrameUrl: vi.fn(), clearHtmlPreviewFrameEntries: controls.clearFrames }))
vi.mock('../../src/main/ipc', () => ({ releaseAllHtmlPreviewLeases: controls.releaseLeases }))
vi.mock('../../src/main/protocols', () => ({ editorEntryUrl: () => 'courseware://editor/index.html' }))
vi.mock('../../src/main/projectPersistence', () => ({ clearRecoveryProject: controls.clearRecovery }))
vi.mock('../../src/main/previewNetworkPolicy', () => ({ mainPreviewNetworkPolicy: { replaceBaseOrigins: vi.fn(), beginDocumentNavigation: vi.fn(), allowsRequest: vi.fn(), activateDocument: vi.fn() } }))
vi.mock('../../src/main/windowVisibility', () => ({ BACKGROUND_E2E_WINDOW_ORIGIN: -10000, shouldShowApplicationWindows: () => false }))

import { ipcMain, dialog } from 'electron'
vi.mock('../../src/main/workbench/documentHost', () => ({
  documentHost: () => ({
    registry: { list: () => controls.documents, get: (id: string) => ({ drain: async () => { controls.order.push('drain'); return controls.documents.find(document => document.documentId === id) } }) },
    tools: { withWriteTaskBarrier: async (_ids: string[], work: () => Promise<unknown>) => {
      controls.order.push('barrier-enter')
      controls.maxBarrierDepth = Math.max(controls.maxBarrierDepth, ++controls.barrierDepth)
      try { return await work() } finally { controls.barrierDepth--; controls.order.push('barrier-exit') }
    } },
    operate: controls.operate,
  }),
}))

vi.mock('../../src/main/workbench/execution/ExecutionDesktopService', () => ({ executionDesktopService: async () => ({ stopTasksForDocument: controls.stopExecution }) }))
vi.mock('../../src/main/workbench/external/externalDesktopService', () => ({ externalMcpService: async () => ({ stopForDocument: controls.stopExternal }) }))

import { createMainWindow } from '../../src/main/createWindow'

async function openWindow() {
  const state = { attachWindow: vi.fn(), detachWindow: vi.fn(), isDirty: () => controls.dirty, setDirty: vi.fn() }
  const { window } = await createMainWindow(state as unknown as AppState)
  return { window, state }
}
function requestId(window: { webContents: { send: unknown } }): string { return vi.mocked(window.webContents.send as (...args: unknown[]) => void).mock.calls.at(-1)?.[1] as string }
async function settle() { await vi.advanceTimersByTimeAsync(0) }
beforeEach(() => {
  vi.useFakeTimers(); controls.choice = 1; controls.recoveryChoice = 0; controls.dirty = true; controls.crashed = false
  controls.documents = []; controls.order = []; controls.barrierDepth = 0; controls.maxBarrierDepth = 0
  controls.stopExecution.mockReset().mockImplementation(async () => { controls.order.push('stop-execution') })
  controls.stopExternal.mockReset().mockImplementation(async () => { controls.order.push('stop-external') })
  controls.operate.mockReset()
  vi.mocked(dialog.showMessageBox).mockReset().mockImplementation(async (...args: MessageBoxArguments) => {
    const options = args.length === 1 ? args[0] : args[1]
    return { response: options.title === '保存未完成的修改？' ? controls.choice : controls.recoveryChoice, checkboxChecked: false }
  })
  controls.clearRecovery.mockClear(); controls.clearFrames.mockReset(); controls.releaseLeases.mockReset()
})
afterEach(() => { ipcMain.removeAllListeners(); vi.useRealTimers() })

describe('window close recovery handshake', () => {
  it.each(['preserve', 'save', 'discard'] as const)('waits for return-to-editing from an open recovery dialog after the %s renderer is ready', async mode => {
    controls.choice = mode === 'save' ? 0 : 1; controls.dirty = mode !== 'preserve'
    let choose!: (result: { response: number; checkboxChecked: boolean }) => void
    vi.mocked(dialog.showMessageBox).mockImplementation(async (...args: MessageBoxArguments): Promise<Electron.MessageBoxReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      if (options.title === '保存未完成的修改？') return { response: controls.choice, checkboxChecked: false }
      return new Promise(resolve => { choose = resolve })
    })
    const { window, state } = await openWindow()
    const contents = window.webContents
    window.close(); await settle()
    const request = requestId(window)
    await vi.advanceTimersByTimeAsync(3_000)
    const resultChannel = mode === 'preserve' ? IPC_CHANNELS.preserveAndCloseResult : mode === 'save' ? IPC_CHANNELS.saveAndCloseResult : IPC_CHANNELS.discardAndCloseResult
    ipcMain.emit(resultChannel, { sender: contents }, request, true)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(state.setDirty).not.toHaveBeenCalled()
    choose({ response: 0, checkboxChecked: false }); await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.requestResumeClose)
    expect(controls.operate).not.toHaveBeenCalled()
  })
  it.each([
    { recoveryChoice: 0, trigger: 'close' },
    { recoveryChoice: 2, trigger: 'unresponsive' },
  ] as const)('waits for recovery choice $recoveryChoice opened by $trigger while discard writers are stopping', async ({ recoveryChoice, trigger }) => {
    controls.documents = [{ documentId: 'live-document', epoch: 'epoch', revision: 1, dirty: true }] as DocumentSnapshot[]
    let stopped!: () => void
    controls.stopExecution.mockImplementationOnce(async () => {
      controls.order.push('stop-execution')
      await new Promise<void>(resolve => { stopped = resolve })
    })
    let choose!: (result: { response: number; checkboxChecked: boolean }) => void
    vi.mocked(dialog.showMessageBox).mockImplementation(async (...args: MessageBoxArguments): Promise<Electron.MessageBoxReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      if (options.title === '保存未完成的修改？') return { response: 1, checkboxChecked: false }
      return new Promise(resolve => { choose = resolve })
    })
    const { window, state } = await openWindow()
    const contents = window.webContents
    window.close(); await settle()
    ipcMain.emit(IPC_CHANNELS.discardAndCloseResult, { sender: contents }, requestId(window), true)
    await settle()
    expect(controls.stopExecution).toHaveBeenCalledOnce()
    if (trigger === 'close') window.close()
    else window.emit('unresponsive')
    await settle()
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(window, expect.objectContaining({ title: '关闭前保全尚未完成' }))
    stopped(); await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(controls.operate).not.toHaveBeenCalled()
    choose({ response: recoveryChoice, checkboxChecked: false }); await settle()
    expect(window.isDestroyed()).toBe(recoveryChoice === 2)
    expect(controls.operate).not.toHaveBeenCalled()
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    expect(state.setDirty).not.toHaveBeenCalled()
    expect(controls.maxBarrierDepth).toBe(1)
    if (recoveryChoice === 0) expect(contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.requestResumeClose)
    else expect(controls.order.slice(-5)).toEqual(['barrier-enter', 'stop-execution', 'stop-external', 'drain', 'barrier-exit'])
  })
  it('finishes the original close attempt before forcing recovery through stop, barrier and drain', async () => {
    controls.crashed = true; controls.recoveryChoice = 2
    controls.documents = [{ documentId: 'live-document', epoch: 'epoch', revision: 1, dirty: true }] as DocumentSnapshot[]
    let stopped!: () => void
    controls.stopExecution.mockImplementation(async () => {
      controls.order.push('stop-execution')
      await new Promise<void>(resolve => { stopped = resolve })
    })
    const { window } = await openWindow()
    window.on('closed', () => { controls.order.push('closed') })
    window.close(); await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(controls.stopExecution).toHaveBeenCalledWith('live-document')
    expect(controls.maxBarrierDepth).toBe(1)
    expect(controls.order).toEqual(['drain', 'barrier-enter', 'barrier-exit', 'barrier-enter', 'stop-execution'])
    expect(controls.operate).not.toHaveBeenCalled()
    stopped(); await settle()
    expect(window.isDestroyed()).toBe(true)
    expect(controls.order.slice(-4)).toEqual(['stop-external', 'drain', 'barrier-exit', 'closed'])
    expect(controls.operate).not.toHaveBeenCalled()
    expect(controls.clearRecovery).not.toHaveBeenCalled()
  })
  it('keeps the window open when stopping a forced recovery close fails', async () => {
    controls.crashed = true; controls.recoveryChoice = 2
    controls.documents = [{ documentId: 'live-document', epoch: 'epoch', revision: 1, dirty: true }] as DocumentSnapshot[]
    controls.stopExecution.mockRejectedValueOnce(new Error('stop failed'))
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { window } = await openWindow()
      window.close(); await settle()
      expect(window.isDestroyed()).toBe(false)
      expect(window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.requestResumeClose)
      expect(controls.operate).not.toHaveBeenCalled()
      expect(controls.clearRecovery).not.toHaveBeenCalled()
      expect(report).toHaveBeenCalledWith(expect.stringContaining('窗口保持打开'), expect.any(Error))
    } finally { report.mockRestore() }
  })
  it('skips a crashed renderer and closes only after an explicit confirmed-recovery choice', async () => {
    controls.crashed = true
    const { window, state } = await openWindow()
    const contents = window.webContents
    window.close(); await settle()
    expect(dialog.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({
      title: '关闭前保全尚未完成', detail: expect.stringContaining('界面进程已退出'),
    }))
    expect(window.isDestroyed()).toBe(false)
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
    expect(vi.mocked(contents.send).mock.calls.every(([channel]) => channel === IPC_CHANNELS.requestResumeClose)).toBe(true)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    expect(state.setDirty).not.toHaveBeenCalled()
    controls.recoveryChoice = 2
    window.close(); await settle()
    expect(window.isDestroyed()).toBe(true)
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
    expect(vi.mocked(contents.send).mock.calls.every(([channel]) => channel === IPC_CHANNELS.requestResumeClose)).toBe(true)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    expect(state.setDirty).not.toHaveBeenCalled()
  })
  it('requires the matching renderer preserve success before a preserve close, without clearing legacy project recovery', async () => {
    controls.dirty = false
    const { window, state } = await openWindow()
    window.close()
    await settle()
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.requestPreserveAndClose, expect.any(String), undefined)
    expect(window.isDestroyed()).toBe(false)
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: {} }, requestId(window), true)
    ipcMain.emit(IPC_CHANNELS.saveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(true)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    expect(state.setDirty).toHaveBeenCalledWith(false)
    expect(ipcMain.listenerCount(IPC_CHANNELS.preserveAndCloseResult)).toBe(0)
  })
  it.each([false, 'true', null])('keeps the window and recovery on unsuccessful preserve result %s', async result => {
    controls.dirty = false
    const { window, state } = await openWindow()
    window.close(); await settle()
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), result)
    await settle()
    expect(window.isDestroyed()).toBe(false)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
    expect(state.setDirty).not.toHaveBeenCalled()
    expect(ipcMain.listenerCount(IPC_CHANNELS.preserveAndCloseResult)).toBe(0)
  })
  it('offers recovery while waiting; choosing to wait does not expire the original request', async () => {
    controls.recoveryChoice = 1; controls.dirty = false
    const { window } = await openWindow()
    window.close(); await settle()
    const original = requestId(window)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(dialog.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ title: '关闭前保全尚未完成' }))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(window.isDestroyed()).toBe(false)
    expect(ipcMain.listenerCount(IPC_CHANNELS.preserveAndCloseResult)).toBe(1)
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, original, true)
    await settle()
    expect(window.isDestroyed()).toBe(true)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
  })
  it.each(['preserve', 'save'] as const)('ignores a cancelled %s handshake when a newer close is in progress', async mode => {
    controls.choice = mode === 'save' ? 0 : 1; controls.dirty = mode === 'save'
    const channel = mode === 'save' ? IPC_CHANNELS.saveAndCloseResult : IPC_CHANNELS.preserveAndCloseResult
    const { window } = await openWindow()
    window.close(); await settle()
    const old = requestId(window)
    window.close(); await settle() // Explicit return to editing cancels the waiting attempt.
    expect(ipcMain.listenerCount(IPC_CHANNELS.preserveAndCloseResult)).toBe(0)
    window.close(); await settle()
    const fresh = requestId(window)
    expect(fresh).not.toBe(old)
    ipcMain.emit(channel, { sender: window.webContents }, old, true)
    await settle(); expect(window.isDestroyed()).toBe(false)
    ipcMain.emit(channel, { sender: window.webContents }, fresh, true)
    await settle()
    if (mode === 'save') {
      expect(window.isDestroyed()).toBe(false)
      ipcMain.emit(channel, { sender: window.webContents }, requestId(window), true)
      await settle()
    }
    expect(window.isDestroyed()).toBe(true)
  })
  it('allows only an explicit confirmed-recovery close when renderer preparation fails', async () => {
    controls.dirty = false; controls.recoveryChoice = 2
    const { window } = await openWindow()
    window.close(); await settle()
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), false)
    await settle()
    expect(window.isDestroyed()).toBe(true)
    expect(dialog.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ detail: expect.stringContaining('可能丢失') }))
    expect(controls.clearRecovery).not.toHaveBeenCalled()
  })
  it('also preserves drafts on an apparently clean close', async () => {
    controls.dirty = false
    const { window } = await openWindow()
    window.close(); await settle()
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.requestPreserveAndClose, expect.any(String), undefined)
    expect(window.isDestroyed()).toBe(false)
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle()
    expect(window.isDestroyed()).toBe(true)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
  })
  it('retains both save handshakes and only closes after save success', async () => {
    controls.choice = 0
    const { window } = await openWindow()
    window.close(); await settle()
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.requestSaveAndClose, expect.any(String), [])
    ipcMain.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle(); expect(window.isDestroyed()).toBe(false)
    ipcMain.emit(IPC_CHANNELS.saveAndCloseResult, { sender: window.webContents }, requestId(window), false)
    await settle(); expect(window.isDestroyed()).toBe(false)
    window.close(); await settle()
    ipcMain.emit(IPC_CHANNELS.saveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle(); expect(window.isDestroyed()).toBe(false)
    ipcMain.emit(IPC_CHANNELS.saveAndCloseResult, { sender: window.webContents }, requestId(window), true)
    await settle(); expect(window.isDestroyed()).toBe(true)
    expect(controls.clearRecovery).not.toHaveBeenCalled()
  })
})


it('M25 releases frames by the captured primitive after webContents is destroyed, including repeated cleanup', async () => {
  const { window, state } = await openWindow()
  Reflect.set(window, 'destroyed', true)
  expect(() => window.webContents).toThrow('Object has been destroyed')
  expect(() => { window.emit('closed'); window.emit('closed') }).not.toThrow()
  expect(controls.clearFrames).toHaveBeenNthCalledWith(1, 7)
  expect(controls.clearFrames).toHaveBeenNthCalledWith(2, 7)
  expect(controls.releaseLeases).toHaveBeenCalledTimes(2)
  expect(state.detachWindow).toHaveBeenCalledWith(window)
})

it('M25 a preview cleanup error does not skip network lease cleanup or AppState detachment', async () => {
  const { window, state } = await openWindow()
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  controls.clearFrames.mockImplementationOnce(() => { throw new Error('frame cleanup failed') })
  Reflect.set(window, 'destroyed', true)
  expect(() => window.emit('closed')).not.toThrow()
  expect(controls.releaseLeases).toHaveBeenCalledTimes(1)
  expect(state.detachWindow).toHaveBeenCalledWith(window)
  expect(report).toHaveBeenCalledTimes(1)
  report.mockRestore()
})
