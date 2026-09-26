import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowSurface } from '../../src/core/tools/flowDocumentModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
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
  const tableSource = '| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n'
  const parsedTable = parseDocumentMarkdown(tableSource, { target: 'flow', createId: () => crypto.randomUUID() })
  if (parsedTable.status !== 'valid') throw new Error(`Table fixture invalid: ${JSON.stringify(parsedTable.diagnostics)}`)
  const tableProject = courseProjectDocumentSchema.parse({ ...project, surfaces: [{ ...flow.surface, blocks: parsedTable.document.content.blocks }] })
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
          const last = body.getByText('乙段：保持原样。', { exact: false }).first()
          await last.scrollIntoViewIfNeeded()
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
          await expect.poll(async () => (await blocks(page, opened.documentId)).map(block => block.type)).toContain(marker.type)
          const after = await blocks(page, opened.documentId)
          expect(after.length).toBeGreaterThan(before.length)
          const created = [...after].reverse().find(block => block.type === marker.type)
          expect(created, `${marker.name} must create a formal ${marker.type} block`).toBeDefined()
          if ('ordered' in marker) expect(created).toMatchObject({ ordered: marker.ordered })
          if (marker.type === 'formula') expect(created).toMatchObject({ latex: 'x+1' })
        })
      }
      const name = carrier === 'flow' ? '正文验收.h5lesson' : '正文验收.md'
      const opened = await openSelectionFile(page, data.workspace, name)
      const body = await bodyFor(page, carrier, name)
      const stable = await blocks(page, opened.documentId)
      const last = body.getByText('乙段：保持原样。', { exact: false }).first()
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
      await body.getByText('乙段：保持原样。', { exact: false }).first().click()
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
      await body.getByText('乙段：保持原样。', { exact: false }).first().click()
      await handle.getByRole('button', { name: '插入段落' }).click()
      await page.getByRole('menu', { name: '插入段落' }).getByRole('menuitem', { name: '上方插入段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount + 1)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount)
      await body.getByText('乙段：保持原样。', { exact: false }).first().click()
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '转换为标题' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).find(block => JSON.stringify(block).includes('乙段：保持原样。'))?.type).toBe('heading')
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).find(block => JSON.stringify(block).includes('乙段：保持原样。'))?.type).toBe('paragraph')
      await body.getByText('乙段：保持原样。', { exact: false }).first().click()
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '上移段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 1 : 0)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 2 : 1)
      await body.getByText('乙段：保持原样。', { exact: false }).first().click()
      await handle.getByRole('button', { name: '段落操作' }).dragTo(body.locator('[data-flow-block-id]').first())
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(0)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 2 : 1)
      await body.getByText('乙段：保持原样。', { exact: false }).first().click()
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '删除段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount - 1)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount)
      await body.getByText('乙段：保持原样。', { exact: false }).first().click()
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
      const round = server.arm(`m16-${carrier}-ai`, carrier === 'flow' ? 'flow-range' : 'markdown-range', '先观察')
      await bar.getByRole('button', { name: 'AI 修改' }).click()
      const card = page.getByRole('dialog', { name: /^AI 修改：“先预测”$/ })
      await expect(card).toBeVisible()
      await card.getByLabel('AI 修改要求').fill('只修改选中文字')
      await card.getByRole('button', { name: '发送', exact: true }).click()
      await heldRound(round); await finishRound(page, round)
      expect(round.readText).toBe('先预测')
      await expect.poll(async () => JSON.stringify(await blocks(page, opened.documentId))).toContain('先观察')
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
      const table = body.locator('table').first()
      await expect(table).toBeVisible()
      const rowCount = async () => {
        const entry = (await blocks(page, opened.documentId)).find(block => block.type === 'table')
        if (!entry || entry.type !== 'table') throw new Error('Formal table missing')
        return entry.rows.length
      }
      const initialRows = await rowCount()
      await table.locator('td').first().click()
      const bar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await expect(bar).toBeVisible()
      await bar.getByRole('button', { name: '表格操作' }).click()
      await page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '下方插入行' }).click()
      await expect.poll(rowCount).toBe(initialRows + 1)
      await body.press('Control+z')
      await expect.poll(rowCount).toBe(initialRows)
      await table.locator('td').first().click({ button: 'right' })
      await page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '上方插入行' }).click()
      await expect.poll(rowCount).toBe(initialRows + 1)
      await body.press('Control+z')
      await expect.poll(rowCount).toBe(initialRows)
    } finally { await closeSelectionApp(app); await server.close() }
  })
}
