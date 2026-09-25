// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

it('keeps 10000 durable events searchable across snapshots/blobs/restart and shares unchanged incremental items', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-long-events-'))
  try {
    const start = performance.now(), memory = process.memoryUsage().heapUsed
    const store = new ExecutionEventStore({ directory, segmentBytes: 256 * 1024, inlineBytes: 1024 })
    const inputs: ExecutionEventInput[] = Array.from({ length: 10000 }, (_, index) => ({ eventId: `event-${index}`, conversationId: 'long', taskId: 'task', runId: 'run', itemId: `item-${index}`, source: 'builtin', type: 'text', update: 'snapshot', time: index,
      data: { text: index === 123 ? '旧快照唯一关键词' : index === 4567 ? '大输出'.repeat(1000) + '深处唯一关键词' : `中文历史片段 ${index}` } }))
    inputs[9999] = { ...inputs[9999], itemId: 'item-123', data: { text: '最终替换的内容' } }
    for (let offset = 0; offset < inputs.length; offset += 500) await store.batchAppend(inputs.slice(offset, offset + 500))
    const seedAndWriteMs = performance.now() - start, reopened = new ExecutionEventStore({ directory })
    let projection = emptyExecutionProjection('long'), count = 0, cursor = 0
    const readStart = performance.now()
    do { const page = await reopened.readPage({ conversationId: 'long', after: cursor, limit: 137 }); projection = foldExecutionEvents(projection, page.events); count += page.events.length; cursor = page.cursor; if (!page.hasMore) break } while (true)
    expect(count).toBe(10000); expect(projection.items).toHaveLength(9999)
    expect(projection.items[123].content).toEqual([{ kind: 'text', text: '最终替换的内容' }])
    for (const [query, expected] of [['旧快照唯一关键词', 124], ['深处唯一关键词', 4568]] as const) {
      let after = 0, found = false
      do { const page = await reopened.search({ conversationId: 'long', query, after, limit: 1 }); expect(page.cursor - after).toBeLessThanOrEqual(2000); after = page.cursor; if (page.hits.length) { expect(page.hits[0].event.sequence).toBe(expected); found = true; break } if (!page.hasMore) break } while (true)
      expect(found).toBe(true)
    }
    const readSearchMs = performance.now() - readStart
    const trials: { items: number; ms: number }[] = []
    for (const size of [1000, 9999]) {
      let current = { ...projection, items: projection.items.slice(0, size) }, before = current
      const begin = performance.now()
      for (let index = 0; index < 100; index++) current = foldExecutionEvents(current, [{ ...inputs[0], eventId: `delta-${index}`, update: 'append', sequence: current.cursor + 1, data: { text: '续' } }])
      expect(current.items[1]).toBe(before.items[1]); expect(before.items[0].content).toEqual([{ kind: 'text', text: '中文历史片段 0' }])
      trials.push({ items: size, ms: performance.now() - begin })
    }
    const branchEvent = { ...inputs[0], eventId: 'branch', itemId: 'branch-a', sequence: 10001, data: { text: 'A' } }
    const a = foldExecutionEvents(projection, [branchEvent])
    const b = foldExecutionEvents(projection, [{ ...branchEvent, itemId: 'branch-b', data: { text: 'B' } }])
    const nextA = foldExecutionEvents(a, [{ ...branchEvent, sequence: 10002, data: { text: 'A2' } }])
    const nextB = foldExecutionEvents(b, [{ ...branchEvent, sequence: 10002, data: { text: 'A in B' } }])
    expect(nextA.items.at(-1)?.content).toEqual([{ kind: 'text', text: 'A2' }])
    expect(nextB.items.slice(-2).map(item => item.itemId)).toEqual(['branch-b', 'branch-a'])
    expect(a.items.at(-1)?.content).toEqual([{ kind: 'text', text: 'A' }])
    // Trend evidence, not a machine-independent performance gate or GUI latency claim.
    process.stdout.write(JSON.stringify({ machine: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem() }, workload: '10000 real durable events; 100 single-event folds', seedAndWriteMs, readSearchMs, heapDeltaBytes: process.memoryUsage().heapUsed - memory, trials }) + '\n')
    const first = await reopened.readPage({ conversationId: 'long', limit: 1 }); first.events[0].data.text = 'caller mutation'
    expect((await reopened.readPage({ conversationId: 'long', limit: 1 })).events[0].data.text).toBe('中文历史片段 0')
    expect((await reopened.snapshot('long')).cursor).toBe(10000)
    // A cached page must still detect a complete same-length on-disk corruption.
    const folder = path.join(directory, (await fs.readdir(directory))[0]), segment = (await fs.readdir(folder)).filter(name => name.endsWith('.events')).sort()[0]
    const filename = path.join(folder, segment), damaged = await fs.readFile(filename); damaged[49] ^= 1; await fs.writeFile(filename, damaged)
    await expect(reopened.readPage({ conversationId: 'long', limit: 1 })).rejects.toMatchObject({ code: 'event-corrupt' })
  } finally { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('invalid fixture'); await fs.rm(directory, { recursive: true, force: true }) }
}, 30000)
