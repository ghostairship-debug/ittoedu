import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { createBlankCourseProject } from '../../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../../src/core/drivers/codecs/courseProjectArchive'
import { createDefaultTeacherControllerPackage } from '../../../src/shared/defaultTeacherControllerComponent'
import { componentPackagesToArchiveFiles } from '../../../src/renderer/components/componentPackageStore'
import { courseProjectDocumentSchema } from '../../../src/shared/courseProjectSchema'

/** Fixtures and measurements shared by the M19 page-frame acceptance specs. */
export const root = resolve(__dirname, '../../..')
export const OFF_PAGE = [225, 29, 72] as const
/** A solid RGB PNG, written with Node's own zlib so the test needs no image dependency. */
export function solidPng(width: number, height: number, rgb: readonly number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4)
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [...rgb]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

export type Rect = { x: number; y: number; width: number; height: number }

export function textBlock(id: string, frame: Rect, text: string, color: string, order: number) {
  return {
    layerItemId: id, label: id, frame: { mode: 'absolute', ...frame }, order, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', kind: 'native',
    content: { nativeType: 'text', data: { text, runs: [], style: {
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif', fontSize: 28, color: '#ffffff', bold: true, italic: false, underline: false,
      strike: false, emphasis: false, highlightColor: null, align: 'center', verticalAlign: 'middle', writingMode: 'horizontal', lineSpacing: 1.3,
      letterSpacing: 0, padding: 4, overflow: 'fixed', backgroundColor: color, backgroundOpacity: 1, cornerRadius: 0,
    } } },
  }
}

export function controllerFiles() {
  const pkg = createDefaultTeacherControllerPackage()
  return componentPackagesToArchiveFiles({ [pkg.manifest.id]: pkg })
}

/** A Slide course on `canvas` with one block that runs past the page edge (and, optionally, its controller placed elsewhere). */
export function slideCourse(title: string, canvas: { width: number; height: number }, offPage: Rect, controllerFrame?: Rect): Uint8Array {
  const project = createBlankCourseProject({ title, canvas })
  const controller = project.globalLayerItems.find(entry => entry.item.kind === 'component')!.item
  if (controllerFrame) controller.frame = { mode: 'absolute', ...controllerFrame }
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  surface.scenes[0]!.layerItems = [
    textBlock('title', { x: 40, y: 40, width: 360, height: 72 }, title, '#245b46', 1),
    textBlock('off-page', offPage, '页外', '#e11d48', 2),
  ] as never
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: {}, componentFiles: controllerFiles() })
}

/** A course that opens on a Spatial page; its Slide page carries the course canvas the camera follows. */
export function spatialCourse(canvas: { width: number; height: number }): Uint8Array {
  const base = createBlankCourseProject({ title: 'M19 spatial', canvas })
  const project = courseProjectDocumentSchema.parse({
    ...base,
    locations: [...base.locations, { id: 'm19-spatial-home', label: '空间', kind: 'spatial-camera', surfaceId: 'm19-spatial', cameraFrameId: 'm19-spatial-home' }],
    startLocationId: 'm19-spatial-home',
    surfaces: [...base.surfaces, { id: 'm19-spatial', type: 'spatial-2d', title: '空间', backgroundColor: '#ffffff', surfaceLayerItems: [],
      world: { bounds: { mode: 'infinite' }, layerItems: [textBlock('world-note', { x: 40, y: 40, width: 280, height: 80 }, '空间', '#245b46', 1)], paths: [], relations: [] },
      camera: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'm19-spatial-home', name: '全景', x: 0, y: 0, zoom: 1 }] }, semanticZoom: [] }],
    mixedPrintPlan: { pageSize: 'surface-native', orientation: 'auto', entries: [
      { id: 'print-slide', kind: 'slide-scenes', surfaceId: base.surfaces[0]!.id, sceneIds: base.surfaces[0]!.type === 'slide' ? base.surfaces[0]!.scenes.map(scene => scene.id) : [] },
      { id: 'print-spatial', kind: 'spatial-frames', surfaceId: 'm19-spatial', cameraFrameIds: ['m19-spatial-home'] },
    ] },
  })
  return createCourseProjectArchive({ project, assetFiles: {}, componentFiles: controllerFiles() })
}

