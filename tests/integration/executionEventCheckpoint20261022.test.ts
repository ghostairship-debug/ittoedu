// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EXECUTION_EVENT_CHECKPOINT, restoreExecutionEvents } from '../../src/main/workbench/execution/executionEventCheckpoint'
import * as checkpointWorker from '../../src/main/workbench/execution/executionEventCheckpointWorker'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

const roots: string[] = []
const stores: ExecutionEventStore[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.allSettled(stores.splice(0).map(store => store.flushMaintenance()))
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})
function event(index: number, data: ExecutionEventInput['data'] = {}): ExecutionEventInput {
  return { eventId: `event-${index}`, conversationId: 'conversation', taskId: 'task', runId: 'run', itemId: `item-${index}`,
    time: index, source: 'builtin', type: 'tool', update: 'append', data }
}
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-event-checkpoint-')); roots.push(directory)
  const store = new ExecutionEventStore({ directory, segmentBytes: 1024, inlineBytes: 64 }); stores.push(store)
  store.retain('conversation', 'view:test')
  return { directory, store }
}
async function prefixes(directory: string) {
  const folder = path.join(directory, (await fs.readdir(directory))[0]!)
  const names = (await fs.readdir(folder)).filter(name => name.endsWith('.events')).sort()
  return { directory: folder, conversationId: 'conversation', segments: await Promise.all(names.map(async name => ({ name, size: (await fs.stat(path.join(folder, name))).size }))) }
}
describe('derived execution checkpoints over the unchanged source log', () => {
  it('restores complete facts and replays only the small tail while preserving receipts and blob ownership', async () => {
    const { directory, store } = await fixture(), long = '输出正文'.repeat(100)
    const inputs = Array.from({ length: 128 }, (_, index) => event(index, { text: `step ${index}`, status: 'completed' }))
    await store.batchAppend(inputs)
    const blob = await store.append(event(128, { output: long, status: 'completed' }))
    await store.append({ ...event(129, { status: 'running' }), source: 'external-mcp' })
    await store.append({ ...event(130, { status: 'completed' }), source: 'external-mcp', type: 'run.end' })
    await store.flushMaintenance()
    const input = await prefixes(directory), cached = await restoreExecutionEvents(input)
    expect(cached.replayedEvents).toBeLessThan(4)
    expect(cached.verifiedPrefixBytes).toBeGreaterThan(0)
    const before = await store.snapshot('conversation')
    const reopened = new ExecutionEventStore({ directory, segmentBytes: 1024, inlineBytes: 64 }); stores.push(reopened)
    reopened.retain('conversation', 'view:cold')
    expect(await reopened.snapshot('conversation')).toEqual(before)
    expect((await reopened.append(inputs[7]!)).sequence).toBe(8)
    await expect(reopened.append({ ...inputs[7]!, data: { text: 'changed' } })).rejects.toMatchObject({ code: 'event-id-conflict' })
    expect(Buffer.from(await reopened.readBlob('conversation', blob.data.outputRef!)).toString()).toBe(long)
    await expect(reopened.readBlob('other', blob.data.outputRef!)).rejects.toMatchObject({ code: 'blob-not-owned' })
    expect((await reopened.append(event(131, { text: 'tail' }))).sequence).toBe(132)
    const tail = await restoreExecutionEvents(await prefixes(directory))
    expect(tail.facts.projection.cursor).toBe(132)
    expect(tail.facts.activeExternalTools.size).toBe(0)
    expect(tail.replayedEvents).toBeLessThan(5)
  })
  it('discards a corrupt cache, still rejects corrupt committed source and repairs only an incomplete final frame', async () => {
    const { directory, store } = await fixture()
    await store.batchAppend(Array.from({ length: 40 }, (_, index) => event(index, { text: `text ${index}` })))
    await store.flushMaintenance()
    const input = await prefixes(directory), filename = path.join(input.directory, EXECUTION_EVENT_CHECKPOINT)
    const cache = await fs.readFile(filename), brokenCache = Buffer.from(cache); brokenCache[brokenCache.length - 1] ^= 1
    await fs.writeFile(filename, brokenCache)
    expect((await restoreExecutionEvents(input)).replayedEvents).toBe(40)
    await fs.writeFile(filename, cache)
    const sourceFile = path.join(input.directory, input.segments[0]!.name), source = await fs.readFile(sourceFile)
    const brokenSource = Buffer.from(source); brokenSource[60] ^= 1
    await fs.writeFile(sourceFile, brokenSource)
    await expect(restoreExecutionEvents(input)).rejects.toMatchObject({ code: 'event-corrupt' })
    await fs.writeFile(sourceFile, source)
    await fs.appendFile(sourceFile, source.subarray(0, 13))
    const reopened = new ExecutionEventStore({ directory, segmentBytes: 1024 }); stores.push(reopened)
    expect((await reopened.snapshot('conversation')).cursor).toBe(40)
    expect((await fs.stat(sourceFile)).size).toBe(source.length)
  })
  it('keeps append acknowledgement and the next append independent from a running fixed-prefix checkpoint', async () => {
    const { directory, store } = await fixture()
    const create = checkpointWorker.createExecutionCheckpointInWorker
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const maintenance = vi.spyOn(checkpointWorker, 'createExecutionCheckpointInWorker').mockImplementation(async (...args) => { await gate; return create(...args) })
    let count = 0
    while (!maintenance.mock.calls.length && count < 10) await store.append(event(count++, { text: 'one small increment' }))
    expect(maintenance).toHaveBeenCalledTimes(1)
    const frozen = maintenance.mock.calls[0]![0], frozenTail = frozen.segments.at(-1)!, captured = count
    expect((await store.append(event(count++, { text: 'same tail while cache is pending' }))).sequence).toBe(count)
    expect((await fs.stat(path.join(frozen.directory, frozenTail.name))).size).toBeGreaterThan(frozenTail.size)
    while ((await prefixes(directory)).segments.length === frozen.segments.length && count < captured + 10)
      await store.append(event(count++, { text: 'cross a new segment' }))
    expect((await prefixes(directory)).segments.length).toBeGreaterThan(frozen.segments.length)
    release(); await store.flushMaintenance()
    const restored = await restoreExecutionEvents(await prefixes(directory))
    expect(restored.facts.projection.cursor).toBe(count)
    expect(restored.replayedEvents).toBe(count - captured)
  })
})
