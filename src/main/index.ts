import { app, BrowserWindow, dialog, session } from 'electron'
import { configureApplicationStorage } from './applicationIdentity'
import { launchFileArguments } from './launchFileArguments'
import { AppState } from './appState'
import { createMainWindow } from './createWindow'
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc'
import { startExternalMcpService, externalMcpService, closeExternalMcpService,
  configureHeadlessExternalMcp, bindHeadlessMcpWorkspace } from './workbench/external/externalDesktopService'
import { installWorkbenchToolServices, disposeHeadlessWorkbenchWorkers } from './workbench/workbenchToolServices'
import { documentHost } from './workbench/documentHost'
import { parseHeadlessMcpLaunch, writeMcpLaunchReply, type HeadlessMcpLaunch } from './headlessMcpLaunch'
import { resolveRendererEntryUrl } from './rendererEntry'
import { installWindowLifecycle } from './windowLifecycleDesktop'
import type { WindowLifecycle } from './windowLifecycle'
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
import { installSystemProxy } from './workbench/network/systemProxyDispatcher'

if (!shouldShowApplicationWindows()) {
  BACKGROUND_E2E_CHROMIUM_SWITCHES.forEach((name) => {
    app.commandLine.appendSwitch(name)
  })
}

configureApplicationStorage(app)

let headlessLaunch: HeadlessMcpLaunch | null = null
let launchError: unknown
try { headlessLaunch = parseHeadlessMcpLaunch(process.argv) } catch (error) { launchError = error }
const headless = process.argv.includes('--headless-mcp')

registerPrivilegedSchemes()

const appState = new AppState()
let mainWindow: BrowserWindow | null = null
let rendererEntryUrl: string | null = null
let removeDiagnosticHandlers: (() => void) | null = null
let lifecycle: WindowLifecycle | null = null
let hostReady: Promise<void>
let resolveHostReady!: () => void
let rejectHostReady!: (error: unknown) => void
hostReady = new Promise((resolve, reject) => { resolveHostReady = resolve; rejectHostReady = reject })
void hostReady.catch(() => undefined)
let stopped = false
let stopping: Promise<void> | undefined

async function reportMcpReady(request: HeadlessMcpLaunch, ownership: 'owned' | 'attached'): Promise<void> {
  await hostReady
  const service = await externalMcpService(), info = await service.connectionInfo()
  const samePath = (left: string, right: string) => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase() : left === right
  const reply = { status: 'ready', ...info, token: await service.revealToken(), pid: process.pid,
    profile: app.getPath('userData'), mode: headless ? 'headless' : 'gui', ownership,
    requestedWorkspace: request.workspace, workspaceMismatch: !samePath(info.workspace, request.workspace) }
  if (request.readyFile) await writeMcpLaunchReply(request.readyFile, reply)
  else if (request.readyJson) process.stdout.write(`${JSON.stringify(reply)}\n`)
  else console.error(`MCP ready: ${info.endpoint}; workspace=${info.workspace}; pid=${process.pid}`)
}

async function reportMcpFailure(request: HeadlessMcpLaunch | null, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error('后台 MCP 未能启动/连接：', message)
  if (request?.readyFile) await writeMcpLaunchReply(request.readyFile, { status: 'failed', message }).catch(error => console.error('连接失败信息未能交接：', error))
}

/** The dedicated launcher owns this host. Disconnecting an MCP SDK client never calls it. */
function stopHeadlessHost(): Promise<void> {
  return stopping ??= (async () => {
    await closeExternalMcpService()
    const host = documentHost()
    await Promise.all(host.registry.list().map(snapshot => host.registry.get(snapshot.documentId).drain()))
    await host.settleSaveObservations()
    disposeHeadlessWorkbenchWorkers()
    stopped = true
    app.quit()
  })().catch(error => { console.error('后台退出保全失败：', error); app.exit(1) })
}

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
    // A window hidden in the tray comes back when the app is launched again.
    mainWindow.show()
    mainWindow.focus()
    return
  }

  await createMainWindow(appState, (result) => {
    mainWindow = result.window
    rendererEntryUrl = result.rendererEntryUrl
    // Logging off or shutting down Windows quits; it is never turned into a hide.
    result.window.on('session-end', () => lifecycle?.requestQuit())
    result.window.once('closed', () => {
      mainWindow = null
    })
  })
}

