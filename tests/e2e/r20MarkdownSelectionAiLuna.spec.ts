import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, readFileSync, cpSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { launchEditor, destroyEditor, openWorkspaceAndSession, runDirectory } from './r19ChatSpecSupport'

/** Paid internal gate. It is opt-in so ordinary E2E collection never starts a model. */
for (const adapter of ['codex', 'opencode', 'claude'] as const) test(`2.0 Markdown 选区 AI：${adapter} 目标、预览应用、撤销重做与重开`, async ({}, testInfo) => {
  test.skip(process.env.R20_MARKDOWN_SELECTION_LUNA_RUN !== '1', 'Opt-in real Luna gate')
  test.setTimeout(20 * 60_000)
  const runRoot = runDirectory('r20-markdown-selection-'), workspace = join(runRoot, 'workspace')
  mkdirSync(workspace)
  const profile = join(runRoot, 'profile')
  let app: ElectronApplication | undefined
  try {
    app = await launchEditor(profile)
    const page = await openWorkspaceAndSession(app, workspace)
    await page.getByLabel('CLI', { exact: true }).selectOption(adapter)

    const capabilities = await page.evaluate(adapter => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter, refresh: true }), adapter)
    const models = capabilities.capabilities?.models ?? []
    const model = adapter === 'codex' ? models.find(model => model.id === 'gpt-5.6-luna')
      : adapter === 'opencode' ? models.find(model => model.id === 'openai/gpt-5.6-luna-fast') ?? models.find(model => model.id === 'openai/gpt-5.6-luna')
      : models.find(model => /^deepseek/i.test(model.id) && /^deepseek/i.test(model.resolvedModel ?? ''))
    expect(model, 'Only a confirmed authorized route may run').toBeTruthy()
    const effort = model!.effort.kind === 'supported'
      ? (model!.effort.values.includes('medium') ? 'medium' : model!.effort.default ?? model!.effort.values[0]!) : null
    const fast = model!.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))
    const config = page.getByRole('region', { name: 'CLI 模型配置', exact: true })
    await config.locator(':scope > details > summary').click()
    await expect(config.getByLabel('模型', { exact: true })).toBeEnabled({ timeout: 60_000 })
    await config.getByLabel('模型', { exact: true }).selectOption(model!.id)
    await expect(config).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })
    if (effort) {
      await config.getByLabel('强度', { exact: true }).selectOption(effort)
      await expect(config).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })
    }
    if (fast && adapter === 'codex') {
      await config.getByLabel('速度', { exact: true }).selectOption(fast.id)
      await expect(config).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })
    }
    await config.locator(':scope > details > summary').click()
    const route = { adapter, model: model!.id, effort, serviceTier: fast?.id ?? null }
    console.log('R20 Markdown route', JSON.stringify(route))
    writeFileSync(testInfo.outputPath('route.json'), JSON.stringify(route, null, 2))

    const name = `selection-${Date.now()}`
    await page.locator('[aria-label="新建标签页"]').click()
    const popover = page.locator('.lesson-new-tab-popover')
    await popover.getByLabel('Markdown 文档名').fill(name)
    await popover.getByRole('button', { name: '创建文档' }).click()
    const filename = `${name}.md`, path = join(workspace, filename)
    const editor = page.getByRole('region', { name: `教学文档 ${filename}`, exact: true })
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: '源文', exact: true }).click()
    await editor.getByRole('textbox', { name: '正文源文编辑' }).fill('# 2.0 选区验收\n\n保留段落：链接 [原样](https://example.com)。\n\n待修改段落。\n')
    await editor.getByRole('button', { name: '排版', exact: true }).click()
    const body = editor.getByRole('textbox', { name: '正文排版编辑' })
    await body.getByText('待修改段落。', { exact: true }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('Alt+Enter')
    const card = page.getByRole('complementary', { name: '当前编辑目标' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('段落')

    const prompt = '请将所选段落替换为：AI 已精确修改。只改选中段落，保留其他内容、链接和标点。'
    if (adapter === 'opencode') {
      await card.getByRole('button', { name: '保留目标', exact: true }).click()
      await page.getByRole('textbox', { name: '给创作助手的消息', exact: true }).fill(prompt)
      await page.getByRole('button', { name: '发送', exact: true }).click()
    } else {
      await card.getByRole('textbox', { name: 'AI 指令' }).fill(prompt)
      await card.getByRole('button', { name: '发送', exact: true }).click()
    }
    const notice = page.getByRole('dialog')
    await expect(notice).toBeVisible({ timeout: 15_000 })
    await expect(notice).toContainText(`文档：${filename}`)
    await expect(notice).toContainText('允许修改：段落')
    await page.screenshot({ path: testInfo.outputPath('first-use-notice.png') })
    const started = Date.now()
    await notice.getByRole('button', { name: '确认并继续', exact: true }).click()
    const permissions: string[] = []
    await expect.poll(async () => {
      const request = page.getByRole('region', { name: 'CLI 授权请求', exact: true }).first()
      if (await request.isVisible()) {
        const description = await request.innerText()
        // Exercise native authorization only for this isolated fixture directory.
        // Unexpected requests fail the gate rather than gaining blanket permission.
        const requestedPath = description.match(/CLI 需要访问此文件：([^\n]+)/)?.[1]?.replace(/\\/g, '/')
        const allowedRoot = runRoot.replace(/\\/g, '/')
        expect(requestedPath === allowedRoot || requestedPath?.startsWith(`${allowedRoot}/`)).toBe(true)
        expect(permissions.length).toBeLessThan(12)
        permissions.push(description)
        await request.getByRole('radio', { name: '仅允许这次', exact: true }).check()
        await request.getByRole('button', { name: '确认选择', exact: true }).click()
        await expect.poll(async () => await request.isVisible() ? await request.innerText() !== description : true, { timeout: 30_000 }).toBe(true)
      }
      return page.getByRole('complementary', { name: 'AI 改动预览' }).isVisible()
    }, { timeout: 10 * 60_000, intervals: [1000] }).toBe(true)
    await expect(page.getByRole('complementary', { name: 'AI 改动预览' })).toContainText('AI 已精确修改')
    const candidateMs = Date.now() - started
    await expect(card).toBeHidden()
    await page.screenshot({ path: testInfo.outputPath('selection-preview.png') })
    await page.getByRole('complementary', { name: 'AI 改动预览' }).getByRole('button', { name: '应用改动' }).click()
    await expect.poll(() => readFileSync(path, 'utf8')).toContain('AI 已精确修改。')
    const applied = readFileSync(path, 'utf8')
    expect(applied).toBe('# 2.0 选区验收\n\n保留段落：链接 [原样](https://example.com)。\n\nAI 已精确修改。\n')
    expect(applied).toContain('保留段落：链接 [原样](https://example.com)。')
    expect(applied).toContain('AI 已精确修改。')
    expect(applied).not.toContain('待修改段落。')

    await editor.getByRole('button', { name: '撤销', exact: true }).click()
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(path, 'utf8')).toContain('待修改段落。')
    await editor.getByRole('button', { name: '重做', exact: true }).click()
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(path, 'utf8')).toContain('AI 已精确修改。')

    await page.getByRole('button', { name: `关闭 ${filename}`, exact: true }).click()
    await page.locator('.lesson-directory-tree button').filter({ hasText: filename }).click()
    const reopened = page.getByRole('region', { name: `教学文档 ${filename}`, exact: true })
    await expect(reopened.getByRole('textbox', { name: '正文排版编辑' })).toContainText('AI 已精确修改。')
    expect(readFileSync(path, 'utf8')).not.toContain('待修改段落。')
    console.log('R20 Markdown selection', JSON.stringify({ file: basename(path), preservedOutsideSelection: true, reopened: true }))
    const recordsRoot = join(profile, 'local-agent', 'v3')
    const nativeConfigurations = readdirSync(recordsRoot, { recursive: true }).filter((file): file is string => typeof file === 'string' && file.endsWith('.json') && !file.endsWith('.display.json'))
      .flatMap(file => (JSON.parse(readFileSync(join(recordsRoot, file), 'utf8')).events ?? []) as { kind: string; capabilities?: { current: { model: string; resolvedModel?: string } } }[])
      .filter(event => event.kind === 'configuration').map(event => event.capabilities!.current)
    expect(nativeConfigurations.length).toBeGreaterThan(0)
    for (const configuration of nativeConfigurations) expect(configuration.resolvedModel ?? configuration.model).toMatch(adapter === 'claude' ? /deepseek/i : /luna/i)
    writeFileSync(testInfo.outputPath('result.json'), JSON.stringify({ route, nativeConfigurations, permissions, candidateMs, totalMs: Date.now() - started, entry: adapter === 'opencode' ? 'chat' : 'card', applied, savedAndReopened: true }, null, 2))
    await page.screenshot({ path: testInfo.outputPath('reopened.png') })
  } finally {
    if (app) {
      const page = await app.firstWindow().catch(() => undefined)
      await page?.screenshot({ path: testInfo.outputPath('last-state.png') }).catch(() => {})
      await testInfo.attach('last-state', { body: await page?.locator('body').innerText().catch(() => '') ?? '', contentType: 'text/plain' })
    }
    cpSync(runRoot, testInfo.outputPath('retained-run'), { recursive: true, filter: path => !/Cache|GPUCache|DawnCache|lockfile/i.test(path) })
    await destroyEditor(app, runRoot)
  }
})
