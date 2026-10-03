// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionChangeReviewService } from '../../src/main/workbench/review/ExecutionChangeReviewService'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
const version = (text: string) => `sha256:${createHash('sha256').update(Buffer.from(text)).digest('hex')}`

const selection: ModelSelection = { model: 'local-change-review-fixture', connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
  accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused-local-fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' },
} }
type Call = { id: string; name: string; argumentsText: string }
function complete(request: ModelRequest, calls: Call[]): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'local-response',
    actualModel: 'local-change-review-fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: calls.length ? '' : '修改完成', ...(calls.length ? {
      tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
        function: { name: call.name, arguments: call.argumentsText } })),
    } : {}) } }
}

it('backs review with a real engine run and rolls files back one by one without touching conflicts', async () => {
  const output = path.resolve('output/g20/m30/change-review-engine-chain-20261002')
  await fs.mkdir(output, { recursive: true })
  const directory = await fs.mkdtemp(path.join(output, 'fixture-'))
  roots.push(directory)
  const workspaceRoot = path.join(directory, 'workspace')
  await fs.mkdir(workspaceRoot, { recursive: true })
  const alpha = path.join(workspaceRoot, 'alpha.md')
  const beta = path.join(workspaceRoot, 'beta.md')
  await fs.writeFile(alpha, 'alpha-1\n')
  await fs.writeFile(beta, 'beta-1\n')
  const host = new DocumentHostService(path.join(directory, 'host'))
  const registry = host.registry
  const gateway = host.tools
  const files = new AgentFileService(host)
  const changeReview = new ExecutionChangeReviewService(host, path.join(directory, 'review'))
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    yield complete(request, ++turns === 1 ? [
      { id: 'write-alpha', name: 'file.write', argumentsText: JSON.stringify({ mode: 'replace', path: 'alpha.md', content: 'alpha-2\n', expectedVersion: version('alpha-1\n') }) },
      { id: 'write-beta', name: 'file.write', argumentsText: JSON.stringify({ mode: 'replace', path: 'beta.md', content: 'beta-2\n', expectedVersion: version('beta-1\n') }) },
    ] : [])
  } }
  const runDirectory = path.join(directory, 'runs')
  const engine = new ExecutionEngine({ registry, gateway, provider, files, changeReview,
    runs: new ExecutionRunStore(runDirectory), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const started = await engine.start({ conversationId: 'review-chain', taskId: 'multi-file-edit',
    instruction: '同时修改 alpha 与 beta', selection, documents: [], permission: 'workspace', workspaceRoot })
  const finished = await engine.wait(started.runId)
  expect(finished.status).toBe('completed')
  // Read the receipt back from the engine's own run store, not a fabricated record.
  const stored = await new ExecutionRunStore(runDirectory).read(started.runId)
  if (!stored) throw new Error('engine run receipt was not persisted')
  const page = await changeReview.inspect(stored, { limit: 10 })
  const alphaEntry = page.entries.find(entry => entry.path === alpha)
  const betaEntry = page.entries.find(entry => entry.path === beta)
  if (!alphaEntry || !betaEntry) throw new Error('review page missing engine receipts')
  expect(alphaEntry).toMatchObject({ status: 'applied', availability: 'ready', path: alpha })
  expect(betaEntry).toMatchObject({ status: 'applied', availability: 'ready', path: beta })
  // File-by-file rollback: only alpha reverts; beta keeps both the applied content and its own intact receipt.
  const alphaRollback = await changeReview.rollback(stored, alphaEntry.entryId, { workspaceRoot, permission: 'workspace' })
  expect(alphaRollback).toMatchObject({ status: 'reverted', saved: true })
  expect(await fs.readFile(alpha, 'utf8')).toBe('alpha-1\n')
  expect(await fs.readFile(beta, 'utf8')).toBe('beta-2\n')
  const pageAfterAlpha = await changeReview.inspect(stored, { limit: 10 })
  expect(pageAfterAlpha.entries.find(entry => entry.path === beta)).toMatchObject({ status: 'applied', availability: 'ready' })
  // Conflict refusal: a later human edit means the file no longer matches the recorded after-version.
  await fs.writeFile(beta, 'beta-human\n')
  const betaConflict = await changeReview.rollback(stored, betaEntry.entryId, { workspaceRoot, permission: 'workspace' })
  expect(betaConflict.status).toBe('conflict')
  expect(await fs.readFile(beta, 'utf8')).toBe('beta-human\n')
  await fs.writeFile(path.join(output, 'm30-t01-change-review-engine-chain-facts.json'), JSON.stringify({
    runId: started.runId, localProviderOnly: true, networkRequests: 0, completedRun: finished.status === 'completed',
    receipts: page.entries.length, files: page.files.length,
    alpha: { status: alphaEntry.status, availability: alphaEntry.availability, rollback: alphaRollback.status, content: 'alpha-1\\n' },
    beta: { status: betaEntry.status, availability: betaEntry.availability, keptAfterSiblingRevert: 'beta-2\\n',
      conflictOnHumanEdit: betaConflict.status, preserved: 'beta-human\\n' },
  }, null, 2) + '\n')
})
