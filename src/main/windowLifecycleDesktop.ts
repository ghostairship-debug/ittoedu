import path from 'node:path'
import { app, dialog, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { WindowLifecycle, type CloseActivity } from './windowLifecycle'
import { setBeforeWindowClose } from './workbench/documentCloseCoordinator'
import { executionDesktopService } from './workbench/execution/ExecutionDesktopService'
import { externalMcpService } from './workbench/external/externalDesktopService'

async function closeActivity(): Promise<CloseActivity> {
  const builtinTasks = await executionDesktopService().then(async execution => {
    let count = 0
    for (const stored of await execution.runs.list()) {
      const run = await execution.engine.read(stored.runId) ?? stored
      if (['queued', 'running', 'stopping'].includes(run.status)) count++
    }
    return count
  }).catch(() => 0)
  const external = await externalMcpService().then(service => service.activity()).catch(() => [])
  return { builtinTasks, external }
}

/** Hide-to-tray close behaviour for the main window, inserted before the existing document close protection. */
export function installWindowLifecycle(getWindow: () => BrowserWindow | null): WindowLifecycle {
  const lifecycle = new WindowLifecycle({
    window: getWindow,
    closeAction: async () => (await (await externalMcpService()).status()).settings.closeAction,
    remember: async closeAction => (await externalMcpService()).configure({ closeAction }),
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
  setBeforeWindowClose(() => lifecycle.beforeClose())
  // Quitting from elsewhere (tray, OS session end, app.quit) must not be turned into a hide.
  app.on('before-quit', () => lifecycle.requestQuit())
  return lifecycle
}
