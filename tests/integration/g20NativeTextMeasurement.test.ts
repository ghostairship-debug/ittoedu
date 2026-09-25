// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createNamedSelectionFixture } from '../helpers/g20NamedSelectionFixture'
import { prepareNativeTextFrame, type AsyncNativeTextMeasurePort } from '../../src/core/tools/prepareNativeTextFrame'
import { prepareNativeLayerTextMeasurement } from '../../src/core/tools/nativeTextLayout'
import { layerToolContext } from '../../src/core/tools/layerEditing'
import { patchEffectiveLayerPropertiesAtTarget } from '../../src/core/tools/layerProperties'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { buildSlideEditorView } from '../../src/core/tools/slideLayerView'

function fixture() {
  const f = createNamedSelectionFixture(), item = f.scene.layerItems[0]
  if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('text fixture')
  item.content.data.style.overflow = 'auto-height'; item.frame.width = 120
  return { ...f, item }
}

it('prepares the exact effective named text/runs/font once, rejects mismatches/fallback and keeps explicit or unnecessary sizing synchronous', async () => {
  const f = fixture(), target = { kind: 'course-object' as const, locationId: f.locationId, itemId: 'scene-text', stateId: 'named-a' }
  const context = layerToolContext(f.model.project, target)
  const patch = { nativeTextStyle: { fontFamily: '"Noto Sans SC"', fontSize: 48 }, nativeData: { text: '中文😀增长', runs: [{ start: 0, end: 2, style: { fontSize: 60 } }], style: { bold: true } } }
  const measure = vi.fn<AsyncNativeTextMeasurePort>(async () => ({ measurementMode: 'browser-canvas', requiredWidth: 120, requiredHeight: 187.5 }))
  const port = await prepareNativeTextFrame(context.entry.item, patch, measure)
  expect(measure).toHaveBeenCalledTimes(1)
  expect(measure.mock.calls[0][0]).toMatchObject({ width: 120, axis: 'height', node: { x: 160, text: '中文😀增长', style: { fontFamily: '"Noto Sans SC"', fontSize: 48, bold: true }, runs: patch.nativeData.runs } })
  const planned = patchEffectiveLayerPropertiesAtTarget(f.model.project, context.command, patch, { expectedRevision: 0, measureTextFrame: port })
  expect(planned.ok).toBe(true)
  const effective = buildSlideEditorView({ project: planned.nextDocument!, locationId: f.locationId, stateId: 'named-a' }).layers.find(layer => layer.selectionId === 'scene-text')!.item
  expect(effective).toMatchObject({ frame: { width: 120, height: 187.5 }, content: { data: { text: '中文😀增长' } } })
  expect(f.item.frame.height).toBe(90)
  expect(() => port(context.entry.item, { ...patch, frame: { width: 121 } })).toThrow('已改变')
  await expect(prepareNativeTextFrame(context.entry.item, patch)).rejects.toMatchObject({ code: 'unsupported-measurement' })
  await expect(prepareNativeTextFrame(context.entry.item, patch, async () => ({ measurementMode: 'deterministic-fallback' as 'browser-canvas', requiredWidth: 120, requiredHeight: 42 }))).rejects.toMatchObject({ code: 'unsupported-measurement' })
  const explicit = { ...patch, frame: { height: 77 } }
  expect(prepareNativeLayerTextMeasurement(context.entry.item, explicit)).toBeNull()
  expect((await prepareNativeTextFrame(context.entry.item, explicit))(context.entry.item, explicit)).toEqual({})
  const driver = new CourseV9Driver()
  expect(driver.apply(f.model, { type: 'course.object.patch', locationId: f.locationId, itemId: 'scene-text', patch: { frame: { x: 125 } } })).not.toBeInstanceOf(Promise)
  expect(() => driver.apply(f.model, { type: 'course.object.patch', locationId: f.locationId, itemId: 'scene-text', patch })).toThrow('真实字体测量')
})

it('the real Registry/Gateway commits base text and measured height once and stop during async preparation rejects the late result', async () => {
  const f = fixture(); let release!: () => void, pending: Promise<void> | undefined
  const measure = vi.fn<AsyncNativeTextMeasurePort>(async () => { if (pending) await pending; return { measurementMode: 'browser-canvas', requiredWidth: 120, requiredHeight: 203.25 } })
  const driver = new CourseV9Driver({ measureNativeTextAsync: measure })
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => randomUUID(), bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(f.model, 'measurement.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => randomUUID())
  await gateway.beginRun({ runId: 'run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const object = () => gateway.issueTarget('run', session.documentId, { kind: 'course-object', locationId: f.locationId, itemId: 'scene-text' })
  expect(await gateway.execute('run', 'first', { name: 'text.replace', input: { target: await object(), content: '正式变长正文😀' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 1 } })
  const after = session.read()
  expect(after.undoDepth).toBe(1)
  if (after.model.kind !== 'course-v9') throw new Error('course')
  expect(buildSlideEditorView({ project: after.model.project, locationId: f.locationId, stateId: null }).layers.find(layer => layer.selectionId === 'scene-text')!.item).toMatchObject({ frame: { height: 203.25 }, content: { data: { text: '正式变长正文😀' } } })
  pending = new Promise<void>(resolve => { release = resolve })
  const operation = gateway.execute('run', 'late', { name: 'text.replace', input: { target: await object(), content: '不得落盘的迟到文字' } })
  await vi.waitFor(() => expect(measure).toHaveBeenCalledTimes(2))
  await gateway.stop('run'); release()
  expect(await operation).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(session.read().model).toEqual(after.model); expect(session.read().undoDepth).toBe(1)
})
