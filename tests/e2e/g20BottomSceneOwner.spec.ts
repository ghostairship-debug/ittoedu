import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseFlowPage, addCourseScene, addCourseSpatialPage } from '../../src/core/tools/courseLocations'
import { syncFlowCourseLocations } from '../../src/core/tools/flowDocumentModel'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'

const root = resolve(__dirname, '../..')

function makeMixedCourse() {
  let project = createBlankCourseProject({ title: 'M03 底栏混合课件', includeDefaultController: false, controls: 'none' })
  const slide = project.surfaces[0]
  if (slide?.type !== 'slide') throw new Error('Expected the initial Slide page')
  const slideSurfaceId = slide.id
  for (let index = 2; index <= 8; index += 1) {
    const result = addCourseScene(project, { surfaceId: slideSurfaceId, title: `场景 ${index}` })
    if (!result.ok) throw new Error(result.reason)
    project = result.project
  }
  const flow = addCourseFlowPage(project, { title: 'Flow 讲义页' })
  if (!flow.ok) throw new Error(flow.reason)
  project = flow.project
  const spatial = addCourseSpatialPage(project, { title: 'Spatial 世界页' })
  if (!spatial.ok) throw new Error(spatial.reason)
  project = spatial.project

  const slideSurface = project.surfaces.find(surface => surface.id === slideSurfaceId)
  const flowSurface = project.surfaces.find(surface => surface.type === 'flow')
  const spatialSurface = project.surfaces.find(surface => surface.type === 'spatial-2d')
  if (slideSurface?.type !== 'slide' || flowSurface?.type !== 'flow' || spatialSurface?.type !== 'spatial-2d') {
    throw new Error('Expected all three authored surfaces in the mixed course')
  }
  const scenes = slideSurface.scenes.map((scene, index) => {
    if (!scene.presentation) throw new Error(`Scene ${index + 1} has no presentation`)
    const number = index + 1
    scene.presentation.states.push({ id: `m03-reveal-${number}`, name: `揭示 ${number}`, layerItemOverrides: {} })
    scene.presentation.states.push({ id: `m03-explain-${number}`, name: `解释 ${number}`, layerItemOverrides: {} })
    const location = project.locations.find(candidate => candidate.kind === 'slide-scene' && candidate.sceneId === scene.id && candidate.stateId === undefined)
    if (!location) throw new Error(`Scene ${number} has no location`)
    return { locationId: location.id, sceneId: scene.id, name: scene.name, stateName: `揭示 ${number}` }
  })
  const heading = flowSurface.blocks.find(block => block.type === 'heading')
  if (!heading) throw new Error('Flow page has no heading')
  heading.content = { inlines: [{ type: 'text', text: '课堂引入' }] }
  flowSurface.blocks.push({ id: 'm03-flow-section', type: 'section', title: { inlines: [{ type: 'text', text: '观察与解释' }] }, collapsedByDefault: false, blocks: [] })
  syncFlowCourseLocations(project, flowSurface.id)
  const flowHeading = project.locations.find(location => location.kind === 'flow-block' && location.surfaceId === flowSurface.id && location.blockId === heading.id)
  const flowSection = project.locations.find(location => location.kind === 'flow-block' && location.surfaceId === flowSurface.id && location.blockId === 'm03-flow-section')
  if (!flowHeading || !flowSection) throw new Error('Flow outline locations were not created')

  spatialSurface.camera.frames.push({ id: 'm03-close-camera', name: '近景', x: 320, y: 120, zoom: 1.4 })
  project.locations.push({ id: 'm03-close-camera-location', label: 'Spatial 世界页 · 近景', kind: 'spatial-camera', surfaceId: spatialSurface.id, cameraFrameId: 'm03-close-camera' })
  const spatialPrint = project.mixedPrintPlan?.entries.find(entry => entry.kind === 'spatial-frames' && entry.surfaceId === spatialSurface.id)
  if (spatialPrint?.kind === 'spatial-frames') spatialPrint.cameraFrameIds.push('m03-close-camera')
  const parsed = courseProjectDocumentSchema.parse(project)
  return {
    bytes: createCourseProjectArchive({ project: parsed, assetFiles: {}, componentFiles: {} }),
    scenes,
    flow: { surfaceId: flowSurface.id, headingId: flowHeading.id, sectionId: flowSection.id },
    spatial: { surfaceId: spatialSurface.id, closeCameraId: 'm03-close-camera-location' },
  }
}

