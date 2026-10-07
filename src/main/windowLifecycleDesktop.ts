import path from 'node:path'
import { app, dialog, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { WindowLifecycle, type CloseActivity } from './windowLifecycle'
import { setBeforeWindowClose } from './workbench/documentCloseCoordinator'
import { executionDesktopService } from './workbench/execution/ExecutionDesktopService'
import { externalMcpService } from './workbench/external/externalDesktopService'

async function closeActivity(): Promise<CloseActivity> {
  let recording: CloseActivity['recording']
  const builtinTasks = await executionDesktopService().then(async execution => {
    recording = execution.events.getPendingState()
    let count = 0
    for (const stored of await execution.runs.list()) {
      const run = await execution.engine.read(stored.runId) ?? stored
      if (['queued', 'running', 'stopping'].includes(run.status)) count++
    }
    return count
  }).catch(() => 0)
  const external = await externalMcpService().then(service => service.activity()).catch(() => [])
  return { builtinTasks, external, ...(recording ? { recording } : {}) }
}

/** Hide-to-tray close behaviour for the main window, inserted before the existing document close protection. */
export function installWindowLifecycle(getWindow: () => BrowserWindow | null,
  onCloseDecision?: (decision: 'continue' | 'handled') => void): WindowLifecycle {
  const lifecycle = new WindowLifecycle({
    window: getWindow,
    // Closing must keep working even if the connection service could not start: fall back to asking.
    closeAction: () => externalMcpService().then(async service => (await service.status()).settings.closeAction).catch(() => 'ask' as const),
    remember: closeAction => externalMcpService().then(service => service.configure({ closeAction })).catch(() => undefined),
    activity: closeActivity,
    prompt: (window, options) => dialog.showMessageBox(window as BrowserWindow, options),
    createTray: actions => {
      const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'))
      const tray = new Tray(icon)
      tray.setToolTip('果铃')
      tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示果铃', click: actions.show }, { label: '退出', click: actions.quit }]))
      tray.on('click', actions.show)
      return tray
    },
  })
  setBeforeWindowClose(async () => {
    const decision = await lifecycle.beforeClose()
    onCloseDecision?.(decision)
    return decision
  })
  // Main's single before-quit owner requests a normal window close. A second listener here
  // would re-arm requestQuit after the first close consumes it, including a cancelled save.
  return lifecycle
}
