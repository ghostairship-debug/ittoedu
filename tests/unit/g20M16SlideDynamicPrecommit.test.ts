import { describe, expect, it, vi } from 'vitest'
import type { DynamicFallbackIntent, DynamicFallbackResult } from '../../src/renderer/composition/runtime/precommitDynamicFallback'
import { runSlideDynamicFallbackSubmission } from '../../src/renderer/ui/workspaces/SlideLocationWorkspace'

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

  it('keeps failed, conflicting and blocked submissions visibly uncommitted', async () => {
    for (const status of ['failed', 'conflict', 'blocked', 'unknown'] as const) {
      const setStatus = vi.fn()
      const submit = vi.fn(() => ({
        taskId: 'task-2',
        settled: Promise.resolve({ status, reason: '版本冲突', taskId: 'task-2' } as DynamicFallbackResult),
      }))
      await expect(runSlideDynamicFallbackSubmission(intent, submit, setStatus, labels)).resolves.toBeNull()
      expect(setStatus.mock.calls.map(([message]) => message)).toEqual([labels.pending, '版本冲突 未写入修改'])
    }
  })

  it('reports a rejected submission without presenting a success state', async () => {
    const setStatus = vi.fn()
    const submit = vi.fn(() => null)
    await expect(runSlideDynamicFallbackSubmission(intent, submit, setStatus, labels)).resolves.toBeNull()
    expect(setStatus.mock.calls.map(([message]) => message)).toEqual(['当前文档无法提交动态内容，未写入修改'])
  })
})
