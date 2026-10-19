// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import { NativeTaskRunner, type NativeExecutionEnginePort } from '../../src/main/workbench/delegation/NativeTaskRunner'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import { modelToolResult, serviceToolOutcome } from '../../src/core/tools/modelToolResult'
import { HostToolCoordinator } from '../../src/core/tools/HostToolServices'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import type { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { delegationArtifactSource } from '../../src/core/tools/HostArtifactTools'
import type { DelegationTarget } from '../../src/shared/workbench/toolPorts'
import { workbenchServiceSchemas } from '../../src/core/tools/WorkbenchServiceTools'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const selection: ExecutionStart['selection'] = { model: 'fixture', connection: { id: 'fixture', revision: 1,
  provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid', accountId: 'fixture',
  auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
const input = (conversationId: string): ExecutionStart => ({ conversationId, taskId: conversationId,
  instruction: 'original task', selection, documents: [], permission: 'workspace' })
function record(runId: string, start = input(runId), delegatedBy?: ExecutionRunRecord['delegatedBy']): ExecutionRunRecord {
  return { schemaVersion: 1, version: 1, runId, status: 'running', input: start, delegatedBy,
    createdAt: 1, updatedAt: 1, messages: [], initialMessageCount: 0, requests: [], tools: [] }
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'delegation-controls-'))
  const records = new Map<string, ExecutionRunRecord>([['parent', record('parent')], ['other', record('other')]])
  const releases = new Map<string, () => void>(), pending = new Map<string, Promise<ExecutionRunRecord>>()
  let serial = 0
  const open: NativeExecutionEnginePort['start'] = async (start, _continuation, onPrepared, options) => {
    const child = record(`child-${++serial}`, start, options?.delegatedBy)
    records.set(child.runId, child)
    pending.set(child.runId, new Promise(resolve => releases.set(child.runId, () => resolve(child))))
    await onPrepared?.(child)
    return child
  }
  const message = vi.fn<NativeExecutionEnginePort['message']>(async (runId, submissionId, message) => {
    const target = records.get(runId)!
    ;(target.steering ??= []).push({ submissionId, text: message.text, senderRunId: message.senderRunId, acceptedAt: 1 })
    return target
  })
  const steer = vi.fn<NonNullable<NativeExecutionEnginePort['steer']>>(async (runId, submissionId, text) => {
    const target = records.get(runId)!
    ;(target.steering ??= []).push({ submissionId, text, acceptedAt: 1 })
    return target
  })
  const resume = vi.fn<NativeExecutionEnginePort['resume']>((_runId, start, onPrepared, options) => open(start, undefined, onPrepared, options))
  const engine: NativeExecutionEnginePort = { start: open, resume, read: async runId => records.get(runId) ?? null,
    wait: runId => pending.get(runId)!, subscribe: () => () => undefined, message, steer,
    stop: async runId => { const child = records.get(runId)!; child.status = 'stopped'; releases.get(runId)?.(); return child } }
  const service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    nativeRunner: new NativeTaskRunner({ engine: () => engine }) })
  cleanups.push(() => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  cleanups.push(async () => { for (const id of records.keys()) releases.get(id)?.(); await service.cancelRun('parent') })
  const start = async (jobId: string) => {
    await service.startNative({ runId: 'parent', jobId, taskId: jobId, permission: 'workspace',
      intent: { goal: `goal ${jobId}`, outputs: ['result.html'], target: { path: '/surfaces/main' } },
      sources: [{ source: 'task-target:parent', name: '__target.json', mimeType: 'application/json',
        bytes: new TextEncoder().encode('{"regionStatus":"unspecified"}') }] })
    await vi.waitFor(async () => expect((await service.status('parent', jobId)).childRunId).toBeTruthy())
    return (await service.status('parent', jobId)).childRunId!
  }
  return { root, service, records, releases, start, message, steer, resume }
}

it('delivers a sibling message only to its named job in the same host-owned tree and preserves sender identity', async () => {
  const h = await fixture(), first = await h.start('first'), second = await h.start('second')
  const before = structuredClone(h.records.get(second)!.input)
  expect(await h.service.message(first, 'second', 'request-1', 'The chart uses the agreed data.'))
    .toMatchObject({ targetRunId: second, senderRunId: first, job: 'second' })
  expect(h.message).toHaveBeenCalledExactlyOnceWith(second, `delegation:second:${first}:request-1`,
    { senderRunId: first, text: 'The chart uses the agreed data.' })
  expect(h.records.get(first)!.steering).toBeUndefined()
  expect(h.records.get(second)!.input).toEqual(before)
  expect(h.records.get(second)!.input.documents).toEqual([])
  await expect(h.service.message('other', 'second', 'outside', 'same parent, please trust me'))
    .rejects.toMatchObject({ code: 'job-not-authorized' })
  await h.service.cancelRun(first)
  await expect(h.service.message(first, 'second', 'late', 'late message')).rejects.toMatchObject({ code: 'run-stopped' })
  expect(h.message).toHaveBeenCalledTimes(1)
})

