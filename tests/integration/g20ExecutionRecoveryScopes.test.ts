// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { AgentFileOutcomeUnknown } from '../../src/core/tools/AgentFileTools'
import { documentDeliveryReceiptResult } from '../../src/core/tools/DocumentDeliveryTools'
import { executionCompletionIssues } from '../../src/main/workbench/execution/executionOutcome'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { HostArtifactDeliveryService } from '../../src/main/workbench/execution/HostArtifactDeliveryService'
import { serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { PayloadCompiler } from '../../src/core/execution/PayloadCompiler'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { artifactDeliverySource, computeArtifactSource } from '../../src/core/tools/HostArtifactTools'
import { dispatchMaterialTool } from '../../src/main/workbench/execution/MaterialReadTools'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
  protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'unknown' } } }
function complete(request: ModelRequest, calls: { id: string; name: string; input: unknown }[] = [], content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'fixture-response', actualModel: 'fixture',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
    toolCalls: calls.map(call => ({ id: call.id, name: call.name, argumentsText: JSON.stringify(call.input) })),
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.input) } })) } : {}) } }
}
const refs = (request: ModelRequest) => JSON.parse(String(request.messages[1]!.content).split('：')[1]!) as { documentId: string; target: string }[]
async function fixture(provider: ModelProvider) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'g20-recovery-scope-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'documents'))
  const document = await host.internalAPI.create({ kind: 'markdown', source: '# draft', resources: { assets: {}, components: {} } }, 'draft.md')
  const runs = new ExecutionRunStore(path.join(root, 'runs')), events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const files = new AgentFileService(host)
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, runs, events, files, provider })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '完成并保存结果', selection,
    workspaceRoot: root, documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] }
  return { root, host, document, runs, events, files, engine, input }
}

it.each(['rejected', 'unknown'] as const)('settles an attributable rejected delivery lookup without accepting an uncertain lookup (%s)', async outcome => {
  let calls = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++calls === 2) yield complete(request, [{ id: 'new-save', name: 'file.save', input: { target: refs(request)[0]!.target } }])
    else yield complete(request)
  } }
  const f = await fixture(provider), started = await f.engine.start(f.input)
  const old = await f.engine.wait(started.runId)
  old.runId = 'crash-before-receipt'; old.status = 'interrupted'
  old.tools = [{ callId: 'old-save', providerCallId: 'old-save', requestId: 'old-request', state: 'executing',
    call: { name: 'file.save', input: { target: 'old-handle' } },
    effectTargets: [{ documentId: f.document.documentId, target: { kind: 'document' } }] }]
  await f.runs.save(old)
  const lookup = f.host.tools.lookup.bind(f.host.tools)
  vi.spyOn(f.host.tools, 'lookup').mockImplementation((runId, callId, call) => callId === 'old-save'
    ? Promise.resolve(outcome === 'rejected' ? documentDeliveryReceiptResult({ status: 'rejected', reason: '磁盘冲突，尚未发布',
      documentId: f.document.documentId, epoch: f.document.epoch, currentRevision: 0, dirty: true, warnings: [] })
      : { kind: 'error', code: 'tool-outcome-unknown', message: '查询连接中断' })
    : lookup(runId, callId, call))
  const execute = f.host.tools.execute.bind(f.host.tools)
  const save = vi.fn(async () => {
    const saved = await f.host.saveToPath(f.document.documentId, path.join(f.root, 'saved.md'))
    return { kind: 'read' as const, data: { status: 'saved', documentId: saved.documentId, epoch: saved.epoch,
      path: saved.binding.kind === 'file' ? saved.binding.path : undefined, savedRevision: saved.revision, currentRevision: saved.revision, dirty: saved.dirty } }
  })
  vi.spyOn(f.host.tools, 'execute').mockImplementation((runId, callId, call) => call.name === 'file.save' ? save() : execute(runId, callId, call))
  const next = await f.engine.resume(old.runId, { ...f.input, taskId: 'continue' }), final = await f.engine.wait(next.runId)
  expect(save).toHaveBeenCalledTimes(outcome === 'rejected' ? 1 : 0)
  expect((await f.runs.read(old.runId))!.tools[0]!.state).toBe(outcome === 'rejected' ? 'returned' : 'executing')
  expect(final.status, JSON.stringify({ tools: final.tools, failure: final.failure })).toBe(outcome === 'rejected' ? 'completed' : 'partial')
  if (outcome === 'unknown') expect(final.tools[0]!.result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
})

