import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { APP_NAME } from '../shared/constants'
import { IPC_CHANNELS } from '../shared/ipcTypes'
import { saveDirectoryContextSchema, type SaveDirectoryContext } from '../shared/workbench/desktop'
import type { AppState } from './appState'
import {
  configureRestrictedSession,
  hardenWebContents,
  isAllowedDocumentUrl,
  isAllowedEditorPreviewFrameUrl,
  isAllowedHtmlPreviewFrameUrl,
  isAllowedHtmlPreviewChildFrameUrl,
  clearHtmlPreviewFrameEntries,
} from './security'
import { askMediaCapture } from './mediaCapturePrompt'
import { editorEntryUrl } from './protocols'
import { documentHost } from './workbench/documentHost'
import { releaseAllHtmlPreviewLeases } from './ipc'
import { saveDocumentWithDialog } from './workbench/documentSaveDialog'
import { prepareDocumentWindowClose, type DocumentCloseChoice } from './workbench/documentCloseCoordinator'
import { mainPreviewNetworkPolicy } from './previewNetworkPolicy'
import {
  BACKGROUND_E2E_WINDOW_ORIGIN,
  shouldShowApplicationWindows,
} from './windowVisibility'

export interface MainWindowResult {
  window: BrowserWindow
  rendererEntryUrl: string
}

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'index.js')
}

function getIconPath(): string | undefined {
  const iconPath = path.join(app.getAppPath(), 'resources', 'icons', 'icon.png')
  return fs.existsSync(iconPath) ? iconPath : undefined
}

function parseDevelopmentServerUrl(): URL | null {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return null

  let url: URL
  try {
    url = new URL(process.env.VITE_DEV_SERVER_URL)
  } catch {
    throw new Error('VITE_DEV_SERVER_URL 不是有效地址。')
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new Error('开发服务器只能使用本机 HTTP 地址。')
  }
  return url
}

async function confirmClose(window: BrowserWindow): Promise<DocumentCloseChoice> {
  const { response: choice } = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '保存未完成的修改？',
    message: '工作台中有尚未保存的文档修改。',
    detail: '可以保存全部文档后关闭，保留恢复稿并关闭，或取消关闭。',
    buttons: ['保存全部并关闭', '保留恢复稿并关闭', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })
  if (choice === 0) return 'save'
  if (choice === 1) return 'preserve'
  return 'cancel'
}

function requestRendererBeforeClose(window: BrowserWindow, mode: 'save' | 'preserve', signal: AbortSignal, onWaiting?: () => void): Promise<{ ready: boolean; suggestedDirectory?: SaveDirectoryContext }> {
  const requestId = randomUUID()
  const resultChannel = mode === 'save' ? IPC_CHANNELS.saveAndCloseResult : IPC_CHANNELS.preserveAndCloseResult
  const requestChannel = mode === 'save' ? IPC_CHANNELS.requestSaveAndClose : IPC_CHANNELS.requestPreserveAndClose
  return new Promise((resolve) => {
    let settled = false
    // This is an offered recovery choice, not a timeout or automatic discard.
    const waiting = setTimeout(() => { if (!settled) onWaiting?.() }, 3_000)
    const finish = (ready: boolean, suggestedDirectory?: SaveDirectoryContext) => {
      if (settled) return
      settled = true
      clearTimeout(waiting)
      signal.removeEventListener('abort', onClosed)
      ipcMain.removeListener(resultChannel, onResult)
      window.removeListener('closed', onClosed)
      resolve({ ready, ...(suggestedDirectory ? { suggestedDirectory } : {}) })
    }
    const onResult = (
      event: Electron.IpcMainEvent,
      receivedRequestId: unknown,
      saved: unknown,
      directory: unknown,
    ) => {
      if (event.sender !== window.webContents || receivedRequestId !== requestId) return
      if (mode !== 'preserve' || directory === undefined) { finish(saved === true); return }
      const parsed = saveDirectoryContextSchema.safeParse(directory)
      if (!parsed.success) { finish(false); return }
      finish(saved === true, parsed.data)
    }
    const onClosed = () => finish(false)
    signal.addEventListener('abort', onClosed, { once: true })
    if (signal.aborted) { finish(false); return }
    ipcMain.on(resultChannel, onResult)
    window.once('closed', onClosed)
    try {
      window.webContents.send(requestChannel, requestId)
    } catch (error) {
      console.error('发送关闭前保存请求失败', error)
      finish(false)
    }
  })
}

