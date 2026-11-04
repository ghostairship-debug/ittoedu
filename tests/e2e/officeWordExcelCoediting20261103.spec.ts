import { test, expect, type Locator } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { launchM20, chooseM20Workspace, m20Row, closeM20, m20Evidence } from './helpers/g20M20Harness'

function preserveProbe(bytes: Uint8Array) {
  const parts = unzipSync(bytes)
  parts['customXml/guoling-opaque.bin'] = Uint8Array.of(0, 47, 255, 91, 33)
  parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>', '<Override PartName="/customXml/guoling-opaque.bin" ContentType="application/octet-stream"/></Types>'))
  parts['_rels/.rels'] = strToU8(strFromU8(parts['_rels/.rels']).replace('</Relationships>', '<Relationship Id="rIdGuolingOpaque" Type="urn:guoling:preservation-test" Target="customXml/guoling-opaque.bin"/></Relationships>'))
  return zipSync(parts)
}
const word = (filename: string) => {
  const inspection = inspectOfficeContent(readFileSync(filename), 'docx')
  if (inspection.format !== 'docx') throw new Error('Expected DOCX')
  return inspection
}
const book = (filename: string) => {
  const inspection = inspectOfficeContent(readFileSync(filename), 'xlsx')
  if (inspection.format !== 'xlsx') throw new Error('Expected XLSX')
  return inspection
}
async function saved(editor: Locator) {
  // The disk CAS can finish before the renderer receives its snapshot/history.
  // Require the actual user-visible completion before beginning the next edit.
  await expect(editor.locator('.office-leaf-status')).toHaveText('已保存')
  await expect(editor).toHaveAttribute('aria-busy', 'false')
}
async function fillReady(field: Locator, text: string) {
  await expect(field).toBeEditable()
  await field.fill(text)
}

