// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { selectionReference, captureSelection } from '../../src/renderer/workbench/SelectionContextController'
import { FileGrepPages } from '../../src/main/workbench/execution/FileGrepPages'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 30 }) })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'operation-admission-')); roots.push(root)
  const workspace = path.join(root, 'workspace'); await mkdir(workspace)
  const host = new DocumentHostService(path.join(root, 'journal'))
  return { root, workspace, host, files: new AgentFileService(host) }
}
it('keeps a selected target as focus, while an explicit selection restriction remains a real edit boundary and can save current content', async () => {
  const { host } = await fixture()
  const snapshot = await host.internalAPI.create({ kind: 'markdown', source: '甲乙丙丁', resources: { assets: {}, components: {} } }, 'focus.md')
  const capture = captureSelection(snapshot, [{ kind: 'markdown-range', from: 1, to: 2 }], '乙')
  expect(selectionReference(capture, true)).toMatchObject({ selection: capture.targets, writable: [{ kind: 'document' }] })
  const narrow = selectionReference(capture, true, true)
  await host.tools.beginRun({ runId: 'narrow', actor: 'agent', documents: [narrow] })
  const whole = await host.tools.issueTarget('narrow', snapshot.documentId, { kind: 'document' })
  expect(await host.tools.execute('narrow', 'attempt-wide', { name: 'text.replace', input: { target: whole, content: '越权' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await host.tools.currentDeliveryDocument('narrow', whole)).toMatchObject({ documentId: snapshot.documentId, revision: snapshot.revision })
  expect(host.registry.get(snapshot.documentId).read().model).toMatchObject({ source: '甲乙丙丁' })
})
it('parses an authorized undisclosed batch with canonical registrations and commits one undoable transaction', async () => {
  const { host } = await fixture()
  const project = createBlankCourseProjectV10('原名称')
  const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'batch.glx')
  await host.tools.beginRun({ runId: 'batch-run', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }] }] })
  const target = await host.tools.issueTarget('batch-run', snapshot.documentId, { kind: 'document' })
  expect((await host.tools.describeRun('batch-run')).some(tool => tool.name === 'course.configure')).toBe(false)
  const input = { operations: [{ name: 'course.configure', input: { target, settings: { title: '统一名称' } } }] }
  expect(await host.tools.preflightBatch('batch-run', input)).toBeNull()
  expect(await host.tools.execute('batch-run', 'one-batch', { name: 'batch', input })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(host.registry.get(snapshot.documentId).read()).toMatchObject({ model: { project: { title: '统一名称' } }, undoDepth: 1 })
})
it('binds outside source approval to the original operation lease, and admits a new operation after reopen without widening the run', async () => {
  const { root, workspace, host, files } = await fixture()
  const filename = path.join(root, 'outside.md'); await writeFile(filename, '初始原文')
  const snapshot = await host.open(filename), session = host.registry.get(snapshot.documentId)
  await host.tools.beginRun({ runId: 'external', actor: 'external', documents: [{ documentId: snapshot.documentId, writable: [] }], fileAccess: { permission: 'workspace', workspaceRoot: workspace } })
  const call = { name: 'file.patch', input: { path: filename, oldText: '初始', newText: '迟到' } }
  const oldOperation = host.tools.operationIdentity('external', 'before-stop')
  host.tools.captureHostOperation('external', oldOperation, call)
  await host.tools.stopRunDocument('external', snapshot.documentId)
  await host.tools.attachRunDocument('external', snapshot.documentId, false)
  const context = { runId: 'external', workspaceRoot: workspace, permission: 'workspace' as const, readOnlyRoots: [root], approvedOutsidePaths: [filename] }
  await expect(files.execute(context, 'file.patch', call.input, oldOperation)).rejects.toThrow('停止')
  expect(session.read().model).toMatchObject({ source: '初始原文' })
  const operationId = host.tools.operationIdentity('external', 'after-reopen')
  const input = { path: filename, oldText: '初始', newText: '新操作' }
  const applied = await files.execute(context, 'file.patch', input, operationId)
  expect(applied.data).toMatchObject({ operationId, status: 'applied', saved: false, documentResult: { operationId } })
  expect(session.read()).toMatchObject({ model: { source: '新操作原文' }, undoHead: { actor: 'external', operationId } })
  expect(await host.tools.attachRunDocument('external', snapshot.documentId, false)).toBe(false)
  await expect(files.execute(context, 'file.patch', { ...input, newText: '不同载荷' }, operationId)).rejects.toThrow('同一调用编号')
  await host.tools.stopRunDocument('external', snapshot.documentId)
  expect(await host.tools.lookup('external', 'after-reopen', { name: 'file.patch', input })).toMatchObject({ kind: 'document-operation', result: { operationId, status: 'applied' } })
})
it('returns the actual far-right multiline match with explicit UTF-16 offsets and a version', async () => {
  const source = '头😀' + '前'.repeat(500) + '命中\n下一行' + '后'.repeat(400)
  const query = '命中\n下一行', pages = new FileGrepPages()
  const result = await pages.search({ runId: 'grep', root: '/fixture.txt', kind: 'file', query, limit: 3,
    verifyDirectory: async value => value, readFile: async () => ({ source, version: 'immutable-v1' }) })
  const match = result.matches[0]!
  expect(match.excerpt).toContain(query)
  expect(match).toMatchObject({ offset: source.indexOf(query), matchLength: query.length, offsetUnit: 'utf-16-code-unit', version: 'immutable-v1' })
  expect(source.slice(match.offset, match.offset + match.matchLength)).toBe(query)
  expect(source.slice(match.excerptOffset, match.excerptOffset + match.excerpt.length)).toBe(match.excerpt)
})
