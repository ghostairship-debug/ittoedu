// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HostArtifactDeliveryService, type ArtifactDeliveryInput } from '../../src/main/workbench/execution/HostArtifactDeliveryService'

const cleanup: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of cleanup.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture(withFileOperation?: <T>(work: () => Promise<T>) => Promise<T>) {
  const base = await mkdtemp(path.join(tmpdir(), 'g20-artifact-'))
  cleanup.push(base)
  const workspaceRoot = path.join(base, 'workspace'), journalDirectory = path.join(base, 'journal')
  await fs.mkdir(path.join(workspaceRoot, 'exports'), { recursive: true })
  const service = new HostArtifactDeliveryService({ journalDirectory,
    withFileOperation: withFileOperation ?? (work => work()) })
  const bytes = Uint8Array.from([0, 1, 2, 3, 255])
  const input: ArtifactDeliveryInput = { runId: 'run-1', operationId: 'deliver-1', workspaceRoot,
    permission: 'workspace', destination: 'exports/result.bin', sourceKind: 'compute', sourceId: 'job-1:result.bin',
    bytes, assertActive: () => undefined }
  return { base, workspaceRoot, journalDirectory, service, bytes, input }
}

describe('M28 host artifact delivery', () => {
  it('atomically creates verified bytes, rereads them and recovers a durable source receipt', async () => {
    const { journalDirectory, service, bytes, input } = await fixture()
    const receipt = await service.deliver(input)
    expect(receipt).toMatchObject({ status: 'written', sourceKind: 'compute', sourceId: 'job-1:result.bin',
      byteLength: bytes.length, version: `sha256:${createHash('sha256').update(bytes).digest('hex')}` })
    expect(Object.keys(receipt).sort()).toEqual(['byteLength', 'operationId', 'path', 'sourceId', 'sourceKind', 'status', 'version'])
    expect(await fs.readFile(receipt.path)).toEqual(Buffer.from(bytes))
    const reopened = new HostArtifactDeliveryService({ journalDirectory, withFileOperation: work => work() })
    expect(await reopened.lookup('deliver-1')).toMatchObject(receipt)
    expect(await reopened.deliver(input)).toMatchObject(receipt)
    await expect(reopened.deliver({ ...input, bytes: Uint8Array.from([99]) })).rejects.toThrow('不同目标或字节')
  })

  it('never overwrites an existing destination or a concurrently created destination', async () => {
    const { service, input } = await fixture()
    await fs.writeFile(path.join(input.workspaceRoot, 'exports', 'result.bin'), 'user content', { flag: 'wx' })
    expect(await service.deliver(input)).toMatchObject({ status: 'conflict' })
    expect(await fs.readFile(path.join(input.workspaceRoot, 'exports', 'result.bin'), 'utf8')).toBe('user content')
    const second = { ...input, operationId: 'deliver-2', destination: 'exports/race.bin' }
    const [a, b] = await Promise.all([service.deliver(second), service.deliver({ ...second, operationId: 'deliver-3',
      sourceId: 'image-1', sourceKind: 'image', bytes: Uint8Array.from([8, 9]) })])
    expect([a.status, b.status].sort()).toEqual(['conflict', 'written'])
    const actual = await fs.readFile(path.join(input.workspaceRoot, 'exports', 'race.bin'))
    expect([Buffer.from(second.bytes), Buffer.from([8, 9])].some(bytes => bytes.equals(actual))).toBe(true)
  })

  it('rejects workspace escape, unapproved ask mode, parent symlink and a non-directory parent', async () => {
    const { base, service, input } = await fixture()
    await expect(service.deliver({ ...input, destination: path.join(base, 'outside.bin') })).rejects.toThrow('明确批准')
    await expect(service.deliver({ ...input, permission: 'ask' })).rejects.toThrow('明确批准')
    await fs.writeFile(path.join(input.workspaceRoot, 'not-a-dir'), 'x')
    await expect(service.deliver({ ...input, destination: 'not-a-dir/result.bin' })).rejects.toThrow()
    const alias = path.join(input.workspaceRoot, 'alias')
    try { await fs.symlink(path.join(input.workspaceRoot, 'exports'), alias, process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) { if (process.platform !== 'win32') throw error; return }
    await expect(service.deliver({ ...input, destination: 'alias/linked.bin' })).rejects.toThrow('符号链接')
  })

  it('requires an exact approved target for an outside or ask-mode delivery', async () => {
    const { base, service, input } = await fixture()
    const destination = path.join(base, 'approved.bin')
    const outside = await service.preflight({ workspaceRoot: input.workspaceRoot, permission: 'workspace', destination })
    expect(outside).toMatchObject({ outsideWorkspace: true, approvalRequired: true, path: destination })
    await expect(service.deliver({ ...input, destination, approvedTargetPath: path.join(base, 'other.bin') })).rejects.toThrow('不一致')
    expect(await service.deliver({ ...input, destination, approvedTargetPath: outside.path })).toMatchObject({ status: 'written', path: destination })
    const ask = await service.preflight({ workspaceRoot: input.workspaceRoot, permission: 'ask', destination: 'exports/ask.bin' })
    expect(ask.approvalRequired).toBe(true)
    expect(await service.deliver({ ...input, operationId: 'ask-1', permission: 'ask', destination: 'exports/ask.bin',
      approvedTargetPath: ask.path })).toMatchObject({ status: 'written' })
  })

  it('obeys stop before commit and waits for an in-flight delivery before completing stop', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const enteredGate = new Promise<void>(resolve => { entered = resolve })
    const { service, input } = await fixture(async work => { entered(); await gate; return work() })
    const delivery = service.deliver(input)
    await enteredGate
    const stopped = service.stopRun(input.runId)
    release()
    await stopped
    expect(await delivery).toMatchObject({ status: 'stopped' })
    await expect(fs.lstat(path.join(input.workspaceRoot, 'exports', 'result.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps an unknown result queryable without claiming matching bytes prove provenance', async () => {
    const { service, input } = await fixture(async work => { await work(); throw new Error('receipt lost after link') })
    const outcome = await service.deliver(input)
    expect(outcome).toMatchObject({ status: 'unknown', observed: 'matching' })
    expect(await fs.readFile(outcome.path)).toEqual(Buffer.from(input.bytes))
    expect(await service.lookup(input.operationId)).toMatchObject({ status: 'unknown', observed: 'matching' })
    expect(await service.deliver(input)).toMatchObject({ status: 'unknown' })
  })

  it.each(['ENOSPC', 'EACCES'])('records a pre-publication %s rejection and can save the same artifact after correction', async failureCode => {
    const { service, input, journalDirectory } = await fixture()
    const open = fs.open.bind(fs), outputDirectory = path.join(input.workspaceRoot, 'exports')
    const failedOpen = vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      if (path.dirname(String(filename)) === outputDirectory)
        throw Object.assign(new Error(`fixture ${failureCode}`), { code: failureCode })
      return open(filename, flags, mode)
    })
    const publish = vi.spyOn(fs, 'link')
    const rejected = await service.deliver(input)
    expect(rejected).toMatchObject({ status: 'rejected' })
    expect(rejected.message).toContain(failureCode)
    expect(publish).not.toHaveBeenCalled()
    expect(await fs.readdir(outputDirectory)).toEqual([])
    failedOpen.mockRestore()
    const reopened = new HostArtifactDeliveryService({ journalDirectory, withFileOperation: work => work() })
    expect(await reopened.lookup(input.operationId)).toMatchObject(rejected)
    expect(await reopened.deliver(input)).toMatchObject(rejected)
    const corrected = await reopened.deliver({ ...input, operationId: 'corrected-delivery' })
    expect(corrected.status).toBe('written')
    expect(await fs.readFile(corrected.path)).toEqual(Buffer.from(input.bytes))
  })

  it('cleans its incomplete temporary file when staging bytes fails before publication', async () => {
    const { service, input } = await fixture()
    const open = fs.open.bind(fs), outputDirectory = path.join(input.workspaceRoot, 'exports')
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode)
      if (path.dirname(String(filename)) === outputDirectory) vi.spyOn(handle, 'writeFile').mockRejectedValue(
        Object.assign(new Error('fixture disk full during staging'), { code: 'ENOSPC' }))
      return handle
    })
    expect(await service.deliver(input)).toMatchObject({ status: 'rejected' })
    expect(await fs.readdir(outputDirectory)).toEqual([])
  })

  it('uses a definite publication rejection to allow a corrected new delivery', async () => {
    const { service, input } = await fixture()
    const publish = vi.spyOn(fs, 'link').mockRejectedValueOnce(
      Object.assign(new Error('fixture denied publication'), { code: 'EACCES' }))
    expect(await service.deliver(input)).toMatchObject({ status: 'rejected' })
    expect(publish).toHaveBeenCalledOnce()
    expect(await fs.readdir(path.join(input.workspaceRoot, 'exports'))).toEqual([])
    const corrected = await service.deliver({ ...input, operationId: 'corrected-publication' })
    expect(corrected.status).toBe('written')
    expect(await fs.readFile(corrected.path)).toEqual(Buffer.from(input.bytes))
  })
})

