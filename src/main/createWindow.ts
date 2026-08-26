import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { APP_NAME } from '../shared/constants'
import { IPC_CHANNELS } from '../shared/ipcTypes'
import type { AppState } from './appState'
import {
  configureRestrictedSession,
  hardenWebContents,
  isAllowedDocumentUrl,
  isAllowedEditorPreviewFrameUrl,
} from './security'
import { editorEntryUrl } from './protocols'
import { clearRecoveryProject } from './projectPersistence'
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

function confirmClose(window: BrowserWindow): 'save' | 'discard' | 'cancel' {
  const choice = dialog.showMessageBoxSync(window, {
    type: 'warning',
    title: '保存未完成的修改？',
    message: '当前课件有尚未保存的修改。',
    detail: '可以先保存工程、直接关闭并放弃修改，或取消关闭。',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })
  if (choice === 0) return 'save'
  if (choice === 1) return 'discard'
  return 'cancel'
}

function requestRendererSaveBeforeClose(window: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (saved: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      ipcMain.removeListener(IPC_CHANNELS.saveAndCloseResult, onResult)
      window.removeListener('closed', onClosed)
      resolve(saved)
    }
    const onResult = (
      event: Electron.IpcMainEvent,
      saved: unknown,
    ) => {
      if (event.sender !== window.webContents) return
      finish(saved === true)
    }
    const onClosed = () => finish(false)
    const timeout = setTimeout(() => finish(false), 5 * 60_000)
    ipcMain.on(IPC_CHANNELS.saveAndCloseResult, onResult)
    window.once('closed', onClosed)
    try {
      window.webContents.send(IPC_CHANNELS.requestSaveAndClose)
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
    void Promise.race([
      window.webContents.executeJavaScript(
        'Boolean(window.__COURSEWARE_EDITOR_DIRTY__)',
        true,
      ).then(Boolean),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_500)),
    ]).then(async (rendererDirty) => {
      const dirty = rendererDirty || appState.isDirty()
      const decision = dirty ? confirmClose(window) : 'discard'
      if (decision === 'cancel') return
      if (decision === 'save' && !(await requestRendererSaveBeforeClose(window))) {
        return
      }
      if (dirty) {
        await clearRecoveryProject().catch((error) => {
          console.error('关闭时清理恢复副本失败', error)
        })
      }
      appState.setDirty(false)
      closeApproved = true
      if (!window.isDestroyed()) window.close()
    }).catch((error) => {
      console.error('关闭前读取编辑状态失败', error)
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
