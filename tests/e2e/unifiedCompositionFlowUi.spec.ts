import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowSurface } from '../../src/core/tools/flowDocumentModel'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionLayerItem, CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, readSelectionDocument } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const courseName = '组合内容实际编辑.h5lesson'
const original = '先预测变化，再用观察解释结论。'
const replacement = '根据实际观察说明结论，并写出支持判断的证据。'

function fixture(): CourseProjectDocument {
  const project = createBlankCourseProject({ title: '组合内容实际编辑', includeDefaultController: false, controls: 'none' })
  const flow = createBlankFlowSurface({ id: 'composition-flow', title: '正文与组合内容', headingId: 'flow-heading', paragraphId: 'flow-paragraph' })
  const item: CompositionLayerItem = {
    layerItemId: 'composition-card', kind: 'composition', label: '观察卡片', locked: false,
    order: 0, visible: true, opacity: 1, rotation: 0, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 40, y: 220, width: 580, height: 220 }, paperSpace: 'paper',
    content: { assets: {}, doctype: '<!DOCTYPE html>', root: { id: 'html', kind: 'element', tagName: 'html', attributes: {}, children: [
      { id: 'head', kind: 'element', tagName: 'head', attributes: {}, children: [
        { id: 'style', kind: 'element', tagName: 'style', attributes: {}, children: [{ id: 'css', kind: 'text', text: 'html,body{margin:0;font:20px sans-serif;color:#183b32}main{padding:24px;box-sizing:border-box;background:#f0f8f3;border:2px solid #478565;border-radius:16px;height:220px}h2{font-size:28px;margin:0 0 16px}p{margin:0;line-height:1.5}' }] },
      ] },
      { id: 'body', kind: 'element', tagName: 'body', attributes: {}, children: [
        { id: 'card', kind: 'element', tagName: 'main', attributes: {}, children: [
          { id: 'heading', kind: 'element', tagName: 'h2', attributes: { id: 'observation-heading' }, children: [{ id: 'heading-text', kind: 'text', text: '观察并解释' }] },
          { id: 'prompt', kind: 'element', tagName: 'p', attributes: { id: 'observation-prompt' }, children: [{ id: 'prompt-text', kind: 'text', text: original }] },
        ] },
      ] },
    ] } },
  }
  flow.surface.surfaceLayerItems.push({ item, visibility: { mode: 'all', locationIds: [] } })
  return { ...project, surfaces: [flow.surface], locations: [flow.location], startLocationId: flow.location.id }
}

function readContent(project: CourseProjectDocument) {
  const flow = project.surfaces.find(surface => surface.type === 'flow')!
  const item = flow.surfaceLayerItems.find(entry => entry.item.layerItemId === 'composition-card')!.item
  if (item.kind !== 'composition') throw new Error('Formal composition disappeared')
  const text = findCompositionNode(item.content.root, 'prompt-text')
  if (text?.kind !== 'text') throw new Error('Editable text identity disappeared')
  return { text: text.text, item, blocks: flow.blocks }
}

test('Flow actual connector edits composition through canonical history and preserves it on save and reopen', async ({}, info) => {
  test.setTimeout(120_000)
  const output = join(root, 'output/unified-content/flow-composition-ui')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const coursePath = join(workspace, courseName), baseline = fixture()
  const driver = new CourseV9Driver()
  writeFileSync(coursePath, driver.serialize({ kind: 'course-v9', project: baseline, resources: { assets: {}, components: {} } }))
  const app = await launchSelectionApp(directory)
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    const rendererErrors: string[] = []
    page.on('pageerror', error => rendererErrors.push(error.message))
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const opened = await openSelectionFile(page, workspace, courseName)
    await page.locator('.course-editor-frame:visible').getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await expect(page.getByTestId('flow-workspace')).toBeVisible()
    const card = page.getByTestId('flow-layer-card-composition-card')
    await expect(card).toBeVisible()
    await expect(card.frameLocator('iframe[data-web-composition]').locator('#observation-prompt')).toHaveText(original)
    await card.click({ position: { x: 18, y: 18 } })
    await page.getByRole('button', { name: '编辑组合内容', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑组合内容', exact: true })
    await expect(dialog).toBeVisible()
    const preview = dialog.frameLocator('iframe[data-web-composition]')
    await preview.locator('#observation-prompt').click()
    const text = dialog.getByLabel('正文', { exact: true })
    await expect(text).toHaveValue(original)
    await text.fill(replacement)
    await text.blur()
    const read = () => readSelectionDocument(page, opened.documentId)
    await expect.poll(async () => {
      const current = await read()
      return current.model.kind === 'course-v9' ? readContent(current.model.project).text : null
    }).toBe(replacement)
    const edited = await read()
    expect(edited.undoDepth).toBe(1)
    expect(edited.dirty).toBe(true)
    await expect(preview.locator('#observation-prompt')).toHaveText(replacement)
    await dialog.getByRole('button', { name: '返回画布', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(card.frameLocator('iframe[data-web-composition]').locator('#observation-prompt')).toHaveText(replacement)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect.poll(async () => (await read()).redoDepth).toBe(1)
    await expect(card.frameLocator('iframe[data-web-composition]').locator('#observation-prompt')).toHaveText(original)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect.poll(async () => (await read()).undoDepth).toBe(1)
    await expect(card.frameLocator('iframe[data-web-composition]').locator('#observation-prompt')).toHaveText(replacement)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await read()).dirty).toBe(false)
    const disk = driver.load(new Uint8Array(readFileSync(coursePath)))
    if (disk.kind !== 'course-v9') throw new Error('Saved file changed document kind')
    expect(readContent(disk.project).text).toBe(replacement)
    expect(readContent(disk.project).blocks).toEqual(readContent(baseline).blocks)
    expect(readContent(disk.project).item.frame).toEqual(readContent(baseline).item.frame)
    await page.screenshot({ path: join(directory, 'flow-edited.png') })
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${courseName}`, exact: true }).click()
    const reopened = await openSelectionFile(page, workspace, courseName)
    expect(reopened.documentId).not.toBe(opened.documentId)
    expect(reopened.dirty).toBe(false)
    if (reopened.model.kind !== 'course-v9') throw new Error('Reopened file changed document kind')
    expect(readContent(reopened.model.project).text).toBe(replacement)
    await page.locator('.course-editor-frame:visible').getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await expect(page.getByTestId('flow-layer-card-composition-card').frameLocator('iframe[data-web-composition]').locator('#observation-prompt')).toHaveText(replacement)
    expect(rendererErrors).toEqual([])
    const evidence = { documentId: opened.documentId, reopenedDocumentId: reopened.documentId,
      editedRevision: edited.revision, undoDepth: edited.undoDepth, dirtyAfterSave: false,
      original, replacement, preservedFrame: readContent(disk.project).item.frame, rendererErrors }
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await info.attach('canonical-composition-ui', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } finally { await closeSelectionApp(app) }
})
