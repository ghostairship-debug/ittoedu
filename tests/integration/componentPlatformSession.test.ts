// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentModel, DocumentOperation, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import { createImageData } from '../../src/components/image/data'

const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

function sample(): Extract<DocumentModel, { kind: 'course-v10' }> {
  const project = createBlankCourseProjectV10('矩阵卡片', (() => { let sequence = 0; return () => `sample-${++sequence}` })())
  project.revision = 7
  project.definitions = {
    ...project.definitions,
    card: { id: 'card', role: 'content', implementation: { kind: 'builtin', key: 'group' } },
    text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'text' } },
    shape: { id: 'shape', role: 'content', implementation: { kind: 'builtin', key: 'shape' } },
  }
  project.instances = {
    ...project.instances,
    card: { id: 'card', definitionId: 'card', data: {}, frame: { width: 400, height: 200, transform: [0, 1, -1, 0.25, 120, 80] }, childIds: ['title', 'shape'] },
    title: { id: 'title', definitionId: 'text', data: { text: '原始标题', emphasis: ['原始'] }, frame: { width: 200, height: 40, transform: [1, 0, 0, 1, 15, 20] } },
    shape: { id: 'shape', definitionId: 'shape', data: { fill: '#ff0000' }, frame: { width: 60, height: 50, transform: [-1, 0, 0.2, 1, 180, 100] } },
  }
  project.surfaces[0].childIds = ['card']
  project.assets = { raw: { id: 'raw', path: 'assets/original.bin', mimeType: 'application/octet-stream' } }
  return { kind: 'course-v10', project, resources: { assets: { raw: new Uint8Array([1, 2, 3]) }, components: {} } }
}

function operation(snapshot: DocumentSnapshot, operationId: string, edits: ComponentEdit[]): DocumentOperation {
  if (snapshot.model.kind !== 'course-v10') throw new Error('expected V10')
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId, actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(snapshot.model.project, edits) } }
}

it('saves authored Spatial cameras and inserts a surface with owned content through one Session batch', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'component-platform-spatial-'))
  temporaryDirectories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await host.operate({ type: 'create', model: sample(), suggestedName: '世界.h5lesson' }) as DocumentSnapshot
  const spatial = { home: { x: 150, y: -20, zoom: 1.5, rotation: 30 }, frames: [{ id: 'camera-one', title: '实验', pose: { x: 400, y: 200, zoom: 2 } }],
    paths: [{ id: 'camera-path', frameIds: ['camera-one'] }] }
  const edits: ComponentEdit[] = [{ type: 'surface.insert', index: 1, surface: { id: 'world', kind: 'spatial', title: '世界', childIds: [] } },
    { type: 'instance.insert', container: { kind: 'surface', surfaceId: 'world' }, index: 0,
      instances: [{ id: 'world-title', definitionId: 'text', data: { text: '世界标题' } }], rootIds: ['world-title'] },
    { type: 'spatial.set', surfaceId: 'world', spatial }]
  expect(await host.internalAPI.dispatch(operation(initial, 'world-create', edits))).toMatchObject({ status: 'applied' })
  const read = await host.internalAPI.read(initial.documentId)
  if (read.model.kind !== 'course-v10') throw new Error('expected V10')
  const update = operation(read, 'world-camera', [{ type: 'spatial.set', surfaceId: 'world', spatial: { ...spatial, home: { ...spatial.home, zoom: 3 } } }])
  await host.internalAPI.dispatch(operation(read, 'independent-title', [{ type: 'data.set', instanceId: 'world-title', path: ['text'], value: '仍保留' }]))
  expect(await host.internalAPI.dispatch(update)).toMatchObject({ status: 'applied' })
  expect(await host.internalAPI.dispatch(operation(read, 'stale-camera', [{ type: 'spatial.set', surfaceId: 'world', spatial }]))).toMatchObject({ status: 'conflict' })
  const current = await host.internalAPI.read(initial.documentId)
  const driver = new CourseV10Driver(), reopened = await driver.load(await driver.serialize(current.model))
  if (reopened.kind !== 'course-v10') throw new Error('expected V10')
  expect(reopened.project.surfaces[1]).toMatchObject({ id: 'world', childIds: ['world-title'], spatial: { ...spatial, home: { ...spatial.home, zoom: 3 } } })
  expect(reopened.project.instances['world-title'].data).toEqual({ text: '仍保留' })
})

