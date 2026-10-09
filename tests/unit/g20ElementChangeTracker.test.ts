// @vitest-environment node
import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { createTableData } from '../../src/components/table/data'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { continueDocumentTargets } from '../../src/main/workbench/execution/continuationTargets'
import { plainDocumentText } from '../../src/shared/document/content'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { ElementChangeTracker } from '../../src/main/workbench/execution/ElementChangeTracker'
import type { DocumentCommand } from '../../src/shared/workbench/document'

async function fixture() {
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch',
    model: { kind: 'markdown', source: 'P one tail', resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: 'card.md' } }, new MarkdownDriver(), {
      append: async () => {}, save: async () => { throw new Error('This fixture does not save files') },
    })
  const change = async (command: DocumentCommand, runId?: string) => {
    const result = await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: session.read().revision,
      operationId: crypto.randomUUID(), actor: runId ? 'agent' : 'human', ...(runId ? { runId } : {}), mutation: { type: 'command', command } })
    expect(result.status).toBe('applied')
  }
  const text = () => (session.read().model as { source: string }).source
  const tracker = (runId: string, to: number, conversationId = 'card') => {
    const value = new ElementChangeTracker(conversationId, 'doc', { kind: 'markdown-range', from: 2, to }, session, session.read())
    value.bindRun(runId); return value
  }
  return { session, change, text, tracker }
}

it('successive card runs undo and redo in order while preserving unrelated human edits', async () => {
  const f = await fixture(), first = f.tracker('first', 5)
  await f.change({ type: 'markdown.splice', from: 2, to: 5, text: 'second' }, 'first'); first.finish()
  const second = f.tracker('second', 8)
  await f.change({ type: 'markdown.splice', from: 2, to: 8, text: 'third' }, 'second')
  await f.change({ type: 'markdown.splice', from: 2, to: 7, text: 'last' }, 'second'); second.finish()
  await f.change({ type: 'markdown.splice', from: 0, to: 0, text: 'X' })
  expect((await first.revert('a', 'undo')).status).toBe('unavailable')
  expect((await second.revert('b', 'undo')).status).toBe('applied'); expect(f.text()).toBe('XP second tail')
  expect((await first.revert('a', 'undo')).status).toBe('applied'); expect(f.text()).toBe('XP one tail')
  expect((await first.revert('a', 'redo')).status).toBe('applied'); expect(f.text()).toBe('XP second tail')
  expect((await second.revert('b', 'redo')).status).toBe('applied'); expect(f.text()).toBe('XP last tail')
})

it('does not revive a card inverse after a human overwrites its location even if identical text is restored', async () => {
  const f = await fixture(), first = f.tracker('first', 5)
  await f.change({ type: 'markdown.splice', from: 2, to: 5, text: 'second' }, 'first'); first.finish()
  const second = f.tracker('second', 8)
  await f.change({ type: 'markdown.splice', from: 2, to: 8, text: 'last' }, 'second'); second.finish()
  await f.change({ type: 'markdown.splice', from: 2, to: 6, text: 'human' })
  await f.change({ type: 'markdown.splice', from: 2, to: 7, text: 'last' })
  expect((await second.revert('b', 'undo')).status).toBe('unavailable')
  expect((await first.revert('a', 'undo')).status).toBe('unavailable')
  expect(f.text()).toBe('P last tail')
})

it('does not use a different card conversation as inverse provenance', async () => {
  const f = await fixture(), first = f.tracker('first', 5)
  await f.change({ type: 'markdown.splice', from: 2, to: 5, text: 'second' }, 'first'); first.finish()
  const other = f.tracker('other', 8, 'another-card')
  await f.change({ type: 'markdown.splice', from: 2, to: 8, text: 'last' }, 'other'); other.finish()
  expect((await other.revert('b', 'undo')).status).toBe('applied')
  expect((await first.revert('a', 'undo')).status).toBe('unavailable')
})

it('releases an earlier inverse when the later run finishes with no net text change', async () => {
  const f = await fixture(), first = f.tracker('first', 5)
  await f.change({ type: 'markdown.splice', from: 2, to: 5, text: 'second' }, 'first'); first.finish()
  const second = f.tracker('second', 8)
  await f.change({ type: 'markdown.splice', from: 2, to: 8, text: 'temporary' }, 'second')
  await f.change({ type: 'markdown.splice', from: 2, to: 11, text: 'second' }, 'second'); second.finish()
  expect(second.view('b').state).toBe('none')
  expect((await first.revert('a', 'undo')).status).toBe('applied')
  expect(f.text()).toBe('P one tail')
})


