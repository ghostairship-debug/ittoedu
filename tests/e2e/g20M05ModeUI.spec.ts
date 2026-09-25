import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeSelectionApp, launchSelectionApp, markdownSource, openSelectionFile, readSelectionDocument, selectVisibleText, selectionFixtures, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'

// M05-T01/T04 in the real window. Mode switches, saves and reopen are local; the
// fixture model must receive no request at all.
const body = (page: Page) => page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
const markdownOf = async (page: Page, id: string) => {
  const snapshot = await readSelectionDocument(page, id)
  if (snapshot.model.kind !== 'markdown') throw new Error('Expected a Markdown document')
  return { source: snapshot.model.source, dirty: snapshot.dirty }
}

test('M05-T01/T04 body is the default editable mode and an incomplete source draft survives switch, save and reopen without model calls', async ({}, info) => {
  test.setTimeout(240_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const filename = join(fixture.workspace, 'selection.md')
  const evidence: Record<string, unknown> = {}
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'selection.md')
    const region = page.getByRole('region', { name: '教学文档 selection.md', exact: true })
    const sourceView = region.getByRole('textbox', { name: '正文源文编辑', exact: true })
    const card = page.getByLabel('当前编辑目标', { exact: true })

    // T01: 正文 is the default, editable mode; the other mode is 源文; no “排版” naming.
    await expect(body(page)).toBeVisible()
    await expect(body(page)).toBeEditable()
    await expect(sourceView).toHaveCount(0)
    await expect(region.getByRole('button', { name: '源文', exact: true })).toBeVisible()
    await expect(region.getByRole('button', { name: '排版', exact: true })).toHaveCount(0)
    expect(await region.innerText()).not.toContain('排版')
    await selectVisibleText(page, body(page), '先预测😀')
    await expect(card).toBeVisible()
    await expect(card.getByLabel('AI 指令', { exact: true })).toBeEnabled()
    await card.getByRole('button', { name: '保留目标', exact: true }).click()
    await body(page).getByText('乙段：保持原样。', { exact: true }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('乙段：保持原样。')
    await expect(card).toBeVisible()
    await expect(card.getByLabel('AI 指令', { exact: true })).toBeEnabled()
    await expect(card.getByRole('status').filter({ hasText: '暂时无法精确对应源文' })).toHaveCount(0)
    evidence.t01 = { defaultMode: '正文', editable: true, mouseSelection: '先预测😀', keyboardSelection: '乙段：保持原样。', aiEntry: 'enabled' }

    // T04: a body edit, then an unfinished fence in 源文. Collapse the keyboard selection
    // first: a mouse press inside selected text starts a drag of that text, not a new range.
    await page.keyboard.press('End')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
    // With no selected text the floating target card closes; wait for that before a new drag.
    await expect(card).toBeHidden({ timeout: 5_000 })
    await selectVisibleText(page, body(page), '保持原样')
    await page.keyboard.insertText('人工修改')
    const edited = markdownSource.replace('保持原样', '人工修改')
    await expect.poll(async () => (await markdownOf(page, document.documentId)).source).toBe(edited)
    await region.getByRole('button', { name: '源文', exact: true }).click()
    await expect(sourceView).toBeVisible()
    await expect(sourceView).toContainText('乙段：人工修改。')
    await sourceView.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n```js\nunfinished')
    const diagnostics = region.getByRole('alert')
    await expect(diagnostics).toBeVisible()
    // Returning to 正文 is refused while the source is incomplete; the draft stays as typed.
    await region.getByRole('button', { name: '正文', exact: true }).click()
    await expect(sourceView).toBeVisible()
    await expect(body(page)).toHaveCount(0)
    await expect(sourceView).toContainText('unfinished')
    const draft = await markdownOf(page, document.documentId)
    // The draft is exactly what was typed: the body edit plus an unclosed fence, nothing
    // auto-closed and nothing dropped. It is the expected byte content for save and reopen.
    const incomplete = draft.source
    expect(incomplete.startsWith(edited.trimEnd())).toBe(true)
    expect(incomplete).toMatch(/\n```js\nunfinished$/)
    evidence.incompleteDraft = { source: draft.source, dirty: draft.dirty, diagnostics: await diagnostics.innerText() }

    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(filename, 'utf8')).toBe(incomplete)
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 selection.md', exact: true }).click()
    const reopened = await openSelectionFile(page, fixture.workspace, 'selection.md')
    await expect(sourceView).toBeVisible()
    await expect(diagnostics).toBeVisible()
    expect((await markdownOf(page, reopened.documentId)).source).toBe(incomplete)

    // Fix the fence and return to the same body.
    await sourceView.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n```')
    await expect(diagnostics).toHaveCount(0)
    await region.getByRole('button', { name: '正文', exact: true }).click()
    await expect(body(page)).toBeVisible()
    await expect(body(page)).toContainText('乙段：人工修改。')
    await expect(body(page)).toContainText('unfinished')
    const fixed = (await markdownOf(page, reopened.documentId)).source
    expect(fixed.startsWith(incomplete)).toBe(true)
    expect(fixed).toMatch(/unfinished\n```$/)
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(filename, 'utf8')).toBe(fixed)
    expect(server.requests).toHaveLength(0)
    expect(errors).toEqual([])
    Object.assign(evidence, { caseIds: ['M05-T01', 'M05-T04'], savedIncomplete: incomplete, reopenedMode: '源文', fixed, requests: server.requests.length, errors })
    const path = join(fixture.directory, 'm05-mode-evidence.json')
    writeFileSync(path, JSON.stringify(evidence, null, 2))
    await info.attach('M05 mode evidence', { path, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})