app.on('second-instance', (_event, argv, workingDirectory) => {
  let request: HeadlessMcpLaunch | null = null
  try { request = parseHeadlessMcpLaunch(argv) } catch (error) { console.error('后台连接参数无效：', error); return }
  if (request) {
    // This is a connection request only: preserve the existing owner, its UI and its authorization.
    void reportMcpReady(request, 'attached').catch(error => reportMcpFailure(request, error))
    return
  }
  if (headless) { console.error('此 profile 当前由后台 MCP 持有；请先正常停止该宿主再打开工作台。'); return }
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
    // A second launch only hands its arguments to the running instance (second-instance) and quits.
    if (!singleInstanceLock) return
    if (launchError) throw launchError
    if (process.platform === 'win32') {
      app.setAppUserModelId(APP_ID)
    }

    removeDiagnosticHandlers = diagnosticLog.installProcessHandlers()
    if (!headless) lifecycle = installWindowLifecycle(() => mainWindow)
    // Every outbound request of the main process follows the system proxy (or PAC) from here on.
    installSystemProxy(session.defaultSession)

    installEditorProtocol(session.defaultSession)
    installHtmlPreviewProtocol(session.defaultSession)
    rendererEntryUrl = resolveRendererEntryUrl()
    const context = {
      getMainWindow: () => mainWindow,
      getRendererEntryUrl: () => rendererEntryUrl,
      appState,
    }
    if (headlessLaunch) {
      configureHeadlessExternalMcp()
      installWorkbenchToolServices({ ...context, headless: true })
      await bindHeadlessMcpWorkspace(headlessLaunch.workspace)
      const service = await externalMcpService()
      await service.configure({ enabled: true, ...(headlessLaunch.port ? { port: headlessLaunch.port } : {}),
        ...(headlessLaunch.permission ? { permission: headlessLaunch.permission } : {}) })
      // configure already starts a stopped listener; do not restart it or revoke fresh sessions.
      const status = await service.status()
      if (status.state !== 'running') throw new Error(status.message ?? '后台 MCP 未在监听')
      resolveHostReady()
      await reportMcpReady(headlessLaunch, 'owned')
      return
    }
    registerIpcHandlers(context)
    // Default on; an occupied port only shows in settings and never blocks the window.
    const externalReady = startExternalMcpService().catch(error => diagnosticLog.append({ source: 'main', message: '外部连接服务未能启动',
      details: { reason: error instanceof Error ? error.message : String(error) } }))
    appState.enqueueOpenFiles(await launchFileArguments(process.argv, process.cwd(), app.isPackaged))
    await openMainWindow()
    await externalReady
    resolveHostReady()

    app.on('activate', () => {
      void openMainWindow().catch((error) => {
        console.error('创建主窗口失败', error)
      })
    })
  })
  .catch((error) => {
    rejectHostReady(error)
    if (headless) {
      void reportMcpFailure(headlessLaunch, error).finally(() => {
        void closeExternalMcpService().finally(() => { disposeHeadlessWorkbenchWorkers(); app.exit(1) })
      })
      return
    }
    console.error('应用启动失败', error)
    dialog.showErrorBox(
      '应用启动失败',
      '编辑器未能启动。请重新解压应用或重新下载后再试。',
    )
    app.quit()
  })

app.on('window-all-closed', () => {
  if (headless) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  lifecycle?.dispose()
  removeDiagnosticHandlers?.()
  removeDiagnosticHandlers = null
  if (!headless) unregisterIpcHandlers()
})

if (headless) {
  app.on('before-quit', event => { if (!stopped && singleInstanceLock) { event.preventDefault(); void stopHeadlessHost() } })
  process.on('message', message => { if (singleInstanceLock && message && typeof message === 'object' && 'type' in message && message.type === 'mcp-stop') void stopHeadlessHost() })
  if (process.connected) process.on('disconnect', () => { if (singleInstanceLock) void stopHeadlessHost() })
  process.on('SIGINT', () => { if (singleInstanceLock) void stopHeadlessHost() })
  process.on('SIGTERM', () => { if (singleInstanceLock) void stopHeadlessHost() })
}
