import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
type FixtureMain = typeof globalThis & { __G20_PIXABAY_FIXTURE__: { search(expectedKey?: string): Promise<unknown> } }
test('Pixabay settings use real preload IPC and safeStorage; production image.search injection uses a local response', async () => {
  test.setTimeout(60_000)
  const output = join(root, 'output/g20/pixabay-settings-no-fee')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !['TEAMOROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'PIXABAY_API_KEY', 'GUOLING_PIXABAY_DEFAULT_KEY'].includes(name.toUpperCase())))
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: [join(root, 'tests/e2e/helpers/g20PixabayBootstrap.cjs'), `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...childEnv, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    const section = page.getByRole('region', { name: 'Pixabay 图库' })
    await expect(section).toBeVisible()
    const initial = await page.evaluate(() => window.desktopAPI.pixabaySettings!.read())
    expect(initial).toMatchObject({ hasUserKey: false, secureStorageAvailable: true })
    const search = async (expectedKey?: string) => app!.evaluate(async (_electron, expected) =>
      (globalThis as FixtureMain).__G20_PIXABAY_FIXTURE__.search(expected), expectedKey)
    expect(await search()).toMatchObject({ keyMatched: initial.hasDefaultKey, result: { status: 'results' } })

    await section.getByLabel('Pixabay 自有 API key').fill('pixabay-user-fixture')
    await section.getByRole('button', { name: '保存 Pixabay key', exact: true }).click()
    await expect(section).toContainText('当前使用自有 key。')
    await expect(section.getByLabel('Pixabay 自有 API key')).toHaveValue('')
    const saved = await page.evaluate(() => window.desktopAPI.pixabaySettings!.read())
    expect(saved).toMatchObject({ hasUserKey: true })
    expect(JSON.stringify(saved)).not.toContain('pixabay-user-fixture')
    expect(readFileSync(join(directory, 'profile/workbench-v2/settings/pixabay-key.enc')).toString()).not.toContain('pixabay-user-fixture')
    expect(await search('pixabay-user-fixture')).toMatchObject({ keyMatched: true, result: { status: 'results' } })

    await page.getByRole('button', { name: '关闭模型连接设置' }).click()
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await expect(section).toContainText('当前使用自有 key。')
    await section.getByRole('button', { name: '移除自有 key，使用默认' }).click()
    await expect(section).toContainText(initial.hasDefaultKey ? '当前使用果铃默认 key。' : '当前没有可用 key，搜索将跳过 Pixabay。')
    expect(await search()).toMatchObject({ keyMatched: initial.hasDefaultKey, result: { status: 'results' } })
  } finally { if (app) await app.close() }
})
