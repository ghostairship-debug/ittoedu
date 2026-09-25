import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionSubmissionRecord } from '../../src/shared/workbench/executionDesktop'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { advanceRelResumeManifest, collectRelUsage, createRelRecoveryDirectory, readRelResumeManifest,
  rebuildRelResumeManifest, validateRelRecoveryDirectory, verifyRelResumeLineage, writeRelResumeManifest } from '../e2e/helpers/g20RelMixedRecovery'

describe('REL-T11 recovery evidence', () => {
  it('collects usage beyond the first 500 events without a duplicate page', async () => {
    const cursors: number[] = []
    const events = { events: async (_conversationId: string, after = 0) => {
      cursors.push(after)
      if (after === 0) return { events: Array.from({ length: 500 }, (_, index) => ({
        sequence: index + 1, type: index === 10 ? 'usage' : 'status', data: { request: index + 1 },
      })), cursor: 500, hasMore: true }
      return { events: Array.from({ length: 120 }, (_, index) => ({
        sequence: index + 501, type: index === 119 ? 'usage' : 'status', data: { request: index + 501 },
      })), cursor: 620, hasMore: false }
    } } as unknown as Pick<ExecutionDesktopAPI, 'events'>
    const result = await collectRelUsage(events, 'conversation')
    expect(cursors).toEqual([0, 500])
    expect(result).toMatchObject({ pages: 2, eventCount: 620, cursor: 620, complete: true,
      usage: [{ request: 11 }, { request: 620 }] })
  })

  it('refuses pagination that reports more pages without advancing', async () => {
    const events = { events: async () => ({ events: [], cursor: 0, hasMore: true }) } as unknown as Pick<ExecutionDesktopAPI, 'events'>
    await expect(collectRelUsage(events, 'conversation')).rejects.toThrow('made no progress')
  })

  it('keeps usage from only the verified run lineage in a shared conversation', async () => {
    const events = { events: async () => ({ events: [
      { type: 'usage', runId: 'root', data: { tokens: 3 } },
      { type: 'usage', runId: 'unrelated', data: { tokens: 900 } },
      { type: 'usage', runId: 'leaf', data: { tokens: 5 } },
    ], cursor: 3, hasMore: false }) } as unknown as Pick<ExecutionDesktopAPI, 'events'>
    expect((await collectRelUsage(events, 'conversation', ['root', 'leaf'])).usage)
      .toEqual([{ tokens: 3 }, { tokens: 5 }])
  })

  it('advances an unbounded explicit lineage while preserving root identity and frozen payload', () => {
    const settings = { profileRevision: 1, roles: { conversation: {
      connectionId: 'text', connectionRevision: 1, provider: 'teamorouter', model: 'deepseek-flash', billingKind: 'metered' as const },
      vision: null, imageGenerate: { connectionId: 'image', connectionRevision: 2, provider: 'teamorouter',
        model: 'gpt-image-2', billingKind: 'metered' as const }, imageEdit: null } }
    const run = (index: number) => ({ runId: `run-${index}`, status: index === 2 ? 'failed' : 'partial',
      ...(index ? { continuedFrom: `run-${index - 1}` } : {}), input: { taskId: `submission-${index}`,
        conversationId: 'conversation', workspaceRoot: 'workspace', instruction: 'same task',
        selection: { model: 'deepseek-flash', connection: { provider: 'teamorouter', id: 'text', revision: 1 }, parameters: {} },
        disclosedSettings: settings } }) as ExecutionRunRecord
    const submission = (index: number) => ({ submissionId: `submission-${index}`, runId: `run-${index}`,
      ...(index ? { retryOfRunId: `run-${index - 1}` } : {}), workspaceId: 'space', conversationId: 'conversation',
      text: 'same task', documents: [], attachments: [], permission: 'workspace', state: 'accepted', mode: 'queue',
      model: { provider: 'teamorouter', model: 'deepseek-flash', accountId: 'test', billing: 'metered' },
      createdAt: 1000 + index, updatedAt: 2000 + index }) as ExecutionSubmissionRecord
    const base = { recoveryDirectory: 'private', workspacePath: 'workspace', workspaceId: 'space', conversationId: 'conversation',
      requestedTextModel: 'deepseek-flash' as const, requestedProvider: 'teamorouter' as const,
      requestedImageModel: 'gpt-image-2' as const, requestedImageProvider: 'teamorouter' as const,
      requestedImageProtocol: 'openai-images' as const, imageConnectionId: 'image', imageConnectionRevision: 2 }
    const first = advanceRelResumeManifest(null, { ...base, runId: 'run-0', submissionId: 'submission-0' })
    const second = advanceRelResumeManifest(first, { ...base, runId: 'run-1', submissionId: 'submission-1' })
    const third = advanceRelResumeManifest(second, { ...base, runId: 'run-2', submissionId: 'submission-2' })
    expect(third).toMatchObject({ rootRunId: 'run-0', originalSubmissionId: 'submission-0',
      latestRunId: 'run-2', latestSubmissionId: 'submission-2', runIds: ['run-0', 'run-1', 'run-2'] })
    expect(() => verifyRelResumeLineage(third, [run(0), run(1), run(2)], [submission(0), submission(1), submission(2)])).not.toThrow()
    expect(() => verifyRelResumeLineage(third, [run(0), run(1), run(2)],
      [submission(0), { ...submission(1), text: 'different task' }, submission(2)])).toThrow('frozen task differs')
    expect(() => verifyRelResumeLineage(third, [run(0), run(1), { ...run(2), continuedFrom: 'wrong-parent' }],
      [submission(0), submission(1), submission(2)])).toThrow('durable lineage')
    expect(() => advanceRelResumeManifest(third, { ...base, runId: 'run-2', submissionId: 'again' })).toThrow('repeats')
    expect(() => advanceRelResumeManifest(third, { ...base, imageConnectionRevision: 3,
      runId: 'run-3', submissionId: 'submission-3' })).toThrow('route or workspace changed')
  })

  it.skipIf(process.platform !== 'win32' || !process.env.LOCALAPPDATA)('keeps resume profile outside output and rejects a substituted path', () => {
    const outputRoot = resolve('output/g20/rel-t11')
    mkdirSync(outputRoot, { recursive: true })
    const directory = mkdtempSync(join(outputRoot, 'recovery-test-'))
    const recoveryDirectory = createRelRecoveryDirectory()
    try {
      expect(resolve(recoveryDirectory).startsWith(resolve(process.env.LOCALAPPDATA!, 'Guoling-2.0-rel-t11-recovery'))).toBe(true)
      const workspacePath = join(directory, 'workspace'), filename = join(directory, 'resume.json')
      const manifest = { schemaVersion: 2 as const, recoveryDirectory, workspacePath,
        workspaceId: 'workspace-id', conversationId: 'conversation-id', runId: 'run-id',
        originalSubmissionId: 'submission-id', requestedTextModel: 'deepseek-flash' as const,
        requestedProvider: 'teamorouter' as const, requestedImageModel: 'gpt-image-2' as const,
        requestedImageProvider: 'teamorouter' as const, requestedImageProtocol: 'openai-images' as const,
        imageConnectionId: 'image-connection', imageConnectionRevision: 1,
        maxPaidContinuations: 1 as const, usedPaidContinuations: 0 as const,
        createdAt: new Date().toISOString() }
      writeRelResumeManifest(filename, manifest)
      expect(readRelResumeManifest(filename)).toEqual(manifest)
      expect(readFileSync(filename, 'utf8')).not.toContain('Local State')
      const legacy = { ...manifest, schemaVersion: 1,
        requestedImageProvider: undefined, requestedImageProtocol: undefined,
        imageConnectionId: undefined, imageConnectionRevision: undefined }
      writeFileSync(filename, JSON.stringify(legacy))
      expect(readRelResumeManifest(filename)).toEqual(JSON.parse(JSON.stringify(legacy)))
      writeFileSync(filename, JSON.stringify({ ...manifest, requestedImageProvider: 'openai' }))
      expect(() => readRelResumeManifest(filename)).toThrow('Invalid REL resume image route')
      writeRelResumeManifest(filename, manifest)
      expect(() => validateRelRecoveryDirectory(directory)).toThrow('outside the private recovery root')
      writeFileSync(filename, JSON.stringify({ ...manifest, recoveryDirectory: directory }))
      expect(() => readRelResumeManifest(filename)).toThrow('outside the private recovery root')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(validateRelRecoveryDirectory(recoveryDirectory), { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'win32' || !process.env.LOCALAPPDATA)('rebuilds a consumed manifest only from a complete private journal and send intents', async () => {
    const outputRoot = resolve('output/g20/rel-t11'); mkdirSync(outputRoot, { recursive: true })
    const directory = mkdtempSync(join(outputRoot, 'recovery-test-'))
    const recoveryDirectory = createRelRecoveryDirectory()
    try {
      const workspacePath = join(directory, 'workspace'); mkdirSync(workspacePath)
      const profile = join(recoveryDirectory, 'profile', 'workbench-v2')
      const runsPath = join(profile, 'runs'), submissionsPath = join(profile, 'submissions')
      mkdirSync(runsPath, { recursive: true }); mkdirSync(submissionsPath, { recursive: true })
      const disclosedSettings = { profileRevision: 1, roles: { conversation: {
        connectionId: 'text', connectionRevision: 1, provider: 'teamorouter', model: 'deepseek-flash', billingKind: 'metered' },
        vision: null, imageGenerate: { connectionId: 'image', connectionRevision: 1, provider: 'teamorouter',
          model: 'gpt-image-2', billingKind: 'metered' }, imageEdit: null } }
      for (const index of [0, 1, 2]) {
        const runId = `run-${index}`, submissionId = `submission-${index}`
        const run = { schemaVersion: 1, runId, version: 1, status: index === 2 ? 'failed' : 'partial',
          ...(index ? { continuedFrom: `run-${index - 1}` } : {}), createdAt: 1000 + index, updatedAt: 2000 + index,
          input: { taskId: submissionId, conversationId: 'conversation', workspaceRoot: workspacePath,
            instruction: 'same task', selection: { model: 'deepseek-flash', connection: { id: 'text', revision: 1,
            provider: 'teamorouter', imageProtocol: 'openai-images' }, parameters: {} }, disclosedSettings },
          messages: [], initialMessageCount: 0, requests: [], tools: [] }
        const submission = { schemaVersion: 1, submissionId, workspaceId: 'space', conversationId: 'conversation',
          runId, ...(index ? { retryOfRunId: `run-${index - 1}` } : {}), state: 'accepted', mode: 'queue',
          digest: `digest-${index}`, start: { taskId: submissionId, conversationId: 'conversation' },
          text: 'same task', documents: [], attachments: [], attachmentIds: [], permission: 'workspace',
          model: { provider: 'teamorouter', model: 'deepseek-flash', accountId: 'test', billing: 'metered' },
          createdAt: 1000 + index, updatedAt: 2000 + index }
        const file = (id: string) => `${createHash('sha256').update(id).digest('hex')}.json`
        writeFileSync(join(runsPath, file(runId)), JSON.stringify(run))
        writeFileSync(join(submissionsPath, file(submissionId)), JSON.stringify(submission))
        writeFileSync(join(directory, `send-intent-${submissionId}.json`), JSON.stringify({ submissionId,
          retryOfRunId: index ? `run-${index - 1}` : null, attempted: true }))
      }
      const filename = join(directory, 'resume.json')
      const rebuilt = await rebuildRelResumeManifest({ filename, recoveryDirectory, rootRunId: 'run-0' })
      expect(rebuilt).toMatchObject({ schemaVersion: 3, runIds: ['run-0', 'run-1', 'run-2'],
        latestRunId: 'run-2', latestSubmissionId: 'submission-2' })
      expect(readRelResumeManifest(filename)).toEqual(rebuilt)
      writeFileSync(join(directory, 'send-intent-orphan.json'), JSON.stringify({ submissionId: 'orphan',
        retryOfRunId: 'run-2', attempted: true }))
      await expect(rebuildRelResumeManifest({ filename, recoveryDirectory, rootRunId: 'run-0' }))
        .rejects.toThrow('no confirmed run')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(validateRelRecoveryDirectory(recoveryDirectory), { recursive: true, force: true })
    }
  })
})
