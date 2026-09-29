import { z } from 'zod'
import type { ExecutionRunRecord, ExecutionStart, WorkingNote } from '../../shared/workbench/execution'
import type { ModelToolDefinition } from '../../shared/workbench/modelProvider'
import type { ToolResult } from '../../shared/workbench/tools'

const MAX_GOAL_CHARS = 3_000
const MAX_NOTE_BYTES = 16 * 1024
const line = z.string().trim().min(1).max(600)
const decision = z.object({ text: line, reason: line.optional(),
  sourceRefs: z.array(z.string().min(1).max(180)).max(8).optional() }).strict()
const noteSchema = z.object({ goal: z.string().max(MAX_GOAL_CHARS),
  userConstraints: z.array(line).max(16), decisions: z.array(decision).max(16),
  remaining: z.array(line).max(24), openQuestions: z.array(line).max(12), risks: z.array(line).max(12) }).strict()

/** Replaces only supplied model-owned sections. No goal, user constraint, permission or result field is accepted. */
export const taskNoteInputSchema = z.object({
  decisions: z.array(decision).max(16).optional(),
  remaining: z.array(line).max(24).optional(),
  openQuestions: z.array(line).max(12).optional(),
  risks: z.array(line).max(12).optional(),
}).strict()

export const taskNoteTool: ModelToolDefinition = {
  name: 'task.note',
  description: '更新本次任务的简短工作笔记：已作取舍、待办、待确认和风险。只写当前 run 的检查点，不修改用户原话、冻结约束、权限、文档或真实工具回执。笔记中的“完成”不作为交付证明。sourceRefs 只接受 task:instruction 或已返回的 tool:<callId>。',
  inputSchema: z.toJSONSchema(taskNoteInputSchema) as ModelToolDefinition['inputSchema'],
}

/** Host-only initialization; long instructions are explicitly abbreviated in this advisory projection. */
export function initialWorkingNote(input: Pick<ExecutionStart, 'instruction'>, userConstraints: readonly string[] = []): WorkingNote {
  const instruction = input.instruction.trim()
  const goal = instruction.length <= MAX_GOAL_CHARS ? instruction
    : `${instruction.slice(0, MAX_GOAL_CHARS - 35)}…（完整要求以原始用户指令为准）`
  return checked({ goal, userConstraints: [...userConstraints], decisions: [], remaining: [], openQuestions: [], risks: [] })
}

/** Explicit continuation only. Carry prior choices without claiming that old receipts are newly verified. */
export function continuedWorkingNote(previous: ExecutionRunRecord, input: ExecutionStart): WorkingNote {
  if (previous.input.conversationId !== input.conversationId || previous.input.instruction !== input.instruction)
    throw new Error('工作笔记只可续接同一会话的原任务；新请求必须重新建立目标')
  const prior = previous.workingNote ? checked(previous.workingNote) : initialWorkingNote(previous.input)
  return checked({ ...prior, goal: initialWorkingNote(input).goal })
}

function checked(note: WorkingNote): WorkingNote {
  const parsed = noteSchema.parse(note)
  if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > MAX_NOTE_BYTES) throw new Error('工作笔记超过 16 KiB，请缩短条目')
  return parsed
}

function validateSources(record: ExecutionRunRecord, decisions: WorkingNote['decisions']): void {
  const returned = new Set(record.tools.filter(tool => tool.state === 'returned' && !!tool.result).map(tool => `tool:${tool.callId}`))
  for (const entry of decisions) for (const reference of entry.sourceRefs ?? []) {
    if (reference !== 'task:instruction' && !returned.has(reference)) throw new Error(`工作笔记来源引用未由宿主确认：${reference}`)
  }
}

/**
 * Pure preparation for the Engine's single-writer checkpoint. The caller verifies the
 * active stop barrier, assigns `note` to `record.workingNote`, then checkpoints before
 * exposing `result`. This function never writes RunStore or creates a second owner.
 */
export function prepareTaskNote(record: ExecutionRunRecord, raw: unknown, expectedVersion: number):
  { note: WorkingNote; result: ToolResult } {
  if (record.status !== 'running') throw new Error('仅运行中的任务可以更新工作笔记')
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== record.version) throw new Error('运行检查点已变化，请基于当前版本更新工作笔记')
  const input = taskNoteInputSchema.parse(raw)
  if (Object.keys(input).length === 0) throw new Error('工作笔记更新至少需要一个字段')
  const prior = record.workingNote ? checked(record.workingNote) : initialWorkingNote(record.input)
  const note = checked({ ...prior,
    ...(input.decisions !== undefined ? { decisions: input.decisions } : {}),
    ...(input.remaining !== undefined ? { remaining: input.remaining } : {}),
    ...(input.openQuestions !== undefined ? { openQuestions: input.openQuestions } : {}),
    ...(input.risks !== undefined ? { risks: input.risks } : {}),
  })
  // Carried references were validated in their source run. New references must resolve in this run.
  if (input.decisions) validateSources(record, input.decisions)
  return { note, result: { kind: 'read', data: { workingNote: note, authority: 'advisory-run-note',
    instructionSource: 'run.input.instruction', persistedBy: 'next-run-checkpoint' } } }
}
