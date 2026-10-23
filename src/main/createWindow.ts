import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, session } from 'electron'
import { APP_NAME } from '../shared/constants'
import { IPC_CHANNELS } from '../shared/ipcTypes'
import type { SaveDirectoryContext } from '../shared/workbench/desktop'
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
import { resolveRendererEntryUrl } from './rendererEntry'
import { documentHost } from './workbench/documentHost'
import { releaseAllHtmlPreviewLeases } from './ipc'
import { saveDocumentWithDialog } from './workbench/documentSaveDialog'
import { requestRendererBeforeClose } from './workbench/documentCloseDialog'
import { executionDesktopService } from './workbench/execution/ExecutionDesktopService'
import { externalMcpService } from './workbench/external/externalDesktopService'
import { prepareDocumentWindowClose, preserveDocumentWindowRecovery, type DocumentCloseChoice } from './workbench/documentCloseCoordinator'
import { mainPreviewNetworkPolicy } from './previewNetworkPolicy'
import {
  BACKGROUND_E2E_WINDOW_ORIGIN,
  shouldShowApplicationWindows,
} from './windowVisibility'

export interface MainWindowResult {
  window: BrowserWindow
  rendererEntryUrl: string
}

interface CloseAttempt {
  controller: AbortController
  recoveryChoice?: 'cancel' | 'preserve'
  recoveryPrompt?: Promise<void>
}

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'index.js')
}

function getIconPath(): string | undefined {
  const iconPath = path.join(app.getAppPath(), 'resources', 'icons', 'icon.png')
  return fs.existsSync(iconPath) ? iconPath : undefined
}

async function confirmClose(window: BrowserWindow): Promise<DocumentCloseChoice> {
  const { response: choice } = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '保存未完成的修改？',
    message: '工作台中有尚未保存的文档修改。',
    detail: '放弃只处理本次未保存输入，已保存文件与其他恢复稿不会删除。',
    buttons: ['保存全部并关闭', '放弃未保存更改并关闭', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })
  if (choice === 0) return 'save'
  if (choice === 1) return 'discard'
  return 'cancel'
}



