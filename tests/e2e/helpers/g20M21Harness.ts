import { crc32, deflateSync } from 'node:zlib'
import { expect, type Locator, type Page } from '@playwright/test'
import { createBlankCourseProject } from '../../../src/core/course/createCourseProject'
import { addCourseFlowPage, addCourseScene, addCourseSpatialPage, renameCourseLocation } from '../../../src/core/tools/courseLocations'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../../src/core/drivers/codecs/courseProjectArchive'
import { createVideoNode } from '../../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../../src/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '../../../src/shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../../src/shared/courseProjectTypes'
import { controllerFiles, flowCourse, runtimeLayerItem, solidPng, textBlock, type Rect } from './g20M19Harness'

/** Fixtures and helpers for the M21 light-editing acceptance specs. */
export const CANVAS = { width: 1280, height: 720 }
export const FRAMES = {
  title: { x: 40, y: 40, width: 360, height: 72 },
  note: { x: 40, y: 150, width: 360, height: 72 },
  photo: { x: 760, y: 60, width: 320, height: 180 },
  world: { x: 120, y: 120, width: 320, height: 90 },
} satisfies Record<string, Rect>
export const PHOTO = solidPng(320, 180, [37, 99, 235])

function imageItem(id: string, frame: Rect, assetId: string, order: number) {
  return {
    layerItemId: id, label: id, frame: { mode: 'absolute', ...frame }, order, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', kind: 'native',
    content: { nativeType: 'image', data: { assetId, preserveAspectRatio: true, fit: 'contain', crop: { left: 0, top: 0, right: 0, bottom: 0 },
      cropX: 0.5, cropY: 0.5, flipX: false, flipY: false, cornerRadius: 0, feather: { amount: 0, mode: 'rectangle' }, safeAreas: [] } },
  }
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error((result as unknown as { reason: string }).reason)
  return result as Extract<T, { ok: true }>
}

/**
 * Scene 导入 holds two texts, an image and a DOM Runtime that draws its own text; scene 练习 holds one text; a Flow
 * page and a Spatial page follow.
 */
export function lightCourse(title = 'M21 轻编辑'): Uint8Array {
  let project: CourseProjectDocument = createBlankCourseProject({ title, canvas: CANVAS })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  surface.scenes[0]!.layerItems = [
    textBlock('title', FRAMES.title, '课题', '#245b46', 1),
    textBlock('note', FRAMES.note, '要点', '#7c3aed', 2),
    imageItem('photo', FRAMES.photo, 'photo', 3),
    runtimeLayerItem(4),
  ] as never
  project.assets = { photo: { id: 'photo', filename: 'photo.png', mimeType: 'image/png', kind: 'image', path: 'assets/photo.png', byteLength: PHOTO.byteLength, width: 320, height: 180 } } as never
  project = must(renameCourseLocation(project, project.locations[0]!.id, '导入')).project
  const scene = must(addCourseScene(project, { surfaceId: surface.id, title: '练习' }))
  project = scene.project
  const practice = project.surfaces[0]
  if (practice?.type !== 'slide') throw new Error('slide surface')
  practice.scenes[1]!.layerItems = [textBlock('practice', FRAMES.title, '练习题', '#b45309', 1)] as never
  project = must(addCourseFlowPage(project, { title: '讲义' })).project
  project = must(addCourseSpatialPage(project, { title: '空间' })).project
  const spatial = project.surfaces.find(entry => entry.type === 'spatial-2d')
  if (spatial?.type !== 'spatial-2d') throw new Error('spatial surface')
  spatial.world.layerItems = [textBlock('world-note', FRAMES.world, '空间便签', '#0f766e', 1)] as never
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: { photo: PHOTO }, componentFiles: controllerFiles() })
}

/** A PNG whose left and right halves differ in colour, so a crop shows which part it kept. */
export function splitPng(width: number, height: number, left: readonly number[], right: readonly number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4)
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, (_, x) => [...(x < width / 2 ? left : right)]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

