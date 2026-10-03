// @vitest-environment node
/**
 * Engine recover async split (M-follow-up): ready() must return after the fast
 * segment while engine.recover and submission rebinding run in the background.
 * Submit paths await recovery so a user click never observes a stale run
 * history. Terminal runs produce only the idempotent run.end event during
 * recover(); reconcileReceipts/publishCommit stayed behind for resume().
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }

function encryption(): CredentialEncryptionPort {
  return {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(text, 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8'),
  }
}

function terminalRun(status: 'completed' | 'failed' | 'stopped' | 'interrupted' | 'partial', taskId: string): ExecutionRunRecord {
  const now = Date.now()
  const input: ExecutionStart = { conversationId: 'conversation-fixture', taskId, instruction: 'fixture', selection, documents: [] }
  return { schemaVersion: 1, runId: randomUUID(), version: 1, input,
    status, createdAt: now, updatedAt: now, messages: [], initialMessageCount: 0, requests: [], tools: [] }
}

async function engineFixture(runsCount: number) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-ready-async-engine-')); roots.push(root)
  const driver = new MarkdownDriver()
  const journal = createDocumentJournal({ directory: path.join(root, 'documents') })
  const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const edits = new EditSessionService(registry, gateway)
  const runs = new ExecutionRunStore(path.join(root, 'runs'))
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  // 8-981KB scale: add slightly different payload sizes so recover walks a non-trivial record set.
  for (let index = 0; index < runsCount; index += 1) {
    const record = terminalRun('completed', `task-${index}`)
    record.compacted = { atRequest: 0, facts: 'x'.repeat(4096 + index * 4096) }
    await runs.save(record)
  }
  const engine = new ExecutionEngine({ registry, gateway, edits, runs, events,
    provider: { retrySafety: 'pure-generation', async *stream() { throw new Error('no model call expected during recover') } },
    serializePayload: request => JSON.stringify(request) })
  return { root, registry, gateway, edits, runs, events, engine }
}

describe('G20 engine.recover terminal fast path', () => {
  it('publishes only the idempotent run.end event for terminal records and never reconciles receipts', async () => {
    const h = await engineFixture(12)
    const publishEnd = vi.spyOn(h.engine as unknown as { publishEnd(record: ExecutionRunRecord): Promise<void> }, 'publishEnd')
    const reconcileReceipts = vi.spyOn(h.engine as unknown as { reconcileReceipts(record: ExecutionRunRecord): Promise<void> }, 'reconcileReceipts')
    const publishCommit = vi.spyOn(h.engine as unknown as { publishCommit(...args: unknown[]): Promise<void> }, 'publishCommit')
    const recovered = await h.engine.recover()
    expect(recovered).toEqual([])
    expect(publishEnd).toHaveBeenCalledTimes(12)
    expect(reconcileReceipts).not.toHaveBeenCalled()
    expect(publishCommit).not.toHaveBeenCalled()
    // Idempotent: a second recover publishes no additional run.end.
    const beforeSecondPass = publishEnd.mock.calls.length
    const eventsFirstPass = (await h.events.readPage({ conversationId: 'conversation-fixture' })).events
    expect(eventsFirstPass.filter(event => event.type === 'run.end')).toHaveLength(12)
    vi.spyOn(h.events, 'findEvent')
    const recoveredAgain = await h.engine.recover()
    const eventsAfterSecondPass = (await h.events.readPage({ conversationId: 'conversation-fixture' })).events
    expect(recoveredAgain).toEqual([])
    expect(publishEnd).toHaveBeenCalledTimes(beforeSecondPass + 12) // publishEnd is still invoked; it short-circuits inside findEvent.
    expect(eventsAfterSecondPass.filter(event => event.type === 'run.end')).toHaveLength(12)
    expect(reconcileReceipts).not.toHaveBeenCalled()
    expect(publishCommit).not.toHaveBeenCalled()
  })
})

describe('G20 desktop ready() async recovery split', () => {
  it('unlocks workspace and create-conversation before background recovery settles; send waits', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-ready-async-')); roots.push(root)
    const workspace = path.join(root, 'workspace')
    await fs.mkdir(workspace)
    const documents = new DocumentHostService(path.join(root, 'journals'))
    const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: encryption() })
    const authorizeWorkspaceRoot = vi.fn(async (input: string) => ({ resolvedPath: await fs.realpath(input) }))
    // Pre-populate ten terminal runs so the background segment has measurable work.
    const terminalRuns: ExecutionRunRecord[] = []
    for (let index = 0; index < 12; index += 1) {
      const record = terminalRun('completed', `task-${index}`)
      record.compacted = { atRequest: 0, facts: 'y'.repeat(32 * 1024) }
      terminalRuns.push(record)
    }
    // Stage them on disk *after* the service exists but before ready is invoked.
    const runsDirectory = path.join(root, 'desktop', 'runs')
    const runStore = new ExecutionRunStore(runsDirectory)
    for (const record of terminalRuns) await runStore.save(record)
    const service = new ExecutionDesktopService({
      directory: path.join(root, 'desktop'), documents, settings, authorizeWorkspaceRoot,
      fetch: async () => { throw new Error('no network expected in ready split test') },
    })
    // Spy on the slow segment so we can assert ready resolves before recovery completes.
    let backgroundGate!: () => void
    const backgroundPromise = new Promise<void>(resolve => { backgroundGate = resolve })
    const recoverSpy = vi.spyOn(service.engine, 'recover').mockImplementation(async () => {
      await backgroundPromise
      return []
    })
    const startedAt = Date.now()
    const space = (await service.operate({ type: 'workspace', root: workspace })) as { workspace: { workspaceId: string } }
    expect(space.workspace.workspaceId).toBeTruthy()
    expect(Date.now() - startedAt, 'ready must not wait for engine.recover').toBeLessThan(500)
    // create-conversation is part of the fast list and is usable before recovery completes.
    const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
    expect(conversation.conversationId).toBeTruthy()
    // Background recovery has not yet been released; engine.recover itself did what the spy asked.
    expect(recoverSpy).toHaveBeenCalled()
    // A submit-path operation (here: read conversation which is not on the fast list) awaits recovery.
    let released = false
    const conversationRead = service.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId })
      .then(value => { released = true; return value })
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(released, 'non-fast operations must wait for recovery').toBe(false)
    backgroundGate()
    await conversationRead
    expect(released).toBe(true)
  })
})
