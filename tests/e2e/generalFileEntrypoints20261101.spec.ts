import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeM20, m20Evidence, m20Fixture, m20Snapshot, m20VisibleTextEditor } from './helpers/g20M20Harness'

test('T1 startup file arguments reach the real text editor with their original source', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Startup file acceptance uses Windows Electron.')
  test.setTimeout(90_000)
  const root = resolve(__dirname, '../..'), fixture = m20Fixture()
  const samples = [
    { name: '启动配置.json', source: '\ufeff{"title":"Startup JSON","keep":true}\r\n' },
    { name: 'startup-source.ts', source: 'export const title: string = "Startup TypeScript";\r\n' },
  ]
  const filenames = samples.map(sample => {
    const filename = join(fixture.workspace, sample.name)
    writeFileSync(filename, sample.source, 'utf8')
    return filename
  })
  const evidence: Record<string, unknown> = { case: 'T1 startup file arguments', workspace: fixture.workspace, filenames }
  const errors: string[] = [], network: string[] = []
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${fixture.profile}`, ...filenames],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
  try {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 900) })
    for (const [index, sample] of samples.entries()) {
      const tab = page.locator('.workspace-document-tabs').getByRole('tab', { name: sample.name, exact: true })
      await expect(tab).toBeVisible()
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(m20VisibleTextEditor(page)).toBeVisible()
      await expect(m20VisibleTextEditor(page)).toContainText(sample.name.endsWith('.json') ? 'Startup JSON' : 'Startup TypeScript')
      await expect.poll(() => m20Snapshot(page, filenames[index]!)).toMatchObject({ model: { kind: 'text', source: sample.source }, dirty: false })
      expect(readFileSync(filenames[index]!)).toEqual(Buffer.from(sample.source, 'utf8'))
    }
    expect(errors).toEqual([]); expect(network).toEqual([])
    evidence.pid = app.process().pid; evidence.errors = errors; evidence.network = network
    evidence.status = 'startup-arguments-opened-original-text-in-real-app'
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) {
    evidence.errors = errors; evidence.network = network
    await m20Evidence(info, fixture, page, evidence, error); throw error
  } finally { await closeM20(app) }
})