export const SPLIT = { left: [37, 99, 235], right: [234, 88, 12] } as const
/** Square, so in the 16:9 photo frame 适应 leaves bands at the sides and 填充 cuts off the top and bottom. */
export const SPLIT_PHOTO = splitPng(640, 640, SPLIT.left, SPLIT.right)
export const CLIP = { x: 120, y: 330, width: 320, height: 180 }
export const HINT = '提示：先想一想'

/**
 * M21-T07: one scene with a title, a photo whose halves are blue and orange, a video, and a hidden hint (`video` is
 * a 320×180, 2 s WebM); then an empty infinite canvas 空间.
 */
export function inPlaceCourse(video: Uint8Array): Uint8Array {
  let project: CourseProjectDocument = createBlankCourseProject({ title: 'M21 就地编辑', canvas: CANVAS })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  surface.scenes[0]!.layerItems = [
    textBlock('title', FRAMES.title, '课题', '#245b46', 1),
    imageItem('photo', FRAMES.photo, 'photo', 2),
    sceneNodeToCourseLayerItem(createVideoNode({ id: 'clip', name: '课堂视频', assetId: 'clip', ...CLIP }), 3),
    { ...textBlock('hint', FRAMES.note, HINT, '#b45309', 4), visible: false },
  ] as never
  project.assets = {
    photo: { id: 'photo', filename: 'photo.png', mimeType: 'image/png', kind: 'image', path: 'assets/photo.png', byteLength: SPLIT_PHOTO.byteLength, width: 640, height: 640 },
    clip: { id: 'clip', filename: 'motion.webm', mimeType: 'video/webm', kind: 'video', path: 'assets/clip.webm', byteLength: video.byteLength, width: 320, height: 180, duration: 2 },
  } as never
  project = must(addCourseSpatialPage(project, { title: '空间' })).project
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: { photo: SPLIT_PHOTO, clip: video }, componentFiles: controllerFiles() })
}

/** The M19 Flow course (paper overlay, image and table in the document) with a figure large enough to click. */
export function flowCourseWithFigure(): Uint8Array {
  const course = openCourseProjectArchive(flowCourse())
  const figure = solidPng(640, 320, [14, 116, 144])
  const meta = course.project.assets['flow-figure']
  if (!meta) throw new Error('flow figure asset')
  course.project.assets['flow-figure'] = { ...meta, byteLength: figure.byteLength, width: 640, height: 320 } as never
  return createCourseProjectArchive({ project: course.project, assetFiles: { ...course.assetFiles, 'flow-figure': figure }, componentFiles: course.componentFiles })
}

/** The page point of a course-canvas point on the stage shown at `stage`. */
export function onStage(stage: Rect, point: { x: number; y: number }) {
  const scale = stage.width / CANVAS.width
  return { x: stage.x + point.x * scale, y: stage.y + point.y * scale }
}

export const centre = (frame: Rect) => ({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 })

/** Opens the right-click menu at a page point and returns it. */
export async function contextMenuAt(page: Page, point: { x: number; y: number }, name: string | RegExp): Promise<Locator> {
  await page.mouse.click(point.x, point.y, { button: 'right' })
  const menu = page.getByRole('menu', { name })
  await expect(menu).toBeVisible()
  return menu
}

/** Each item of a command menu: its label and, when it cannot run, the reason it shows. */
export async function menuItems(menu: Locator): Promise<{ label: string; reason: string | null }[]> {
  return menu.locator('[role="menuitem"]').evaluateAll(items => items.map(item => ({
    label: item.getAttribute('aria-label') ?? '',
    reason: item.getAttribute('aria-disabled') === 'true' ? item.getAttribute('aria-description') : null,
  })))
}

/**
 * Waits until the stage's loading cover is gone. A background test window paints only on input, so the pointer is
 * nudged meanwhile; until then the cover takes every click.
 */
export async function canvasReady(page: Page) {
  let nudge = 0
  await expect.poll(async () => {
    nudge += 1
    await page.mouse.move(8 + (nudge % 2), 8)
    return page.locator('.canvas-stage-stack .runtime-preview-loading').count()
  }, { timeout: 60_000 }).toBe(0)
}

export async function closeMenu(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('.command-menu--context')).toHaveCount(0)
}
