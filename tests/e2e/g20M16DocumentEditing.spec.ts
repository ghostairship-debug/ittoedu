import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowSurface } from '../../src/core/tools/flowDocumentModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import type { DocumentBlock } from '../../src/shared/document/content'
import { closeSelectionApp, finishRound, heldRound, launchSelectionApp, openSelectionFile, readSelectionDocument,
  selectVisibleText, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
type Carrier = 'flow' | 'markdown'
const markers = [
  { name: 'heading', input: '# ', type: 'heading' },
  { name: 'bullet', input: '- ', type: 'list', ordered: false },
  { name: 'numbered', input: '1. ', type: 'list', ordered: true },
  { name: 'quote', input: '> ', type: 'quote' },
  { name: 'code', input: '```', type: 'code' },
  { name: 'divider', input: '---', type: 'divider' },
  { name: 'formula', input: '$$', type: 'formula' },
] as const

function fixture() {
  const base = join(root, 'output/g20/m16/document-editing')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const driver = new CourseV9Driver()
  const initial = '甲段：先预测，再观察。\n\n乙段：保持原样。\n'
  const flow = createBlankFlowSurface({ id: 'm16-flow', title: '正文验收', headingId: 'm16-heading', paragraphId: 'm16-first' })
  flow.surface.blocks[1] = { id: 'm16-first', type: 'paragraph', content: { inlines: [{ type: 'text', text: '甲段：先预测，再观察。' }] } }
  flow.surface.blocks.push({ id: 'm16-second', type: 'paragraph', content: { inlines: [{ type: 'text', text: '乙段：保持原样。' }] } })
  const project = courseProjectDocumentSchema.parse({ ...createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    surfaces: [flow.surface], locations: [flow.location], startLocationId: flow.location.id })
  writeFileSync(join(workspace, '正文验收.h5lesson'), driver.serialize({ kind: 'course-v9', project,
    resources: { assets: {}, components: {} } }))
  writeFileSync(join(workspace, '正文验收.md'), initial)
  const objectParagraph: DocumentBlock = { id: 'm16-first', type: 'paragraph', content: { inlines: [
    { type: 'text', text: '甲段：先预测' }, { type: 'math', formulaId: 'm16-math', latex: 'x', accessibleText: '公式x' },
    { type: 'text', text: '，再观察。' },
  ] } }
  const objectBlocks = [flow.surface.blocks[0]!, objectParagraph, flow.surface.blocks[2]!]
  const objectProject = courseProjectDocumentSchema.parse({ ...project, surfaces: [{ ...flow.surface, blocks: objectBlocks }] })
  writeFileSync(join(workspace, '剪贴板对象.h5lesson'), driver.serialize({ kind: 'course-v9', project: objectProject,
    resources: { assets: {}, components: {} } }))
  writeFileSync(join(workspace, '剪贴板对象.md'), serializeDocumentMarkdown({ content: { blocks: objectBlocks.slice(1) },
    resources: { assets: [], components: [] } }, 'file'))
  const tableSource = '| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n'
  const parsedTable = parseDocumentMarkdown(tableSource, { target: 'flow', createId: () => crypto.randomUUID() })
  if (parsedTable.status !== 'valid') throw new Error(`Table fixture invalid: ${JSON.stringify(parsedTable.diagnostics)}`)
  const tableProject = courseProjectDocumentSchema.parse({ ...project, surfaces: [{ ...flow.surface, blocks: [flow.surface.blocks[0]!, ...parsedTable.document.content.blocks] }] })
  writeFileSync(join(workspace, '表格验收.h5lesson'), driver.serialize({ kind: 'course-v9', project: tableProject,
    resources: { assets: {}, components: {} } }))
  writeFileSync(join(workspace, '表格验收.md'), tableSource)
  for (const marker of markers) {
    writeFileSync(join(workspace, `${marker.name}.h5lesson`), driver.serialize({ kind: 'course-v9', project,
      resources: { assets: {}, components: {} } }))
    writeFileSync(join(workspace, `${marker.name}.md`), initial)
  }
  return { directory, workspace, initial }
}

async function blocks(page: Page, documentId: string): Promise<DocumentBlock[]> {
  const snapshot = await readSelectionDocument(page, documentId)
  if (snapshot.model.kind === 'course-v9') {
    const flow = snapshot.model.project.surfaces.find(surface => surface.type === 'flow')
    if (!flow || flow.type !== 'flow') throw new Error('Flow surface missing')
    return flow.blocks
  }
  if (snapshot.model.kind !== 'markdown') throw new Error(`Unexpected document kind ${snapshot.model.kind}`)
  const parsed = parseDocumentMarkdown(snapshot.model.source, { target: 'file', createId: () => crypto.randomUUID() })
  if (parsed.status !== 'valid') throw new Error(`Invalid Markdown: ${JSON.stringify(parsed.diagnostics)}`)
  return parsed.document.content.blocks
}

function secondParagraph(body: Locator, carrier: Carrier) {
  return carrier === 'flow' ? body.locator('[data-flow-block-id="m16-second"]')
    : body.locator('p').filter({ hasText: '乙段：保持原样。' }).last()
}

function firstParagraph(body: Locator, carrier: Carrier) {
  return carrier === 'flow' ? body.locator('[data-flow-block-id="m16-first"]')
    : body.locator('p').filter({ hasText: '甲段：先预测' }).first()
}

async function selectAcrossInline(page: Page, body: Locator, fromText: string, toText: string) {
  const points = await body.evaluate((root, texts) => {
    const bounds = (text: string, end: boolean) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const index = (node.textContent ?? '').indexOf(text)
        if (index < 0) continue
        const range = document.createRange(), offset = index + (end ? text.length - 1 : 0)
        range.setStart(node, offset); range.setEnd(node, offset + 1)
        const rect = range.getBoundingClientRect()
        return { x: end ? rect.right - 0.1 : rect.left + 0.1, y: rect.top + rect.height / 2 }
      }
      throw new Error(`Text ${text} not rendered`)
    }
    return { from: bounds(texts.fromText, false), to: bounds(texts.toText, true) }
  }, { fromText, toText })
  await page.mouse.move(points.from.x, points.from.y)
  await page.mouse.down()
  await page.mouse.move(points.to.x, points.to.y, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain(fromText)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain(toText)
}

