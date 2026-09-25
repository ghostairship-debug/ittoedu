// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { emptyExecutionProjection, foldExecutionEvents } from '../../src/renderer/workbench/executionProjection'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid fixture'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-events-')); roots.push(directory)
  return { directory, store: new ExecutionEventStore({ directory, segmentBytes: 1024, inlineBytes: 64 }) }
}
function event(eventId: string, data: ExecutionEventInput['data'] = {}): ExecutionEventInput {
  return { eventId, conversationId: 'conversation', taskId: 'task', runId: 'run', itemId: 'tool', time: 100, source: 'builtin', type: 'tool', update: 'append', data }
}

describe('segmented execution facts and read-only projection', () => {
  it('retains three identical-status increments for both sources, replaces final item snapshots and never mixes reasoning or invents usage', async () => {
    const { store } = await fixture()
    for (const source of ['builtin', 'external-mcp'] as const) {
      for (const [index, text] of ['第一段', '第二段', '第三段'].entries()) await store.append({ ...event(`${source}:${index}`, { status: 'running', text }), source, runId: source, parentItemId: 'parent' })
    }
    let projection = await store.snapshot('conversation')
    expect(projection.items).toHaveLength(2)
    for (const item of projection.items) {
      expect(item.content).toEqual(['第一段', '第二段', '第三段'].map(text => ({ kind: 'text', text })))
      expect(item.data.usage).toBeUndefined()
      expect(item.parentItemId).toBe('parent')
    }
    const final = { ...event('final', { status: 'completed', text: '完整结果' }), runId: 'builtin', parentItemId: 'parent', update: 'snapshot' as const }
    const receipt = await store.append(final)
    expect(await store.append(final)).toEqual(receipt)
    await expect(store.append({ ...final, data: { text: '不同结果' } })).rejects.toMatchObject({ code: 'event-id-conflict' })
    await store.append({ ...event('reasoning', { text: '上游公开摘要' }), itemId: 'reasoning', type: 'reasoning' })
    await store.append({ ...event('text', { text: '正文答复' }), itemId: 'text', type: 'text' })
    await expect(store.append({ ...event('mixed', { text: '不能混入正文' }), itemId: 'reasoning', type: 'text' })).rejects.toMatchObject({ code: 'event-item-conflict' })
    await expect(store.append({ ...event('native'), data: { providerRaw: { apiKey: 'not-allowed' } } } as never)).rejects.toThrow()
    projection = await store.snapshot('conversation')
    expect(projection.items.find(item => item.runId === 'builtin')!.content).toEqual([{ kind: 'text', text: '完整结果' }])
    expect(projection.items.find(item => item.type === 'reasoning')!.content).toEqual([{ kind: 'text', text: '上游公开摘要' }])
    expect(projection.items.find(item => item.type === 'text')!.content).toEqual([{ kind: 'text', text: '正文答复' }])
    expect(projection.items.some(item => item.type === 'run.end' || item.type === 'usage')).toBe(false)
    const all = await store.readPage({ conversationId: 'conversation', limit: 5000 })
    expect(foldExecutionEvents(foldExecutionEvents(emptyExecutionProjection('conversation'), all.events), all.events)).toEqual(projection)
  })
  it('reconnects from a persisted cursor across 5000 events without gaps or duplicate items', async () => {
    const { directory, store } = await fixture()
    const inputs = Array.from({ length: 5000 }, (_, index) => ({ ...event(`event-${index}`, { text: `片段${index}`, status: 'running' }), itemId: `item-${index}` }))
    // Five bounded atomic batches exercise segment rotation without weakening individual append/fsync semantics.
    for (let offset = 0; offset < inputs.length; offset += 1000) await store.batchAppend(inputs.slice(offset, offset + 1000))
    const first = await store.readPage({ conversationId: 'conversation', limit: 127 })
    let projection = foldExecutionEvents(emptyExecutionProjection('conversation'), first.events)
    const reopened = new ExecutionEventStore({ directory })
    let count = first.events.length
    for (;;) {
      const page = await reopened.readPage({ conversationId: 'conversation', after: projection.cursor, limit: 333 })
      projection = foldExecutionEvents(projection, page.events); count += page.events.length
      if (!page.hasMore) break
    }
    expect(count).toBe(5000); expect(projection.cursor).toBe(5000); expect(projection.items).toHaveLength(5000)
    expect(projection).toEqual(await reopened.snapshot('conversation'))
    expect((await reopened.readPage({ conversationId: 'conversation', limit: 5000 })).events).toHaveLength(5000)
    expect(await reopened.append(inputs[7]!)).toMatchObject({ eventId: 'event-7', sequence: 8 })
    expect((await reopened.snapshot('conversation')).cursor).toBe(5000)
    const folders = await fs.readdir(directory), segments = await fs.readdir(path.join(directory, folders[0]!))
    expect(segments.filter(name => name.endsWith('.events'))).toHaveLength(5)
  })
  it('restarts as a read-only fact store, scopes large outputs to their conversation, recovers only a torn tail and rejects complete corruption', async () => {
    const { directory, store } = await fixture(), text = '大输出\n'.repeat(100)
    const committed = await store.append(event('tool-complete', { text, status: 'completed' }))
    await store.append({ ...event('edit-complete', { status: 'completed', operationId: 'document-operation', documentId: 'document', revision: 7 }), itemId: 'commit', type: 'document.commit', update: 'snapshot' })
    expect(committed.data.text).toBeUndefined()
    const ref = committed.data.textRef!
    const folder = path.join(directory, (await fs.readdir(directory))[0]!)
    const segments = (await fs.readdir(folder)).filter(name => name.endsWith('.events')).sort()
    const filename = path.join(folder, segments.at(-1)!), original = await fs.readFile(filename)
    const reopened = new ExecutionEventStore({ directory })
    for (let index = 0; index < 3; index++) {
      expect((await reopened.snapshot('conversation')).items.find(item => item.type === 'document.commit')!.data.revision).toBe(7)
      expect((await reopened.readPage({ conversationId: 'conversation' })).events).toHaveLength(2)
      expect(Buffer.from(await reopened.readBlob('conversation', ref)).toString('utf8')).toBe(text)
    }
    expect(await fs.readFile(filename)).toEqual(original) // Read/replay did not append events or execute a new operation.
    await expect(reopened.readBlob('other-conversation', ref)).rejects.toMatchObject({ code: 'blob-not-owned' })
    await fs.appendFile(filename, original.subarray(0, 13))
    expect((await new ExecutionEventStore({ directory }).snapshot('conversation')).cursor).toBe(2)
    expect(await fs.readFile(filename)).toEqual(original)
    const damaged = Buffer.from(original); damaged[49] ^= 1; await fs.writeFile(filename, damaged)
    await expect(new ExecutionEventStore({ directory }).snapshot('conversation')).rejects.toMatchObject({ code: 'event-corrupt' })
    expect(await fs.readFile(filename)).toEqual(damaged)
    // A first record interrupted before its commit leaves an empty last segment after recovery.
    // Reusing that segment must not add it twice to the cursor index, even for an oversized batch.
    const retryDirectory = path.join(directory, 'retry'), retryStore = new ExecutionEventStore({ directory: retryDirectory, segmentBytes: 512 })
    const batch = [event('retry-a', { text: 'a'.repeat(400) }), event('retry-b', { text: 'b'.repeat(400) })]
    await retryStore.batchAppend(batch)
    const retryFolder = path.join(retryDirectory, (await fs.readdir(retryDirectory))[0]!)
    const retryFile = path.join(retryFolder, (await fs.readdir(retryFolder)).find(name => name.endsWith('.events'))!)
    await fs.writeFile(retryFile, (await fs.readFile(retryFile)).subarray(0, 13))
    const recovered = new ExecutionEventStore({ directory: retryDirectory, segmentBytes: 512 })
    expect((await recovered.snapshot('conversation')).cursor).toBe(0)
    await recovered.batchAppend(batch)
    expect((await recovered.readPage({ conversationId: 'conversation' })).events).toHaveLength(2)
  })
  it('persists and reopens large tool detail fields and preserves inputs across final status snapshots', async () => {
    const { directory, store } = await fixture()
    const input = JSON.stringify({ target: 'document', content: 'actual input '.repeat(30) })
    const output = JSON.stringify({ result: 'actual result '.repeat(40) })
    await store.append({ ...event('input', { input, status: 'running', toolName: 'text.replace' }), update: 'snapshot' })
    const receipt = await store.append({ ...event('output', { output, diff: '- before\n+ after'.repeat(30), error: 'actual error '.repeat(30), status: 'completed', applicationStatus: 'failed' }), update: 'snapshot' })
    expect(receipt.data.output).toBeUndefined()
    const reopened = new ExecutionEventStore({ directory })
    const projection = await reopened.snapshot('conversation'), tool = projection.items[0]
    expect(tool.data.status).toBe('completed')
    expect(tool.data.applicationStatus).toBe('failed')
    expect(tool.data.saveStatus).toBeUndefined()
    expect(Buffer.from(await reopened.readBlob('conversation', tool.data.inputRef!)).toString()).toBe(input)
    expect(Buffer.from(await reopened.readBlob('conversation', tool.data.outputRef!)).toString()).toBe(output)
    expect(tool.data.diffRef).toBeDefined(); expect(tool.data.errorRef).toBeDefined()
    await expect(reopened.readBlob('different-conversation', tool.data.outputRef!)).rejects.toMatchObject({ code: 'blob-not-owned' })
  })

})
