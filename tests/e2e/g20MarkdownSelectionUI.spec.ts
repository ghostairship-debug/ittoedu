import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeSelectionApp, finishRound, heldRound, launchSelectionApp, openSelectionFile, readSelectionDocument, selectionFixtures, selectionServer, selectVisibleText, setupSelectionUI } from './helpers/g20SelectionHarness'

const source = '# 标题\r\n\r\n> 引用中文\r\n> 下一行\r\n\r\n后文 https://e.com\r\n'
const body = (page: Page) => page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })

/** Read DOM text geometry, then make one real mouse selection across visible text. */
async function selectAcrossVisibleText(page: Page, editor: Locator, firstText: string, lastText: string) {
  await editor.scrollIntoViewIfNeeded()
  const points = await editor.evaluate((root, { firstText, lastText }) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Node[] = []
    let current: Node | null
    while ((current = walker.nextNode())) nodes.push(current)
    const find = (value: string) => {
      for (const node of nodes) {
        const at = (node.textContent ?? '').indexOf(value)
        if (at >= 0) return { node, at }
      }
      throw new Error(`Cannot find visible quote text: ${value}`)
    }
    const first = find(firstText), second = find(lastText)
    const start = document.createRange(), end = document.createRange()
    start.setStart(first.node, first.at); start.setEnd(first.node, first.at + 1)
    end.setStart(second.node, second.at + lastText.length - 1); end.setEnd(second.node, second.at + lastText.length)
    const a = start.getBoundingClientRect(), b = end.getBoundingClientRect()
    if (!a.width || !b.width) throw new Error('Text has no visible mouse target')
    return { ax: a.left + 0.1, ay: a.top + a.height / 2, bx: b.right - 0.1, by: b.top + b.height / 2 }
  }, { firstText, lastText })
  await page.mouse.move(points.ax, points.ay); await page.mouse.down()
  await page.mouse.move(points.bx, points.by, { steps: 14 }); await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain(firstText)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain(lastText)
}

