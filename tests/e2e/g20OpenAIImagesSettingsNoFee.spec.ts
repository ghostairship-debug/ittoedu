import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
// Reserved .invalid host: model-directory discovery may run, but this test has no
// reachable provider and never starts an image job.
const apiRoot = 'https://images.example.invalid/tenant/openai'
const model = 'vendor-illustrate-v2'

test('Electron saves and reopens a custom OpenAI Images API connection and image roles without sending an image', async () => {
  test.setTimeout(90_000)
  const output = join(root, 'output/g20/s05/images-settings-no-fee')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !['TEAMOROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'].includes(name.toUpperCase())))
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...childEnv, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '连接账号' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('供应商标识', { exact: true }).fill('vendor-images')
    await dialog.getByLabel('账号标识', { exact: true }).fill('local-no-fee-fixture')
    await dialog.getByLabel('API 地址', { exact: true }).fill(apiRoot)
    await dialog.getByLabel('启用 OpenAI Images API', { exact: true }).check()
    await dialog.getByLabel('API Key', { exact: true }).fill('fixture-only-not-a-real-key')
    await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()

    const saved = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    const connection = saved.connections.find(entry => entry.connection.provider === 'vendor-images')
    expect(connection).toMatchObject({ hasCredential: true, connection: {
      protocol: 'openai-chat', imageProtocol: 'openai-images', baseURL: apiRoot,
      accountId: 'local-no-fee-fixture', auth: { kind: 'api-key' },
    } })
    expect(JSON.stringify(saved)).not.toContain('fixture-only-not-a-real-key')
    const connectionId = connection!.connection.id

    const imageService = dialog.locator('details').filter({ hasText: '可选：图片服务' })
    await imageService.locator('summary').click()
    await imageService.getByLabel('图片账号', { exact: true }).selectOption(connectionId)
    await imageService.getByLabel('自定义图片模型 ID', { exact: true }).fill(model)
    await expect(imageService).toContainText(`${apiRoot}/images/generations`)
    await imageService.getByRole('button', { name: '保存图片服务', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: '图片生成和编辑已选择' })).toBeVisible()
    await dialog.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('选择连接', { exact: true }).selectOption(connectionId)
    await expect(dialog.getByLabel('供应商标识', { exact: true })).toHaveValue('vendor-images')
    await expect(dialog.getByLabel('API 地址', { exact: true })).toHaveValue(apiRoot)
    await expect(dialog.getByLabel('协议', { exact: true })).toHaveValue('OpenAI 兼容 Chat Completions')
    await expect(dialog.getByLabel('启用 OpenAI Images API', { exact: true })).toBeChecked()
    await imageService.locator('summary').click()
    await expect(imageService.getByLabel('图片账号', { exact: true })).toHaveValue(connectionId)
    await expect(imageService.getByLabel('自定义图片模型 ID', { exact: true })).toHaveValue(model)
    await expect(imageService).toContainText(`${apiRoot}/images/generations`)

    const reopened = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    expect(reopened.profile.roles.imageGenerate).toMatchObject({ connectionId, model, parameters: {} })
    expect(reopened.profile.roles.imageEdit).toMatchObject({ connectionId, model, parameters: {} })
    expect(reopened.connections.find(entry => entry.connection.id === connectionId)?.connection)
      .toMatchObject({ protocol: 'openai-chat', imageProtocol: 'openai-images', baseURL: apiRoot })
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0)
      }).catch(() => {})
      await app.close().catch(() => {})
    }
  }
})
