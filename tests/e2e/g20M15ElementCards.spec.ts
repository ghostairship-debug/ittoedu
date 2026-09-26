import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openInWorkbench, root } from './helpers/g20M19Harness'
import { canvasReady, centre, flowCourseWithFigure, FRAMES, lightCourse, onStage } from './helpers/g20M21Harness'
import { cardModelServer } from './helpers/g20M15CardModel'
import { closeSelectionApp, launchSelectionApp, selectVisibleText, setupSelectionUI } from './helpers/g20SelectionHarness'

const COURSE = 'm15-cards.h5lesson', FLOW = 'm15-flow.h5lesson', NOTES = 'm15-notes.md'
const NOTES_SOURCE = '# 备课笔记\n\n先观察图片，再说说看到了什么。\n\n第二段保持原样。\n'

type Model = { kind: string; project?: unknown; source?: string }
async function documentOf(page: Page, file: string): Promise<{ revision: number; dirty: boolean; model: Model }> {
  return page.evaluate(async file => {
    const found = (await window.desktopAPI.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith(file))
    if (!found) throw new Error(`no document ${file}`)
    return { revision: found.revision, dirty: found.dirty, model: found.model as unknown as { kind: string; project?: unknown; source?: string } }
  }, file)
}
/** A text object's words on the course, or on its infinite canvas. */
async function textOf(page: Page, id: string): Promise<string | null> {
  const { model } = await documentOf(page, COURSE)
  const project = model.project as { surfaces: Array<{ type: string; scenes?: Array<{ layerItems: Array<Record<string, any>> }>; world?: { layerItems: Array<Record<string, any>> } }> }
  for (const surface of project.surfaces) {
    const items = surface.type === 'slide' ? surface.scenes!.flatMap(scene => scene.layerItems) : surface.type === 'spatial-2d' ? surface.world!.layerItems : []
    const item = items.find(entry => entry.layerItemId === id)
    if (item) return item.content?.data?.text ?? null
  }
  return null
}