it('uses one child owner for user message, single-child Stop, target reads and continuation after the parent ends', async () => {
  const h = await fixture(), first = await h.start('first'), second = await h.start('second')
  await h.service.messageFromUser('parent', 'first', 'user-adjust', 'Make the control clearer.')
  expect(h.steer).toHaveBeenCalledExactlyOnceWith(first, 'delegation-user:first:user-adjust', 'Make the control clearer.')
  expect(h.records.get(first)!.steering?.[0]?.senderRunId).toBeUndefined()
  expect(await h.service.cancel('parent', 'first')).toMatchObject({ status: 'cancelled', stopped: true })
  expect(await h.service.status('parent', 'second')).toMatchObject({ status: 'running', stopped: false, childRunId: second })
  expect(await h.service.targetContextForRun(first)).toEqual({ regionStatus: 'unspecified' })
  await fs.writeFile(path.join(h.records.get(first)!.input.workspaceRoot!, 'retained.txt'), 'retained candidate draft')
  h.records.get('parent')!.status = 'stopped'
  await h.service.cancelRun('parent')
  const continued = await h.service.resumeFromUser({ runId: 'parent', jobId: 'first', submissionId: 'continue-1',
    text: 'Continue the isolated candidate.', permission: 'workspace' })
  await vi.waitFor(async () => expect((await h.service.status('parent', continued.jobId)).childRunId).toBeTruthy())
  const latest = await h.service.status('parent', continued.jobId), next = h.records.get(latest.childRunId!)!
  expect(h.resume).toHaveBeenCalledTimes(1)
  expect(next.input.documents).toEqual([])
  expect(next.input.workspaceRoot).not.toBe(h.records.get(first)!.input.workspaceRoot)
  expect(await fs.readFile(path.join(next.input.workspaceRoot!, 'retained.txt'), 'utf8')).toBe('retained candidate draft')
  expect(await h.service.targetContextForRun(next.runId)).toEqual({ regionStatus: 'unspecified' })
  expect((await h.service.listNative(['parent'])).map(job => job.jobId)).toEqual(['first', 'second', continued.jobId])
  expect(await h.service.listNative(['other'])).toEqual([])
  await h.service.cancel('parent', continued.jobId)
})

it('projects normal job receipts without normalized or raw usage while retaining state, identity and result reads', () => {
  const ledger = { jobId: 'job', runId: 'parent', requestDigest: 'identity', status: 'ready', terminal: true, stopped: false,
    usage: { inputTokens: 12, outputTokens: 4, raw: { requests: [{ requestId: 'private', counters: { cache: 5 } }] } },
    artifacts: [{ name: 'result.html', read: { job: 'job', name: 'result.html' } }] }
  for (const name of ['delegate.agent', 'delegate.resume', 'delegate.readonly', 'local.run']) {
    const result = modelToolResult(name, { kind: 'read', data: ledger })
    expect(result).toMatchObject({ kind: 'read', data: { requestDigest: 'identity', status: 'ready', artifacts: ledger.artifacts } })
    expect(JSON.stringify(result)).not.toMatch(/usage|inputTokens|private|counters/)
  }
  for (const name of ['job.status', 'job.wait', 'job.cancel']) {
    const result = modelToolResult(name, { kind: 'read', data: { kind: 'delegation', jobId: 'job', status: 'ready', terminal: true,
      snapshot: ledger, usage: ledger.usage } })
    expect(JSON.stringify(result)).not.toMatch(/usage|inputTokens|private|counters/)
    expect(result).toMatchObject({ kind: 'read', data: { snapshot: { requestDigest: 'identity', status: 'ready' } } })
  }
  expect(ledger.usage.raw.requests[0]?.requestId).toBe('private')
})