async function preserveClipboard() {
  const helper = join(root, 'tests/e2e/helpers/g20ClipboardFixture.ps1')
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', helper],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const lines: string[] = [], waiting: Array<(line: string) => void> = []
  let stderr = ''
  child.stderr.on('data', value => { stderr += value.toString() })
  createInterface({ input: child.stdout }).on('line', line => { const next = waiting.shift(); if (next) next(line); else lines.push(line) })
  const next = () => new Promise<string>((resolveLine, reject) => {
    if (lines.length) return resolveLine(lines.shift()!)
    const timer = setTimeout(() => reject(new Error(`Clipboard helper timed out: ${stderr}`)), 15_000)
    waiting.push(line => { clearTimeout(timer); resolveLine(line) })
  })
  expect(JSON.parse(await next())).toEqual({ ready: true })
  return async () => {
    const exited = new Promise<number | null>(resolveExit => child.once('exit', resolveExit))
    child.stdin.end()
    expect(JSON.parse(await next())).toEqual({ restored: true })
    expect(await exited, stderr).toBe(0)
  }
}

async function bodyFor(page: Page, carrier: Carrier, name: string) {
  const root = carrier === 'flow' ? page.locator('.flow-workspace').filter({ visible: true }).first()
    : page.getByRole('region', { name: `教学文档 ${name}`, exact: true })
  const body = root.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true }).first()
  await expect(body).toBeVisible()
  return body
}

