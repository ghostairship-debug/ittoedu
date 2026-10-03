import { app, BrowserWindow } from 'electron'
import { ManagedBrowserMcpService } from '../../../src/main/workbench/externalTools/ManagedBrowserMcpService'
import { createElectronEmbeddedBrowserFactory } from '../../../src/main/workbench/browserEmbedded/ElectronEmbeddedBrowser'

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1120, height: 800, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await window.loadURL('data:text/html,<html><body><h1>Task workbench fixture</h1></body></html>')
  const origin = process.env.GUOLING_EMBEDDED_BROWSER_TEST_ORIGIN!
  const service = new ManagedBrowserMcpService({ scratchRoot: process.env.GUOLING_EMBEDDED_BROWSER_TEST_SCRATCH!,
    testLoopbackOrigin: origin, embeddedBackend: createElectronEmbeddedBrowserFactory(() => window),
    approveExternalAction: async input => ['#download', '#auto-input', '#upload'].includes(String(input.arguments.target))
      || input.tool === 'browser_file_upload' })
  await service.beginRun('task', { permission: 'workspace-write', allowedOrigins: [origin],
    uploadRoot: process.env.GUOLING_EMBEDDED_BROWSER_TEST_UPLOADS })
  ;(globalThis as any).embeddedBrowserFixture = { service, window }
}).catch(cause => {
  ;(globalThis as any).embeddedBrowserFixtureError = cause instanceof Error ? cause.stack : String(cause)
  console.error('Embedded browser fixture startup:', cause)
})