export async function createMainWindow(
  appState: AppState,
  onCreated?: (result: MainWindowResult) => void,
): Promise<MainWindowResult> {
  const rendererEntryUrl = resolveRendererEntryUrl()
  const resolvedEntry = new URL(rendererEntryUrl)
  const developmentServerUrl = resolvedEntry.protocol === 'http:' ? resolvedEntry : null

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
    backgroundColor: '#f6f3ee',
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#fffdf9', symbolColor: '#382c24', height: 52 } } : {}),
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
  let closeAttempt: CloseAttempt | undefined
  const offerCloseRecovery = (reason?: string): Promise<void> => {
    const attempt = closeAttempt
    if (attempt?.recoveryPrompt) return attempt.recoveryPrompt
    if (closeApproved || !attempt || attempt.controller.signal.aborted || window.isDestroyed()) return Promise.resolve()
    const prompt = (async () => {
      try {
        const { response } = await dialog.showMessageBox(window, {
          type: 'warning', title: '关闭前保全尚未完成',
          message: '可以返回处理当前输入，继续等待，或只保留已确认的恢复稿后关闭。',
          detail: (reason ? `未完成原因：${reason}\n\n` : '') + '“只保留已确认的恢复稿”不会删除课件、聊天或 Main 已持久化的修改；但仍在输入框、尚未提交成功的文字、图片和其他视图草稿可能丢失。正常退出请先返回检查。',
          buttons: ['返回继续编辑', '继续等待', '只保留已确认恢复稿并关闭'], defaultId: 0, cancelId: 0, noLink: true,
        })
        if (response === 1 || closeAttempt !== attempt || attempt.controller.signal.aborted || closeApproved || window.isDestroyed()) return
        attempt.recoveryChoice = response === 2 ? 'preserve' : 'cancel'
        attempt.controller.abort()
      } catch (error) {
        console.error('关闭选项未能显示，窗口与恢复稿保持原状', error)
        attempt.recoveryChoice = 'cancel'
        attempt.controller.abort()
      }
    })().finally(() => { if (attempt.recoveryPrompt === prompt) attempt.recoveryPrompt = undefined })
    attempt.recoveryPrompt = prompt
    return prompt
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
    if (closeAttempt) { void offerCloseRecovery(); return }
    const closing: CloseAttempt = { controller: new AbortController() }
    closeAttempt = closing
    window.setProgressBar(2, { mode: 'indeterminate' })
    let closeSaveDirectory: SaveDirectoryContext | undefined
    const recoveryPorts = {
      list: () => documentHost().registry.list(),
      drain: async () => { await Promise.all(documentHost().registry.list().map(snapshot => documentHost().registry.get(snapshot.documentId).drain())) },
      withWriteBarrier: <T>(ids: readonly string[], work: () => Promise<T>) => documentHost().tools.withWriteTaskBarrier(ids, work),
      stopWriters: async (ids: readonly string[]) => {
        const execution = await executionDesktopService(), external = await externalMcpService()
        for (const id of ids) { await execution.stopTasksForDocument(id); await external.stopForDocument(id) }
      },
    }
    void (async () => {
      let approved = false
      try {
        approved = await prepareDocumentWindowClose({
          ...recoveryPorts,
          rendererDirty: () => window.webContents.isCrashed() ? Promise.resolve(true) : Promise.race([
            window.webContents.executeJavaScript(
              'Boolean(window.__COURSEWARE_EDITOR_DIRTY__)',
              true,
            ).then(Boolean),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_500)),
          ]).then(rendererDirty => rendererDirty || appState.isDirty()),
          confirm: () => confirmClose(window),
          cancelled: () => closing.controller.signal.aborted,
          prepareRenderer: async (mode, ids) => {
            if (window.webContents.isCrashed()) {
              await offerCloseRecovery('界面进程已退出，无法完成关闭前输入保全。')
              return false
            }
            const prepared = await requestRendererBeforeClose(window, mode, closing.controller.signal, () => {
              if (closeAttempt === closing && !closing.controller.signal.aborted) void offerCloseRecovery()
            }, ids)
            await closing.recoveryPrompt
            if (prepared.suggestedDirectory) closeSaveDirectory = prepared.suggestedDirectory
            if (!prepared.ready && !closing.controller.signal.aborted) await offerCloseRecovery()
            return prepared.ready && !closing.controller.signal.aborted
          },
          save: documentId => saveDocumentWithDialog(window, documentHost(), documentId, false, closeSaveDirectory),
          discard: async snapshots => {
            for (const expected of snapshots) {
              if (closing.controller.signal.aborted) return false
              const current = await documentHost().registry.get(expected.documentId).drain()
              await closing.recoveryPrompt
              if (closing.controller.signal.aborted) return false
              if (current.epoch !== expected.epoch) throw new Error('关闭期间文档已重新打开，未放弃新的文档')
              await documentHost().operate({ type: 'close', documentId: current.documentId, discardDirty: true,
                expected: { epoch: current.epoch, revision: current.revision } })
            }
            return !closing.controller.signal.aborted
          },
          onBlocked: documentId => {
            if (!window.isDestroyed()) { window.webContents.send(IPC_CHANNELS.requestFocusDocument, documentId); window.focus() }
          },
        })
      } catch (error) {
        console.error('关闭前保存或保全失败', error)
        if (!window.isDestroyed() && !closing.controller.signal.aborted) await offerCloseRecovery(error instanceof Error ? error.message : '无法保存全部文档')
      }
      await closing.recoveryPrompt
      if (closing.recoveryChoice === 'preserve') {
        // Finish the original preparation first so a forced preserve never nests its write barrier.
        approved = await preserveDocumentWindowRecovery({ ...recoveryPorts,
          cancelled: () => closeAttempt !== closing || window.isDestroyed(),
        })
      } else if (closing.controller.signal.aborted) return
      if (!approved || closeAttempt !== closing || window.isDestroyed()) return
      if (closing.recoveryChoice !== 'preserve') appState.setDirty(false)
      closeApproved = true
      window.close()
    })().catch((error) => {
      console.error('关闭前停止写入或保全恢复稿失败，窗口保持打开', error)
    }).finally(() => {
      if (closeAttempt === closing) {
        if (!closeApproved && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.requestResumeClose)
        closeAttempt = undefined
        if (!window.isDestroyed()) window.setProgressBar(-1)
      }
    })
  })

  window.on('unresponsive', () => { if (closeAttempt) void offerCloseRecovery() })
  window.on('closed', () => {
    closeAttempt?.controller.abort()
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
