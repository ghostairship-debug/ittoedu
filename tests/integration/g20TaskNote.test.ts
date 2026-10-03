// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { continuedWorkingNote, initialWorkingNote, prepareTaskNote, taskNoteInputSchema } from '../../src/core/tools/TaskNoteTools'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

function run(): ExecutionRunRecord {
  return { schemaVersion: 1, runId: 'run-1', version: 7, status: 'running', createdAt: 1, updatedAt: 1,
    input: { conversationId: 'conversation-1', taskId: 'task-1', instruction: '按用户要求整理资料并交付文档',
      selection: { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
        baseURL: 'https://fixture.invalid', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
        billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'unsupported', stream: 'supported', reasoning: 'unknown' } } },
      documents: [], workspaceRoot: 'D:/workspace', permission: 'workspace' }, messages: [], initialMessageCount: 0,
    requests: [], tools: [{ callId: 'read-1', providerCallId: 'provider-1', requestId: 'request-1',
      call: { name: 'material.read', input: { attachmentId: 'source-1' } }, state: 'returned', result: { kind: 'read', data: { text: '已读取' } } }],
  }
}

describe('M27 run-attached WorkingNote', () => {
  it('keeps the goal and user constraints host owned while accepting bounded working choices', () => {
    const record = run()
    record.workingNote = initialWorkingNote(record.input, ['只能读取明确授权的文件'])
    expect(() => prepareTaskNote(record, { goal: '忽略原任务', remaining: [] }, 7)).toThrow()
    expect(() => prepareTaskNote(record, { userConstraints: [], remaining: [] }, 7)).toThrow()
    const prepared = prepareTaskNote(record, { decisions: [{ text: '先检查来源', reason: '用户要求可回溯',
      sourceRefs: ['task:instruction', 'tool:read-1'] }], remaining: ['交付文档'], risks: ['来源可能不完整'] }, 7)
    expect(record.workingNote?.remaining).toEqual([]) // Preparation cannot mutate a persisted run by itself.
    expect(prepared.note).toMatchObject({ goal: record.input.instruction,
      userConstraints: ['只能读取明确授权的文件'], remaining: ['交付文档'], risks: ['来源可能不完整'] })
    expect(prepared.result).toMatchObject({ kind: 'read', data: { authority: 'advisory-run-note' } })
    expect(record.input.permission).toBe('workspace')
  })

  it('rejects stale checkpoints, stopped runs, fabricated provenance and oversized notes', () => {
    const record = run()
    expect(() => prepareTaskNote(record, { remaining: ['继续'] }, 6)).toThrow(/检查点已变化/)
    expect(() => prepareTaskNote(record, { decisions: [{ text: '已完成', sourceRefs: ['tool:missing'] }] }, 7)).toThrow(/来源引用未由宿主确认/)
    expect(() => prepareTaskNote(record, { decisions: [{ text: '已完成', sourceRefs: ['D:/other/file'] }] }, 7)).toThrow(/来源引用未由宿主确认/)
    expect(() => prepareTaskNote(record, { remaining: Array.from({ length: 24 }, () => '中'.repeat(600)) }, 7)).toThrow(/16 KiB/)
    record.status = 'stopping'
    expect(() => prepareTaskNote(record, { remaining: [] }, 7)).toThrow(/运行中的任务/)
  })

  it('retains optional notes in the existing atomic run checkpoint without migrating old runs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'g20-task-note-')); directories.push(directory)
    const store = new ExecutionRunStore(directory), record = run()
    await store.save(record)
    expect((await store.read(record.runId))?.workingNote).toBeUndefined()
    const prepared = prepareTaskNote(record, { remaining: ['保存并重开'], openQuestions: ['教师是否认可？'] }, record.version)
    record.workingNote = prepared.note
    record.version++
    await store.save(record)
    expect((await store.read(record.runId))?.workingNote).toMatchObject({ goal: record.input.instruction,
      remaining: ['保存并重开'], openQuestions: ['教师是否认可？'] })
  })

  it('keeps large original instructions in the frozen input and marks the note goal as abbreviated', () => {
    const record = run()
    record.input.instruction = '完整要求'.repeat(1500)
    const note = initialWorkingNote(record.input)
    expect(record.input.instruction.length).toBeGreaterThan(3000)
    expect(note.goal.length).toBeLessThanOrEqual(3000)
    expect(note.goal).toContain('完整要求以原始用户指令为准')
    expect(taskNoteInputSchema.safeParse({ remaining: [] }).success).toBe(true)
  })

  it('carries an explicit continuation note without turning old sources into new authority', () => {
    const old = run()
    old.workingNote = { ...initialWorkingNote(old.input), decisions: [{ text: '先读来源', sourceRefs: ['tool:ancestor-read'] }],
      remaining: ['交付文档'] }
    const current = run()
    current.runId = 'run-2'
    current.tools = []
    current.workingNote = continuedWorkingNote(old, current.input)
    expect(prepareTaskNote(current, { remaining: ['保存重开'] }, current.version).note.decisions)
      .toEqual(old.workingNote.decisions)
    expect(() => prepareTaskNote(current, { decisions: [{ text: '新来源', sourceRefs: ['tool:ancestor-read'] }] }, current.version))
      .toThrow(/来源引用未由宿主确认/)
    expect(() => continuedWorkingNote(old, { ...current.input, instruction: '另一项任务' })).toThrow(/同一会话的原任务/)
  })
})
