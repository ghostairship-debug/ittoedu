// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import { decodeRunCheckpoint } from '../../src/main/workbench/execution/executionRunCheckpoint'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', platform)
  for (const directory of directories.splice(0)) {
    const relative = path.relative(os.tmpdir(), directory)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(directory).startsWith('run-store-recovery-'))
      throw new Error('Unexpected temporary cleanup target')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function fixture() {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'run-store-recovery-'))
  directories.push(directory)
  const store = new ExecutionRunStore(directory)
  const record = { schemaVersion: 1, runId: 'safe-checkpoint', version: 1,
    input: { conversationId: 'synthetic-conversation', documents: [] }, status: 'running', createdAt: 1, updatedAt: 1,
    messages: [{ role: 'user', content: 'x'.repeat(314700) }], tools: [], requests: [] } as unknown as ExecutionRunRecord
  await store.save(record)
  const filename = path.join(directory, (await fs.readdir(directory)).find(name => name.endsWith('.json'))!)
  return { store, record, directory, filename }
}
const denied = (from: string, to: string) => Object.assign(new Error(`EPERM: rename '${from}' -> '${to}'`),
  { code: 'EPERM', syscall: 'rename', path: from, dest: to })
const storedRecord = (bytes: string) => decodeRunCheckpoint(bytes).record
async function currentTail(filename: string): Promise<string> {
  const checkpoint = decodeRunCheckpoint(await fs.readFile(filename, 'utf8'))
  return `${filename}.${checkpoint.generation}.changes`
}

it('reuses the run owner document index and reads only associated current records after initialization', async () => {
  const h = await fixture()
  const record = (runId: string, documentId: string) => ({ ...h.record, runId,
    input: { ...h.record.input, documents: [{ documentId, writable: [] }] } })
  await h.store.save(record('first', 'doc-a')); await h.store.save(record('second', 'doc-b'))
  const reopened = new ExecutionRunStore(h.directory), list = vi.spyOn(reopened, 'list')
  expect((await reopened.forDocument('doc-a')).map(value => value.runId)).toEqual(['first'])
  expect(list).toHaveBeenCalledTimes(1)
  const read = vi.spyOn(reopened, 'read')
  expect((await reopened.forDocument('doc-b')).map(value => value.runId)).toEqual(['second'])
  expect(list).toHaveBeenCalledTimes(1)
  expect(read.mock.calls).toEqual([['second']])
  await reopened.save({ ...record('first', 'doc-b'), version: 2 })
  expect(await reopened.forDocument('doc-a')).toEqual([])
  expect((await reopened.forDocument('doc-b')).map(value => value.runId).sort()).toEqual(['first', 'second'])
  await reopened.save(record('third', 'doc-c'))
  expect((await reopened.forDocument('doc-c')).map(value => value.runId)).toEqual(['third'])
})

it('does not roll a newly saved document association back when an older initialization read settles later', async () => {
  const h = await fixture()
  const prior = { ...h.record, input: { ...h.record.input, documents: [{ documentId: 'old-document', writable: [] }] } }
  await h.store.save(prior)
  const reopened = new ExecutionRunStore(h.directory), originalRead = fs.readFile.bind(fs)
  let enter!: () => void, release!: () => void, hold = true
  const entered = new Promise<void>(resolve => { enter = resolve }), resumed = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(fs, 'readFile').mockImplementation(async (filename, options) => {
    const bytes = await originalRead(filename, options)
    if (String(filename) === h.filename && hold) { hold = false; enter(); await resumed }
    return bytes
  })
  const initializing = reopened.forDocument('old-document')
  await entered
  await reopened.save({ ...prior, version: 2, input: { ...prior.input, documents: [{ documentId: 'new-document', writable: [] }] } })
  release()
  expect(await initializing).toEqual([])
  expect((await reopened.forDocument('new-document')).map(value => value.runId)).toEqual([prior.runId])
})