async function readDocument(page: Page, documentId: string) {
  return page.evaluate(async id => {
    const snapshot = await window.desktopAPI!.documents!.read(id)
    return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth, dirty: snapshot.dirty }
  }, documentId)
}

test('M03-T06 bottom scene cards navigate owned states and mixed surfaces without a DocumentSession write', async ({}, info) => {
  test.setTimeout(120_000)
  const fixture = makeMixedCourse()
  const output = join(root, 'output/g20/m03-bottom-scene')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const filename = join(workspace, '底栏混合课件.h5lesson')
  writeFileSync(filename, fixture.bytes)
  let app: ElectronApplication | null = null
  let page: Page | null = null
  const screenshot = async (name: string) => {
    if (!page) throw new Error('Electron page not ready')
    const path = join(directory, name)
    await page.screenshot({ path, fullPage: true })
    await info.attach(name, { path, contentType: 'image/png' })
  }
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1500, 900))
    page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '底栏混合课件.h5lesson', exact: true }).dblclick()

    const frame = page.locator('.course-editor-frame:visible')
    await expect(frame).toHaveAttribute('data-editor-mode', 'light')
    const toolbarRow = frame.locator('.course-light-tools__row')
    const insertBox = await toolbarRow.getByRole('button', { name: '插入', exact: true }).boundingBox()
    const deepBox = await toolbarRow.getByRole('button', { name: '深度编辑', exact: true }).boundingBox()
    if (!insertBox || !deepBox) throw new Error('Course toolbar controls unavailable')
    expect(Math.abs(insertBox.y - deepBox.y)).toBeLessThanOrEqual(2)
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('Course editor did not bind a DocumentSession')
    const before = await readDocument(page, documentId)
    const nav = frame.getByRole('navigation', { name: '课件场景与页面导航' })
    const track = nav.locator('.bottom-scene-nav__track')
    await expect(nav).toBeVisible()
    await expect(nav.locator('.bottom-scene-card')).toHaveCount(10)
    await expect(page.getByTestId('canvas-stage').first()).toBeVisible()
    const geometry = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('.bottom-scene-nav')!
      const canvas = document.querySelector<HTMLElement>('[data-testid="canvas-stage"]')!
      const center = document.querySelector<HTMLElement>('.editor-center')!
      const railRect = rail.getBoundingClientRect(), canvasRect = canvas.getBoundingClientRect(), centerRect = center.getBoundingClientRect()
      return { rail: railRect.toJSON(), canvas: canvasRect.toJSON(), center: centerRect.toJSON(), scrollWidth: rail.querySelector('ol')!.scrollWidth, clientWidth: rail.querySelector('ol')!.clientWidth }
    })
    expect(geometry.rail.height).toBeLessThanOrEqual(128)
    expect(geometry.rail.bottom).toBeLessThanOrEqual(geometry.center.bottom + 1)
    expect(geometry.canvas.width).toBeGreaterThan(400)
    expect(geometry.canvas.height).toBeGreaterThan(250)
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth)

    const first = nav.getByTestId(`bottom-scene-${fixture.scenes[0]!.locationId}`)
    const second = nav.getByTestId(`bottom-scene-${fixture.scenes[1]!.locationId}`)
    const last = nav.getByTestId(`bottom-scene-${fixture.scenes[7]!.locationId}`)
    await expect(first.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    for (const scene of fixture.scenes) {
      const card = nav.getByTestId(`bottom-scene-${scene.locationId}`)
      await expect(card.getByRole('group', { name: `${scene.name}的呈现状态` })).toBeVisible()
      const state = card.getByRole('button', { name: scene.stateName, exact: true })
      await expect(state).toHaveCount(1)
      const buttonBox = await state.boundingBox(), cardBox = await card.boundingBox(), navBox = await nav.boundingBox()
      if (!buttonBox || !cardBox || !navBox) throw new Error('Bottom state geometry unavailable')
      expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height - 2)
      expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(navBox.y + navBox.height - 2)
    }
    await screenshot('01-initial-bottom-rail.png')

    // The target state is clicked inside its own card while another scene is current.
    await second.getByRole('button', { name: fixture.scenes[1]!.stateName, exact: true }).click()
    await expect(second.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    await expect(second.getByRole('button', { name: fixture.scenes[1]!.stateName, exact: true })).toHaveAttribute('aria-pressed', 'true')
    const pressedColors = await second.getByRole('button', { name: fixture.scenes[1]!.stateName, exact: true })
      .evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))
    expect(pressedColors.background).toBe('rgb(36, 91, 70)')
    expect(pressedColors.color).toBe('rgb(255, 255, 255)')
    await expect(first.locator('.bottom-scene-card__main')).not.toHaveAttribute('aria-current', 'page')
    await expect(first.getByRole('button', { name: fixture.scenes[0]!.stateName, exact: true })).toHaveAttribute('aria-pressed', 'false')
    await screenshot('02-cross-scene-owned-state.png')

    await track.hover()
    await page.mouse.wheel(850, 0)
    await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    await last.locator('.bottom-scene-card__main').click()
    await expect(last.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    const visibility = await last.evaluate(node => {
      const viewport = node.parentElement!.getBoundingClientRect(), card = node.getBoundingClientRect()
      return { left: card.left - viewport.left, right: viewport.right - card.right }
    })
    expect(visibility.left).toBeGreaterThanOrEqual(-2)
    expect(visibility.right).toBeGreaterThanOrEqual(-2)
    await screenshot('03-horizontal-scroll-current-visible.png')

    const flow = nav.getByTestId(`bottom-page-${fixture.flow.surfaceId}`)
    const spatial = nav.getByTestId(`bottom-page-${fixture.spatial.surfaceId}`)
    await expect(flow.locator('.bottom-scene-card__states')).toHaveCount(0)
    await expect(spatial.locator('.bottom-scene-card__states')).toHaveCount(0)
    await expect(flow.getByRole('group', { name: 'Flow 讲义页的标题与章节' })).toBeVisible()
    await flow.locator('.bottom-scene-card__main').click()
    await expect(flow.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('flow-workspace-shell')).toBeVisible()
    await flow.getByRole('button', { name: '标题 · 课堂引入', exact: true }).click()
    await expect(flow.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    await expect(flow.locator(`[data-kind="flow-heading"][aria-current="location"]`)).toHaveCount(1)
    await expect(page.getByTestId('flow-workspace-shell')).toBeVisible()
    await flow.getByRole('button', { name: '章节 · 观察与解释', exact: true }).click()
    await expect(flow.locator(`[data-kind="flow-section"][aria-current="location"]`)).toHaveCount(1)
    await screenshot('04-flow-outline.png')

    await spatial.locator('.bottom-scene-card__main').click()
    await expect(spatial.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('spatial-workspace')).toBeVisible()
    const closeCamera = spatial.getByRole('button', { name: '镜头 · 近景', exact: true })
    await closeCamera.click()
    await expect(closeCamera).toHaveAttribute('aria-current', 'location')
    await spatial.getByRole('button', { name: '世界', exact: true }).click()
    await expect(spatial.getByRole('button', { name: '世界', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await closeCamera.click()
    await expect(closeCamera).toHaveAttribute('aria-current', 'location')
    await screenshot('05-spatial-world-camera.png')

    await first.locator('.bottom-scene-card__main').click()
    await expect(first.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('canvas-stage').first()).toBeVisible()
    await screenshot('06-return-to-slide.png')
    expect(await readDocument(page, documentId)).toEqual(before)
  } catch (error) {
    if (page) await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    throw error
  } finally {
    if (app) {
      await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
  }
})
