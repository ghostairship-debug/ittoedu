import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseScene } from '../../src/core/tools/courseLocations'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const root = resolve(__dirname, '../..')

function project(snapshot: DocumentSnapshot): CourseProjectDocument {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected a V9 course session')
  return snapshot.model.project
}

async function read(page: Page, documentId: string) {
  return page.evaluate(id => window.desktopAPI!.documents!.read(id), documentId)
}

async function openCourse(app: ElectronApplication, page: Page, workspace: string, name: string) {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  const tree = page.getByRole('tree', { name: '工作空间文件' })
  await tree.getByRole('button', { name, exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible')
  await expect(frame).toHaveAttribute('data-editor-mode', 'light')
  const documentId = await frame.getAttribute('data-document-id')
  if (!documentId) throw new Error('Course view did not bind a DocumentSession')
  return { tree, frame, documentId }
}

function advancedCourse(): Uint8Array {
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/component.h5lesson'))))
  const project = structuredClone(archive.project)
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('Expected the existing V9 Component scene')
  const scene = surface.scenes[0]!
  const nativeArchive = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'))))
  const nativeSurface = nativeArchive.project.surfaces[0]
  if (nativeSurface?.type !== 'slide') throw new Error('Expected the existing interaction sample')
  const rule = structuredClone(nativeSurface.scenes[0]!.interactions[0]!)
  rule.id = 'm03-existing-rule'
  rule.name = '已有入场交互'
  rule.trigger = { type: 'scene.enter' }
  for (const step of rule.actions) {
    if (step.action.type === 'node.enter') step.action.nodeId = 'slide-title'
  }
  scene.interactions.push(rule)
  const globalTitle = sceneNodeToCourseLayerItem(createTextNode({
    id: 'm03-global-title', text: '已有全局标题', x: 60, y: 30, width: 440, height: 70,
  }))
  project.globalLayerItems.push({ item: globalTitle, plane: 'overlay', visibility: { mode: 'all', locationIds: [] } })
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project),
    assetFiles: archive.assetFiles, componentFiles: archive.componentFiles })
}

function runCourse(): { bytes: Uint8Array; firstLocationId: string; secondLocationId: string } {
  let project = createBlankCourseProject({ title: 'M03 编辑与试运行', includeDefaultController: false, controls: 'none' })
  const firstSurface = project.surfaces[0]
  if (firstSurface?.type !== 'slide') throw new Error('Expected a Slide project')
  const firstSceneId = firstSurface.scenes[0]!.id
  const firstLocationId = project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === firstSceneId)?.id
  if (!firstLocationId) throw new Error('Missing first scene location')
  const added = addCourseScene(project, { surfaceId: firstSurface.id, title: '点击后到达的场景' })
  if (!added.ok) throw new Error(added.reason)
  project = added.project
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('Expected a Slide surface after adding a scene')
  const first = surface.scenes.find(value => value.id === firstSceneId)!
  const second = surface.scenes.find(value => value.id !== firstSceneId)!
  first.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({
    id: 'm03-click-button', text: '点击进入下一场景', x: 340, y: 250, width: 550, height: 120,
  })))
  second.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({
    id: 'm03-destination', text: '试运行已进入目标场景', x: 290, y: 240, width: 650, height: 120,
  })))
  first.interactions.push({
    id: 'm03-click-navigation', enabled: true,
    trigger: { type: 'node.click', nodeId: 'm03-click-button' }, conditions: [],
    actions: [{ id: 'm03-go', start: 'after-previous', delayMs: 0,
      action: { type: 'scene.go', sceneId: second.id } }],
  })
  return { bytes: createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project),
    assetFiles: {}, componentFiles: {} }), firstLocationId, secondLocationId: added.activatedLocationId }
}

