// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import type { CodexDelegationRunner } from '../../src/main/workbench/delegation/CodexDelegationRunner'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import type { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'

it('blocks unverified paid delegation and routes an approved managed copy through jobs and sealed readback', async () => {
  const base = path.resolve('output/g20/b23')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'delegation-chain-'))
  const workspaceRoot = path.join(root, 'workspace')
  await fs.mkdir(workspaceRoot)
  await fs.writeFile(path.join(workspaceRoot, 'lesson.txt'), 'approved material')
  const run = vi.fn<Pick<CodexDelegationRunner, 'run'>['run']>(async (request, options) => {
    expect(await fs.readFile(path.join(request.copyRoot, 'lesson.txt'), 'utf8')).toBe('approved material')
    await fs.writeFile(path.join(request.copyRoot, 'answer.txt'), 'verified candidate')
    const verification = await options.verify({ copyRoot: request.copyRoot,
      artifacts: [{ path: path.join(request.copyRoot, 'answer.txt'), bytes: 18 }], summary: 'done' })
    return { taskId: request.taskId, status: verification.accepted ? 'verified' as const : 'failed' as const,
      configuredModel: 'gpt-6-luna' as const, configuredSpeed: 'priority' as const,
      account: 'ChatGPT' as const, artifacts: [{ path: path.join(request.copyRoot, 'answer.txt'), bytes: 18 }],
      verification, reason: verification.detail, externalChangesPossible: true }
  })
  const delegation = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'), runner: { run } })
  const jobs = new HostJobService({ delegation, images: {} as ImageGenerationService, builds: {} as ControlledBuildService })
  let available = false
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No document writes expected') } } })
  const gateway = new DocumentToolGateway(registry, [], () => crypto.randomUUID(), { services: {
    jobs, delegation: { availability: () => ({ ready: available, reason: '真实 Codex 写入策略阻断' }),
      startManaged: input => delegation.startManaged(input),
      readArtifact: (runId, jobId, name) => delegation.readArtifact(runId, jobId, name),
      cancel: (runId, jobId) => delegation.cancel(runId, jobId), cancelRun: runId => delegation.cancelRun(runId) },
  } })
  try {
    await gateway.beginRun({ runId: 'blocked', actor: 'agent', documents: [],
      fileAccess: { permission: 'workspace', workspaceRoot } })
    const blocked = await gateway.execute('blocked', 'start', { name: 'delegate.start', input: {
      goal: 'Create an answer', materials: ['lesson.txt'], expectedArtifacts: ['answer.txt'] } })
    expect(blocked).toMatchObject({ kind: 'error', code: 'delegation-blocked' })
    expect(run).not.toHaveBeenCalled()
    await gateway.stop('blocked')

    available = true
    await gateway.beginRun({ runId: 'active', actor: 'agent', documents: [],
      fileAccess: { permission: 'workspace', workspaceRoot } })
    const submitted = await gateway.execute('active', 'start', { name: 'delegate.start', input: {
      goal: 'Create an answer', materials: ['lesson.txt'], expectedArtifacts: ['answer.txt'] } })
    expect(submitted).toMatchObject({ kind: 'read', data: { job: expect.stringMatching(/^delegate-/) } })
    if (submitted.kind !== 'read') throw new Error('delegate did not return a job')
    const job = (submitted.data as { job: string }).job
    const waited = await gateway.execute('active', 'wait', { name: 'job.wait', input: { kind: 'delegation', job, milliseconds: 5000 } })
    expect(waited).toMatchObject({ kind: 'read', data: { kind: 'delegation', status: 'ready', terminal: true } })
    const read = await gateway.execute('active', 'read', { name: 'delegate.read', input: { job, name: 'answer.txt' } })
    expect(read).toMatchObject({ kind: 'read', data: { status: 'read', job, name: 'answer.txt',
      verifiedBytes: true, text: 'verified candidate' } })
    expect(run).toHaveBeenCalledTimes(1)
    await gateway.stop('active')
  } finally {
    const actualBase = await fs.realpath(base), actualRoot = await fs.realpath(root)
    const relative = path.relative(actualBase, actualRoot)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('委派测试清理超出 b23')
    await fs.rm(actualRoot, { recursive: true, force: true })
  }
}, 15_000)
