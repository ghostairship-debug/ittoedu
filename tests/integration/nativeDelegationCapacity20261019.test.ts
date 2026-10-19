// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import type { NativeTaskRunner } from '../../src/main/workbench/delegation/NativeTaskRunner'

it('admits at most two actual native children per parent, atomically, even during preparation', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'native-capacity-'))
  const started: string[] = []
  const run = vi.fn<NativeTaskRunner['run']>(async (request, options) => {
    const signal = options?.signal
    started.push(request.jobId)
    return new Promise(resolve => {
      signal?.addEventListener('abort', () => resolve({
        taskId: request.taskId, status: 'cancelled', artifacts: [], reason: 'fixture stopped',
        externalChangesPossible: false,
      }), { once: true })
    })
  })
  const service = new DelegationJobService({
    directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    nativeRunner: { available: () => true, run, message: async () => {} },
  })
  const launch = (runId: string, jobId: string) => service.startNative({
    runId, jobId, taskId: 'fixture', permission: 'workspace',
    intent: { goal: 'Prepare ' + jobId, outputs: ['candidate.md'] }, sources: [],
  })
  try {
    const results = await Promise.allSettled(['one', 'two', 'three', 'four'].map(id => launch('parent', id)))
    const accepted = results.filter(result => result.status === 'fulfilled')
    const denied = results.filter(result => result.status === 'rejected')
    expect(accepted).toHaveLength(2)
    expect(denied).toHaveLength(2)
    for (const rejected of denied) {
      if (rejected.status === 'rejected') expect(rejected.reason).toMatchObject({ code: 'native-concurrency-limit' })
    }
    await expect.poll(() => started.length).toBe(2)
    const firstId = (accepted[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof launch>>>).value.jobId
    expect(await launch('parent', firstId)).toMatchObject({ runId: 'parent', jobId: firstId })
    expect(run).toHaveBeenCalledTimes(2) // receipt replay does not start a third model
    // Another independent parent retains its own two slots.
    await launch('other-parent', 'independent')
    await expect.poll(() => started.length).toBe(3)
    expect(await service.cancel('parent', firstId)).toMatchObject({ terminal: true, stopped: true })
    const newChild = await launch('parent', 'reused-slot')
    expect(newChild.jobId).toBe('reused-slot')
    await expect.poll(() => started.length).toBe(4)
  } finally {
    await Promise.all([service.cancelRun('parent'), service.cancelRun('other-parent')])
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

it('allows a conservative configurable limit without silently exceeding it', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'native-capacity-custom-'))
  const run = vi.fn<NativeTaskRunner['run']>(async (request, options) =>
    new Promise(resolve => {
      const signal = options?.signal
      signal?.addEventListener('abort', () => resolve({
        taskId: request.taskId, status: 'cancelled', artifacts: [], reason: 'fixture stopped',
        externalChangesPossible: false,
      }), { once: true })
    }))
  const service = new DelegationJobService({
    directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    maxConcurrentNativePerRun: 1, nativeRunner: { available: () => true, run, message: async () => {} },
  })
  const launch = (jobId: string) => service.startNative({
    runId: 'parent', jobId, taskId: 'fixture', permission: 'workspace',
    intent: { goal: jobId, outputs: ['candidate.md'] }, sources: [],
  })
  try {
    await launch('one')
    await expect(launch('two')).rejects.toMatchObject({ code: 'native-concurrency-limit' })
    await expect.poll(() => run.mock.calls.length).toBe(1)
    expect(run).toHaveBeenCalledTimes(1)
    await service.cancelRun('parent')
  } finally {
    await service.cancelRun('parent')
    await fs.rm(root, { recursive: true, force: true })
  }
})
