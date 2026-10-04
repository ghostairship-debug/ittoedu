// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  install: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'D:/test', getAppPath: () => 'D:/test' },
  dialog: {},
  ipcMain: {
    removeHandler: (channel: string) => state.handlers.delete(channel),
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => state.handlers.set(channel, handler),
    on: vi.fn(), removeAllListeners: vi.fn(),
  },
}))
vi.mock('../../src/main/workbench/workbenchToolServices', () => ({ installWorkbenchToolServices: state.install,
  disposeWorkbenchExportPort: vi.fn(), acceptWorkbenchExportBuildReply: vi.fn(), workbenchImageService: vi.fn(), workbenchImageSelection: vi.fn() }))
vi.mock('../../src/main/workbench/execution/ExecutionDesktopService', () => ({ executionDesktopService: () => new Promise(() => {}) }))
vi.mock('../../src/main/workbench/workspaceFilesDesktopService', () => ({ subscribeWorkspaceFilesChanges: () => new Promise(() => {}),
  attachHtmlPreviewHost: () => new Promise(() => {}), operateWorkspaceFiles: vi.fn() }))
vi.mock('../../src/main/protocols', () => ({ setHtmlPreviewProtocolHandler: vi.fn() }))
vi.mock('../../src/main/workbench/documentHost', () => ({ documentHost: () => ({ setEventSink: vi.fn(),
  subscribeEvents: () => () => undefined, subscribeClosed: () => () => undefined, tools: { configureDynamicContentServices: vi.fn() } }) }))
vi.mock('../../src/main/diagnosticLog', () => ({ diagnosticLog: { append: vi.fn() }, exportDiagnosticReport: vi.fn() }))
vi.mock('../../src/main/workbench/images/ImageResultsDesktopService', () => ({ ImageResultsDesktopService: class {} }))
vi.mock('../../src/main/previewNetworkPolicy', () => ({ mainPreviewNetworkPolicy: {} }))

import { registerIpcHandlers, unregisterIpcHandlers } from '../../src/main/ipc'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'

function fixture() {
  const frame = { detached: false, processId: 1, frameToken: 'main', url: 'http://localhost:5173/' }
  const sender = {
    mainFrame: frame,
    isFocused: vi.fn(() => true),
    cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), pasteAndMatchStyle: vi.fn(),
  }
  const window = { isDestroyed: () => false, isFocused: vi.fn(() => true), webContents: Object.assign(sender, { id: 1, once: vi.fn() }) }
  const event = { sender, senderFrame: frame }
  registerIpcHandlers({ getMainWindow: () => window as never, getRendererEntryUrl: () => frame.url, appState: {} as never })
  const handle = state.handlers.get(IPC_CHANNELS.editorClipboard)!
  return { sender, window, event, handle }
}

beforeEach(() => { unregisterIpcHandlers(); state.handlers.clear() })

it.each([
  ['cut', 'cut'], ['copy', 'copy'], ['paste', 'paste'], ['paste-plain', 'pasteAndMatchStyle'],
] as const)('dispatches %s only to the initiating main webContents', async (command, method) => {
  const { sender, event, handle } = fixture()
  expect(await handle(event, command)).toEqual({ ok: true, value: undefined })
  expect(sender[method]).toHaveBeenCalledOnce()
  expect(sender.cut.mock.calls.length + sender.copy.mock.calls.length + sender.paste.mock.calls.length + sender.pasteAndMatchStyle.mock.calls.length).toBe(1)
})

it('rejects unknown commands and extra arguments through the IPC envelope', async () => {
  const { sender, event, handle } = fixture()
  expect((await handle(event, 'read') as { ok: boolean }).ok).toBe(false)
  expect((await handle(event, 'copy', 'extra') as { ok: boolean }).ok).toBe(false)
  expect(sender.copy).not.toHaveBeenCalled()
})

it('rejects unfocused windows, foreign senders and subframes', async () => {
  const { sender, window, event, handle } = fixture()
  window.isFocused.mockReturnValue(false)
  expect((await handle(event, 'copy') as { ok: boolean }).ok).toBe(false)
  window.isFocused.mockReturnValue(true)
  sender.isFocused.mockReturnValue(false)
  expect((await handle(event, 'copy') as { ok: boolean }).ok).toBe(false)
  sender.isFocused.mockReturnValue(true)
  expect((await handle({ ...event, sender: { ...sender } }, 'copy') as { ok: boolean }).ok).toBe(false)
  expect((await handle({ ...event, senderFrame: { ...event.senderFrame, frameToken: 'child' } }, 'copy') as { ok: boolean }).ok).toBe(false)
  expect(sender.copy).not.toHaveBeenCalled()
})
