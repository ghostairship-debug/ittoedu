import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

test('S05-T05 Electron shows unverified vision refusal and retains image draft without sending or switching route', async () => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/s05/capability-visible')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const image = join(directory, 'unverified.png')
  writeFileSync(image, await sharp({ create: { width: 24, height: 18, channels: 4,
    background: '#4477bb' } }).png().toBuffer())
  let postCount = 0
  const server = createServer((request, response) => {
    if (request.method === 'POST') postCount++
    response.writeHead(500); response.end('Unexpected model request')
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByLabel('供应商标识', { exact: true }).fill('fixture-unverified-vision')
    await page.getByLabel('账号标识', { exact: true }).fill('local-account')
    await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
    await page.getByLabel('API Key', { exact: true }).fill('local-fixture-only')
    await page.getByLabel('计费来源', { exact: true }).selectOption('token-plan')
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
    const initial = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    const chosen = initial.connections.find(entry => entry.connection.provider === 'fixture-unverified-vision')
    expect(chosen).toBeDefined()
    expect(chosen!.connection).toMatchObject({ baseURL: endpoint, accountId: 'local-account',
      billing: { kind: 'token-plan' }, capabilities: { vision: 'unknown' } })
    const connectionId = chosen!.connection.id
    for (const role of ['对话与规划', '视觉理解']) {
      await page.getByLabel(`${role}连接`, { exact: true }).selectOption(connectionId)
      await page.getByLabel(`${role}模型`, { exact: true }).fill('fixture-unverified-model')
    }
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '模型角色已保存' })).toBeVisible()
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()

    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] })
    }, image)
    const composer = page.locator('.attachment-composer')
    await composer.getByRole('button', { name: '添加', exact: true }).click()
    await composer.getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true }).click()
    await expect(composer.getByText('unverified.png', { exact: true })).toBeVisible()
    const input = page.getByLabel('给创作助手发消息')
    await input.fill('请描述这张图片的颜色和形状')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '尚未确认支持图片' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '本次未请求模型' })).toBeVisible()
    await expect(input).toHaveValue('请描述这张图片的颜色和形状')
    await expect(composer.getByText('unverified.png', { exact: true })).toBeVisible()
    expect(postCount).toBe(0)

    const after = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    const actual = after.connections.find(entry => entry.connection.id === connectionId)
    expect(actual?.connection).toMatchObject({ provider: 'fixture-unverified-vision', baseURL: endpoint,
      accountId: 'local-account', billing: { kind: 'token-plan' }, capabilities: { vision: 'unknown' } })
    expect(after.profile.roles.conversation).toMatchObject({ connectionId, model: 'fixture-unverified-model' })
    expect(after.profile.roles.vision).toMatchObject({ connectionId, model: 'fixture-unverified-model' })
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await expect(page.getByRole('button', { name: '切换模型', exact: true })).toContainText('fixture-unverified-model')
    expect(postCount).toBe(0)
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0)
      }).catch(() => {})
      await app.close().catch(() => {})
    }
    server.closeAllConnections()
    await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
})