it('reverts the exact Markdown fragments in one History operation while preserving human edits in the source gap', async () => {
  const driver = new MarkdownDriver(), registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No saves') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode('- 甲\n- 乙')), 'fragments.md')
  const target: Extract<ToolTarget, { kind: 'text-selection' }> = { kind: 'text-selection', fragments: [
    { target: { kind: 'markdown-range', from: 2, to: 3 } }, { target: { kind: 'markdown-range', from: 6, to: 7 }, separatorBefore: '\n' },
  ] }
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  await gateway.beginRun({ runId: 'fragment-run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const tracker = new ElementChangeTracker('card', session.documentId, target, session, session.read()); tracker.bindRun('fragment-run')
  const handle = await gateway.issueTarget('fragment-run', session.documentId, target)
  expect(await gateway.execute('fragment-run', 'replace', { name: 'text.replace', input: { target: handle, content: '新甲\n新乙' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  tracker.finish()
  expect(session.read()).toMatchObject({ undoDepth: 1, model: { source: '- 新甲\n- 新乙' } })
  let snapshot = session.read()
  await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.splice', from: 5, to: 6, text: '+' } } })
  expect(tracker.view('submission')).toMatchObject({ state: 'applied', epoch: session.read().epoch, revision: session.read().revision, content: '新甲\n新乙', target: { fragments: [
    { target: { from: 2, to: 4 } }, { target: { from: 7, to: 9 } },
  ] } })
  snapshot = session.read()
  expect(await tracker.revert('submission', 'undo')).toMatchObject({ status: 'applied', change: { state: 'undone', content: '甲\n乙' } })
  expect(session.read()).toMatchObject({ revision: snapshot.revision + 1, undoDepth: snapshot.undoDepth + 1, model: { source: '- 甲\n+ 乙' } })
  snapshot = session.read()
  expect(await tracker.revert('submission', 'redo')).toMatchObject({ status: 'applied', change: { state: 'applied', content: '新甲\n新乙' } })
  expect(session.read()).toMatchObject({ revision: snapshot.revision + 1, undoDepth: snapshot.undoDepth + 1, model: { source: '- 新甲\n+ 新乙' } })
  tracker.dispose()
})

it('reverts separate Flow rich-text fragments as one canonical batch and keeps a human frame edit', async () => {
  const project = createBlankCourseProjectV10('Flow fragments'), surfaceId = project.surfaces[0].id
  project.definitions['guoling.text'] = { id: 'guoling.text', role: 'mixed', title: '正文', implementation: { kind: 'builtin', key: 'guoling.text' } }
  for (const [id, text] of [['a', '前甲后'], ['b', '前乙后']]) {
    project.instances[id] = { id, definitionId: 'guoling.text', data: JSON.parse(JSON.stringify(createTextComponentData(text))), frame: { width: 400, height: 80, transform: [1, 0, 0, 1, 20, 40] } }
    project.surfaces[0].childIds.push(id)
  }
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No saves') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'flow.h5lesson')
  const target: Extract<ToolTarget, { kind: 'text-selection' }> = { kind: 'text-selection', fragments: ['a', 'b'].map((instanceId, index) => ({
    target: { kind: 'course-instance', surfaceId, instanceId, dataPath: ['content'], from: 1, to: 2 }, ...(index ? { separatorBefore: '\n' } : {}),
  })) }
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  await gateway.beginRun({ runId: 'flow-fragment', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const tracker = new ElementChangeTracker('card', session.documentId, target, session, session.read()); tracker.bindRun('flow-fragment')
  const handle = await gateway.issueTarget('flow-fragment', session.documentId, target)
  expect(await gateway.execute('flow-fragment', 'replace', { name: 'text.replace', input: { target: handle, content: '<b>新甲</b><br><i>新乙</i>', format: 'html' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  tracker.finish()
  const snapshot = session.read(); if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(snapshot.model.project, [{ type: 'frame.set', instanceId: 'a', frame: { ...snapshot.model.project.instances.a.frame!, width: 999 } }]) } })
  const before = session.read()
  expect(await tracker.revert('submission', 'undo')).toMatchObject({ status: 'applied', change: { state: 'undone' } })
  const after = session.read(); if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(after.undoDepth).toBe(before.undoDepth + 1); expect(after.revision).toBe(before.revision + 1)
  expect(after.model.project.instances.a.data).toEqual(project.instances.a.data); expect(after.model.project.instances.b.data).toEqual(project.instances.b.data)
  expect(after.model.project.instances.a.frame?.width).toBe(999)
  expect(await tracker.revert('submission', 'redo')).toMatchObject({ status: 'applied', change: { state: 'applied' } })
  const redone = session.read(); if (redone.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(plainDocumentText(textComponentDataSchema.parse(redone.model.project.instances.a.data).content)).toBe('前新甲后')
  expect(redone.model.project.instances.a.frame?.width).toBe(999)
  tracker.dispose()
})

it('follows only the acknowledged table cell through its string-to-rich carrier upgrade', async () => {
  const project = createBlankCourseProjectV10('Table carrier'), surfaceId = project.surfaces[0].id
  project.definitions['guoling.table'] = { id: 'guoling.table', role: 'mixed', title: '表格', implementation: { kind: 'builtin', key: 'guoling.table' } }
  const data = createTableData({ rows: 1, columns: 1 }); data.rows[0].cells[0].text = '前OLD后'
  project.instances.a = { id: 'a', definitionId: 'guoling.table', data: JSON.parse(JSON.stringify(data)) }; project.surfaces[0].childIds.push('a')
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No saves') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'table.h5lesson')
  const target: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'a', dataPath: ['rows', '0', 'cells', '0', 'text'], from: 1, to: 4 }
  const before = session.read(), gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  const reference = { documentId: session.documentId, epoch: before.epoch, revision: before.revision, writable: [target], selection: [target] }
  await gateway.beginRun({ runId: 'table-upgrade', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const tracker = new ElementChangeTracker('card', session.documentId, target, session, before); tracker.bindRun('table-upgrade')
  const handle = await gateway.issueTarget('table-upgrade', session.documentId, target)
  expect(await gateway.execute('table-upgrade', 'upgrade', { name: 'text.replace', input: { target: handle, content: '<b>LONG</b>', format: 'html' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  tracker.finish()
  expect(tracker.view('submission')).toMatchObject({ state: 'applied', target: { dataPath: ['rows', '0', 'cells', '0', 'content'], from: 1, to: 5 } })
  expect((await continueDocumentTargets(session, reference, new Set(['table-upgrade']))).selection[0]).toMatchObject({ dataPath: ['rows', '0', 'cells', '0', 'content'], from: 1, to: 5 })
  expect(await tracker.revert('submission', 'undo')).toMatchObject({ status: 'applied' })
  tracker.dispose()
})
