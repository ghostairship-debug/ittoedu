import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBlankCourseProject } from '../../../src/core/course/createCourseProject'
import { addCourseFlowPage, addCourseScene } from '../../../src/core/tools/courseLocations'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../../src/core/drivers/codecs/courseProjectArchive'
import { BACKGROUND_E2E_ENV } from '../../../src/main/windowVisibility'
import { courseProjectDocumentSchema } from '../../../src/shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../../src/shared/courseProjectTypes'
import type { DocumentSnapshot } from '../../../src/shared/workbench/document'
import { root, solidPng, textBlock } from './g20M19Harness'
import { canvasReady, centre } from './g20M21Harness'

export const COURSE = 'M22 工作台验收.h5lesson'
export const CANVAS = { width: 960, height: 540 }
export const FIRST = { x: 70, y: 64, width: 360, height: 108 }
export const SECOND = { x: 70, y: 250, width: 360, height: 90 }
export const PICTURE = { x: 570, y: 80, width: 260, height: 150 }
const pictureBytes = solidPng(260, 150, [37, 99, 235])

/** One second of audible, valid PCM. Every spec gets a new copy in its own run directory. */
export function wave(): Uint8Array {
  const sampleRate = 16000, samples = sampleRate, bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => [...value].forEach((character, index) => { bytes[offset + index] = character.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 11000), true)
  return bytes
}

export function courseFixture(withProperties = false) {
  let project: CourseProjectDocument = createBlankCourseProject({ title: 'M22 两行字与重名页', canvas: CANVAS, includeDefaultController: false, controls: 'none' })
  const slide = project.surfaces[0]
  if (slide?.type !== 'slide') throw new Error('Expected Slide')
  slide.scenes[0]!.name = '同名页'
  slide.scenes[0]!.layerItems = [textBlock('m22-title', FIRST, '第一行\n第二行', '#245b46', 1), textBlock('m22-target', SECOND, '点击跳页', '#7c3aed', 2)] as never
  if (withProperties) {
    slide.scenes[0]!.layerItems.push({ layerItemId: 'm22-picture', label: '图片', frame: { mode: 'absolute', ...PICTURE }, order: 3,
      visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', kind: 'native',
      content: { nativeType: 'image', data: { assetId: 'm22-picture-asset', preserveAspectRatio: true, fit: 'contain',
        crop: { left: 0, top: 0, right: 0, bottom: 0 }, cropX: 0.5, cropY: 0.5, flipX: false, flipY: false,
        cornerRadius: 0, feather: { amount: 0, mode: 'rectangle' }, safeAreas: [] } } } as never)
    project.assets['m22-picture-asset'] = { id: 'm22-picture-asset', filename: 'picture.png', mimeType: 'image/png', kind: 'image',
      path: 'assets/picture.png', byteLength: pictureBytes.length, width: 260, height: 150 } as never
  }
  const second = addCourseScene(project, { surfaceId: slide.id, title: '同名页' })
  if (!second.ok) throw new Error(second.reason)
  project = second.project
  const targetSlide = project.surfaces[0]
  if (targetSlide.type !== 'slide') throw new Error('Expected target Slide')
  targetSlide.scenes[1]!.layerItems = [textBlock('m22-arrived', FIRST, '目标页已到达', '#b45309', 1)] as never
  if (withProperties) {
    const blank = addCourseScene(project, { surfaceId: slide.id, title: '空白页' })
    if (!blank.ok) throw new Error(blank.reason)
    project = blank.project
  }
  const flow = addCourseFlowPage(project, { title: 'Flow 目标页' })
  if (!flow.ok) throw new Error(flow.reason)
  project = flow.project
  const slideLocations = project.locations.filter(location => location.kind === 'slide-scene' && location.stateId === undefined)
  const flowLocation = project.locations.find(location => location.kind === 'flow-block')
  if (slideLocations.length < 2 || !flowLocation) throw new Error('Expected distinct Slide and Flow locations')
  slideLocations[0]!.label = '同名页'
  slideLocations[1]!.label = '同名页'
  return { bytes: createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: withProperties ? { 'm22-picture-asset': pictureBytes } : {}, componentFiles: {} }),
    firstLocationId: slideLocations[0]!.id, secondLocationId: slideLocations[1]!.id, flowLocationId: flowLocation.id }
}

