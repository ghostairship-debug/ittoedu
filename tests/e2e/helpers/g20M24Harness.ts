import { _electron as electron, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../../src/main/windowVisibility'
import { CourseV9Driver } from '../../../src/core/drivers/CourseV9Driver'
import type { DocumentSnapshot } from '../../../src/shared/workbench/document'
import { serializeG20M24ObservationModel } from './g20M24Model'

const root = resolve(__dirname, '../../..')

export interface G20M24Fixture {
  directory: string
  workspace: string
  profile: string
  courseFile: string
}

export function createG20M24Fixture(): G20M24Fixture {
  const base = join(root, 'output/g20/m24/g20M24Observe')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const courseFile = join(workspace, 'm24-observe.h5lesson')
  writeFileSync(courseFile, serializeG20M24ObservationModel())
  return { directory, workspace, profile: join(directory, 'profile'), courseFile }
}

export interface G20M24RuntimeCapture {
  console: string[]
  pageErrors: string[]
  failedRequests: string[]
}

export async function launchG20M24App(fixture: G20M24Fixture) {
  const capture: G20M24RuntimeCapture = { console: [], pageErrors: [], failedRequests: [] }
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${fixture.profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20_000)
  page.on('console', message => { if (message.type() === 'error') capture.console.push(message.text()) })
  page.on('pageerror', error => capture.pageErrors.push(error.stack ?? error.message))
  page.on('requestfailed', request => capture.failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
  return { app, page, capture }
}

export async function createG20M24Connection(page: Page, endpoint: string): Promise<string> {
  await expect(page.getByLabel('给创作助手发消息', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '切换模型', exact: true }).click()
  await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
  await page.getByLabel('供应商标识', { exact: true }).fill('fixture-g20-m24')
  await page.getByLabel('账号标识', { exact: true }).fill('local-m24-observe')
  await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
  await page.getByLabel('API Key', { exact: true }).fill('fixture-only-no-real-account')
  await page.getByLabel('计费来源', { exact: true }).selectOption('unknown')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
  const settings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
  const connection = settings.connections.find(entry => entry.connection.provider === 'fixture-g20-m24')
  if (!connection) throw new Error('The local M24 model connection was not persisted')
  return connection.connection.id
}

async function chooseRole(page: Page, connectionId: string, label: string, model: string | null) {
  const connection = page.getByLabel(`${label}连接`, { exact: true })
  const modelChoice = page.getByLabel(`${label}模型`, { exact: true })
  await connection.selectOption(connectionId)
  if (model === null) {
    await connection.selectOption('')
    return
  }
  await expect.poll(async () => modelChoice.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
    .toContain(model)
  await modelChoice.selectOption(model)
}

export async function configureG20M24Roles(page: Page, connectionId: string,
  conversationModel: string, visionModel: string | null, verifyVision: boolean) {
  const settingsDialog = page.getByRole('dialog', { name: '连接账号', exact: true })
  if (!(await settingsDialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
  }
  await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
  await chooseRole(page, connectionId, '对话与规划', conversationModel)
  if (visionModel) await chooseRole(page, connectionId, '视觉理解', visionModel)
  else await chooseRole(page, connectionId, '视觉理解', null)
  await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '模型角色已保存' })).toBeVisible()
  if (verifyVision && visionModel) {
    await page.getByRole('button', { name: '验证视觉理解视觉能力', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '视觉能力已验证' })).toBeVisible({ timeout: 30_000 })
  }
  await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
}

export async function chooseG20M24Workspace(app: ElectronApplication, page: Page, workspace: string) {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await expect(page.getByRole('tree', { name: '工作空间文件' })).toBeVisible()
}

export async function openG20M24Course(page: Page): Promise<DocumentSnapshot> {
  await page.locator('.lesson-directory-tree').getByRole('button', { name: 'm24-observe.h5lesson', exact: true }).dblclick()
  await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /^m24-observe\.h5lesson/ })).toHaveAttribute('aria-selected', 'true')
  const deepEdit = page.getByRole('button', { name: '深度编辑', exact: true })
  if (await deepEdit.count()) await deepEdit.click()
  await expect(page.getByRole('navigation', { name: '场景与页面导航', exact: true })).toBeVisible()
  const listed = await page.evaluate(async () => window.desktopAPI!.documents!.list())
  const course = listed.find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith('m24-observe.h5lesson'))
  if (!course) throw new Error('Course V9 file was not opened in a DocumentSession')
  return course
}

export async function readG20M24Document(page: Page, documentId: string) {
  return page.evaluate(id => window.desktopAPI!.documents!.read(id), documentId)
}

