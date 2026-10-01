// @vitest-environment node
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { HostJobRef, HostToolServices } from '../../src/core/tools/HostToolServices'
import { workbenchServiceToolCatalog } from '../../src/core/tools/WorkbenchServiceTools'
import type { ComputeJobInput, ComputeJobSnapshot } from '../../src/shared/workbench/compute'
import type { ExecutionPermissionMode } from '../../src/shared/workbench/executionPermission'

const baseline = ['web.search', 'web.open', 'mcp.discover', 'mcp.invoke', 'mcp.resource', 'media.discover']
const jobs = ['job.status', 'job.wait', 'job.logs', 'job.cancel', 'compute.run', 'delegate.start', 'delegate.read']
const serviceNames = new Set<string>(workbenchServiceToolCatalog.map(tool => tool.name))

function fixture() {
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { append: async () => {}, save: async () => { throw new Error('Discovery must not save files') } } })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const calls: string[] = []
  const jobView = (name: string, ref: HostJobRef) => {
    calls.push(name)
    return { kind: ref.kind, jobId: ref.jobId, status: 'running', terminal: false, snapshot: {} }
  }
  const compute = (input: ComputeJobInput): ComputeJobSnapshot => ({ runId: input.runId, jobId: input.jobId,
    requestDigest: 'fixture', status: 'running', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    stopped: false, outputNames: input.outputNames ?? [], artifacts: [] })
  const unused = async (): Promise<never> => { throw new Error('Unexpected service operation') }
  const services: HostToolServices = {
    jobs: { status: async ref => jobView('job.status', ref), wait: async ref => jobView('job.wait', ref),
      logs: async () => { calls.push('job.logs'); return { entries: [] } }, cancel: async ref => jobView('job.cancel', ref) },
    compute: { start: async input => { calls.push('compute.run'); return compute(input) },
      readArtifact: unused, cancel: unused, cancelRun: async () => {} },
    delegation: { availability: () => ({ ready: true, reason: 'Local catalog fixture' }),
      startManaged: async input => { calls.push('delegate.start'); return { jobId: input.jobId, status: 'running',
        terminal: false, stopped: false, artifacts: [] } },
      readArtifact: async (_runId, _jobId, name) => { calls.push('delegate.read'); return {
        artifact: { name, digest: 'fixture', byteLength: 4 }, bytes: new TextEncoder().encode('done') } },
      cancel: unused, cancelRun: async () => {} },
    media: { discover: () => ({ capabilities: [] }), start: async () => {
      calls.push('media.start'); return { status: 'not-configured' }
    } },
  }
  gateway.configureHostServices(services)
  const begin = (runId: string, permission: ExecutionPermissionMode = 'workspace') => gateway.beginRun({
    runId, actor: 'agent', documents: [], fileAccess: { permission, workspaceRoot: 'D:/catalog-fixture' },
  })
  const names = async (runId: string) => (await gateway.describeRun(runId)).map(tool => tool.name)
  return { driver, registry, gateway, calls, begin, names }
}

it('keeps web and MCP discovery visible in empty and Markdown runs while advertising the two optional service families', async () => {
  const h = fixture()
  await h.begin('empty')
  const document = await h.registry.create(h.driver.load(new TextEncoder().encode('draft')), 'draft.md')
  await h.gateway.beginRun({ runId: 'markdown', actor: 'agent',
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 5 }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: 'D:/catalog-fixture' } })
  for (const runId of ['empty', 'markdown']) {
    expect((await h.names(runId)).filter(name => serviceNames.has(name))).toEqual(baseline)
    expect(await h.gateway.availableToolFamilies(runId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'jobs', count: 7 }), expect.objectContaining({ family: 'media', count: 1 }),
    ]))
    expect(await h.gateway.execute(runId, 'hidden-compute', { name: 'compute.run', input: { code: 'print(1)' } }))
      .toMatchObject({ kind: 'error', code: 'tool-not-advertised' })
  }
  await h.gateway.beginRun({ runId: 'without-file-grant', actor: 'agent', documents: [] })
  await h.gateway.loadToolFamilies('without-file-grant', ['jobs', 'media'])
  expect((await h.names('without-file-grant')).filter(name => serviceNames.has(name))).toEqual([])
  expect(h.calls).toEqual([])
})

it('one jobs load exposes working compute, delegation and all job management routes together', async () => {
  const h = fixture()
  await h.begin('work')
  await h.gateway.loadToolFamilies('work', ['jobs'])
  const loaded = await h.names('work')
  expect(loaded.filter(name => jobs.includes(name))).toEqual(jobs)
  expect(loaded).not.toContain('media.start')
  const compute = await h.gateway.execute('work', 'compute', { name: 'compute.run', input: { code: 'print(1)' } })
  expect(compute).toMatchObject({ kind: 'read', data: { status: 'running' } })
  if (compute.kind !== 'read') throw new Error('Expected a compute receipt')
  const job = (compute.data as { job: string }).job
  for (const name of ['job.status', 'job.wait', 'job.logs', 'job.cancel']) {
    expect(await h.gateway.execute('work', name, { name, input: { kind: 'compute', job,
      ...(name === 'job.wait' ? { milliseconds: 0 } : {}) } })).toMatchObject({ kind: 'read' })
  }
  const delegated = await h.gateway.execute('work', 'delegate', { name: 'delegate.start',
    input: { goal: 'Produce the requested text', expectedArtifacts: ['answer.txt'] } })
  expect(delegated).toMatchObject({ kind: 'read', data: { status: 'running' } })
  if (delegated.kind !== 'read') throw new Error('Expected a delegation receipt')
  expect(await h.gateway.execute('work', 'read-delegate', { name: 'delegate.read',
    input: { job: (delegated.data as { job: string }).job, name: 'answer.txt' } }))
    .toMatchObject({ kind: 'read', data: { status: 'read', text: 'done' } })
  expect(h.calls).toEqual(['compute.run', 'job.status', 'job.wait', 'job.logs', 'job.cancel', 'delegate.start', 'delegate.read'])
})

it('loading jobs and media never grants write permission to a read-only run', async () => {
  const h = fixture()
  await h.begin('read-only', 'read-only')
  await h.gateway.loadToolFamilies('read-only', ['jobs', 'media'])
  expect(await h.names('read-only')).toContain('media.start')
  for (const call of [
    { name: 'compute.run', input: { code: 'print(1)' } },
    { name: 'delegate.start', input: { goal: 'Do work', expectedArtifacts: ['answer.txt'] } },
    { name: 'job.cancel', input: { kind: 'compute', job: 'prior-job' } },
    { name: 'media.start', input: { kind: 'speech', prompt: 'Read this' } },
  ]) expect(await h.gateway.execute('read-only', call.name, call))
    .toMatchObject({ kind: 'error', message: expect.stringContaining('只读') })
  expect(h.calls).toEqual([])
  expect(h.gateway.runFileAccess('read-only')?.permission).toBe('read-only')
})