it('republishes the same complete Windows checkpoint once after EPERM without rewriting its bytes', async () => {
  const h = await fixture(), nativeRename = fs.rename.bind(fs)
  const candidate = { ...h.record, version: 2 }, calls: Array<{ from: string; to: string; content: string }> = []
  const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    const source = String(from), destination = String(to)
    calls.push({ from: source, to: destination, content: await fs.readFile(source, 'utf8') })
    if (calls.length === 1) throw denied(source, destination)
    return nativeRename(from, to)
  })
  const open = vi.spyOn(fs, 'open')
  await h.store.save(candidate, { checkpoint: true })
  expect(rename).toHaveBeenCalledTimes(2)
  expect(calls[1]).toEqual(calls[0])
  expect(storedRecord(calls[1].content)).toEqual(candidate)
  expect(open).toHaveBeenCalledTimes(1)
  expect(await h.store.read(h.record.runId)).toEqual(candidate)
  expect((await fs.readdir(h.directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
})

it('reports persistent EPERM after bounded publications and preserves the old record and complete candidate', async () => {
  const h = await fixture(), candidate = { ...h.record, version: 2 }
  const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { throw denied(String(from), String(to)) })
  const failed = h.store.save(candidate, { checkpoint: true })
  await expect(failed).rejects.toMatchObject({ code: 'EPERM', syscall: 'rename', dest: h.filename })
  expect(rename).toHaveBeenCalledTimes(5)
  expect(rename.mock.calls.every(call => JSON.stringify(call) === JSON.stringify(rename.mock.calls[0]))).toBe(true)
  expect(await h.store.read(h.record.runId)).toEqual(h.record)
  const preserved = (await fs.readdir(h.directory)).filter(name => name.endsWith('.tmp'))
  expect(preserved).toHaveLength(1)
  expect(storedRecord(await fs.readFile(path.join(h.directory, preserved[0]), 'utf8'))).toEqual(candidate)
  expect(await h.store.list()).toEqual([h.record])
  rename.mockRestore()
  await h.store.save({ ...h.record, version: 3 })
  expect((await h.store.read(h.record.runId))?.version).toBe(3)
})

