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
import { canonicalToolRegistration, describeTools } from '../../src/core/tools/ToolCatalog'
import { objectUpdateInputSchema } from '../../src/core/tools/toolSchemas'

const jobs = ['job.status', 'job.wait', 'job.logs', 'job.cancel', 'compute.run', 'delegate.start', 'local.run', 'delegate.readonly', 'delegate.read']
const baseline = ['media.discover']
const serviceNames = new Set<string>(workbenchServiceToolCatalog.map(tool => tool.name))

it('projects observed appearance copying with distinct read-source fields and no invented HTML range formatting', () => {
  const input = { target: 'writable-b', properties: { appearanceFrom: { target: 'readonly-a', fields: ['color', 'shadows'] }, appearance: { color: '#FFFF00' } } }
  expect(objectUpdateInputSchema.parse(input)).toEqual(input)
  for (const fields of [[], ['color', 'color'], Array.from({ length: 65 }, (_, index) => `field-${index}`)])
    expect(objectUpdateInputSchema.safeParse({ ...input, properties: { appearanceFrom: { target: 'readonly-a', fields } } }).success).toBe(false)
  expect(objectUpdateInputSchema.safeParse({ ...input, properties: { appearanceFrom: { target: 'readonly-a', fields: ['color'], frame: {} } } }).success).toBe(false)
  const schema = JSON.stringify(describeTools(['object.update'])[0].schema)
  expect(schema).toContain('appearanceFrom'); expect(schema).toContain('"uniqueItems":true')
  const format = canonicalToolRegistration('text.format')!
  expect(format.manual.targetKinds).not.toContain('html-author-field')
  expect(format.supports({ scopes: [{ kind: 'text', writableTargetKinds: ['html-author-field'], wholeDocumentWritable: true }] })).toBe(false)
  expect(format.supports({ scopes: [{ kind: 'markdown', writableTargetKinds: ['html-author-field'], wholeDocumentWritable: false }] })).toBe(false)
  expect(format.supports({ scopes: [{ kind: 'markdown', writableTargetKinds: ['markdown-range'], wholeDocumentWritable: false }] })).toBe(true)
})

function fixture(external = false) {
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { append: async () => {}, save: async () => { throw new Error('Discovery must not save files') } } })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const calls: string[] = []
  const jobView = (name: string, ref: HostJobRef) => {
    calls.push(name)
    return { kind: ref.kind, jobId: ref.jobId, status: 'running', terminal: false, snapshot: { runId: ref.runId, jobId: ref.jobId, status: 'running', artifacts: [] } }
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
  if (external) services.web = { search: async () => ({ status: 'not-configured', reason: '没有搜索连接' }),
    open: async () => { calls.push('web.open'); return { status: 'not-configured', reason: '没有网页读取连接' } } }
  gateway.configureHostServices(services)
  const begin = (runId: string, permission: ExecutionPermissionMode = 'workspace') => gateway.beginRun({
    runId, actor: 'agent', documents: [], fileAccess: { permission, workspaceRoot: 'D:/catalog-fixture' },
  })
  const names = async (runId: string) => (await gateway.describeRun(runId)).map(tool => tool.name)
  return { driver, registry, gateway, calls, begin, names }
}

it('discovers authorized services in empty and Markdown runs while keeping long-tail schemas deferred and unavailable routes absent', async () => {
  const h = fixture()
  await h.begin('empty')
  const document = await h.registry.create(h.driver.load(new TextEncoder().encode('draft')), 'draft.md')
  await h.gateway.beginRun({ runId: 'markdown', actor: 'agent',
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 5 }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: 'D:/catalog-fixture' } })
  for (const runId of ['empty', 'markdown']) {
    expect((await h.names(runId)).filter(name => serviceNames.has(name))).toEqual(baseline)
    expect(await h.gateway.availableToolFamilies(runId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'jobs', count: 9 }), expect.objectContaining({ family: 'media', count: 1 }),
    ]))
    expect(await h.names(runId)).not.toEqual(expect.arrayContaining(['web.search', 'mcp.discover']))
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
  await h.gateway.loadToolFamilies('work', ['media'])
  expect(await h.names('work')).toContain('media.start')
  const compute = await h.gateway.execute('work', 'compute', { name: 'compute.run', input: { code: 'print(1)' } })
  expect(compute).toMatchObject({ kind: 'read', data: { status: 'running' } })
  if (compute.kind !== 'read') throw new Error('Expected a compute receipt')
  const job = (compute.data as { job: string }).job
  for (const name of ['job.status', 'job.wait', 'job.logs', 'job.cancel']) {
    expect(await h.gateway.execute('work', name, { name, input: { job,
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
    { name: 'job.cancel', input: { job: 'compute-prior-job' } },
    { name: 'media.start', input: { kind: 'speech', prompt: 'Read this' } },
  ]) expect(await h.gateway.execute('read-only', call.name, call))
    .toMatchObject({ kind: 'error', message: expect.stringContaining('只读') })
  expect(h.calls).toEqual([])
  expect(h.gateway.runFileAccess('read-only')?.permission).toBe('read-only')
})

it('exposes an exact deferred service from the registration and honestly returns its missing connection without granting unrelated routes', async () => {
  const h = fixture(true)
  await h.begin('external', 'read-only')
  expect(await h.names('external')).not.toContain('web.open')
  expect(await h.gateway.availableToolFamilies('external')).toContainEqual(expect.objectContaining({ family: 'external', count: 2 }))
  const tool = await h.gateway.resolveRunTool('external', 'web.open')
  expect(tool?.schema).toHaveProperty('properties.url')
  expect(await h.names('external')).toContain('web.open')
  expect(await h.gateway.execute('external', 'open', { name: 'web.open', input: { url: 'https://example.org/' } }))
    .toMatchObject({ kind: 'read', data: { status: 'not-configured' } })
  expect(await h.gateway.resolveRunTool('external', 'mcp.invoke')).toBeNull()
  expect(h.calls).toEqual(['web.open'])
  expect(h.gateway.runFileAccess('external')?.permission).toBe('read-only')
})
