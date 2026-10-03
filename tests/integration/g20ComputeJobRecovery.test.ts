// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'
import type { ComputeProcessResult } from '../../src/main/workbench/compute/PodmanComputeBackend'
import { PodmanComputeBackend } from '../../src/main/workbench/compute/PodmanComputeBackend'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-compute-recovery-')); roots.push(root); return root }
const request = { runId: 'run', jobId: 'stable-job', language: 'python' as const, code: "print('hello')", outputNames: [] }

it('keeps an unconfirmed stop unknown, then records a known late result as unapplied', async () => {
  const root = await fixture()
  let finish!: (result: ComputeProcessResult) => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const done = new Promise<ComputeProcessResult>(resolve => { finish = resolve })
  const backend = { availability: async () => ({ available: true }), start: async () => { entered(); return { done, cancel: async () => false } },
    inspectContainer: async () => 'unknown', stopContainer: async () => false } as unknown as PodmanComputeBackend
  const service = new ComputeJobService({ directory: root, backend })
  expect(await service.start(request)).toMatchObject({ status: 'preparing' })
  await started
  expect(await service.cancel('run', request.jobId)).toMatchObject({ status: 'unknown', stopped: true })
  finish({ exitCode: 0, stdout: 'late\n', stderr: '', truncated: false, cancelled: false })
  let final = await service.status('run', request.jobId)
  for (let n = 0; n < 50 && final.status === 'unknown'; n++) { await new Promise(resolve => setTimeout(resolve, 10)); final = await service.status('run', request.jobId) }
  expect(final.status).toBe('unapplied')
  expect(final.exitCode).toBe(0)
  expect(await service.logs('run', request.jobId)).toMatchObject({ entries: [expect.objectContaining({ message: 'late' })] })
})

it('recovers a durable container identity and attempts to stop it before reporting unknown', async () => {
  const root = await fixture()
  const inspect = vi.fn(async (_name: string) => 'running' as const), stop = vi.fn(async (_name: string) => true)
  const backend = { availability: async () => ({ available: true }), start: async () => ({ done: new Promise<ComputeProcessResult>(() => undefined), cancel: async () => true }),
    inspectContainer: inspect, stopContainer: stop } as unknown as PodmanComputeBackend
  const first = new ComputeJobService({ directory: root, backend })
  await first.start(request)
  const restored = new ComputeJobService({ directory: root, backend })
  expect(await restored.status('run', request.jobId)).toMatchObject({ status: 'unknown', reason: expect.stringContaining('已停止') })
  expect(inspect).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
  expect(stop.mock.calls[0]![0]).toMatch(/^guoling-compute-[a-f0-9]{32}$/)
  expect(await restored.status('run', request.jobId)).toMatchObject({ status: 'unknown' })
  expect(inspect).toHaveBeenCalledOnce() // The unknown job is not retried or polled repeatedly.
})

it('coalesces concurrent stop requests without losing confirmed stop or granting another run access', async () => {
  const root = await fixture()
  const cancel = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 20)); return true })
  const backend = { availability: async () => ({ available: true }),
    start: async () => ({ done: new Promise<ComputeProcessResult>(() => undefined), cancel }),
    inspectContainer: async () => 'running', stopContainer: async () => true } as unknown as PodmanComputeBackend
  const service = new ComputeJobService({ directory: root, backend })
  await service.start(request)
  for (let n = 0; n < 50 && (await service.status('run', request.jobId)).status === 'preparing'; n++)
    await new Promise(resolve => setTimeout(resolve, 10))
  const [a, b, denied] = await Promise.allSettled([
    service.cancel('run', request.jobId), service.cancel('run', request.jobId), service.cancel('other-run', request.jobId),
  ])
  expect(a).toMatchObject({ status: 'fulfilled', value: { status: 'cancelled', stopped: true } })
  expect(b).toMatchObject({ status: 'fulfilled', value: { status: 'cancelled', stopped: true } })
  expect(denied).toMatchObject({ status: 'rejected', reason: { code: 'job-not-authorized' } })
  expect(cancel).toHaveBeenCalledOnce()
})
