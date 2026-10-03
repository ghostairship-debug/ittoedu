// @vitest-environment node
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { expect, it, vi } from 'vitest'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

it('measures a 12 MiB synthetic checkpoint and verifies independent run persistence is not globally queued', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'g20-local-history-measure-')), store = new ExecutionRunStore(root)
  const payload = 'synthetic-not-user-data '.repeat(Math.ceil(12 * 1024 * 1024 / 24)).slice(0, 12 * 1024 * 1024)
  const record = (runId: string, content: string): ExecutionRunRecord => ({ schemaVersion: 1, runId, version: 1,
    input: { conversationId: 'fixture', taskId: runId, instruction: 'benchmark fixture', selection: {} as never, documents: [] },
    status: 'completed', createdAt: 1, updatedAt: 1, initialMessageCount: 0, messages: [{ role: 'assistant', content }], requests: [], tools: [] })
  const source = record('large', payload), delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable()
  const values: Record<string, unknown> = { synthetic: true, contentBytes: Buffer.byteLength(payload) }
  const measure = async (name: string, task: () => unknown | Promise<unknown>) => { const at = performance.now(); const result = await task(); values[name] = performance.now() - at; return result }
  try {
    await measure('cloneMs', () => structuredClone(source))
    const serialized = await measure('serializeMs', () => JSON.stringify(source)) as string
    await measure('parseMs', () => JSON.parse(serialized))
    await measure('saveWithFsyncMs', () => store.save(source))
    const reread = await measure('coldReadMs', () => new ExecutionRunStore(root).read('large')) as ExecutionRunRecord
    expect(reread.messages[0]!.content).toBe(payload)
    await measure('secondIndependentSaveMs', () => store.save(record('other', payload)))
    expect(await measure('listTwoCheckpointsMs', () => store.list())).toHaveLength(2)
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), atOpen = new Promise<void>(resolve => { entered = resolve })
    const original = fs.open.bind(fs)
    let first = true
    const blocked = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (first && args[1] === 'wx') { first = false; entered(); await gate }
      return original(...args)
    })
    const pending = store.save(record('blocked', payload)); await atOpen
    try {
      await measure('unrelatedSaveDuringBlockedRunMs', () => store.save(record('small', 'safe small result')))
      expect((await store.read('small'))?.messages[0]!.content).toBe('safe small result')
      values.unrelatedProgressedBeforeRelease = true
    } finally { release(); await pending; blocked.mockRestore() }
    await new Promise(resolve => setTimeout(resolve, 25))
    delay.disable(); values.eventLoopDelayMaxMs = delay.max / 1e6; values.serializedBytes = Buffer.byteLength(serialized)
    const destination = join(process.cwd(), 'output/g20/usability-followup-20260930-closeout/local-history-measurement.json')
    await fs.mkdir(join(destination, '..'), { recursive: true }); await fs.writeFile(destination, JSON.stringify(values, null, 2))
    console.log(JSON.stringify(values))
  } finally { delay.disable(); vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) }
})
