import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const root = resolve(__dirname, '../..')

function seedMixedCourse(): Uint8Array {
  const driver = new CourseV9Driver()
  const mixed = driver.load(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/mixed.h5lesson'))))
  const media = driver.load(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson'))))
  if (mixed.kind !== 'course-v9' || media.kind !== 'course-v9') throw new Error('fixture kind')
  const slide = mixed.project.surfaces.find(surface => surface.type === 'slide')
  const flow = mixed.project.surfaces.find(surface => surface.type === 'flow')
  const spatial = mixed.project.surfaces.find(surface => surface.type === 'spatial-2d')
  const mediaSlide = media.project.surfaces.find(surface => surface.type === 'slide')
  if (!slide || !flow || !spatial || !mediaSlide) throw new Error('fixture surfaces')
  const image = mediaSlide.scenes[0]!.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'image')
  if (!image) throw new Error('fixture image')
  mixed.project.assets.photo = structuredClone(media.project.assets.photo!)
  mixed.project.assets.diagram = structuredClone(media.project.assets.diagram!)
  mixed.resources.assets.photo = new Uint8Array(media.resources.assets.photo!)
  mixed.resources.assets.diagram = new Uint8Array(media.resources.assets.diagram!)
  slide.scenes[0]!.layerItems.push({ ...structuredClone(image), layerItemId: 'm13-slide-image', label: 'Slide 图片', order: 30 })
  spatial.world.layerItems.push({ ...structuredClone(image), layerItemId: 'm13-spatial-image', label: 'Spatial 图片', order: 30 })
  flow.blocks.push({ id: 'm13-flow-image', type: 'media', mediaKind: 'image', assetId: 'photo', layout: 'content-width' })
  driver.validate(mixed)
  return driver.serialize(mixed)
}

test('M13-T01 real Electron retains three Surface edits, shared History and embedded media on reopen', async () => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/m13/three-surface')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const coursePath = join(workspace, '三表面保全.h5lesson')
  writeFileSync(coursePath, seedMixedCourse())
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: '三表面保全.h5lesson', exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('Course editor did not attach the host document')
    const observed = await page.evaluate(async documentId => {
      const api = window.desktopAPI!.documents!
      const initial = await api.read(documentId)
      if (initial.model.kind !== 'course-v9') throw new Error('fixture kind')
      const baseline = structuredClone(initial.model)
      const edit = async (name: string, mutate: (project: typeof baseline.project) => void) => {
        const current = await api.read(initial.documentId)
        if (current.model.kind !== 'course-v9') throw new Error('course changed kind')
        const project = structuredClone(current.model.project)
        mutate(project)
        const receipt = await api.dispatch({ documentId: current.documentId, epoch: current.epoch,
          baseRevision: current.revision, operationId: name, actor: 'human',
          mutation: { type: 'command', command: { type: 'course.replace', project } } })
        if (receipt.status !== 'applied') throw new Error(`${name}: ${receipt.status} ${'message' in receipt ? receipt.message : ''}`)
      }
      await edit('m13-slide-content', project => {
        const slide = project.surfaces.find(surface => surface.type === 'slide')!
        const scene = slide.scenes[0]!
        const title = scene.layerItems.find(item => item.layerItemId === 'slide-title')!
        if (title.kind !== 'native' || title.content.nativeType !== 'text') throw new Error('Slide title')
        title.content.data.text = 'Slide 更新文字'
        const image = scene.layerItems.find(item => item.layerItemId === 'm13-slide-image')!
        if (image.kind !== 'native' || image.content.nativeType !== 'image') throw new Error('Slide media')
        image.content.data.assetId = 'diagram'
        scene.layerItems.push({ ...structuredClone(title), layerItemId: 'm13-slide-structure', label: 'Slide 新结构', order: 40 })
        scene.interactions.push({ id: 'm13-slide-interaction', enabled: true,
          trigger: { type: 'node.click', nodeId: 'slide-title' }, conditions: [],
          actions: [{ id: 'm13-slide-action', start: 'after-previous', delayMs: 0,
            action: { type: 'location.go', locationId: 'location-flow' } }] })
      })
      await edit('m13-flow-content', project => {
        const flow = project.surfaces.find(surface => surface.type === 'flow')!
        const body = flow.blocks.find(block => block.id === 'flow-paragraph')!
        if (body.type !== 'paragraph') throw new Error('Flow paragraph')
        body.content.inlines = [{ type: 'text', text: 'Flow 更新正文', style: { bold: true } }]
        const image = flow.blocks.find(block => block.id === 'm13-flow-image')!
        if (image.type !== 'media') throw new Error('Flow media')
        image.assetId = 'diagram'
        flow.blocks.push({ id: 'm13-flow-structure', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Flow 新结构' }] } })
        project.globalInteractions.push({ id: 'm13-flow-navigation', enabled: true,
          trigger: { type: 'presenter.command', command: 'next' }, conditions: [],
          actions: [{ id: 'm13-flow-action', start: 'after-previous', delayMs: 0,
            action: { type: 'location.go', locationId: 'location-flow' } }] })
      })
      await edit('m13-spatial-content', project => {
        const spatial = project.surfaces.find(surface => surface.type === 'spatial-2d')!
        const title = spatial.world.layerItems.find(item => item.layerItemId === 'spatial-label')!
        if (title.kind !== 'native' || title.content.nativeType !== 'text') throw new Error('Spatial title')
        title.content.data.text = 'Spatial 更新文字'
        const image = spatial.world.layerItems.find(item => item.layerItemId === 'm13-spatial-image')!
        if (image.kind !== 'native' || image.content.nativeType !== 'image') throw new Error('Spatial media')
        image.content.data.assetId = 'diagram'
        spatial.world.layerItems.push({ ...structuredClone(title), layerItemId: 'm13-spatial-structure', label: 'Spatial 新结构', order: 40 })
        project.globalInteractions.push({ id: 'm13-spatial-navigation', enabled: true,
          trigger: { type: 'presenter.command', command: 'previous' }, conditions: [],
          actions: [{ id: 'm13-spatial-action', start: 'after-previous', delayMs: 0,
            action: { type: 'location.go', locationId: 'location-spatial' } }] })
      })
      const edited = await api.read(initial.documentId)
      if (edited.model.kind !== 'course-v9' || edited.undoDepth !== 3) throw new Error('Three content edits were not committed')
      return { baseline, edited }
    }, documentId) as { baseline: Extract<DocumentSnapshot['model'], { kind: 'course-v9' }>; edited: DocumentSnapshot }

    await frame.getByRole('button', { name: '深度编辑', exact: true }).click()
    const rail = page.locator('.right-sidebar:visible')
    const globalRule = (id: string) => page.locator(`#automation-rule-${id}`)
    const read = () => page.evaluate(id => window.desktopAPI!.documents!.read(id), documentId)
    // Flow and Spatial use the supported global carrier. Keep each surface active while editing its shared rule.
    await page.getByTestId('flow-page-surface-flow').click()
    await expect(page.getByTestId('flow-workspace')).toBeVisible()
    await page.getByTestId('global-layer-entry').click()
    await rail.getByRole('tab', { name: '互动与动画', exact: true }).click()
    await expect(globalRule('m13-flow-navigation')).toBeVisible()
    await globalRule('m13-flow-navigation').getByLabel('规则名称').fill('Flow 页面共享规则已编辑')
    await expect.poll(async () => {
      const snapshot = await read()
      return snapshot.model.kind === 'course-v9' ? snapshot.model.project.globalInteractions.find(rule => rule.id === 'm13-flow-navigation')?.name : null
    }).toBe('Flow 页面共享规则已编辑')

    await page.getByTestId('spatial-camera-location-spatial').click()
    await expect(page.getByTestId('spatial-workspace')).toBeVisible()
    await page.getByTestId('global-layer-entry').click()
    await expect(globalRule('m13-spatial-navigation')).toBeVisible()
    await globalRule('m13-spatial-navigation').getByLabel('规则名称').fill('Spatial 页面共享规则已编辑')
    await expect.poll(async () => {
      const snapshot = await read()
      return snapshot.model.kind === 'course-v9' ? snapshot.model.project.globalInteractions.find(rule => rule.id === 'm13-spatial-navigation')?.name : null
    }).toBe('Spatial 页面共享规则已编辑')
    const edited = await read()
    expect(edited.undoDepth).toBe(5)
    const undo = page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true })
    const redo = page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true })
    for (let index = 0; index < 5; index += 1) await undo.click()
    await expect.poll(async () => (await read()).undoDepth).toBe(0)
    const undone = await read()
    if (undone.model.kind !== 'course-v9') throw new Error('Undo changed kind')
    expect(undone.model.project.surfaces).toEqual(observed.baseline.project.surfaces)
    expect(undone.model.project.globalInteractions).toEqual(observed.baseline.project.globalInteractions)
    for (let index = 0; index < 5; index += 1) await redo.click()
    await expect.poll(async () => (await read()).redoDepth).toBe(0)
    const redone = await read()
    if (redone.model.kind !== 'course-v9' || edited.model.kind !== 'course-v9') throw new Error('Redo changed kind')
    expect(redone.model.project.surfaces).toEqual(edited.model.project.surfaces)
    expect(redone.model.project.globalInteractions).toEqual(edited.model.project.globalInteractions)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await read()).dirty).toBe(false)
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 三表面保全.h5lesson', exact: true }).click()
    await tree.getByRole('button', { name: '三表面保全.h5lesson', exact: true }).dblclick()
    const reopenedId = await page.locator('.course-editor-frame:visible').getAttribute('data-document-id')
    if (!reopenedId || reopenedId === documentId) throw new Error('Course did not reopen in a new session')
    const reopened = await page.evaluate(id => window.desktopAPI!.documents!.read(id), reopenedId)
    expect(reopened.model).toMatchObject({ kind: 'course-v9' })
    if (reopened.model.kind !== 'course-v9') throw new Error('reopen kind')
    expect(reopened.model.project.surfaces).toEqual(edited.model.project.surfaces)
    expect(reopened.model.project.globalInteractions).toEqual(edited.model.project.globalInteractions)
    expect(reopened.model.resources.assets).toEqual(observed.baseline.resources.assets)
    expect(Object.keys(reopened.model.project.assets).sort()).toEqual(['diagram', 'photo'])
    const disk = new CourseV9Driver().load(new Uint8Array(readFileSync(coursePath)))
    expect(disk.resources).toEqual(reopened.model.resources)
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
