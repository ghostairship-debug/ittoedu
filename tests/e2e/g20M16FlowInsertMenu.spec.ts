import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowSurface } from '../../src/core/tools/flowDocumentModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'

const root = join(__dirname, '../..')
const DOCUMENT_COMMANDS = ['标题', '列表', '表格', '公式', '分隔线', '提示框', '折叠节', '图片', '视频', '音频', '组件']
const PAPER_COMMANDS = ['文本框', '图片', '形状', '组件']

function fixture() {
  const base = join(root, 'output/g20/M16/flow-insert-menu')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const driver = new CourseV9Driver()
  const makeCourse = (id: string, title: string, text: string) => {
    const flow = createBlankFlowSurface({ id, title, headingId: `${id}-heading`, paragraphId: `${id}-paragraph` })
    flow.surface.blocks[1] = { id: `${id}-paragraph`, type: 'paragraph', content: { inlines: [{ type: 'text', text }] } }
    const project = courseProjectDocumentSchema.parse({ ...createBlankCourseProject({ title, includeDefaultController: false, controls: 'none' }),
      surfaces: [flow.surface], locations: [flow.location], startLocationId: flow.location.id })
    return driver.serialize({ kind: 'course-v9', project, resources: { assets: {}, components: {} } })
  }
  writeFileSync(join(workspace, 'flow-a.h5lesson'), makeCourse('m16-menu-a', '插入验收 A', '正文 A：原始段落。'))
  writeFileSync(join(workspace, 'flow-b.h5lesson'), makeCourse('m16-menu-b', '插入验收 B', '正文 B：目标页面。'))
  const imagePath = join(directory, 'pixel.png')
  writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64'))
  return { directory, workspace, imagePath }
}

async function showInsertMenu(page: Page) {
  const menu = page.getByRole('menu', { name: 'Flow 插入菜单', exact: true })
  if (!await menu.isVisible()) {
    const elements = page.getByRole('tab', { name: '元素', exact: true })
    if (await elements.isVisible()) await elements.click()
  }
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('region', { name: '插入到正文', exact: true }).getByRole('menuitem')).toHaveCount(11)
  await expect(menu.getByRole('region', { name: '放到纸面上', exact: true }).getByRole('menuitem')).toHaveCount(4)
  await expect(menu.getByRole('menuitem', { name: /屏幕|浮层/ })).toHaveCount(0)
  for (const label of DOCUMENT_COMMANDS) await expect(menu.getByRole('menuitem', { name: label, exact: true }).first()).toBeVisible()
  for (const label of PAPER_COMMANDS) await expect(menu.getByRole('menuitem', { name: label, exact: true }).last()).toBeVisible()
  return menu
}

async function snapshot(page: Page, documentId: string): Promise<DocumentSnapshot> {
  return page.evaluate(id => window.desktopAPI.documents!.read(id), documentId)
}

async function openFlow(page: Page, workspace: string, name: string) {
  const opened = await openSelectionFile(page, workspace, name)
  await showInsertMenu(page)
  return opened
}