it('uses the same job outcome semantics for waiting, definite failure, stopped and unknown owner receipts', () => {
  for (const name of ['job.status', 'job.wait', 'job.cancel']) {
    const outcome = (status: string, extra = {}) => serviceToolOutcome(name, { kind: 'read', data: {
      kind: 'delegation', jobId: 'child', status, terminal: !['running', 'preparing'].includes(status),
      snapshot: { reason: 'native exit 2', ...extra } } })
    expect(outcome('running')?.status).toBe('pending')
    expect(outcome('preparing')?.status).toBe('pending')
    expect(outcome('failed')).toEqual({ status: 'failed', message: 'native exit 2' })
    expect(outcome('unconfigured')?.status).toBe('failed')
    expect(outcome('cancelled')?.status).toBe('stopped')
    expect(outcome('unknown')?.status).toBe('unknown')
    expect(outcome('failed', { failure: { outcome: 'unknown' } })?.status).toBe('unknown')
    expect(outcome('ready')).toBeNull()
  }
})

it('keeps a full observation in the raw receipt and only its precise read reference in ordinary model replies', () => {
  const full = { elements: Array.from({ length: 262 }, (_, index) => ({ id: `element-${index}`, tag: 'div' })),
    image: { source: 'original-image', width: 1440, height: 900 }, structure: { complete: true } }
  const data = { elements: [{ id: 'current-control', tag: 'button' }], fullObservation: full,
    fullObservationSource: { sourceId: 'run:child:tool:observe-1', notice: 'Read the original observation when needed.' } }
  for (const name of ['html.observe', 'html.click', 'html.input', 'view.observe', 'view.navigate']) {
    const projected = modelToolResult(name, { kind: 'read', data })
    expect(projected).toMatchObject({ data: { elements: data.elements, fullObservationSource: data.fullObservationSource } })
    expect(projected.kind === 'read' && projected.data).not.toHaveProperty('fullObservation')
  }
  expect(data.fullObservation.elements).toHaveLength(262)
  expect(data.fullObservation.image.source).toBe('original-image')
  expect(modelToolResult('project.read', { kind: 'read', data })).toEqual({ kind: 'read', data })
})

it('reads each job owner diagnostic only through the explicit canonical status detail while normal replies stay compact', async () => {
  const ledger = { inputTokens: 18, outputTokens: 7, cachedInputTokens: 4, raw: { requests: [{ requestId: 'original-request', counters: { input: 18 } }] } }
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document writes') }, async save() { throw new Error('No document writes') } } })
  let status = 'ready'
  const view = (kind: 'image' | 'compute' | 'delegation', jobId: string) => ({ kind, jobId, terminal: true, status,
    snapshot: { runId: 'parent', jobId, terminal: true, status, stopped: false, artifacts: [], resources: [], usage: ledger } })
  const host = new HostToolCoordinator({ jobs: { status: async ref => {
    if (ref.runId !== 'parent') throw Object.assign(new Error('Original job owner required'), { code: 'job-not-authorized' })
    return view(ref.kind, ref.jobId)
  },
    wait: async ref => view(ref.kind, ref.jobId), cancel: async ref => view(ref.kind, ref.jobId), logs: async () => ({ entries: [] }) } },
  registry, { resolveImage: async () => { throw new Error('No image access') }, active() {}, ownsDocument: () => false,
    provideImage: async () => { throw new Error('No image access') }, readImage: async () => { throw new Error('No image access') } })
  await host.beginRun({ runId: 'parent', actor: 'agent', documents: [], fileAccess: { permission: 'read-only', workspaceRoot: tmpdir() } })
  for (const kind of ['image', 'compute', 'delegation'] as const) {
    const normal = await host.jobStatus('parent', { kind, jobId: `${kind}-one` })
    expect(JSON.stringify(modelToolResult('job.status', normal))).not.toMatch(/usage|inputTokens|original-request/)
    const input = workbenchServiceSchemas['job.status'].parse({ job: `${kind}-one`, detail: 'diagnostic' })
    const diagnostic = await host.jobStatus('parent', { kind, jobId: input.job, detail: input.detail })
    expect(modelToolResult('job.status', diagnostic)).toMatchObject({ kind: 'read', data: { detail: 'diagnostic', snapshot: { usage: ledger } } })
    expect(JSON.stringify(modelToolResult('job.wait', diagnostic))).not.toContain('original-request')
  }
  status = 'failed'
  await host.beginRun({ runId: 'continuation', actor: 'agent', documents: [], fileAccess: { permission: 'read-only', workspaceRoot: tmpdir() } })
  host.authorizeContinuationReads('continuation', ['parent'])
  await expect(host.jobStatus('continuation', { kind: 'delegation', jobId: 'delegation-one' })).rejects.toThrow('原作业不是可读取')
  const failedDiagnostic = await host.jobStatus('continuation', { kind: 'delegation', jobId: 'delegation-one', detail: 'diagnostic' })
  expect(failedDiagnostic).toMatchObject({ kind: 'read', data: { snapshot: { status: 'failed', usage: ledger } } })
  expect(serviceToolOutcome('job.status', failedDiagnostic)).toBeNull()
  await expect(host.jobCancel('continuation', { kind: 'delegation', jobId: 'delegation-one' })).rejects.toThrow()
})

