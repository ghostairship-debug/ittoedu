import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { ObservationBootstrapService } from '../../../src/main/workbench/observation/ObservationBootstrapService'
import { PreviewNetworkPolicy } from '../../../src/main/previewNetworkPolicy'
import { configureRestrictedSession } from '../../../src/main/security'

/** The same isolated host, origin and lease owner used by ordinary observation. */
export function createAuditOutputCaptureHost(rendererEntryUrl: string) {
  const isolatedSession = session.fromPartition(`output-capture-audit-${randomUUID()}`)
  const token = randomUUID(), entry = new URL('observation.html', rendererEntryUrl).href
  const network = new PreviewNetworkPolicy()
  network.replaceBaseOrigins([new URL(rendererEntryUrl).origin])
  const owner = { processId: 0, frameToken: token, documentToken: token }
  network.activateDocument(owner)
  network.replacePreviewLease({ leaseId: token, connectOrigins: [], remoteAssetUrls: [] }, owner)
  configureRestrictedSession(isolatedSession, url => network.allowsRequest(url))
  const bootstrap = new ObservationBootstrapService({ token, entryOrigin: new URL(entry).origin, connectOrigins: () => [] })
  isolatedSession.protocol.handle('courseware-editor', async request =>
    await bootstrap.handle(new URL(request.url), request) ?? new Response('Not found', { status: 404 }))
  const window = new BrowserWindow({ width: 640, height: 360, useContentSize: true, show: false,
    webPreferences: { session: isolatedSession, contextIsolation: true, sandbox: true,
      nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault() })
  return {
    window, bootstrapBaseUrl: bootstrap.baseUrl,
    load: () => window.loadURL(entry),
    async close() {
      bootstrap.dispose()
      if (!window.isDestroyed()) window.destroy()
      isolatedSession.protocol.unhandle('courseware-editor')
      await isolatedSession.clearStorageData()
    },
  }
}
