// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { installDocumentSaveEvents } from '../../src/main/workbench/execution/DocumentSaveEvents'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  cleanup(); vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

const selection: ModelSelection = { model: 'fixture-model', connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
  accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-ref' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' },
} }

function provider(content: string): ModelProvider {
  let requests = 0
  return { async *stream(request: ModelRequest) {
    const first = ++requests === 1
    const target = first ? (JSON.parse(String(request.messages[1].content).split('：')[1]) as
      { writable: { target: string }[] }[])[0]!.writable[0]!.target : ''
    const calls = first ? [{ id: 'provider-call', name: 'text.replace', argumentsText: JSON.stringify({ target, content }) }] : []
    yield { requestId: request.requestId, sequence: 1, type: 'response.completed' as const,
      responseId: `fixture-${requests}`, actualModel: 'fixture', nativeResponse: {},
      finishReason: first ? 'tool_calls' : 'stop', toolCalls: calls,
      assistant: { role: 'assistant' as const, content: first ? null : '检查完成',
        ...(first ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
          function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
  } }
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m09-three-states-')); roots.push(root)
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const runs = new ExecutionRunStore(path.join(root, 'runs'))
  const conversations = new ConversationStore({ directory: path.join(root, 'conversations') })
  await conversations.registerWorkspace({ workspaceId: 'space', rootPath: root, managed: true, authorization: 'managed' })
  const conversation = await conversations.createConversation({ workspaceId: 'space' })
  const document = await documents.internalAPI.create({ kind: 'markdown', source: 'OLD', resources: { assets: {}, components: {} } }, 'draft.md')
  const saves = installDocumentSaveEvents({ documents, execution: {
    events, conversations, appendExternalEvent: input => events.append(input),
  } })
  const run = async (content: string) => {
    const engine = new ExecutionEngine({ registry: documents.registry, gateway: documents.tools,
      provider: provider(content), runs, events })
    const input: ExecutionStart = { conversationId: conversation.conversationId, taskId: randomUUID(),
      instruction: '修改正文', selection, documents: [{ documentId: document.documentId,
        writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] }
    const started = await engine.start(input)
    return engine.wait(started.runId)
  }
  return { root, documents, document, events, conversation, saves, run }
}

function expand(card: HTMLElement) {
  const details = card.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
}

it('M09-T03 keeps tool, canonical application and disk save distinct after real failure receipts and durable replay', async () => {
  const f = await fixture()
  try {
    const open = fs.open.bind(fs)
    const journalRoot = path.resolve(f.root, 'documents') + path.sep
    let rejectedAppend = false
    const fault = vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      if (!rejectedAppend && flags === 'a+' && path.resolve(String(filename)).startsWith(journalRoot)
        && String(filename).endsWith('.journal')) {
        rejectedAppend = true
        throw Object.assign(new Error('journal write denied'), { code: 'EACCES' })
      }
      return open(filename, flags, mode)
    })
    let rejected: Awaited<ReturnType<typeof f.run>>
    try { rejected = await f.run('NEW') } finally { fault.mockRestore() }
    expect(rejectedAppend).toBe(true)
    expect(rejected.status).toBe('partial')
    expect(rejected.tools[0]?.result).toMatchObject({ kind: 'document-operation', result: { status: 'failed', code: 'recovery-write-failed' } })
    expect(await f.documents.internalAPI.read(f.document.documentId)).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'OLD' } })
    expect((await f.events.snapshot(f.conversation.conversationId)).items.filter(item => item.runId === rejected.runId && item.type === 'document.commit')).toHaveLength(0)

    const disk = path.join(f.root, 'draft.md')
    await f.documents.saveToPath(f.document.documentId, disk)
    const applied = await f.run('NEW')
    expect(applied.status).toBe('completed')
    expect((await f.documents.internalAPI.read(f.document.documentId)).model).toMatchObject({ source: 'NEW' })
    await fs.writeFile(disk, 'OUTSIDE')
    await expect(f.documents.saveToPath(f.document.documentId)).rejects.toThrow()
    await f.saves.flush()
    expect(await fs.readFile(disk, 'utf8')).toBe('OUTSIDE')
    expect(await f.documents.internalAPI.read(f.document.documentId)).toMatchObject({ dirty: true, saveError: expect.any(String) })

    const reopened = new ExecutionEventStore({ directory: path.join(f.root, 'events') })
    const projection = await reopened.snapshot(f.conversation.conversationId)
    const locate = vi.fn()
    const view = render(<ExecutionTimeline projection={projection} onLocateDocument={locate} />)
    const rejectedCard = screen.getAllByRole('article', { name: '工具执行' }).find(card => card.getAttribute('data-execution-item')?.startsWith(rejected.runId))!
    const appliedCard = screen.getAllByRole('article', { name: '工具执行' }).find(card => card.getAttribute('data-execution-item')?.startsWith(applied.runId))!
    expand(rejectedCard); expand(appliedCard)
    expect(within(rejectedCard).getByText('已运行')).toBeInTheDocument()
    expect(within(rejectedCard).getByText('应用失败')).toBeInTheDocument()
    expect(within(rejectedCard).getByText('保存未确认')).toBeInTheDocument()
    expect(within(appliedCard).getByText('已运行')).toBeInTheDocument()
    expect(within(appliedCard).getByText('已应用')).toBeInTheDocument()
    expect(within(appliedCard).getByText('保存失败')).toBeInTheDocument()
    fireEvent.click(within(appliedCard).getByRole('button', { name: '定位文档' }))
    expect(locate).toHaveBeenCalledWith(f.document.documentId)

    const recovered = path.join(f.root, 'recovered.md')
    await f.documents.saveToPath(f.document.documentId, recovered); await f.saves.flush()
    expect(await fs.readFile(recovered, 'utf8')).toBe('NEW')
    expect(await f.documents.internalAPI.read(f.document.documentId)).toMatchObject({ dirty: false,
      binding: { kind: 'file', path: recovered } })
    const recoveredProjection = await reopened.snapshot(f.conversation.conversationId)
    expect(recoveredProjection.items.some(item => item.runId === applied.runId
      && item.type === 'document.save' && item.data.saveStatus === 'saved')).toBe(true)
    view.rerender(<ExecutionTimeline projection={recoveredProjection} onLocateDocument={locate} />)
    expect(within(appliedCard).getByText('已保存')).toBeInTheDocument()
  } finally { f.saves.dispose() }
})

