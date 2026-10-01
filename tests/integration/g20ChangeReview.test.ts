import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionChangeReviewService } from '../../src/main/workbench/review/ExecutionChangeReviewService'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
const version = (text: string) => `sha256:${createHash('sha256').update(Buffer.from(text)).digest('hex')}`
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-review-'))
  roots.push(root)
  const host = new DocumentHostService(path.join(root, 'host'))
  const review = new ExecutionChangeReviewService(host, path.join(root, 'review'))
  return { root, host, review }
}
function run(root: string, tools: ExecutionToolRecord[], documentPaths?: Record<string, string>): ExecutionRunRecord {
  return { schemaVersion: 1, runId: 'review-run', version: 1, input: { conversationId: 'conversation', taskId: 'task',
    instruction: '按要求修改两个文件', selection: { connection: { id: 'test', revision: 1, provider: 'test',
      protocol: 'openai-chat', baseURL: 'https://test.invalid', accountId: 'test',
      auth: { kind: 'api-key', credentialRef: 'test' }, billing: { kind: 'unknown' },
      capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' } },
      model: 'test' }, documents: [], workspaceRoot: root },
    budget: { maxRequests: 1, maxToolCalls: 10, maxContextBytes: 2000 }, status: 'completed', createdAt: 1,
    updatedAt: 2, messages: [], initialMessageCount: 0, requests: [], tools,
    ...(documentPaths ? { documentPaths } : {}) } as ExecutionRunRecord
}
function fileTool(callId: string, filename: string, before: string, after: string): ExecutionToolRecord {
  return { callId, providerCallId: callId, requestId: 'request', call: { name: 'file.write',
    input: { mode: 'replace', path: filename, expectedVersion: version(before), content: after } }, state: 'returned',
    result: { kind: 'read', data: { path: filename, operationId: callId, status: 'written', beforeVersion: version(before),
      afterVersion: version(after), saved: true, dirty: false } } }
}

it('shows receipt-backed changes, restores the verified version and enforces exact outside approval', async () => {
  const { root, review } = await setup(), filename = path.join(root, 'report.json')
  await fs.writeFile(filename, '{"answer":1}\n')
  const tool = fileTool('write-1', filename, '{"answer":1}\n', '{"answer":2}\n')
  await review.prepareFileMutation({ runId: 'review-run', callId: tool.callId, name: tool.call.name, paths: [filename] })
  await fs.writeFile(filename, '{"answer":2}\n')
  // Re-entry with the same call ID must never replace the original before snapshot.
  await review.prepareFileMutation({ runId: 'review-run', callId: tool.callId, name: tool.call.name, paths: [filename] })
  await review.completeFileMutation({ runId: 'review-run', callId: tool.callId, result: tool.result! })
  const record = run(root, [tool])
  const page = await review.inspect(record, { limit: 1 })
  expect(page.files).toEqual([{ path: filename, entryIds: ['write-1'] }])
  expect(page.entries[0]).toMatchObject({ status: 'applied', availability: 'ready', beforeVersion: version('{"answer":1}\n'),
    afterVersion: version('{"answer":2}\n') })
  expect(await review.rollback(record, 'write-1', { workspaceRoot: root, permission: 'workspace' })).toMatchObject({ status: 'reverted', saved: true })
  expect(await fs.readFile(filename, 'utf8')).toBe('{"answer":1}\n')
  expect(await review.rollback(record, 'write-1', { workspaceRoot: root, permission: 'workspace' })).toMatchObject({ status: 'conflict' })
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-review-outside-'))
  roots.push(outside)
  const outsideFile = path.join(outside, 'report.txt')
  await fs.writeFile(outsideFile, 'before')
  const outsideTool = fileTool('outside-edit', outsideFile, 'before', 'after')
  await review.prepareFileMutation({ runId: 'review-run', callId: outsideTool.callId, name: outsideTool.call.name, paths: [outsideFile] })
  await fs.writeFile(outsideFile, 'after')
  await review.completeFileMutation({ runId: 'review-run', callId: outsideTool.callId, result: outsideTool.result! })
  const outsideRecord = run(root, [outsideTool])
  await expect(review.rollback(outsideRecord, outsideTool.callId, { workspaceRoot: root, permission: 'workspace',
    approvedOutsidePaths: [outside] })).rejects.toThrow('明确授权')
  expect(await fs.readFile(outsideFile, 'utf8')).toBe('after')
  expect(await review.rollback(outsideRecord, outsideTool.callId, { workspaceRoot: root, permission: 'workspace',
    approvedOutsidePaths: [outsideFile] })).toMatchObject({ status: 'reverted' })
})

it('rejects a later user edit and preserves a newly created file before removing it', async () => {
  const { root, review } = await setup(), filename = path.join(root, 'notes.txt')
  await fs.writeFile(filename, 'before')
  const tool = fileTool('write-2', filename, 'before', 'agent')
  await review.prepareFileMutation({ runId: 'review-run', callId: tool.callId, name: tool.call.name, paths: [filename] })
  await fs.writeFile(filename, 'agent')
  await review.completeFileMutation({ runId: 'review-run', callId: tool.callId, result: tool.result! })
  await fs.writeFile(filename, 'human')
  expect((await review.inspect(run(root, [tool]))).entries[0]).toMatchObject({ availability: 'conflict' })
  expect(await review.rollback(run(root, [tool]), tool.callId, { workspaceRoot: root, permission: 'workspace' }))
    .toMatchObject({ status: 'conflict' })
  expect(await fs.readFile(filename, 'utf8')).toBe('human')

  const created = path.join(root, 'new.txt'), creation = { ...fileTool('write-create', created, '', 'created'),
    call: { name: 'file.write', input: { mode: 'create', path: created, content: 'created' } },
    result: { kind: 'read' as const, data: { path: created, saved: true, afterVersion: version('created'),
      operation: { items: [{ status: 'success', targetPath: created }] } } } }
  await review.prepareFileMutation({ runId: 'review-run', callId: creation.callId, name: creation.call.name, paths: [created] })
  await fs.writeFile(created, 'created')
  await review.completeFileMutation({ runId: 'review-run', callId: creation.callId, result: creation.result })
  const reverted = await review.rollback(run(root, [creation]), creation.callId, { workspaceRoot: root, permission: 'workspace' })
  expect(reverted.status, JSON.stringify(reverted)).toBe('reverted')
  await expect(fs.access(created)).rejects.toThrow()
  const preserved = reverted.message.slice('新建文件已移走并保全于 '.length)
  expect(await fs.readFile(preserved, 'utf8')).toBe('created')

  const blank = path.join(root, 'blank.txt'), blankTool: ExecutionToolRecord = {
    callId: 'create-blank', providerCallId: 'create-blank', requestId: 'request',
    call: { name: 'file.create', input: { name: 'blank.txt', kind: 'text' } }, state: 'returned',
    result: { kind: 'read', data: { path: blank, operation: { items: [{ status: 'success', targetPath: blank }] } } },
  }
  await review.prepareFileMutation({ runId: 'review-run', callId: blankTool.callId, name: blankTool.call.name,
    paths: [blank], toolInput: blankTool.call.input })
  await fs.writeFile(blank, '')
  await review.completeFileMutation({ runId: 'review-run', callId: blankTool.callId, result: blankTool.result! })
  expect(await review.rollback(run(root, [blankTool]), blankTool.callId,
    { workspaceRoot: root, permission: 'workspace' })).toMatchObject({ status: 'reverted' })
  await expect(fs.access(blank)).rejects.toThrow()

  const copied: ExecutionToolRecord = { callId: 'copy-many', providerCallId: 'copy-many', requestId: 'request',
    call: { name: 'file.copy', input: { sources: ['a.txt', 'b.txt'], destination: 'archive' } }, state: 'returned',
    result: { kind: 'read', data: { operation: { status: 'partial', items: [
      { status: 'success', sourcePath: path.join(root, 'a.txt'), targetPath: path.join(root, 'archive', 'a.txt') },
      { status: 'failed', sourcePath: path.join(root, 'b.txt') },
    ] } } } }
  const page = await review.inspect(run(root, [copied]), { limit: 1 })
  expect(page).toMatchObject({ total: 2, nextOffset: 1,
    files: [{ path: path.join(root, 'archive', 'a.txt'), entryIds: ['copy-many:0'] }] })
  expect((await review.inspect(run(root, [copied]), { offset: 1 })).entries[0])
    .toMatchObject({ entryId: 'copy-many:1', status: 'failed', path: path.join(root, 'b.txt') })
  const external: ExecutionToolRecord = { callId: 'browser-submit', providerCallId: 'browser-submit', requestId: 'request',
    call: { name: 'mcp.invoke', input: { name: 'browser_click', arguments: {} } }, state: 'returned',
    result: { kind: 'read', data: { status: 'unknown', message: '外部页面提交回执未确认' } } }
  expect((await review.inspect(run(root, [copied, external]), { offset: 2 })).entries[0])
    .toMatchObject({ entryId: 'browser-submit', status: 'unknown', availability: 'external' })
})

it('uses the current document History head and refuses to undo a later human edit', async () => {
  const { root, host, review } = await setup()
  const session = await host.registry.create({ kind: 'text', source: 'start', resources: { assets: {}, components: {} } }, 'draft.txt')
  const initial = session.read()
  const applied = await session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision,
    operationId: 'agent-edit', actor: 'agent', runId: 'review-run', mutation: { type: 'command',
      command: { type: 'markdown.replace', source: 'agent' } } })
  expect(applied.status).toBe('applied')
  const tool: ExecutionToolRecord = { callId: 'agent-call', providerCallId: 'agent-call', requestId: 'request',
    call: { name: 'text.replace', input: {} }, state: 'returned', result: { kind: 'document-operation', result: applied,
      affected: ['document'] } }
  const record = run(root, [tool])
  expect((await review.inspect(record)).entries[0]).toMatchObject({ availability: 'ready', source: 'host-document' })
  expect(await review.rollback(record, 'agent-call', { workspaceRoot: root, permission: 'workspace' }))
    .toMatchObject({ status: 'reverted', saved: false })
  expect(session.read().model).toMatchObject({ source: 'start' })

  const changed = await session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: session.read().revision,
    operationId: 'agent-edit-2', actor: 'agent', runId: 'review-run', mutation: { type: 'command',
      command: { type: 'markdown.replace', source: 'agent again' } } })
  const later = await session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: session.read().revision,
    operationId: 'human-edit', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'human' } } })
  expect(later.status).toBe('applied')
  const second = { ...tool, callId: 'agent-call-2', result: { kind: 'document-operation' as const, result: changed, affected: ['document'] } }
  expect((await review.inspect(run(root, [second]))).entries[0]).toMatchObject({ availability: 'conflict' })
  expect(await review.rollback(run(root, [second]), second.callId, { workspaceRoot: root, permission: 'workspace' }))
    .toMatchObject({ status: 'conflict' })
  expect(session.read().model).toMatchObject({ source: 'human' })
})

