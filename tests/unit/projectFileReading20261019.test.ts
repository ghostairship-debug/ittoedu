import { testContainerInstance } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
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
  testContainerInstance(project, 0).childIds = ['a', 'b']
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
  return { coordinator, session, snapshot, read, human, path, surfaceId: componentSurfaces(project)[0].id }
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

it('pages an explicit full source request without losing the fixed source, and repairs an absent captured page', async () => {
  const html = `<p>${'内容'.repeat(60_000)}</p>`, h = await fixture(html)
  const result = await h.read({ full: true })
  expect(result.content!.length).toBeLessThan(html.length)
  expect(result).toMatchObject({ complete: false, requestedFull: true, revision: 0 })
  let combined = result.content!, page = result
  await h.human([{ type: 'data.set', instanceId: 'a', path: ['html'], value: '<p>new human source</p>' }])
  while (page.nextOffset !== undefined) {
    page = await h.read({ offset: page.nextOffset, full: true })
    expect(page).toMatchObject({ basis: 'captured', revision: 0, currentRevision: 1, staleSnapshot: true })
    combined += page.content
  }
  expect(combined).toBe(html)
  const missing = await h.coordinator.execute('new-run', 'page', 'page', 'project.read', { path: h.path, offset: 12, limit: 20 })
  expect(missing).toMatchObject({ kind: 'error', code: 'read-page-unavailable', data: { repair: { read: [
    { tool: 'project.read', input: { path: h.path, offset: 12, refresh: true } },
  ] } } })
})

it.each([undefined, 1, 1000])('keeps a content continuation when an unchanged directory is browsed (limit %s)', async limit => {
  const h = await fixture(), first = await h.read({ query: '🔎', limit: 1 })
  expect(first.nextOffset).toBeGreaterThan(0)
  if (limit !== undefined) {
    const listed = await h.coordinator.execute('run', `list-${limit}`, 'list', 'project.list', { limit })
    expect(listed).toMatchObject({ kind: 'read', data: { revision: 0, currentRevision: 0 } })
  }
  const continuation = await h.read({ query: '🔎', offset: first.nextOffset, limit: 1 })
  expect(continuation).toMatchObject({ basis: 'captured', revision: 0, matches: [{ line: 2 }] })
  expect(continuation.matches[0].excerpt).toContain('第二处')
  expect(h.snapshot()).toMatchObject({ revision: 0, undoDepth: 0 })
})

it('keeps a scoped content continuation when its directory returns the same file', async () => {
  const html = '<h1>abcdefghij</h1><p>xyz</p>'
  const h = await fixture(html, 'a'), first = await h.read({ project: 'only-a', limit: 8 })
  expect(await h.coordinator.execute('run', 'scoped-list', 'list', 'project.list', { project: 'only-a', limit: 1000 }))
    .toMatchObject({ kind: 'read' })
  const continuation = await h.read({ project: 'only-a', offset: first.nextOffset, limit: 8 })
  expect(continuation).toMatchObject({ basis: 'captured', revision: 0 })
  expect(first.content! + continuation.content!).toBe(html.slice(0, 16))
})

it('retains an observed object outside a short unchanged directory page', async () => {
  const h = await fixture()
  await h.read({})
  const listed = await h.coordinator.execute('run', 'short-list', 'list', 'project.list', { limit: 1 })
  expect(listed).toMatchObject({ kind: 'read', data: { files: [expect.objectContaining({ path: expect.not.stringMatching(/\.content\.html$/) })] } })
  const observed = h.coordinator.captureFile('run', h.snapshot(), h.path, true)
  expect(observed.file.target).toEqual({ kind: 'instance', instanceId: 'a' })
  expect(observed.file.content).toContain('第一处')
})