it('M09-T03 does not rewrite an earlier saved commit as failed when a newer revision cannot save', async () => {
  const f = await fixture()
  try {
    const first = await f.run('ONE')
    expect(first.status).toBe('completed')
    const disk = path.join(f.root, 'draft.md')
    await f.documents.saveToPath(f.document.documentId, disk); await f.saves.flush()
    expect(await fs.readFile(disk, 'utf8')).toBe('ONE')

    const second = await f.run('TWO')
    expect(second.status).toBe('completed')
    await fs.writeFile(disk, 'OUTSIDE')
    await expect(f.documents.saveToPath(f.document.documentId)).rejects.toThrow()
    await f.saves.flush()

    const reopened = new ExecutionEventStore({ directory: path.join(f.root, 'events') })
    const projection = await reopened.snapshot(f.conversation.conversationId)
    const firstCommit = projection.items.find(item => item.runId === first.runId && item.type === 'document.commit')!
    const secondCommit = projection.items.find(item => item.runId === second.runId && item.type === 'document.commit')!
    expect(firstCommit.data.revision).toBe(1)
    expect(secondCommit.data.revision).toBe(2)
    expect(projection.items.filter(item => item.type === 'document.save' && item.runId === first.runId)
      .some(item => item.data.revision === 1 && item.data.saveStatus === 'saved')).toBe(true)
    expect(projection.items.filter(item => item.type === 'document.save' && item.runId === second.runId)
      .some(item => item.data.revision === 2 && item.data.saveStatus === 'failed')).toBe(true)

    render(<ExecutionTimeline projection={projection} />)
    const firstCard = screen.getAllByRole('article', { name: '工具执行' }).find(card => card.getAttribute('data-execution-item')?.startsWith(first.runId))!
    const secondCard = screen.getAllByRole('article', { name: '工具执行' }).find(card => card.getAttribute('data-execution-item')?.startsWith(second.runId))!
    expand(firstCard); expand(secondCard)
    expect(within(firstCard).getByText('已保存')).toBeInTheDocument()
    expect(within(secondCard).getByText('保存失败')).toBeInTheDocument()
  } finally { f.saves.dispose() }
})

it('M09-T03 retains the saved revision while showing a separate failed save attempt for that same revision', async () => {
  const f = await fixture()
  try {
    const run = await f.run('ONE')
    expect(run.status).toBe('completed')
    const disk = path.join(f.root, 'draft.md')
    await f.documents.saveToPath(f.document.documentId, disk); await f.saves.flush()
    await fs.writeFile(disk, 'OUTSIDE')
    await expect(f.documents.saveToPath(f.document.documentId)).rejects.toThrow()
    await f.saves.flush()
    expect(await f.documents.internalAPI.read(f.document.documentId)).toMatchObject({ revision: 1, saveError: expect.any(String) })

    const reopened = new ExecutionEventStore({ directory: path.join(f.root, 'events') })
    const projection = await reopened.snapshot(f.conversation.conversationId)
    const saves = projection.items.filter(item => item.type === 'document.save' && item.runId === run.runId)
    expect(saves.map(item => [item.data.revision, item.data.saveStatus])).toEqual([[1, 'saved'], [1, 'failed']])
    render(<ExecutionTimeline projection={projection} />)
    const toolCard = screen.getByRole('article', { name: '工具执行' })
    expand(toolCard)
    expect(within(toolCard).getByText('已保存')).toBeInTheDocument()
    const failedCard = screen.getAllByRole('article', { name: '文件保存' }).find(card => card.textContent?.includes('文件保存失败'))!
    expand(failedCard)
    expect(within(failedCard).getByText('保存失败')).toBeInTheDocument()
  } finally { f.saves.dispose() }
})
