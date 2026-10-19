// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'

async function fixture(html = '<h1>第一处🔎</h1>\n<p>第二处🔎</p>', currentInstance?: string) {
  const project = createBlankCourseProjectV10('Current reads')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.a = { id: 'a', definitionId: WEB_DEFINITION.id, data: { html } }
  project.instances.b = { id: 'b', definitionId: WEB_DEFINITION.id, data: { html: '<h1>其他对象</h1>' } }
  project.surfaces[0].childIds = ['a', 'b']
  const session = await DocumentSession.create({ documentId: 'reading', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'read.glx' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, new CourseV10Driver(),
  { async append() {}, async save() { throw new Error('Read fixture must not save') } })
  const snapshot = () => session.read() as ComponentProjectSnapshot
  const coordinator = new ComponentProjectFileCoordinator({ async document() { return snapshot() },
    currentTarget: () => currentInstance ? `only-${currentInstance}` : undefined,
    scope: (_run, selector) => currentInstance && selector === `only-${currentInstance}` ? { kind: 'instance', instanceId: currentInstance } : { kind: 'document' },
    async apply() { throw new Error('Read fixture must not apply') }, async applyBatch() { throw new Error('Invalid inputs must not apply') }, async source() { throw new Error('No external source needed') } })
  let sequence = 0
  const path = componentProjectFiles(project, snapshot().model.resources).find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'a')!.path
  const read = async (input: object) => {
    const result = await coordinator.execute('run', `read-${++sequence}`, 'read', 'project.read', { path, ...input })
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' })
    if (result.kind !== 'read') throw new Error('Expected a project file read')
    return result.data as { basis: 'current' | 'captured'; revision: number; content?: string; nextOffset?: number;
      matches: Array<{ line: number; column: number; offset: number; excerptOffset: number; excerpt: string }> }
  }
  const human = async (edits: ComponentEdit[]) => { const current = snapshot(); await session.execute({ documentId: current.documentId,
    epoch: current.epoch, baseRevision: current.revision, operationId: `human-${++sequence}`, actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(current.model.project, edits) } }) }
  return { coordinator, session, snapshot, read, human, path, surfaceId: project.surfaces[0].id }
}

it('finds current unsaved literal content and separates captured continuation from a local current refresh', async () => {
  const h = await fixture(), first = await h.read({ query: '🔎', limit: 1 })
  expect(first).toMatchObject({ basis: 'current', revision: 0, matches: [{ line: 1, column: 8, matchLength: 2 }] })
  expect(first.matches[0].excerpt).toContain('第一处')
  await h.human([{ type: 'data.set', instanceId: 'a', path: ['html'], value: '<p>当前未保存🔎</p>\n<p>当前第二处🔎</p>' }])
  const continuation = await h.read({ query: '🔎', offset: first.nextOffset, limit: 1 })
  expect(continuation).toMatchObject({ basis: 'captured', revision: 0, currentRevision: 1, staleSnapshot: true, matches: [{ line: 2 }] })
  expect(continuation.matches[0].excerpt).toContain('第二处')
  expect(continuation.matches[0].excerpt).not.toContain('当前')
  const current = await h.read({ query: '当前', limit: 1 })
  expect(current).toMatchObject({ basis: 'current', revision: 1, matches: [{ offset: 3 }] })
  const local = await h.read({ offset: current.matches[0].excerptOffset, limit: 12, refresh: true })
  expect(local).toMatchObject({ basis: 'current', revision: 1 })
  expect(local.content).toContain('当前未保存')
  expect(h.snapshot()).toMatchObject({ dirty: true, undoDepth: 1 })
})

it('keeps observed identities on ordinary reads and permits explicit per-file natural-path refresh', async () => {
  const h = await fixture()
  await h.read({})
  await h.human([{ type: 'instance.move', instanceId: 'b', container: { kind: 'surface', surfaceId: h.surfaceId }, index: 0 }])
  expect((await h.read({})).content).toContain('第一处')
  expect((await h.read({ refresh: true })).content).toContain('其他对象')
  const context = await h.coordinator.taskTargetContext('run')
  expect(context).toMatchObject({ path: h.path, target: { kind: 'instance', instanceId: 'b' }, regionStatus: 'current-object' })
})

it('preserves explicit full source reads and returns a local read repair for an absent captured page', async () => {
  const html = `<p>${'内容'.repeat(60_000)}</p>`, h = await fixture(html)
  const result = await h.read({ full: true })
  expect(result.content).toBe(html)
  expect(result.nextOffset).toBeUndefined()
  const missing = await h.coordinator.execute('new-run', 'page', 'page', 'project.read', { path: h.path, offset: 12, limit: 20 })
  expect(missing).toMatchObject({ kind: 'error', code: 'read-page-unavailable', data: { repair: { read: [
    { tool: 'project.read', input: { path: h.path, offset: 12, refresh: true } },
  ] } } })
})


it('reports the concrete batch item and local path when content preparation fails', async () => {
  const h = await fixture()
  const path = componentProjectFiles(h.snapshot().model.project, h.snapshot().model.resources)
    .find(file => file.kind === 'style' && file.target?.kind === 'instance' && file.target.instanceId === 'a')!.path
  const result = await h.coordinator.execute('run', 'bad-style-batch', 'bad-style-batch', 'project.apply', {
    operations: [{ path, content: '[]' }, { path, content: '{' }],
  })
  expect(result).toMatchObject({ kind: 'read', data: { commit: 'not_committed', operations: [
    { kind: 'error', data: { operationIndex: 0, path } }, { kind: 'error', data: { operationIndex: 1, path } },
  ] } })
  expect(h.snapshot().revision).toBe(0)
})


it('uses the run exact target before a different recently read object when delegation omits target', async () => {
  const h = await fixture(undefined, 'a')
  const other = componentProjectFiles(h.snapshot().model.project, h.snapshot().model.resources)
    .find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'b')!
  await h.read({ path: other.path })
  expect(await h.coordinator.taskTargetContext('run')).toMatchObject({ project: 'only-a',
    target: { kind: 'instance', instanceId: 'a' }, regionStatus: 'current-object' })
})
