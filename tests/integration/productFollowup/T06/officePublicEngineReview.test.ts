// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionChangeReviewService } from '../../../../src/main/workbench/review/ExecutionChangeReviewService'
import { applyOfficeContent, inspectOfficeContent } from '../../../../src/main/workbench/office/OfficeContentService'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../../../src/shared/workbench/modelProvider'

const selection: ModelSelection = { model: 'local-office-review', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' } } }
function complete(request: ModelRequest, name?: string, input?: unknown): Extract<ModelEvent, { type: 'response.completed' }> {
  const toolCalls = name ? [{ id: `call-${request.requestId}`, name, argumentsText: JSON.stringify(input) }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`, actualModel: selection.model,
    nativeResponse: {}, finishReason: name ? 'tool_calls' : 'stop', toolCalls,
    assistant: { role: 'assistant', content: name ? '' : '已修改', ...(name ? { tool_calls: toolCalls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}

it('default Office catalog edits through public Gateway and Engine receipts preserve binary before after for rollback and later human CAS conflict', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T06-office-public-'))
  try {
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
    const filename = path.join(workspace, 'lesson.docx')
    const original = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [
      { type: 'paragraph', text: 'Original teacher paragraph' }, { type: 'paragraph', text: 'Keep unrelated paragraph' } ] })
    await fs.writeFile(filename, original.bytes)
    const host = new DocumentHostService(path.join(directory, 'documents'))
    // Main's real Office adapter behind the public Gateway; no fake receipts or manually called review hooks.
    host.tools.configureHostServices({ office: { execute: async ({ grant, operationId, name, input, approvedPaths, assertActive }) => {
      const access = grant.fileAccess!
      const result = await host.agentFiles.executeOffice({ runId: grant.runId, workspaceRoot: access.workspaceRoot!, permission: access.permission,
        conversationHome: access.conversationHome, conversationHomeRoot: access.conversationHomeRoot, approvedOutsidePaths: approvedPaths, assertActive }, name, input, operationId)
      return { kind: 'read', data: result.data }
    } } })
    const review = new ExecutionChangeReviewService(host, path.join(directory, 'review'))
    const runs = new ExecutionRunStore(path.join(directory, 'runs'))
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      expect(request.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(['office.inspect', 'office.create', 'office.edit']))
      if (++turn === 1) yield complete(request, 'office.inspect', { path: 'lesson.docx' })
      else if (turn === 2) yield complete(request, 'office.edit', { path: 'lesson.docx', content: { format: 'docx', edits: [
        { type: 'replaceText', oldText: 'Original teacher paragraph', text: 'Agent revised paragraph' } ] } })
      else yield complete(request)
    } }
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider, runs, changeReview: review,
      events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
    const start = await engine.start({ conversationId: 'conversation', taskId: 'office-review', instruction: '修改现有 Word 的第一段，保留第二段',
      documents: [], workspaceRoot: workspace, permission: 'workspace', selection })
    const finished = await engine.wait(start.runId)
    expect(finished.status, JSON.stringify(finished.tools)).toBe('completed')
    const stored = await runs.read(start.runId)
    if (!stored) throw new Error('Missing persisted Engine receipt')
    const edit = stored.tools.find(tool => tool.call.name === 'office.edit')!
    expect(edit.result).toMatchObject({ kind: 'read', data: { status: 'saved', saved: true } })
    expect(inspectOfficeContent(await fs.readFile(filename), 'docx')).toMatchObject({ paragraphs: [{ text: 'Agent revised paragraph' }, { text: 'Keep unrelated paragraph' }] })
    const capture = await review.store.read(start.runId, edit.callId)
    expect(capture).toMatchObject({ before: { kind: 'binary', blob: { byteLength: original.bytes.byteLength } }, after: { version: expect.any(String) } })
    const entry = (await review.inspect(stored, { limit: 10 })).entries.find(item => item.path === filename)!
    expect(entry).toMatchObject({ source: 'host-file', status: 'applied', availability: 'ready' })
    const conflicting = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'Later human content' }] })
    const afterBytes = await fs.readFile(filename)
    await fs.writeFile(filename, conflicting.bytes)
    expect((await review.rollback(stored, entry.entryId, { workspaceRoot: workspace, permission: 'workspace' })).status).toBe('conflict')
    expect(inspectOfficeContent(await fs.readFile(filename), 'docx')).toMatchObject({ paragraphs: [{ text: 'Later human content' }] })
    await fs.writeFile(filename, afterBytes)
    expect(await review.rollback(stored, entry.entryId, { workspaceRoot: workspace, permission: 'workspace' })).toMatchObject({ status: 'reverted', saved: true })
    expect(inspectOfficeContent(await fs.readFile(filename), 'docx')).toMatchObject({ paragraphs: [{ text: 'Original teacher paragraph' }, { text: 'Keep unrelated paragraph' }] })
    expect(host.registry.list()).toHaveLength(0)
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