it.runIf(platform.value === 'win32')('publishes after a real Windows reader releases its no-delete-sharing file handle', async () => {
  const h = await fixture(), candidate = { ...h.record, version: 2 }
  const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$locked=[IO.File]::Open($env:GUOLING_CHECKPOINT_LOCK_PATH,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try { [Console]::Out.WriteLine('ready'); [Console]::Out.Flush(); [void][Console]::In.ReadLine() } finally { $locked.Dispose() }"],
    { windowsHide: true, env: { ...process.env, GUOLING_CHECKPOINT_LOCK_PATH: h.filename }, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = new Promise<number | null>((resolve, reject) => { locker.once('exit', resolve); locker.once('error', reject) })
  try {
    await new Promise<void>((resolve, reject) => {
      locker.stdout.on('data', bytes => { if (String(bytes).includes('ready')) resolve() })
      locker.once('error', reject)
      locker.once('exit', code => reject(new Error(`Native lock helper exited before release: ${code}`)))
    })
    expect(await h.store.read(h.record.runId)).toEqual(h.record)
    const open = vi.spyOn(fs, 'open'), rename = vi.spyOn(fs, 'rename')
    const publication = h.store.save(candidate, { checkpoint: true })
    setTimeout(() => locker.stdin.end('release\n'), 125)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(storedRecord(await fs.readFile(h.filename, 'utf8'))).toEqual(h.record)
    await publication
    expect(await exited).toBe(0)
    expect(rename.mock.calls.length).toBeGreaterThan(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(await h.store.read(h.record.runId)).toEqual(candidate)
    expect((await fs.readdir(h.directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
  } finally {
    if (!locker.stdin.destroyed) locker.stdin.end('release\n')
    await exited
  }
}, 10_000)

it('appends nested state changes without repeating old message and tool-result bodies and restores unknown-effect boundaries', async () => {
  const h = await fixture()
  const record = { ...h.record, tools: [{ callId: 'old', providerCallId: 'provider-old', requestId: 'request-old',
    call: { name: 'file.read', input: { path: 'synthetic-input' } }, state: 'returned',
    result: { kind: 'read', data: { text: 'large-old-result'.repeat(20_000) } } },
  { callId: 'one', providerCallId: 'provider-one', requestId: 'request-one',
    call: { name: 'file.write', input: { path: 'synthetic-output', content: 'large-tool-argument'.repeat(20_000) } }, state: 'pending' }],
    requests: [{ requestId: 'request-one', state: 'sending' }] } as unknown as ExecutionRunRecord
  await h.store.save(record, { checkpoint: true })
  const originalCheckpoint = await fs.readFile(h.filename, 'utf8'), tail = await currentTail(h.filename)
  record.tools[1].state = 'executing'; record.version++
  await h.store.save(record)
  const executing = await new ExecutionRunStore(h.directory).read(record.runId)
  expect(executing?.tools[1].state).toBe('executing')
  expect(executing?.tools[1].call).toEqual(record.tools[1].call)
  record.tools[1].state = 'returned'; record.tools[1].receiptTime = 9
  record.tools[1].result = { kind: 'read', data: { path: 'synthetic-output', status: 'written' } }
  record.requests[0].state = 'completed'; record.version++
  await h.store.save(record)
  expect(await fs.readFile(h.filename, 'utf8')).toBe(originalCheckpoint)
  const changes = await fs.readFile(tail)
  expect(changes.length).toBeLessThan(Buffer.byteLength(originalCheckpoint) / 20)
  expect(changes.includes(Buffer.from('large-old-result'))).toBe(false)
  expect(changes.includes(Buffer.from('large-tool-argument'))).toBe(false)
  expect(await new ExecutionRunStore(h.directory).read(record.runId)).toEqual(record)
})

it('keeps accepted same-version and lower-version saves, including document-index changes', async () => {
  const h = await fixture()
  for (const [version, documentId] of [[1, 'same-version-document'], [0, 'lower-version-document']] as const) {
    const candidate = { ...h.record, version, input: { ...h.record.input, documents: [{ documentId, writable: [] }] } }
    await h.store.save(candidate)
    expect(await h.store.read(candidate.runId)).toEqual(candidate)
    expect((await h.store.forDocument(documentId)).map(value => value.runId)).toEqual([candidate.runId])
  }
  expect(await h.store.forDocument('same-version-document')).toEqual([])
})

it('captures input before yielding and does not retain mutable caller branches', async () => {
  const h = await fixture(), candidate = { ...h.record, messages: [{ role: 'user', content: 'before-save' }] } as ExecutionRunRecord
  const saved = h.store.save(candidate)
  candidate.messages[0].content = 'mutated-while-queued'
  await saved
  expect((await h.store.read(candidate.runId))?.messages[0].content).toBe('before-save')
  await h.store.save(candidate)
  candidate.messages[0].content = 'mutated-after-second-save'
  expect((await h.store.read(candidate.runId))?.messages[0].content).toBe('mutated-while-queued')
})

it('rolls a failed append back before accepting a subsequent save', async () => {
  const h = await fixture(), tail = await currentTail(h.filename), nativeOpen = fs.open.bind(fs)
  let fail = true
  vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
    const handle = await nativeOpen(filename, flags, mode)
    if (String(filename) === tail && flags === 'a+') {
      const sync = handle.sync.bind(handle)
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        if (fail) { fail = false; throw Object.assign(new Error('synthetic append flush failure'), { code: 'EIO' }) }
        return sync()
      })
    }
    return handle
  })
  await expect(h.store.save({ ...h.record, version: 2, updatedAt: 2 })).rejects.toMatchObject({ code: 'EIO' })
  expect((await fs.stat(tail)).size).toBe(0)
  expect(await new ExecutionRunStore(h.directory).read(h.record.runId)).toEqual(h.record)
  const next = { ...h.record, version: 3, updatedAt: 3 }
  await h.store.save(next)
  expect(await new ExecutionRunStore(h.directory).read(next.runId)).toEqual(next)
})

it('repairs only a partial final frame and preserves a complete corrupt frame', async () => {
  const h = await fixture(), candidate = { ...h.record, version: 2 }
  await h.store.save(candidate)
  const tail = await currentTail(h.filename), committed = await fs.readFile(tail)
  await fs.appendFile(tail, Buffer.from('G20RUN01-incomplete-final-frame'))
  expect(await new ExecutionRunStore(h.directory).read(candidate.runId)).toEqual(candidate)
  expect(await fs.readFile(tail)).toEqual(committed)
  for (const offset of [8, 56]) {
    const corrupt = Buffer.from(committed); corrupt[offset] ^= 1
    await fs.writeFile(tail, corrupt)
    await expect(new ExecutionRunStore(h.directory).read(candidate.runId)).rejects.toThrow('原文件保留')
    expect(await fs.readFile(tail)).toEqual(corrupt)
  }
})

it('publishes a new generation after close fails rather than reusing an uncertain append sequence', async () => {
  const h = await fixture(), tail = await currentTail(h.filename), nativeOpen = fs.open.bind(fs)
  let fail = true
  vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
    const handle = await nativeOpen(filename, flags, mode)
    if (String(filename) === tail && flags === 'a+') {
      const close = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close()
        if (fail) { fail = false; throw Object.assign(new Error('synthetic close failure'), { code: 'EIO' }) }
      })
    }
    return handle
  })
  await expect(h.store.save({ ...h.record, version: 2 })).rejects.toMatchObject({ code: 'EIO' })
  const candidate = { ...h.record, version: 3 }
  await h.store.save(candidate)
  expect(await currentTail(h.filename)).not.toBe(tail)
  expect(await new ExecutionRunStore(h.directory).read(candidate.runId)).toEqual(candidate)
})

