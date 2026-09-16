import { flowDocumentRecoveryTargetSchema, flowDocumentRecoverySchema } from '@/shared/flowDocumentRecovery'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useFlowDocumentRecovery } from '@/renderer/app/useFlowDocumentRecovery'
import { flowDocumentDraftSaveBlock, serializeFlowDocumentRecovery, type FlowDocumentDraft, type FlowDocumentRecoveryPort, type FlowDocumentRecoveryRecord, type FlowDocumentRecoveryTarget } from '@/renderer/authoring/flowDocumentDraft'

const target = { projectId: 'project', surfaceId: 'flow', projectPath: null, revision: 3, epoch: 1 }
const draft: FlowDocumentDraft = { surfaceId: 'flow', revision: 3, source: '$unfinished', diagnostics: [{ message: '公式未闭合', offset: 0, endOffset: 11, line: 1, column: 1 }], composing: false }
function storage(initial?: FlowDocumentRecoveryRecord) {
  let record = initial ?? null
  const port: FlowDocumentRecoveryPort = { read: vi.fn(async identity => { flowDocumentRecoveryTargetSchema.parse(identity); return record }), write: vi.fn(async value => { record = flowDocumentRecoverySchema.parse(value) }), clear: vi.fn(async identity => { flowDocumentRecoveryTargetSchema.parse(identity); record = null }) }
  return { port, get record() { return record } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

describe('Flow document app-local recovery', () => {
  it('restores once through StrictMode cleanup and remount', async () => {
    const disk = storage(serializeFlowDocumentRecovery(target, draft))
    const restored = vi.fn(), error = vi.fn()
    const hook = renderHook(() => useFlowDocumentRecovery({ target, draft: null, port: disk.port, onRestore: restored, onError: error }), { wrapper: StrictMode })
    await act(async () => { await hook.result.current.flush() })
    expect(restored).toHaveBeenCalledExactlyOnceWith(draft)
    expect(error).not.toHaveBeenCalled()
    expect(disk.port.read).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project', projectPath: null, surfaceId: 'flow', epoch: expect.any(String) }))
    expect(disk.port.clear).not.toHaveBeenCalled()
    hook.unmount()
  })
  it('refuses unresolved source save and serializes diagnostic paths for IPC', () => {
    expect(flowDocumentDraftSaveBlock(draft)).toMatchObject({ ok: false, reason: '公式未闭合' })
    expect(flowDocumentDraftSaveBlock({ ...draft, composing: true })?.reason).toContain('中文输入')
    expect(flowDocumentDraftSaveBlock(null)).toBeNull()
    expect(serializeFlowDocumentRecovery(target, { ...draft, diagnostics: [{ ...draft.diagnostics[0]!, path: ['blocks', 0, Symbol()] }] }).diagnostics[0]?.path).toEqual(['blocks', 0])
  })
  it('writes invalid source independently, restores on remount, and clears only after application', async () => {
    const disk = storage()
    const restored = vi.fn(), error = vi.fn()
    const first = renderHook(() => useFlowDocumentRecovery({ target, draft, port: disk.port, onRestore: restored, onError: error }))
    await act(async () => { expect(await first.result.current.flush()).toBe(true) })
    expect(disk.record?.source).toBe('$unfinished')
    first.unmount()
    const second = renderHook(({ value }: { value: FlowDocumentDraft | null }) => useFlowDocumentRecovery({ target: { ...target, epoch: 2 }, draft: value, port: disk.port, onRestore: restored, onError: error }), { initialProps: { value: null as FlowDocumentDraft | null } })
    await waitFor(() => expect(restored).toHaveBeenCalledWith(draft))
    second.rerender({ value: draft })
    await act(async () => { await second.result.current.flush() })
    second.rerender({ value: null })
    await act(async () => { await second.result.current.flush() })
    expect(disk.port.clear).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project', projectPath: null, surfaceId: 'flow', epoch: expect.any(String) }))
    expect(disk.record).toBeNull()
    expect(error).not.toHaveBeenCalled()
  })
  it('retains another revision and never restores it over the current body', async () => {
    const disk = storage(serializeFlowDocumentRecovery(target, { ...draft, revision: 2 }))
    const restored = vi.fn(), error = vi.fn()
    renderHook(() => useFlowDocumentRecovery({ target, draft: null, port: disk.port, onRestore: restored, onError: error }))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(restored).not.toHaveBeenCalled()
    expect(disk.record?.revision).toBe(2)
    expect(disk.port.clear).not.toHaveBeenCalled()
  })
  it('drops a stale queued recovery write after the target session changes', async () => {
    const write = deferred<void>()
    const port: FlowDocumentRecoveryPort = {
      read: vi.fn(async () => null),
      write: vi.fn(() => write.promise),
      clear: vi.fn(async () => undefined),
    }
    const restored = vi.fn(), error = vi.fn()
    const initial: { input: { target: FlowDocumentRecoveryTarget; draft: FlowDocumentDraft | null } } = { input: { target, draft } }
    const hook = renderHook(({ input }: { input: { target: FlowDocumentRecoveryTarget; draft: FlowDocumentDraft | null } }) => (
      useFlowDocumentRecovery({ target: input.target, draft: input.draft, port, onRestore: restored, onError: error })
    ), { initialProps: initial })
    await waitFor(() => expect(port.write).toHaveBeenCalledTimes(1))
    hook.rerender({ input: { target: { ...target, epoch: 2 }, draft: null } })
    await act(async () => { write.reject(new Error('正文恢复稿会话已失效')); expect(await hook.result.current.flush()).toBe(true) })
    expect(error).not.toHaveBeenCalled()
    expect(restored).not.toHaveBeenCalled()
  })
  it('reports a failed recovery write for the current target', async () => {
    const port: FlowDocumentRecoveryPort = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => { throw new Error('磁盘不可写') }),
      clear: vi.fn(async () => undefined),
    }
    const restored = vi.fn(), error = vi.fn()
    const hook = renderHook(() => useFlowDocumentRecovery({ target, draft, port, onRestore: restored, onError: error }))
    await act(async () => { expect(await hook.result.current.flush()).toBe(false) })
    expect(error).toHaveBeenCalledWith('磁盘不可写')
    expect(restored).not.toHaveBeenCalled()
  })
  it('creates a fresh recovery fence when a reopened Flow returns to the same authoring epoch', async () => {
    const port: FlowDocumentRecoveryPort = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    }
    const restored = vi.fn(), error = vi.fn()
    const initial: { input: { target: FlowDocumentRecoveryTarget | null; draft: FlowDocumentDraft | null } } = { input: { target, draft } }
    const hook = renderHook(({ input }: { input: { target: FlowDocumentRecoveryTarget | null; draft: FlowDocumentDraft | null } }) => (
      useFlowDocumentRecovery({ target: input.target, draft: input.draft, port, onRestore: restored, onError: error })
    ), { initialProps: initial })
    await act(async () => { expect(await hook.result.current.flush()).toBe(true) })
    hook.rerender({ input: { target: null, draft: null } })
    hook.rerender({ input: { target: { ...target }, draft } })
    await act(async () => { expect(await hook.result.current.flush()).toBe(true) })
    const writeEpochs = (port.write as ReturnType<typeof vi.fn>).mock.calls.map(([record]) => record.epoch)
    expect(writeEpochs).toHaveLength(2)
    expect(writeEpochs[0]).not.toBe(writeEpochs[1])
    expect(writeEpochs.every((epoch: unknown) => typeof epoch === 'string')).toBe(true)
    expect(error).not.toHaveBeenCalled()
  })
  it('keeps one recovery fence while the active Flow revision changes', async () => {
    const port: FlowDocumentRecoveryPort = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    }
    const restored = vi.fn(), error = vi.fn()
    const hook = renderHook(({ input }: { input: { target: typeof target; draft: FlowDocumentDraft } }) => (
      useFlowDocumentRecovery({ target: input.target, draft: input.draft, port, onRestore: restored, onError: error })
    ), { initialProps: { input: { target, draft } } })
    await act(async () => { expect(await hook.result.current.flush()).toBe(true) })
    hook.rerender({ input: { target: { ...target, revision: 4 }, draft: { ...draft, revision: 4, source: 'updated' } } })
    await act(async () => { expect(await hook.result.current.flush()).toBe(true) })
    const writeEpochs = (port.write as ReturnType<typeof vi.fn>).mock.calls.map(([record]) => record.epoch)
    expect(writeEpochs).toHaveLength(2)
    expect(writeEpochs[0]).toBe(writeEpochs[1])
    expect(error).not.toHaveBeenCalled()
  })
})
