// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve())
  })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

function frame(delta: object, finish: 'stop' | 'tool_calls') {
  const id = randomUUID()
  return `data: ${JSON.stringify({ id, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
    + `data: ${JSON.stringify({ id, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`
    + 'data: [DONE]\n\n'
}

it('S08-T05 keeps an outside-workspace reference immutable after source move and rejects a model write to its path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-outside-reference-')); roots.push(root)
  const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
  await fs.mkdir(workspace); await fs.mkdir(outside)
  const original = path.join(outside, 'reference.txt'), relocated = path.join(outside, 'renamed.txt')
  const before = Buffer.from('REFERENCE_BEFORE_MOVE_中文'), after = Buffer.from('SOURCE_AFTER_MOVE_已改变')
  await fs.writeFile(original, before)
  const wire: Array<Record<string, any>> = []
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>
      wire.push(body)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (wire.length === 2) {
        response.end(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'forged-path-write', type: 'function', function: {
          name: modelToolWireName('text.replace'), arguments: JSON.stringify({ target: relocated, content: 'UNAUTHORIZED_REWRITE' }),
        } }] }, 'tool_calls'))
      } else response.end(frame({ role: 'assistant', content: '已检查引用' }, 'stop'))
    } catch { response.writeHead(500); response.end() }
  }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing server address')
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: async () => true, encryptString: async value => Buffer.from(value),
    decryptString: async bytes => Buffer.from(bytes).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'fixture-key', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: `http://127.0.0.1:${address.port}/v1`, accountId: 'fixture',
    authKind: 'api-key', billing: { kind: 'token-plan' }, capabilities: { tools: 'supported', vision: 'unsupported', stream: 'supported', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture' },
    vision: null, imageGenerate: null, imageEdit: null } })
  const grant = randomUUID(), grants = new Map<string, string>([[grant, original]])
  const attachments = new AttachmentService({ directory: path.join(root, 'execution', 'attachments'), resolveAuthorizedPath: async id => {
    const filename = grants.get(id)
    if (!filename) throw new Error('path-not-authorized')
    return { path: filename, kind: 'file' }
  } })
  const snapshot = await attachments.receivePath({ authorizationId: grant })
  grants.clear()
  expect(snapshot.source).toMatchObject({ kind: 'file', readOnly: true, pathHint: original })
  expect(snapshot.digest).toBe(createHash('sha256').update(before).digest('hex'))
  const service = new ExecutionDesktopService({ directory: path.join(root, 'execution'), attachments,
    documents: new DocumentHostService(path.join(root, 'documents')), settings,
    authorizeWorkspaceRoot: async selected => ({ resolvedPath: selected }) })
  const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
  const identity = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }
  const reference = [{ attachmentId: snapshot.id, representationId: 'original-text', role: 'reference' as const }]
  const drafted = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision,
    text: '请阅读参考文件', documents: [], attachments: reference }) as ConversationRecord
  const sent = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: drafted.revision,
    text: drafted.inputDraft, documents: [], attachments: reference }) as ExecutionSendResult
  if (!sent.run) throw new Error('Initial attachment submission did not start')
  const firstRun = await service.engine.wait(sent.run.runId)
  expect(firstRun.status, JSON.stringify(firstRun.failure)).toBe('completed')
  expect(wire).toHaveLength(1)
  expect(JSON.stringify(wire[0])).toContain(before.toString())
  expect(wire[0]!.tools.every((tool: { function: { name: string } }) => !/file.*write|write.*file/i.test(tool.function.name))).toBe(true)
  await fs.rename(original, relocated)
  await fs.writeFile(relocated, after)
  expect(Buffer.from((await attachments.readRepresentation(snapshot.id, 'original-text')).bytes)).toEqual(before)
  await expect(attachments.receivePath({ authorizationId: grant })).rejects.toThrow('path-not-authorized')

  let current = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
  for (let index = 0; index < 100 && !current.messages.some(message => message.role === 'assistant'); index++) {
    await new Promise(resolve => setTimeout(resolve, 5))
    current = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
  }
  const attempted = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: current.revision,
    text: '尝试修改原件', documents: [], attachments: [] }) as ExecutionSendResult
  if (!attempted.run) throw new Error('Second submission did not start')
  const run = await service.engine.wait(attempted.run.runId)
  expect(run.status).toBe('failed')
  expect(run.failure).toMatchObject({ code: 'incomplete-tool-call' })
  expect(run.tools).toHaveLength(0)
  expect(wire).toHaveLength(2)
  expect(wire[1]!.tools.every((tool: { function: { name: string } }) => tool.function.name !== modelToolWireName('text.replace'))).toBe(true)
  expect(JSON.stringify(wire[1])).toContain(before.toString())
  expect(JSON.stringify(wire[1])).not.toContain(after.toString())
  expect(await fs.readFile(relocated)).toEqual(after)
  expect(await fs.stat(original).then(() => true, () => false)).toBe(false)
  expect(Buffer.from((await attachments.readRepresentation(snapshot.id, 'original-text')).bytes)).toEqual(before)
})
