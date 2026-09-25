import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { closeSelectionApp, finishRound, heldRound, launchSelectionApp, openSelectionFile,
  readSelectionDocument, selectVisibleText, selectionFixtures, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'

const body = (page: Page) => page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
async function sendInline(page: Page, instruction: string) {
  const card = page.getByLabel('当前编辑目标', { exact: true })
  await card.getByLabel('AI 指令', { exact: true }).fill(instruction)
  await card.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
}
function flowText(snapshot: DocumentSnapshot, blockId = 'flow-a'): string {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected V9 course')
  const flow = snapshot.model.project.surfaces.find(surface => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('Expected Flow surface')
  const block = flow.blocks.find(item => item.id === blockId)
  if (!block || block.type !== 'paragraph') throw new Error('Expected Flow paragraph')
  return block.content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')
}
function diskFlowText(filename: string): string {
  const model = new CourseV9Driver().load(new Uint8Array(readFileSync(filename)))
  return flowText({ model } as DocumentSnapshot)
}

test('S06-T05 untitled Markdown saves only canonical text during generation, then one Undo and reopen', async ({}, info) => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const source = '第一段：先预测😀，再观察。\n\n第二段：保持原样。\n'
  const replacement = '先讨论😀\n再解释'
  const filename = join(fixture.workspace, '暂存正文.md')
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    await page.getByLabel('新建标签页').click()
    await page.getByLabel('Markdown 文档名', { exact: true }).fill('暂存正文')
    await page.getByRole('button', { name: '创建文档', exact: true }).click()
    const region = page.getByRole('region', { name: '教学文档 暂存正文.md', exact: true })
    await expect(region).toBeVisible()
    await region.getByRole('button', { name: '源文', exact: true }).click()
    await region.getByRole('textbox', { name: '正文源文编辑', exact: true }).fill(source)
    const document = await expect.poll(async () => (await page.evaluate(() => window.desktopAPI.documents!.list()))
      .find(item => item.binding.kind === 'untitled' && item.model.kind === 'markdown'
        && item.model.source === source) ?? null).not.toBeNull()
    void document
    const current = (await page.evaluate(() => window.desktopAPI.documents!.list()))
      .find(item => item.binding.kind === 'untitled' && item.model.kind === 'markdown'
        && item.model.source === source)!
    const before = await readSelectionDocument(page, current.documentId)
    expect(before.binding.kind).toBe('untitled')
    expect(before.dirty).toBe(true)
    expect(before.undoDepth).toBeGreaterThan(0)
    expect(existsSync(filename)).toBe(false)
    await region.getByRole('button', { name: '正文', exact: true }).click()
    await selectVisibleText(page, body(page), '先预测😀')
    const round = server.arm('s06-t05-untitled', 'markdown-range', replacement)
    await sendInline(page, '只改写所选正文，保留未选内容')
    await heldRound(round)
    const preview = body(page).locator('[data-edit-preview]')
    await expect(preview).toContainText('先讨论😀')
    expect((await readSelectionDocument(page, current.documentId)).model).toMatchObject({ source })
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, filename)
    await body(page).press('Control+s')
    await expect.poll(() => existsSync(filename) ? readFileSync(filename, 'utf8') : null).toBe(source)
    const savedDuringGeneration = await readSelectionDocument(page, current.documentId)
    expect(savedDuringGeneration).toMatchObject({ binding: { kind: 'file', path: filename }, dirty: false,
      revision: before.revision, model: { source } })
    await expect(preview).toContainText('先讨论😀')
    await finishRound(page, round)
    await expect(preview).toHaveCount(0)
    const committed = await readSelectionDocument(page, current.documentId)
    expect(committed).toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1,
      model: { source: source.replace('先预测😀', replacement) } })
    await region.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, current.documentId)).model).toMatchObject({ source })
    await expect.poll(async () => (await readSelectionDocument(page, current.documentId)).dirty).toBe(true)
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(filename, 'utf8')).toBe(source)
    await expect.poll(async () => (await readSelectionDocument(page, current.documentId)).dirty).toBe(false)
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 暂存正文.md', exact: true }).click()
    const reopened = await openSelectionFile(page, fixture.workspace, '暂存正文.md')
    expect(reopened.model).toMatchObject({ source })
    expect(round.error).toBeUndefined()
    expect(errors).toEqual([])
    const evidence = join(fixture.directory, 's06-t05-untitled.json')
    writeFileSync(evidence, JSON.stringify({ before: { revision: before.revision, undoDepth: before.undoDepth,
      binding: before.binding }, savedDuringGeneration: { revision: savedDuringGeneration.revision,
      dirty: savedDuringGeneration.dirty, binding: savedDuringGeneration.binding },
    committed: { revision: committed.revision, undoDepth: committed.undoDepth }, reopened: { source: reopened.model,
      dirty: reopened.dirty }, requests: server.requests.length, errors }, null, 2))
    await info.attach('S06-T05 untitled Markdown save and Undo', { path: evidence, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})