it('seals and delivers an 80 MiB compute artifact through the real services without the former 64 MiB cutoff', async () => {
  const { ComputeJobService } = await import('../../src/main/workbench/compute/ComputeJobService')
  const { base, service, input } = await fixture()
  const bytes = Buffer.alloc(80 * 1024 * 1024, 37); bytes.write('actual-large-source', 0)
  // Only the container runner is replaced: actual inputs, transformation, sealing, delivery and reread use disk.
  const backend = { availability: async () => ({ available: true }), start: async (request: { directory: string }) => {
    const done = (async () => {
      await fs.copyFile(path.join(request.directory, 'input', 'source.bin'), path.join(request.directory, 'output', 'result.bin'))
      const file = await fs.open(path.join(request.directory, 'output', 'result.bin'), 'r+')
      try { await file.write(Buffer.from('transformed'), 0, 11, 0) } finally { await file.close() }
      return { exitCode: 0, stdout: 'transformed', stderr: '', timedOut: false, cancelled: false, truncated: false }
    })()
    return { done, cancel: async () => true }
  } }
  const compute = new ComputeJobService({ directory: path.join(base, 'compute'), backend: backend as never })
  const started = await compute.start({ runId: input.runId, jobId: 'large', language: 'python',
    code: 'fixture backend copies and transforms the declared input', inputs: [{ name: 'source.bin', bytes }], outputNames: ['result.bin'] })
  const ready = await compute.wait(input.runId, started.jobId, 10_000)
  expect(ready.status).toBe('ready')
  const artifact = await compute.readArtifact(input.runId, started.jobId, 'result.bin')
  const delivered = await service.deliver({ ...input, bytes: artifact.bytes, sourceId: `${started.jobId}@${artifact.artifact.name}` })
  expect(delivered.status).toBe('written')
  const saved = await fs.readFile(path.join(input.workspaceRoot, 'exports/result.bin'))
  expect(saved.byteLength).toBe(bytes.byteLength)
  expect(saved.subarray(0, 11).toString()).toBe('transformed')
  expect(createHash('sha256').update(saved).digest('hex')).toBe(artifact.artifact.digest)
  expect((await service.lookup(input.operationId))?.status).toBe('written')
})
