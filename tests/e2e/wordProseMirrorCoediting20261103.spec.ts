import { expect, test, type Locator } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { launchM20, chooseM20Workspace, m20Row, closeM20, m20Evidence } from './helpers/g20M20Harness'

function word(file: string) {
  const inspection = inspectOfficeContent(readFileSync(file), 'docx')
  if (inspection.format !== 'docx') throw new Error('Expected Word')
  return inspection
}
async function selectText(paragraph: Locator, from: number, to: number) {
  await paragraph.evaluate((element, range) => {
    element.closest<HTMLElement>('[contenteditable=true]')!.focus()
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    const point = (offset: number) => {
      for (const node of nodes) { if (offset <= node.length) return { node, offset }; offset -= node.length }
      throw new Error('Selection offset is outside the paragraph')
    }
    const start = point(range.from), end = point(range.to), selected = document.createRange()
    selected.setStart(start.node, start.offset); selected.setEnd(end.node, end.offset)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(selected)
    document.dispatchEvent(new Event('selectionchange'))
  }, { from, to })
}

test('Word PM handles selection formatting, real rich clipboard paste and table input on the original file', async ({}, info) => {
  test.skip(process.platform !== 'win32')
  test.setTimeout(180000)
  const base = resolve('output/office-coedit-20261103/word-pm-ui'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }, name = '正文选择与粘贴.docx', file = join(workspace, name)
  const created = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [
    { type: 'paragraph', runs: [{ text: 'Alpha ', bold: true }, { text: 'beta', italic: true }, { text: ' gamma' }] },
    { type: 'paragraph', text: 'Keep this paragraph' }, { type: 'table', rows: [['A1', 'B1'], ['A2', 'B2']] },
  ] })
  const before = unzipSync(created.bytes); before['customXml/preserve.bin'] = Uint8Array.of(7, 44, 255, 0)
  writeFileSync(file, zipSync(before))
  const facts: Record<string, unknown> = { directory, phase: 'launch', boundary: 'Real Electron selection, rich system clipboard and table input; native Windows IME candidate interaction is not asserted here.' }
  const errors: string[] = [], { app, page } = await launchM20(fixture)
  page.on('pageerror', error => errors.push(error.message))
  try {
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    const editor = page.locator('.office-word-editor').filter({ visible: true }), body = editor.locator('[data-word-kernel="prosemirror"]')
    const saved = async () => { await expect(editor.locator('.office-leaf-status')).toHaveText('已保存'); await expect(editor).toHaveAttribute('aria-busy', 'false') }
    await expect(body).toBeVisible({ timeout: 45000 }); await expect(body.locator('table td')).toHaveCount(4)
    facts.phase = 'range-format'
    await selectText(editor.getByRole('textbox', { name: '第 1 段', exact: true }), 6, 10)
    await expect(editor.getByRole('button', { name: '斜体', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await editor.getByRole('button', { name: '下划线', exact: true }).click()
    await expect.poll(() => word(file).paragraphs[0].runs!.filter(run => run.style.underline).map(run => run.text).join('')).toBe('beta')
    await saved()

    facts.phase = 'rich-system-clipboard'
    await selectText(editor.getByRole('textbox', { name: '第 1 段', exact: true }), 6, 10)
    await app.evaluate(({ clipboard }) => clipboard.write({ text: '粘贴第一段\n粘贴第二段', html: '<p><strong>粘贴第一段</strong></p><p><em>粘贴第二段</em></p>' }))
    await body.press('Control+v')
    await expect.poll(() => word(file).paragraphs.slice(0, 3).map(paragraph => paragraph.text)).toEqual(['Alpha 粘贴第一段', '粘贴第二段 gamma', 'Keep this paragraph'])
    await saved()
    expect(word(file).paragraphs[0].runs!.find(run => run.text === '粘贴第一段')?.style.bold).toBe(true)
    expect(word(file).paragraphs[1].runs!.find(run => run.text === '粘贴第二段')?.style.italic).toBe(true)

    facts.phase = 'table-input-history'
    await body.locator('td').first().getByRole('textbox').fill('人工表格内容')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => word(file).tables[0][0][0]).toBe('人工表格内容'); await saved()
    await editor.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => word(file).tables[0][0][0]).toBe('A1'); await saved()
    await editor.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => word(file).tables[0][0][0]).toBe('人工表格内容'); await saved()
    const after = unzipSync(readFileSync(file))
    for (const part of Object.keys(before).filter(part => part !== 'word/document.xml')) expect(after[part]).toEqual(before[part])
    await page.screenshot({ path: join(directory, 'word-selection-paste-table.png'), fullPage: true })
    expect(errors).toEqual([]); facts.status = 'passed'; facts.phase = 'complete'; facts.errors = errors
    await m20Evidence(info, fixture, page, facts)
  } catch (error) { facts.errors = errors; await m20Evidence(info, fixture, page, facts, error); throw error }
  finally { await closeM20(app) }
})
