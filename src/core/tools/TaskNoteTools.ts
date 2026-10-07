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
  description: '更新本次任务的简短工作笔记：已作取舍、待办、待确认和风险。只写当前 run 的检查点，不修改用户原话、冻结约束、权限、文档或真实工具回执。笔记中的“完成”不作为交付证明。sourceRefs 可省略；需要引用时使用 task:instruction 或已返回工具的调用编号，宿主自动定位来源。',
  inputSchema: z.toJSONSchema(taskNoteInputSchema) as ModelToolDefinition['inputSchema'],
}

export const taskFinishInputSchema = z.object({}).strict()
/** Engine run control; it does not register a document operation or change a grant. */
export const taskFinishTool: ModelToolDefinition = {
  name: 'task.finish',
  description: '结束本轮任务。可以在同一响应中先给出写入工具，再把 task.finish({}) 放在最后，软件按顺序核实实际回执后结束，不需要再请求一轮总结。工作完整时返回 completed；同一响应中刚出现失败或必要验证缺口时，先返回具体结果供下一轮判断，不直接结束。模型已读到确定失败、未保存内容或无法取得的必要验证后，仍明确结束的，可返回 partial 并列出实际缺口，不必反复尝试无法获得的证据。工具尚未返回、原作业仍在运行或结果未知时仍须读取原结果，不能结束或重放。此工具不修改正文、不保存文件，也不能将未提交内容或未验证结果声明为完成。',
  inputSchema: z.toJSONSchema(taskFinishInputSchema) as ModelToolDefinition['inputSchema'],
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

function resolveSources(record: ExecutionRunRecord, decisions: WorkingNote['decisions']) {
  const references = new Map<string, string>([['task:instruction', 'task:instruction']])
  for (const tool of record.tools) if (tool.state === 'returned' && tool.result) {
    for (const id of [tool.callId, tool.providerCallId]) {
      references.set(id, `tool:${tool.callId}`)
      references.set(`tool:${id}`, `tool:${tool.callId}`)
    }
  }
  const diagnostics: string[] = []
  const resolved = decisions.map(entry => {
    if (!entry.sourceRefs) return entry
    const sourceRefs = entry.sourceRefs.flatMap(reference => {
      const source = references.get(reference)
      if (!source) diagnostics.push(`工作笔记来源未定位：${reference}；已保留笔记内容，可省略来源或引用已返回工具`)
      return source ? [source] : []
    })
    return { ...entry, sourceRefs: [...new Set(sourceRefs)] }
  })
  return { decisions: resolved, diagnostics }
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
  // Provider-visible call IDs and internal IDs identify the same returned source.
  // An advisory citation problem does not discard an otherwise useful note.
  const sources = input.decisions ? resolveSources(record, input.decisions) : undefined
  const note = checked({ ...prior,
    ...(sources ? { decisions: sources.decisions } : {}),
    ...(input.remaining !== undefined ? { remaining: input.remaining } : {}),
    ...(input.openQuestions !== undefined ? { openQuestions: input.openQuestions } : {}),
    ...(input.risks !== undefined ? { risks: input.risks } : {}),
  })
  return { note, result: { kind: 'read', data: { workingNote: note, authority: 'advisory-run-note',
    instructionSource: 'run.input.instruction', persistedBy: 'next-run-checkpoint',
    ...(sources?.diagnostics.length ? { diagnostics: sources.diagnostics } : {}) } } }
}
