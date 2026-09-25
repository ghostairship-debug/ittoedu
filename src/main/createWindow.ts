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
} from './security'
import { askMediaCapture } from './mediaCapturePrompt'
import { editorEntryUrl } from './protocols'
import { documentHost } from './workbench/documentHost'
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

function confirmClose(window: BrowserWindow): DocumentCloseChoice {
  const choice = dialog.showMessageBoxSync(window, {
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

function requestRendererBeforeClose(window: BrowserWindow, mode: 'save' | 'preserve'): Promise<{ ready: boolean; suggestedDirectory?: SaveDirectoryContext }> {
  const requestId = randomUUID()
  const resultChannel = mode === 'save' ? IPC_CHANNELS.saveAndCloseResult : IPC_CHANNELS.preserveAndCloseResult
  const requestChannel = mode === 'save' ? IPC_CHANNELS.requestSaveAndClose : IPC_CHANNELS.requestPreserveAndClose
  return new Promise((resolve) => {
    let settled = false
    const finish = (ready: boolean, suggestedDirectory?: SaveDirectoryContext) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
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
    const timeout = setTimeout(() => finish(false), 5 * 60_000)
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
    minWidth: 1200,
    minHeight: 720,
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
  let closeApproved = false
  let closeCheckInFlight = false
  let previewNetworkDocumentToken: string | null = null

  const beginPreviewNetworkDocumentNavigation = (): void => {
    previewNetworkDocumentToken = null
    mainPreviewNetworkPolicy.beginDocumentNavigation()
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
    (url) => isAllowedEditorPreviewFrameUrl(url, rendererEntryUrl),
  )

  window.webContents.on('before-input-event', (event, input) => {
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
    if (closeCheckInFlight) return
    closeCheckInFlight = true
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
      prepareRenderer: async mode => {
        const prepared = await requestRendererBeforeClose(window, mode)
        if (mode === 'preserve') closeSaveDirectory = prepared.suggestedDirectory
        return prepared.ready
      },
      save: documentId => saveDocumentWithDialog(window, documentHost(), documentId, false, closeSaveDirectory),
      onBlocked: documentId => {
        if (!window.isDestroyed()) { window.webContents.send(IPC_CHANNELS.requestFocusDocument, documentId); window.focus() }
      },
    }).then(approved => {
      if (!approved) return
      appState.setDirty(false)
      closeApproved = true
      if (!window.isDestroyed()) window.close()
    }).catch((error) => {
      console.error('关闭前保存或保全失败', error)
      if (!window.isDestroyed()) void dialog.showMessageBox(window, {
        type: 'error', title: '文档尚未保存，窗口保持打开',
        message: error instanceof Error ? error.message : '无法保存全部文档，请检查当前稿后重试。',
      })
    }).finally(() => {
      closeCheckInFlight = false
    })
  })

  window.on('closed', () => {
    beginPreviewNetworkDocumentNavigation()
    appState.detachWindow(window)
  })

  window.webContents.on('render-process-gone', () => {
    beginPreviewNetworkDocumentNavigation()
  })

  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) beginPreviewNetworkDocumentNavigation()
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
