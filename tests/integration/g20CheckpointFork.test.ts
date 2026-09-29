// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { forkDraftFromCheckpoint, indexUserCheckpoint } from '../../src/main/workbench/execution/CheckpointForkService'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const conversation = { conversationId: 'conversation-a', workspaceId: 'workspace-a', revision: 7,
  runIndex: { builtinRunIds: ['run-a'], externalRunIds: [], externalPortIds: ['port-old'] },
  messages: [{ text: 'old private tool data' }], attachmentIds: ['attachment-old'] } as unknown as ConversationRecord
const run = { runId: 'run-a', version: 5, updatedAt: 1234, status: 'partial',
  input: { conversationId: 'conversation-a', instruction: '完善电路课件', permission: 'full',
    documents: [{ documentId: 'doc-a', writable: [{ kind: 'document' }] }],
    selection: { model: 'old-paid-model', connection: { auth: { credentialRef: 'old-secret' } } },
    inputContext: { context: [{ provenance: { id: 'old-grant' } }] } },
  workingNote: { goal: '完善电路课件', userConstraints: [], decisions: [], remaining: ['补充串联实验'], openQuestions: [], risks: [] },
  tools: [{ callId: 'old-call', call: { name: 'file.write' }, result: { status: 'written' } }],
  messages: [{ content: 'private model history' }], requests: [{ requestId: 'old-request' }],
} as unknown as ExecutionRunRecord

describe('M30 U2 checkpoint and fork', () => {
  it('indexes actual conversation and observed content versions without copying document bytes', () => {
    const index = indexUserCheckpoint({ run, conversation, observedAt: 1235, contentVersions: [
      { documentId: 'doc-a', revision: 19 }, { documentId: 'closed-doc', revision: null },
    ] })
    expect(index).toEqual({ conversationId: 'conversation-a', conversationRevision: 7,
      runId: 'run-a', runVersion: 5, runStatus: 'partial', recordedAt: 1235,
      contentVersions: [{ documentId: 'doc-a', revision: 19 }, { documentId: 'closed-doc', revision: null }] })
    expect(JSON.stringify(index)).not.toContain('old-secret')
    expect(() => indexUserCheckpoint({ run, conversation: { ...conversation,
      runIndex: { ...conversation.runIndex, builtinRunIds: [] } }, contentVersions: [] })).toThrow('不属于')
    expect(() => indexUserCheckpoint({ run, conversation, contentVersions: [
      { documentId: 'doc-a', revision: 1 }, { documentId: 'doc-a', revision: 2 },
    ] })).toThrow('无效')
  })

  it('forks a goal draft without old grants, tool calls, provider or queued work', () => {
    const source = indexUserCheckpoint({ run, conversation, contentVersions: [{ documentId: 'doc-a', revision: 19 }] })
    const fork = forkDraftFromCheckpoint({ source, run })
    expect(fork.title).toBe('完善电路课件')
    expect(fork.inputDraft).toContain('完善电路课件')
    expect(fork.advisoryRemaining).toEqual(['补充串联实验'])
    expect(fork.inputDraft).not.toContain('补充串联实验')
    expect(fork.inputDraft).toContain('重新读取当前文件')
    expect(fork.requiresFreshAuthorization).toBe(true)
    expect(fork.replaysPreviousCalls).toBe(false)
    for (const secret of ['old-secret', 'old-paid-model', 'old-grant', 'old-call', 'old-request', 'port-old', 'attachment-old'])
      expect(JSON.stringify(fork)).not.toContain(secret)
    expect(Object.keys(fork).sort()).toEqual(['advisoryRemaining', 'inputDraft', 'replaysPreviousCalls', 'requiresFreshAuthorization', 'source', 'title'])
  })

  it('rejects stale source and keeps a user-adjusted instruction separate from source identity', () => {
    const source = indexUserCheckpoint({ run, conversation, contentVersions: [] })
    expect(() => forkDraftFromCheckpoint({ source: { ...source, runVersion: 4 }, run })).toThrow('已变化')
    const fork = forkDraftFromCheckpoint({ source, run, instruction: '先核对材料，再继续实验页' })
    expect(fork.inputDraft).toContain('先核对材料，再继续实验页')
    expect(fork.source.runId).toBe(run.runId)
  })
})
