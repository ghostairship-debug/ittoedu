import { app, shell } from 'electron'
import path from 'node:path'
import { DocumentHostService } from './DocumentHostService'
import { createElectronNativeTextMeasurement } from './nativeText/ElectronNativeTextMeasurement'

let nativeTextMeasurement: ReturnType<typeof createElectronNativeTextMeasurement> | undefined
function measurement() {
  const development = !app.isPackaged && process.env.VITE_DEV_SERVER_URL
  return nativeTextMeasurement ??= createElectronNativeTextMeasurement(development
    ? { rendererURL: new URL('native-text-measurement.html', development).href }
    : { rendererFile: path.join(app.getAppPath(), 'dist-renderer', 'native-text-measurement.html') })
}
/** Hidden render services must never keep the desktop alive after its last main window closes. */
export function disposeNativeTextMeasurement(): void {
  nativeTextMeasurement?.dispose(); nativeTextMeasurement = undefined
}

let host: DocumentHostService | undefined
export function documentHost(): DocumentHostService {
  return host ??= new DocumentHostService(path.join(app.getPath('userData'), 'workbench-v2', 'documents'), {
    trashItem: filename => shell.trashItem(filename), showItemInFolder: filename => shell.showItemInFolder(filename),
  }, { measureNativeTextAsync: (request, options) => measurement().measure(request, options) })
}
