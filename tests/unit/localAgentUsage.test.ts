// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { localAgentRecordV2Schema } from '../../src/shared/localAgentTaskContract'
import { localAgentTokenUsageSchema, latestLocalAgentTokenUsage } from '../../src/shared/localAgentUsage'
import { localAgentText } from '../../src/shared/localAgentText'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'

describe('native usage and machine result projection', () => {
  it('preserves changing native totals, unknown reasoning and cache writes through disk and display without summing snapshots', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-record-'))
    try {
      const workspace = createWorkspaceIdentity('usage', path.join(directory, 'usage.h5lesson'))
      const id = randomUUID(), taskId = randomUUID(), runId = randomUUID()
      const counts = { inputTokens: 10, outputTokens: 5, cachedInputTokens: 3, reasoningOutputTokens: null, cacheWriteInputTokens: 2, totalTokens: 15 }
      const usage = (total: number) => localAgentTokenUsageSchema.parse({ version: 1, source: 'codex-app-server', last: counts,
        total: { ...counts, inputTokens: total, outputTokens: total / 2, totalTokens: total * 1.5 } })
      const events = [20, 40].map((total, index) => ({ version: 2, taskId, epoch: 0, workspace, sessionId: id, runId,
        nativeTurnId: 'same-native-turn', sequence: index + 1, time: index, kind: 'usage',
        inputTokens: 10, outputTokens: 5, cachedInputTokens: 3, tokenUsage: usage(total) }))
      const record = localAgentRecordV2Schema.parse({ version: 2, id, adapter: 'codex', workspace, externalSessionId: 'thread', workingDirectoryId: id,
        tasks: [{ version: 1, taskId, epoch: 0, workspace, sessionId: id, adapter: 'codex', goal: 'reply', intent: 'discuss', applyPolicy: 'preview',
          readScope: { kind: 'course' }, writeDestinations: [], status: 'completed', observationId: null, committedResultIds: [] }], observations: [], hostResults: [], events })
      const repository = new LocalAgentRepository(directory)
      await repository.write(record)
      const recovered = await new LocalAgentRepository(directory).list(workspace)
      expect(recovered.damaged).toEqual([])
      expect(recovered.v2[0]!.events).toEqual(record.events)
      const display = recovered.records[0]!.events
      expect(display.filter(event => event.kind === 'usage')).toHaveLength(2)
      expect(latestLocalAgentTokenUsage(display)).toEqual(usage(40))
      expect(latestLocalAgentTokenUsage(display)?.total?.reasoningOutputTokens).toBeNull()
      expect(latestLocalAgentTokenUsage(display)?.total?.cacheWriteInputTokens).toBe(2)
    } finally {
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test path')
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps JSON discussions readable while machine candidates remain available only to the candidate consumer', () => {
    const base = { version: 1 as const, adapter: 'codex' as const, sessionId: randomUUID(), time: 0, kind: 'text' as const }
    const events = [
      { ...base, sequence: 1, payload: { phase: 'body', messageId: 'discussion', text: '{"example":true}' } },
      { ...base, sequence: 2, payload: { phase: 'candidate', messageId: 'candidate', text: '<<<COURSE_CANDIDATE>>>machine<<<END_COURSE_CANDIDATE>>>' } },
    ]
    expect(localAgentText(events)).toBe('{"example":true}')
    expect(localAgentText(events, { includeCandidates: true })).toContain('machine')
    expect(localAgentTokenUsageSchema.safeParse({ version: 2, source: 'codex-app-server', last: null, total: null }).success).toBe(false)
    expect(latestLocalAgentTokenUsage([{ ...base, kind: 'usage', sequence: 1, payload: { input_tokens: 3 } }])).toBeNull()
  })
})