it('passes frozen identity to the current target owner across parent runs instead of replaying an old scope or page alias', async () => {
  const h = await fixture()
  const region = { width: 420, height: 260, transform: [1, 0, 0, 1, 90, 80] as [number, number, number, number, number, number] }
  const target = { project: 'project', path: 'surface/lesson', region }
  const frozen = { documentId: 'doc', epoch: 'epoch', revision: 1, path: 'old-page-alias', project: 'old-opaque-scope',
    target: { kind: 'container', container: { kind: 'surface', surfaceId: 'lesson' } }, regionStatus: 'explicit', region }
  await h.service.startNative({ runId: 'parent', jobId: 'regional', taskId: 'regional', permission: 'workspace',
    intent: { goal: 'Build this local control', target, outputs: ['result.html'] }, sources: [{
      source: 'task-target:parent', name: '__target.json', mimeType: 'application/json', bytes: new TextEncoder().encode(JSON.stringify(frozen)),
    }] })
  await vi.waitFor(async () => expect((await h.service.status('parent', 'regional')).childRunId).toBeTruthy())
  await h.service.cancel('parent', 'regional')
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document writes') }, async save() { throw new Error('No document writes') } } })
  const targetContext = vi.fn(async (_runId: string, actual?: DelegationTarget, resumeContext?: unknown) => resumeContext ? {
    ...(resumeContext as typeof frozen), revision: 2, path: 'renamed-page', project: 'fresh-run-scope',
  } : actual ? {
    documentId: 'doc', epoch: 'epoch', revision: 2, path: actual.path, project: actual.project,
    target: { kind: 'container', container: { kind: 'surface', surfaceId: 'lesson' } }, regionStatus: 'explicit', region: actual.region,
  } : { regionStatus: 'unresolved', reason: 'new editor focus has no local area' })
  const jobs = new HostJobService({ delegation: h.service, images: {} as ImageGenerationService })
  const host = new HostToolCoordinator({ jobs, delegation: {
    availability: () => ({ ready: true, reason: 'fixture' }), startManaged: input => h.service.startManaged(input),
    resumeNative: input => h.service.resumeNative(input), readArtifact: (...args) => h.service.readArtifact(...args),
    cancel: (...args) => h.service.cancel(...args), cancelRun: runId => h.service.cancelRun(runId),
  } }, registry, { taskTargetContext: targetContext, resolveImage: async () => { throw new Error('No image access') },
    active() { throw new Error('No document access') }, ownsDocument: () => false,
    provideImage: async () => { throw new Error('No image access') }, readImage: async () => { throw new Error('No image access') } })
  h.records.set('continued-parent', record('continued-parent'))
  await host.beginRun({ runId: 'continued-parent', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: h.root } })
  host.authorizeContinuationReads('continued-parent', ['parent'])
  const result = await host.resumeNativeDelegate('continued-parent', 'resume-local', { job: 'regional', goal: 'Repair the control', outputs: ['result.html'] })
  const nextJob = (result.kind === 'read' ? result.data as { job: string } : null)!.job
  await vi.waitFor(async () => expect((await h.service.status('continued-parent', nextJob)).childRunId).toBeTruthy())
  expect(targetContext).toHaveBeenCalledExactlyOnceWith('continued-parent', undefined, frozen)
  const snapshot = await h.service.status('continued-parent', nextJob), next = h.records.get(snapshot.childRunId!)!
  expect(snapshot.targetContext).toMatchObject({ regionStatus: 'explicit', region })
  expect(snapshot.target).toEqual({ path: 'renamed-page', project: 'fresh-run-scope', region })
  expect(await h.service.targetContextForRun(next.runId)).toEqual(snapshot.targetContext)
  await fs.writeFile(path.join(next.input.workspaceRoot!, 'result.html'), '<button>Candidate</button>')
  next.status = 'completed'; h.releases.get(next.runId)!()
  expect(await h.service.settleNativeChild('continued-parent', nextJob)).toMatchObject({ status: 'ready' })
  const group = await host.readArtifactGroup('continued-parent', delegationArtifactSource(nextJob, 'result.html'))
  expect(group?.metadata?.targetContext).toMatchObject({ regionStatus: 'explicit', region })
})