export async function selectG20M24Page(page: Page, index: number) {
  const nav = page.getByRole('navigation', { name: '场景与页面导航', exact: true })
  const pages = nav.locator('li[data-kind="slide"] button[aria-label]')
  await pages.nth(index).click()
  await expect(pages.nth(index)).toHaveAttribute('aria-current', 'page')
}

export async function selectG20M24Object(page: Page, itemId: string) {
  const item = page.locator(`[data-slide-layer-item="${itemId}"]:visible`).first()
  await expect(item).toBeVisible()
  const bounds = await item.boundingBox()
  if (!bounds) throw new Error(`Slide object ${itemId} has no visible bounds`)
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(page.getByRole('toolbar', { name: '选中对象快捷工具', exact: true })).toBeVisible()
}

export async function captureG20M24EditorState(page: Page, documentId: string) {
  const snapshot = await readG20M24Document(page, documentId)
  const view = await page.evaluate(() => {
    const selectedPage = document.querySelector('[aria-label="场景与页面导航"] [aria-current="page"]')
    const stage = document.querySelector<HTMLElement>('.canvas-stage-stack')
    const rect = stage?.getBoundingClientRect()
    const toolbar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="选中对象快捷工具"]')
    const toolbarRect = toolbar?.getBoundingClientRect()
    return {
      selectedPage: selectedPage?.getAttribute('aria-label') ?? null,
      selectionToolbar: toolbar ? { visible: getComputedStyle(toolbar).visibility !== 'hidden', text: toolbar.innerText,
        rect: toolbarRect ? { x: toolbarRect.x, y: toolbarRect.y, width: toolbarRect.width, height: toolbarRect.height } : null } : null,
      viewport: stage && rect ? { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop, transform: getComputedStyle(stage).transform,
        data: { zoom: stage.dataset.zoom ?? null, panning: stage.dataset.panning ?? null } } : null,
    }
  })
  return { revision: snapshot.revision, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth,
    modelKind: snapshot.model.kind, ...view }
}

export async function sendG20M24Task(page: Page, id: string, instruction: string) {
  await page.getByLabel('给创作助手发消息', { exact: true }).fill(`M24观察:${id} ${instruction}`)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

export async function editG20M24SelectedTitle(page: Page, itemId: string, value: string) {
  const toolbar = page.getByRole('toolbar', { name: '选中对象快捷工具', exact: true })
  await toolbar.getByRole('button', { name: '编辑文字', exact: true }).click()
  const editor = page.getByTestId('text-edit-overlay')
  await expect(editor).toBeVisible()
  await editor.fill(value)
  await editor.press('Control+Enter')
  await expect(page.locator(`[data-slide-layer-item="${itemId}"]:visible`)).toContainText(value)
}

export async function attachG20M24Evidence(fixture: G20M24Fixture, page: Page, app: ElectronApplication,
  info: TestInfo, facts: Record<string, unknown>, capture: G20M24RuntimeCapture) {
  facts.runDirectory = fixture.directory
  facts.workspace = fixture.workspace
  facts.runtime = capture
  try {
    facts.pageText = await page.locator('body').innerText().then(value => value.slice(0, 5000))
    facts.openWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
      destroyed: window.isDestroyed(), url: window.webContents.getURL(),
    })))
  } catch (error) { facts.evidenceError = error instanceof Error ? error.message : String(error) }
  const path = join(fixture.directory, 'evidence.json')
  writeFileSync(path, JSON.stringify(facts, null, 2) + '\n', 'utf8')
  await info.attach('M24-T03 evidence.json', { path, contentType: 'application/json' })
  await page.screenshot({ path: join(fixture.directory, 'final-window.png'), fullPage: true }).catch(() => undefined)
  await info.attach('M24-T03 editor screenshot', { path: join(fixture.directory, 'final-window.png'), contentType: 'image/png' }).catch(() => undefined)
}

export async function closeG20M24App(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow, app: electronApp }) => {
    BrowserWindow.getAllWindows().forEach(window => { if (!window.isDestroyed()) window.destroy() })
    electronApp.exit(0)
  }).catch(() => {})
  const close = app.close().catch(() => undefined)
  const timedOut = await Promise.race([close.then(() => false), new Promise<boolean>(resolve => setTimeout(() => resolve(true), 8_000))])
  const electronChild = app.process()
  if (timedOut && electronChild.pid && electronChild.exitCode === null) {
    try {
      if (globalThis.process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(electronChild.pid), '/T', '/F'], { stdio: 'ignore' })
      else electronChild.kill()
    } catch { /* The owned Electron process may already have exited. */ }
    await Promise.race([close, new Promise<void>(resolve => setTimeout(resolve, 2_000))])
  }
}
