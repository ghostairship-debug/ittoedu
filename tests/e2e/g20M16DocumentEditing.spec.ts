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
  const tableSource = '| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n| 戊 | 己 |\n'
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

async function focusSecondEnd(page: Page, body: Locator, carrier: Carrier) {
  await expect(secondParagraph(body, carrier)).toBeVisible()
  await selectVisibleText(page, body, '乙段：保持原样。')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('End')
  await expect.poll(() => body.evaluate(root => {
    const selection = root.ownerDocument.getSelection(), anchor = selection?.anchorNode
    const element = anchor instanceof Element ? anchor : anchor?.parentElement
    const block = element?.closest('[data-flow-block-id]')
    const prefix = block && anchor ? root.ownerDocument.createRange() : null
    prefix?.selectNodeContents(block!)
    if (anchor) prefix?.setEnd(anchor, selection!.anchorOffset)
    return { focused: root === document.activeElement, blockId: block?.getAttribute('data-flow-block-id') ?? null,
      text: block?.textContent ?? null, collapsed: selection?.isCollapsed ?? false,
      atEnd: Boolean(block && prefix && prefix.toString() === block.textContent) }
  })).toMatchObject({ focused: true, ...(carrier === 'flow' ? { blockId: 'm16-second' } : {}),
    text: '乙段：保持原样。', collapsed: true, atEnd: true })
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

async function rightClickSelectedText(page: Page, text: string) {
  const point = await page.evaluate(expected => {
    const selection = window.getSelection()
    if (!selection || selection.toString() !== expected || selection.rangeCount !== 1)
      throw new Error(`Expected selected text ${expected} before context menu, got ${selection?.toString() ?? ''}`)
    const rect = [...selection.getRangeAt(0).getClientRects()].find(rect => rect.width > 0 && rect.height > 0)
    if (!rect) throw new Error(`Selected text ${expected} has no visible rect`)
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, text)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text)
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
          await focusSecondEnd(page, body, carrier)
          await page.keyboard.press('Enter')
          const editorCaret = async () => body.evaluate(root => {
            const selection = root.ownerDocument.getSelection(), anchor = selection?.anchorNode
            const element = anchor instanceof Element ? anchor : anchor?.parentElement
            const block = element?.closest('[data-flow-block-id]')
            return { focused: root === document.activeElement, tag: block?.tagName.toLowerCase() ?? null, text: block?.textContent ?? null }
          })
          writeFileSync(join(data.directory, `${carrier}-${marker.name}-after-enter.json`), JSON.stringify({
            before, formal: await blocks(page, opened.documentId), caret: await editorCaret(), editor: await body.evaluate(root => root.textContent),
          }, null, 2))
          if (carrier === 'flow') await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(before.length + 1)
          await expect.poll(editorCaret).toEqual({ focused: true, tag: 'p', text: '' })
          await page.keyboard.type(marker.input)
          writeFileSync(join(data.directory, `${carrier}-${marker.name}-input.json`), JSON.stringify({ before, caret: await editorCaret(),
            formal: await blocks(page, opened.documentId), editor: await body.evaluate(root => root.textContent) }, null, 2))
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
      await focusSecondEnd(page, body, carrier)
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
    test.setTimeout(300_000)
    const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await setupSelectionUI(app, page, server.endpoint, data.workspace)
      const opened = await openSelectionFile(page, data.workspace, carrier === 'flow' ? '正文验收.h5lesson' : '正文验收.md')
      const body = await bodyFor(page, carrier, carrier === 'flow' ? '正文验收.h5lesson' : '正文验收.md')
      await focusSecondEnd(page, body, carrier)
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
      await focusSecondEnd(page, body, carrier)
      await handle.getByRole('button', { name: '插入段落' }).click()
      await page.getByRole('menu', { name: '插入段落' }).getByRole('menuitem', { name: '上方插入段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount + 1)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount)
      await focusSecondEnd(page, body, carrier)
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '转换为标题' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).find(block => JSON.stringify(block).includes('乙段：保持原样。'))?.type).toBe('heading')
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).find(block => JSON.stringify(block).includes('乙段：保持原样。'))?.type).toBe('paragraph')
      await focusSecondEnd(page, body, carrier)
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '上移段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 1 : 0)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 2 : 1)
      await focusSecondEnd(page, body, carrier)
      await handle.getByRole('button', { name: '段落操作' }).dragTo(body.locator('[data-flow-block-id]').first())
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(0)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).findIndex(block => JSON.stringify(block).includes('乙段：保持原样。'))).toBe(carrier === 'flow' ? 2 : 1)
      await focusSecondEnd(page, body, carrier)
      await handle.getByRole('button', { name: '段落操作' }).click()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '删除段落' }).click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount - 1)
      await body.press('Control+z')
      await expect.poll(async () => (await blocks(page, opened.documentId)).length).toBe(baselineCount)
      await focusSecondEnd(page, body, carrier)
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
      const moreBodyActions = page.getByLabel('更多正文操作').filter({ visible: true }).first()
      await moreBodyActions.click()
      const sourceButton = page.getByRole('button', { name: '源文', exact: true }).filter({ visible: true })
      await expect(sourceButton).toBeVisible()
      await moreBodyActions.click()
      await expect(sourceButton).toBeHidden()
      await selectVisibleText(page, body, '先预测')
      const beforeAi = await readSelectionDocument(page, opened.documentId)
      const beforeAiFormal = beforeAi.model.kind === 'markdown' ? beforeAi.model.source
        : beforeAi.model.kind === 'course-v9' ? JSON.stringify(beforeAi.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks) : ''
      expect(beforeAiFormal).toContain('先预测')
      const expectedAi = beforeAiFormal.replace('先预测', '先观察')
      const currentAiFormal = async () => {
        const current = await readSelectionDocument(page, opened.documentId)
        return current.model.kind === 'markdown' ? current.model.source
          : current.model.kind === 'course-v9' ? JSON.stringify(current.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks) : ''
      }
      const round = server.arm(`m16-${carrier}-ai`, carrier === 'flow' ? 'flow-range' : 'markdown-range', '先观察')
      await bar.getByRole('button', { name: 'AI 修改' }).click()
      const card = page.getByRole('dialog', { name: /^AI 修改：“先预测”$/ })
      await expect(card).toBeVisible()
      await card.getByLabel('AI 修改要求').fill('只修改选中文字')
      await card.getByRole('button', { name: '发送', exact: true }).click()
      await heldRound(round); await finishRound(page, round)
      expect(round.references?.[0].selection).toMatchObject([{
        kind: carrier === 'flow' ? 'flow-range' : 'markdown-range',
        writableTarget: round.references?.[0].writable[0]?.target,
        content: { text: round.readText, truncated: false },
      }])
      if (carrier === 'flow') expect(JSON.parse(round.readText!)).toEqual({
        content: { inlines: [{ type: 'text', text: '先预测' }] }, parentId: null,
      })
      else expect(round.readText).toBe('先预测')
      await expect.poll(currentAiFormal).toBe(expectedAi)
      await body.press('Control+z')
      await expect.poll(currentAiFormal).toBe(beforeAiFormal)
      await body.press('Control+Shift+z')
      await expect.poll(currentAiFormal).toBe(expectedAi)
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
      const table = carrier === 'flow' ? body.locator('[data-flow-body-block="table"]').first()
        : body.locator('figure:has(table)').first()
      await expect(table).toBeVisible()
      const rowCount = async () => {
        const entry = (await blocks(page, opened.documentId)).find(block => block.type === 'table')
        if (!entry || entry.type !== 'table') throw new Error('Formal table missing')
        return entry.rows.length
      }
      const initialRows = await rowCount()
      await table.locator('[data-document-slot^="cell:"]').first().click()
      const bar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await expect(bar).toBeVisible()
      await bar.getByRole('button', { name: '表格操作' }).click()
      await page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '下方插入行' }).click()
      await expect.poll(rowCount).toBe(initialRows + 1)
      await body.press('Control+z')
      await expect.poll(rowCount).toBe(initialRows)
      await table.locator('[data-document-slot^="cell:"]').first().click({ button: 'right' })
      await page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '上方插入行' }).click()
      await expect.poll(rowCount).toBe(initialRows + 1)
      await body.press('Control+z')
      await expect.poll(rowCount).toBe(initialRows)
    } finally { await closeSelectionApp(app); await server.close() }
  })

  test('M16-T06 ' + carrier + ': table row, column and header commands keep visible and formal grids', async () => {
    test.setTimeout(180_000)
    const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
    const page = await app.firstWindow()
    try {
      await setupSelectionUI(app, page, server.endpoint, data.workspace)
      const name = '表格验收.' + (carrier === 'flow' ? 'h5lesson' : 'md')
      const opened = await openSelectionFile(page, data.workspace, name)
      const body = await bodyFor(page, carrier, name)
      const table = carrier === 'flow' ? body.locator('[data-flow-body-block="table"]').first()
        : body.locator('figure:has(table)').first()
      const formal = async () => {
        const snapshot = await readSelectionDocument(page, opened.documentId)
        if (snapshot.model.kind === 'markdown') return snapshot.model.source
        if (snapshot.model.kind === 'course-v9') return JSON.stringify(snapshot.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks)
        throw new Error('Unexpected document kind ' + snapshot.model.kind)
      }
      const structure = async () => {
        const entry = (await blocks(page, opened.documentId)).find(block => block.type === 'table')
        if (!entry || entry.type !== 'table') throw new Error('Formal table missing')
        const text = (content: typeof entry.columns[number]['header']) => content.inlines.map(item => item.type === 'text' ? item.text : '').join('')
        return { headers: entry.columns.map(column => text(column.header)),
          cells: entry.rows.map(row => entry.columns.map(column => text(row.cells[column.id]!))),
          headerEnabled: entry.headerEnabled !== false }
      }
      const visibleGrid = () => table.locator('table tr').evaluateAll(rows => rows.map(row =>
        [...row.querySelectorAll(':scope > th, :scope > td')].map(cell => cell.textContent?.trim() ?? '')))
      const baseline = await structure()
      expect(baseline).toEqual({ headers: ['甲', '乙'], cells: [['丙', '丁'], ['戊', '己']], headerEnabled: true })
      await expect(table).toBeVisible()
      await expect.poll(visibleGrid).toEqual([baseline.headers, ...baseline.cells])
      const bar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      const run = async (label: string, via: 'quick' | 'context', expected: typeof baseline) => {
        const before = await formal()
        const cell = table.locator('[data-document-slot^="cell:"]').first()
        await cell.click({ button: via === 'context' ? 'right' : 'left' })
        if (via === 'quick') {
          await expect(bar).toBeVisible()
          await bar.getByRole('button', { name: '表格操作' }).click()
        }
        const item = page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: label, exact: true })
        await expect(item).toBeEnabled()
        await item.click()
        await expect.poll(structure).toEqual(expected)
        await expect.poll(visibleGrid).toEqual([expected.headers, ...expected.cells])
        await expect(table.locator('table tr').first().locator(expected.headerEnabled ? 'th' : 'td')).toHaveCount(expected.headers.length)
        const after = await formal()
        expect(after).not.toBe(before)
        await body.press('Control+z')
        await expect.poll(formal).toBe(before)
        await expect.poll(structure).toEqual(baseline)
        await expect.poll(visibleGrid).toEqual([baseline.headers, ...baseline.cells])
        await body.press('Control+Shift+z')
        await expect.poll(formal).toBe(after)
        await expect.poll(structure).toEqual(expected)
        await expect.poll(visibleGrid).toEqual([expected.headers, ...expected.cells])
        await body.press('Control+z')
        await expect.poll(formal).toBe(before)
      }
      await run('下方插入行', 'quick', { ...baseline, cells: [['丙', '丁'], ['', ''], ['戊', '己']] })
      await run('上方插入行', 'context', { ...baseline, cells: [['', ''], ['丙', '丁'], ['戊', '己']] })
      await run('删除行', 'quick', { ...baseline, cells: [['戊', '己']] })
      await run('右侧插入列', 'context', { ...baseline, headers: ['甲', '新列', '乙'],
        cells: [['丙', '', '丁'], ['戊', '', '己']] })
      await run('左侧插入列', 'quick', { ...baseline, headers: ['新列', '甲', '乙'],
        cells: [['', '丙', '丁'], ['', '戊', '己']] })
      await run('删除列', 'context', { ...baseline, headers: ['乙'], cells: [['丁'], ['己']] })
      await run('关闭表头', 'quick', { ...baseline, headerEnabled: false })
    } finally { await closeSelectionApp(app); await server.close() }
  })
  test('M16-T06 ' + carrier + ': table merge, split and delete keep one-step history', async () => {
    test.setTimeout(120_000)
    const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
    const page = await app.firstWindow()
    try {
      await setupSelectionUI(app, page, server.endpoint, data.workspace)
      const name = '表格验收.' + (carrier === 'flow' ? 'h5lesson' : 'md')
      const opened = await openSelectionFile(page, data.workspace, name)
      const body = await bodyFor(page, carrier, name)
      const table = carrier === 'flow' ? body.locator('[data-flow-body-block="table"]').first()
        : body.locator('figure:has(table)').first()
      const formal = async () => {
        const snapshot = await readSelectionDocument(page, opened.documentId)
        if (snapshot.model.kind === 'markdown') return snapshot.model.source
        if (snapshot.model.kind === 'course-v9') return JSON.stringify(snapshot.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks)
        throw new Error('Unexpected document kind ' + snapshot.model.kind)
      }
      const tableData = async () => {
        const entry = (await blocks(page, opened.documentId)).find(block => block.type === 'table')
        if (!entry || entry.type !== 'table') throw new Error('Formal table missing')
        return entry
      }
      const firstRowText = async () => {
        const entry = await tableData()
        return entry.columns.map(column => entry.rows[0]!.cells[column.id]!.inlines
          .map(item => item.type === 'text' ? item.text : '').join(''))
      }
      const baseline = await formal()
      const cells = table.locator('table tr').nth(1).locator('td')
      await expect(cells).toHaveCount(2)
      const first = await cells.nth(0).boundingBox(), second = await cells.nth(1).boundingBox()
      if (!first || !second) throw new Error('Data cells have no screen geometry')
      await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
      await page.mouse.down()
      await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 12 })
      await page.mouse.up()
      await expect(table.locator('td.selectedCell')).toHaveCount(2)
      const bar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await expect(bar).toBeVisible()
      await bar.getByRole('button', { name: '表格操作' }).click()
      const merge = page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '合并单元格' })
      await expect(merge).toBeEnabled()
      await merge.click()
      await expect.poll(async () => (await tableData()).merges?.map(item => [item.rowIds.length, item.columnIds.length])).toEqual([[1, 2]])
      await expect.poll(firstRowText).toEqual(['丙\n丁', ''])
      await expect(cells).toHaveCount(1)
      await expect(cells.first()).toHaveAttribute('colspan', '2')
      await expect(cells.first()).toContainText('丙')
      await expect(cells.first()).toContainText('丁')
      const merged = await formal()
      expect(merged).not.toBe(baseline)
      await body.press('Control+z')
      await expect.poll(formal).toBe(baseline)
      await expect(cells).toHaveCount(2)
      await body.press('Control+Shift+z')
      await expect.poll(formal).toBe(merged)
      await expect(cells).toHaveCount(1)
      await cells.first().click({ button: 'right' })
      const split = page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '拆分单元格' })
      await expect(split).toBeEnabled()
      await split.click()
      await expect.poll(async () => (await tableData()).merges ?? []).toEqual([])
      await expect.poll(firstRowText).toEqual(['丙\n丁', ''])
      await expect(cells).toHaveCount(2)
      await expect(cells.nth(1)).toHaveText('')
      await expect(cells.first()).toContainText('丙')
      await expect(cells.first()).toContainText('丁')
      const splitFormal = await formal()
      expect(splitFormal).not.toBe(merged)
      await body.press('Control+z')
      await expect.poll(formal).toBe(merged)
      await expect(cells).toHaveCount(1)
      await body.press('Control+Shift+z')
      await expect.poll(formal).toBe(splitFormal)
      await expect(cells).toHaveCount(2)
      await cells.first().click({ button: 'right' })
      const remove = page.getByRole('menu', { name: '表格操作' }).getByRole('menuitem', { name: '删除表格' })
      await expect(remove).toBeEnabled()
      await remove.click()
      await expect.poll(async () => (await blocks(page, opened.documentId)).some(block => block.type === 'table')).toBe(false)
      await expect(table).toHaveCount(0)
      const deleted = await formal()
      expect(deleted).not.toBe(splitFormal)
      await body.press('Control+z')
      await expect.poll(formal).toBe(splitFormal)
      await expect(table).toBeVisible()
      await expect(cells).toHaveCount(2)
      await body.press('Control+Shift+z')
      await expect.poll(formal).toBe(deleted)
      await expect(table).toHaveCount(0)
    } finally { await closeSelectionApp(app); await server.close() }
  })
  test(`M16-T05 ${carrier}: clipboard menu and native rich/plain paste preserve formal content`, async () => {
    test.setTimeout(150_000)
    const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
    const page = await app.firstWindow(), restoreClipboard = await preserveClipboard()
    try {
      await setupSelectionUI(app, page, server.endpoint, data.workspace)
      const assertClipboardFocus = async () => {
        await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          return { window: window.isFocused(), webContents: window.webContents.isFocused() }
        })).toEqual({ window: true, webContents: true })
      }
      const focusClipboardWindow = async () => {
        await page.bringToFront()
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          window.show()
          window.focus()
          window.webContents.focus()
        })
        await assertClipboardFocus()
      }
      const name = carrier === 'flow' ? '正文验收.h5lesson' : '正文验收.md'
      const opened = await openSelectionFile(page, data.workspace, name)
      const body = await bodyFor(page, carrier, name)
      await focusClipboardWindow()
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
        html: clipboard.readHTML(), formats: clipboard.availableFormats() }))
      expect(copied.text).toBe('先预测')
      expect(copied.formats).toContain('application/x-cw-document-slice')
      expect(copied.html).toBe('')
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
      const plainDiagnostic: unknown[] = []
      await page.evaluate(() => {
        const probe = window as Window & { __m16PasteEvents?: Array<Record<string, unknown>> }
        probe.__m16PasteEvents = []
        document.addEventListener('paste', event => {
          const target = event.target instanceof Element ? event.target : null
          const entry: Record<string, unknown> = { target: target?.outerHTML.slice(0, 300) ?? null,
            text: event.clipboardData?.getData('text/plain') ?? null, types: [...(event.clipboardData?.types ?? [])],
            defaultPreventedAtCapture: event.defaultPrevented, trusted: event.isTrusted }
          probe.__m16PasteEvents!.push(entry)
          queueMicrotask(() => { entry.defaultPreventedAfterDispatch = event.defaultPrevented })
        }, { capture: true })
      })
      const capturePlain = async (stage: string, readFormal: () => Promise<string> = formal) => {
        const ui = await page.evaluate(() => {
          const active = document.activeElement, selection = window.getSelection()
          return { active: active instanceof Element ? { tag: active.tagName, label: active.getAttribute('aria-label'),
            text: active.textContent?.slice(0, 80) } : null, selection: selection?.toString() ?? null,
            alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent?.trim() ?? ''),
            paste: (window as Window & { __m16PasteEvents?: Array<Record<string, unknown>> }).__m16PasteEvents ?? [] }
        })
        const focus = await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          return { window: window.isFocused(), webContents: window.webContents.isFocused() }
        })
        plainDiagnostic.push({ stage, ui, focus, clipboardText: await app.evaluate(({ clipboard }) => clipboard.readText()), formal: await readFormal() })
        writeFileSync(join(data.directory, `${carrier}-clipboard-plain-diagnostic.json`), JSON.stringify(plainDiagnostic, null, 2))
      }
      await focusClipboardWindow()
      await selectVisibleText(page, body, '再观察')
      await rightClickSelectedText(page, '再观察')
      await capturePlain('before-menu-command')
      await assertClipboardFocus()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '粘贴为纯文本' }).click()
      await capturePlain('after-menu-command')
      try { await expect.poll(visibleText).toBe('甲段：先预测，先预测。') }
      finally { await capturePlain('after-formal-observation') }
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
        html: clipboard.readHTML(), formats: clipboard.availableFormats() }))
      expect(objectClipboard.text).toContain('先预测')
      expect(objectClipboard.text).toContain('再观察')
      expect(objectClipboard.formats).toContain('application/x-cw-document-slice')
      expect(objectClipboard.html).toBe('')
      const targetParagraph = async () => {
        const entry = (await blocks(page, objectOpened.documentId)).find(item => item.type === 'paragraph' && JSON.stringify(item).includes('乙段：'))
        if (!entry || entry.type !== 'paragraph') throw new Error('Paste target paragraph missing')
        return entry.content.inlines
      }
      await selectVisibleText(page, objectBody, '保持原样')
      await objectBody.press('Control+v')
      await expect.poll(async () => (await targetParagraph()).some(item => item.type === 'math' && item.latex === 'x')).toBe(true)
      const richTarget = await targetParagraph()
      expect(richTarget.map(item => item.type === 'text' ? item.text : item.accessibleText).join('')).toContain('先预测公式x，再观察')
      await objectBody.press('Control+z')
      await expect.poll(objectFormal).toBe(objectBefore)
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(objectClipboard.text)
      expect(await app.evaluate(({ clipboard }) => clipboard.availableFormats())).toContain('application/x-cw-document-slice')
      await focusClipboardWindow()
      await selectVisibleText(page, objectBody, '保持原样')
      await rightClickSelectedText(page, '保持原样')
      await capturePlain('object-before-menu-command', objectFormal)
      await assertClipboardFocus()
      await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '粘贴为纯文本' }).click()
      await capturePlain('object-after-menu-command', objectFormal)
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
