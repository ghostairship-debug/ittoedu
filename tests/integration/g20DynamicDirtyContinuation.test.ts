// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'g20-dynamic-recovery-'))
      throw new Error('Fixture outside expected temp directory')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  }
})

it('restores a dirty dynamically opened document before continuing after a process restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-dynamic-recovery-')); roots.push(root)
  const workspace = path.join(root, 'workspace'), filename = path.join(workspace, 'lesson.md')
  await fs.mkdir(workspace); await fs.writeFile(filename, '磁盘原稿')
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'fixture-key', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
    authKind: 'api-key', billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' },
    vision: null, imageGenerate: null, imageEdit: null } })
  let requests = 0
  const localFetch: typeof fetch = async (_url, init) => {
    requests++
    if (requests === 3) return new Response('', { status: 504 })
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
    const prior = [...body.messages].reverse().find(message => message.role === 'tool')
    const target = requests === 2 ? (JSON.parse(String(prior?.content)) as { data: { markdown: { writableTarget: string } } }).data.markdown.writableTarget : undefined
    const tool = requests === 1 || requests === 4
      ? { name: 'file.open', input: { path: 'lesson.md' } }
      : requests === 2 ? { name: 'text.replace', input: { target, content: '已提交但未保存' } } : null
    const chunk = { id: `response-${requests}`, model: 'fixture-model', choices: [{ index: 0,
      delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${requests}`, type: 'function',
        function: { name: modelToolWireName(tool.name), arguments: JSON.stringify(tool.input) } }] }
        : { role: 'assistant', content: '续跑已核对' }, finish_reason: tool ? 'tool_calls' : 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const hostDirectory = path.join(root, 'documents'), executionDirectory = path.join(root, 'execution')
  const makeService = () => {
    const documents = new DocumentHostService(hostDirectory)
    return { documents, service: new ExecutionDesktopService({ directory: executionDirectory, documents, settings,
      fetch: localFetch, authorizeWorkspaceRoot: async directory => ({ resolvedPath: directory }) }) }
  }
  const first = makeService()
  const opened = await first.service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const conversation = await first.service.operate({ type: 'create-conversation', workspaceId: opened.workspace.workspaceId }) as ConversationRecord
  const send = { type: 'send', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
    submissionId: randomUUID(), expectedRevision: conversation.revision, text: '打开文件并修改', documents: [], attachments: [], permission: 'workspace' as const }
  const sent = await first.service.operate(send) as ExecutionSendResult
  const partial = await first.service.engine.wait(sent.run!.runId)
  expect(partial.status).toBe('partial')
  expect(partial.tools.map(tool => tool.result?.kind)).toEqual(['read', 'document-operation'])
  const documentId = (partial.tools[0]!.result as { data: { documentId: string } }).data.documentId
  expect((await first.documents.internalAPI.read(documentId)).model).toMatchObject({ source: '已提交但未保存' })
  expect(await fs.readFile(filename, 'utf8')).toBe('磁盘原稿')

  const conflicting = makeService()
  const stale = await conflicting.documents.internalAPI.open(filename)
  expect(stale.documentId).not.toBe(documentId)
  const conflictConversation = await conflicting.service.operate({ type: 'conversation', workspaceId: send.workspaceId,
    conversationId: send.conversationId }) as ConversationRecord
  await expect(conflicting.service.operate({ ...send, submissionId: randomUUID(),
    expectedRevision: conflictConversation.revision, retryOfRunId: partial.runId }))
    .rejects.toMatchObject({ code: 'execution-recovery-binding-conflict' })
  expect(requests).toBe(3)

  const restarted = makeService()
  const current = await restarted.service.operate({ type: 'conversation', workspaceId: send.workspaceId,
    conversationId: send.conversationId }) as ConversationRecord
  expect((await restarted.documents.internalAPI.recoverable()).map(item => item.documentId)).toContain(documentId)
  const continued = await restarted.service.operate({ ...send, submissionId: randomUUID(),
    expectedRevision: current.revision, retryOfRunId: partial.runId }) as ExecutionSendResult
  const completed = await restarted.service.engine.wait(continued.run!.runId)
  expect(completed.status).toBe('completed')
  expect((completed.tools[0]!.result as { data: { documentId: string } }).data.documentId).toBe(documentId)
  expect(await restarted.documents.internalAPI.read(documentId)).toMatchObject({ dirty: true, recovered: true,
    model: { source: '已提交但未保存' } })
  expect(await fs.readFile(filename, 'utf8')).toBe('磁盘原稿')
  expect(requests).toBe(5)
})
