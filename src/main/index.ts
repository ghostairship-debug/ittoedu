import { app, BrowserWindow, dialog, session } from 'electron'
import { configureApplicationStorage } from './applicationIdentity'
import { launchFileArguments } from './launchFileArguments'
import { AppState } from './appState'
import { createMainWindow } from './createWindow'
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc'
import { disposeNativeTextMeasurement } from './workbench/documentHost'
import { startExternalMcpService } from './workbench/external/externalDesktopService'
import {
  installEditorProtocol,
  installHtmlPreviewProtocol,
  registerPrivilegedSchemes,
} from './protocols'
import { diagnosticLog } from './diagnosticLog'
import {
  BACKGROUND_E2E_CHROMIUM_SWITCHES,
  shouldShowApplicationWindows,
} from './windowVisibility'
import { APP_ID } from '../shared/constants'

if (!shouldShowApplicationWindows()) {
  BACKGROUND_E2E_CHROMIUM_SWITCHES.forEach((name) => {
    app.commandLine.appendSwitch(name)
  })
}

configureApplicationStorage(app)

registerPrivilegedSchemes()

const appState = new AppState()
let mainWindow: BrowserWindow | null = null
let rendererEntryUrl: string | null = null
let removeDiagnosticHandlers: (() => void) | null = null

app.on('render-process-gone', (_event, contents, details) => {
  void diagnosticLog.append({
    source: contents === mainWindow?.webContents ? 'renderer' : 'preview',
    message: `渲染进程退出：${details.reason}`,
    details: {
      exitCode: details.exitCode,
      reason: details.reason,
      url: contents.getURL(),
    },
  })
})

app.on('child-process-gone', (_event, details) => {
  void diagnosticLog.append({
    source: 'main',
    message: `Electron 子进程退出：${details.type} / ${details.reason}`,
    details: {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    },
  })
})

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  app.quit()
}

async function openMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    return
  }

  await createMainWindow(appState, (result) => {
    mainWindow = result.window
    rendererEntryUrl = result.rendererEntryUrl
    result.window.once('closed', () => {
      mainWindow = null
      rendererEntryUrl = null
      disposeNativeTextMeasurement()
    })
  })
}

app.on('second-instance', (_event, argv, workingDirectory) => {
  void (async () => { appState.enqueueOpenFiles(await launchFileArguments(argv, workingDirectory, app.isPackaged)); await app.whenReady(); await openMainWindow() })().catch((error) => {
    console.error('恢复主窗口失败', error)
  })
})

app.on('certificate-error', (event, _contents, _url, _error, _certificate, callback) => {
  event.preventDefault()
  callback(false)
})

app
  .whenReady()
  .then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId(APP_ID)
    }

    removeDiagnosticHandlers = diagnosticLog.installProcessHandlers()

    installEditorProtocol(session.defaultSession)
    installHtmlPreviewProtocol(session.defaultSession)
    registerIpcHandlers({
      getMainWindow: () => mainWindow,
      getRendererEntryUrl: () => rendererEntryUrl,
      appState,
    })
    // Default on; an occupied port only shows in settings and never blocks the window.
    void startExternalMcpService().catch(error => diagnosticLog.append({ source: 'main', message: '外部连接服务未能启动',
      details: { reason: error instanceof Error ? error.message : String(error) } }))
    appState.enqueueOpenFiles(await launchFileArguments(process.argv, process.cwd(), app.isPackaged))
    await openMainWindow()

    app.on('activate', () => {
      void openMainWindow().catch((error) => {
        console.error('创建主窗口失败', error)
      })
    })
  })
  .catch((error) => {
    console.error('应用启动失败', error)
    dialog.showErrorBox(
      '应用启动失败',
      '编辑器未能启动。请重新解压应用或重新下载后再试。',
    )
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  removeDiagnosticHandlers?.()
  removeDiagnosticHandlers = null
  unregisterIpcHandlers()
  disposeNativeTextMeasurement()
})