test('M05-T02 real Markdown body selection changes CRLF quote and bare URL without altering their surrounding source', async () => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), filename = join(fixture.workspace, 'complex.md')
  writeFileSync(filename, source)
  const server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const before = await openSelectionFile(page, fixture.workspace, 'complex.md')
    const editor = body(page)
    await expect(editor).toBeVisible()
    await selectAcrossVisibleText(page, editor, '引用中文', '下一行')
    const quoteCard = page.getByLabel('当前编辑目标', { exact: true })
    await expect(quoteCard).toBeVisible()
    await quoteCard.getByLabel('AI 指令', { exact: true }).fill('把两行引文分别改成观察结果和说明理由')
    const quoteRound = server.armMulti('markdown-quote-lines', 'markdown-range', ['观察结果', '说明理由'])
    await quoteCard.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect(page.getByText('markdown-quote-lines 已返回正式结果。', { exact: true })).toBeVisible()
    expect(quoteRound.error).toBeUndefined()
    expect(quoteRound.multi?.readTexts).toEqual(['引用中文', '下一行'])
    expect(quoteRound.references?.[0].writable).toHaveLength(2)
    const afterQuote = '# 标题\r\n\r\n> 观察结果\r\n> 说明理由\r\n\r\n后文 https://e.com\r\n'
    await expect.poll(async () => (await readSelectionDocument(page, before.documentId)).model).toMatchObject({ source: afterQuote })
    const region = page.getByRole('region', { name: '教学文档 complex.md', exact: true })
    await region.getByRole('button', { name: '源文', exact: true }).click()
    const sourceView = region.getByRole('textbox', { name: '正文源文编辑', exact: true })
    await expect(sourceView).toContainText('> 观察结果')
    await expect(sourceView).toContainText('> 说明理由')
    await expect(sourceView).toContainText('后文 https://e.com')
    await region.getByRole('button', { name: '正文', exact: true }).click()

    await selectVisibleText(page, body(page), 'https://e.com')
    const urlCard = page.getByLabel('当前编辑目标', { exact: true })
    await urlCard.getByLabel('AI 指令', { exact: true }).fill('只把选中的网址改成 https://sample.org')
    const urlRound = server.arm('markdown-bare-url', 'markdown-range', 'https://sample.org')
    await urlCard.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await heldRound(urlRound)
    expect(urlRound.readText).toBe('https://e.com')
    await finishRound(page, urlRound)
    const afterUrl = afterQuote.replace('https://e.com', 'https://sample.org')
    await expect.poll(async () => (await readSelectionDocument(page, before.documentId)).model).toMatchObject({ source: afterUrl })
    await region.getByRole('button', { name: '源文', exact: true }).click()
    await expect(sourceView).toContainText('> 观察结果')
    await expect(sourceView).toContainText('> 说明理由')
    await expect(sourceView).toContainText('后文 https://sample.org')
    expect((await readSelectionDocument(page, before.documentId)).undoDepth).toBe(before.undoDepth + 3)
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(filename, 'utf8')).toBe(afterUrl)
    await page.screenshot({ path: join(fixture.directory, 'complex-source-after.png') })
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'm05-complex-evidence.json'), JSON.stringify({ coverage: 'M05-T02 CRLF quote and bare URL real UI subset', before, quoteRound, urlRound, afterUrl, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(fixture.directory, 'm05-complex-failure.png') }).catch(() => {})
    writeFileSync(join(fixture.directory, 'm05-complex-failure.json'), JSON.stringify({ rounds: server.rounds, requests: server.requests, errors }, null, 2)); throw error
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M05-T03 an untitled Markdown body accepts typed text and immediate local AI edit without first saving', async () => {
  test.setTimeout(120_000)
  const fixture = selectionFixtures(), server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    await page.getByLabel('新建标签页').click()
    await page.getByLabel('Markdown 文档名').fill('未保存改写')
    await page.getByRole('button', { name: '创建文档', exact: true }).click()
    const region = page.getByRole('region', { name: '教学文档 未保存改写.md', exact: true })
    const editor = body(page)
    await expect(editor).toBeVisible()
    await editor.click(); await page.keyboard.type('先预测😀')
    await expect(editor).toContainText('先预测😀')
    const documentId = await page.evaluate(async () => (await window.desktopAPI.documents!.list())
      .find(item => item.binding.kind === 'untitled' && item.binding.suggestedName === '未保存改写.md')?.documentId)
    if (!documentId) throw new Error('Untitled Markdown was not created')
    await expect.poll(async () => {
      const snapshot = await readSelectionDocument(page, documentId)
      return snapshot.model.kind === 'markdown' ? snapshot.model.source.includes('先预测😀') : false
    }).toBe(true)
    const typed = await readSelectionDocument(page, documentId)
    if (typed.model.kind !== 'markdown') throw new Error('Untitled document is not Markdown')
    expect(typed.binding.kind).toBe('untitled')
    await selectVisibleText(page, editor, '先预测😀')
    const card = page.getByLabel('当前编辑目标', { exact: true })
    await card.getByLabel('AI 指令', { exact: true }).fill('仅把刚输入的选中文字改成先讨论😀')
    const round = server.arm('untitled-body-selection', 'markdown-range', '先讨论😀')
    await card.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await heldRound(round)
    expect(round.readText).toBe('先预测😀')
    await finishRound(page, round)
    const expected = typed.model.source.replace('先预测😀', '先讨论😀')
    await expect.poll(async () => (await readSelectionDocument(page, documentId)).model).toMatchObject({ source: expected })
    const changed = await readSelectionDocument(page, documentId)
    expect(changed.binding.kind).toBe('untitled')
    expect(changed.dirty).toBe(true)
    expect(changed.undoDepth).toBe(typed.undoDepth + 1)
    await expect(editor).toContainText('先讨论😀')
    await expect(page.locator('.workspace-document-status')).toHaveAttribute('data-save-state', 'dirty')
    await region.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, documentId)).model).toMatchObject({ source: typed.model.source })
    await region.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, documentId)).model).toMatchObject({ source: expected })
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'm05-untitled-evidence.json'), JSON.stringify({ coverage: 'M05-T03', typed, changed, round, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(fixture.directory, 'm05-untitled-failure.png') }).catch(() => {})
    writeFileSync(join(fixture.directory, 'm05-untitled-failure.json'), JSON.stringify({ rounds: server.rounds, requests: server.requests, errors }, null, 2)); throw error
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M05-T02 mapped heading, visible spaces, list continuation, link, table and emoji retain source; an unmapped middle object refuses the edit', async () => {
  test.setTimeout(240_000)
  const fixture = selectionFixtures(), filename = join(fixture.workspace, 'full-contract.md')
  let expectedSource = '# 标题😀\r\n\r\n\r\n  可见空格  \r\n\r\n- 首行\r\n  续行 [链接](https://e.com)\r\n- 次项\r\n\r\n| 左列 | 右列 |\r\n| --- | --- |\r\n| 表格甲 | 表格乙 |\r\n\r\n前段\r\n\r\n---\r\n\r\n后段\r\n'
  writeFileSync(filename, expectedSource)
  const server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const before = await openSelectionFile(page, fixture.workspace, 'full-contract.md')
    const editor = body(page)
    await expect(editor).toBeVisible()
    const edits: { id: string; selected: string; replacement: string; source: string }[] = []
    for (const [id, selected, replacement] of [
      ['heading-emoji', '标题😀', '新标题😀'],
      ['visible-spaces', '可见空格', '空格已核对'],
      ['list-continuation', '续行', '延续'],
      ['link-label', '链接', '说明'],
      ['table-cell', '表格乙', '表格丁'],
    ] as const) {
      await selectVisibleText(page, editor, selected)
      const card = page.getByLabel('当前编辑目标', { exact: true })
      await card.getByLabel('AI 指令', { exact: true }).fill(`只把选中的 ${selected} 改成 ${replacement}`)
      const round = server.arm(id, 'markdown-range', replacement)
      await card.getByRole('button', { name: '发送', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
      await heldRound(round)
      expect(round.readText).toBe(selected)
      await finishRound(page, round)
      expectedSource = expectedSource.replace(selected, replacement)
      await expect.poll(async () => (await readSelectionDocument(page, before.documentId)).model).toMatchObject({ source: expectedSource })
      edits.push({ id, selected, replacement, source: expectedSource })
    }
    const region = page.getByRole('region', { name: '教学文档 full-contract.md', exact: true })
    await region.getByRole('button', { name: '源文', exact: true }).click()
    const sourceView = region.getByRole('textbox', { name: '正文源文编辑', exact: true })
    await expect(sourceView).toContainText('新标题😀')
    await expect(sourceView).toContainText('  空格已核对  ')
    await expect(sourceView).toContainText('  延续 [说明](https://e.com)')
    await expect(sourceView).toContainText('| 表格甲 | 表格丁 |')
    await region.getByRole('button', { name: '正文', exact: true }).click()

    const priorCard = page.getByLabel('当前编辑目标', { exact: true })
    if (await priorCard.isVisible()) await priorCard.getByRole('button', { name: '保留目标', exact: true }).click()
    const priorRequests = server.requests.length
    await body(page).getByText('前段', { exact: true }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Control+Shift+End')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('前段')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('后段')
    const invalidCard = page.getByLabel('当前编辑目标', { exact: true })
    await expect(invalidCard).toBeVisible()
    await expect(invalidCard.getByRole('status')).toContainText('暂时无法精确对应源文')
    await invalidCard.getByLabel('AI 指令', { exact: true }).fill('改写跨越分隔线的内容')
    await expect(invalidCard.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
    expect(server.requests).toHaveLength(priorRequests)
    await expect.poll(async () => (await readSelectionDocument(page, before.documentId)).model).toMatchObject({ source: expectedSource })
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(filename, 'utf8')).toBe(expectedSource)
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'm05-full-contract-evidence.json'), JSON.stringify({ coverage: 'M05-T02 remaining full-contract UI', before, edits, invalidSelection: { priorRequests, requestsAfter: server.requests.length }, expectedSource, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(fixture.directory, 'm05-full-contract-failure.png') }).catch(() => {})
    writeFileSync(join(fixture.directory, 'm05-full-contract-failure.json'), JSON.stringify({ rounds: server.rounds, requests: server.requests, expectedSource, errors }, null, 2)); throw error
  } finally { await closeSelectionApp(app); await server.close() }
})
