// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import type { NativeTaskRunner } from '../../src/main/workbench/delegation/NativeTaskRunner'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const launch = (service: DelegationJobService, runId: string, jobId: string) => service.startNative({
  runId, jobId, taskId: 'fixture', permission: 'workspace',
  intent: { goal: jobId, outputs: ['candidate.md'] }, sources: [],
})

it('runs ten native children and queues overflow, cancellation and startup failure release capacity', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'native-capacity-'))
  const started: string[] = [], finish = new Map<string, () => void>()
  const run = vi.fn<NativeTaskRunner['run']>(async (request, options) => {
    started.push(request.jobId)
    if (request.jobId === 'failed-start') throw new Error('fixture startup failure')
    await new Promise<void>(resolve => {
      finish.set(request.jobId, resolve)
      if (options?.signal?.aborted) resolve()
      else options?.signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    return { taskId: request.taskId, status: 'cancelled', artifacts: [], reason: 'fixture stopped', externalChangesPossible: false }
  })
  const service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    nativeRunner: { available: () => true, run, message: async () => {} } })
  try {
    const jobs = await Promise.all(Array.from({ length: 12 }, (_, i) => launch(service, 'parent', `job-${i}`)))
    expect(jobs).toHaveLength(12)
    await expect.poll(() => started.length).toBe(10)
    const queued = jobs.filter(job => !started.includes(job.jobId))
    expect(queued).toHaveLength(2)
    expect(await service.status('parent', queued[0].jobId)).toMatchObject({ status: 'preparing', scheduling: 'queued', nativeConcurrencyLimit: 10 })
    expect(await service.cancel('parent', queued[0].jobId)).toMatchObject({ status: 'cancelled', stopped: true })
    await service.cancel('parent', started[0])
    await expect.poll(() => started.length).toBe(11)
    expect(started).not.toContain(queued[0].jobId)
    // Repeated submissions reuse the original receipt, including queued receipts.
    await launch(service, 'parent', queued[1].jobId)
    expect(run).toHaveBeenCalledTimes(11)
    await launch(service, 'parent', 'failed-start')
    await launch(service, 'parent', 'after-failure')
    finish.get(started[1])!()
    await expect.poll(() => started.includes('after-failure')).toBe(true)
    expect(await service.wait('parent', 'failed-start', 1000)).toMatchObject({ status: 'failed', reason: 'fixture startup failure' })
  } finally {
    await service.cancelRun('parent')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

it('all parents may wait for descendants without holding the shared tree capacity or replaying their runs', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'native-tree-capacity-'))
  let service!: DelegationJobService
  const started: string[] = [], descendants: string[] = []
  const run = vi.fn<NativeTaskRunner['run']>(async (request, options) => {
    started.push(request.jobId)
    const childRunId = `run-${request.jobId}`
    await options?.onPrepared?.({ runId: childRunId } as ExecutionRunRecord)
    await options?.onStarted?.()
    if (request.runId === 'root') {
      const descendant = `descendant-${request.jobId}`
      descendants.push(descendant)
      await launch(service, childRunId, descendant)
      const receipt = await service.wait(childRunId, descendant, 30_000, options?.signal, childRunId)
      expect(receipt.status).toBe('ready')
    }
    await fs.writeFile(path.join(request.copyRoot, 'candidate.md'), request.jobId)
    return { taskId: request.taskId, status: 'verified', childRunId, artifacts: [], reason: 'fixture candidate', externalChangesPossible: true }
  })
  service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    nativeRunner: { available: () => true, run, message: async () => {}, context: async () => ({ rootRunId: 'root', maxConcurrentNative: 2 }) } })
  try {
    await Promise.all(['one', 'two'].map(job => launch(service, 'root', job)))
    const results = await Promise.all(['one', 'two'].map(job => service.wait('root', job, 30_000)))
    expect(results.map(job => job.status)).toEqual(['ready', 'ready'])
    expect(started).toHaveLength(4)
    expect(new Set(started).size).toBe(4)
    expect(descendants).toHaveLength(2)
    expect(results.every(job => job.nativeTreeRoot === 'root' && job.nativeConcurrencyLimit === 2)).toBe(true)
  } finally {
    await Promise.all([service.cancelRun('root'), ...['one', 'two'].map(job => service.cancelRun(`run-${job}`))])
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}, 10_000)

it('queues directed messages before a child starts and sends them to its actual run once started', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'native-queued-message-'))
  let release!: () => void
  const message = vi.fn<NativeTaskRunner['message']>(async () => {})
  const started: string[] = []
  const run = vi.fn<NativeTaskRunner['run']>(async (request, options) => {
    started.push(request.jobId)
    await options?.onPrepared?.({ runId: `run-${request.jobId}` } as ExecutionRunRecord)
    await options?.onStarted?.()
    if (request.jobId === 'one') await new Promise<void>(resolve => { release = resolve; options?.signal?.addEventListener('abort', () => resolve(), { once: true }) })
    await fs.writeFile(path.join(request.copyRoot, 'candidate.md'), request.jobId)
    return { taskId: request.taskId, status: 'verified', childRunId: `run-${request.jobId}`, artifacts: [], reason: 'fixture', externalChangesPossible: true }
  })
  const service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'), maxConcurrentNativePerRun: 1,
    nativeRunner: { available: () => true, run, message } })
  try {
    await launch(service, 'root', 'one')
    await expect.poll(() => typeof release).toBe('function')
    await launch(service, 'root', 'two')
    expect(await service.message('root', 'two', 'update', 'Use this shared constraint')).toMatchObject({ delivery: 'queued' })
    expect(message).not.toHaveBeenCalled()
    release()
    expect(await service.wait('root', 'two', 3000)).toMatchObject({ status: 'ready' })
    expect(message).toHaveBeenCalledWith('run-two', 'delegation:two:root:update', { senderRunId: 'root', text: 'Use this shared constraint' })
  } finally {
    await service.cancelRun('root')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
