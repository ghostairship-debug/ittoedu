// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import type { ComputeWorkerInput, ComputeWorkerReply } from '../../src/main/workbench/compute/ComputeBackend'

type Policy = (details: { url: string }, callback: (result: { cancel: boolean }) => void) => void
const mock = vi.hoisted(() => ({ policy: undefined as Policy | undefined }))
vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    readonly webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, mainFrame: {}, ipc: new EventEmitter(), send() {} })
    destroyed = false
    async loadURL() {}
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
  }, net: {}, session: { fromPartition: () => ({
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {},
    webRequest: { onBeforeRequest(policy: Policy | null) { mock.policy = policy ?? undefined } },
    protocol: { handle() {}, unhandle() {} }, async clearStorageData() {},
  }) },
}))
import { PyodideComputeBackend } from '../../src/main/workbench/compute/PyodideComputeBackend'

it('CA246: the actual Vite module Worker runs local Python through the backend dev request policy', async () => {
  const server = await createServer({ configFile: resolve('vite.renderer.config.ts'), server: { port: 0, strictPort: false, open: false }, logLevel: 'error' })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('local Vite port unavailable')
  const origin = `http://127.0.0.1:${address.port}`
  const backend = new PyodideComputeBackend({ preloadPath: 'unused-browser-harness', rendererURL: `${origin}/compute.html`, runtimeDirectory: resolve('public/vendor/compute-runtime') })
  const process = await backend.start({ executionId: 'dev-policy', directory: '', program: 'python', argv: ['/job/input/__main__.py'], code: 'print(6 * 7)' })
  const policy = mock.policy!, requested: string[] = [], blockedUrls: string[] = [], errors: string[] = []
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    await context.route('**/*', async route => {
      let cancel = true; const url = route.request().url()
      requested.push(url)
      policy({ url }, value => { cancel = value.cancel })
      if (cancel) { blockedUrls.push(url); await route.abort() } else await route.continue()
    })
    const page = await context.newPage()
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      const host = window as unknown as { computeWorkerAPI: { run(execute: (input: ComputeWorkerInput) => Promise<ComputeWorkerReply>): void }; auditComputeRun?: (input: ComputeWorkerInput) => Promise<ComputeWorkerReply> }
      host.computeWorkerAPI = { run(execute) { host.auditComputeRun = execute } }
    })
    await page.goto(`${origin}/compute.html`)
    await page.waitForFunction(() => !!(window as unknown as { auditComputeRun?: unknown }).auditComputeRun)
    const result = await page.evaluate(async runtimeBaseURL => {
      const run = (window as unknown as { auditComputeRun: (input: ComputeWorkerInput) => Promise<ComputeWorkerReply> }).auditComputeRun
      return await run({ executionId: 'actual-python', code: 'print(6 * 7)', inputs: [], runtimeBaseURL })
    }, `${origin}/vendor/compute-runtime/`).catch(error => { throw new Error(`${String(error)}\nblocked=${JSON.stringify(blockedUrls)}\nerrors=${JSON.stringify(errors)}\nrequests=${JSON.stringify(requested)}`) })
    expect(result).toMatchObject({ exitCode: 0, stdout: '42', stderr: '', cancelled: false })
    expect(requested.some(url => new URL(url).pathname === '/@vite/env' || new URL(url).pathname.endsWith('/node_modules/vite/dist/client/env.mjs'))).toBe(true)
    let blocked = false; policy({ url: `${origin}/unrelated.js` }, result => { blocked = result.cancel })
    expect(blocked).toBe(true)
    // Production uses the separate local-resource mapping and gains no dev route.
    const production = new PyodideComputeBackend({ preloadPath: 'unused-browser-harness', rendererFile: resolve('compute.html'), runtimeDirectory: resolve('public/vendor/compute-runtime') })
    const prod = await production.start({ executionId: 'prod-policy', directory: '', program: 'python', argv: ['/job/input/__main__.py'], code: 'print(42)' })
    mock.policy!({ url: 'https://guoling-compute.invalid/@vite/env' }, result => { blocked = result.cancel })
    expect(blocked).toBe(true)
    await prod.cancel(); production.dispose()
  } finally { await browser.close(); await process.cancel(); backend.dispose(); await server.close() }
}, 60_000)
