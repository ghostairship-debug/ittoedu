// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { emptyExecutionProjection, foldExecutionEvents } from '../../src/renderer/workbench/executionProjection'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid fixture'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-events-')); roots.push(directory)
  return { directory, store: new ExecutionEventStore({ directory, segmentBytes: 1024, inlineBytes: 64 }) }
}
function event(eventId: string, data: ExecutionEventInput['data'] = {}): ExecutionEventInput {
  return { eventId, conversationId: 'conversation', taskId: 'task', runId: 'run', itemId: 'tool', time: 100, source: 'builtin', type: 'tool', update: 'append', data }
}

describe('segmented execution facts and read-only projection', () => {
  it('rebuilds a retained head after an append closes with an error beyond the durable commit', async () => {
    const { directory, store } = await fixture()
    store.retain('conversation', 'run:run')
    await store.append(event('before-close', { text: 'before' }))
    const open = fs.open.bind(fs)
    const failure = Object.assign(new Error('injected close after durable commit'), { code: 'EIO' })
    let injected = false
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const file = await open(...args)
      if (injected || args[1] !== 'a+' || !String(args[0]).endsWith('.events')) return file
      injected = true
      return new Proxy(file, { get(target, key) {
        if (key === 'close') return async () => { await target.close(); throw failure }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    })
    const committed = event('uncertain-close', { text: 'already durable' })
    await expect(store.append(committed)).rejects.toMatchObject({ code: 'EIO' })
    spy.mockRestore()
    expect((await store.append(committed)).sequence).toBe(2)
    expect((await store.append(event('after-close', { text: 'after' }))).sequence).toBe(3)
    const cold = await new ExecutionEventStore({ directory }).readPage({ conversationId: 'conversation' })
    expect(cold.events.map(value => [value.eventId, value.sequence])).toEqual([
      ['before-close', 1], ['uncertain-close', 2], ['after-close', 3],
    ])
  })
  it('repairs a failed append through a writable handle before accepting the next durable event', async () => {
    const { directory, store } = await fixture()
    store.retain('conversation', 'run:run')
    await store.append(event('before', { text: 'before' }))
    const open = fs.open.bind(fs)
    const failure = Object.assign(new Error('injected partial event write'), { code: 'EIO' })
    let injected = false
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const file = await open(...args)
      if (injected || args[1] !== 'a+' || !String(args[0]).endsWith('.events')) return file
      injected = true
      return new Proxy(file, { get(target, key) {
        if (key === 'writeFile') return async (bytes: Uint8Array) => { await target.writeFile(Buffer.from(bytes).subarray(0, 55)); throw failure }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    })
    await expect(store.append(event('failed', { text: 'not accepted' }))).rejects.toMatchObject({ code: 'EIO' })
    spy.mockRestore()
    expect((await store.append(event('after', { text: 'after' }))).sequence).toBe(2)
    const reopened = new ExecutionEventStore({ directory })
    expect((await reopened.readPage({ conversationId: 'conversation' })).events.map(value => value.eventId)).toEqual(['before', 'after'])
  })
  it('keeps the live owner head without directory scans, then releases projections while preserving durable history', async () => {
    const { store } = await fixture()
    const loaded = (store as unknown as { loaded: Map<string, unknown> }).loaded
    store.retain('conversation', 'run:run')
    store.retain('conversation', 'view:first')
    await store.append(event('live-1', { text: 'first' }))
    const directories = vi.spyOn(fs, 'readdir')
    await store.append(event('live-2', { text: 'second' }))
    await store.snapshot('conversation')
    expect(directories).not.toHaveBeenCalled()
    await store.release('conversation', 'view:first')
    expect(loaded.has('conversation')).toBe(true)
    await store.release('conversation', 'run:run')
    expect(loaded.has('conversation')).toBe(false)
    const restored = await store.snapshot('conversation')
    expect(restored.cursor).toBe(2)
    expect(restored.items[0]!.content).toEqual([{ kind: 'text', text: 'first' }, { kind: 'text', text: 'second' }])
    expect(loaded.has('conversation')).toBe(false)
    expect((await store.append(event('live-2', { text: 'second' }))).sequence).toBe(2)
  })
  it('retains real external activity until terminal facts, without reviving historical running tools', async () => {
    const { store } = await fixture()
    const loaded = (store as unknown as { loaded: Map<string, unknown> }).loaded
    await store.append({ ...event('external-start', { status: 'running' }), source: 'external-mcp' })
    expect(loaded.has('conversation')).toBe(true)
    store.retain('conversation', 'view:first')
    await store.release('conversation', 'view:first')
    expect(loaded.has('conversation')).toBe(true)
    await store.append({ ...event('external-end', { status: 'completed' }), itemId: 'end', type: 'run.end', source: 'external-mcp' })
    expect(loaded.has('conversation')).toBe(false)
    await store.append({ ...event('external-late', { status: 'running' }), source: 'external-mcp' })
    expect(loaded.has('conversation')).toBe(false)
    expect((await store.snapshot('conversation')).cursor).toBe(3)
  })
  it('saves and reopens all resource references and long labels beyond former metadata caps', async () => {
    const { directory, store } = await fixture()
    const data = { resourceIds: Array.from({ length: 1001 }, (_, index) => `resource-${index}`), label: 'label'.repeat(501) }
    await store.append(event('resources', data))
    const reopened = new ExecutionEventStore({ directory })
    expect((await reopened.snapshot('conversation')).items[0]!.data).toMatchObject(data)
    await expect(reopened.append(event('resources', { ...data, label: 'changed' }))).rejects.toMatchObject({ code: 'event-id-conflict' })
  })
  it('retains three identical-status increments for both sources, replaces final item snapshots and never mixes reasoning or invents usage', async () => {
    const { store } = await fixture()
    for (const source of ['builtin', 'external-mcp'] as const) {
      for (const [index, text] of ['第一段', '第二段', '第三段'].entries()) await store.append({ ...event(`${source}:${index}`, { status: 'running', text }), source, runId: source, parentItemId: 'parent' })
    }
    let projection = await store.snapshot('conversation')
    expect(projection.items).toHaveLength(2)
    for (const item of projection.items) {
      // Projection chunk boundaries are replaceable display storage; original event boundaries stay durable below.
      expect(item.content.map(part => part.kind === 'text' ? part.text : '').join('')).toBe('第一段第二段第三段')
      expect(item.data.usage).toBeUndefined()
      expect(item.parentItemId).toBe('parent')
    }
    const increments = await store.readPage({ conversationId: 'conversation', limit: 20 })
    expect(increments.events).toHaveLength(6)
    for (const source of ['builtin', 'external-mcp'] as const) expect(increments.events.filter(event => event.source === source).map(event => event.data.text))
      .toEqual(['第一段', '第二段', '第三段'])
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

  it('lets append finish while search reads a blob and keeps search on its captured durable cursor', async () => {
    const { directory } = await fixture()
    const store = new ExecutionEventStore({ directory, segmentBytes: 1024 * 1024, inlineBytes: 64 })
    const first = await store.append(event('initial', { text: 'needle '.repeat(50) }))
    const originalRead = fs.readFile.bind(fs)
    let releaseBlob!: () => void, notifyBlob!: () => void
    const blobRead = new Promise<void>(resolve => { notifyBlob = resolve })
    const resume = new Promise<void>(resolve => { releaseBlob = resolve })
    vi.spyOn(fs, 'readFile').mockImplementation(async (filename, options) => {
      if (path.basename(String(filename)) === first.data.textRef!.id) { notifyBlob(); await resume }
      return originalRead(filename, options)
    })
    const searching = store.search({ conversationId: 'conversation', query: 'needle' })
    try {
      await blobRead
      let appended = false
      const writing = store.append({ ...event('later', { text: 'needle later' }), itemId: 'later' }).then(receipt => { appended = true; return receipt })
      await vi.waitFor(() => { expect(appended).toBe(true) })
      expect((await writing).sequence).toBe(2)
    } finally { releaseBlob() }
    const result = await searching
    expect(result.hits.map(hit => hit.event.eventId)).toEqual(['initial'])
    expect(result).toMatchObject({ cursor: 1, hasMore: false })
    expect((await store.search({ conversationId: 'conversation', query: 'needle', after: 1 })).hits.map(hit => hit.event.eventId)).toEqual(['later'])
  })

  it('reads only the captured committed tail prefix without repairing later bytes', async () => {
    const { directory, store } = await fixture()
    await store.append(event('initial', { text: 'needle initial' }))
    const originalOpen = fs.open.bind(fs)
    let releasePrefix!: () => void, notifyPrefix!: () => void
    const prefixOpened = new Promise<void>(resolve => { notifyPrefix = resolve })
    const resume = new Promise<void>(resolve => { releasePrefix = resolve })
    let filename = ''
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await originalOpen(file, flags, mode)
      if (flags === 'r' && String(file).endsWith('.events')) { filename = String(file); notifyPrefix(); await resume }
      return handle
    })
    const searching = store.search({ conversationId: 'conversation', query: 'needle' })
    let size = 0
    try {
      await prefixOpened
      await fs.appendFile(filename, Buffer.from('uncommitted tail'))
      size = (await fs.stat(filename)).size
    } finally { releasePrefix() }
    expect(await searching).toMatchObject({ cursor: 1, hasMore: false })
    expect((await fs.stat(filename)).size).toBe(size)
    expect(await fs.readFile(filename, 'utf8')).toContain('uncommitted tail')
  })

})
