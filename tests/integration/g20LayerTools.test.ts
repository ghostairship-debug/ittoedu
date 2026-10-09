// @vitest-environment node
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createImageData } from '../../src/components/image/data'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { createChartData } from '../../src/components/chart/data'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

const driver = new CourseV10Driver()
async function harness(localOnly = false) {
  const project = createBlankCourseProjectV10('Layers'), surfaceId = project.surfaces[0].id
  for (const key of ['shape', 'image', 'table', 'chart']) project.definitions[key] = { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }
  const frame = (x: number, y: number, width = 100, height = 60) => ({ width, height, transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number] })
  const { defaultShapeData } = await import('../../src/components/shape/data')
  for (const [id, x, y, width, height] of [['shape-a', 20, 30, 100, 60], ['shape-b', 230, 110, 80, 70], ['shape-c', 650, 230, 120, 90]] as const)
    project.instances[id] = { id, definitionId: 'shape', data: defaultShapeData(), frame: frame(x, y, width, height) }
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  project.assets.image = { id: 'image', path: 'assets/image.svg', mimeType: 'image/svg+xml', byteLength: bytes.length }
  project.instances.picture = { id: 'picture', definitionId: 'image', data: createImageData('image'), frame: frame(50, 70) }
  project.instances.table = { id: 'table', definitionId: 'table', data: createTableData() as never, frame: frame(200, 70) }
  project.instances.chart = { id: 'chart', definitionId: 'chart', data: createChartData() as never, frame: frame(400, 70) }
  project.surfaces[0].childIds = ['shape-a', 'shape-b', 'shape-c', 'picture', 'table', 'chart']
  for (const [id, plane] of [['global-back', 'underlay'], ['global-front', 'overlay']] as const) {
    project.instances[id] = { id, definitionId: 'shape', data: defaultShapeData(), frame: frame(10, 10) }
    project.global[plane].push(id)
  }
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No physical save requested') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: { image: bytes }, components: {} } }, 'layers.glx')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [localOnly ? { kind: 'course-surface', surfaceId } : { kind: 'document' }] }] })
  return { project, surfaceId, session, gateway,
    object: (instanceId: string) => gateway.issueTarget('r', session.documentId, { kind: 'course-instance', surfaceId, instanceId }),
    page: () => gateway.issueTarget('r', session.documentId, { kind: 'course-surface', surfaceId }),
    invoke: (callId: string, name: string, input: unknown) => gateway.execute('r', callId, { name, input }) }
}
function applied(result: ToolResult) {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  if (result.kind !== 'document-operation') throw new Error(JSON.stringify(result))
  return result
}
function project(snapshot: DocumentSnapshot) { if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10'); return snapshot.model.project }
async function undo(f: Awaited<ReturnType<typeof harness>>, operationId: string) {
  const before = f.session.read()
  expect(await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId, actor: 'human', baseRevision: before.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
}

it('duplicates professional image/table/chart with independent identities, preserved resources, reopen and one undo under page authority', async () => {
  const f = await harness(true), before = f.session.read(), sourceIds = ['picture', 'table', 'chart']
  const result = applied(await f.invoke('copies', 'batch', { operations: await Promise.all(sourceIds.map(async id => ({ name: 'object.structure', input: { target: await f.object(id), action: 'duplicate' } }))) }))
  const after = f.session.read()
  expect(after.undoDepth).toBe(1); expect(after.model.resources).toEqual(before.model.resources)
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  expect(result.affected).toHaveLength(3)
  for (let index = 0; index < result.affected.length; index++) {
    const original = project(before).instances[sourceIds[index]]
    const copied = Object.values(project(after).instances).find(instance => !project(before).instances[instance.id] && instance.definitionId === original.definitionId)!
    expect(copied).toBeDefined()
    expect(copied.id).not.toBe(sourceIds[index])
    expect(copied.frame).toEqual({ ...original.frame, transform: [1, 0, 0, 1, original.frame!.transform[4] + 20, original.frame!.transform[5] + 20] })
    expect(copied.data).toEqual(original.data)
  }
  const copies = Object.values(project(after).instances).filter(instance => !project(before).instances[instance.id])
  const tableCopy = copies.find(instance => instance.definitionId === 'table')!, chartCopy = copies.find(instance => instance.definitionId === 'chart')!
  const cellId = parseTableData(tableCopy.data).rows[0].cells[0].id
  applied(await f.invoke('edit-copies', 'batch', { operations: [
    { name: 'object.author', input: { target: await f.object(tableCopy.id), change: { kind: 'table', edit: { kind: 'cell-text', cellId, text: 'Copy only' } } } },
    { name: 'object.author', input: { target: await f.object(chartCopy.id), change: { kind: 'chart', edit: { type: 'title', value: 'Copy chart only' } } } },
  ] }))
  expect(parseTableData(project(f.session.read()).instances[tableCopy.id].data).rows[0].cells[0].text).toBe('Copy only')
  expect(project(f.session.read()).instances[chartCopy.id].data).toMatchObject({ title: 'Copy chart only' })
  expect(project(f.session.read()).instances.table.data).toEqual(project(before).instances.table.data)
  expect(project(f.session.read()).instances.chart.data).toEqual(project(before).instances.chart.data)
  await undo(f, 'undo-copy-edits')
  expect(project(f.session.read()).instances).toEqual(project(after).instances)
  expect(await f.invoke('scope-escape', 'object.structure', { target: await f.object('global-front'), action: 'remove' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  await undo(f, 'undo-copies')
  expect(project(f.session.read()).instances).toEqual(project(before).instances)
  expect(project(f.session.read()).surfaces).toEqual(project(before).surfaces)
  expect(f.session.read().model.resources).toEqual(before.model.resources)
})

it('deletes referenced objects atomically, cleans rules, retains archive assets and restores references on undo', async () => {
  const f = await harness()
  applied(await f.invoke('seed-rule', 'interaction.update', { target: await f.page(), change: { kind: 'add', rule: {
    name: 'click-picture', enabled: true, trigger: { type: 'node.click', nodeId: 'picture' }, conditions: [],
    actions: [{ start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: 'shape-a', effect: 'none', durationMs: 0, easing: 'linear' } }],
  } } }))
  const before = f.session.read()
  applied(await f.invoke('delete', 'batch', { operations: await Promise.all(['picture', 'shape-a'].map(async id => ({ name: 'object.structure', input: { target: await f.object(id), action: 'remove' } }))) }))
  const after = f.session.read()
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  expect(project(after).instances.picture).toBeUndefined(); expect(project(after).instances['shape-a']).toBeUndefined()
  expect(JSON.stringify(project(after))).not.toContain('click-picture')
  expect(project(after).assets).toEqual(project(before).assets); expect(after.model.resources).toEqual(before.model.resources)
  expect(project(after).global).toEqual(project(before).global)
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  await undo(f, 'undo-delete')
  expect(project(f.session.read()).instances).toEqual(project(before).instances)
  expect(project(f.session.read()).surfaces).toEqual(project(before).surfaces)
})

it('aligns and distributes unmounted objects while rejecting cross-owner moves and partial batches', async () => {
  const f = await harness(), ids = ['shape-a', 'shape-b', 'shape-c'], handles = await Promise.all(ids.map(f.object)), global = await f.object('global-front'), baseline = f.session.read()
  expect(await f.invoke('plane', 'object.structure', { target: global, action: 'move', destination: await f.page() })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('atomic-invalid', 'batch', { operations: [
    { name: 'object.structure', input: { target: handles[0], action: 'remove' } },
    { name: 'object.layout', input: { targets: [handles[1], global], intent: { kind: 'align', alignment: 'top' } } },
  ] })).toMatchObject({ kind: 'error' })
  expect(f.session.read()).toEqual(baseline)
  applied(await f.invoke('layout', 'batch', { operations: [
    { name: 'object.layout', input: { targets: handles, intent: { kind: 'align', alignment: 'top' } } },
    { name: 'object.layout', input: { targets: handles, intent: { kind: 'distribute', axis: 'horizontal' } } },
    { name: 'object.structure', input: { target: handles[0], action: 'reorder', direction: 'front' } },
  ] }))
  const after = f.session.read(), frames = ids.map(id => project(after).instances[id].frame!)
  expect(new Set(frames.map(frame => frame.transform[5])).size).toBe(1)
  expect(frames[1].transform[4] - frames[0].transform[4] - frames[0].width).toBe(frames[2].transform[4] - frames[1].transform[4] - frames[1].width)
  expect(project(after).global).toEqual(project(baseline).global)
  expect(project(after).instances['global-front']).toEqual(project(baseline).instances['global-front'])
  expect(after.undoDepth).toBe(1); expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  await undo(f, 'undo-layout'); expect(project(f.session.read()).instances).toEqual(project(baseline).instances)
})
