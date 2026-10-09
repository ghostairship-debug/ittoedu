// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})
const selection: ModelSelection = {
  model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } },
}
function complete(request: ModelRequest, id?: string, name?: string, input?: unknown): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = id && name ? [{ id, type: 'function' as const, function: { name, arguments: JSON.stringify(input) } }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`, actualModel: 'fixture', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls.map(call => ({ id: call.id, name: call.function.name, argumentsText: call.function.arguments })),
    assistant: { role: 'assistant', content: calls.length ? '' : '已完成。', ...(calls.length ? { tool_calls: calls } : {}) } }
}
async function fixture(provider: ModelProvider) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-office-engine-')); roots.push(directory)
  const workspace = path.join(directory, 'workspace'), lesson = path.join(workspace, 'lesson'); await fs.mkdir(lesson, { recursive: true })
  const host = new DocumentHostService(path.join(directory, 'owner'))
  host.tools.configureHostServices({ office: { execute: async ({ grant, operationId, name, input, approvedPaths, assertActive }) => {
    const access = grant.fileAccess!
    const result = await host.agentFiles.executeOffice({ runId: grant.runId, workspaceRoot: access.workspaceRoot!,
      permission: access.permission, conversationHome: access.conversationHome, conversationHomeRoot: access.conversationHomeRoot,
      approvedOutsidePaths: approvedPaths, assertActive }, name, input, operationId)
    return { kind: 'read', data: result.data }
  } } })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: new AgentFileService(host), provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  return { host, engine, workspace, lesson }
}

describe('Office content tools in the general execution engine', () => {
  it('marks an Office edit as unknown after a committed-file reopen failure and stops without replaying it', async () => {
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) yield complete(request, 'load-office', 'tools.load', { families: ['office'] })
      else if (turn === 2) yield complete(request, 'create-word', 'office.create', { name: 'lesson.docx', content: {
        format: 'docx', blocks: [{ type: 'paragraph', text: 'Before saved edit' }],
      } })
      else if (turn === 3) yield complete(request, 'edit-word', 'office.edit', { path: 'lesson/lesson.docx', content: {
        format: 'docx', edits: [{ type: 'replaceText', oldText: 'Before saved edit', text: 'Committed new content' }],
      } })
      else throw new Error('A model retry cannot repair or replay an unknown Office commit')
    } }
    const f = await fixture(provider)
    let committed = false
    const replace = f.host.artifacts.replace.bind(f.host.artifacts)
    const write = vi.spyOn(f.host.artifacts, 'replace').mockImplementation(async (...args) => {
      const saved = await replace(...args)
      committed = true
      return saved
    })
    const read = f.host.artifacts.read.bind(f.host.artifacts)
    vi.spyOn(f.host.artifacts, 'read').mockImplementation((...args) => {
      if (committed) return Promise.reject(new Error('Injected saved-file reopening failure'))
      return read(...args)
    })
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-lost-reopen', instruction: '新建 Word 文档并修改其正文。',
      documents: [], workspaceRoot: f.workspace, conversationHome: { kind: 'folder', path: 'lesson' }, permission: 'workspace', selection })
    const final = await f.engine.wait(started.runId)
    expect.soft(final.status, JSON.stringify({ failure: final.failure, tools: final.tools.map(tool => tool.result) })).toBe('partial')
    expect(final.tools[1].result).toMatchObject({ kind: 'read', data: { status: 'saved', saved: true } })
    expect(final.tools[2].result, JSON.stringify(final.tools[2].result)).toMatchObject({ kind: 'error', code: 'tool-outcome-unknown' })
    expect(final.tools[2].effectPaths).toEqual([path.join(f.lesson, 'lesson.docx')])
    expect(write).toHaveBeenCalledTimes(1)
    expect(turn).toBe(3)
    expect(inspectOfficeContent(await fs.readFile(path.join(f.lesson, 'lesson.docx')), 'docx')).toMatchObject({ paragraphs: [{ text: 'Committed new content' }] })
    expect(await fs.readdir(f.lesson)).toEqual(['lesson.docx'])
    expect(f.host.registry.list()).toHaveLength(0)
  })

  it('advertises configured Office and idempotently expands its family, then creates and edits a saved DOCX using software-owned binding', async () => {
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      const names = request.tools?.map(tool => tool.name) ?? []
      if (turn === 1) {
        expect(names).toContain('tools.load')
        expect(names.filter(name => name.startsWith('office.'))).toEqual(expect.arrayContaining(['office.inspect', 'office.create', 'office.edit']))
        expect(request.tools?.find(tool => tool.name === 'tools.load')?.description).toContain('office')
        yield complete(request, 'load-office', 'tools.load', { families: ['office'] })
      } else if (turn === 2) {
        expect(names).toEqual(expect.arrayContaining(['office.inspect', 'office.create', 'office.edit']))
        yield complete(request, 'create-word', 'office.create', { name: 'lesson.docx', content: { format: 'docx', blocks: [
          { type: 'paragraph', heading: 'title', text: '实验讨论' },
          { type: 'paragraph', text: '先预测结果，再操作观察。' },
          { type: 'paragraph', text: '观察后解释结论。' },
        ] } })
      } else if (turn === 3) {
        // The model supplies meaningful content, not OOXML, bindings, revisions or paragraph bookkeeping.
        yield complete(request, 'edit-word', 'office.edit', { path: 'lesson/lesson.docx', content: { format: 'docx', edits: [
          { type: 'replaceText', oldText: '预测结果', text: '预测并说明理由' },
        ] } })
      } else yield complete(request)
    } }
    const f = await fixture(provider)
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-content', instruction: '新建实验讨论 Word 文档，再完善预测问题。',
      documents: [], workspaceRoot: f.workspace, conversationHome: { kind: 'folder', path: 'lesson' }, permission: 'workspace', selection })
    const final = await f.engine.wait(started.runId)
    expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools.map(tool => tool.result) })).toBe('completed')
    expect(final.tools.map(tool => tool.call.name)).toEqual(['tools.load', 'office.create', 'office.edit'])
    expect(final.tools[0].result).toMatchObject({ kind: 'read', data: { loaded: ['office'] } })
    for (const tool of final.tools.slice(1)) expect(tool.result).toMatchObject({ kind: 'read', data: { status: 'saved', saved: true } })
    const reopened = inspectOfficeContent(await fs.readFile(path.join(f.lesson, 'lesson.docx')), 'docx')
    expect(reopened).toMatchObject({ paragraphs: [{ text: '实验讨论' }, { text: '先预测并说明理由，再操作观察。' }, { text: '观察后解释结论。' }] })
    expect(f.host.registry.list()).toHaveLength(0)
    expect(await fs.readdir(f.lesson)).toEqual(['lesson.docx'])
    expect(turn).toBe(4)
  })

  it('advertises only inspection for a read-only task and reads the real DOCX without a text session', async () => {
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      const names = request.tools?.map(tool => tool.name) ?? []
      if (turn === 1) {
        expect(names.filter(name => name.startsWith('office.'))).toEqual(['office.inspect'])
        yield complete(request, 'load-readonly-office', 'tools.load', { families: ['office'] })
      } else if (turn === 2) {
        expect(names.filter(name => name.startsWith('office.'))).toEqual(['office.inspect'])
        yield complete(request, 'inspect-word', 'office.inspect', { path: 'lesson/existing.docx' })
      } else yield complete(request)
    } }
    const f = await fixture(provider)
    const content = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: '真实只读内容' }] })
    const filename = path.join(f.lesson, 'existing.docx'); await fs.writeFile(filename, content.bytes)
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-readonly', instruction: '阅读现有 Word 文件。',
      documents: [], workspaceRoot: f.workspace, permission: 'read-only', selection })
    const final = await f.engine.wait(started.runId)
    expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools.map(tool => tool.result) })).toBe('completed')
    expect(final.tools[0].result).toMatchObject({ kind: 'read', data: { loaded: ['office'], available: expect.arrayContaining([{ family: 'office', description: expect.any(String), count: 1 }]) } })
    expect(final.tools[1].result).toMatchObject({ kind: 'read', data: { writable: false, inspection: { format: 'docx', paragraphs: [{ text: '真实只读内容' }] } } })
    expect(inspectOfficeContent(await fs.readFile(filename), 'docx')).toMatchObject({ paragraphs: [{ text: '真实只读内容' }] })
    expect(f.host.registry.list()).toHaveLength(0)
    expect(await fs.readdir(f.lesson)).toEqual(['existing.docx'])
  })
})
