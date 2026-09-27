import { describe, expect, it, vi } from 'vitest'
import type { DynamicFallbackIntent, DynamicFallbackResult } from '../../src/renderer/composition/runtime/precommitDynamicFallback'
import { runSlideDynamicFallbackSubmission } from '../../src/renderer/ui/workspaces/SlideLocationWorkspace'

vi.mock('../../src/renderer/phaser/createEditorGame', () => ({ createEditorGame: vi.fn() }))

const intent: DynamicFallbackIntent = {
  kind: 'component.text',
  documentId: 'document-1',
  projectId: 'project-1',
  locationId: 'location-1',
  itemId: 'component-1',
  original: 'Before',
  text: 'After',
}

const labels = { pending: '准备中，尚未写入', applied: '已更新', unchanged: '没有变化' }

describe('Slide dynamic fallback submission feedback', () => {
  it('does not report an edit as applied until the frozen submission settles', async () => {
    let settle!: (result: DynamicFallbackResult) => void
    const settled = new Promise<DynamicFallbackResult>(resolve => { settle = resolve })
    const submit = vi.fn(() => ({ taskId: 'task-1', settled }))
    const setStatus = vi.fn()
    const result = runSlideDynamicFallbackSubmission(intent, submit, setStatus, labels)

    expect(submit).toHaveBeenCalledExactlyOnceWith(intent)
    expect(setStatus.mock.calls.map(([message]) => message)).toEqual([labels.pending])

    settle({ status: 'applied', receipt: {} } as DynamicFallbackResult)
    await expect(result).resolves.toBe('applied')
    expect(setStatus.mock.calls.map(([message]) => message)).toEqual([labels.pending, labels.applied])
  })

  it('describes each unresolved receipt without claiming an unknown write failed', async () => {
    for (const [status, expected] of [
      ['failed', '版本冲突 未写入修改'],
      ['conflict', '版本冲突 未写入修改'],
      ['blocked', '版本冲突 当前修改尚未处理，请先处理前序任务'],
      ['unknown', '版本冲突 提交结果尚未确认，请重试核实'],
    ] as const) {
      const setStatus = vi.fn()
      const submit = vi.fn(() => ({
        taskId: 'task-2',
        settled: Promise.resolve({ status, reason: '版本冲突', taskId: 'task-2' } as DynamicFallbackResult),
      }))
      await expect(runSlideDynamicFallbackSubmission(intent, submit, setStatus, labels)).resolves.toBeNull()
      expect(setStatus.mock.calls.map(([message]) => message)).toEqual([labels.pending, expected])
    }
  })

  it('reports a rejected submission without presenting a success state', async () => {
    const setStatus = vi.fn()
    const submit = vi.fn(() => null)
    await expect(runSlideDynamicFallbackSubmission(intent, submit, setStatus, labels)).resolves.toBeNull()
    expect(setStatus.mock.calls.map(([message]) => message)).toEqual(['当前文档无法提交动态内容，未写入修改'])
  })

  it('submits a second independent intent while the first still awaits acknowledgement', async () => {
    let settleFirst!: (result: DynamicFallbackResult) => void
    const first = new Promise<DynamicFallbackResult>(resolve => { settleFirst = resolve })
    const second = Promise.resolve({ status: 'unchanged', receipt: null } as DynamicFallbackResult)
    const submit = vi.fn()
      .mockReturnValueOnce({ taskId: 'task-a', settled: first })
      .mockReturnValueOnce({ taskId: 'task-b', settled: second })
    const setStatus = vi.fn()
    const pendingFirst = runSlideDynamicFallbackSubmission(intent, submit, setStatus, labels)
    const nextIntent = { ...intent, itemId: 'component-2' }
    const pendingSecond = runSlideDynamicFallbackSubmission(nextIntent, submit, setStatus, labels)

    expect(submit.mock.calls.map(([value]) => value.itemId)).toEqual(['component-1', 'component-2'])
    expect(setStatus.mock.calls.map(([message]) => message)).toEqual([labels.pending, labels.pending])
    await expect(pendingSecond).resolves.toBe('unchanged')
    settleFirst({ status: 'applied', receipt: {} } as DynamicFallbackResult)
    await expect(pendingFirst).resolves.toBe('applied')
  })
})
