// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import type { CodexDelegationRunner } from '../../src/main/workbench/delegation/CodexDelegationRunner'

const fixtures: string[] = []
afterEach(async () => {
  const base = await fs.realpath(resolve('output/g20/b23'))
  for (const fixture of fixtures.splice(0)) {
    const actual = await fs.realpath(fixture)
    const rel = relative(base, actual)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('委派测试清理范围无效')
    await fs.rm(actual, { recursive: true, force: true })
  }
})
async function fixture() {
  const base = resolve('output/g20/b23')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(join(base, 'delegation-job-'))
  fixtures.push(root)
  const copyRootBase = join(root, 'copies'), copyRoot = join(copyRootBase, 'task')
  await fs.mkdir(copyRoot, { recursive: true })
  return { root, copyRootBase, copyRoot, directory: join(root, 'jobs') }
}
const input = (copyRoot: string) => ({ runId: 'parent-run', jobId: 'delegate-1', taskId: 'child-1',
  goal: 'Write the declared artifact', copyRoot, permission: 'workspace' as const,
  expectedArtifacts: ['answer.txt'] })
const result = (taskId: string, status: 'verified' | 'unknown') => ({ taskId, status,
  configuredModel: 'gpt-6-luna' as const, configuredSpeed: 'priority' as const,
  account: 'ChatGPT' as const, cliVersion: 'codex-cli fixture', artifacts: [],
  reason: status === 'verified' ? '回读完成' : '停止后外部副作用未知', externalChangesPossible: true })

it('persists a receipt before dispatch, seals a checked artifact, and never replays the same job', async () => {
  const paths = await fixture()
  const run = vi.fn<Pick<CodexDelegationRunner, 'run'>['run']>(async (request, options) => {
    await fs.writeFile(join(paths.copyRoot, 'answer.txt'), 'delegated-result')
    options.onEvent?.({ kind: 'started', detail: 'fixture-runner' })
    const verified = await options.verify({ copyRoot: paths.copyRoot,
      artifacts: [{ path: join(paths.copyRoot, 'answer.txt'), bytes: 16 }], summary: 'artifact made' })
    return { ...result(request.taskId, verified.accepted ? 'verified' : 'unknown'), verification: verified }
  })
  const service = new DelegationJobService({ ...paths, runner: { run } })
  const accepted = await service.start(input(paths.copyRoot))
  expect(['preparing', 'running']).toContain(accepted.status)
  const ready = await service.wait('parent-run', 'delegate-1', 5000)
  expect(ready).toMatchObject({ status: 'ready', terminal: true, configuredModel: 'gpt-6-luna',
    configuredSpeed: 'priority', billedAmount: null, artifacts: [{ name: 'answer.txt', byteLength: 16 }] })
  expect((await service.logs('parent-run', 'delegate-1')).entries.some(entry => entry.kind === 'started')).toBe(true)
  await fs.writeFile(join(paths.copyRoot, 'answer.txt'), 'later-user-change')
  expect(Buffer.from((await service.readArtifact('parent-run', 'delegate-1', 'answer.txt')).bytes).toString())
    .toBe('delegated-result')
  expect((await service.start(input(paths.copyRoot))).status).toBe('ready')
  expect(run).toHaveBeenCalledTimes(1)
  const restarted = new DelegationJobService({ ...paths, runner: { run } })
  expect((await restarted.status('parent-run', 'delegate-1')).status).toBe('ready')
  await expect(restarted.status('other-run', 'delegate-1')).rejects.toThrow('不属于当前运行')
})

it('rejects unapproved copy roots and preserves unknown effects after cancellation', async () => {
  const paths = await fixture()
  const service = new DelegationJobService({ ...paths, runner: { run: (_request, options) => new Promise(resolve => {
    options.signal?.addEventListener('abort', () => resolve(result('child-1', 'unknown')), { once: true })
  }) } })
  await expect(service.start(input(paths.root))).rejects.toThrow('副本授权根')
  await service.start(input(paths.copyRoot))
  const stopped = await service.cancel('parent-run', 'delegate-1')
  expect(stopped).toMatchObject({ status: 'unknown', terminal: true, stopped: true, artifacts: [] })
  await expect(service.readArtifact('parent-run', 'delegate-1', 'answer.txt')).rejects.toThrow('尚未完成')
})

it('builds a bounded managed copy from named workspace files and reuses its durable receipt', async () => {
  const paths = await fixture()
  const workspaceRoot = join(paths.root, 'workspace')
  await fs.mkdir(join(workspaceRoot, 'notes'), { recursive: true })
  await fs.writeFile(join(workspaceRoot, 'notes', 'lesson.txt'), 'authorized-source')
  const run = vi.fn<Pick<CodexDelegationRunner, 'run'>['run']>(async (request, options) => {
    expect(request.copyRoot).not.toBe(workspaceRoot)
    expect(await fs.readFile(join(request.copyRoot, 'notes', 'lesson.txt'), 'utf8')).toBe('authorized-source')
    await fs.writeFile(join(request.copyRoot, 'answer.txt'), 'delegated-result')
    const verified = await options.verify({ copyRoot: request.copyRoot,
      artifacts: [{ path: join(request.copyRoot, 'answer.txt'), bytes: 16 }], summary: 'done' })
    return { ...result(request.taskId, verified.accepted ? 'verified' : 'unknown'), verification: verified }
  })
  const service = new DelegationJobService({ ...paths, runner: { run } })
  const managed = { runId: 'parent-run', jobId: 'managed-1', taskId: 'managed-child', goal: 'Create answer.txt',
    workspaceRoot, materials: ['notes/lesson.txt'], permission: 'workspace' as const,
    expectedArtifacts: ['answer.txt'] }
  await service.startManaged(managed)
  expect((await service.wait('parent-run', 'managed-1', 5000)).status).toBe('ready')
  expect((await service.startManaged(managed)).status).toBe('ready')
  expect(run).toHaveBeenCalledTimes(1)
  await expect(service.startManaged({ ...managed, jobId: 'escape', materials: ['../outside.txt'] }))
    .rejects.toThrow('相对路径')
})
