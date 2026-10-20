// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { executionCompletionIssues, type SettledExecutionRun } from '../../src/main/workbench/execution/executionOutcome'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'

it('retires a terminated ancestor read without inventing verification, preserving unknown writes and current save/export facts', async () => {
  const base = path.resolve('output/creation-boundary-implementation-20261020/settlement')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'run-')), driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: { async append() {}, async save() { throw new Error('No disk writes in this fixture') } },
    createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(driver.load(new TextEncoder().encode('Current source')), 'fixture.md')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID), runs = new ExecutionRunStore(path.join(directory, 'runs'))
  const input = { conversationId: 'lineage', taskId: 'same-task', instruction: 'Verify current view', selection: {} as ExecutionRunRecord['input']['selection'],
    documents: [{ documentId: session.documentId, writable: [] }] }
  const oldTool = (name: string, callId: string): ExecutionToolRecord => ({ callId, providerCallId: callId, requestId: 'old-request',
    call: { name, input: { target: 'retired-handle' } }, state: 'executing' })
  const previous: ExecutionRunRecord = { schemaVersion: 1, runId: 'ancestor', version: 1, input, status: 'stopped', createdAt: 1, updatedAt: 2,
    messages: [], initialMessageCount: 0, requests: [], tools: [oldTool('read', 'old-read'), oldTool('view.observe', 'old-view'), oldTool('text.replace', 'unknown-write')] }
  const current: ExecutionRunRecord = { ...structuredClone(previous), runId: 'current', status: 'completed', taskContinuedFrom: 'ancestor', tools: [
    { callId: 'save', providerCallId: 'save', requestId: 'current-request', call: { name: 'project.save', input: {} }, state: 'returned', result: { kind: 'read',
      data: { status: 'saved', documentId: 'saved-doc', epoch: 'saved-epoch', savedRevision: 13, currentRevision: 13, dirty: false, path: 'current.glx' } } },
    { callId: 'export', providerCallId: 'export', requestId: 'current-request', call: { name: 'document.export', input: { format: 'html-offline' } }, state: 'returned', result: { kind: 'read',
      data: { status: 'written', documentId: 'saved-doc', epoch: 'saved-epoch', exportedRevision: 13, currentRevision: 13, format: 'html-offline', path: 'current.html' } } },
  ] }
  await gateway.beginRun({ runId: 'ancestor', actor: 'agent', documents: input.documents })
  await gateway.stop('ancestor')
  await gateway.beginRun({ runId: 'current', actor: 'agent', documents: input.documents })
  await runs.save(previous); await runs.save(current)
  const engine = new ExecutionEngine({ registry, gateway, runs, events: new ExecutionEventStore({ directory: path.join(directory, 'events') }),
    provider: { async *stream() { throw new Error('No model is needed for settlement') } } })
  const settled = await (engine as unknown as { settlementRecord(record: ExecutionRunRecord): Promise<SettledExecutionRun> }).settlementRecord(current)
  expect(settled.tools.find(tool => tool.callId === 'old-read')).toMatchObject({ retiredReadAttempt: { verificationRequired: false } })
  expect(settled.tools.find(tool => tool.callId === 'old-view')).toMatchObject({ retiredReadAttempt: { verificationRequired: true } })
  const issues = executionCompletionIssues(settled)
  expect(issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ callId: 'old-read' })]))
  expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ callId: 'old-view', status: 'unverified' }),
    expect.objectContaining({ callId: 'unknown-write', status: 'pending' })]))
  expect(issues.filter(issue => issue.status === 'unsaved' || issue.name === 'task.delivery')).toEqual([])
  expect((await runs.read('ancestor'))!.tools[0]!.state).toBe('executing')
  await writeFile(path.join(directory, 'facts.json'), JSON.stringify({ issues, originalAttemptUnchanged: true, savedRevision: 13, exportedRevision: 13 }, null, 2))
})
