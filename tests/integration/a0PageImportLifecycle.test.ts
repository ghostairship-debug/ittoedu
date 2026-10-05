// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { JSDOM } from 'jsdom'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createCourseStructureSlice } from '../../src/renderer/store/slices/courseStructureSlice'
import { createCourseFromPptx } from '../../src/renderer/project/pptxCourseCreation'

const directories: string[] = []
const bridges: CourseV10DocumentBridge[] = []
const xmlWindow = new JSDOM('').window
// The parser consumes browser XML DOM; Main still receives Node-realm binary resources.
beforeAll(() => vi.stubGlobal('DOMParser', xmlWindow.DOMParser))
afterAll(() => { vi.unstubAllGlobals(); xmlWindow.close() })
afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.dispose()
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function sourcePptx(withContent: boolean) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  const first = pptx.addSlide()
  if (withContent) {
    first.addText('可编辑的中文标题', { x: 1, y: 1, w: 6, h: 1, fontSize: 24 })
    first.addShape(pptx.ShapeType.rect, { x: 1, y: 3, w: 2, h: 1, fill: { color: '2563EB' }, line: { color: '2563EB' } })
  }
  pptx.addSlide()
  return await pptx.write({ outputType: 'uint8array' }) as Uint8Array
}

it('imports professional PPTX pages, then keeps rename/order/delete/undo and the source archive through independent reopen', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-a0-pages-'))
  directories.push(directory)
  const bytes = await sourcePptx(true)
  const imported = await createCourseFromPptx(bytes, '演示导入')
  expect(imported.project.surfaces).toHaveLength(2)
  const [first, second] = imported.project.surfaces
  expect(first.childIds.map(id => imported.project.instances[id].definitionId)).toEqual(['guoling.text', 'guoling.shape'])
  expect(second.childIds).toEqual([])
  const sourceAsset = Object.values(imported.project.assets).find(asset => asset.path.endsWith('.pptx'))!
  expect(imported.resources.assets[sourceAsset.id]).toEqual(bytes)

  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project: imported.project, resources: imported.resources }, '演示导入.h5lesson')
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => initial,
    saveWithDialog: async () => { throw new Error('This check saves its named fixture through Main') },
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) },
    closeWithDialog: async () => false,
    discardRecovery: async documentId => { await host.operate({ type: 'discard-recovery', documentId }) },
    subscribe: listener => host.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge(); bridges.push(bridge); await bridge.connect(api)
  const kernel = createEditorStoreKernel({ bridge, commit() {} })
  const structure = createCourseStructureSlice(kernel, { readActiveLocationId: () => bridge.read().surfaceId })
  const added = await structure.addScene()
  expect(added.ok).toBe(true)
  expect(await structure.renameCourseSurface(second.id, '保留空白页')).toMatchObject({ ok: true })
  const order = [added.activatedLocationId!, second.id, first.id]
  expect(await structure.reorderCourseSurfaces(order)).toMatchObject({ ok: true })
  const captured = structure.captureCourseSurfaceDelete(first.id)
  expect(await structure.deleteCourseSurface(first.id, captured)).toMatchObject({ ok: true })
  expect(bridge.read().project!.instances[first.childIds[0]]).toBeUndefined()
  await bridge.undo()
  expect(bridge.read().project!.surfaces.map(surface => surface.id)).toEqual(order)
  expect(bridge.read().project!.instances[first.childIds[0]]).toEqual(imported.project.instances[first.childIds[0]])
  const filename = path.join(directory, '页面管理.h5lesson')
  await bridge.drain()
  await host.internalAPI.save(initial.documentId, filename)
  const reopened = await new DocumentHostService(path.join(directory, 'cold-recovery')).internalAPI.open(filename)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.model.project.surfaces.map(surface => surface.id)).toEqual(order)
  expect(reopened.model.project.surfaces[1].title).toBe('保留空白页')
  // The archive stores JSON numbers, which represents both signed zeros as zero.
  expect(reopened.model.project.instances[first.childIds[0]]).toEqual(JSON.parse(JSON.stringify(imported.project.instances[first.childIds[0]])))
  expect(reopened.model.resources.assets[sourceAsset.id]).toEqual(bytes)
})

it('imports a valid blank presentation as editable pages and retains its original PPTX', async () => {
  const bytes = await sourcePptx(false)
  const imported = await createCourseFromPptx(bytes, '空白演示')
  expect(imported.project.surfaces).toHaveLength(2)
  expect(imported.project.surfaces.every(surface => surface.kind === 'slide' && surface.childIds.length === 0)).toBe(true)
  const source = Object.values(imported.project.assets).find(asset => asset.path.endsWith('.pptx'))!
  expect(imported.resources.assets[source.id]).toEqual(bytes)
  expect(imported.project.global.overlay).toHaveLength(createBlankCourseProjectV10().global.overlay.length)
})
