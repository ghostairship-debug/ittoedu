// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { readTarget } from '../../src/core/tools/ToolTargets'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { WEB_DEFINITION } from '../../src/components/web/data'
import type { ComponentFrame } from '../../src/shared/contracts/component-platform/frame'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolTarget } from '../../src/shared/workbench/tools'

const course = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected Course V10')
  return snapshot.model
}

async function fixture() {
  let sequence = 0
  const driver = new CourseV10Driver()
  const persistence: DocumentPersistence = { async append() {}, async save() { throw new Error('No disk write in read test') } }
  const registry = new DocumentRegistry({ persistence, drivers: [driver], createId: () => `read-frame-${++sequence}`, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++sequence))
  const project = createBlankCourseProjectV10('Nested frame read'), surfaceId = componentSurfaces(project)[0].id
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  testContainerInstance(project, 0).childIds = ['parent']
  project.instances.parent = { id: 'parent', definitionId: WEB_DEFINITION.id, data: { html: '<section></section>' },
    childIds: ['nested'], frame: { width: 1200, height: 520, transform: [1, 0, 0, 1, 40, 150] } }
  const frame: ComponentFrame = { width: 580, height: 205, transform: [1, 0, 0, 1, 600, 292] }
  project.instances.nested = { id: 'nested', definitionId: WEB_DEFINITION.id,
    data: { html: `<div>${'Editable HTML content '.repeat(1800)}</div>`, css: '.material{box-sizing:border-box}' },
    style: { color: '#23402c', ...Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`--author-${i}`, `${i}px`])) },
    frame, name: 'Author material', visible: true, locked: false }
  const model: DocumentModel = { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
  const session = await registry.create(model, 'frame-read.glx')
  const target: Extract<ToolTarget, { kind: 'course-instance' }> = { kind: 'course-instance', surfaceId, instanceId: 'nested' }
  await gateway.beginRun({ runId: 'frame', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('frame', session.documentId, target)
  const call = (name: string, input: unknown) => gateway.execute('frame', `call-${++sequence}`, { name, input })
  return { gateway, session, target, handle, call }
}

it('puts the nested frame in the default read prefix and shares identical preview/read pages without dropping author fields', async () => {
  const f = await fixture(), before = f.session.read(), original = course(before).project.instances.nested
  expect(JSON.stringify(original).indexOf('"frame":')).toBeGreaterThan(12_000)
  const projection = readTarget(before.model, f.target)
  expect(projection).not.toBe(original)
  expect(projection).toEqual(original)
  expect(Object.keys(projection as object).slice(0, 3)).toEqual(['id', 'definitionId', 'frame'])
  expect(Object.keys(original).slice(0, 3)).toEqual(['id', 'definitionId', 'data'])
  const prefix = await f.call('read', { target: f.handle })
  expect(prefix).toMatchObject({ kind: 'read', data: { offset: 0, truncated: true } })
  if (prefix.kind !== 'read') throw new Error('Expected read')
  const first = prefix.data as { text: string; total: number; target: string }
  expect(first.text).toHaveLength(12_000)
  expect(first.text).toContain(`"frame":${JSON.stringify(original.frame)}`)
  expect(first.text.indexOf('"frame":')).toBeLessThan(first.text.indexOf('"data":'))
  const preview = await f.gateway.previewTarget('frame', f.handle, 12_000)
  expect(preview.text).toBe(first.text)
  expect(preview.nextCursor).toBeTruthy()
  let joined = preview.text, cursor = preview.nextCursor
  while (cursor) {
    const page = await f.call('read', { target: f.handle, cursor })
    if (page.kind !== 'read') throw new Error('Expected continuation read')
    const data = page.data as { text: string; offset: number }
    expect(data.offset).toBe(joined.length)
    joined += data.text
    cursor = page.nextCursor
  }
  expect(joined).toHaveLength(first.total)
  expect(JSON.parse(joined)).toEqual(original)
  expect(f.session.read()).toEqual(before)
  const frameless = structuredClone(before.model)
  if (frameless.kind !== 'course-v10') throw new Error('Expected Course V10')
  delete frameless.project.instances.nested.frame
  expect(Object.hasOwn(readTarget(frameless, f.target) as object, 'frame')).toBe(false)
  expect(readTarget(before.model, { ...f.target, dataPath: ['html'] })).toBe((original.data as { html: string }).html)
})

it('keeps the original cursor and write-handle rejection after a human changes the nested frame', async () => {
  const f = await fixture(), preview = await f.gateway.previewTarget('frame', f.handle, 12_000)
  const before = f.session.read(), model = course(before), original = model.project.instances.nested
  expect(await f.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    actor: 'human', operationId: 'human-frame', mutation: { type: 'command', command: captureComponentOperation(model.project,
      [{ type: 'frame.set', instanceId: 'nested', frame: { ...original.frame!, width: 620 } }]) } })).toMatchObject({ status: 'applied' })
  const human = f.session.read()
  expect(await f.call('read', { target: f.handle, cursor: preview.nextCursor })).toMatchObject({ kind: 'error', code: 'stale-cursor' })
  expect(await f.call('object.update', { target: f.handle, properties: { frame: { width: 900 } } }))
    .toMatchObject({ kind: 'error', code: 'target-conflict' })
  const inspected = await f.call('inspect', { target: f.handle })
  expect(inspected).toMatchObject({ kind: 'read', data: { writable: false } })
  if (inspected.kind !== 'read') throw new Error('Expected inspect')
  const readonlyTarget = (inspected.data as { target: string }).target
  expect(await f.call('object.update', { target: readonlyTarget, properties: { frame: { width: 900 } } }))
    .toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(f.session.read()).toEqual(human)
})
