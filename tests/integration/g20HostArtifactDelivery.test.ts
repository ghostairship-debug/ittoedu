// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HostArtifactDeliveryService, type ArtifactDeliveryInput } from '../../src/main/workbench/execution/HostArtifactDeliveryService'

const cleanup: string[] = []
afterEach(async () => { for (const root of cleanup.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
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
})
