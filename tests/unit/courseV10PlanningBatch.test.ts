// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { DocumentModel } from '../../src/shared/workbench/document'

const bytes = (text: string) => new TextEncoder().encode(text)
function fixture() {
  const project = createBlankCourseProjectV10('Original')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  project.instances.web = { id: 'web', definitionId: 'web', data: { html: '<p>Original</p>' },
    implementationOverride: { kind: 'source', language: 'javascript', workspace: { ownerId: 'owner', entry: 'main.js' } } }
  project.surfaces[0].childIds = ['web']
  return { kind: 'course-v10' as const, project, resources: { assets: {}, components: { owner: { 'main.js': bytes('export default { mount() { return { dispose() {} } } }') } } } }
}

it('keeps planning expectations, byte CAS and lock semantics, without mutating the input or advancing after failure', () => {
  const driver = new CourseV10Driver(), original = fixture(), before = structuredClone(original), planning = driver.beginPlanningBatch(original)
  const title = captureComponentOperation(original.project, [{ type: 'project.title.set', title: 'Planned' }])
  const first = planning.apply(title) as typeof original
  expect(() => planning.apply(title)).toThrow('变化')
  const wrongFiles = captureComponentOperation(first.project, [{ type: 'component.files.set', ownerId: 'owner', expectedFiles: {}, files: { 'main.js': bytes('wrong') } }])
  expect(() => planning.apply(wrongFiles)).toThrow('源码文件已变化')
  const locked = planning.apply(captureComponentOperation(first.project, [{ type: 'instance.patch', instanceId: 'web', patch: { locked: true } }])) as typeof original
  expect(() => planning.apply(captureComponentOperation(locked.project, [{ type: 'component.files.set', ownerId: 'owner',
    expectedFiles: locked.resources.components.owner, files: { 'main.js': bytes('changed') } }]))).toThrow('锁定')
  const last = planning.apply(captureComponentOperation(locked.project, [{ type: 'project.title.set', title: 'Still usable' }])) as typeof original
  expect(last.project.instances.web.locked).toBe(true)
  expect(last.resources.components.owner).toEqual(before.resources.components.owner)
  expect(original).toEqual(before)
  expect(last.resources.components.owner['main.js']).not.toBe(original.resources.components.owner['main.js'])
  driver.validate(last)
})

it('retains strict public apply and one atomic Session commit, including final validation and stale revisions', async () => {
  const driver = new CourseV10Driver(), original = fixture(), planning = driver.beginPlanningBatch(original)
  const edits: ComponentEdit[] = [{ type: 'project.title.set', title: 'Provisional' }, { type: 'data.set', instanceId: 'web', path: [], value: { html: 5 } }]
  const command = captureComponentOperation(original.project, edits)
  expect(() => driver.apply(original, command)).toThrow()
  expect(() => driver.beginPlanningBatch({ ...original, project: { ...original.project, title: 5 } } as unknown as DocumentModel)).toThrow()
  const candidate = planning.apply(command) as typeof original
  expect(candidate.project.title).toBe('Provisional')
  let appends = 0
  const session = await DocumentSession.create({ documentId: 'batch', epoch: 'epoch', model: original,
    binding: { kind: 'untitled', suggestedName: 'batch.glx' } }, driver,
  { async append() { appends++ }, async save() { throw new Error('unused') } })
  const baseline = session.read(), writes = appends
  const execute = (operationId: string, baseRevision: number, edits: ComponentEdit[]) => session.execute({ documentId: 'batch', epoch: 'epoch',
    operationId, actor: 'agent', baseRevision, mutation: { type: 'command', command: captureComponentOperation(original.project, edits) } })
  expect(await execute('invalid', baseline.revision, edits)).toMatchObject({ status: 'failed', code: 'invalid-operation' })
  expect(session.read().model).toEqual(baseline.model)
  expect(session.read().undoDepth).toBe(0)
  expect(appends).toBe(writes)
  const valid: ComponentEdit[] = [{ type: 'project.title.set', title: 'Committed' }, { type: 'data.set', instanceId: 'web', path: [], value: { html: '<p>Committed</p>' } }]
  expect(await execute('valid', baseline.revision, valid)).toMatchObject({ status: 'applied', revision: baseline.revision + 1 })
  expect(session.read().undoDepth).toBe(1)
  expect(appends).toBe(writes + 1)
  expect(await execute('stale-revision', baseline.revision, valid)).toMatchObject({ status: 'conflict', code: 'stale-revision' })
  expect(await execute('stale-fields', session.read().revision, valid)).toMatchObject({ status: 'conflict', code: 'component-field-conflict' })
  expect(session.read().revision).toBe(baseline.revision + 1)
})