export function project(snapshot: DocumentSnapshot): CourseProjectDocument {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected Course V9')
  return snapshot.model.project
}
export function firstScene(snapshot: DocumentSnapshot) {
  const slide = project(snapshot).surfaces.find(surface => surface.type === 'slide')
  if (slide?.type !== 'slide') throw new Error('Expected Slide')
  return slide.scenes[0]!
}
export function item(snapshot: DocumentSnapshot, id: string) {
  const found = firstScene(snapshot).layerItems.find(value => value.layerItemId === id)
  if (!found) throw new Error(`Missing layer ${id}`)
  return found
}

export async function launchM22(subdir: string) {
  const base = join(root, 'output/g20/m22', subdir); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fixture = courseFixture(subdir === 'properties'), courseFile = join(workspace, COURSE), audioFile = join(directory, '点击提示.wav')
  writeFileSync(courseFile, fixture.bytes); writeFileSync(audioFile, wave())
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(String(error)))
  await app.evaluate(({ BrowserWindow, dialog }, folder) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: COURSE, exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible')
  await expect(frame).toHaveAttribute('data-editor-mode', 'light')
  await canvasReady(page)
  const documentId = await frame.getAttribute('data-document-id')
  if (!documentId) throw new Error('No DocumentSession')
  const read = () => page.evaluate(id => window.desktopAPI!.documents!.read(id), documentId)
  return { app, page, directory, workspace, courseFile, audioFile, fixture, frame, documentId, read, pageErrors }
}

export async function selectItem(page: Page, id: string) {
  const element = page.locator(`[data-slide-layer-item="${id}"]:visible`).first()
  await expect(element).toBeVisible()
  const box = await element.boundingBox()
  if (!box) throw new Error(`No painted bounds for ${id}`)
  await page.mouse.click(centre(box).x, centre(box).y)
  await expect(page.locator('[data-selection-quick-bar]').filter({ visible: true })).toHaveCount(1)
}

export async function menuCommand(page: Page, name: string | RegExp) {
  const bar = page.locator('[data-selection-quick-bar]').filter({ visible: true })
  await bar.getByRole('button', { name: '更多操作', exact: true }).click()
  const command = page.getByRole('menuitem', { name, exact: typeof name === 'string' }).filter({ visible: true })
  await expect(command).toHaveCount(1)
  await command.click()
}

export async function retainM22Evidence(h: Awaited<ReturnType<typeof launchM22>>, label: string) {
  const shots = join(h.directory, 'shots'); mkdirSync(shots, { recursive: true })
  const evidence: Record<string, unknown> = { label, directory: h.directory, courseFile: h.courseFile,
    audioFile: h.audioFile, errors: h.pageErrors }
  try { await h.page.screenshot({ path: join(shots, `${label}.png`), timeout: 10_000 }) }
  catch (error) { evidence.screenshotError = String(error) }
  try { evidence.dom = (await h.page.locator('body').innerText()).slice(0, 20_000) }
  catch (error) { evidence.domError = String(error) }
  try {
    const snapshot = await h.read(); evidence.document = { revision: snapshot.revision, dirty: snapshot.dirty,
      undoDepth: snapshot.undoDepth, firstScene: firstScene(snapshot), assets: project(snapshot).assets,
      media: project(snapshot).media }
  } catch (error) { evidence.documentError = String(error) }
  writeFileSync(join(h.directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
}

export async function closeM22(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

export function savedProject(path: string) { return openCourseProjectArchive(new Uint8Array(readFileSync(path))).project }
