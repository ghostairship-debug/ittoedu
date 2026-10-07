// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

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
  await h.store.save(candidate)
  expect(rename).toHaveBeenCalledTimes(2)
  expect(calls[1]).toEqual(calls[0])
  expect(JSON.parse(calls[1].content)).toEqual(candidate)
  expect(open).toHaveBeenCalledTimes(1)
  expect(await h.store.read(h.record.runId)).toEqual(candidate)
  expect((await fs.readdir(h.directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
})

it('reports persistent EPERM after two publications and preserves the old record and complete candidate', async () => {
  const h = await fixture(), candidate = { ...h.record, version: 2 }
  const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { throw denied(String(from), String(to)) })
  const failed = h.store.save(candidate)
  await expect(failed).rejects.toMatchObject({ code: 'EPERM', syscall: 'rename', dest: h.filename })
  expect(rename).toHaveBeenCalledTimes(2)
  expect(rename.mock.calls[1]).toEqual(rename.mock.calls[0])
  expect(await h.store.read(h.record.runId)).toEqual(h.record)
  const preserved = (await fs.readdir(h.directory)).filter(name => name.endsWith('.tmp'))
  expect(preserved).toHaveLength(1)
  expect(JSON.parse(await fs.readFile(path.join(h.directory, preserved[0]), 'utf8'))).toEqual(candidate)
  expect(await h.store.list()).toEqual([h.record])
  rename.mockRestore()
  await h.store.save({ ...h.record, version: 3 })
  expect((await h.store.read(h.record.runId))?.version).toBe(3)
})