for (const carrier of ['flow', 'markdown'] as const) {
  test(`M16-T05 ${carrier}: input conversion, formula draft and IME`, async ({}, info) => {
    test.setTimeout(180_000)
    const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await setupSelectionUI(app, page, server.endpoint, data.workspace)
      for (const marker of markers) {
        await test.step(`${carrier} ${marker.name}`, async () => {
          const name = `${marker.name}.${carrier === 'flow' ? 'h5lesson' : 'md'}`
          const opened = await openSelectionFile(page, data.workspace, name)
          const body = await bodyFor(page, carrier, name)
          const before = await blocks(page, opened.documentId)
          if (carrier === 'flow') expect(before.some(block => block.id === 'm16-second')).toBe(true)
          const last = secondParagraph(body, carrier)
          await expect(last).toBeVisible()
          await last.click()
          await page.keyboard.press('End')
          await page.keyboard.press('Enter')
          await page.keyboard.type(marker.input)
          if (marker.type === 'formula') {
            const form = page.getByRole('form', { name: '公式编辑' })
            await expect(form).toBeVisible()
            await form.getByLabel('LaTeX').fill('x+1')
            await form.getByRole('button', { name: '应用公式' }).click()
          }
          await expect.poll(async () => (await blocks(page, opened.documentId)).filter(block => block.type === marker.type).length)
            .toBeGreaterThan(before.filter(block => block.type === marker.type).length)
          const after = await blocks(page, opened.documentId)
          expect(after.length).toBeGreaterThan(before.length)
          expect(JSON.stringify(after[before.length - 1])).toContain('乙段：保持原样。')
          const created = after[before.length]
          expect(created, `${marker.name} must create a formal block immediately after the edited paragraph`).toBeDefined()
          expect(created!.type).toBe(marker.type)
          expect(JSON.stringify(created)).not.toContain(marker.input)
          if ('ordered' in marker) expect(created).toMatchObject({ ordered: marker.ordered })
          if (marker.type === 'formula') expect(created).toMatchObject({ latex: 'x+1' })
        })
      }
      const name = carrier === 'flow' ? '正文验收.h5lesson' : '正文验收.md'
      const opened = await openSelectionFile(page, data.workspace, name)
      const body = await bodyFor(page, carrier, name)
      const stable = await blocks(page, opened.documentId)
      const last = secondParagraph(body, carrier)
      await last.click(); await page.keyboard.press('End')
      await body.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })))
      await page.keyboard.insertText('中文输入')
      await body.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文输入' })))
      await expect.poll(async () => JSON.stringify(await blocks(page, opened.documentId))).toContain('中文输入')
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).map(block => block.type)).toEqual(stable.map(block => block.type))
      await expect.poll(async () => JSON.stringify(await blocks(page, opened.documentId))).not.toContain('中文输入')
      expect(errors).toEqual([])
      await page.screenshot({ path: join(data.directory, `${carrier}-input.png`) })
      await info.attach(`${carrier} input`, { path: join(data.directory, `${carrier}-input.png`), contentType: 'image/png' })
    } finally { await closeSelectionApp(app); await server.close() }
  })

  test(`M16-T05 ${carrier}: menus, block operations, text tools and exact AI selection`, async ({}, info) => {
    test.setTimeout(180_000)
    const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await setupSelectionUI(app, page, server.endpoint, data.workspace)
      const opened = await openSelectionFile(page, data.workspace, carrier === 'flow' ? '正文验收.h5lesson' : '正文验收.md')
      const body = await bodyFor(page, carrier, carrier === 'flow' ? '正文验收.h5lesson' : '正文验收.md')
      await secondParagraph(body, carrier).click()
      const handle = page.locator('.document-block-handle')
      await expect(handle).toBeVisible()
      const id = await handle.getAttribute('data-block-id')
      expect(id).toBeTruthy()
      await handle.getByRole('button', { name: '插入段落' }).click()
      const plus = page.getByRole('menu', { name: '插入段落' })
      const insertItems = await plus.getByRole('menuitem').evaluateAll(items => items.map(item => item.getAttribute('aria-label')))
      expect(insertItems).toEqual(expect.arrayContaining(['上方插入段落', '下方插入正文', '下方插入标题', '下方插入列表']))
      await page.keyboard.press('Escape')
      await handle.getByRole('button', { name: '段落操作' }).click()
      const menu = page.getByRole('menu', { name: '段落操作' })
      const items = await menu.getByRole('menuitem').evaluateAll(items => items.map(item => item.getAttribute('aria-label')))
      expect(items).toEqual(expect.arrayContaining([...insertItems, '复制段落', '删除段落', '上移段落', '下移段落', '用 AI 修改段落']))
      await menu.getByRole('menuitem', { name: '复制段落' }).click()
      const baselineCount = carrier === 'flow' ? 3 : 2
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount + 1)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount)
      await secondParagraph(body, carrier).click()
      await handle.getByRole('button', { name: '插入段落' }).click()
      await page.getByRole('menu', { name: '插入段落' }).getByRole('menuitem', { name: '上方插入段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount + 1)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount)
      await secondParagraph(body, carrier).click()
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '转换为标题' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).find(block => JSON.stringify(block).includes('乙段：保持原样。'))?.type).toBe('heading')
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).find(block => JSON.stringify(block).includes('乙段：保持原样。'))?.type).toBe('paragraph')
      await secondParagraph(body, carrier).click()
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '上移段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 1 : 0)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 2 : 1)
      await secondParagraph(body, carrier).click()
      await handle.getByRole('button', { name: '段落操作' }).dragTo(body.locator('[data-flow-block-id]').first())
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(0)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 2 : 1)
      await secondParagraph(body, carrier).click()
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '删除段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount - 1)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount)
      await secondParagraph(body, carrier).click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await expect(handle).toBeVisible()
      await handle.getByRole('button', { name: '插入段落' }).click()
      const emptyPlus = await page.getByRole('menu', { name: '插入段落' }).getByRole('menuitem').evaluateAll(entries => entries.map(entry => entry.getAttribute('aria-label')))
      expect(emptyPlus).toEqual(insertItems)
      await page.keyboard.press('Escape')
      await body.press('/')
      const slash = await page.getByRole('menu', { name: '插入段落' }).getByRole('menuitem').evaluateAll(entries => entries.map(entry => entry.getAttribute('aria-label')))
      expect(slash).toEqual(insertItems)
      await page.keyboard.press('Escape')
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount)
      await selectVisibleText(page, body, '先预测')
      const bar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await expect(bar).toBeVisible()
      for (const label of ['当前选区加粗', '当前选区斜体', '当前选区下划线', '当前选区文字颜色', '当前选区高亮', '当前选区链接', '当前选区公式', 'AI 修改', '更多文字格式'])
        await expect(bar.getByRole('button', { name: label, exact: true })).toBeVisible()
      await expect(page.getByText('正文格式', { exact: true })).toHaveCount(0)
      await bar.getByRole('button', { name: '当前选区加粗' }).click()
      await expect.poll(async () => JSON.stringify(await blocks(page, opened.documentId))).toContain('"bold":true')
      await body.press('Control+z')
      await expect.poll(async () => JSON.stringify(await blocks(page, opened.documentId))).not.toContain('"bold":true')
      await selectVisibleText(page, body, '先预测')
      await bar.getByRole('button', { name: '更多文字格式' }).click()
      const more = page.getByRole('menu', { name: '更多文字格式' })
      for (const label of ['删除线', '上标', '下标', '行内代码', '清除文字格式']) await expect(more.getByRole('menuitem', { name: label })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByLabel('更多正文操作').filter({ visible: true }).first().click()
      await expect(page.getByRole('button', { name: '源文', exact: true }).filter({ visible: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await selectVisibleText(page, body, '先预测')
      const beforeAi = await readSelectionDocument(page, opened.documentId)
      const expectedAi = beforeAi.model.kind === 'markdown' ? beforeAi.model.source.replace('先预测', '先观察')
        : beforeAi.model.kind === 'course-v9' ? JSON.stringify(beforeAi.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks).replace('先预测', '先观察') : ''
      expect(expectedAi).not.toBe('')
      const round = server.arm(`m16-${carrier}-ai`, carrier === 'flow' ? 'flow-range' : 'markdown-range', '先观察')
      await bar.getByRole('button', { name: 'AI 修改' }).click()
      const card = page.getByRole('dialog', { name: /^AI 修改：“先预测”$/ })
      await expect(card).toBeVisible()
      await card.getByLabel('AI 修改要求').fill('只修改选中文字')
      await card.getByRole('button', { name: '发送', exact: true }).click()
      await heldRound(round); await finishRound(page, round)
      expect(round.readText).toBe('先预测')
      await expect.poll(async () => {
        const current = await readSelectionDocument(page, opened.documentId)
        return current.model.kind === 'markdown' ? current.model.source
          : current.model.kind === 'course-v9' ? JSON.stringify(current.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks) : ''
      }).toBe(expectedAi)
      expect(errors).toEqual([])
      await page.screenshot({ path: join(data.directory, `${carrier}-tools.png`) })
      await info.attach(`${carrier} tools`, { path: join(data.directory, `${carrier}-tools.png`), contentType: 'image/png' })
    } finally { await closeSelectionApp(app); await server.close() }
  })

  test(`M16-T05 ${carrier}: table structure uses formal rows and undo`, async () => {
    test.setTimeout(90_000)
    const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
    const page = await app.firstWindow()
    try {
      await setupSelectionUI(app, page, server.endpoint, data.workspace)
      const name = `表格验收.${carrier === 'flow' ? 'h5lesson' : 'md'}`
      const opened = await openSelectionFile(page, data.workspace, name)
      const body = await bodyFor(page, carrier, name)
      const table = body.locator('[data-flow-body-block="table"], .document-table').first()
      await expect(table).toBeVisible()
      const rowCount = async () => {
        const entry = (await blocks(page, opened.documentId)).find(block => block.type === 'table')
        if (!entry || entry.type !== 'table') throw new Error('Formal table missing')
        return entry.rows.length
      }
      const initialRows = await rowCount()
      await table.locator('[data-document-slot]').first().click()
      const bar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await expect(bar).toBeVisible()
      await bar.getByRole('button', { name: '表格操作' }).click()
      await page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '下方插入行' }).click()
      await expect.poll(rowCount).toBe(initialRows + 1)
      await body.press('Control+z')
      await expect.poll(rowCount).toBe(initialRows)
      await table.locator('[data-document-slot]').first().click({ button: 'right' })
      await page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '上方插入行' }).click()
      await expect.poll(rowCount).toBe(initialRows + 1)
      await body.press('Control+z')
      await expect.poll(rowCount).toBe(initialRows)
    } finally { await closeSelectionApp(app); await server.close() }
  })

  test(`M16-T05 ${carrier}: clipboard menu and native rich/plain paste preserve formal content`, async () => {
    test.setTimeout(150_000)
    const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
    const page = await app.firstWindow(), restoreClipboard = await preserveClipboard()
    try {
      await setupSelectionUI(app, page, server.endpoint, data.workspace)
      const name = carrier === 'flow' ? '正文验收.h5lesson' : '正文验收.md'
      const opened = await openSelectionFile(page, data.workspace, name)
      const body = await bodyFor(page, carrier, name)
      const formal = async () => {
        const snapshot = await readSelectionDocument(page, opened.documentId)
        if (snapshot.model.kind === 'markdown') return snapshot.model.source
        if (snapshot.model.kind === 'course-v9') return JSON.stringify(snapshot.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks)
        throw new Error(`Unexpected document kind ${snapshot.model.kind}`)
      }
      const inlines = async () => {
        const block = (await blocks(page, opened.documentId)).find(item => item.type === 'paragraph' && JSON.stringify(item).includes('甲段：'))
        if (!block || block.type !== 'paragraph') throw new Error('First formal paragraph missing')
        return block.content.inlines
      }
      const visibleText = async () => (await inlines()).map(item => item.type === 'text' ? item.text : '').join('')
      await selectVisibleText(page, body, '先预测')
      await firstParagraph(body, carrier).click({ button: 'right' })
      const context = page.getByRole('menu', { name: '段落操作' })
      for (const label of ['剪切', '复制', '粘贴', '粘贴为纯文本'])
        await expect(context.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await selectVisibleText(page, body, '先预测')
      await page.getByRole('toolbar', { name: '选中内容快捷工具' }).getByRole('button', { name: '当前选区加粗' }).click()
      await expect.poll(async () => JSON.stringify(await inlines())).toContain('"bold":true')
      const boldState = await formal()
      await selectVisibleText(page, body, '先预测')
      await body.press('Control+c')
      const copied = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(),
        custom: clipboard.readBuffer('application/x-cw-document-slice').toString('utf8'), formats: clipboard.availableFormats() }))
      expect(copied.text).toBe('先预测')
      expect(copied.formats).toContain('application/x-cw-document-slice')
      expect(JSON.parse(copied.custom.replace(/\0+$/, ''))).toMatchObject({ slice: expect.any(Object), resources: { assets: [], components: [] } })
      expect(await formal()).toBe(boldState)
      await selectVisibleText(page, body, '再观察')
      await body.press('Control+v')
      await expect.poll(visibleText).toBe('甲段：先预测，先预测。')
      await expect.poll(async () => (await inlines()).filter(item => item.type === 'text' && item.text.includes('先预测') && item.style?.bold).length).toBe(2)
      await body.press('Control+z')
      await expect.poll(formal).toBe(boldState)
      await selectVisibleText(page, body, '先预测')
      await body.press('Control+x')
      await expect.poll(visibleText).toBe('甲段：，再观察。')
      await expect.poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText()))).toBe('先预测')
      await body.press('Control+z')
      await expect.poll(formal).toBe(boldState)
      await selectVisibleText(page, body, '再观察')
      await firstParagraph(body, carrier).click({ button: 'right' })
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '粘贴为纯文本' }).click()
      await expect.poll(visibleText).toBe('甲段：先预测，先预测。')
      const plain = await inlines()
      expect(plain.some(item => item.type === 'text' && item.text.includes('先预测') && !item.style?.bold)).toBe(true)
      const plainState = await formal()
      await body.press('Control+z')
      await expect.poll(formal).toBe(boldState)
      await body.press('Control+Shift+z')
      await expect.poll(formal).toBe(plainState)
      await body.press('Control+z')
      await expect.poll(formal).toBe(boldState)
      const objectName = `剪贴板对象.${carrier === 'flow' ? 'h5lesson' : 'md'}`
      const objectOpened = await openSelectionFile(page, data.workspace, objectName)
      const objectBody = await bodyFor(page, carrier, objectName)
      const objectFormal = async () => {
        const snapshot = await readSelectionDocument(page, objectOpened.documentId)
        if (snapshot.model.kind === 'markdown') return snapshot.model.source
        if (snapshot.model.kind === 'course-v9') return JSON.stringify(snapshot.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks)
        throw new Error(`Unexpected document kind ${snapshot.model.kind}`)
      }
      const objectBefore = await objectFormal()
      await expect(firstParagraph(objectBody, carrier)).toBeVisible()
      await selectAcrossInline(page, objectBody, '先预测', '再观察')
      await objectBody.press('Control+c')
      const objectClipboard = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(),
        custom: clipboard.readBuffer('application/x-cw-document-slice').toString('utf8') }))
      expect(objectClipboard.text).toContain('先预测')
      expect(objectClipboard.text).toContain('再观察')
      expect(JSON.stringify(JSON.parse(objectClipboard.custom.replace(/\0+$/, '')))).toContain('"math"')
      await selectVisibleText(page, objectBody, '保持原样')
      await secondParagraph(objectBody, carrier).click({ button: 'right' })
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '粘贴为纯文本' }).click()
      const targetParagraph = async () => {
        const entry = (await blocks(page, objectOpened.documentId)).find(item => item.type === 'paragraph' && JSON.stringify(item).includes('乙段：'))
        if (!entry || entry.type !== 'paragraph') throw new Error('Paste target paragraph missing')
        return entry.content.inlines
      }
      await expect.poll(async () => (await targetParagraph()).map(item => item.type === 'text' ? item.text : '').join(''))
        .toBe(`乙段：${objectClipboard.text}。`)
      expect((await targetParagraph()).some(item => item.type === 'math')).toBe(false)
      const objectPasted = await objectFormal()
      await objectBody.press('Control+z')
      await expect.poll(objectFormal).toBe(objectBefore)
      await objectBody.press('Control+Shift+z')
      await expect.poll(objectFormal).toBe(objectPasted)
    } finally { try { await restoreClipboard() } finally { await closeSelectionApp(app); await server.close() } }
  })
}