export async function createMainWindow(
  appState: AppState,
  onCreated?: (result: MainWindowResult) => void,
): Promise<MainWindowResult> {
  const developmentServerUrl = parseDevelopmentServerUrl()
  const rendererEntryUrl = developmentServerUrl?.toString() ?? editorEntryUrl()

  const baseNetworkOrigins = new Set<string>()
  if (developmentServerUrl) {
    baseNetworkOrigins.add(developmentServerUrl.origin)
    const websocketUrl = new URL(developmentServerUrl)
    websocketUrl.protocol = 'ws:'
    baseNetworkOrigins.add(websocketUrl.origin)
  }
  mainPreviewNetworkPolicy.replaceBaseOrigins(baseNetworkOrigins)
  mainPreviewNetworkPolicy.beginDocumentNavigation()
  configureRestrictedSession(
    session.defaultSession,
    (url) => mainPreviewNetworkPolicy.allowsRequest(url),
    { requestMediaCapture: askMediaCapture },
  )
  const showApplicationWindows = shouldShowApplicationWindows()

  const window = new BrowserWindow({
    ...(!showApplicationWindows
      ? {
          x: BACKGROUND_E2E_WINDOW_ORIGIN,
          y: BACKGROUND_E2E_WINDOW_ORIGIN,
          opacity: 0,
        }
      : {}),
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    title: APP_NAME,
    backgroundColor: '#0b1020',
    icon: getIconPath(),
    show: false,
    skipTaskbar: !showApplicationWindows,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: showApplicationWindows,
    },
  })
  const windowWebContentsId = window.webContents.id
  let closeApproved = false
  let closeCheckInFlight = false
  let closeController: AbortController | undefined
  let closeRecoveryPrompt = false
  const offerCloseRecovery = async (reason?: string) => {
    const attempt = closeController
    if (closeRecoveryPrompt || closeApproved || !attempt || attempt.signal.aborted || window.isDestroyed()) return
    closeRecoveryPrompt = true
    try {
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning', title: '关闭前保全尚未完成',
        message: '可以返回处理当前输入，继续等待，或只保留已确认的恢复稿后关闭。',
        detail: (reason ? `未完成原因：${reason}\n\n` : '') + '“只保留已确认的恢复稿”不会删除课件、聊天或 Main 已持久化的修改；但仍在输入框、尚未提交成功的文字、图片和其他视图草稿可能丢失。正常退出请先返回检查。',
        buttons: ['返回继续编辑', '继续等待', '只保留已确认恢复稿并关闭'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (response === 1 || closeController !== attempt || attempt.signal.aborted || closeApproved || window.isDestroyed()) return
      attempt.abort()
      if (response === 2 && !window.isDestroyed()) { closeApproved = true; window.close() }
    } catch (error) { console.error('关闭选项未能显示，窗口与恢复稿保持原状', error) }
    finally { closeRecoveryPrompt = false }
  }
  let previewNetworkDocumentToken: string | null = null

  const beginPreviewNetworkDocumentNavigation = (): void => {
    try { releaseAllHtmlPreviewLeases() }
    finally {
      previewNetworkDocumentToken = null
      mainPreviewNetworkPolicy.beginDocumentNavigation()
    }
  }
  const sendPreviewNetworkDocumentToken = (): void => {
    if (previewNetworkDocumentToken === null || window.isDestroyed()) return
    const mainFrame = window.webContents.mainFrame
    if (mainFrame.detached) return
    try {
      mainFrame.send(
        IPC_CHANNELS.previewNetworkDocumentToken,
        previewNetworkDocumentToken,
      )
    } catch (error) {
      console.error('下发预览网络文档凭据失败', error)
    }
  }

  onCreated?.({ window, rendererEntryUrl })
  appState.attachWindow(window)
  hardenWebContents(
    window.webContents,
    (url) => isAllowedDocumentUrl(url, rendererEntryUrl),
    (url, frame) => isAllowedEditorPreviewFrameUrl(url, rendererEntryUrl)
      || isAllowedHtmlPreviewFrameUrl(url, windowWebContentsId)
      || isAllowedHtmlPreviewChildFrameUrl(url, windowWebContentsId, frame),
  )

  window.webContents.on('before-input-event', (event, input) => {
    const focusedPreviewUrl = window.webContents.focusedFrame?.url ?? ''
    const focusedPreview = isAllowedHtmlPreviewFrameUrl(focusedPreviewUrl, window.webContents.id)
    const historyKey = input.type === 'keyDown' && !input.isAutoRepeat && (input.control || input.meta)
      && !input.alt && focusedPreview ? input.key.toLocaleLowerCase('en-US') : ''
    const historyDirection = historyKey === 'z' ? input.shift ? 'redo' : 'undo'
      : historyKey === 'y' && !input.shift ? 'redo' : null
    if (historyDirection) {
      event.preventDefault()
      // The physical shortcut is observed by Main, not reported by untrusted page JS.
      if (!window.isDestroyed()) {
        const detail = JSON.stringify({ url: focusedPreviewUrl, direction: historyDirection })
        void window.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent('courseware:html-preview-history', { detail: ${detail} }))`, true).catch(() => undefined)
      }
      return
    }
    const saveShortcut =
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      (input.control || input.meta) &&
      !input.alt &&
      !input.shift &&
      input.key.toLocaleLowerCase('en-US') === 's'

    if (!saveShortcut) return
    event.preventDefault()
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.requestSave)
    }
  })

  window.on('close', (event) => {
    if (closeApproved) return
    event.preventDefault()
    if (closeCheckInFlight) { void offerCloseRecovery(); return }
    closeCheckInFlight = true
    const closing = new AbortController(); closeController = closing
    window.setProgressBar(2, { mode: 'indeterminate' })
    let closeSaveDirectory: SaveDirectoryContext | undefined
    void prepareDocumentWindowClose({
      list: () => documentHost().registry.list(),
      drain: async () => { await Promise.all(documentHost().registry.list().map(snapshot => documentHost().registry.get(snapshot.documentId).drain())) },
      rendererDirty: () => Promise.race([
        window.webContents.executeJavaScript(
          'Boolean(window.__COURSEWARE_EDITOR_DIRTY__)',
          true,
        ).then(Boolean),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_500)),
      ]).then(rendererDirty => rendererDirty || appState.isDirty()),
      confirm: () => confirmClose(window),
      cancelled: () => closing.signal.aborted,
      prepareRenderer: async mode => {
        const prepared = await requestRendererBeforeClose(window, mode, closing.signal, () => {
          if (closeController === closing && !closing.signal.aborted) void offerCloseRecovery()
        })
        if (mode === 'preserve') closeSaveDirectory = prepared.suggestedDirectory
        if (!prepared.ready && !closing.signal.aborted) await offerCloseRecovery()
        return prepared.ready && !closing.signal.aborted
      },
      save: documentId => saveDocumentWithDialog(window, documentHost(), documentId, false, closeSaveDirectory),
      onBlocked: documentId => {
        if (!window.isDestroyed()) { window.webContents.send(IPC_CHANNELS.requestFocusDocument, documentId); window.focus() }
      },
    }).then(approved => {
      if (!approved || closing.signal.aborted) return
      appState.setDirty(false)
      closeApproved = true
      if (!window.isDestroyed()) window.close()
    }).catch((error) => {
      console.error('关闭前保存或保全失败', error)
      if (!window.isDestroyed() && !closing.signal.aborted) return offerCloseRecovery(error instanceof Error ? error.message : '无法保存全部文档')
    }).finally(() => {
      if (closeController === closing) {
        closeCheckInFlight = false; closeController = undefined
        if (!window.isDestroyed()) window.setProgressBar(-1)
      }
    })
  })

  window.on('unresponsive', () => { if (closeCheckInFlight) void offerCloseRecovery() })
  window.on('closed', () => {
    closeController?.abort()
    try { clearHtmlPreviewFrameEntries(windowWebContentsId) }
    catch (error) { console.error('关闭窗口时释放 HTML 预览帧失败', error) }
    try { beginPreviewNetworkDocumentNavigation() }
    catch (error) { console.error('关闭窗口时释放预览网络授权失败', error) }
    finally { appState.detachWindow(window) }
  })

  window.webContents.on('render-process-gone', () => {
    clearHtmlPreviewFrameEntries(windowWebContentsId)
    beginPreviewNetworkDocumentNavigation()
  })

  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      clearHtmlPreviewFrameEntries(windowWebContentsId)
      beginPreviewNetworkDocumentNavigation()
    }
  })

  window.webContents.on('did-frame-navigate', (
    _event,
    _url,
    _httpResponseCode,
    _httpStatusText,
    isMainFrame,
  ) => {
    if (!isMainFrame) return
    const mainFrame = window.webContents.mainFrame
    previewNetworkDocumentToken = randomUUID()
    mainPreviewNetworkPolicy.activateDocument({
      processId: mainFrame.processId,
      frameToken: mainFrame.frameToken,
      documentToken: previewNetworkDocumentToken,
    })
    sendPreviewNetworkDocumentToken()
  })

  window.webContents.on('dom-ready', sendPreviewNetworkDocumentToken)

  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return
    if (showApplicationWindows) window.show()
  })

  if (developmentServerUrl) {
    await window.loadURL(rendererEntryUrl)
  } else {
    await window.loadURL(rendererEntryUrl)
  }

  return { window, rendererEntryUrl }
}
