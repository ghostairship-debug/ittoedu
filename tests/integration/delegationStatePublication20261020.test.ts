// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import type { NativeTaskRunner } from '../../src/main/workbench/delegation/NativeTaskRunner'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks(); Object.defineProperty(process, 'platform', platform)
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const denied = (from: unknown, to: unknown) => Object.assign(new Error(`EPERM: rename '${from}' -> '${to}'`), { code: 'EPERM', syscall: 'rename', path: String(from), dest: String(to) })
async function fixture() {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'delegation-publication-')), entered = deferred(), release = deferred()
  cleanup.push(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }))
  const run = vi.fn<NativeTaskRunner['run']>(async request => {
    entered.resolve(); await release.promise
    await fs.writeFile(path.join(request.copyRoot, 'candidate.md'), 'retained candidate')
    return { taskId: request.taskId, status: 'verified', artifacts: [], reason: 'fixture complete', externalChangesPossible: true }
  })
  const service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    nativeRunner: { available: () => true, run, message: async () => {} } })
  cleanup.push(async () => { release.resolve(); await service.cancelRun('parent') })
  const input = { runId: 'parent', jobId: 'job', taskId: 'task', permission: 'workspace' as const,
    intent: { goal: 'Preserve the candidate', outputs: ['candidate.md'] }, sources: [] }
  await service.startNative(input); await entered.promise
  const folder = path.join(root, 'jobs', (await fs.readdir(path.join(root, 'jobs')))[0]), filename = path.join(folder, 'state.json')
  return { service, input, run, release, folder, filename }
}

it('serializes refresh reads with state replacement and republishes the same receipt after one Windows sharing failure', async () => {
  const h = await fixture(), readEntered = deferred(), releaseRead = deferred(), readFile = fs.readFile.bind(fs), nativeRename = fs.rename.bind(fs)
  let held = false, reading = false
  vi.spyOn(fs, 'readFile').mockImplementation((async (filename: unknown, ...args: unknown[]) => {
    if (!held && String(filename) === h.filename) {
      held = true; reading = true; readEntered.resolve(); await releaseRead.promise
      try { return await (readFile as (...values: unknown[]) => Promise<unknown>)(filename, ...args) } finally { reading = false }
    }
    return (readFile as (...values: unknown[]) => Promise<unknown>)(filename, ...args)
  }) as typeof fs.readFile)
  const attempts: Array<{ from: string; to: string; content: string }> = []
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === h.filename) {
      expect(reading).toBe(false)
      attempts.push({ from: String(from), to: String(to), content: await readFile(from, 'utf8') })
      if (attempts.length === 1) throw denied(from, to)
    }
    return nativeRename(from, to)
  })
  const refreshed = h.service.listNative(['parent'])
  await readEntered.promise
  h.release.resolve()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(attempts).toHaveLength(0)
  releaseRead.resolve()
  expect(await refreshed).toEqual([expect.objectContaining({ status: 'ready' })])
  expect(attempts).toHaveLength(2)
  expect(attempts[1]).toEqual(attempts[0])
  expect(h.run).toHaveBeenCalledOnce()
  expect((await fs.readdir(h.folder)).filter(name => name.endsWith('.tmp'))).toEqual([])
})

it('preserves the previous state and complete failed publications without replaying a child on persistent EPERM', async () => {
  const h = await fixture(), previous = JSON.parse(await fs.readFile(h.filename, 'utf8'))
  const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { throw denied(from, to) })
  h.release.resolve()
  await expect(h.service.wait('parent', 'job', 3000)).rejects.toMatchObject({ code: 'EPERM' })
  expect(JSON.parse(await fs.readFile(h.filename, 'utf8'))).toEqual(previous)
  const candidates = (await fs.readdir(h.folder)).filter(name => name.endsWith('.tmp'))
  expect(candidates.length).toBeGreaterThan(0)
  const receipts = await Promise.all(candidates.map(name => fs.readFile(path.join(h.folder, name), 'utf8').then(JSON.parse)))
  expect(receipts).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'ready', artifacts: [expect.objectContaining({ name: 'candidate.md' })] })]))
  expect(h.run).toHaveBeenCalledOnce()
  rename.mockRestore()
  expect(await h.service.startNative(h.input)).toMatchObject({ status: 'unknown', terminal: true })
  expect(h.run).toHaveBeenCalledOnce()
})