test('S06-T05 saved Flow excludes a live preview from disk and restores source selection after Ctrl+Z', async ({}, info) => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const filename = join(fixture.workspace, 'flow.h5lesson')
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'flow.h5lesson')
    const courseTools = page.getByLabel('课件常用工具', { exact: true })
    const before = await readSelectionDocument(page, document.documentId)
    const original = flowText(before)
    const otherOriginal = flowText(before, 'flow-b')
    const humanOther = '乙段：人工已编辑。'
    expect(diskFlowText(filename)).toBe(original)
    await selectVisibleText(page, body(page), '保持原样')
    await page.keyboard.insertText('人工已编辑')
    await expect.poll(async () => flowText(await readSelectionDocument(page, document.documentId), 'flow-b'))
      .toBe(otherOriginal.replace('保持原样', '人工已编辑'))
    const human = await readSelectionDocument(page, document.documentId)
    expect(flowText(human, 'flow-b')).toBe(humanOther)
    expect(human.dirty).toBe(true)
    expect(human.undoDepth).toBe(before.undoDepth + 1)
    await selectVisibleText(page, body(page), '先预测😀')
    const round = server.arm('s06-t05-flow', 'flow-range', '先讨论😀')
    await sendInline(page, '只改写所选讲义正文')
    await heldRound(round)
    const preview = body(page).locator('[data-edit-preview]')
    await expect(preview).toContainText('先讨论😀')
    expect(flowText(await readSelectionDocument(page, document.documentId))).toBe(original)
    await courseTools.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).dirty).toBe(false)
    expect(diskFlowText(filename)).toBe(original)
    expect(flowText(await readSelectionDocument(page, document.documentId), 'flow-b')).toBe(humanOther)
    const savedDuringGeneration = new CourseV9Driver().load(new Uint8Array(readFileSync(filename)))
    const savedSnapshot = { model: savedDuringGeneration } as DocumentSnapshot
    expect(flowText(savedSnapshot, 'flow-b')).toBe(humanOther)
    await expect(preview).toContainText('先讨论😀')
    await finishRound(page, round)
    await expect(preview).toHaveCount(0)
    const committed = await readSelectionDocument(page, document.documentId)
    expect(flowText(committed)).toBe(original.replace('先预测😀', '先讨论😀'))
    expect(flowText(committed, 'flow-b')).toBe(humanOther)
    expect(committed.undoDepth).toBe(human.undoDepth + 1)
    await courseTools.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => flowText(await readSelectionDocument(page, document.documentId))).toBe(original)
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).undoDepth).toBe(human.undoDepth)
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).dirty).toBe(true)
    await courseTools.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => diskFlowText(filename)).toBe(original)
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).dirty).toBe(false)
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 flow.h5lesson', exact: true }).click()
    const reopened = await openSelectionFile(page, fixture.workspace, 'flow.h5lesson')
    expect(flowText(reopened)).toBe(original)
    expect(flowText(reopened, 'flow-b')).toBe(humanOther)

    const format = page.getByTestId('flow-workspace').locator('details.flow-document-format')
    await format.locator('summary').click()
    await format.getByRole('button', { name: '源文', exact: true }).click()
    const sourceBeforeUndo = page.getByTestId('flow-workspace').getByRole('textbox', { name: '正文源文编辑', exact: true })
    await selectVisibleText(page, sourceBeforeUndo, '先预测😀')
    await page.keyboard.insertText('源文临改')
    await expect.poll(async () => flowText(await readSelectionDocument(page, reopened.documentId)))
      .toBe(original.replace('先预测😀', '源文临改'))
    await sourceBeforeUndo.press('Control+z')
    await expect.poll(async () => flowText(await readSelectionDocument(page, reopened.documentId))).toBe(original)
    const undone = await readSelectionDocument(page, reopened.documentId)
    if (undone.model.kind !== 'course-v9') throw new Error('Expected Flow course after source Undo')
    await expect(page.getByTestId('flow-workspace')).toHaveAttribute('data-observation-revision', String(undone.model.project.revision))
    const sourceAfterUndo = page.getByTestId('flow-workspace').getByRole('textbox', { name: '正文源文编辑', exact: true })
    if (!(await sourceAfterUndo.isVisible())) {
      await expect(format).toBeVisible()
      if (await format.getAttribute('open') === null) await format.locator('summary').click()
      await format.getByRole('button', { name: '源文', exact: true }).click()
    }
    await expect(sourceAfterUndo).toBeVisible()
    await selectVisibleText(page, sourceAfterUndo, '先预测😀')
    await expect(page.getByLabel('当前编辑目标', { exact: true })).toBeVisible()
    await page.keyboard.insertText('源文最终改写')
    const finalText = original.replace('先预测😀', '源文最终改写')
    await expect.poll(async () => flowText(await readSelectionDocument(page, reopened.documentId))).toBe(finalText)
    await courseTools.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => diskFlowText(filename)).toBe(finalText)
    await expect.poll(async () => (await readSelectionDocument(page, reopened.documentId)).dirty).toBe(false)
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 flow.h5lesson', exact: true }).click()
    const finalReopen = await openSelectionFile(page, fixture.workspace, 'flow.h5lesson')
    expect(flowText(finalReopen)).toBe(finalText)
    expect(round.error).toBeUndefined()
    expect(errors).toEqual([])
    const evidence = join(fixture.directory, 's06-t05-flow.json')
    writeFileSync(evidence, JSON.stringify({ beforeRevision: before.revision,
      committedRevision: committed.revision, committedUndoDepth: committed.undoDepth,
      generatedText: flowText(committed), savedDuringGeneration: { first: original, second: flowText(savedSnapshot, 'flow-b') },
      sourceAfterUndo: original, finalText, finalReopenText: flowText(finalReopen),
      requests: server.requests.length, errors }, null, 2))
    await info.attach('S06-T05 Flow source recovery', { path: evidence, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})
