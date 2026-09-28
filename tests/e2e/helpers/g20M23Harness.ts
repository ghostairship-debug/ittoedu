import { _electron as electron, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../../src/main/windowVisibility'
import type { M23Fixture } from './g20M23Fixtures'

const root = resolve(__dirname, '../../..')

export interface M23RuntimeCapture {
  console: string[]
  pageErrors: string[]
  requests: string[]
  failedRequests: string[]
  responses: Array<{ url: string; status: number }>
  popups: string[]
}

export async function launchM23(fixture: M23Fixture) {
  const capture: M23RuntimeCapture = { console: [], pageErrors: [], requests: [], failedRequests: [], responses: [], popups: [] }
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${fixture.profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('console', message => capture.console.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => capture.pageErrors.push(error.stack ?? error.message))
  page.on('request', request => capture.requests.push(`${request.method()} ${request.url()}`))
  page.on('requestfailed', request => capture.failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`))
  page.on('response', response => capture.responses.push({ url: response.url(), status: response.status() }))
  page.on('popup', popup => capture.popups.push(popup.url()))
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000) })
  return { app, page, capture }
}

export async function chooseM23Workspace(app: ElectronApplication, page: Page, workspace: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await expect(page.getByRole('tree', { name: '工作空间文件' })).toBeVisible()
}

export function m23Tree(page: Page) { return page.getByRole('tree', { name: '工作空间文件' }) }
export function m23Row(page: Page, name: string) { return m23Tree(page).getByRole('button', { name, exact: true }) }
export function m23Editor(page: Page, name: string) { return page.getByRole('region', { name: `教学文档 ${name}`, exact: true }) }
export function m23PreviewFrame(page: Page, index = 0) { return page.locator('iframe[title="HTML 预览"]').nth(index) }
export function m23Preview(page: Page, index = 0) { return page.frameLocator('iframe[title="HTML 预览"]').nth(index) }

export async function openM23Html(page: Page, name: string) {
  await m23Row(page, name).dblclick()
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: new RegExp(`^${escaped}`) })).toHaveAttribute('aria-selected', 'true')
  const region = m23Editor(page, name)
  await expect(region).toBeVisible()
  await expect(region.getByRole('toolbar', { name: 'HTML 视图', exact: true })).toBeVisible()
  await expect(region.getByTitle('HTML 预览')).toHaveAttribute('src', /^courseware-preview:\/\/app\//)
  await expect(region.frameLocator('iframe[title="HTML 预览"]').locator('body')).toBeVisible()
  return region
}

export async function m23Snapshot(page: Page, path: string) {
  return page.evaluate(async filename => (await window.desktopAPI.documents!.list())
    .find(entry => entry.binding.kind === 'file' && entry.binding.path.toLowerCase() === filename.toLowerCase()), path)
}

export async function m23ReadDocument(page: Page, documentId: string) {
  return page.evaluate(id => window.desktopAPI.documents!.read(id), documentId)
}

export async function m23Shot(fixture: M23Fixture, page: Page, info: TestInfo, name: string, app?: ElectronApplication) {
  const shots = join(fixture.directory, 'shots')
  mkdirSync(shots, { recursive: true })
  const path = join(shots, `${name}.png`)
  await page.screenshot({ path, fullPage: true }).catch(() => undefined)
  if (existsSync(path)) await info.attach(`M23 ${name}`, { path, contentType: 'image/png' })
  const visibleFrames = page.locator('iframe[title="HTML 预览"]')
  for (let index = 0; index < await visibleFrames.count(); index += 1) {
    const iframe = visibleFrames.nth(index)
    if (!(await iframe.isVisible().catch(() => false))) continue
    const framePath = join(shots, `${name}-iframe.png`)
    await iframe.screenshot({ path: framePath }).catch(() => undefined)
    if (existsSync(framePath)) await info.attach(`M23 ${name} iframe`, { path: framePath, contentType: 'image/png' })
    break
  }
  if (app) {
    const nativeCapture = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const webContents = window.webContents
      const frames = webContents.mainFrame.frames.map(frame => {
        const details = frame as typeof frame & { processId?: number; routingId?: number }
        return { url: frame.url, name: frame.name, processId: details.processId, routingId: details.routingId }
      })
      const image = await webContents.capturePage(undefined, { stayHidden: false, stayAwake: true })
      return { pngBase64: image.toPNG().toString('base64'), frames, windowUrl: webContents.getURL() }
    })
    const nativePath = join(shots, `${name}-native-window.png`)
    writeFileSync(nativePath, Buffer.from(nativeCapture.pngBase64, 'base64'))
    await info.attach(`M23 ${name} native BrowserWindow capturePage`, { path: nativePath, contentType: 'image/png' })
    const rendererFrames = await Promise.all(page.frames().map(async frame => ({
      url: frame.url(),
      visibilityState: await frame.evaluate(() => document.visibilityState).catch(() => 'unavailable'),
    })))
    const diagnosticsPath = join(shots, `${name}-capture-diagnostics.json`)
    writeFileSync(diagnosticsPath, JSON.stringify({ ...nativeCapture, pngBase64: undefined, rendererFrames }, null, 2) + '\n', 'utf8')
    await info.attach(`M23 ${name} capture diagnostics`, { path: diagnosticsPath, contentType: 'application/json' })
  }
  return path
}

export async function writeM23Evidence(
  fixture: M23Fixture,
  page: Page,
  app: ElectronApplication,
  capture: M23RuntimeCapture,
  facts: Record<string, unknown>,
  error?: unknown,
) {
  if (error) facts.failure = error instanceof Error ? error.stack ?? error.message : String(error)
  let pageState: unknown = null
  let documents: unknown = null
  let windows: unknown = null
  try {
    pageState = await page.evaluate(() => ({ url: location.href, title: document.title,
      text: document.body.innerText.slice(0, 4000), frames: Array.from(document.querySelectorAll('iframe')).map(frame => ({
        title: frame.title, src: frame.src, visible: Boolean(frame.getClientRects().length),
      })) }))
    const listed = await page.evaluate(() => window.desktopAPI.documents!.list())
    documents = listed.map(snapshot => ({
      documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, dirty: snapshot.dirty,
      binding: snapshot.binding, modelKind: snapshot.model.kind,
      sourceLength: snapshot.model.kind === 'text' ? snapshot.model.source.length : undefined,
      sourceSha256: snapshot.model.kind === 'text' ? sha256(snapshot.model.source) : undefined,
    }))
    windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
      destroyed: window.isDestroyed(), url: window.webContents.getURL(),
    })))
  } catch (reason) { facts.evidenceReadError = reason instanceof Error ? reason.message : String(reason) }
  facts.runDirectory = fixture.directory
  facts.workspace = fixture.workspace
  facts.page = pageState
  facts.documents = documents
  facts.windows = windows
  facts.runtime = capture
  const path = join(fixture.directory, 'evidence.json')
  writeFileSync(path, JSON.stringify(facts, null, 2) + '\n', 'utf8')
  return path
}

export function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function closeM23(app: ElectronApplication) {
  try {
    await app.evaluate(({ BrowserWindow, app: electronApp }) => {
      BrowserWindow.getAllWindows().forEach(window => { if (!window.isDestroyed()) window.destroy() })
      electronApp.exit(0)
    })
  } catch { /* The main process may already have exited. */ }
  const electronProcess = app.process()
  const close = app.close().catch(() => undefined)
  const timedOut = await Promise.race([close.then(() => false), new Promise<boolean>(resolve => setTimeout(() => resolve(true), 8_000))])
  if (timedOut && electronProcess.pid && electronProcess.exitCode === null) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(electronProcess.pid), '/T', '/F'], { stdio: 'ignore' })
      else electronProcess.kill()
    } catch { /* Preserve the original test result if the process already exited. */ }
    await Promise.race([close, new Promise<void>(resolve => setTimeout(resolve, 2_000))])
  }
}