it('selects the new checkpoint generation even when an old tail cannot be retired', async () => {
  const h = await fixture(), tail = await currentTail(h.filename)
  await h.store.save({ ...h.record, version: 2 })
  const remove = fs.rm.bind(fs)
  vi.spyOn(fs, 'rm').mockImplementation(async (filename, options) => {
    if (String(filename) === tail) throw Object.assign(new Error('synthetic retirement failure'), { code: 'EPERM' })
    return remove(filename, options)
  })
  const candidate = { ...h.record, version: 1, updatedAt: 8 }
  await h.store.save(candidate, { checkpoint: true })
  expect(await fs.stat(tail)).toBeDefined()
  expect(await new ExecutionRunStore(h.directory).read(candidate.runId)).toEqual(candidate)
  const next = { ...candidate, updatedAt: 9 }
  await h.store.save(next)
  expect(await new ExecutionRunStore(h.directory).read(next.runId)).toEqual(next)
})

it('loads legacy JSON, then keeps terminal receipts through later cold saves', async () => {
  const h = await fixture()
  await h.store.save({ ...h.record, status: 'completed' })
  await fs.writeFile(h.filename, JSON.stringify(h.record))
  const reopened = new ExecutionRunStore(h.directory)
  expect(await reopened.read(h.record.runId)).toEqual(h.record)
  const terminal = { ...h.record, status: 'interrupted', version: 2, tools: [{ callId: 'unknown', providerCallId: 'unknown', requestId: 'one',
    call: { name: 'file.write', input: {} }, state: 'executing', effectPaths: ['D:/synthetic-output'] }] } as unknown as ExecutionRunRecord
  await reopened.save(terminal)
  const cold = new ExecutionRunStore(h.directory), restored = await cold.read(terminal.runId)
  expect(restored).toEqual(terminal)
  await cold.save({ ...restored!, documentPaths: { document: 'D:/relocated-output' } })
  expect((await cold.read(terminal.runId))?.tools).toEqual(terminal.tools)
})
