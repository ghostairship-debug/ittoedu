// @vitest-environment node
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PodmanComputeBackend } from '../../src/main/workbench/compute/PodmanComputeBackend'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'
import { CodexDelegationRunner } from '../../src/main/workbench/delegation/CodexDelegationRunner'

const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-unlimited-jobs-'))
  roots.push(root)
  return root
}
function processFixture() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  }) as unknown as ChildProcessWithoutNullStreams & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough }
  return process
}

it('keeps compute active beyond prior deadlines without resource quotas and stops only on explicit cancel', async () => {
  const backend = new PodmanComputeBackend({ distro: 'Fixture', image: `sha256:${'a'.repeat(64)}` })
  const process = processFixture()
  vi.spyOn(backend, 'availability').mockResolvedValue({ available: true })
  vi.spyOn(backend as any, 'linuxPath').mockResolvedValue('/fixtures')
  const launch = vi.spyOn(backend as any, 'command').mockReturnValue(process)
  const stop = vi.spyOn(backend, 'stopContainer').mockImplementation(async () => {
    queueMicrotask(() => queueMicrotask(() => process.emit('close', 0)))
    return true
  })
  vi.useFakeTimers()
  const job = await backend.start({ directory: 'fixture', program: 'python3', argv: [],
    containerName: `guoling-compute-${'a'.repeat(32)}` })
  let settled = false
  void job.done.then(() => { settled = true })
  await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
  expect(settled).toBe(false)
  expect(stop).not.toHaveBeenCalled()
  const args = launch.mock.calls[0]![0] as string[]
  expect(args).not.toContain('--timeout')
  expect(args).not.toContain('--memory')
  expect(args).not.toContain('--cpus')
  expect(args).toContain('-1')
  expect(args).toContain('/tmp:rw,nosuid,nodev')
  expect(await job.cancel()).toBe(true)
  expect(await job.done).toMatchObject({ exitCode: 0, cancelled: true })
  expect(stop).toHaveBeenCalledOnce()
})

it('starts independent compute jobs while the earlier job is still active', async () => {
  const directory = await fixture()
  const start = vi.fn(async () => ({ done: new Promise<any>(() => undefined), cancel: async () => true }))
  const backend = { availability: async () => ({ available: true }), start,
    inspectContainer: async () => 'running', stopContainer: async () => true } as unknown as PodmanComputeBackend
  const service = new ComputeJobService({ directory, backend })
  await service.start({ runId: 'run', jobId: 'first', language: 'python', code: '# long work' })
  await service.start({ runId: 'run', jobId: 'second', language: 'python', code: '# independent work' })
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
  expect(await service.status('run', 'first')).toMatchObject({ status: 'running' })
  expect(await service.status('run', 'second')).toMatchObject({ status: 'running' })
  await service.cancelRun('run')
  expect(await service.status('run', 'first')).toMatchObject({ status: 'cancelled', stopped: true })
  expect(await service.status('run', 'second')).toMatchObject({ status: 'cancelled', stopped: true })
})

it('keeps a silent delegated process alive beyond former deadlines and honours user Abort', async () => {
  const root = await fixture(), process = processFixture(), controller = new AbortController()
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  process.stdin.once('finish', () => process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'fixture' }) + '\n'))
  const stop = vi.fn(async () => { process.emit('close', 0, null); return true })
  const runner = new CodexDelegationRunner({ inspectCli: async () => ({ ready: true, reason: 'fixture' }), boundary: {
    assertReady: async () => true, launchRestricted: () => process, stopRestricted: stop,
  } })
  const revoke = vi.fn(async () => undefined), verify = vi.fn()
  vi.useFakeTimers()
  let settled = false
  const work = runner.run({ taskId: 'fixture', goal: 'Long work', copyRoot: root, executablePath: globalThis.process.execPath,
    permission: 'workspace', expectedArtifacts: [], mcp: { endpoint: 'http://127.0.0.1:1234/mcp', bearer: 'fixture', revoke } }, {
    signal: controller.signal, onEvent: event => { if (event.kind === 'started') entered() }, verify,
  }).then(result => { settled = true; return result })
  await started
  await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
  expect(settled).toBe(false)
  expect(stop).not.toHaveBeenCalled()
  expect(revoke).not.toHaveBeenCalled()
  controller.abort()
  const result = await work
  if (result.diagnosticFile) roots.push(path.dirname(result.diagnosticFile))
  expect(result).toMatchObject({ status: 'cancelled', externalChangesPossible: true })
  expect(stop).toHaveBeenCalledOnce()
  expect(revoke).toHaveBeenCalledOnce()
  expect(verify).not.toHaveBeenCalled()
})

it('allows delegated artifact verification to finish beyond the former task deadline', async () => {
  const root = await fixture(), process = processFixture()
  await fs.writeFile(path.join(root, 'answer.txt'), 'preserved')
  process.stdin.once('finish', () => {
    process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\n')
    process.emit('close', 0, null)
  })
  let entered!: () => void, finish!: () => void
  const verifying = new Promise<void>(resolve => { entered = resolve })
  const verification = new Promise<void>(resolve => { finish = resolve })
  const runner = new CodexDelegationRunner({ inspectCli: async () => ({ ready: true, reason: 'fixture' }), boundary: {
    assertReady: async () => true, launchRestricted: () => process, stopRestricted: async () => true,
  } })
  vi.useFakeTimers()
  let settled = false
  const work = runner.run({ taskId: 'fixture', goal: 'Read result', copyRoot: root, executablePath: globalThis.process.execPath,
    permission: 'workspace', expectedArtifacts: ['answer.txt'] }, { verify: async () => {
      entered(); await verification; return { accepted: true, detail: 'read result' }
    } }).then(result => { settled = true; return result })
  await verifying
  await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
  expect(settled).toBe(false)
  finish()
  const result = await work
  if (result.diagnosticFile) roots.push(path.dirname(result.diagnosticFile))
  expect(result).toMatchObject({ status: 'verified', artifacts: [{ bytes: 9 }] })
})