it('commits local frame/content changes through the real Session, rebases independent fields, deduplicates ACK and saves/reopens V10', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'component-platform-session-'))
  temporaryDirectories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await host.operate({ type: 'create', model: sample(), suggestedName: '卡片.h5lesson' }) as DocumentSnapshot
  expect(initial.revision).toBe(7)
  const notifications: unknown[] = []
  host.subscribeEvents(event => notifications.push(event))
  const frame = { width: 400, height: 200, transform: [0, 1, -1, 0.25, 220, 180] as [number, number, number, number, number, number] }
  const drag = operation(initial, 'drag', [{ type: 'frame.set', instanceId: 'card', frame }])
  const dragged = await host.internalAPI.dispatch(drag)
  expect(dragged).toMatchObject({ status: 'applied', revision: 8, appliedChanges: { affectedTargets: ['card'] } })
  const title = operation(initial, 'title', [{ type: 'data.set', instanceId: 'title', path: ['text'], value: '修改标题' }])
  expect(await host.internalAPI.dispatch(title)).toMatchObject({ status: 'applied', beforeRevision: 8, revision: 9 })
  const duplicate = await host.internalAPI.dispatch(drag)
  expect(duplicate).toEqual(dragged)
  const conflict = operation(initial, 'conflicting-title', [{ type: 'data.set', instanceId: 'title', path: ['text'], value: '过期标题' }])
  expect(await host.internalAPI.dispatch(conflict)).toMatchObject({ status: 'conflict', applied: false, code: 'component-field-conflict' })
  const beforeUndo = await host.internalAPI.read(initial.documentId)
  expect(beforeUndo.undoDepth).toBe(2)
  expect(notifications).toHaveLength(2)
  expect(notifications[0]).toMatchObject({ type: 'changed', operationId: 'drag', appliedChanges: dragged.status === 'applied' ? dragged.appliedChanges : undefined })
  const history = (type: 'undo' | 'redo', snapshot: DocumentSnapshot): DocumentOperation => ({ documentId: snapshot.documentId, epoch: snapshot.epoch,
    baseRevision: snapshot.revision, operationId: type, actor: 'human', mutation: { type } })
  expect(await host.internalAPI.dispatch(history('undo', beforeUndo))).toMatchObject({ status: 'applied', appliedChanges: { affectedTargets: ['title'] } })
  const undone = await host.internalAPI.read(initial.documentId)
  expect(undone.model).toMatchObject({ kind: 'course-v10', project: { instances: { title: { data: { text: '原始标题' } }, card: { frame } } } })
  await host.internalAPI.dispatch(history('redo', undone))
  const filename = path.join(directory, '卡片.h5lesson')
  const saved = await host.operate({ type: 'save', documentId: initial.documentId, path: filename }) as DocumentSnapshot
  expect(saved.dirty).toBe(false)
  await host.operate({ type: 'close', documentId: initial.documentId })
  const reopened = await host.open(filename)
  expect(reopened.model).toMatchObject({ kind: 'course-v10', project: { revision: 11, instances: { card: { frame }, title: { data: { text: '修改标题', emphasis: ['原始'] } } } } })
  expect(reopened.model.resources.assets.raw).toEqual(new Uint8Array([1, 2, 3]))
  const implementation = operation(reopened, 'source', [{ type: 'implementation.set', instanceId: 'shape', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }])
  const receipt = await host.internalAPI.dispatch(implementation)
  expect(receipt).toMatchObject({ status: 'applied' })
  const restarted = new DocumentHostService(path.join(directory, 'recovery'))
  const recovered = await restarted.internalAPI.restore(reopened.documentId)
  expect(recovered.model).toMatchObject({ kind: 'course-v10', project: { instances: { shape: { data: { fill: '#ff0000' }, implementationOverride: { kind: 'source' } } } } })
  expect(await restarted.internalAPI.lookup(reopened.documentId, 'source')).toEqual(receipt)
})

