// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { locateHtmlSourceTarget } from '../../src/main/workbench/htmlPreview/htmlSourceLocator'
import { captureSelection } from '../../src/renderer/workbench/SelectionContextController'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

function frame(delta: object, finish: 'stop' | 'tool_calls'): string {
  const id = randomUUID()
  return `data: ${JSON.stringify({ id, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
    + `data: ${JSON.stringify({ id, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`
    + 'data: [DONE]\n\n'
}

it('HTML text card uses the existing markdown-range text.replace path through local SSE', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m23-html-ai-')); roots.push(root)
  const filename = path.join(root, 'lesson.html')
  const original = '<html><body><h1>原来的标题</h1><p>保持原文</p></body></html>'
  await fs.writeFile(filename, original)
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const snapshot = await documents.open(filename)
  if (snapshot.model.kind !== 'text' || snapshot.binding.kind !== 'file') throw new Error('HTML text document required')
  const report = { handle: 'heading', kind: 'text' as const,
    domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'h1', index: 0 }],
    sectionOrder: null, rawText: '原来的标题', attributeName: null,
    rect: { x: 0, y: 0, width: 100, height: 30 }, scriptCreated: false }
  const located = locateHtmlSourceTarget(snapshot.model.source, report, { documentId: snapshot.documentId,
    epoch: snapshot.epoch, revision: snapshot.revision, bindingVersion: snapshot.binding.bindingVersion })
  expect(located.status).toBe('editable')
  if (located.status !== 'editable' || !located.locator.valueSpan) return
  const range = { kind: 'markdown-range' as const, from: located.locator.valueSpan.start, to: located.locator.valueSpan.end }
  expect(captureSelection(snapshot, [range], '标题', snapshot.model.source).targets).toEqual([range])

  const requests: unknown[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages: Array<{ content?: string }> }
    requests.push(body)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests.length === 1) {
      const context = body.messages.find(message => typeof message.content === 'string' && message.content.includes('本次固定文档与权限'))?.content ?? ''
      const frozen = JSON.parse(context.slice(context.indexOf('：') + 1)) as Array<{ writable: Array<{ target: string }> }>
      const target = frozen[0]?.writable[0]?.target
      if (!target) { response.end(frame({ role: 'assistant', content: '缺少写入目标' }, 'stop')); return }
      response.end(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'html-replace', type: 'function', function: {
        name: modelToolWireName('text.replace'), arguments: JSON.stringify({ target, content: '新的标题' }),
      } }] }, 'tool_calls'))
    } else response.end(frame({ role: 'assistant', content: '标题已修改' }, 'stop'))
  }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address')
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: async () => true, encryptString: async value => Buffer.from(value),
    decryptString: async bytes => Buffer.from(bytes).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'fixture-key', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: `http://127.0.0.1:${address.port}/v1`, accountId: 'fixture',
    authKind: 'api-key', billing: { kind: 'token-plan' }, capabilities: {
      tools: 'supported', vision: 'unsupported', stream: 'supported', reasoning: 'unknown',
    },
  } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture' },
    vision: null, imageGenerate: null, imageEdit: null } })
  const service = new ExecutionDesktopService({ directory: path.join(root, 'execution'), documents, settings,
    authorizeWorkspaceRoot: async value => ({ resolvedPath: value }) })
  const workspace = await service.operate({ type: 'workspace', root }) as { workspace: { workspaceId: string } }
  const card = await service.operate({ type: 'create-conversation', workspaceId: workspace.workspace.workspaceId,
    element: { kind: 'element', documentId: snapshot.documentId, label: '标题' } }) as ConversationRecord
  const sent = await service.operate({ type: 'send', workspaceId: workspace.workspace.workspaceId,
    conversationId: card.conversationId, submissionId: randomUUID(), expectedRevision: card.revision,
    text: '把标题改为新的标题', documents: [{ documentId: snapshot.documentId, epoch: snapshot.epoch,
      revision: snapshot.revision, writable: [range], selection: [range] }], attachments: [] }) as ExecutionSendResult
  expect(sent.run).toBeTruthy()
  if (!sent.run) return
  const run = await service.engine.wait(sent.run.runId)
  expect(run.status, JSON.stringify(run.failure)).toBe('completed')
  expect(run.tools.some(tool => tool.call.name === 'text.replace' && tool.result?.kind === 'document-operation')).toBe(true)
  expect((await documents.internalAPI.read(snapshot.documentId)).model).toMatchObject({
    source: '<html><body><h1>新的标题</h1><p>保持原文</p></body></html>',
  })
  const change = await service.operate({ type: 'element-change', submissionId: sent.submission.submissionId })
  expect(change).toMatchObject({ state: 'applied', content: '新的标题' })
})