test('M16-T06 Flow workbench insert menu exposes the 11 document and 4 paper commands and commits both semantics', async () => {
  test.setTimeout(180_000)
  const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
  const page = await app.firstWindow()
  try {
    await setupSelectionUI(app, page, server.endpoint, data.workspace)
    const opened = await openFlow(page, data.workspace, 'flow-a.h5lesson')
    await app.evaluate(({ dialog }, imagePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] })
    }, data.imagePath)
    let before = await snapshot(page, opened.documentId)
    const beforeBlocks = before.model.kind === 'course-v9' ? before.model.project.surfaces.find(surface => surface.type === 'flow')?.blocks.length : 0
    const menu = page.getByRole('menu', { name: 'Flow 插入菜单', exact: true })
    await menu.getByRole('menuitem', { name: '标题', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, opened.documentId)).revision).toBeGreaterThan(before.revision)
    let after = await snapshot(page, opened.documentId)
    expect(after.undoDepth).toBeGreaterThan(before.undoDepth)
    expect(after.model.kind).toBe('course-v9')
    if (after.model.kind !== 'course-v9') throw new Error('Expected course document')
    let surface = after.model.project.surfaces.find(item => item.type === 'flow')
    expect(surface?.type === 'flow' ? surface.blocks.length : 0).toBeGreaterThan(beforeBlocks ?? 0)
    expect(surface?.type === 'flow' ? surface.blocks.some(block => block.type === 'heading') : false).toBe(true)

    await showInsertMenu(page)
    await page.getByRole('menuitem', { name: '表格', exact: true }).click()
    await expect.poll(async () => {
      const current = await snapshot(page, opened.documentId)
      return current.model.kind === 'course-v9' ? current.model.project.surfaces.find(item => item.type === 'flow')?.blocks.some(block => block.type === 'table') : false
    }).toBe(true)
    await showInsertMenu(page)
    await page.getByRole('menuitem', { name: '文本框', exact: true }).last().click()
    await showInsertMenu(page)
    await page.getByRole('menuitem', { name: '形状', exact: true }).click()
    await showInsertMenu(page)
    await page.getByRole('menuitem', { name: '图片', exact: true }).first().click()
    await expect.poll(async () => {
      const current = await snapshot(page, opened.documentId)
      return current.model.kind === 'course-v9' ? current.model.project.surfaces.find(item => item.type === 'flow')?.blocks.some(block => block.type === 'media' && block.mediaKind === 'image') : false
    }).toBe(true)
    await showInsertMenu(page)
    await page.getByRole('menuitem', { name: '图片', exact: true }).last().click()
    await expect.poll(async () => {
      const current = await snapshot(page, opened.documentId)
      if (current.model.kind !== 'course-v9') return false
      const flow = current.model.project.surfaces.find(item => item.type === 'flow')
      return flow?.type === 'flow' && flow.surfaceLayerItems.some(entry => entry.item.kind === 'native' && entry.item.content.nativeType === 'image')
    }).toBe(true)
    after = await snapshot(page, opened.documentId)
    expect(after.undoDepth).toBeGreaterThan(before.undoDepth + 2)
    expect(after.model.kind).toBe('course-v9')
    if (after.model.kind !== 'course-v9') throw new Error('Expected course document')
    surface = after.model.project.surfaces.find(item => item.type === 'flow')
    expect(surface?.type === 'flow' ? surface.surfaceLayerItems.length : 0).toBeGreaterThanOrEqual(2)
    expect(surface?.type === 'flow' ? surface.surfaceLayerItems.map(entry => entry.item.kind) : []).toContain('native')
    expect(surface?.type === 'flow' ? surface.surfaceLayerItems.some(entry => entry.item.kind === 'native' && entry.item.content.nativeType === 'shape') : false).toBe(true)

    await page.evaluate(async id => { await window.desktopAPI.documents!.save(id) }, opened.documentId)
    await page.evaluate(async id => { await window.desktopAPI.documents!.close(id) }, opened.documentId)
    const reopened = await page.evaluate(async path => window.desktopAPI.documents!.open(path), join(data.workspace, 'flow-a.h5lesson'))
    expect(reopened.model.kind).toBe('course-v9')
    if (reopened.model.kind !== 'course-v9') throw new Error('Expected reopened course document')
    const reopenedFlow = reopened.model.project.surfaces.find(item => item.type === 'flow')
    expect(reopenedFlow?.type === 'flow' ? reopenedFlow.blocks.some(block => block.type === 'heading') : false).toBe(true)
    expect(reopenedFlow?.type === 'flow' ? reopenedFlow.blocks.some(block => block.type === 'table') : false).toBe(true)
    expect(reopenedFlow?.type === 'flow' ? reopenedFlow.surfaceLayerItems.map(entry => entry.item.kind) : []).toEqual(expect.arrayContaining(['native', 'shape']))
    expect(reopenedFlow?.type === 'flow' ? reopenedFlow.blocks.some(block => block.type === 'media' && block.mediaKind === 'image') : false).toBe(true)
    expect(reopenedFlow?.type === 'flow' ? reopenedFlow.surfaceLayerItems.some(entry => entry.item.kind === 'native' && entry.item.content.nativeType === 'image') : false).toBe(true)
    expect(Object.keys(reopened.model.resources.assets).length).toBeGreaterThan(0)
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M16-T06 Flow image chooser result is discarded after switching the captured document session', async () => {
  test.setTimeout(180_000)
  const data = fixture(), server = await selectionServer(), app = await launchSelectionApp(data.directory)
  const page = await app.firstWindow()
  try {
    await setupSelectionUI(app, page, server.endpoint, data.workspace)
    const first = await openFlow(page, data.workspace, 'flow-a.h5lesson')
    const beforeA = await snapshot(page, first.documentId)
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => await new Promise(resolve => {
        (globalThis as typeof globalThis & { __resolveM16Chooser?: (paths: string[]) => void }).__resolveM16Chooser = paths => resolve({ canceled: false, filePaths: paths })
      })
    })
    await page.getByRole('menuitem', { name: '图片', exact: true }).first().click()
    await expect.poll(() => app.evaluate(() => typeof (globalThis as typeof globalThis & { __resolveM16Chooser?: unknown }).__resolveM16Chooser)).toBe('function')
    const second = await openFlow(page, data.workspace, 'flow-b.h5lesson')
    const beforeB = await snapshot(page, second.documentId)
    await app.evaluate((_, path) => (globalThis as typeof globalThis & { __resolveM16Chooser: (paths: string[]) => void }).__resolveM16Chooser([path]), data.imagePath)
    await expect(page.getByRole('alert').filter({ hasText: '文档已切换，请重新插入' })).toBeVisible()
    expect((await snapshot(page, first.documentId)).revision).toBe(beforeA.revision)
    expect((await snapshot(page, second.documentId)).revision).toBe(beforeB.revision)
    const afterA = await snapshot(page, first.documentId), afterB = await snapshot(page, second.documentId)
    for (const current of [afterA, afterB]) {
      expect(current.model.kind).toBe('course-v9')
      if (current.model.kind !== 'course-v9') continue
      const flow = current.model.project.surfaces.find(surface => surface.type === 'flow')
      expect(flow?.type === 'flow' ? flow.blocks.filter(block => block.type === 'media' && block.mediaKind === 'image').length : 0).toBe(0)
      expect(flow?.type === 'flow' ? flow.surfaceLayerItems.filter(entry => entry.item.kind === 'native' && entry.item.content.nativeType === 'image').length : 0).toBe(0)
    }
  } finally {
    await app.evaluate((_, path) => (globalThis as typeof globalThis & { __resolveM16Chooser?: (paths: string[]) => void }).__resolveM16Chooser?.([path]), data.imagePath).catch(() => {})
    await closeSelectionApp(app)
    await server.close()
  }
})
