import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExecutionSubmissionStore, type StoredExecutionSubmission } from '../../src/main/workbench/execution/ExecutionSubmissionStore'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

async function fixtureSelection(directory: string): Promise<ExecutionStart['selection']> {
  // This fixture creates only a throwaway local connection; no provider is called.
  const settings = new ExecutionSettingsStore({ directory: path.join(directory, 'fixture-settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: value => Buffer.from(value).toString('utf8'),
  } })
  const saved = await settings.saveConnection({ apiKey: 'fixture-secret', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', authKind: 'api-key',
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ expectedRevision: 0, roles: {
    conversation: { connectionId: saved.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null,
  } })
  return settings.snapshot('conversation')
}

it('freezes file discovery and references in the same durable submission without granting document writes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'guoling-file-context-')); dirs.push(dir)
  const fileContext = { openFiles: [{ path: 'D:\\work\\sales.xlsx', format: 'xlsx', active: true, fileVersion: 'source-1', bindingVersion: 1,
    focus: { sheet: '汇总', range: 'B2' } }], references: [{ path: 'D:\\work\\sales.xlsx', scope: 'range' as const, pinned: false,
    fileVersion: 'source-1', bindingVersion: 1, focus: { sheet: '汇总', range: 'B2' } }] }
  const record: StoredExecutionSubmission = { schemaVersion: 1, submissionId: 's', workspaceId: 'w', conversationId: 'c', state: 'queued',
    mode: 'queue', text: '解释这个单元格', documents: [], attachments: [], attachmentIds: [], permission: 'read-only', digest: 'payload-digest',
    createdAt: 1, updatedAt: 1, model: { provider: 'test', model: 'test', accountId: 'test', billing: 'unknown' }, fileContext,
    start: { conversationId: 'c', taskId: 's', instruction: '解释这个单元格', documents: [], permission: 'read-only',
      selection: await fixtureSelection(dir), fileContext: structuredClone(fileContext) } }
  await new ExecutionSubmissionStore(dir).create(record)
  fileContext.openFiles[0]!.focus.range = 'C3'
  fileContext.references[0]!.focus.range = 'C3'
  const reopened = await new ExecutionSubmissionStore(dir).read('s')
  expect(reopened?.start.fileContext?.references[0]?.focus?.range).toBe('B2')
  expect(reopened?.fileContext).toEqual(reopened?.start.fileContext)
  expect(reopened?.start.documents).toEqual([])
  expect(reopened?.start.boundReadPaths).toBeUndefined()
  expect(reopened?.start.permission).toBe('read-only')
})

it('rejects a saved submission whose visible references differ from the run freeze', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'guoling-file-context-mismatch-')); dirs.push(dir)
  const record: StoredExecutionSubmission = { schemaVersion: 1, submissionId: 's', workspaceId: 'w', conversationId: 'c', state: 'queued', mode: 'queue',
    text: 't', documents: [], attachments: [], attachmentIds: [], digest: 'd', createdAt: 1, updatedAt: 1,
    model: { provider: 'test', model: 'test', accountId: 'test', billing: 'unknown' }, fileContext: { openFiles: [], references: [] },
    start: { conversationId: 'c', taskId: 's', instruction: 't', documents: [], selection: await fixtureSelection(dir) } }
  await expect(new ExecutionSubmissionStore(dir).create(record)).rejects.toThrow('文件引用的冻结上下文不一致')
})
