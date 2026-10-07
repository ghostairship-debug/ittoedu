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
import { executionDesktopService } from './workbench/execution/ExecutionDesktopService'
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
import { runProductMcpBootstrap } from './workbench/external/installedMcpBootstrap'

if (process.argv.includes('--mcp-connect')) {
  // This packaged, one-use entry delegates to a detached product process before taking
  // the profile lock. The returned facts always belong to the existing or new Main owner.
  if (!app.isPackaged) {
    console.error('--mcp-connect 需要已安装的果铃产品入口；工程调试请使用原 MCP launcher。')
    app.exit(1)
  } else {
    void runProductMcpBootstrap(process.argv.slice(1), { executable: process.execPath, cwd: process.cwd() })
      .then(reply => { process.stdout.write(`${JSON.stringify(reply)}\n`); app.exit(0) })
      .catch(error => { console.error('果铃连接未完成：', error instanceof Error ? error.message : String(error)); app.exit(1) })
  }
} else {

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
// A background launch can acquire the normal GUI without replacing its Main/DocumentHost.
let guiEnabled = !headless
let guiInstalled = false
let promoting: Promise<void> | undefined

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
let quitRequested = false
let context: { getMainWindow(): BrowserWindow | null; getRendererEntryUrl(): string | null; appState: AppState; headless: boolean }

async function reportMcpReady(request: HeadlessMcpLaunch, ownership: 'owned' | 'attached'): Promise<void> {
  await hostReady
  if (stopping || stopped) throw new Error('果铃宿主正在退出，请在退出完成后重新连接')
  const service = await externalMcpService(), info = await service.connectionInfo()
  const samePath = (left: string, right: string) => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase() : left === right
  const reply = { status: 'ready', ...info, token: await service.revealToken(), pid: process.pid,
    profile: app.getPath('userData'), mode: guiEnabled ? 'gui' : 'headless', ownership,
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

/** Explicit application exit preserves received work; disconnecting an MCP SDK client never calls it. */
function stopHeadlessHost(): Promise<void> {
  return stopping ??= (async () => {
    const execution = await executionDesktopService()
    lifecycle?.recordingState(execution.events.getPendingState())
    await Promise.all([execution.shutdown(), closeExternalMcpService()])
    lifecycle?.recordingState(execution.events.getPendingState())
    await execution.events.flushPending()
    const recording = execution.events.getPendingState()
    lifecycle?.recordingState(recording)
    const host = documentHost()
    await Promise.all(host.registry.list().map(snapshot => host.registry.get(snapshot.documentId).drain()))
    await host.settleSaveObservations()
    if (recording.lastFailure || recording.pendingEvents || recording.pendingTiming) {
      const pending = recording.pendingEvents + recording.pendingTiming
      const message = [pending ? `仍有 ${pending} 条运行记录尚未完成。` : '',
        recording.lastFailure ? `运行记录曾出现写入失败：${recording.lastFailure.message}` : '',
        '文档的保存和已应用修改以各自结果为准；记录失败不会重新执行操作。'].filter(Boolean).join('\n')
      // Reuse the normal native error surface; do not turn an auxiliary failure into a replay or a document-save claim.
      if (guiEnabled) dialog.showErrorBox('运行记录保存诊断', message)
      else console.error('运行记录保存诊断：', message)
    }
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
      if (quitRequested) void stopHeadlessHost()
    })
  })
}

function installGui(): void {
  if (guiInstalled) return
  context.headless = false
  lifecycle = installWindowLifecycle(() => mainWindow)
  registerIpcHandlers(context)
  guiInstalled = true
  guiEnabled = true
}

/** Attach the mature editor to the already-live registry and history, once. */
function promoteToGui(): Promise<void> {
  return promoting ??= (async () => {
    await hostReady
    if (stopping || stopped) throw new Error('果铃宿主正在退出，未打开新的编辑窗口')
    installGui()
    await openMainWindow()
  })().finally(() => { promoting = undefined })
}

app.on('second-instance', (_event, argv, workingDirectory) => {
  let request: HeadlessMcpLaunch | null = null
  try { request = parseHeadlessMcpLaunch(argv) } catch (error) { console.error('后台连接参数无效：', error); return }
  if (request) {
    // This is a connection request only: preserve the existing owner, its UI and its authorization.
    void reportMcpReady(request, 'attached').catch(error => reportMcpFailure(request, error))
    return
  }
  void (async () => { appState.enqueueOpenFiles(await launchFileArguments(argv, workingDirectory, app.isPackaged)); await promoteToGui() })().catch((error) => {
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
    // Every outbound request of the main process follows the system proxy (or PAC) from here on.
    installSystemProxy(session.defaultSession)

    installEditorProtocol(session.defaultSession)
    installHtmlPreviewProtocol(session.defaultSession)
    rendererEntryUrl = resolveRendererEntryUrl()
    context = {
      getMainWindow: () => mainWindow,
      getRendererEntryUrl: () => rendererEntryUrl,
      appState,
      headless,
    }
    if (headlessLaunch) {
      configureHeadlessExternalMcp()
      // The service closures retain this same context so GUI promotion changes only their UI ports.
      installWorkbenchToolServices(context)
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
    installGui()
    // Default on; an occupied port only shows in settings and never blocks the window.
    const externalReady = startExternalMcpService().catch(error => diagnosticLog.append({ source: 'main', message: '外部连接服务未能启动',
      details: { reason: error instanceof Error ? error.message : String(error) } }))
    appState.enqueueOpenFiles(await launchFileArguments(process.argv, process.cwd(), app.isPackaged))
    await openMainWindow()
    await externalReady
    resolveHostReady()

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
  if (!guiEnabled) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  lifecycle?.dispose()
  removeDiagnosticHandlers?.()
  removeDiagnosticHandlers = null
  if (guiInstalled) unregisterIpcHandlers()
})

app.on('activate', () => {
  if (!singleInstanceLock) return
  void promoteToGui().catch(error => console.error('创建主窗口失败', error))
})

app.on('before-quit', event => {
  if (stopped || !singleInstanceLock) return
  event.preventDefault()
  const window = mainWindow
  if (guiEnabled && window && !window.isDestroyed()) {
    // Native app quit still passes through the existing renderer-input and document-save protection.
    quitRequested = true
    lifecycle?.requestQuit()
    window.close()
  } else void stopHeadlessHost()
})

if (headless) {
  process.on('message', message => { if (singleInstanceLock && message && typeof message === 'object' && 'type' in message && message.type === 'mcp-stop') app.quit() })
  // Engineering launchers retain their owned-parent stop; a product bootstrap starts detached with no IPC.
  if (process.connected) process.on('disconnect', () => { if (singleInstanceLock && !guiEnabled) void stopHeadlessHost() })
  process.on('SIGINT', () => { if (singleInstanceLock) app.quit() })
  process.on('SIGTERM', () => { if (singleInstanceLock) app.quit() })
}
}