test('M15-T05 and T07: element AI cards and selected-text AI cards', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(900_000)
  const base = join(root, 'output/g20/m15/element-cards'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  writeFileSync(join(workspace, COURSE), lightCourse('M15 元素卡'))
  writeFileSync(join(workspace, FLOW), flowCourseWithFigure())
  writeFileSync(join(workspace, NOTES), NOTES_SOURCE)
  const model = await cardModelServer()
  const evidence: Record<string, unknown> = { run: directory }
  const errors: string[] = []
  const app = await launchSelectionApp(directory)
  const page = await app.firstWindow()
  try {
    page.on('pageerror', error => errors.push(error.message))
    await setupSelectionUI(app, page, model.endpoint, workspace)
    await expect(page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: COURSE, exact: true })).toBeVisible()
    // The assistant is collapsed: the cards do not need it.
    const assistantToggle = page.getByRole('button', { name: 'AI 助手', exact: true })
    if (await assistantToggle.getAttribute('aria-pressed') === 'true') await assistantToggle.click()
    await expect(page.getByRole('main', { name: 'AI 助手' })).toHaveCount(0)
    await openInWorkbench(page, COURSE)
    await canvasReady(page)

    const stage = async () => { const box = await page.locator('.canvas-stage-stack').boundingBox(); if (!box) throw new Error('stage'); return box }
    const quickBar = page.locator('[data-selection-quick-bar]').filter({ visible: true })
    const openCard = async (select: () => Promise<void>): Promise<Locator> => {
      // One card at a time: close what is open before selecting the next element.
      const open = page.getByRole('dialog', { name: /^AI 修改：/ }).filter({ visible: true })
      if (await open.count()) { await page.keyboard.press('Escape'); await expect(open).toHaveCount(0) }
      await select()
      await quickBar.getByRole('button', { name: /^AI (修改|进行中)$/ }).first().click()
      const card = page.getByRole('dialog', { name: /^AI 修改：/ }).filter({ visible: true }).last()
      await expect(card).toBeVisible()
      return card
    }
    const send = async (card: Locator, text: string) => {
      await card.getByRole('textbox', { name: 'AI 修改要求' }).fill(text)
      await card.getByRole('button', { name: '发送', exact: true }).click()
    }
    const entries = (card: Locator) => card.getByRole('list', { name: '修改记录' }).locator('.element-ai-card__entry')
    const entry = (card: Locator, text: string) => entries(card).filter({ hasText: text }).first()
    const clickAt = async (frame: { x: number; y: number; width: number; height: number }) => {
      const point = onStage(await stage(), centre(frame)); await page.mouse.click(point.x, point.y)
    }
    const selectTitle = () => clickAt(FRAMES.title), selectNote = () => clickAt(FRAMES.note)
    const indicator = page.getByRole('button', { name: /^AI (进行中|需回答) \d+$/ })
    /** A Markdown file opens in the document editor, not on a canvas. */
    const openDocument = async (name: string) => {
      const back = page.getByRole('button', { name: '返回工作台', exact: true })
      if (await back.isVisible()) await back.click()
      await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name, exact: true }).dblclick()
      await expect(page.getByRole('tab', { name: new RegExp(`^${name.replace(/[.]/g, '\\.')}`) })).toHaveAttribute('aria-selected', 'true')
      const editor = page.locator('.ProseMirror').filter({ visible: true }).first()
      await expect(editor).toBeVisible()
      return editor
    }

    await test.step('M15-T05 a Slide object has its own card: the request changes it through the real tools', async () => {
      const card = await openCard(selectTitle)
      await send(card, '改文字：课题（AI）')
      await expect(entry(card, '改文字：课题（AI）').locator('.element-ai-card__state')).toHaveText('已完成', { timeout: 60_000 })
      await expect.poll(() => textOf(page, 'title')).toBe('课题（AI）')
      // The card's task was frozen with this one object as its only writable target.
      const request = model.requests.find(item => item.instruction.includes('课题（AI）'))!
      expect(request.frozen).toHaveLength(1)
      expect(request.frozen[0]!.writable.map(target => target.kind)).toEqual(['course-object'])
      expect(await textOf(page, 'note')).toBe('要点')
      await page.screenshot({ path: join(shots, 't05-slide-card.png') })
      evidence.slide = { writable: request.frozen[0]!.writable.length }
    })

    await test.step('M15-T05 requests to one element queue; requests to different elements run side by side', async () => {
      let card = await openCard(selectTitle)
      await send(card, '慢：改文字：课题一')
      await expect(entry(card, '课题一').locator('.element-ai-card__state')).toHaveText('进行中…', { timeout: 30_000 })
      await send(card, '改文字：课题二')
      await expect(entry(card, '课题二').locator('.element-ai-card__state')).toHaveText('排队中')
      // Another object's request starts while the first object's is still running.
      await page.keyboard.press('Escape')
      const noteCard = await openCard(selectNote)
      await send(noteCard, '慢：改文字：要点一')
      await expect(entry(noteCard, '要点一').locator('.element-ai-card__state')).toHaveText('进行中…', { timeout: 30_000 })
      await expect.poll(() => model.inFlight).toBe(2)
      await expect(indicator).toHaveText(/AI 进行中 [23]/)
      await page.screenshot({ path: join(shots, 't05-parallel.png') })
      model.release('慢：改文字：要点一')
      model.release('慢：改文字：课题一')
      await expect.poll(() => textOf(page, 'note'), { timeout: 60_000 }).toBe('要点一')
      await expect.poll(() => textOf(page, 'title'), { timeout: 60_000 }).toBe('课题二')
      await page.keyboard.press('Escape')
      card = await openCard(selectTitle)
      await expect(entry(card, '课题一').locator('.element-ai-card__state')).toHaveText('已完成')
      await expect(entry(card, '课题二').locator('.element-ai-card__state')).toHaveText('已完成')
      evidence.parallel = { maxInFlight: model.maxInFlight }
      await page.keyboard.press('Escape')
    })

    await test.step('M15-T05 a question is answered in the card; the top-bar indicator jumps back to the element', async () => {
      const card = await openCard(selectTitle)
      await send(card, '问我')
      await expect(card.getByRole('button', { name: '说法乙' })).toBeVisible({ timeout: 30_000 })
      await page.keyboard.press('Escape')
      // On another page the indicator still says which element waits.
      await page.getByRole('navigation', { name: '场景与页面导航' }).getByRole('button', { name: /练习/ }).first().click()
      await canvasReady(page)
      await expect(indicator).toHaveText('AI 需回答 1')
      await indicator.click()
      await page.getByRole('menu', { name: '元素 AI 卡' }).getByRole('menuitem', { name: /：需回答$/ }).click()
      await canvasReady(page)
      const back = page.getByRole('dialog', { name: /^AI 修改：/ }).filter({ visible: true }).last()
      await expect(back.getByRole('button', { name: '说法乙' })).toBeVisible()
      await back.getByRole('button', { name: '说法乙' }).click()
      await expect.poll(() => textOf(page, 'title'), { timeout: 60_000 }).toBe('说法乙')
      await page.screenshot({ path: join(shots, 't05-answered.png') })
      await page.keyboard.press('Escape')
    })

    await test.step('M15-T05 with 修改前询问 the approval is given in the card', async () => {
      await assistantToggle.click()
      await page.getByRole('button', { name: /^权限：/ }).click()
      await page.getByRole('menu', { name: '权限模式' }).getByRole('menuitemradio', { name: /^修改前询问/ }).click()
      await assistantToggle.click()
      const card = await openCard(selectNote)
      await send(card, '改文字：要点（批准后）')
      const approval = card.getByRole('region', { name: '修改请求' })
      await expect(approval).toBeVisible({ timeout: 30_000 })
      expect(await textOf(page, 'note')).toBe('要点一')
      await approval.getByRole('button', { name: '允许', exact: true }).click()
      await expect.poll(() => textOf(page, 'note'), { timeout: 60_000 }).toBe('要点（批准后）')
      await page.screenshot({ path: join(shots, 't05-approved.png') })
      await page.keyboard.press('Escape')
      await assistantToggle.click()
      await page.getByRole('button', { name: /^权限：/ }).click()
      await page.getByRole('menu', { name: '权限模式' }).getByRole('menuitemradio', { name: /^完全访问（工作空间）/ }).click()
      // The cards are not in the session list.
      const sessions = await page.evaluate(async folder => {
        const opened = await window.desktopAPI.execution!.workspace(folder)
        return (await window.desktopAPI.execution!.conversations(opened.workspace.workspaceId)).map(item => ({ title: item.title, element: Boolean((item as { element?: unknown }).element) }))
      }, workspace)
      expect(sessions.every(item => !item.element)).toBe(true)
      evidence.sessions = sessions
      await assistantToggle.click()
    })

    await test.step('M15-T05 deleting the element hides its card; undoing brings it back with its records; saving keeps them, closing ends them', async () => {
      await selectTitle()
      await page.keyboard.press('Delete')
      await expect.poll(() => textOf(page, 'title')).toBeNull()
      await page.keyboard.press('Control+Z')
      await expect.poll(() => textOf(page, 'title')).toBe('说法乙')
      let card = await openCard(selectTitle)
      await expect(entry(card, '课题（AI）')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+S')
      await expect.poll(async () => (await documentOf(page, COURSE)).dirty).toBe(false)
      card = await openCard(selectTitle)
      await expect(entry(card, '课题（AI）')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${COURSE}`, exact: true }).click()
      await openInWorkbench(page, COURSE)
      await canvasReady(page)
      card = await openCard(selectTitle)
      await expect(entries(card)).toHaveCount(0)
      await expect(card).toContainText('这里的 AI 只改这一个对象')
      await page.keyboard.press('Escape')
    })

    await test.step('M15-T05 a Runtime and an infinite-canvas object have their own cards too', async () => {
      // The Runtime: its card reads it through the same tools and answers in the card.
      const runtimeCard = await openCard(() => clickAt({ x: 60, y: 260, width: 560, height: 220 }))
      await send(runtimeCard, '看看')
      await expect(entry(runtimeCard, '看看').locator('.element-ai-card__state')).toHaveText('已完成', { timeout: 60_000 })
      await expect(entry(runtimeCard, '看看')).toContainText('看过了')
      const inspected = model.requests.find(item => item.instruction === '看看')!
      expect(inspected.frozen[0]!.writable.map(target => target.kind)).toEqual(['course-object'])
      await page.screenshot({ path: join(shots, 't05-runtime-card.png') })
      await page.keyboard.press('Escape')
      // The infinite canvas's world note.
      await page.getByRole('navigation', { name: '场景与页面导航' }).getByRole('button', { name: /^无限画布 \d+：空间$/ }).click()
      await expect(page.locator('[data-observation-spatial-camera]').filter({ visible: true }).first()).toBeVisible()
      const card = await openCard(async () => {
        const viewport = (await page.locator('main.workspace').filter({ visible: true }).first().boundingBox())!
        await page.mouse.click(viewport.x + viewport.width - 60, viewport.y + viewport.height - 60, { button: 'right' })
        await page.getByRole('menu', { name: '画布操作' }).getByRole('menuitem', { name: '全选', exact: true }).click()
      })
      await send(card, '改文字：空间便签（AI）')
      await expect.poll(() => textOf(page, 'world-note'), { timeout: 60_000 }).toBe('空间便签（AI）')
      await page.screenshot({ path: join(shots, 't05-spatial-card.png') })
      await page.keyboard.press('Escape')
    })

    await test.step('M15-T05 a table in a document has its own card', async () => {
      await openInWorkbench(page, FLOW)
      const flow = page.locator('.flow-workspace').filter({ visible: true }).first()
      const cells = flow.locator('[data-document-id="flow-table"] td')
      const rowsBefore = await flow.locator('[data-document-id="flow-table"] tr').count()
      const selectCells = async () => {
        await cells.first().scrollIntoViewIfNeeded()
        const from = centre((await cells.nth(0).boundingBox())!), to = centre((await cells.nth(1).boundingBox())!)
        await page.mouse.move(from.x, from.y); await page.mouse.down()
        await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2); await page.mouse.move(to.x, to.y); await page.mouse.up()
      }
      const card = await openCard(selectCells)
      await send(card, '加一行')
      // The card stays open over its own edit: the cells stay selected at the new revision.
      await expect(entry(card, '加一行').locator('.element-ai-card__state')).toHaveText('已完成', { timeout: 60_000 })
      await expect(entry(card, '加一行')).toContainText('已修改')
      await expect.poll(() => flow.locator('[data-document-id="flow-table"] tr').count()).toBe(rowsBefore + 1)
      const request = model.requests.find(item => item.instruction === '加一行')!
      expect(request.frozen[0]!.writable.map(target => target.kind)).toEqual(['flow-block'])
      await page.screenshot({ path: join(shots, 't05-flow-table.png') })
      evidence.table = { rowsBefore, rowsAfter: rowsBefore + 1 }
      await page.keyboard.press('Escape')
    })

    await test.step('M15-T07 a selected Markdown text has a card: follow-ups, undo and redo; closing ends it; selecting again opens a new one', async () => {
      const editor = await openDocument(NOTES)
      const source = async () => (await documentOf(page, NOTES)).model.source ?? ''
      await selectVisibleText(page, editor, '先观察图片')
      const textBar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await textBar.getByRole('button', { name: 'AI 修改', exact: true }).click()
      const card = page.getByRole('dialog', { name: /^AI 修改：“/ }).filter({ visible: true }).last()
      await expect(card).toBeVisible()
      await send(card, '改文字：先看图')
      await expect.poll(source, { timeout: 60_000 }).toContain('先看图，再说说')
      await expect(entry(card, '先看图').locator('.element-ai-card__state')).toHaveText('已完成')
      await send(card, '改文字：先仔细看图')
      await expect.poll(source, { timeout: 60_000 }).toContain('先仔细看图，再说说')
      await expect(entry(card, '先仔细看图').locator('.element-ai-card__state')).toHaveText('已完成')
      await card.getByRole('button', { name: '撤销这张卡的 AI 修改' }).click()
      await expect.poll(source).toContain('先看图，再说说')
      await card.getByRole('button', { name: '重做这张卡的 AI 修改' }).click()
      await expect.poll(source).toContain('先仔细看图，再说说')
      await page.screenshot({ path: join(shots, 't07-markdown-card.png') })
      await card.getByRole('button', { name: '关闭 AI 卡' }).click()
      await expect(card).toHaveCount(0)
      expect(await source()).toContain('先仔细看图，再说说')
      // The edits stay and are ordinary edits of the document: the editor's own undo and redo take them back and forth.
      await editor.click({ position: { x: 4, y: 4 } })
      await page.keyboard.press('Control+Z')
      await expect.poll(source).not.toContain('先仔细看图')
      await page.keyboard.press('Control+Y')
      await expect.poll(source).toContain('先仔细看图，再说说')
      await selectVisibleText(page, editor, '先仔细看图')
      await textBar.getByRole('button', { name: 'AI 修改', exact: true }).click()
      const again = page.getByRole('dialog', { name: /^AI 修改：“/ }).filter({ visible: true }).last()
      await expect(again).toBeVisible()
      await expect(entries(again)).toHaveCount(0)
      await again.getByRole('button', { name: '关闭 AI 卡' }).click()
      evidence.markdown = await source()
    })

    await test.step('M15-T07 a selected Flow paragraph text behaves the same', async () => {
      await openInWorkbench(page, FLOW)
      const flow = page.locator('.flow-workspace').filter({ visible: true }).first()
      // The body's editor (the page also has its paper overlay's): found by words the card leaves alone.
      const editor = flow.locator('.ProseMirror').filter({ hasText: '连续编辑不拆分组合文本' }).first()
      const flowText = async () => JSON.stringify((await documentOf(page, FLOW)).model.project)
      // The page is long: bring the sentence itself into view before selecting it.
      const select = async (text: string) => {
        await flow.getByText(text, { exact: false }).first().scrollIntoViewIfNeeded()
        await selectVisibleText(page, editor, text)
      }
      await select('春风又绿江南岸')
      const textBar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await textBar.getByRole('button', { name: 'AI 修改', exact: true }).click()
      const card = page.getByRole('dialog', { name: /^AI 修改：“/ }).filter({ visible: true }).last()
      await expect(card).toBeVisible()
      await send(card, '改文字：春风又到江南岸')
      await expect.poll(flowText, { timeout: 60_000 }).toContain('春风又到江南岸')
      await send(card, '改文字：春风又吹江南岸')
      await expect.poll(flowText, { timeout: 60_000 }).toContain('春风又吹江南岸')
      await card.getByRole('button', { name: '撤销这张卡的 AI 修改' }).click()
      await expect.poll(flowText).toContain('春风又到江南岸')
      await card.getByRole('button', { name: '重做这张卡的 AI 修改' }).click()
      await expect.poll(flowText).toContain('春风又吹江南岸')
      await page.screenshot({ path: join(shots, 't07-flow-card.png') })
      await card.getByRole('button', { name: '关闭 AI 卡' }).click()
      await expect(card).toHaveCount(0)
      await select('春风又吹江南岸')
      await textBar.getByRole('button', { name: 'AI 修改', exact: true }).click()
      const again = page.getByRole('dialog', { name: /^AI 修改：“/ }).filter({ visible: true }).last()
      await expect(entries(again)).toHaveCount(0)
      await again.getByRole('button', { name: '关闭 AI 卡' }).click()
    })
    evidence.requests = model.requests.map(item => ({ instruction: item.instruction, step: item.step, writable: item.frozen[0]?.writable.map(target => target.kind), ...(item.reply ? { reply: item.reply } : {}) }))
    evidence.errors = errors
    expect(errors).toEqual([])
  } finally {
    // What the cards said and what the model was asked, for a failed run too.
    evidence.cards ??= await page.locator('.element-ai-card').allInnerTexts().catch(() => [])
    evidence.requests ??= model.requests.map(item => ({ instruction: item.instruction, step: item.step, writable: item.frozen[0]?.writable.map(target => target.kind), ...(item.reply ? { reply: item.reply } : {}) }))
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await closeSelectionApp(app)
    await model.close()
  }
})