it('applies an exact edit after a short directory page and retains Session conflict protection', async () => {
  const h = await fixture()
  await h.human([{ type: 'project.theme.set', theme: { css: ':root { --accent: #112233; }' } }])
  const file = componentProjectFiles(h.snapshot().model.project, h.snapshot().model.resources)
    .find(value => value.binding?.kind === 'theme')!
  expect(await h.coordinator.execute('run', 'read-theme', 'read', 'project.read', { path: file.path }))
    .toMatchObject({ kind: 'read', data: { content: ':root { --accent: #112233; }' } })
  expect(await h.coordinator.execute('run', 'list-before-edit', 'list', 'project.list', { limit: 1 }))
    .toMatchObject({ kind: 'read', data: { files: [expect.not.objectContaining({ path: file.path })] } })
  const apply = (operationId: string, old: string, next: string) => h.coordinator.execute('run', operationId, operationId,
    'project.apply', { path: file.path, edits: [{ old, new: next }] },
    async (_run, operationId, _digest, baseline, request) => {
      if (request.intent !== 'canonical') throw new Error('Theme edits must use the canonical Session')
      const receipt = await h.session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId,
        baseRevision: baseline.revision, actor: 'agent',
        mutation: { type: 'command', command: captureComponentOperation(baseline.model.project, request.edits) } })
      return { commit: receipt.status === 'applied' ? 'committed' : 'not_committed', usability: 'usable', delivery: 'not_requested',
        input: request, diagnostics: [], insertedIds: [], receipt }
    })
  expect(await apply('exact-theme-edit', '#112233', '#445566'))
    .toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } })
  expect(h.snapshot().model.project.theme?.css).toBe(':root { --accent: #445566; }')
  await h.coordinator.execute('run', 'reread-theme', 'read', 'project.read', { path: file.path })
  await h.human([{ type: 'project.theme.set', theme: { css: ':root { --accent: #778899; }' } }])
  expect(await apply('stale-theme-edit', '#445566', '#ffffff'))
    .toMatchObject({ kind: 'read', data: { commit: 'not_committed', receipt: { status: 'conflict' } } })
  expect(h.snapshot().model.project.theme?.css).toBe(':root { --accent: #778899; }')
})

it('invalidates old content pages when a fresh directory follows a human revision and path reorder', async () => {
  const h = await fixture(), first = await h.read({ limit: 8 })
  await h.human([{ type: 'instance.move', instanceId: 'b', container: { kind: 'surface', surfaceId: h.surfaceId }, index: 0 }])
  expect(await h.coordinator.execute('run', 'changed-list', 'list', 'project.list', { limit: 1000 }))
    .toMatchObject({ kind: 'read', data: { revision: 1, currentRevision: 1 } })
  expect(await h.coordinator.execute('run', 'old-page', 'read', 'project.read', { path: h.path, offset: first.nextOffset }))
    .toMatchObject({ kind: 'error', code: 'read-page-unavailable' })
  expect((await h.read({ refresh: true })).content).toContain('其他对象')
})

it('reports a fixed directory snapshot as stale after a human edit instead of presenting it as current', async () => {
  const h = await fixture()
  expect(await h.coordinator.execute('run', 'directory-first', 'list', 'project.list', { limit: 1 }))
    .toMatchObject({ kind: 'read', data: { revision: 0, currentRevision: 0, nextOffset: 1 } })
  await h.human([{ type: 'data.set', instanceId: 'a', path: ['html'], value: '<p>目录后的人工修改</p>' }])
  expect(await h.coordinator.execute('run', 'directory-next', 'list', 'project.list', { offset: 1, limit: 1 }))
    .toMatchObject({ kind: 'read', data: { revision: 0, currentRevision: 1, staleSnapshot: true } })
  expect(h.snapshot()).toMatchObject({ revision: 1, dirty: true, undoDepth: 1 })
})

it('never preserves a continuation when a directory is refreshed under a new document epoch', async () => {
  const h = await fixture()
  let epoch = h.snapshot().epoch
  const coordinator = new ComponentProjectFileCoordinator({ async document() { return { ...h.snapshot(), epoch } },
    async apply() { throw new Error('Epoch test must not apply') }, async source() { throw new Error('No external source needed') } })
  expect(await coordinator.execute('run', 'epoch-read', 'read', 'project.read', { path: h.path, limit: 4 }))
    .toMatchObject({ kind: 'read', data: { nextOffset: 4 } })
  epoch = 'reopened-document'
  expect(await coordinator.execute('run', 'epoch-continuation', 'read', 'project.read', { path: h.path, offset: 4 }))
    .toMatchObject({ kind: 'error', code: 'project-changed' })
  expect(await coordinator.execute('run', 'epoch-list', 'list', 'project.list', { limit: 1000 }))
    .toMatchObject({ kind: 'read' })
  expect(await coordinator.execute('run', 'after-epoch-list', 'read', 'project.read', { path: h.path, offset: 4 }))
    .toMatchObject({ kind: 'error', code: 'read-page-unavailable' })
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
