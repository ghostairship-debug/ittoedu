import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { chooseM23Workspace, closeM23, launchM23, openM23Html } from './helpers/g20M23Harness'

test('workbench usability: first task, session filtering and keyboard HTML editing stay reachable', async ({}, info) => {
  test.setTimeout(120_000)
  const fixture = m23Fixture('ux-cycle-20261001')
  const extraNames = Array.from({ length: 6 }, (_, index) => `lesson-${index + 1}-a-long-document-name.html`)
  for (const name of extraNames) writeFileSync(join(fixture.workspace, name), '<!doctype html><html><body><h1>标签导航检查</h1></body></html>')
  const { app, page } = await launchM23(fixture)
  const facts: Record<string, unknown> = { stage: process.env.G20_UX_BASELINE ? 'baseline-capture' : 'verification' }
  const shots = join(fixture.directory, 'shots'); mkdirSync(shots)
  async function shot(name: string) {
    const path = join(shots, `${name}.png`)
    await page.screenshot({ path, fullPage: true })
    await info.attach(name, { path, contentType: 'image/png' })
  }
  try {
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.setMinimumSize(600, 500); window.setContentSize(1440, 900) })
    await chooseM23Workspace(app, page, fixture.workspace)
    const composer = page.getByRole('textbox', { name: '给创作助手发消息', exact: true })
    await expect(composer).toBeVisible()
    await expect(page.getByRole('button', { name: '切换模型', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '告诉我想做什么', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '连接模型', exact: true })).toBeVisible()
    await shot('01-first-task')
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await expect(page.getByRole('group', { name: '对话模型选择', exact: true })).toContainText('还没有可用连接')
    await shot('02-model-menu')
    await page.keyboard.press('Escape')
    const region = await openM23Html(page, 'light-edit.html')
    facts.documentToolbar = await region.evaluate(section => {
      const frame = section.querySelector('iframe')!.getBoundingClientRect()
      const tablist = document.querySelector('[aria-label="打开的文件"]')!.getBoundingClientRect()
      return { frameTop: frame.top, tabsBottom: tablist.bottom, toolbarHeight: frame.top - tablist.bottom }
    })
    expect((facts.documentToolbar as { toolbarHeight: number }).toolbarHeight).toBeLessThan(76)
    await region.getByRole('button', { name: '源码', exact: true }).click()
    await expect(region.locator('.plain-text-document-editor')).toBeVisible()
    await region.getByRole('button', { name: '预览', exact: true }).click()
    await region.getByRole('button', { name: '编辑预览', exact: true }).click()
    await region.frameLocator('iframe[title="HTML 预览"]').locator('#lesson-title').dblclick()
    const overlay = page.getByRole('dialog', { name: '编辑 HTML 文字', exact: true })
    await expect(overlay).toBeVisible()
    await shot('03-html-editing')
    await expect(overlay.getByRole('textbox', { name: 'HTML 文字', exact: true })).toBeFocused()
    facts.editFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
    await overlay.getByRole('textbox', { name: 'HTML 文字', exact: true }).fill('键盘操作保留的标题草稿')
    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()
    await expect(region.getByText('1 处文字草稿尚未应用；保存时一并应用', { exact: true })).toBeVisible()
    // Hidden Electron windows need a paint after the retained-draft strip moves the OOPIF.
    // Capture the actual retained state before the next pointer interaction.
    await shot('03b-escaped-draft')
    await region.frameLocator('iframe[title="HTML 预览"]').locator('#lesson-title').dblclick()
    await expect(overlay.getByRole('textbox', { name: 'HTML 文字', exact: true })).toHaveValue('键盘操作保留的标题草稿')
    await page.keyboard.press('Escape')
    await shot('03c-escaped-again')
    const counter = region.frameLocator('iframe[title="HTML 预览"]').locator('#count-up')
    await counter.dblclick()
    await expect(overlay.getByRole('textbox', { name: 'HTML 文字', exact: true })).toBeFocused()
    await expect(region.frameLocator('iframe[title="HTML 预览"]').locator('#count-value')).toHaveText('计数：0')
    await page.keyboard.press('Escape')
    await region.getByRole('button', { name: '完成编辑', exact: true }).click()
    await shot('03d-interactive-preview')
    await counter.click()
    await expect(region.frameLocator('iframe[title="HTML 预览"]').locator('#count-value')).toHaveText('计数：1')
    facts.htmlKeyboardAndInteraction = { retainedDraft: true, repeatSelection: true, editModeDidNotActivateButton: true, previewButtonInteractive: true }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(760, 650))
    const header = page.locator('.lesson-workspace-toolbar')
    await header.getByRole('button', { name: 'AI 助手', exact: true }).click()
    await expect(composer).toBeVisible()
    await expect(header.getByRole('button', { name: 'AI 助手', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('tablist', { name: '工作台区域', exact: true })).toBeHidden()
    await shot('04-narrow-composer')
    facts.viewport = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect((facts.viewport as { scrollWidth: number; width: number }).scrollWidth).toBeLessThanOrEqual((facts.viewport as { width: number }).width + 2)
    await header.getByRole('button', { name: '资源管理器', exact: true }).click()
    await expect(page.getByRole('tree', { name: '工作空间文件', exact: true })).toBeVisible()
    await header.getByRole('button', { name: '会话列表', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '搜索会话', exact: true })).toBeVisible()
    await header.getByRole('button', { name: '内容', exact: true }).click()
    await expect(region).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    for (const name of extraNames) await openM23Html(page, name)
    facts.activeTabBounds = await page.getByRole('tablist', { name: '打开的文件', exact: true }).evaluate(list => {
      const selected = list.querySelector('[aria-selected="true"]')!.getBoundingClientRect(), container = list.getBoundingClientRect()
      return { left: selected.left, right: selected.right, containerLeft: container.left, containerRight: container.right, scrollLeft: list.scrollLeft, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth }
    })
    const bounds = facts.activeTabBounds as { left: number; right: number; containerLeft: number; containerRight: number }
    expect(bounds.left).toBeGreaterThanOrEqual(bounds.containerLeft - 2)
    expect(bounds.right).toBeLessThanOrEqual(bounds.containerRight + 2)
    await shot('05-many-tabs')
    facts.status = process.env.G20_UX_BASELINE ? 'captured-only' : 'passed'
  } finally {
    writeFileSync(join(fixture.directory, 'evidence.json'), JSON.stringify(facts, null, 2))
    console.log(`Usability evidence: ${fixture.directory}`)
    await closeM23(app)
  }
})
