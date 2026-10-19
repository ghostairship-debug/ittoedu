// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function reply() {
  return new Response(`data: ${JSON.stringify({ id: randomUUID(), model: 'fixture', choices: [{ index: 0,
    delta: { role: 'assistant', content: '已按当前要求完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  { headers: { 'content-type': 'text/event-stream' } })
}
async function fixture(fetcher: typeof fetch) {
  const root = await mkdtemp(path.join(tmpdir(), 'advancement-default-'))
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const workspace = path.join(root, 'workspace'); await mkdir(workspace)
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => Buffer.from(bytes).toString(),
  } })
  const saved = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'supported' } } })
  await settings.saveProfile({ expectedRevision: 0, roles: { conversation: { connectionId: saved.connection.id, model: 'fixture' },
    vision: null, imageGenerate: null, imageEdit: null } })
  const service = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings, fetch: fetcher,
    authorizeWorkspaceRoot: async candidate => ({ resolvedPath: candidate }) })
  cleanup.push(() => service.shutdown())
  const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const current = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
  const identity = { workspaceId: current.workspaceId, conversationId: current.conversationId }
  return { service, current, identity }
}

it.each(['automatic', 'stepwise'] as const)('a stored %s selector does not become a new task instruction', async advancementMode => {
  const requests: string[] = []
  const h = await fixture(async (_url, init) => { requests.push(String(init?.body)); return reply() })
  await h.service.operate({ type: 'set-advancement-mode', ...h.identity, advancementMode })
  const text = '先给我看策划，等我确认后再继续'
  const sent = await h.service.operate({ type: 'send', ...h.identity, submissionId: randomUUID(), expectedRevision: h.current.revision,
    text, documents: [], permission: 'read-only' }) as ExecutionSendResult
  if (!sent.run) throw new Error('The submission did not start a run')
  const ended = await h.service.engine.wait(sent.run.runId)
  expect(ended.status).toBe('completed')
  expect(ended.input.advancementMode).toBeUndefined()
  expect(sent.submission.advancementMode).toBeUndefined()
  expect(ended.input.instruction).toBe(text)
  expect(ended.input.permission).toBe('read-only')
  expect(requests).toHaveLength(1)
  expect(requests[0]).toContain(text)
  expect(requests[0]).toContain('不要询问用户选择自动或逐步模式')
  expect(requests[0]).not.toContain('先用 ask_user purpose=advancement-mode')
  const persisted = await h.service.operate({ type: 'conversation', ...h.identity }) as ConversationRecord
  expect(persisted.advancementMode).toBe(advancementMode)
})

it('continuing a failed task does not revive the old selector in its frozen run or conversation', async () => {
  let requests = 0
  const h = await fixture(async () => ++requests === 1 ? new Response('', { status: 401 }) : reply())
  const text = '继续完成当前内容'
  const first = await h.service.operate({ type: 'send', ...h.identity, submissionId: randomUUID(), expectedRevision: h.current.revision,
    text, documents: [], advancementMode: 'stepwise' }) as ExecutionSendResult
  if (!first.run) throw new Error('The first submission did not start a run')
  const failed = await h.service.engine.wait(first.run.runId)
  expect(failed.status).toBe('failed')
  expect(failed.input.advancementMode).toBe('stepwise')
  const current = await h.service.operate({ type: 'conversation', ...h.identity }) as ConversationRecord
  expect(current.advancementMode).toBe('stepwise')
  const resumed = await h.service.operate({ type: 'send', ...h.identity, submissionId: randomUUID(), expectedRevision: current.revision,
    text, documents: [], retryOfRunId: failed.runId }) as ExecutionSendResult
  if (!resumed.run) throw new Error('The resumed submission did not start a run')
  const ended: ExecutionRunRecord = await h.service.engine.wait(resumed.run.runId)
  expect(ended.status).toBe('completed')
  expect(ended.taskContinuedFrom).toBe(failed.runId)
  expect(ended.input.advancementMode).toBeUndefined()
  expect(resumed.submission.advancementMode).toBeUndefined()
  expect(ended.input.instruction).toBe(text)
  expect(requests).toBe(2)
})
