// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionEvent } from '../../src/shared/workbench/executionEvents'

// The carrier's real Edge login/cookie/snapshot behavior is covered separately.
// Desktop ownership, provider parsing, pause barriers, tool execution and resume remain real here.
const carrier = vi.hoisted(() => ({ control: vi.fn() }))
vi.mock('../../src/main/workbench/workbenchToolServices.js', () => ({ controlWorkbenchBrowser: carrier.control }))

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
  vi.restoreAllMocks(); carrier.control.mockReset()
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function encryption(): CredentialEncryptionPort {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString(value) {
      const bytes = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
}
function response(delta: unknown, reason: 'tool_calls' | 'stop') {
  return new Response(`data: ${JSON.stringify({ id: 'local-response', model: 'local-fixture',
    choices: [{ index: 0, delta, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`,
  { headers: { 'Content-Type': 'text/event-stream' } })
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-browser-execution-'))
  cleanup.push(async () => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup path')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  })
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace)
  const firstRequest = deferred(), releaseFirstResponse = deferred(), firstResponseProcessed = deferred(), waitingObserved = deferred()
  const requests: Array<{ messages: Array<{ role: string; content?: string }> }> = []
  const localFetch: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)))
    if (requests.length === 1) {
      firstRequest.resolve(); await releaseFirstResponse.promise
      return response({ role: 'assistant', tool_calls: [{ index: 0, id: 'after-login-note', type: 'function',
        function: { name: modelToolWireName('task.note'), arguments: JSON.stringify({ remaining: ['read the resumed page'] }) } }] }, 'tool_calls')
    }
    return response({ role: 'assistant', content: 'Original task continued.' }, 'stop')
  }
  const documents = new DocumentHostService(path.join(root, 'journals'))
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: encryption() })
  const saved = await settings.saveConnection({ apiKey: 'local-fixture-secret', connection: {
    provider: 'local-fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'local-fixture',
    authKind: 'api-key', billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ expectedRevision: 0, roles: {
    conversation: { connectionId: saved.connection.id, model: 'local-fixture' }, vision: null, imageGenerate: null, imageEdit: null,
  } })
  const desktop = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings,
    authorizeWorkspaceRoot: async input => ({ resolvedPath: await fs.realpath(input) }), fetch: localFetch })
  const events: ExecutionEvent[] = []
  desktop.setSinks(event => {
    events.push(event)
    if (event.type === 'run.state' && event.data.status === 'waiting') waitingObserved.resolve()
  })
  const recordTiming = desktop.events.recordTiming.bind(desktop.events)
  vi.spyOn(desktop.events, 'recordTiming').mockImplementation(mark => {
    if (mark.stage === 'request.finished' && mark.detail?.outcome === 'completed') firstResponseProcessed.resolve()
    return recordTiming(mark)
  })
  const space = await desktop.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const workspaceId = space.workspace.workspaceId
  const conversation = await desktop.operate({ type: 'create-conversation', workspaceId }) as { conversationId: string; revision: number }
  const conversationId = conversation.conversationId
  const sent = await desktop.operate({ type: 'send', workspaceId, conversationId, submissionId: randomUUID(),
    expectedRevision: conversation.revision, text: 'Continue this task after browser login.', documents: [] }) as { run: ExecutionRunRecord }
  const runId = sent.run.runId
  cleanup.push(async () => { releaseFirstResponse.resolve(); await desktop.engine.stop(runId) })
  await firstRequest.promise
  const control = (action: 'status' | 'takeover' | 'resume') => desktop.operate({ type: 'browser-control', workspaceId, conversationId, runId, action })
  const assertPaused = async () => {
    releaseFirstResponse.resolve(); await firstResponseProcessed.promise
    // Pause acknowledgement queues display asynchronously; observe its actual durable event.
    await waitingObserved.promise
    let settled = false
    void desktop.engine.wait(runId).then(() => { settled = true })
    await desktop.events.flushPending()
    expect(settled).toBe(false)
    expect(requests).toHaveLength(1)
    expect((await desktop.engine.read(runId))?.tools).toHaveLength(0)
    expect(events.some(event => event.type === 'run.state' && event.data.status === 'waiting')).toBe(true)
  }
  const assertCompleted = async () => {
    const final = await desktop.engine.wait(runId)
    expect(final.status).toBe('completed')
    expect(final.tools).toMatchObject([{ call: { name: 'task.note' }, state: 'returned' }])
    expect(final.workingNote?.remaining).toEqual(['read the resumed page'])
    expect(requests).toHaveLength(2)
    return final
  }
  return { desktop, runId, requests, events, control, releaseFirstResponse, assertPaused, assertCompleted }
}

it('pauses the real execution through Desktop browser takeover and continues the same run after resume', async () => {
  let state: 'agent' | 'human' = 'agent'
  carrier.control.mockImplementation(async (_runId: string, action: string) => {
    if (action === 'takeover') state = 'human'
    if (action === 'resume') state = 'agent'
    // Takeover needs a page the task has opened.
    return { state, pageUrl: 'https://login.example.test/', snapshotId: state === 'agent' ? 'fresh-observation' : undefined }
  })
  const f = await fixture()
  expect(await f.control('takeover')).toMatchObject({ state: 'human' })
  await f.assertPaused()
  expect(await f.control('resume')).toMatchObject({ state: 'agent', snapshotId: 'fresh-observation' })
  const final = await f.assertCompleted()
  expect(final.runId).toBe(f.runId)
  expect(f.requests[1].messages.some(message => message.role === 'user' && message.content?.includes('旧页面句柄和旧动作批准失效'))).toBe(true)
  expect(carrier.control.mock.calls.map(call => call[1])).toEqual(['status', 'takeover', 'status', 'resume'])
})

it('recovers the paused execution when a failed browser takeover leaves human control and the user retries resume', async () => {
  let state: 'agent' | 'human' = 'agent'
  carrier.control.mockImplementation(async (_runId: string, action: string) => {
    if (action === 'takeover') {
      // Match ManagedBrowserMcpService.control's real failure contract.
      state = 'human'; throw new Error('未能切换原受管浏览器窗口；任务保持暂停，可再次尝试或停止')
    }
    if (action === 'resume') state = 'agent'
    return { state, pageUrl: 'https://login.example.test/', snapshotId: state === 'agent' ? 'fresh-observation' : undefined }
  })
  const f = await fixture()
  await expect(f.control('takeover')).rejects.toThrow('受管浏览器暂时无法接管或读取')
  expect(await f.control('status')).toMatchObject({ state: 'human' })
  await f.assertPaused()
  expect(await f.control('resume')).toMatchObject({ state: 'agent' })
  await f.assertCompleted()
})

it('does not pause the real execution when browser status rejects before takeover starts', async () => {
  carrier.control.mockRejectedValue(new Error('本任务尚未启动受管浏览器'))
  const f = await fixture()
  await expect(f.control('takeover')).rejects.toThrow('受管浏览器暂时无法接管或读取')
  f.releaseFirstResponse.resolve()
  await f.assertCompleted()
  await f.desktop.events.flushPending()
  expect(f.events.some(event => event.type === 'run.state' && event.data.status === 'waiting')).toBe(false)
  // The failed takeover re-reads status to decide whether to unpause; takeover itself is never attempted.
  expect(carrier.control.mock.calls.map(call => call[1])).toEqual(['status', 'status'])
})
