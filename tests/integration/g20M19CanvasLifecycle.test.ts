// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { prepareCourseElementEdits } from '../../src/core/course/courseElementInsertion'
import { surfaceSettingsEdits } from '../../src/core/course/courseSemanticEdits'
import { prepareComponentImageApplication } from '../../src/core/tools/componentImageApplication'
import { createImageAssetMetadata } from '../../src/core/tools/imageAssetMetadata'
import { frameCorners } from '../../src/core/components/geometry'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { ComponentOperationBatch } from '../../src/shared/contracts/component-platform/operations'
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
  if (snapshot.model.kind !== 'course-v10') throw new Error(`expected a course, got ${snapshot.model.kind}`)
  return snapshot.model
}

function frameOf(project: CourseProjectV10, id: string) {
  const frame = project.instances[id]?.frame
  if (!frame) throw new Error(`missing ${id}`)
  const points = frameCorners(frame)
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y))
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y }
}

async function apply(host: DocumentHostService, current: DocumentSnapshot, operationId: string, command: ComponentOperationBatch) {
  const result = await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId, actor: 'human', mutation: { type: 'command', command } })
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'applied' })
  return host.internalAPI.read(current.documentId)
}

it('M19-T01 keeps an existing V10 1280×720 course as it is and carries a chosen canvas through create, save, reopen and resize', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m19-canvas-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const tree = new WorkspaceFilesDesktopService(host.files)
  const registered = await tree.authorizeRoot(workspace)
  try {

    // An existing V10 course keeps its authored canvas and complete resource closure.
    const retiredBytes = new Uint8Array(await fs.readFile(path.join(repo, 'tests/fixtures/architecture-baseline/slide-heavy.h5lesson')))
    const retiredPath = path.join(workspace, 'retired.h5lesson')
    await fs.writeFile(retiredPath, retiredBytes)
    await expect(host.open(retiredPath)).rejects.toThrow('旧工程原件未改变')
    expect(new Uint8Array(await fs.readFile(retiredPath))).toEqual(retiredBytes)

    const baseline = createBlankCourseProjectV10('既有尺寸课件')
    const existingText = prepareCourseElementEdits(baseline, baseline.surfaces[0].id, null, 'text', { text: '已有内容', x: 80, y: 100 })
    const existingProject = applyComponentOperation(baseline, captureComponentOperation(baseline, existingText.edits))
    existingProject.assets.existing = { id: 'existing', path: 'assets/existing.svg', mimeType: 'image/svg+xml', kind: 'image' }
    existingProject.background = { assetId: 'existing' }
    const existingBytes = createCourseProjectV10Archive({ project: existingProject, resources: {
      assets: { existing: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') }, components: {},
    } })
    const existingPath = path.join(workspace, 'existing.glx')
    await fs.writeFile(existingPath, existingBytes)
    const existing = await host.open(existingPath)
    expect(existing.dirty).toBe(false)
    expect(course(existing)).toEqual({ kind: 'course-v10', ...openCourseProjectV10Archive(existingBytes) })
    expect(course(existing).project.surfaces.find(surface => surface.kind === 'slide')!.designSize).toEqual({ width: 1280, height: 720 })

    // A new 4:3 course from the explorer's create request.
    const created = await tree.operate({ type: 'create-course', workspaceId: registered.workspaceId, operationId: 'm19-create-4-3',
      targetDirectoryId: registered.rootEntryId, name: '标准.glx', canvas: { width: 1024, height: 768 } })
    expect(created).toMatchObject({ status: 'success' })
    const coursePath = path.join(workspace, '标准.glx')
    let current = await host.open(coursePath)
    const canvas = { width: 1024, height: 768 }
    expect(course(current).project.surfaces[0].designSize).toEqual(canvas)

    // Text and an image are placed on the course canvas: both centred on it, the image at its default size.
    const surfaceId = course(current).project.surfaces[0].id
    const png = new Uint8Array(solidPng(400, 300, [37, 99, 235]))
    const image = createImageAssetMetadata({ name: 'sample.png', mimeType: 'image/png', bytes: png }, { id: 'm19-image', dimensions: { width: 400, height: 300 } })
    const text = prepareCourseElementEdits(course(current).project, surfaceId, null, 'text', { text: '标题' })
    current = await apply(host, current, 'm19-place-text', captureComponentOperation(course(current).project, text.edits))
    const media = await prepareComponentImageApplication({ snapshot: current, target: { kind: 'course-surface', surfaceId },
      image: { bytes: png, filename: 'sample.png', mimeType: 'image/png' }, mode: 'insert' }, { prepareImage: async () => image, createId: () => 'photo' })
    current = await apply(host, current, 'm19-place-photo', media.command)
    const titleId = text.instanceIds[0], photoId = media.instanceId
    const title = frameOf(course(current).project, titleId), photo = frameOf(course(current).project, photoId)
    expect(photo.width).toBe(400)
    expect(photo.height).toBe(300)
    for (const frame of [title, photo]) {
      // Both formal insertion planners use the captured 1024×768 canvas.
      expect(Math.abs(frame.x + frame.width / 2 - canvas.width / 2)).toBeLessThanOrEqual(40)
      expect(Math.abs(frame.y + frame.height / 2 - canvas.height / 2)).toBeLessThanOrEqual(40)
    }

    // Save and reopen: the canvas size and the coordinates on it are kept.
    await host.saveToPath(current.documentId)
    const saved = openCourseProjectV10Archive(new Uint8Array(await fs.readFile(coursePath)))
    expect(saved.project.surfaces[0].designSize).toEqual(canvas)
    expect(saved.project.surfaces.find(surface => surface.kind === 'slide')).toMatchObject({ designSize: canvas })
    expect(frameOf(saved.project, titleId)).toEqual(title)
    expect(frameOf(saved.project, photoId)).toEqual(photo)
    expect(saved.resources.assets[image.meta.id]).toEqual(png)

    // Changing the size again scales what is there by one uniform factor and centres it.
    const next = { width: 720, height: 1280 }
    current = await apply(host, current, 'm19-resize', captureComponentOperation(course(current).project, surfaceSettingsEdits(course(current).project, surfaceId, { resize: { designSize: next, mode: 'contain', includeGlobal: true } })))
    await host.saveToPath(current.documentId)
    const resized = openCourseProjectV10Archive(new Uint8Array(await fs.readFile(coursePath)))
    expect(resized.project.surfaces[0].designSize).toEqual(next)
    const s = Math.min(next.width / canvas.width, next.height / canvas.height)
    const dx = (next.width - canvas.width * s) / 2, dy = (next.height - canvas.height * s) / 2
    for (const [id, before] of [[titleId, title], [photoId, photo]] as const) {
      const after = frameOf(resized.project, id)
      expect(after.x).toBeCloseTo(before.x * s + dx)
      expect(after.y).toBeCloseTo(before.y * s + dy)
      expect(after.width).toBeCloseTo(before.width * s)
      expect(after.height).toBeCloseTo(before.height * s)
    }

    // Opening the existing course and editing the new course never rewrites the original archive.
    expect(new Uint8Array(await fs.readFile(existingPath))).toEqual(existingBytes)
  } finally { tree.dispose() }
})
