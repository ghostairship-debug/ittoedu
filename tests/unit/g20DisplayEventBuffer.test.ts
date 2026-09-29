// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DisplayEventBuffer } from '../../src/main/workbench/execution/DisplayEventBuffer'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'
const directories: string[] = []
afterEach(async () => { vi.useRealTimers(); for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }) })
const delta = (index: number, text = '字'): ExecutionEventInput => ({ eventId: `e${index}`, conversationId: 'c', taskId: 't',
  runId: 'r', itemId: 'text', time: index, source: 'builtin', type: 'text', update: 'append', data: { text, status: 'running' } })

it('M26 display fragments are batched into a real durable log without loss or changes to terminal acknowledgement', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-display-')); directories.push(dir)
  const store = new ExecutionEventStore({ directory: dir }), batch = vi.spyOn(store, 'batchAppend')
  const buffer = new DisplayEventBuffer(async inputs => { await store.batchAppend(inputs) }, 60, 128_000)
  for (let i = 0; i < 100; i++) await buffer.push(delta(i))
  await buffer.flush()
  expect(batch).toHaveBeenCalledOnce()
  await store.append({ ...delta(101), itemId: 'run', type: 'run.end', update: 'snapshot', data: { status: 'completed' } })
  const reopened = new ExecutionEventStore({ directory: dir })
  const events = (await reopened.readPage({ conversationId: 'c' })).events
  expect(events.map(event => event.sequence)).toEqual([1, 2])
  expect(events[0]!.data.text).toBe('字'.repeat(100))
  expect(events[1]).toMatchObject({ type: 'run.end', data: { status: 'completed' } })
})


it('M26 time-bounded display flushing does not admit a commit or a terminal status into the buffer', async () => {
  vi.useFakeTimers()
  const append = vi.fn(async (_inputs: ExecutionEventInput[]) => undefined), buffer = new DisplayEventBuffer(append)
  await buffer.push(delta(1)); await vi.advanceTimersByTimeAsync(59)
  expect(append).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1); expect(append).toHaveBeenCalledOnce()
  await expect(buffer.push({ ...delta(2), type: 'document.commit' })).rejects.toThrow('显示增量')
  await expect(buffer.push({ ...delta(3), data: { status: 'completed' } })).rejects.toThrow('显示增量')
  await buffer.flush()
})

it('M26 slow persistence applies backpressure across queued batches, and flush failure is visible rather than a successful receipt', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const append = vi.fn(async () => blocked), buffer = new DisplayEventBuffer(append, 60, 100)
  const settled = vi.fn(), pending = buffer.push(delta(1, 'first')).then(settled)
  await Promise.resolve(); await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  release(); await pending; expect(settled).toHaveBeenCalledOnce()
  const failed = new DisplayEventBuffer(async () => { throw new Error('display-fsync-failed') })
  await failed.push(delta(2))
  await expect(failed.flush()).rejects.toThrow('display-fsync-failed')
  await expect(failed.flush()).resolves.toBeUndefined()
})