test('Word and Excel support direct editing, structure changes, shared history and cold reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32')
  test.setTimeout(300000)
  const base = resolve('output/office-coedit-20261103/word-excel-ui'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const docName = '会议正文编辑.docx', xlsxName = '预算表共同编辑.xlsx'
  const document = join(workspace, docName), workbook = join(workspace, xlsxName)
  writeFileSync(document, preserveProbe((await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [
    { type: 'paragraph', text: '原始会议标题' }, { type: 'paragraph', text: '待拆分的段落' }, { type: 'paragraph', text: '其他正文必须保留' },
  ] })).bytes))
  writeFileSync(workbook, preserveProbe((await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [
    { name: '预算', rows: [['项目', '数量'], ['材料', 10], ['合计', { formula: 'SUM(B2:B2)' }]] },
    { name: '备忘', rows: [['其他工作表必须保留']] },
  ] })).bytes))
  const originalWord = unzipSync(readFileSync(document)), originalBook = unzipSync(readFileSync(workbook))
  const facts: Record<string, unknown> = { directory, status: 'running', phase: 'launch', boundary: 'Real Electron direct-edit UI and original-file roundtrips; actual model and native Office checks are separate.' }
  const errors: string[] = []
  let { app, page } = await launchM20(fixture, { visible: true })
  page.on('pageerror', error => errors.push(error.message))
  try {
    await chooseM20Workspace(app, page, workspace)
    facts.phase = 'word-direct-text'; const wordStart = Date.now()
    await m20Row(page, docName).dblclick()
    let editor = page.locator('.office-word-editor').filter({ visible: true })
    const first = editor.getByRole('textbox', { name: '第 1 段', exact: true })
    await expect(first).toHaveText('原始会议标题', { timeout: 45000 })
    const wordAutoSave = editor.getByRole('switch', { name: '自动保存' })
    await expect(wordAutoSave).not.toBeChecked()
    await fillReady(first, '人工直接编辑的标题')
    await expect(editor.locator('.office-leaf-status')).toHaveText('有未保存修改')
    expect(word(document).paragraphs[0].text).toBe('原始会议标题')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => word(document).paragraphs[0].text).toBe('人工直接编辑的标题')
    await saved(editor)
    await first.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.getByRole('button', { name: 'AI 修改', exact: true }).click()
    const card = page.getByRole('dialog', { name: /AI 修改：第 1 段/ })
    await expect(card.getByRole('textbox', { name: 'AI 修改要求' })).toBeFocused()
    const selectionLimit = card.getByRole('checkbox', { name: '仅修改此选区' })
    await expect(selectionLimit).not.toBeChecked()
    await selectionLimit.check()
    await expect(selectionLimit).toBeChecked()
    await selectionLimit.uncheck()
    await page.screenshot({ path: join(directory, '00-word-selection-card.png'), fullPage: true })
    await card.getByRole('button', { name: '关闭 AI 卡' }).click()
    await expect(card).toHaveCount(0)

    facts.phase = 'word-paragraph-split'
    const inputRoot = editor.locator('[data-word-kernel="prosemirror"]')
    await inputRoot.evaluate(root => {
      const evidence = { events: [] as unknown[] }
      ;(root as HTMLElement & { wordInputEvidence?: typeof evidence }).wordInputEvidence = evidence
      globalThis.document.addEventListener('selectionchange', event => {
        const selection = globalThis.document.getSelection()
        if (selection?.focusNode && root.contains(selection.focusNode)) evidence.events.push({ type: event.type, trusted: event.isTrusted,
          documentFocused: globalThis.document.hasFocus(), text: selection.focusNode.textContent, offset: selection.focusOffset })
      })
      for (const type of ['keydown', 'beforeinput', 'input', 'compositionstart', 'compositionend']) root.addEventListener(type, event => {
        const key = event as KeyboardEvent, input = event as InputEvent
        queueMicrotask(() => {
          const selection = globalThis.document.getSelection()
          evidence.events.push({ type, key: key.key, keyCode: key.keyCode, isComposing: key.isComposing, inputType: input.inputType, data: input.data,
            trusted: event.isTrusted, defaultPrevented: event.defaultPrevented, target: (event.target as HTMLElement)?.getAttribute('aria-label'),
            busy: root.closest('.office-word-editor')?.getAttribute('aria-busy'), editable: root.getAttribute('contenteditable'),
            anchorText: selection?.anchorNode?.textContent, anchorOffset: selection?.anchorOffset, focusText: selection?.focusNode?.textContent, focusOffset: selection?.focusOffset,
            paragraphs: [...root.querySelectorAll('.office-word-paragraph')].map(paragraph => paragraph.textContent) })
        })
      }, true)
    })
    const second = editor.getByRole('textbox', { name: '第 2 段', exact: true })
    await fillReady(second, '前半段后半段')
    facts.wordFocusAfterFill = await second.evaluate(() => ({ tag: globalThis.document.activeElement?.tagName, label: globalThis.document.activeElement?.getAttribute('aria-label') }))
    // Paragraphs inherit the single ProseMirror contenteditable root. Calling
    // Locator.press on the non-focusable p would first blur that root, so send
    // keys to the existing focused input after establishing the caret by click.
    await second.click()
    await expect(inputRoot).toBeFocused()
    facts.wordFocusAfterPointer = await second.evaluate(() => ({ tag: globalThis.document.activeElement?.tagName, label: globalThis.document.activeElement?.getAttribute('aria-label') }))
    await page.keyboard.press('Home')
    for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowRight')
    facts.wordCaretBeforeEnter = await inputRoot.evaluate(() => ({ text: globalThis.document.getSelection()?.focusNode?.textContent, offset: globalThis.document.getSelection()?.focusOffset }))
    await page.keyboard.press('Enter')
    // Continue immediately: no saved-state wait or new click may mask a body
    // input lock or an acknowledgement that overwrites the new suffix.
    await page.keyboard.type('接续')
    await expect(editor.getByRole('textbox', { name: '第 3 段', exact: true })).toHaveText('接续后半段')
    expect(word(document).paragraphs.map(paragraph => paragraph.text)).toEqual(['人工直接编辑的标题', '待拆分的段落', '其他正文必须保留'])
    await expect(editor).toHaveAttribute('aria-busy', 'false')
    await expect(editor.locator('.office-leaf-status')).toHaveText('有未保存修改')
    facts.wordSplitInput = await inputRoot.evaluate(root => ({ trace: (root as HTMLElement & { wordInputEvidence?: unknown }).wordInputEvidence,
      documentFocused: globalThis.document.hasFocus(), active: globalThis.document.activeElement?.getAttribute('aria-label'),
      paragraphs: [...root.querySelectorAll('.office-word-paragraph')].map(paragraph => paragraph.textContent) }))
    await expect(inputRoot).toBeFocused()

    facts.phase = 'word-continuous-input'
    const typedDuringSave = await inputRoot.evaluate(root => {
      const events = (root as HTMLElement & { wordInputEvidence?: { events: Array<{ type?: string; data?: string; busy?: string; editable?: string; trusted?: boolean }> } }).wordInputEvidence?.events ?? []
      return events.some(event => event.type === 'input' && /[接续]/.test(event.data ?? '') && event.trusted === true && event.busy === 'true' && event.editable === 'true')
    })
    facts.wordTypedWhilePreparing = typedDuringSave
    await page.keyboard.press('Control+s')
    await expect.poll(() => word(document).paragraphs.map(paragraph => paragraph.text)).toEqual(['人工直接编辑的标题', '前半段', '接续后半段', '其他正文必须保留'])
    await saved(editor)
    await wordAutoSave.check()
    await inputRoot.focus()
    await page.keyboard.press('Control+z')
    await expect.poll(() => word(document).paragraphs.map(paragraph => paragraph.text)).toEqual(['人工直接编辑的标题', '前半段', '后半段', '其他正文必须保留'])
    await saved(editor)
    await expect(inputRoot).toBeFocused()
    facts.wordContinuousInput = 'Typed immediately after Enter without a wait or click; the original stayed unchanged until explicit save, then opt-in autosave persisted undo.'

    facts.phase = 'word-style-history'
    await editor.getByRole('textbox', { name: '第 1 段', exact: true }).click()
    const quickBar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
    const paragraphActions = quickBar.getByRole('button', { name: '段落格式与操作', exact: true })
    await paragraphActions.click()
    await quickBar.getByRole('combobox', { name: '段落样式', exact: true }).selectOption('Heading1')
    await expect.poll(() => word(document).paragraphs[0].style?.heading).toBe('Heading1')
    await saved(editor)
    await editor.getByRole('toolbar', { name: 'Word 正文格式' }).getByRole('button', { name: '加粗', exact: true }).click()
    await expect.poll(() => word(document).paragraphs[0].style?.bold).toBe(true)
    await saved(editor)
    await paragraphActions.click()
    await quickBar.getByRole('combobox', { name: '段落对齐', exact: true }).selectOption('center')
    await expect.poll(() => word(document).paragraphs[0].style?.alignment).toBe('center')
    await saved(editor)
    await editor.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => word(document).paragraphs[0].style?.alignment ?? 'left').toBe('left')
    await saved(editor)
    await editor.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => word(document).paragraphs[0].style?.alignment).toBe('center')
    await saved(editor)
    await editor.getByRole('textbox', { name: '第 3 段', exact: true }).click()
    await paragraphActions.click()
    await quickBar.getByRole('button', { name: '删除段落', exact: true }).click()
    await expect.poll(() => word(document).paragraphs.length).toBe(3)
    await saved(editor)
    await editor.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => word(document).paragraphs[2].text).toBe('后半段')
    await saved(editor)
    facts.phase = 'word-external-owner-refresh'
    await page.evaluate(async path => {
      const opened = await window.desktopAPI.officeDocument!({ type: 'office-document.open', path })
      if (!opened) throw new Error('Word file binding unavailable')
      await window.desktopAPI.officeDocument!({ type: 'office-document.edit', binding: opened.binding, content: { format: 'docx', edits: [{ type: 'paragraph', index: 0, text: '文件服务接续标题' }] } })
    }, document)
    await expect(editor.getByRole('textbox', { name: '第 1 段', exact: true })).toHaveText('文件服务接续标题')
    await saved(editor)
    await fillReady(editor.getByRole('textbox', { name: '第 1 段', exact: true }), '用户接续标题')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => word(document).paragraphs[0].text).toBe('用户接续标题')
    await saved(editor)
    await editor.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => word(document).paragraphs[0].text).toBe('文件服务接续标题')
    await saved(editor)
    await editor.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => word(document).paragraphs[0].text).toBe('用户接续标题')
    await saved(editor)
    expect(word(document).paragraphs[3].text).toBe('其他正文必须保留')
    expect(unzipSync(readFileSync(document))['customXml/guoling-opaque.bin']).toEqual(originalWord['customXml/guoling-opaque.bin'])
    facts.wordMs = Date.now() - wordStart
    await page.screenshot({ path: join(directory, '01-word-edited.png'), fullPage: true })

    facts.phase = 'excel-cells'; const excelStart = Date.now()
    await m20Row(page, xlsxName).dblclick()
    let grid = page.locator('.office-sheet-editor').filter({ visible: true })
    await expect(grid.getByRole('textbox', { name: '预算!B2', exact: true })).toHaveValue('10', { timeout: 45000 })
    const excelAutoSave = grid.getByRole('switch', { name: '自动保存' })
    await expect(excelAutoSave).not.toBeChecked()
    await fillReady(grid.getByRole('textbox', { name: '预算!B2', exact: true }), '21')
    await fillReady(grid.getByRole('textbox', { name: '预算!B3', exact: true }), '=B2*2')
    await grid.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => book(workbook).sheets[0].cells.find(cell => cell.cell === 'B2')?.value).toBe(21)
    expect(book(workbook).sheets[0].cells.find(cell => cell.cell === 'B3')).toMatchObject({ formula: 'B2*2', value: 42 })
    await saved(grid)

    facts.phase = 'excel-sheets'
    await excelAutoSave.check()
    const sheetActions = grid.getByRole('combobox', { name: '工作表操作', exact: true })
    await sheetActions.selectOption('add')
    await fillReady(grid.getByRole('textbox', { name: '工作表名称', exact: true }), '临时')
    await grid.getByRole('button', { name: '确定', exact: true }).click()
    await expect(grid.getByRole('button', { name: '临时', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await saved(grid)
    await sheetActions.selectOption('rename')
    await fillReady(grid.getByRole('textbox', { name: '工作表名称', exact: true }), '计算表')
    await grid.getByRole('button', { name: '确定', exact: true }).click()
    await expect(grid.getByRole('button', { name: '计算表', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await saved(grid)
    await fillReady(grid.getByRole('textbox', { name: '计算表!A1', exact: true }), '3')
    await fillReady(grid.getByRole('textbox', { name: '计算表!B1', exact: true }), '=A1+7')
    await grid.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => book(workbook).sheets.find(sheet => sheet.name === '计算表')?.cells.find(cell => cell.cell === 'B1')?.value).toBe(10)
    await saved(grid)
    await sheetActions.selectOption('left')
    await expect.poll(() => book(workbook).sheets.map(sheet => sheet.name)).toEqual(['预算', '计算表', '备忘'])
    await saved(grid)
    await sheetActions.selectOption('left')
    await expect.poll(() => book(workbook).sheets.map(sheet => sheet.name)).toEqual(['计算表', '预算', '备忘'])
    await saved(grid)
    await sheetActions.selectOption('right')
    await expect.poll(() => book(workbook).sheets.map(sheet => sheet.name)).toEqual(['预算', '计算表', '备忘'])
    await saved(grid)
    await sheetActions.selectOption('delete')
    await expect.poll(() => book(workbook).sheets.map(sheet => sheet.name)).toEqual(['预算', '备忘'])
    await saved(grid)
    await grid.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => book(workbook).sheets.map(sheet => sheet.name)).toEqual(['预算', '计算表', '备忘'])
    await saved(grid)
    await grid.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => book(workbook).sheets.map(sheet => sheet.name)).toEqual(['预算', '备忘'])
    await saved(grid)
    facts.phase = 'excel-external-owner-refresh'
    await page.evaluate(async path => {
      const opened = await window.desktopAPI.officeDocument!({ type: 'office-document.open', path })
      if (!opened) throw new Error('Excel file binding unavailable')
      await window.desktopAPI.officeDocument!({ type: 'office-document.edit', binding: opened.binding, content: { format: 'xlsx', edits: [{ sheet: '预算', cell: 'B2', value: 30 }] } })
    }, workbook)
    await expect(grid.getByRole('textbox', { name: '预算!B2', exact: true })).toHaveValue('30')
    await saved(grid)
    await fillReady(grid.getByRole('textbox', { name: '预算!B2', exact: true }), '31')
    await grid.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => book(workbook).sheets[0].cells.find(cell => cell.cell === 'B2')?.value).toBe(31)
    await saved(grid)
    await grid.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => book(workbook).sheets[0].cells.find(cell => cell.cell === 'B2')?.value).toBe(30)
    await saved(grid)
    await grid.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => book(workbook).sheets[0].cells.find(cell => cell.cell === 'B2')?.value).toBe(31)
    await saved(grid)
    const afterBook = unzipSync(readFileSync(workbook))
    expect(afterBook['customXml/guoling-opaque.bin']).toEqual(originalBook['customXml/guoling-opaque.bin'])
    expect(afterBook['xl/worksheets/sheet2.xml']).toEqual(originalBook['xl/worksheets/sheet2.xml'])
    facts.excelMs = Date.now() - excelStart
    await page.screenshot({ path: join(directory, '02-excel-edited.png'), fullPage: true })

    facts.phase = 'cold-reopen'; const previousPid = app.process().pid
    await closeM20(app); ({ app, page } = await launchM20(fixture, { visible: true }))
    page.on('pageerror', error => errors.push(error.message))
    expect(app.process().pid).not.toBe(previousPid)
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, docName).dblclick(); editor = page.locator('.office-word-editor').filter({ visible: true })
    await expect(editor.getByRole('textbox', { name: '第 1 段', exact: true })).toHaveText('用户接续标题', { timeout: 45000 })
    await expect(editor.getByRole('textbox', { name: '第 3 段', exact: true })).toHaveText('后半段')
    await expect(editor.getByRole('switch', { name: '自动保存' })).not.toBeChecked()
    await editor.getByRole('textbox', { name: '第 1 段', exact: true }).click()
    await page.getByRole('button', { name: '段落格式与操作', exact: true }).click()
    await expect(editor.getByRole('toolbar', { name: 'Word 正文格式' }).getByRole('combobox', { name: '段落样式', exact: true })).toHaveValue('Heading1')
    await page.keyboard.press('Escape')
    await expect(editor.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    await m20Row(page, xlsxName).dblclick(); grid = page.locator('.office-sheet-editor').filter({ visible: true })
    await expect(grid.getByRole('textbox', { name: '预算!B2', exact: true })).toHaveValue('31', { timeout: 45000 })
    await expect(grid.getByRole('switch', { name: '自动保存' })).not.toBeChecked()
    await expect(grid.getByRole('textbox', { name: '预算!B3', exact: true })).toHaveValue('62')
    await grid.getByRole('textbox', { name: '预算!B3', exact: true }).click()
    await expect(grid.getByRole('textbox', { name: '单元格内容或公式', exact: true })).toHaveValue('=B2*2')
    await expect(grid.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    facts.phase = 'word-save-as'
    await page.getByRole('tab', { name: docName, exact: true }).click()
    editor = page.locator('.office-word-editor').filter({ visible: true })
    const copiedName = '会议正文副本.docx', copiedPath = join(workspace, copiedName)
    await fillReady(editor.getByRole('textbox', { name: '第 1 段', exact: true }), '复制前未保存稿')
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, copiedPath)
    await editor.getByRole('button', { name: '另存为', exact: true }).click()
    await expect(page.getByRole('tab', { name: copiedName, exact: true })).toBeVisible()
    expect(word(copiedPath).paragraphs[0].text).toBe('复制前未保存稿')
    expect(word(document).paragraphs[0].text).toBe('用户接续标题')
    await fillReady(editor.getByRole('textbox', { name: '第 1 段', exact: true }), '仅在副本继续修改')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => word(copiedPath).paragraphs[0].text).toBe('仅在副本继续修改')
    expect(word(document).paragraphs[0].text).toBe('用户接续标题')
    facts.processMetrics = await app.evaluate(({ app }) => app.getAppMetrics().map(process => ({ type: process.type, memory: process.memory })))
    expect(errors).toEqual([])
    facts.status = 'passed'; facts.phase = 'complete'; facts.errors = errors
    await m20Evidence(info, fixture, page, facts)
  } catch (error) {
    facts.errors = errors; facts.alerts = await page.getByRole('alert').allTextContents().catch(() => [])
    facts.wordInputEvidence = await page.locator('[data-word-kernel="prosemirror"]').evaluateAll(roots => roots.map(root => ({
      trace: (root as HTMLElement & { wordInputEvidence?: unknown }).wordInputEvidence,
      model: (root as HTMLElement & { pmViewDesc?: { node?: { toJSON(): unknown } } }).pmViewDesc?.node?.toJSON(),
      active: globalThis.document.activeElement?.getAttribute('aria-label'), editable: root.getAttribute('contenteditable'),
    }))).catch(() => [])
    await m20Evidence(info, fixture, page, facts, error); throw error
  } finally { await closeM20(app) }
})