export const FLOW_CONTROLLER_ID = 'm19-flow-controller'

/** The architecture Flow-heavy course (formula, divider, component, screen overlay) with the teacher controller added. */
export function flowCourse(): Uint8Array {
  const source = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/architecture-baseline/flow-heavy.h5lesson'))))
  const blank = createBlankCourseProject()
  const controller = structuredClone(blank.globalLayerItems.find(entry => entry.item.kind === 'component')!)
  const project = structuredClone(source.project)
  controller.item.order = Math.max(0, ...project.globalLayerItems.map(entry => entry.item.order)) + 10
  controller.item.layerItemId = FLOW_CONTROLLER_ID
  controller.item.label = FLOW_CONTROLLER_ID
  project.globalLayerItems.push(controller)
  project.componentPackages = { ...project.componentPackages, ...blank.componentPackages }
  project.playback = { ...project.playback, controls: 'canvas' }
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: source.assetFiles,
    componentFiles: { ...source.componentFiles, ...controllerFiles() } })
}

export async function rectOf(page: Page, selector: string): Promise<Rect> {
  const locator = page.locator(selector).filter({ visible: true }).first()
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error(`No box for ${selector}`)
  return box
}

/** A box once it has stopped moving (components lay themselves out after they mount). */
export async function settledRect(page: Page, selector: string, nudge?: { x: number; y: number }): Promise<Rect> {
  let last: Rect | undefined, turn = 0
  await expect.poll(async () => {
    // A background test window paints only on input; a small pointer move lets pending layout land.
    if (nudge) await page.mouse.move(nudge.x + (turn++ % 2), nudge.y)
    const next = await rectOf(page, selector)
    const same = last !== undefined && (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(next[key] - last![key]) < 0.5)
    last = next
    return same
  }, { intervals: [200, 200, 300, 500, 800] }).toBe(true)
  return last!
}

/** One screen pixel, decoded by the editor page's own image decoder (no extra test dependency). */
export async function pixelAt(decoder: Page, source: Page, x: number, y: number): Promise<number[]> {
  const png = await source.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } })
  return decoder.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }, png.toString('base64'))
}
export const isOffPageColour = (rgb: readonly number[]) => rgb.every((value, index) => Math.abs(value - OFF_PAGE[index]!) < 24)

export function expectSameRect(actual: Rect, expected: Rect, tolerance = 1.5) {
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[key] - expected[key]), `${key}: ${actual[key]} vs ${expected[key]}`).toBeLessThanOrEqual(tolerance)
}

/** Where a canvas page sits in `frame` after the shared fit rule: landscape whole and centred, portrait width-filling and top first. */
export function expectFit(pageRect: Rect, frame: Rect, canvas: { width: number; height: number }, insets: { top: number; right: number; bottom: number; left: number }) {
  const width = frame.width - insets.left - insets.right, height = frame.height - insets.top - insets.bottom
  expect(Math.abs(pageRect.width / pageRect.height - canvas.width / canvas.height)).toBeLessThan(0.01)
  if (canvas.height > canvas.width) {
    expect(Math.abs(pageRect.width - width)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(pageRect.x - (frame.x + insets.left))).toBeLessThanOrEqual(1.5)
    if (pageRect.height > height) expect(Math.abs(pageRect.y - (frame.y + insets.top))).toBeLessThanOrEqual(1.5)
  } else {
    const scale = Math.min(width / canvas.width, height / canvas.height)
    expect(Math.abs(pageRect.width - canvas.width * scale)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(pageRect.x - (frame.x + insets.left + (width - pageRect.width) / 2))).toBeLessThanOrEqual(1.5)
    expect(Math.abs(pageRect.y - (frame.y + insets.top + (height - pageRect.height) / 2))).toBeLessThanOrEqual(1.5)
  }
}

export async function openInWorkbench(page: Page, name: string) {
  const back = page.getByRole('button', { name: '返回工作台', exact: true })
  if (await back.isVisible()) await back.click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name, exact: true }).dblclick()
  await expect(page.getByRole('tab', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.canvas-stage-stack, .flow-workspace').filter({ visible: true }).first()).toBeVisible()
}

