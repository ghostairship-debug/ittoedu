import type { ConversationRecord } from '../../../shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'

export interface ContentVersionAtCheckpoint {
  documentId: string
  revision: number | null
}

export interface UserCheckpointIndex {
  conversationId: string
  conversationRevision: number
  runId: string
  runVersion: number
  runStatus: ExecutionRunRecord['status']
  recordedAt: number
  /** Observed by the current document owner, not inferred from old writable targets. */
  contentVersions: ContentVersionAtCheckpoint[]
}

export interface ForkDraft {
  title: string
  inputDraft: string
  /** Model-maintained plan is display-only until the user explicitly edits it into the new draft. */
  advisoryRemaining: string[]
  source: UserCheckpointIndex
  /** The caller must create a fresh conversation and use the normal send path. */
  requiresFreshAuthorization: true
  replaysPreviousCalls: false
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

/** A checkpoint is an index into existing owners; it does not copy document content or grants. */
export function indexUserCheckpoint(input: {
  run: ExecutionRunRecord
  conversation: ConversationRecord
  contentVersions: readonly ContentVersionAtCheckpoint[]
  observedAt?: number
}): UserCheckpointIndex {
  const { run, conversation } = input
  if (run.input.conversationId !== conversation.conversationId
    || !conversation.runIndex.builtinRunIds.includes(run.runId)) throw new Error('检查点不属于该会话')
  if (!Number.isSafeInteger(run.version) || run.version < 0
    || !Number.isSafeInteger(conversation.revision) || conversation.revision < 0) throw new Error('检查点版本无效')
  const seen = new Set<string>()
  const contentVersions = input.contentVersions.map(item => {
    if (!item.documentId || seen.has(item.documentId)
      || item.revision !== null && (!Number.isSafeInteger(item.revision) || item.revision < 0))
      throw new Error('内容版本索引无效')
    seen.add(item.documentId)
    return { documentId: item.documentId, revision: item.revision }
  })
  const observedAt = input.observedAt ?? Date.now()
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error('检查点观察时间无效')
  return { conversationId: conversation.conversationId, conversationRevision: conversation.revision,
    runId: run.runId, runVersion: run.version, runStatus: run.status, recordedAt: observedAt,
    contentVersions }
}

/**
 * A fork carries only a human-editable goal draft and a source pointer. It
 * deliberately has no ExecutionStart, permission, target handles, provider
 * selection, attachments, tool calls, jobs or submission ID. The desktop must
 * create a new conversation, then freeze a new task from the user's next send.
 */
export function forkDraftFromCheckpoint(input: {
  source: UserCheckpointIndex
  run: ExecutionRunRecord
  instruction?: string
}): ForkDraft {
  if (input.source.runId !== input.run.runId || input.source.runVersion !== input.run.version
    || input.source.conversationId !== input.run.input.conversationId) throw new Error('来源检查点已变化，请重新选择')
  const instruction = input.instruction?.trim() || input.run.input.instruction.trim()
  if (!instruction) throw new Error('来源任务没有可继续的目标')
  const advisoryRemaining = input.run.workingNote?.remaining.slice(0, 8).map(item => bounded(item.trim(), 300)).filter(Boolean) ?? []
  const lines = [bounded(instruction, 8_000), '', '请先重新读取当前文件、材料和状态，再按本次授权继续。']
  return { title: bounded(input.run.input.instruction.trim() || '继续任务', 80),
    inputDraft: lines.join('\n'), advisoryRemaining, source: structuredClone(input.source),
    requiresFreshAuthorization: true, replaysPreviousCalls: false }
}