it('applies structure atomically, keeps one owning tree and rejects the old archive format without conversion', () => {
  const model = sample(), driver = new CourseV10Driver()
  const command = captureComponentOperation(model.project, [{ type: 'instance.move', instanceId: 'shape', container: { kind: 'surface', surfaceId: model.project.surfaces[0].id }, index: 1,
    frame: { width: 60, height: 50, transform: [0, -1, -1, 0.45, 20, 285] } }])
  const result = driver.apply(model, command)
  expect(result).toMatchObject({ kind: 'course-v10', project: { surfaces: [{ childIds: ['card', 'shape'] }], instances: { card: { childIds: ['title'] } } } })
  expect(model.project.instances.card.childIds).toEqual(['title', 'shape'])
  const cycle = captureComponentOperation(model.project, [{ type: 'instance.move', instanceId: 'card', container: { kind: 'instance', instanceId: 'card' }, index: 0, frame: model.project.instances.card.frame }])
  expect(() => driver.apply(model, cycle)).toThrow('自身子树')
  const old = zipSync({ 'project.json': strToU8(JSON.stringify({ schemaVersion: 9 })) })
  expect(() => driver.load(old)).toThrow('仅支持独立 Project V10')
})

it('adds a professional definition, owned instance and immutable resource in one Session edit and reopens their exact values', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'component-platform-producer-'))
  temporaryDirectories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('图片'), resources: { assets: {}, components: {} } }, '图片.h5lesson')
  if (initial.model.kind !== 'course-v10') throw new Error('expected V10')
  const edits: ComponentEdit[] = [
    { type: 'definition.set', definition: { id: 'guoling.image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } } },
    { type: 'asset.add', asset: { id: 'asset_image', path: 'assets/picture.png', mimeType: 'image/png' }, bytes: new Uint8Array([8, 7, 6]) },
    { type: 'instance.insert', container: { kind: 'surface', surfaceId: initial.model.project.surfaces[0].id }, index: 0, rootIds: ['picture'],
      instances: [{ id: 'picture', definitionId: 'guoling.image', data: createImageData('asset_image'), frame: { width: 100, height: 60, transform: [1, 0.2, 0, 1, 30, 40] } }] },
  ]
  const command = operation(initial, 'insert-picture', edits)
  expect(await host.internalAPI.dispatch({ ...command, operationId: 'future', baseRevision: 100 })).toMatchObject({ status: 'conflict', applied: false })
  expect(await host.internalAPI.dispatch(command)).toMatchObject({ status: 'applied', revision: 1, appliedChanges: { affectedTargets: ['picture'] } })
  const filename = path.join(directory, '图片.h5lesson')
  await host.internalAPI.save(initial.documentId, filename)
  await host.operate({ type: 'close', documentId: initial.documentId })
  const reopened = await host.open(filename)
  expect(reopened.model).toMatchObject({ kind: 'course-v10', project: { definitions: { 'guoling.image': { id: 'guoling.image' } },
    instances: { picture: { data: { assetId: 'asset_image' } } }, assets: { asset_image: { path: 'assets/picture.png' } } } })
  expect(reopened.model.resources.assets.asset_image).toEqual(new Uint8Array([8, 7, 6]))
  const current = await host.internalAPI.read(reopened.documentId)
  expect(await host.internalAPI.dispatch(operation(current, 'replace-bytes', [edits[1]]))).toMatchObject({ status: 'failed', applied: false })
  expect((await host.internalAPI.read(reopened.documentId)).model.resources.assets.asset_image).toEqual(new Uint8Array([8, 7, 6]))
  expect(await host.internalAPI.dispatch(operation(current, 'invalid-professional-data', [{ type: 'data.set', instanceId: 'picture', path: ['fit'], value: 'broken-fit' }]))).toMatchObject({ status: 'failed', applied: false })
  expect((await host.internalAPI.read(reopened.documentId)).model).toMatchObject({ project: { instances: { picture: { data: { fit: 'contain' } } } } })
})