it.each(['written', 'rejected', 'unknown'] as const)('recovers original artifact owner receipts and settles only confirmed corrected deliveries (%s)', async outcome => {
  let calls = 0
  const artifact = { source: computeArtifactSource('compute-one', 'result.txt'), destination: 'result.txt' }
  const provider: ModelProvider = { async *stream(request) {
    if (++calls === 2 && outcome !== 'written') yield complete(request, [{ id: 'corrected-save', name: 'artifact.save', input: artifact }])
    else yield complete(request)
  } }
  const f = await fixture(provider), started = await f.engine.start(f.input)
  const old = await f.engine.wait(started.runId)
  old.runId = `interrupted-artifact-${outcome}`; old.status = 'running'
  old.tools = [{ callId: 'original-save', providerCallId: 'original-save', requestId: 'old-request', state: 'executing',
    call: { name: 'artifact.save', input: artifact } }]
  const operationId = f.host.tools.operationIdentity(old.runId, 'original-save')
  const journalDirectory = path.join(f.root, 'artifact-receipts'), bytes = Buffer.from('verified compute bytes\n')
  const originalOwner = new HostArtifactDeliveryService({ journalDirectory, withFileOperation: async work => {
    if (outcome === 'rejected') throw Object.assign(new Error('fixture disk full before publication'), { code: 'ENOSPC' })
    const result = await work()
    if (outcome === 'unknown') throw new Error('fixture acknowledgement lost after publication')
    return result
  } })
  expect(await originalOwner.deliver({ runId: old.runId, operationId, workspaceRoot: f.root, permission: 'workspace',
    destination: artifact.destination, sourceKind: 'compute', sourceId: 'compute-one@result.txt', bytes,
    assertActive: () => undefined })).toMatchObject({ status: outcome })
  await f.runs.save(old) // The owner receipt is durable; the execution checkpoint still says executing.
  const reopenedOwner = new HostArtifactDeliveryService({ journalDirectory, withFileOperation: work => work() })
  const lookup = vi.spyOn(reopenedOwner, 'lookup'), deliver = vi.spyOn(reopenedOwner, 'deliver')
  const unusedJobOperation = async (): Promise<never> => { throw new Error('Recovery must not start or cancel a job') }
  const readArtifact = vi.fn(async (runId: string, jobId: string, name: string) => {
    expect([runId, jobId, name]).toEqual([old.runId, 'compute-one', 'result.txt'])
    return { artifact: { name, digest: 'owner-digest', byteLength: bytes.length, mimeType: 'text/plain' }, bytes }
  })
  const reopenedHost = new DocumentHostService(path.join(f.root, 'documents'))
  await reopenedHost.internalAPI.restore(f.document.documentId)
  reopenedHost.tools.configureHostServices({
    compute: { start: unusedJobOperation, readArtifact, cancel: unusedJobOperation, cancelRun: async () => undefined },
    jobs: { status: async ref => {
      if (ref.runId !== old.runId || ref.kind !== 'compute' || ref.jobId !== 'compute-one') {
        throw Object.assign(new Error('Not owned by this run'), { code: 'job-not-authorized' })
      }
      return { kind: 'compute', jobId: ref.jobId, status: 'ready', terminal: true, snapshot: { status: 'ready', stopped: false } }
    }, wait: unusedJobOperation, logs: unusedJobOperation, cancel: unusedJobOperation },
    artifacts: {
      lookup: (runId, id) => reopenedOwner.lookup(id, runId),
      preflight: ({ destination }) => reopenedOwner.preflight({ workspaceRoot: f.root, permission: 'workspace', destination }),
      save: ({ grant, operationId, source, bytes, assertActive }) => reopenedOwner.deliver({ runId: grant.runId,
        operationId, workspaceRoot: f.root, permission: 'workspace', destination: source.destination,
        ...artifactDeliverySource(source), bytes, assertActive }),
    },
  })
  const reopenedEngine = new ExecutionEngine({ registry: reopenedHost.registry, gateway: reopenedHost.tools, runs: f.runs,
    events: f.events, provider, artifacts: reopenedOwner })
  await reopenedEngine.recover(old.runId)
  expect(calls).toBe(1) // Recovery only reads the existing operation; it never calls the provider or replays publication.
  expect(lookup).toHaveBeenCalledWith(operationId)
  expect(deliver).not.toHaveBeenCalled()
  expect((await f.runs.read(old.runId))!.tools[0]).toMatchObject({ state: 'returned',
    result: { kind: 'read', data: { operationId, status: outcome } } })
  const resumed = await reopenedEngine.resume(old.runId, { ...f.input, taskId: 'finish-artifact' })
  const final = await reopenedEngine.wait(resumed.runId)
  expect(final.status, JSON.stringify({ tools: final.tools, failure: final.failure })).toBe(outcome === 'unknown' ? 'partial' : 'completed')
  expect(readArtifact).toHaveBeenCalledTimes(outcome === 'rejected' ? 1 : 0)
  expect(deliver).toHaveBeenCalledTimes(outcome === 'rejected' ? 1 : 0)
  if (outcome === 'unknown') expect(final.tools[0]!.result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
  if (outcome === 'rejected') expect(final.tools[0]!.result).toMatchObject({ kind: 'read', data: { status: 'written' } })
  expect(await fs.readFile(path.join(f.root, artifact.destination))).toEqual(bytes)
})

it('preserves an unresolved artifact when its owner lookup fails', async () => {
  let calls = 0
  const provider: ModelProvider = { async *stream(request) { calls++; yield complete(request) } }
  const f = await fixture(provider), started = await f.engine.start(f.input), old = await f.engine.wait(started.runId)
  old.runId = 'unreadable-artifact-receipt'; old.status = 'running'
  old.tools = [{ callId: 'original-save', providerCallId: 'original-save', requestId: 'old-request', state: 'executing',
    call: { name: 'artifact.save', input: { source: computeArtifactSource('one', 'result.txt'), destination: 'result.txt' } } }]
  await f.runs.save(old)
  const owner = new HostArtifactDeliveryService({ journalDirectory: path.join(f.root, 'artifact-receipts'), withFileOperation: work => work() })
  vi.spyOn(owner, 'lookup').mockRejectedValue(new Error('fixture receipt unavailable'))
  const deliver = vi.spyOn(owner, 'deliver')
  const reopened = new ExecutionEngine({ registry: f.host.registry, gateway: f.host.tools, runs: f.runs,
    events: f.events, provider, artifacts: owner })
  await expect(reopened.recover(old.runId)).rejects.toThrow('receipt unavailable')
  expect((await f.runs.read(old.runId))!.tools[0]!.state).toBe('executing')
  expect(calls).toBe(1)
  expect(deliver).not.toHaveBeenCalled()
})

it('isolates unknown file creation by host paths across continuation and still blocks same-path aliases', async () => {
  let continuing = false, initialCalls = 0, continuationCalls = 0
  const provider: ModelProvider = { async *stream(request) {
    const turn = continuing ? ++continuationCalls : ++initialCalls
    if (!continuing && turn === 1) yield complete(request, [{ id: 'create-a', name: 'file.create', input: { name: 'A.md' } }])
    else if (continuing && turn === 1) yield complete(request, [
      { id: 'create-b', name: 'file.create', input: { name: 'B.md' } },
      { id: 'create-a-alias', name: 'file.create', input: { path: '.', name: 'a.md' } },
      { id: 'write-a-alias', name: 'file.write', input: { path: './A.md', mode: 'create', content: 'replayed' } },
    ])
    else yield complete(request)
  } }
  const f = await fixture(provider), execute = f.files.execute.bind(f.files)
  const fileCalls: string[] = []
  vi.spyOn(f.files, 'execute').mockImplementation(async (context, name, input, operationId) => {
    fileCalls.push(name)
    if (fileCalls.length === 1) throw new AgentFileOutcomeUnknown('create acknowledgement lost')
    return execute(context, name, input, operationId)
  })
  const first = await f.engine.start(f.input), prior = await f.engine.wait(first.runId)
  expect(prior.tools[0]!.effectPaths).toEqual([path.join(f.root, 'A.md')])
  continuing = true
  const continued = await f.engine.resume(first.runId, { ...f.input, taskId: 'continue' }), final = await f.engine.wait(continued.runId)
  expect(fileCalls).toEqual(['file.create', 'file.create'])
  expect(await fs.readFile(path.join(f.root, 'B.md'), 'utf8')).toBe('')
  expect(final.tools.slice(1).map(tool => tool.result)).toEqual([
    expect.objectContaining({ kind: 'error', code: 'unresolved-prior-tool' }),
    expect.objectContaining({ kind: 'error', code: 'unresolved-prior-tool' }),
  ])
  expect(final.status).toBe('partial') // A remains unknown; independent B really exists.
})

it('keeps initial images archived on the actual compaction wire while the complete sources remain readable', async () => {
  const wires: string[] = [], initialImages = [0, 1, 2, 3].map(index => `data:image/png;base64,INITIAL-${index}-` + 'a'.repeat(50_000))
  let calls = 0
  const provider: ModelProvider = { async *stream(request) {
    wires.push(serializeModelRequest(request)); calls++
    if (calls > 4) { yield complete(request); return }
    yield complete(request, [{ id: `read-${calls}`, name: calls % 2 ? 'read' : 'inspect', input: { target: refs(request)[0]!.target } }],
      '旧过程文字'.repeat(150_000))
  } }
  const f = await fixture(provider)
  // Compaction follows the model's declared window; an unknown window never compacts.
  const started = await f.engine.start({ ...f.input, selection: { ...selection, contextWindow: 200_000 },
    context: [{ role: 'user', content: initialImages.map(url => ({ type: 'image_url', image_url: { url } })) }] }), final = await f.engine.wait(started.runId)
  expect(final.status, JSON.stringify(final.failure)).toBe('completed')
  expect(final.compacted).toBeDefined()
  expect(wires).toHaveLength(5)
  for (const image of initialImages) expect(wires[0]).toContain(image)
  for (const wire of wires.slice(1)) {
    expect(wire).not.toContain('INITIAL-0-'); expect(wire).not.toContain('INITIAL-1-')
    expect(wire).toContain('context.read'); expect(Buffer.byteLength(wire)).toBeLessThanOrEqual(600_000)
  }
  const stored = await f.runs.read(started.runId)
  for (const image of initialImages) expect(JSON.stringify(stored!.messages)).toContain(image)
})

it('continues extracting the same original from an attached derived snapshot and grants only returned derived material', async () => {
  let calls = 0, originalId = '', unrelatedId = ''
  const provider: ModelProvider = { async *stream(request) {
    calls++
    if (calls === 1) yield complete(request, [{ id: 'second-page', name: 'material.extract', input: {
      attachmentId: originalId, pages: { from: 2, to: 2 },
    } }])
    else if (calls === 2) {
      const result = JSON.parse(String(request.messages.find(message => message.tool_call_id === 'second-page')!.content))
      expect(result).toMatchObject({ kind: 'read', data: { derivedFrom: originalId } })
      yield complete(request, [{ id: 'read-second', name: 'material.read', input: { attachmentId: result.data.attachmentId, representationId: 'extracted-1' } },
        { id: 'ungranted-source', name: 'material.extract', input: { attachmentId: unrelatedId, pages: { from: 1, to: 1 } } }])
    } else yield complete(request)
  } }
  const f = await fixture(provider)
  const materials = new AttachmentService({ directory: path.join(f.root, 'materials'), extractor: { extract: async input => {
    const selectedPages = input.pages ?? { from: 1, to: 2 }
    return { totalPages: 2, selectedPages, pageImages: [], material: { version: 1, format: 'pdf', extractorVersion: 'fixture',
      fragments: [{ id: `page-${selectedPages.from}`, kind: 'text', text: `第${selectedPages.from}页原文`, locator: { part: 'pdf', page: selectedPages.from } }],
      assets: [], gaps: [] } }
  } } })
  const source = await materials.receiveBytes({ name: 'two-pages.pdf', bytes: Buffer.from('%PDF-authorized-original'), source: { kind: 'file' } })
  originalId = source.id
  const attached = await materials.extract(source.id, { pages: { from: 1, to: 1 } })
  unrelatedId = (await materials.receiveBytes({ name: 'other.pdf', bytes: Buffer.from('%PDF-not-authorized'), source: { kind: 'file' } })).id
  const materialGrants = new Map<string, Set<string>>()
  f.host.tools.configureHostServices({
    beginRun: async grant => { materialGrants.set(grant.runId, new Set(grant.materialIds)) },
    stopRun: runId => { materialGrants.delete(runId) },
    materials: {
      admit: async (runId, ids) => {
        for (const id of ids) { await materials.readSnapshot(id); materialGrants.get(runId)!.add(id) }
      },
      read: async (runId, name, input) => {
        const ids = materialGrants.get(runId)!
        const result = await dispatchMaterialTool(materials, ids, name, input)
        if ('admittedSourceIds' in result) for (const id of result.admittedSourceIds ?? []) ids.add(id)
        return { kind: 'read', data: result.data }
      },
      readResource: async () => { throw new Error('This fixture has no image resource') },
    },
  })
  const engine = new ExecutionEngine({ registry: f.host.registry, gateway: f.host.tools, runs: f.runs, events: f.events, provider, materials,
    initialCompiler: new PayloadCompiler({ attachments: materials, serializePayload: serializeModelRequest }) })
  const started = await engine.start({ ...f.input, inputContext: { id: 'attached-derived', capturedAt: 1, instruction: '读第二页', context: [],
    attachments: [{ attachmentId: attached.id, representationId: 'extracted-1' }] } }), final = await engine.wait(started.runId)
  expect(final.initialPayload?.explicitAttachments.map(item => item.attachmentId)).toEqual([attached.id])
  expect(final.tools[1]!.result).toMatchObject({ kind: 'read', data: { text: '第2页原文' } })
  expect(final.tools[2]!.result).toMatchObject({ kind: 'error', code: 'invalid-operation', message: '材料不在当前显式输入或宿主冻结历史来源内' })
  expect(calls).toBe(3)
})

it.each([undefined, 'diagnostic'] as const)('keeps required visual checks partial after real delivery and reports optional diagnostics separately (%s)', async purpose => {
  let calls = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++calls === 1 || calls === 3) yield complete(request, [
      { id: 'visual-check', name: 'view.observe', input: { target: refs(request)[0]!.target, ...(purpose ? { purpose } : {}) } },
      ...(calls === 1 ? [{ id: 'deliver', name: 'file.write', input: { path: 'delivered.txt', mode: 'create', content: '交付的真实内容' } }] : []),
    ])
    else yield complete(request)
  } }
  const f = await fixture(provider)
  const course = await f.host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('visual recovery'),
    resources: { assets: {}, components: {} } }, 'course.glx')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  f.host.tools.configureHostServices({ observations: {
    observe: async input => ({ source: 'isolated-published', identity: { documentId: input.documentId, epoch: input.epoch,
      revision: input.revision, locationId: input.locationId }, coverage: { width: 1, height: 1 }, structure: [], diagnostics: [],
      image: { resourceId: 'fixture-png', mimeType: 'image/png', width: 1, height: 1, byteLength: png.length } }),
    readResource: async () => ({ mimeType: 'image/png', bytes: png }),
  } })
  const started = await f.engine.start({ ...f.input, instruction: purpose ? '写出结果，可自行决定是否额外观察' : '写出结果并检查实际画面',
    documents: [{ documentId: course.documentId, writable: [] }],
    selection: { ...selection, connection: { ...selection.connection, capabilities: { ...selection.connection.capabilities, vision: 'unsupported' } } } })
  const final = await f.engine.wait(started.runId)
  expect(await fs.readFile(path.join(f.root, 'delivered.txt'), 'utf8')).toBe('交付的真实内容')
  expect(final.tools[0]!.observationFailure?.message).toContain('视觉模型')
  expect(final.failure).toBeUndefined() // No unrelated global sticky failure.
  expect(final.status, JSON.stringify({ tools: final.tools, failure: final.failure })).toBe(purpose === 'diagnostic' ? 'completed' : 'partial')
  const ended = await f.events.findEvent(f.input.conversationId, `${final.runId}:terminal`)
  expect(ended?.data.text).toContain(purpose === 'diagnostic' ? '相关视觉结果未验证' : '视觉模型')
  if (!purpose) {
    // A receipt for another displayed state does not verify the required state.
    const settlement = structuredClone(final), failed = settlement.tools[0]!, successful = structuredClone(failed)
    const failedData = (failed.result as { kind: 'read'; data: { identity: { stateId?: string | null } } }).data
    const successfulData = (successful.result as { kind: 'read'; data: { identity: { stateId?: string | null } } }).data
    failedData.identity.stateId = 'required-state'
    successfulData.identity.stateId = 'different-state'
    delete successful.observationFailure
    successful.callId = 'later-success'
    settlement.tools.push(successful)
    expect(executionCompletionIssues(settlement)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'view.observe', status: 'unverified' })]))
    successfulData.identity.stateId = 'required-state'
    expect(executionCompletionIssues(settlement).filter(issue => issue.name === 'view.observe')).toEqual([])
    failed.call.input = { ...failed.call.input as object, purpose: 'diagnostic' }
    failed.observationFailure = { message: 'Unknown observation outcome', outcome: 'unknown' }
    expect(executionCompletionIssues(settlement)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'view.observe', status: 'unknown' })]))
    const resumed = await f.engine.resume(final.runId, { ...final.input, selection, taskId: 'check-again' })
    const verified = await f.engine.wait(resumed.runId)
    expect(verified.tools[0]!.observationFailure).toBeUndefined()
    expect(verified.tools[0]!.call.input).not.toEqual(final.tools[0]!.call.input)
    expect(verified.status, JSON.stringify(verified.failure)).toBe('completed')
  }
})
