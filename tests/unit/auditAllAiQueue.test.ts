// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'

const proto = ExecutionDesktopService.prototype as any
function queue(records: any[], runs: any[] = []) {
  const conversation = { workspaceId: 'w', conversationId: 'c', messages: [], runIndex: { builtinRunIds: [] } }
  const h = Object.assign(Object.create(proto), {
    options: { documents: { registry: { list: () => [] } } }, queues: new Map(), recoveryIssues: new Map(),
    runs: { list: async () => runs }, engine: { recover: vi.fn(async () => {}), read: async (id: string) => runs.find(run => run.runId === id) },
    conversations: { readConversation: async () => conversation },
    submissions: { list: async () => records, pausedReason: async () => undefined,
      update: async (id: string, patch: any) => Object.assign(records.find(record => record.submissionId === id), patch) },
    clearElementCards: async () => {}, collectAttachmentReleases: async () => {}, activeRun: async () => null,
    bindRun: vi.fn(async () => conversation), collectReply: vi.fn(async () => {}),
    startSubmission: vi.fn(async (record: any) => Object.assign(record, { state: 'accepted', runId: `run-${record.submissionId}` })),
  })
  return h
}
it('CA-007 retires a no-run starting record and starts the following input without replaying the old submission', async () => {
  const records = [{ submissionId: 'old', state: 'starting', workspaceId: 'w', conversationId: 'c' }, { submissionId: 'next', state: 'queued', workspaceId: 'w', conversationId: 'c' }]
  const h = queue(records)
  await h.ready(); await h.recoveryAndRebindPromise
  expect(records[0]).toMatchObject({ state: 'failed', failure: { code: 'submission-outcome-unknown' } })
  expect(h.startSubmission.mock.calls.map(([record]: any[]) => record.submissionId)).toEqual(['next'])
})
it('CA-054 continues after a local item failed before creating a run', async () => {
  const records = ['bad', 'good'].map(submissionId => ({ submissionId, state: 'queued', workspaceId: 'w', conversationId: 'c' }))
  const h = queue(records)
  h.startSubmission.mockImplementation(async (record: any) => Object.assign(record, { state: record.submissionId === 'bad' ? 'failed' : 'accepted' }))
  await h.startNext('c')
  expect(h.startSubmission.mock.calls.map(([record]: any[]) => record.submissionId)).toEqual(['bad', 'good'])
})
it('CA-124 projects an already terminal answer during rebind without another engine start', async () => {
  const run = { runId: 'done', input: { taskId: 'old' }, status: 'completed' }
  const h = queue([{ submissionId: 'old', state: 'accepted', workspaceId: 'w', conversationId: 'c' }], [run])
  await h.ready(); await h.recoveryAndRebindPromise
  expect(h.collectReply).toHaveBeenCalledWith(run)
  expect(h.startSubmission).not.toHaveBeenCalled()
})
it('CA-055 settles the original pure file observation after a successful same-input reread, retaining unknown writes', async () => {
  const read = { callId: 'r', call: { name: 'file.read', input: { path: 'a.txt' } }, state: 'executing' }
  const write = { callId: 'w', call: { name: 'file.write', input: { path: 'a.txt', content: 'x' } }, state: 'executing' }
  const previous = { runId: 'old', input: { conversationId: 'c', documents: [] }, tools: [read, write] }
  const current = { runId: 'new', taskContinuedFrom: 'old', input: { conversationId: 'c', documents: [] }, tools: [{ ...read, state: 'returned', result: { kind: 'read', data: 'x' } }] }
  const h = Object.assign(Object.create(ExecutionEngine.prototype), { options: { registry: { list: () => [] } }, read: async () => previous, reconcileReceipts: async () => {} })
  const settled = await (h as any).settlementRecord(current)
  expect(settled.tools.map((tool: any) => `${tool.sourceRunId}:${tool.callId}`)).toEqual(['old:w', 'new:r'])
})
it('CA-053 consumes an accepted adjustment arriving during terminal body-stream evidence and continues the real drive loop', async () => {
  let release!: () => void, entered!: () => void, modelCalls = 0, ids = 0
  const evidence = new Promise<void>(resolve => { release = resolve }), observing = new Promise<void>(resolve => { entered = resolve })
  const selection = { model: 'fixture', connection: { id: 'c', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://example.org', accountId: 'a', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } } }
  const record = { runId: 'r', status: 'running', input: { conversationId: 'c', instruction: 'original', documents: [], selection }, initialMessageCount: 0, messages: [], requests: [], tools: [] } as any
  const active = { record, tools: [], streams: new Map(), controller: new AbortController(), stopped: false, permission: 'workspace' } as any
  const h = Object.assign(Object.create(ExecutionEngine.prototype), {
    active: new Map([['r', active]]), displayBuffers: new Map(), browserPauses: new Map(), id: () => `id-${++ids}`, now: () => 1,
    options: { runs: { read: async () => structuredClone(record) }, gateway: { stop: async () => {} }, serializePayload: () => '{}',
      observeBodyStreaming: async () => { entered(); await evidence }, provider: { async *stream(request: any) { modelCalls++; yield { requestId: request.requestId, type: 'response.completed', responseId: 'response', assistant: { role: 'assistant', content: null }, finishReason: modelCalls === 1 ? 'length' : 'stop',
        toolCalls: modelCalls === 1 ? [{ id: 'edit', name: 'text.replace', argumentsText: '{"target":"fixture-target","content":"changed"}' }] : [] } } } },
    checkpoint: async () => {}, event: async () => {}, timing: () => {}, waitForBrowser: async () => {}, refreshTools: async () => {},
    prepareContext: async () => [{ role: 'user', content: 'fixture' }], visibleChangedContentFacts: () => [],
    execute: async (_active: any, tool: any) => { tool.state = 'returned'; tool.result = { kind: 'document-operation', affected: [], result: { status: 'applied', documentId: 'd', operationId: 'o', beforeRevision: 0, revision: 1, persistence: 'recoverable' } } },
    abortPreviews: () => {}, preserveArgumentDrafts: () => {}, waitForRunningJobs: async () => false,
    settlementRecord: async () => ({ ...record, tools: [] }), publishEnd: async () => {},
  }) as any
  const driving = h.drive(active); await observing
  await h.steer('r', 'adjustment', '按新要求继续')
  release(); await driving
  expect(record.steering[0]).toMatchObject({ submissionId: 'adjustment', messageIndex: expect.any(Number), appliedAt: 1 })
  expect(record.messages).toEqual(expect.arrayContaining([{ role: 'user', content: '按新要求继续' }]))
  expect(modelCalls).toBe(2); expect(record.status).toBe('completed')
})