test('M03-T04 existing Component, interaction and global layer remain editable in deep mode and reopen', async () => {
  test.skip(process.platform !== 'win32', 'M03-T04 checks the Windows Electron workbench.')
  test.setTimeout(150_000)
  const output = join(root, 'output/g20/m03/advanced-and-run'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'advanced-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const name = '高级能力课件.h5lesson', filename = join(workspace, name)
  writeFileSync(filename, advancedCourse())
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const pageErrors: string[] = []
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => pageErrors.push(error.message))
    const { tree, frame, documentId } = await openCourse(app, page, workspace, name)
    const initial = await read(page, documentId)
    const initialProject = project(initial)
    const initialScene = initialProject.surfaces[0]
    if (initialScene?.type !== 'slide') throw new Error('Missing Slide scene')
    expect(initialScene.scenes[0]!.interactions).toHaveLength(1)
    expect(initialScene.scenes[0]!.interactions[0]!.trigger).toEqual({ type: 'scene.enter' })
    expect(initialProject.globalLayerItems.some(value => value.item.layerItemId === 'm03-global-title')).toBe(true)
    await frame.getByRole('button', { name: '深度编辑', exact: true }).click()
    await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
    const rail = page.locator('.right-sidebar:visible')
    await rail.getByRole('tab', { name: '图层', exact: true }).click()
    await page.getByTestId('node-item-slide-quiz').locator('.node-name').click()
    await expect(rail.getByRole('tab', { name: '属性', exact: true })).toHaveAttribute('aria-expanded', 'true')
    const prompt = page.getByTestId('component-properties-editor').getByLabel('题干', { exact: true })
    await expect(prompt).toHaveValue('这是幻灯片题')
    await prompt.fill('深度模式修改的题干')
    await prompt.blur()
    await expect.poll(async () => {
      const slide = project(await read(page, documentId)).surfaces[0]
      return slide?.type === 'slide' ? slide.scenes[0]!.layerItems.find(value => value.layerItemId === 'slide-quiz') : null
    }).toMatchObject({ props: { prompt: '深度模式修改的题干' } })

    await page.getByTestId('global-layer-entry').click()
    await rail.getByRole('tab', { name: '图层', exact: true }).click()
    await page.getByTestId('node-item-m03-global-title').locator('.node-name').click()
    await expect(rail.getByRole('tab', { name: '属性', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await page.getByLabel('图层位置', { exact: true }).selectOption('underlay')
    await expect.poll(async () => project(await read(page, documentId)).globalLayerItems
      .find(value => value.item.layerItemId === 'm03-global-title')?.plane).toBe('underlay')

    await page.getByTestId('scene-item-location-scene-1').click()
    await rail.getByRole('tab', { name: '互动与动画', exact: true }).click()
    await expect(page.getByRole('group', { name: '规则 1' })).toBeVisible()
    await page.getByRole('button', { name: '复制规则 1', exact: true }).click()
    await expect(page.getByRole('group', { name: '规则 2' })).toBeVisible()
    await expect.poll(async () => {
      const slide = project(await read(page, documentId)).surfaces[0]
      return slide?.type === 'slide' ? slide.scenes[0]!.interactions.length : 0
    }).toBe(2)

    const changed = await read(page, documentId)
    expect(changed.undoDepth).toBeGreaterThan(initial.undoDepth)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await read(page, documentId)).dirty).toBe(false)
    const saved = await read(page, documentId)
    expect(openCourseProjectArchive(new Uint8Array(readFileSync(filename))).project).toEqual(project(saved))
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await page.locator('.workspace-document-tabs').getByRole('button', { name: `关闭 ${name}`, exact: true }).click()
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const reopenedId = await frame.getAttribute('data-document-id')
    if (!reopenedId || reopenedId === documentId) throw new Error('Course did not reopen as a new DocumentSession')
    const reopened = await read(page, reopenedId)
    expect(reopened.dirty).toBe(false)
    expect(project(reopened)).toEqual(project(saved))
    expect(pageErrors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ documentId, reopenedId,
      initialRevision: initial.revision, savedRevision: saved.revision, componentPrompt: '深度模式修改的题干',
      interactionCount: 2, globalPlane: 'underlay', pageErrors }, null, 2))
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})

test('M03-T05 selecting an authored button does not run it, while try-run navigates without a document write', async () => {
  test.skip(process.platform !== 'win32', 'M03-T05 checks the Windows Electron workbench.')
  test.setTimeout(90_000)
  const output = join(root, 'output/g20/m03/advanced-and-run'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'try-run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const name = '编辑运行分离.h5lesson', filename = join(workspace, name)
  const fixture = runCourse()
  writeFileSync(filename, fixture.bytes)
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const pageErrors: string[] = []
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => pageErrors.push(error.message))
    const { frame, documentId } = await openCourse(app, page, workspace, name)
    const before = await read(page, documentId)
    const authoring = page.getByTestId('published-authoring-host').locator('.slide-published-adapter')
    await expect(authoring).toHaveAttribute('data-location-id', fixture.firstLocationId)
    const painted = page.locator('[data-slide-layer-item="m03-click-button"]:visible').first()
    await expect(painted).toBeVisible()
    const box = await painted.boundingBox()
    if (!box) throw new Error('Authored button has no painted hit target')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('toolbar', { name: '选中对象快捷工具' })).toBeVisible()
    await expect(authoring).toHaveAttribute('data-location-id', fixture.firstLocationId)
    const afterSelection = await read(page, documentId)
    expect(afterSelection).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, dirty: false })
    expect(project(afterSelection)).toEqual(project(before))

    const mode = frame.getByRole('group', { name: '画布模式' })
    await mode.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const player = page.getByTestId('course-try-run-host')
    await expect(player).toHaveAttribute('data-course-player-ready', 'true')
    const playerButton = player.locator('[data-slide-layer-item="m03-click-button"]')
    await expect(playerButton).toBeVisible()
    await playerButton.click()
    await expect(player.locator('.slide-published-adapter')).toHaveAttribute('data-location-id', fixture.secondLocationId)
    await expect(player.locator('[data-slide-layer-item="m03-destination"]')).toBeVisible()
    const afterRun = await read(page, documentId)
    expect(afterRun).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, dirty: false })
    expect(project(afterRun)).toEqual(project(before))
    await mode.getByRole('button', { name: '编辑状态', exact: true }).click()
    await expect(authoring).toHaveAttribute('data-location-id', fixture.firstLocationId)
    await expect(frame.getByTestId(`bottom-scene-${fixture.firstLocationId}`).locator('.bottom-scene-card__main'))
      .toHaveAttribute('aria-current', 'page')
    expect(pageErrors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ documentId,
      firstLocationId: fixture.firstLocationId, runDestination: fixture.secondLocationId,
      revisionBefore: before.revision, revisionAfterRun: afterRun.revision,
      undoDepthBefore: before.undoDepth, undoDepthAfterRun: afterRun.undoDepth, pageErrors }, null, 2))
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
