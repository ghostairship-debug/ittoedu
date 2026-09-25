// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createNamedSelectionFixture } from '../helpers/g20NamedSelectionFixture'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { AsyncNativeTextMeasurePort } from '../../src/core/tools/prepareNativeTextFrame'
import { describeTools, mutationCallSchema } from '../../src/core/tools/ToolCatalog'
import { createShapeNode } from '../../src/core/tools/nativeNodeFactories'
import { buildSlideEditorView } from '../../src/core/tools/slideLayerView'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import type { DocumentModel, DocumentPersistence } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('exposes only formally validated whole-node Native text style and commits a measured named edit once through save and reopen', async () => {
  const f = createNamedSelectionFixture()
  const text = f.scene.layerItems[0]
  if (text.kind !== 'native' || text.content.nativeType !== 'text') throw new Error('Text fixture required')
  text.content.data.style.overflow = 'auto-height'
  text.content.data.style.emphasis = true
  text.frame.width = 120
  const shape = sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'non-text', x: 10, y: 10, width: 50, height: 40 }))
  shape.order = 5
  f.scene.layerItems.push(shape)

  const valid = { name: 'object.update', input: { target: 't1', properties: { nativeTextStyle: { fontFamily: 'Noto Sans SC', fontSize: 48, color: '#123456' } } } }
  expect(mutationCallSchema.safeParse(valid).success).toBe(true)
  for (const properties of [
    { nativeData: { style: { fontSize: 48 } } },
    { nativeTextStyle: { fontSize: 7 } },
    { nativeTextStyle: { color: 'red' } },
    { nativeTextStyle: { fontSize: 48, arbitrary: true } },
  ]) expect(mutationCallSchema.safeParse({ name: 'object.update', input: { target: 't1', properties } }).success).toBe(false)
  const described = JSON.stringify(describeTools(['object.update'])[0].schema)
  expect(described).toContain('nativeTextStyle')
  expect(described).not.toContain('nativeData')

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-text-style-'))
  roots.push(root)
  const filename = path.join(root, 'named.h5lesson')
  const measure = vi.fn<AsyncNativeTextMeasurePort>(async () => ({ measurementMode: 'browser-canvas', requiredWidth: 120, requiredHeight: 203.25 }))
  const driver = new CourseV9Driver({ measureNativeTextAsync: measure })
  const persistence: DocumentPersistence = {
    async append() {},
    async save(input) {
      await fs.writeFile(filename, input.bytes)
      if (input.binding.kind !== 'file') throw new Error('File binding required')
      return { ...input.binding, version: `revision-${input.revision}` }
    },
  }
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path, persistence })
  const session = await registry.create(f.model, 'named.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { measureNativeTextAsync: measure })
  await gateway.beginRun({ runId: 'style-run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'course-owner', owner: 'scene', locationId: f.locationId, stateId: 'named-a' }] }] })
  const target = await gateway.issueTarget('style-run', session.documentId, { kind: 'course-object', locationId: f.locationId, itemId: 'scene-text', stateId: 'named-a' })
  const nonText = await gateway.issueTarget('style-run', session.documentId, { kind: 'course-object', locationId: f.locationId, itemId: 'non-text', stateId: 'named-a' })
  const otherState = await gateway.issueTarget('style-run', session.documentId, { kind: 'course-object', locationId: f.locationId, itemId: 'scene-text', stateId: 'named-b' })
  expect(await gateway.execute('style-run', 'raw-data', { name: 'object.update', input: { target, properties: { nativeData: { style: { fontSize: 48 } } } } })).toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect(await gateway.execute('style-run', 'non-text', { name: 'object.update', input: { target: nonText, properties: { nativeTextStyle: { fontSize: 48 } } } })).toMatchObject({ kind: 'error' })
  expect(await gateway.execute('style-run', 'other-state', { name: 'object.update', input: { target: otherState, properties: { nativeTextStyle: { fontSize: 48 } } } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(session.read().revision).toBe(0)
  expect(session.read().undoDepth).toBe(0)

  const before = session.read()
  const result = await gateway.execute('style-run', 'text-and-style', { name: 'batch', input: { operations: [
    { name: 'text.replace', input: { target, content: '命名态 A 新正文😀' } },
    { name: 'object.update', input: { target, properties: valid.input.properties } },
  ] } })
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 1 } })
  const after = session.read()
  expect(after.undoDepth).toBe(1)
  expect(measure).toHaveBeenCalledTimes(2)
  expect(measure.mock.calls[1][0]).toMatchObject({ node: { text: '命名态 A 新正文😀', style: { fontFamily: 'Noto Sans SC', fontSize: 48 } } })
  if (after.model.kind !== 'course-v9') throw new Error('Course model required')
  const itemAt = (model: Extract<DocumentModel, { kind: 'course-v9' }>, stateId: string | null) =>
    buildSlideEditorView({ project: model.project, locationId: f.locationId, stateId }).layers.find(layer => layer.selectionId === 'scene-text')!.item
  expect(itemAt(after.model, 'named-a')).toMatchObject({ frame: { height: 203.25 }, content: { data: { text: '命名态 A 新正文😀', style: { fontFamily: 'Noto Sans SC', fontSize: 48, color: '#123456', emphasis: true } } } })
  expect(itemAt(after.model, 'named-b')).toEqual(itemAt(before.model as Extract<DocumentModel, { kind: 'course-v9' }>, 'named-b'))
  expect(itemAt(after.model, null)).toEqual(itemAt(before.model as Extract<DocumentModel, { kind: 'course-v9' }>, null))

  await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
  const reopened = await driver.load(new Uint8Array(await fs.readFile(filename)))
  if (reopened.kind !== 'course-v9') throw new Error('Reopened course required')
  expect(itemAt(reopened, 'named-a')).toEqual(itemAt(after.model, 'named-a'))
  expect(itemAt(reopened, 'named-b')).toEqual(itemAt(after.model, 'named-b'))
  expect(session.read().dirty).toBe(false)
  const undoFrom = session.read()
  await session.execute({ documentId: undoFrom.documentId, epoch: undoFrom.epoch, operationId: 'undo-style', actor: 'human', baseRevision: undoFrom.revision, mutation: { type: 'undo' } })
  if (session.read().model.kind !== 'course-v9') throw new Error('Course model required')
  expect(itemAt(session.read().model as Extract<DocumentModel, { kind: 'course-v9' }>, 'named-a')).toEqual(itemAt(before.model as Extract<DocumentModel, { kind: 'course-v9' }>, 'named-a'))
})
