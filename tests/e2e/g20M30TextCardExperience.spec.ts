import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { closeSelectionApp, launchSelectionApp, selectVisibleText } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const name = 'm30-selection.md'
const source = '# 选区体验\n\n第一段：先观察叶片，再预测变化。\n\n第二段：解释叶片变化的原因。\n\n'
  + Array.from({ length: 80 }, (_, index) => `观察记录 ${index + 1}：这一段用于验证滚动定位。`).join('\n\n') + '\n'

test('M30-T03 text card follows the real desktop selection and keeps its draft through explicit rebind', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(180_000)
  const base = join(root, 'output/g20/b24/text-card-e2e')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, name), source)
  const app = await launchSelectionApp(directory)
  const page = await app.firstWindow()
  const errors: string[] = []
  const evidence: Record<string, unknown> = { run: directory }
  try {
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeEnabled()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name, exact: true }).dblclick()
    const editor = page.locator('.ProseMirror').filter({ visible: true }).first()
    await expect(editor).toBeVisible()

    await selectVisibleText(page, editor, '先观察叶片')
    const quickBar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
    await quickBar.getByRole('button', { name: 'AI 修改', exact: true }).click()
    const card = page.getByRole('dialog', { name: /^AI 修改：“先观察叶片”/ }).filter({ visible: true })
    await expect(card).toBeVisible()
    await card.getByRole('textbox', { name: 'AI 修改要求' }).fill('改成更简短的观察提示')
    const initialViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const first = await card.boundingBox()
    if (!first) throw new Error('Text card has no bounds')
    await page.screenshot({ path: join(directory, 'text-card-open.png') })

    // Selecting a different sentence must not move the old card onto that sentence or guess it is the same target.
    await selectVisibleText(page, editor, '解释叶片变化')
    await expect(card).toBeVisible()
    await expect(card.getByRole('status')).toContainText('原选区暂不在视图中')
    const beforeRebind = await card.boundingBox()
    expect(beforeRebind?.x).toBeGreaterThanOrEqual(0)
    await expect(card.getByRole('textbox', { name: 'AI 修改要求' })).toHaveValue('改成更简短的观察提示')
    await card.locator('.element-text-card__binding').getByRole('button', { name: '重新选择文字并保留输入' }).click()
    await expect(card.getByRole('status')).toContainText('请重新选中文字')
    await quickBar.getByRole('button', { name: 'AI 修改', exact: true }).click()
    const rebound = page.getByRole('dialog', { name: /^AI 修改：“解释叶片变化”/ }).filter({ visible: true })
    await expect(rebound).toBeVisible()
    await expect(rebound.getByRole('textbox', { name: 'AI 修改要求' })).toHaveValue('改成更简短的观察提示')
    evidence.rebind = { first, beforeRebind, after: await rebound.boundingBox() }
    await page.screenshot({ path: join(directory, 'text-card-rebound.png') })

    // The selected text moves out of view on the real document scroller; the card stays reachable with a reselect path.
    const scrolled = await editor.evaluate(element => {
      if (!(element instanceof HTMLElement)) return null
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight + 200) {
          const before = node.scrollTop
          node.scrollTop += Math.max(500, node.clientHeight)
          node.dispatchEvent(new Event('scroll', { bubbles: true }))
          return { before, after: node.scrollTop, tag: node.tagName, className: node.className }
        }
      }
      return null
    })
    evidence.scroll = scrolled
    expect(scrolled?.after).toBeGreaterThan(scrolled?.before ?? 0)
    await expect(rebound.getByRole('status')).toContainText(/原选区暂不在视图中|请重新选中文字/)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(950, 600))
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(viewport.width).toBeLessThan(initialViewport.width)
    expect(viewport.height).toBeLessThan(initialViewport.height)
    const bounds = await rebound.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
    evidence.resized = { initialViewport, viewport, bounds }
    await page.screenshot({ path: join(directory, 'text-card-resized.png') })
    evidence.errors = errors
    expect(errors).toEqual([])
  } finally {
    evidence.errors ??= errors
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await closeSelectionApp(app)
  }
})
