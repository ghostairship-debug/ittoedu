import { _electron as electron, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../../src/main/windowVisibility'

const root = resolve(__dirname, '../../..')

export function m20Fixture() {
  const base = join(root, 'output/g20/m20/files'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  return { directory, workspace, profile: join(directory, 'profile') }
}

export async function launchM20(fixture: ReturnType<typeof m20Fixture>) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${fixture.profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 900) })
  return { app, page }
}

export async function chooseM20Workspace(app: ElectronApplication, page: Page, workspace: string) {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await expect(page.getByRole('tree', { name: '工作空间文件' })).toBeVisible()
}

export function m20Tree(page: Page) { return page.getByRole('tree', { name: '工作空间文件' }) }
export function m20Row(page: Page, name: string) { return m20Tree(page).getByRole('button', { name, exact: true }) }
export function m20VisibleTextEditor(page: Page) { return page.getByLabel('纯文本编辑', { exact: true }).filter({ visible: true }) }

export async function m20OpenFile(page: Page, name: string, kind: 'course' | 'markdown' | 'text') {
  await m20Row(page, name).dblclick()
  await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toHaveAttribute('aria-selected', 'true')
  if (kind === 'course') await expect(page.locator('.canvas-stage-stack, .flow-workspace').filter({ visible: true }).first()).toBeVisible()
  if (kind === 'markdown') await expect(page.locator('.ProseMirror').filter({ visible: true }).first()).toBeVisible()
  if (kind === 'text') { await expect(m20VisibleTextEditor(page)).toHaveCount(1); await expect(m20VisibleTextEditor(page)).toBeVisible() }
}

export async function m20Snapshot(page: Page, path: string) {
  return page.evaluate(async filename => (await window.desktopAPI.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path === filename), path)
}

export async function m20Evidence(info: TestInfo, fixture: ReturnType<typeof m20Fixture>, page: Page, facts: Record<string, unknown>, error?: unknown) {
  if (error) facts.failure = error instanceof Error ? error.message : String(error)
  const shot = join(fixture.directory, error ? 'failure.png' : 'accepted.png')
  await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined)
  if (existsSync(shot)) await info.attach(error ? 'M20 failure' : 'M20 result', { path: shot, contentType: 'image/png' })
  writeFileSync(join(fixture.directory, 'evidence.json'), JSON.stringify(facts, null, 2) + '\n')
}

export async function closeM20(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}