it('streams a large UTF-8 range and preserves complete before bytes for real rollback', async () => {
  const { AgentFileText } = await import('../../src/main/workbench/execution/AgentFileText')
  const { readUtf8File } = await import('../../src/main/workbench/readUtf8File')
  const { root, host, review } = await setup(), filename = path.join(root, 'large.txt')
  const before = '\ufeff' + '中文😀\r\n'.repeat(2_000_000), after = before + 'changed'
  await fs.writeFile(filename, before)
  expect(Buffer.byteLength(before)).toBeGreaterThan(16 * 1024 * 1024)
  const text = new AgentFileText(host), context = { runId: 'review-run', workspaceRoot: root, permission: 'workspace' as const }
  const page = await text.read(context, filename, 64)
  expect(page.data).toMatchObject({ text: before.slice(0, 63), total: before.length, dirty: false, truncated: true })
  const tool = fileTool('large-edit', filename, before, after)
  await review.prepareFileMutation({ runId: 'review-run', callId: tool.callId, name: 'file.patch', paths: [filename] })
  const capture = await review.store.read('review-run', tool.callId)
  expect(capture?.before.kind === 'file' && capture.before.blob?.byteLength).toBe(Buffer.byteLength(before))
  expect(JSON.stringify(capture).length).toBeLessThan(10_000)
  const changed = await text.patch(context, filename, version(before), 'impossible-unique-marker', '', undefined, 'invalid').catch(() => null)
  expect(changed).toBeNull()
  await text.write(context, filename, after, 'replace', version(before), 'large-edit')
  await review.completeFileMutation({ runId: 'review-run', callId: tool.callId, result: tool.result! })
  expect(await review.rollback(run(root, [tool]), tool.callId, { workspaceRoot: root, permission: 'workspace' })).toMatchObject({ status: 'reverted' })
  expect((await readUtf8File(filename, { limit: 64 })).version).toBe(version(before))
  const opened = await host.open(filename)
  const active = await text.read(context, filename, 64)
  expect(active.data).toMatchObject({ text: before.slice(0, 63), total: before.length })
  await host.registry.close(opened.documentId)
})
