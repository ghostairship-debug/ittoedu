// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionSendInput, ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('ni07-')) throw new Error('Unsafe fixture root')
  await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
} })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }
async function fixture(boundary: 'provider' | 'approval' | 'question' | 'finish' = 'provider') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ni07-steering-')); roots.push(root)
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace)
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const original = await documents.internalAPI.create({ kind: 'markdown', source: 'P OLD tail', resources: { assets: {}, components: {} } }, 'draft.md')
  const other = await documents.internalAPI.create({ kind: 'markdown', source: 'UNCHANGED', resources: { assets: {}, components: {} } }, 'other.md')
  const key = randomBytes(32), settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true,
    encryptString(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const value = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), value]) },
    decryptString(value) { const bytes = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8') },
  } })
  const saved = await settings.saveConnection({ apiKey: 'offline-fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
    accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'supported' } } })
  await settings.saveProfile({ expectedRevision: 0, roles: { conversation: { connectionId: saved.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } })
  const gap = deferred(), release = deferred(), requestGap = deferred(), releaseRequest = deferred(), payloads: any[] = []
  let handle = ''
  const transport: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body)), turn = payloads.push(payload)
    expect(payload.model).toBe('fixture-model')
    const refs = JSON.parse(String(payload.messages[1].content).split('：')[1]); expect(refs).toHaveLength(1)
    expect(refs[0].documentId).toBe(original.documentId); handle = refs[0].writable[0].target
    if (turn === 2) {
      if (boundary === 'finish') { requestGap.resolve(); await releaseRequest.promise }
      else { if (boundary === 'provider') gap.resolve(); await release.promise }
    }
    let tools: { name: string; input: unknown }[]
    if (turn === 1) tools = boundary === 'finish'
      ? [{ name: 'text_replace', input: { target: handle, content: 'FIRST' } }, { name: 'task_finish', input: {} }]
      : boundary === 'question'
      ? [{ name: 'ask_user', input: { question: '是否继续旧方案？', options: [{ label: '继续' }, { label: '停止' }] } }]
      : [{ name: 'text_replace', input: { target: handle, content: 'FIRST' } }]
    else if (['approval', 'question'].includes(boundary) && turn === 2) {
      expect(payload.messages.some((message: { role: string; content: unknown }) => message.role === 'user' && message.content === '后续改为 STEER，保留人工前缀')).toBe(true)
      const previous = JSON.parse(payload.messages.findLast((message: { role: string }) => message.role === 'tool').content)
      expect(previous.data.status).toBe(boundary === 'approval' ? 'not-started' : 'superseded')
      expect(previous.data.selected).toBeUndefined()
      tools = [{ name: 'read', input: { target: handle } }]
    } else if (['approval', 'question'].includes(boundary) && turn === 3) {
      expect(JSON.parse(payload.messages.findLast((message: { role: string }) => message.role === 'tool').content).data.text).toBe('OLD')
      tools = [{ name: 'text_replace', input: { target: handle, content: 'STEER' } }, { name: 'task_finish', input: {} }]
    }
    else if (turn === 2) tools = [{ name: 'text_replace', input: { target: handle, content: 'STALE' } }, { name: 'task_finish', input: {} }]
    else if (turn === 3) {
      expect(boundary === 'finish' ? JSON.stringify(payload.messages).includes('后续改为 STEER，保留人工前缀')
        : payload.messages.some((message: { role: string; content: unknown }) => message.role === 'user' && message.content === '后续改为 STEER，保留人工前缀')).toBe(true)
      if (boundary !== 'finish') expect(payload.messages.filter((message: { role: string }) => message.role === 'tool').map((message: { content: string }) => JSON.parse(message.content).data?.status)).toContain('not-started')
      tools = [{ name: 'read', input: { target: handle } }]
    } else {
      const result = JSON.parse(payload.messages.findLast((message: { role: string }) => message.role === 'tool').content)
      expect(result.data.text).toBe('FIRST')
      tools = [{ name: 'text_replace', input: { target: handle, content: 'STEER' } }, { name: 'task_finish', input: {} }]
    }
    const body = { id: `response-${turn}`, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant', content: turn === 1 ? '第一项已执行' : '继续处理',
      tool_calls: tools.map((tool, index) => ({ index, id: `tool-${turn}-${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } })) }, finish_reason: 'tool_calls' }] }
    return new Response(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const options = { directory: path.join(root, 'desktop'), documents, settings, authorizeWorkspaceRoot: async (value: string) => ({ resolvedPath: await fs.realpath(value) }), fetch: transport }
  const service = new ExecutionDesktopService(options)
  const approvals: string[] = [], newApproval = deferred()
  if (boundary === 'finish') {
    const save = service.runs.save.bind(service.runs); let held = false
    service.runs.save = async record => {
      await save(record)
      if (!held && record.status === 'running' && record.tools.some(tool => tool.call.name === 'task.finish' && tool.result?.kind === 'read' && (tool.result.data as { status?: unknown }).status === 'completed')) {
        held = true; gap.resolve(); await release.promise
      }
    }
  }
  service.engine.subscribe(event => {
    if (event.type === 'tool' && event.data.status === 'approval') { approvals.push(event.itemId); gap.resolve(); if (approvals.length === 2) newApproval.resolve() }
    if (event.type === 'tool' && event.data.status === 'waiting' && event.data.question) gap.resolve()
  })
  const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const target = { kind: 'markdown-range' as const, from: 2, to: 5 }
  const started = await service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
    expectedRevision: conversation.revision, submissionId: randomUUID(), text: '先修改原范围再继续', ...(boundary === 'approval' ? { permission: 'ask' } : {}), documents: [{ documentId: original.documentId, epoch: original.epoch, revision: original.revision, writable: [target], selection: [target] }] }) as ExecutionSendResult
  await gap.promise
  const current = await service.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }) as { revision: number }
  const adjustment: ExecutionSendInput & { type: 'send' } = { type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: current.revision,
    submissionId: randomUUID(), text: '后续改为 STEER，保留人工前缀', mode: 'adjust', ...(boundary === 'approval' ? { permission: 'ask' as const } : {}), documents: [{ documentId: other.documentId, epoch: other.epoch, revision: other.revision, writable: [{ kind: 'document' }] }] }
  return { root, documents, original, other, service, options, started, adjustment, release, payloads, approvals, newApproval, requestGap, releaseRequest }
}

it('adjusts the same run at a real write gap, ignores a temporary selection, keeps human edits and confirms the same submission without replay', async () => {
  const h = await fixture(), session = h.documents.registry.get(h.original.documentId)
  expect(session.read().model).toMatchObject({ source: 'P FIRST tail' })
  const before = session.read()
  await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 0, text: 'H ' } } })
  const acknowledged = await h.service.operate(h.adjustment) as ExecutionSendResult
  expect(acknowledged.run!.runId).toBe(h.started.run!.runId)
  expect(acknowledged.submission).toMatchObject({ state: 'accepted', steeringRunId: h.started.run!.runId })
  expect(acknowledged.run!.input.selection).toEqual(h.started.run!.input.selection)
  expect(acknowledged.run!.input.documents).toEqual(h.started.run!.input.documents)
  const repeated = await h.service.operate(h.adjustment) as ExecutionSendResult
  expect(repeated.run!.runId).toBe(h.started.run!.runId); expect(repeated.run!.steering).toHaveLength(1)
  h.release.resolve()
  const final = await h.service.engine.wait(h.started.run!.runId)
  expect(final.status, JSON.stringify(final.failure)).toBe('completed')
  expect(final.steering![0].messageIndex).toEqual(expect.any(Number))
  expect(final.messages[final.steering![0].messageIndex!]).toEqual({ role: 'user', content: h.adjustment.text })
  expect(final.tools.filter(tool => tool.notInvokedReason === 'steering')).toHaveLength(2)
  expect(final.tools.filter(tool => tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied')).toHaveLength(2)
  expect(session.read()).toMatchObject({ undoDepth: 3, model: { source: 'H P STEER tail' } })
  expect(h.documents.registry.get(h.other.documentId).read()).toMatchObject({ undoDepth: 0, model: { source: 'UNCHANGED' } })
  expect(h.payloads).toHaveLength(4)
  await h.service.shutdown()
  const cold = new ExecutionDesktopService(h.options)
  const confirmed = await cold.operate(h.adjustment) as ExecutionSendResult
  expect(confirmed.run!.runId).toBe(final.runId); expect(confirmed.submission.state).toBe('accepted')
  expect(await cold.runs.list()).toHaveLength(1); expect(h.payloads).toHaveLength(4)
  expect(session.read().undoDepth).toBe(3)
  await cold.shutdown()
})

it('keeps an accepted adjustment when Stop wins the boundary and never submits the old or replacement write', async () => {
  const h = await fixture()
  const acknowledged = await h.service.operate(h.adjustment) as ExecutionSendResult
  expect(acknowledged.run!.runId).toBe(h.started.run!.runId)
  const stopping = h.service.engine.stop(h.started.run!.runId)
  h.release.resolve()
  const final = await stopping
  expect(final!.status).toBe('stopped')
  expect(final!.steering![0]).toMatchObject({ text: h.adjustment.text }); expect(final!.steering![0].messageIndex).toBeUndefined()
  expect(h.documents.registry.get(h.original.documentId).read()).toMatchObject({ undoDepth: 1, model: { source: 'P FIRST tail' } })
  expect(h.payloads).toHaveLength(2)
  const confirmed = await h.service.operate(h.adjustment) as ExecutionSendResult
  expect(confirmed.run!.runId).toBe(final!.runId); expect(await h.service.runs.list()).toHaveLength(1)
  await h.service.shutdown()
})


it.each(['approval', 'question'] as const)('consumes an adjustment at a quiescent %s boundary without inventing a decision or answering the old question', async boundary => {
  const h = await fixture(boundary)
  const accepted = await h.service.operate(h.adjustment) as ExecutionSendResult
  expect(accepted.run!.runId).toBe(h.started.run!.runId)
  h.release.resolve()
  if (boundary === 'approval') {
    await h.newApproval.promise
    expect(h.approvals).toHaveLength(2)
    await expect(h.service.engine.decide({ runId: h.started.run!.runId, callId: h.approvals[0]!, decision: 'allow-all' })).rejects.toThrow('已经处理')
    expect(h.documents.registry.get(h.original.documentId).read().undoDepth).toBe(0)
    await h.service.engine.decide({ runId: h.started.run!.runId, callId: h.approvals[1]!, decision: 'allow' })
  }
  const final = await h.service.engine.wait(h.started.run!.runId)
  expect(final.status, JSON.stringify(final.failure)).toBe('completed')
  expect(final.tools[0]).toMatchObject(boundary === 'approval' ? { notInvokedReason: 'steering' } : { result: { kind: 'read', data: { status: 'superseded' } } })
  expect(final.tools.filter(tool => tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied')).toHaveLength(1)
  expect(h.documents.registry.get(h.original.documentId).read()).toMatchObject({ undoDepth: 1, model: { source: 'P STEER tail' } })
  expect(h.payloads).toHaveLength(3)
  await h.service.shutdown()
})


it('resumes an accepted instruction after an earlier finish receipt without treating that old finish as completion of the adjustment', async () => {
  const h = await fixture('finish')
  const accepted = await h.service.operate(h.adjustment) as ExecutionSendResult
  expect(accepted.run!.tools.some(tool => tool.call.name === 'task.finish' && tool.result?.kind === 'read' && (tool.result.data as { status?: unknown }).status === 'completed')).toBe(true)
  h.release.resolve(); await h.requestGap.promise
  const stopping = h.service.engine.stop(h.started.run!.runId); h.releaseRequest.resolve()
  const stopped = (await stopping)!
  expect(stopped.status).toBe('stopped'); expect(stopped.steering![0].messageIndex).toEqual(expect.any(Number))
  expect(h.documents.registry.get(h.original.documentId).read()).toMatchObject({ undoDepth: 1, model: { source: 'P FIRST tail' } })
  const resumed = await h.service.engine.start({ ...stopped.input, taskId: randomUUID() }, { runId: stopped.runId, facts: 'ignored model facts', sameTask: true })
  const final = await h.service.engine.wait(resumed.runId)
  expect(final.status, JSON.stringify(final.failure)).toBe('completed')
  expect(h.payloads).toHaveLength(4)
  expect(h.documents.registry.get(h.original.documentId).read()).toMatchObject({ undoDepth: 2, model: { source: 'P STEER tail' } })
  expect(final.tools.filter(tool => tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied')).toHaveLength(1)
  const acknowledged = await h.service.engine.start({ ...final.input, taskId: randomUUID() }, { runId: final.runId, facts: '', sameTask: true })
  expect((await h.service.engine.wait(acknowledged.runId)).status).toBe('completed')
  expect(h.payloads).toHaveLength(4); expect(h.documents.registry.get(h.original.documentId).read().undoDepth).toBe(2)
  await h.service.shutdown()
})


it('keeps the draft and rejects an adjustment whose first journal save fails before writing the submission ID', async () => {
  const h = await fixture()
  const save = h.service.runs.save.bind(h.service.runs); let failed = false
  h.service.runs.save = async record => {
    if (!failed && record.steering?.some(value => value.submissionId === h.adjustment.submissionId)) {
      failed = true; throw new Error('fixture pre-save disk failure')
    }
    return save(record)
  }
  const result = await h.service.operate(h.adjustment) as ExecutionSendResult
  expect(failed).toBe(true)
  expect(result.submission).toMatchObject({ state: 'failed', failure: { code: 'steering-not-accepted' } })
  expect(result.run).toBeUndefined(); expect(result.conversation.inputDraft).toBe(h.adjustment.text)
  expect((await h.service.engine.read(h.started.run!.runId))!.steering).toBeUndefined()
  expect((await h.service.runs.read(h.started.run!.runId))!.steering).toBeUndefined()
  const stopping = h.service.engine.stop(h.started.run!.runId); h.release.resolve(); await stopping
  await h.service.shutdown()
  const cold = new ExecutionDesktopService(h.options)
  const confirmed = await cold.operate(h.adjustment) as ExecutionSendResult
  expect(confirmed.submission.state).toBe('failed'); expect(confirmed.run).toBeUndefined()
  expect(confirmed.conversation.inputDraft).toBe(h.adjustment.text)
  expect((await cold.runs.read(h.started.run!.runId))!.steering).toBeUndefined()
  expect(await cold.runs.list()).toHaveLength(1); expect(h.payloads).toHaveLength(2)
  expect(h.documents.registry.get(h.original.documentId).read()).toMatchObject({ undoDepth: 1, model: { source: 'P FIRST tail' } })
  await cold.shutdown()
})
