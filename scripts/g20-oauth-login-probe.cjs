const { _electron: electron } = require('@playwright/test')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

// Real browser login only. No model request and no credential material in evidence.
;(async () => {
  const root = resolve(__dirname, '..')
  const directory = join(root, 'output/g20/providers/oauth')
  mkdirSync(directory, { recursive: true })
  const profile = join(process.env.APPDATA, 'Guoling-2.0-engineering-oauth')
  const environment = { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_E2E_BACKGROUND: '1' }
  delete environment.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: environment })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '切换模型', exact: true }).click()
  const current = await page.evaluate(() => window.desktopAPI.executionSettings.read())
  const known = current.connections.find(entry => entry.connection.auth.kind === 'oauth' && !entry.revoked)
  if (known) await page.getByLabel('选择连接', { exact: true }).selectOption(known.connection.id)
  else {
    await page.getByLabel('认证方式', { exact: true }).selectOption('oauth')
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '连接设置已保存' }).waitFor()
  }
  if (!known?.hasCredential) await page.getByRole('button', { name: '登录当前 ChatGPT 账号', exact: true }).click()
  const deadline = Date.now() + 15 * 60_000
  let previous = ''
  while (Date.now() < deadline) {
    const view = await page.evaluate(() => window.desktopAPI.executionSettings.read())
    const entry = view.connections.find(item => item.connection.auth.kind === 'oauth' && !item.revoked)
    const alerts = await page.getByRole('dialog', { name: '模型连接与角色' }).getByRole('alert').allTextContents()
    const state = { time: new Date().toISOString(), status: entry?.hasCredential ? 'connected-unverified' : alerts.length ? 'failed' : 'awaiting-browser-login',
      connectionId: entry?.connection.id, revision: entry?.connection.revision, secureStorageAvailable: view.secureStorageAvailable,
      profile, modelRequests: 0, ...(alerts.length ? { errors: alerts } : {}) }
    writeFileSync(join(directory, 'login-status.json'), JSON.stringify(state, null, 2))
    if (state.status !== previous) { console.log(JSON.stringify({ status: state.status, errors: state.errors })); previous = state.status }
    if (state.status === 'connected-unverified' || state.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  await page.screenshot({ path: join(directory, 'login-settings.png') })
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) })
  await app.close().catch(() => {})
})().catch(error => { console.error(error.message); process.exitCode = 1 })
