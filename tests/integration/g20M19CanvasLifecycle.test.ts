// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { resizeCourseSlideCanvas } from '../../src/core/course/resizeSlideCanvas'
import { createImageAssetMetadata } from '../../src/core/tools/imageAssetMetadata'
import { planSlideImageInsertion, planSlideTextInsertion } from '../../src/core/tools/slideInsertion'
import { courseSlideCanvas } from '../../src/shared/slideCanvas'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { solidPng } from '../helpers/solidPng'

const repo = path.resolve(__dirname, '../..')
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe M19 fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v9') throw new Error(`expected a course, got ${snapshot.model.kind}`)
  return snapshot.model
}

function frameOf(project: CourseProjectDocument, id: string) {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find(candidate => candidate.layerItemId === id)
      if (item?.frame.mode === 'absolute') return item.frame
    }
  }
  throw new Error(`missing ${id}`)
}

async function replace(host: DocumentHostService, current: DocumentSnapshot, operationId: string, project: CourseProjectDocument, assets?: Record<string, Uint8Array>) {
  const model = course(current)
  const result = await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId, actor: 'human',
    mutation: { type: 'command', command: { type: 'course.replace', project: { ...project, revision: model.project.revision, updatedAt: model.project.updatedAt },
      ...(assets ? { resources: { ...model.resources, assets: { ...model.resources.assets, ...assets } } } : {}) } } })
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'applied' })
  return host.internalAPI.read(current.documentId)
}

it('M19-T01 keeps an old 1280×720 course as it is and carries a chosen canvas through create, save, reopen and resize', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m19-canvas-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const tree = new WorkspaceFilesDesktopService(host.files)
  const registered = await tree.authorizeRoot(workspace)

  // An existing course made before custom canvases opens as it was: no migration, still 1280×720.
  const legacyBytes = new Uint8Array(await fs.readFile(path.join(repo, 'tests/fixtures/architecture-baseline/slide-heavy.h5lesson')))
  const legacyPath = path.join(workspace, 'legacy.h5lesson')
  await fs.writeFile(legacyPath, legacyBytes)
  const legacy = await host.open(legacyPath)
  expect(legacy.dirty).toBe(false)
  expect(course(legacy).project).toEqual(openCourseProjectArchive(legacyBytes).project)
  expect(courseSlideCanvas(course(legacy).project)).toEqual({ width: 1280, height: 720 })

  // A new 4:3 course from the explorer's create request.
  const created = await tree.operate({ type: 'create-course', workspaceId: registered.workspaceId, operationId: 'm19-create-4-3',
    targetDirectoryId: registered.rootEntryId, name: '标准.h5lesson', canvas: { width: 1024, height: 768 } })
  expect(created).toMatchObject({ status: 'success' })
  const coursePath = path.join(workspace, '标准.h5lesson')
  let current = await host.open(coursePath)
  const canvas = { width: 1024, height: 768 }
  expect(courseSlideCanvas(course(current).project)).toEqual(canvas)

  // Text and an image are placed on the course canvas: both centred on it, the image at its default size.
  const location = course(current).project.locations.find(candidate => candidate.kind === 'slide-scene')!
  const owner = { scope: 'scene' as const, selection: { locationId: location.id, stateId: null } }
  const png = new Uint8Array(solidPng(400, 300, [37, 99, 235]))
  const image = createImageAssetMetadata({ name: 'sample.png', mimeType: 'image/png', bytes: png }, { id: 'm19-image', dimensions: { width: 400, height: 300 } })
  let project: CourseProjectDocument = { ...course(current).project, assets: { ...course(current).project.assets, [image.meta.id]: image.meta } }
  project = planSlideTextInsertion(project, owner, { id: 'title', text: '标题' }).project
  project = planSlideImageInsertion(project, owner, { id: 'photo', assetId: image.meta.id }).project
  current = await replace(host, current, 'm19-place', project, { [image.meta.id]: image.bytes })
  const title = frameOf(course(current).project, 'title'), photo = frameOf(course(current).project, 'photo')
  expect(photo.width).toBe(400)
  expect(photo.height).toBe(300)
  for (const frame of [title, photo]) {
    // Centred on the 1024×768 canvas, not on 1280×720 (the second insert is staggered by the default offset).
    expect(Math.abs(frame.x + frame.width / 2 - canvas.width / 2)).toBeLessThanOrEqual(40)
    expect(Math.abs(frame.y + frame.height / 2 - canvas.height / 2)).toBeLessThanOrEqual(40)
  }

  // Save and reopen: the canvas size and the coordinates on it are kept.
  await host.saveToPath(current.documentId)
  const saved = openCourseProjectArchive(new Uint8Array(await fs.readFile(coursePath)))
  expect(courseSlideCanvas(saved.project)).toEqual(canvas)
  expect(saved.project.surfaces.find(surface => surface.type === 'slide')).toMatchObject({ canvas })
  expect(frameOf(saved.project, 'title')).toEqual(title)
  expect(frameOf(saved.project, 'photo')).toEqual(photo)
  expect(saved.assetFiles[image.meta.id]).toEqual(png)

  // Changing the size again scales what is there by one uniform factor and centres it.
  const next = { width: 720, height: 1280 }
  current = await replace(host, current, 'm19-resize', resizeCourseSlideCanvas(course(current).project, next))
  await host.saveToPath(current.documentId)
  const resized = openCourseProjectArchive(new Uint8Array(await fs.readFile(coursePath)))
  expect(courseSlideCanvas(resized.project)).toEqual(next)
  const s = Math.min(next.width / canvas.width, next.height / canvas.height)
  const dx = (next.width - canvas.width * s) / 2, dy = (next.height - canvas.height * s) / 2
  for (const [id, before] of [['title', title], ['photo', photo]] as const) {
    const after = frameOf(resized.project, id)
    expect(after.x).toBeCloseTo(before.x * s + dx)
    expect(after.y).toBeCloseTo(before.y * s + dy)
    expect(after.width).toBeCloseTo(before.width * s)
    expect(after.height).toBeCloseTo(before.height * s)
  }

  // The old course is still untouched on disk.
  expect(new Uint8Array(await fs.readFile(legacyPath))).toEqual(legacyBytes)
})
