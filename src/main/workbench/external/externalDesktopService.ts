import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, dialog, ipcMain, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipcTypes'
import { externalRequestSchema, externalUiStateSchema, type ExternalUiState } from '../../../shared/workbench/external'
import { DesktopOperationError } from '../../errors'
import { executionDesktopService } from '../execution/ExecutionDesktopService'
import { AgentFileService } from '../execution/AgentFileService'
import { documentHost } from '../documentHost'
import { createElectronCredentialEncryption } from '../providers/providerCredentials'
import { operateWorkspaceFiles } from '../workspaceFilesDesktopService'
import { ExternalMcpService, type ExternalApproval } from './ExternalMcpService'
import { ResidentMcpSettingsStore } from './ResidentMcpSettings'

let singleton: Promise<ExternalMcpService> | undefined
let mainWindow: (() => BrowserWindow | null) | undefined
let uiState: (() => Promise<ExternalUiState | null>) | undefined

async function confirmExternalChange(request: ExternalApproval): Promise<boolean> {
  const options: MessageBoxOptions = { type: 'question', title: '外部 AI 请求修改', message: `外部 AI · ${request.clientName} 请求「${request.label}」`,
    detail: [request.reason === 'ask' ? '此外部会话的权限为「修改前询问」。' : '修改目标位于当前工作空间之外。',
      ...(request.paths?.length ? ['涉及：', ...request.paths] : [])].join('\n'),
    buttons: ['允许', '拒绝'], defaultId: 1, cancelId: 1, noLink: true }
  const window = mainWindow?.()
  // A window hidden in the tray cannot parent a modal; the prompt then appears on its own.
  const result = window && !window.isDestroyed() && window.isVisible() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  return result.response === 0
}

export function externalMcpService(): Promise<ExternalMcpService> {
  return singleton ??= (async () => {
    await app.whenReady()
    const execution = await executionDesktopService(), documents = documentHost()
    const settings = new ResidentMcpSettingsStore({ directory: path.join(app.getPath('userData'), 'workbench-v2', 'external-mcp'),
      encryption: await createElectronCredentialEncryption() })
    const service = new ExternalMcpService({ settings, conversations: execution.conversations, registry: documents.registry, gateway: documents.tools,
      files: new AgentFileService(documents),
      workspaceRoot: async root => (await operateWorkspaceFiles({ type: 'root', directory: root })).resolvedPath,
      uiState: () => uiState?.() ?? Promise.resolve(null),
      appendEvent: input => execution.appendExternalEvent(input),
      confirm: confirmExternalChange })
    execution.setExternalRevoker(async input => service.releaseConversation(input))
    return service
  })().catch(cause => { singleton = undefined; throw cause })
}

/** Lets Main ask the renderer for the user's foreground document and selection; returns a detach function. */
export function attachExternalMcpWindow(getWindow: () => BrowserWindow | null): () => void {
  const replies = new Map<string, (state: ExternalUiState | null) => void>()
  const receive = (event: Electron.IpcMainEvent, raw: unknown) => {
    const window = getWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents || !raw || typeof raw !== 'object') return
    const { requestId, state } = raw as { requestId?: unknown; state?: unknown }
    if (typeof requestId !== 'string') return
    const parsed = externalUiStateSchema.safeParse(state)
    replies.get(requestId)?.(parsed.success ? parsed.data : null)
  }
  ipcMain.on(IPC_CHANNELS.externalMcpUiStateReply, receive)
  mainWindow = getWindow
  uiState = () => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return Promise.resolve(null)
    const requestId = randomUUID()
    return new Promise(resolve => {
      // A renderer that is still loading cannot answer; the tool then reports the main-process document list only.
      const timer = setTimeout(() => { replies.delete(requestId); resolve(null) }, 2000)
      replies.set(requestId, state => { clearTimeout(timer); replies.delete(requestId); resolve(state) })
      window.webContents.send(IPC_CHANNELS.externalMcpUiStateRequest, requestId)
    })
  }
  return () => {
    ipcMain.removeListener(IPC_CHANNELS.externalMcpUiStateReply, receive)
    for (const resolve of replies.values()) resolve(null)
    if (mainWindow === getWindow) { mainWindow = undefined; uiState = undefined }
  }
}

export async function operateExternalMcp(raw: unknown): Promise<unknown> {
  try {
    const input = externalRequestSchema.parse(raw), service = await externalMcpService()
    switch (input.type) {
      case 'status': return await service.status()
      case 'configure': return await service.configure(input.patch)
      case 'token': return await service.revealToken()
      case 'regenerate-token': return await service.regenerateToken()
      case 'stop-session': return await service.stopSession(input.sessionId)
    }
  } catch (cause) {
    throw new DesktopOperationError('external-mcp-operation-failed', '外部连接操作未完成',
      cause instanceof Error ? cause.message : '操作未完成', '当前文档和已提交的修改已保留。')
  }
}
/** Default on: listen when the app starts; an occupied port is reported in settings without affecting the rest of the app. */
export async function startExternalMcpService(): Promise<void> { await (await externalMcpService()).start() }
export async function closeExternalMcpService(): Promise<void> { if (singleton) await (await singleton).close() }
