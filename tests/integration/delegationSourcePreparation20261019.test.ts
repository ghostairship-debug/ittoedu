// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import type { CodexDelegationRunner, DelegationExecutionResult } from '../../src/main/workbench/delegation/CodexDelegationRunner'
import { NativeTaskRunner, type NativeExecutionEnginePort } from '../../src/main/workbench/delegation/NativeTaskRunner'
import { ReadonlyTaskRunner } from '../../src/main/workbench/delegation/ReadonlyTaskRunner'
import type { LocalToolRunner } from '../../src/main/workbench/delegation/LocalToolRunner'
import type { PreparedTaskSource } from '../../src/shared/workbench/toolPorts'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { HostToolCoordinator } from '../../src/core/tools/HostToolServices'

const roots: string[] = []
const services: DelegationJobService[] = []
const releases: Array<() => void> = []
afterEach(async () => {
  const stopping = services.splice(0).map(service => service.cancelRun('parent'))
  releases.splice(0).forEach(release => release())
  await Promise.all(stopping)
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })))
})

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const source = (text = 'current unsaved source'): PreparedTaskSource => ({
  source: 'current.html', name: 'current.html', mimeType: 'text/html', version: 'document:epoch:7',
  bytes: new TextEncoder().encode(text),
})
function sourceGate(sources: readonly PreparedTaskSource[] = [source()]) {
  const entered = deferred<AbortSignal>(), release = deferred()
  releases.push(() => release.resolve())
  const prepareSources = vi.fn(async (signal: AbortSignal) => {
    entered.resolve(signal)
    await release.promise
    return sources
  })
  return { entered: entered.promise, release: () => release.resolve(), prepareSources }
}
async function fixture(options: Omit<ConstructorParameters<typeof DelegationJobService>[0], 'directory' | 'copyRootBase'> = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'guoling-source-preparation-'))
  roots.push(root)
  const copyRootBase = path.join(root, 'copies'), workspaceRoot = path.join(root, 'workspace')
  await fs.mkdir(workspaceRoot)
  const service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase, ...options })
  services.push(service)
  return { service, copyRootBase, workspaceRoot }
}
const identity = (jobId: string) => ({ runId: 'parent', jobId, taskId: jobId })
const nativeInput = (jobId: string) => ({ ...identity(jobId), permission: 'workspace' as const,
  intent: { goal: 'Prepare a reviewable candidate', sources: ['current.html'], outputs: ['candidate.md'] } })
const complete = (taskId: string, extra: Partial<DelegationExecutionResult> = {}): DelegationExecutionResult => ({
  taskId, status: 'verified', artifacts: [], reason: 'fixture completed', externalChangesPossible: false, ...extra,
})
async function copies(copyRootBase: string) {
  return fs.readdir(copyRootBase).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
}
function localRunner() {
  const prepare = vi.fn<LocalToolRunner['prepare']>(async (cwd, intent) => ({
    executable: process.execPath, sandboxExecutable: process.execPath, cwd, args: intent.args ?? [],
  }))
  const run = vi.fn<LocalToolRunner['run']>(async (taskId, command) => {
    expect(await fs.readFile(path.join(command.cwd, 'current.html'), 'utf8')).toBe('current unsaved source')
    await fs.writeFile(path.join(command.cwd, 'result.txt'), 'local candidate')
    return complete(taskId)
  })
  return { prepare, run, runner: { prepare, run } as unknown as LocalToolRunner }
}

it('registers native source freezing as preparing work, cancels its one job, and replays without freezing or launching again', async () => {
  const gate = sourceGate(), run = vi.fn<NativeTaskRunner['run']>(async request => complete(request.taskId))
  const { service, copyRootBase } = await fixture({ nativeRunner: { available: () => true, run, message: async () => {} } })
  const input = { ...nativeInput('native-freeze'), prepareSources: gate.prepareSources }
  const starting = service.startNative(input)
  const signal = await gate.entered
  expect(await starting).toMatchObject({ jobId: input.jobId, status: 'preparing', terminal: false })
  expect(await service.status('parent', input.jobId)).toMatchObject({ status: 'preparing', stopped: false })
  const replayFreeze = vi.fn(async () => { throw new Error('replay must not revisit the source') })
  expect(await service.startNative({ ...input, prepareSources: replayFreeze })).toMatchObject({ status: 'preparing' })
  expect(replayFreeze).not.toHaveBeenCalled()
  expect(await copies(copyRootBase)).toEqual([])
  const stopping = service.cancel('parent', input.jobId)
  expect(signal.aborted).toBe(true)
  // The source owner deliberately ignores its signal until released. Stop must
  // settle the job without waiting for that source work or adopting late bytes.
  expect(await stopping).toMatchObject({ status: 'cancelled', terminal: true, stopped: true })
  gate.release()
  expect(await service.startNative({ ...input, prepareSources: replayFreeze })).toMatchObject({ status: 'cancelled', stopped: true })
  expect(gate.prepareSources).toHaveBeenCalledOnce()
  expect(replayFreeze).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
  expect(await copies(copyRootBase)).toEqual([])
})

it('revokes readonly source preparation on parent Stop before the readonly runner receives any work', async () => {
  const gate = sourceGate(), run = vi.fn<ReadonlyTaskRunner['run']>(async request => complete(request.taskId))
  const { service, copyRootBase } = await fixture({ readonlyRunner: { run } as unknown as ReadonlyTaskRunner })
  const input = { ...identity('readonly-freeze'), intent: { goal: 'Read the current draft', sources: ['current.html'] },
    prepareSources: gate.prepareSources }
  const starting = service.startReadonly(input), signal = await gate.entered
  expect(await starting).toMatchObject({ status: 'preparing', executionKind: 'readonly' })
  const stopping = service.cancelRun('parent')
  expect(signal.aborted).toBe(true)
  await stopping
  gate.release()
  expect(await service.status('parent', input.jobId)).toMatchObject({ status: 'cancelled', stopped: true })
  expect(run).not.toHaveBeenCalled()
  expect(await copies(copyRootBase)).toEqual([])
})

it('starts managed source preparation lazily after the receipt and reuses the completed receipt without resolving sources again', async () => {
  const reference = 'C:/source/current.html', gate = sourceGate([{ ...source(), source: reference }])
  let actualCopy = ''
  const run = vi.fn<CodexDelegationRunner['run']>(async request => {
    actualCopy = request.copyRoot
    expect(await fs.readFile(path.join(request.copyRoot, 'current.html'), 'utf8')).toBe('current unsaved source')
    await fs.writeFile(path.join(request.copyRoot, 'candidate.md'), 'managed candidate')
    return { ...complete(request.taskId), configuredModel: 'gpt-6-luna' as const,
      configuredSpeed: 'priority' as const, account: 'ChatGPT' as const }
  })
  const { service, copyRootBase, workspaceRoot } = await fixture({ runner: { run } })
  const input = { ...identity('managed-freeze'), goal: 'Use current source bytes', permission: 'workspace' as const,
    expectedArtifacts: ['candidate.md'], workspaceRoot, materials: [reference], prepareSources: gate.prepareSources }
  const starting = service.startManaged(input)
  await gate.entered
  expect(await starting).toMatchObject({ status: 'preparing', executionKind: 'codex' })
  expect(await service.status('parent', input.jobId)).toMatchObject({ status: 'preparing' })
  expect(run).not.toHaveBeenCalled()
  expect(await copies(copyRootBase)).toEqual([])
  gate.release()
  expect(await service.wait('parent', input.jobId, 5000)).toMatchObject({ status: 'ready' })
  await fs.rm(actualCopy, { recursive: true })
  await fs.rm(workspaceRoot, { recursive: true })
  const replayFreeze = vi.fn(async () => { throw new Error('old source is no longer available') })
  expect(await service.startManaged({ ...input, prepareSources: replayFreeze })).toMatchObject({ status: 'ready' })
  expect(await service.startManaged({ ...input, sourceVersion: 'current', prepareSources: replayFreeze })).toMatchObject({ status: 'ready' })
  await expect(service.startManaged({ ...input, sourceVersion: 'disk', prepareSources: replayFreeze }))
    .rejects.toMatchObject({ code: 'job-conflict' })
  expect(replayFreeze).not.toHaveBeenCalled()
  expect(gate.prepareSources).toHaveBeenCalledOnce()
  expect(run).toHaveBeenCalledOnce()
})

it('cancels a local job while its preview is freezing sources and does not materialize or launch its command', async () => {
  const gate = sourceGate(), local = localRunner()
  const { service, copyRootBase } = await fixture({ localRunner: local.runner })
  const input = { ...identity('local-cancel-freeze'), intent: { command: process.execPath, outputs: ['result.txt'], sources: ['current.html'] },
    prepareSources: gate.prepareSources }
  const preparing = service.prepareLocal(input)
  const rejectedPreview = expect(preparing).rejects.toBeDefined()
  const signal = await gate.entered
  expect(await service.status('parent', input.jobId)).toMatchObject({ status: 'preparing', executionKind: 'local', terminal: false })
  const stopping = service.cancel('parent', input.jobId)
  expect(signal.aborted).toBe(true)
  await rejectedPreview
  expect(await stopping).toMatchObject({ status: 'cancelled', terminal: true, stopped: true })
  gate.release()
  expect(local.run).not.toHaveBeenCalled()
  expect(await copies(copyRootBase)).toEqual([])
})

it('deduplicates a local preparing job and materializes its frozen preview only after authorization and start', async () => {
  const gate = sourceGate(), local = localRunner()
  const { service, copyRootBase } = await fixture({ localRunner: local.runner })
  const input = { ...identity('local-preview'), intent: { command: process.execPath, args: ['--fixture'], outputs: ['result.txt'], sources: ['current.html'] },
    prepareSources: gate.prepareSources }
  const preparing = service.prepareLocal(input)
  await gate.entered
  const replayFreeze = vi.fn(async () => { throw new Error('one local job has one frozen source') })
  const repeated = service.prepareLocal({ ...input, prepareSources: replayFreeze })
  expect(await service.status('parent', input.jobId)).toMatchObject({ status: 'preparing', terminal: false })
  expect(await copies(copyRootBase)).toEqual([])
  gate.release()
  const preview = await preparing
  expect(await repeated).toEqual(preview)
  expect(preview.sources).toEqual([{ source: 'current.html', name: 'current.html', version: 'document:epoch:7',
    byteLength: Buffer.byteLength('current unsaved source') }])
  expect(gate.prepareSources).toHaveBeenCalledOnce()
  expect(replayFreeze).not.toHaveBeenCalled()
  expect(local.prepare).toHaveBeenCalledOnce()
  expect(local.run).not.toHaveBeenCalled()
  expect(await copies(copyRootBase)).toEqual([])
  service.authorizeLocal(input)
  expect(await copies(copyRootBase)).toEqual([])
  expect(await service.startLocal(input)).toMatchObject({ executionKind: 'local' })
  expect(await service.wait('parent', input.jobId, 5000)).toMatchObject({ status: 'ready' })
  expect(await service.startLocal(input)).toMatchObject({ status: 'ready' })
  expect(local.run).toHaveBeenCalledOnce()
})

it('owns resumed native source preparation in the new job before copying the old child workspace', async () => {
  const gate = sourceGate([source('resumed current source')])
  const run = vi.fn<NativeTaskRunner['run']>(async request => {
    if (request.jobId === 'original-native') {
      await fs.writeFile(path.join(request.copyRoot, 'candidate.md'), 'original candidate')
      return complete(request.taskId, { childRunId: 'original-child-run' })
    }
    expect(request.resumeRunId).toBe('original-child-run')
    expect(await fs.readFile(path.join(request.copyRoot, 'current.html'), 'utf8')).toBe('resumed current source')
    expect(await fs.readFile(path.join(request.copyRoot, 'candidate.md'), 'utf8')).toBe('original candidate')
    await fs.writeFile(path.join(request.copyRoot, 'candidate.md'), 'resumed candidate')
    return complete(request.taskId, { childRunId: 'resumed-child-run' })
  })
  const { service, copyRootBase } = await fixture({ nativeRunner: { available: () => true, run, message: async () => {} } })
  await service.startNative({ ...nativeInput('original-native'), sources: [source('original source')] })
  expect(await service.wait('parent', 'original-native', 5000)).toMatchObject({ status: 'ready', childRunId: 'original-child-run' })
  const input = { ...nativeInput('resumed-native'), sourceRunId: 'parent', sourceJobId: 'original-native', prepareSources: gate.prepareSources }
  const starting = service.resumeNative(input)
  await gate.entered
  expect(await starting).toMatchObject({ jobId: 'resumed-native', status: 'preparing' })
  expect(await copies(copyRootBase)).toHaveLength(1)
  expect(run).toHaveBeenCalledOnce()
  gate.release()
  expect(await service.wait('parent', input.jobId, 5000)).toMatchObject({ status: 'ready',
    resumedFrom: { runId: 'parent', jobId: 'original-native', childRunId: 'original-child-run' } })
  expect(run).toHaveBeenCalledTimes(2)
})

it('seals reachable entry dependencies while keeping a missing dependency as a local diagnostic', async () => {
  const files = {
    'entry.html': '<!doctype html><html><head><link rel="stylesheet" href="./assets/style.css"></head>'
      + '<body><img src="./missing.png"><script type="module" src="./module.js"></script></body></html>',
    'assets/style.css': '.scene { background-image: url("./art.svg"); }',
    'assets/art.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>',
    'module.js': 'import "./empty.js"; import { title } from "./helper.js"; document.title = title;',
    'helper.js': 'export const title = "frozen dependency";',
    'empty.js': '',
  }
  let actualCopy = ''
  const run = vi.fn<NativeTaskRunner['run']>(async request => {
    actualCopy = request.copyRoot
    for (const [name, text] of Object.entries(files)) {
      const filename = path.join(actualCopy, name)
      await fs.mkdir(path.dirname(filename), { recursive: true })
      await fs.writeFile(filename, text)
    }
    await fs.writeFile(path.join(actualCopy, 'unreferenced.txt'), 'not part of the entry')
    return complete(request.taskId)
  })
  const { service } = await fixture({ nativeRunner: { available: () => true, run, message: async () => {} } })
  const input = { ...identity('entry-dependencies'), permission: 'workspace' as const,
    intent: { goal: 'Produce one runnable HTML entry', outputs: ['entry.html'] }, sources: [] }
  await service.startNative(input)
  const ready = await service.wait('parent', input.jobId, 5000)
  expect(ready).toMatchObject({ status: 'ready', terminal: true })
  expect(ready.artifacts.map(artifact => artifact.name).sort()).toEqual(Object.keys(files).sort())
  expect((await service.logs('parent', input.jobId)).entries.map(entry => entry.message).join('\n')).toContain('missing.png')
  for (const [name, text] of Object.entries(files)) {
    const sealed = await service.readArtifact('parent', input.jobId, name)
    expect(Buffer.from(sealed.bytes).toString('utf8')).toBe(text)
    expect(sealed.artifact.byteLength).toBe(Buffer.byteLength(text))
    if (name !== 'entry.html') await fs.writeFile(path.join(actualCopy, name), 'changed after sealing')
  }
  for (const [name, text] of Object.entries(files)) {
    expect(Buffer.from((await service.readArtifact('parent', input.jobId, name)).bytes).toString('utf8')).toBe(text)
  }
  expect(run).toHaveBeenCalledOnce()
})

it('keeps mixed readonly inputs complete in the copy while sending text and binary read metadata to the model', async () => {
  const markdown = '# Current evidence\nThe original diagram is ![diagram](./diagram.png).'
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfYQAAAAASUVORK5CYII=', 'base64'))
  const sources: PreparedTaskSource[] = [
    { source: 'evidence.md', name: 'report.md', mimeType: 'text/markdown', version: 'document:markdown:2', bytes: new TextEncoder().encode(markdown) },
    { source: 'diagram.png', name: 'diagram.png', mimeType: 'image/png', version: 'disk:png:4', bytes: png },
    { source: 'notes.docx', name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      version: 'disk:docx:8', bytes: new Uint8Array([0x50, 0x4b, 0, 0xff, 0, 0xfe]),
      modelRepresentation: { text: 'Extracted source document text.', mimeType: 'text/plain',
        read: { source: 'notes.docx', version: 'disk:docx:8', offset: 0 } } },
  ]
  const selection: ModelSelection = { model: 'readonly-fixture', connection: { id: 'readonly-fixture', revision: 1,
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid', accountId: 'unused',
    auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' } } }
  let copyRootBase = '', providerCalls = 0
  const provider: ModelProvider = { async *stream(request) {
    providerCalls++
    const payload = JSON.parse(String(request.messages.find(message => message.role === 'user')?.content)) as
      { sources: Array<Record<string, unknown>> }
    const text = payload.sources.find(item => item.name === 'report.md')!
    expect(text).toMatchObject({ source: 'evidence.md', version: 'document:markdown:2', text: markdown,
      read: { source: 'evidence.md', version: 'document:markdown:2' } })
    const image = payload.sources.find(item => item.name === 'diagram.png')!
    expect(image).toMatchObject({ source: 'diagram.png', version: 'disk:png:4', byteLength: png.byteLength,
      omitted: { reason: 'binary-source', detail: expect.any(String) }, read: { source: 'diagram.png', version: 'disk:png:4' } })
    expect((image.omitted as { detail: string }).detail.length).toBeGreaterThan(0)
    expect(image).not.toHaveProperty('text')
    expect(payload.sources.find(item => item.name === 'notes.docx')).toMatchObject({ text: 'Extracted source document text.',
      representation: { mimeType: 'text/plain', read: { source: 'notes.docx', version: 'disk:docx:8', offset: 0 } } })
    for (const item of payload.sources) expect(item).not.toHaveProperty('bytes')
    expect(JSON.stringify(payload)).not.toContain(Buffer.from(png).toString('base64'))
    const directories = (await fs.readdir(copyRootBase, { withFileTypes: true })).filter(entry => entry.isDirectory())
    expect(directories).toHaveLength(1)
    for (const item of sources) {
      const copied = await fs.readFile(path.join(copyRootBase, directories[0]!.name, item.name))
      expect(new Uint8Array(copied)).toEqual(item.bytes)
    }
    yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: 'readonly-mixed-complete',
      actualModel: 'readonly-fixture', assistant: { role: 'assistant', content: 'The text evidence is readable; the original image remains available by source reference.' },
      toolCalls: [], finishReason: 'stop', nativeResponse: {} }
  } }
  const fixtureResult = await fixture({ readonlyRunner: new ReadonlyTaskRunner({ provider, parentSelection: () => selection }) })
  const service = fixtureResult.service
  copyRootBase = fixtureResult.copyRootBase
  const input = { ...identity('readonly-mixed-inputs'), intent: { goal: 'Read the mixed evidence without discarding the text',
    sources: sources.map(item => item.source) }, sources }
  await service.startReadonly(input)
  const ready = await service.wait('parent', input.jobId, 5000)
  expect(ready, ready.reason).toMatchObject({ status: 'ready', terminal: true, candidateComplete: true })
  expect(providerCalls).toBe(1)
  expect(ready.artifacts.map(artifact => artifact.name)).toContain('report-2.md')
  expect(Buffer.from((await service.readArtifact('parent', input.jobId, 'report-2.md')).bytes).toString('utf8'))
    .toContain('The text evidence is readable')
})

it('routes full and workspace grants from the Host through the real native runner without inheriting parent document writers', async () => {
  const selection: ModelSelection = { model: 'native-permission-fixture', connection: { id: 'native-permission-fixture', revision: 1,
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid', accountId: 'unused',
    auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' } } }
  const record = (runId: string, input: ExecutionStart): ExecutionRunRecord => ({ schemaVersion: 1, runId, version: 1,
    input, status: 'running', createdAt: 1, updatedAt: 1, messages: [], initialMessageCount: 0, requests: [], tools: [] })
  let parent!: ExecutionRunRecord
  const children = new Map<string, ExecutionRunRecord>()
  // Engine is the observation boundary here: the public Host, job owner and
  // NativeTaskRunner execute normally; no real Engine loop or Provider is run.
  const start = vi.fn<NativeExecutionEnginePort['start']>(async (input, _continuation, onPrepared) => {
    const child = record(`child-${children.size + 1}`, input)
    children.set(child.runId, child)
    await onPrepared?.(child)
    await fs.writeFile(path.join(input.workspaceRoot!, 'candidate.md'), `candidate with ${input.permission} permission`)
    return child
  })
  const engine: NativeExecutionEnginePort = {
    start, resume: async () => { throw new Error('No continuation is exercised') },
    read: async runId => runId === 'parent' ? parent : children.get(runId) ?? null,
    wait: async runId => ({ ...children.get(runId)!, status: 'completed' }),
    stop: async runId => children.has(runId) ? { ...children.get(runId)!, status: 'stopped' } : null,
    subscribe: () => () => {}, message: async () => parent,
  }
  const native = new NativeTaskRunner({ engine: () => engine }), run = vi.spyOn(native, 'run')
  const { service, copyRootBase, workspaceRoot } = await fixture({ nativeRunner: native })
  parent = record('parent', { conversationId: 'parent-conversation', taskId: 'parent-task', instruction: 'Parent work', selection,
    documents: [{ documentId: 'parent-writer-document', writable: [{ kind: 'document' }] }], workspaceRoot,
    boundReadPaths: [path.join(workspaceRoot, 'parent-only.txt')], permission: 'full' })
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document writes') }, async save() { throw new Error('No document writes') } } })
  const host = new HostToolCoordinator({ delegation: {
    availability: () => ({ ready: true, reason: 'fixture native runner' }), startManaged: input => service.startManaged(input),
    startNative: input => service.startNative(input), readArtifact: (...args) => service.readArtifact(...args),
    cancel: (...args) => service.cancel(...args), cancelRun: runId => service.cancelRun(runId),
  } }, registry, { resolveImage: async () => { throw new Error('No document access') }, active() { throw new Error('No document access') },
    ownsDocument: () => false, provideImage: async () => { throw new Error('No document access') }, readImage: async () => { throw new Error('No document access') } })
  for (const permission of ['full', 'workspace'] as const) {
    parent.input.permission = permission
    await host.beginRun({ runId: 'parent', actor: 'agent', documents: [], fileAccess: { permission, workspaceRoot } })
    const submitted = await host.runNativeDelegate('parent', `native-${permission}`, { goal: 'Create one isolated candidate', outputs: ['candidate.md'] })
    expect(submitted).toMatchObject({ kind: 'read', data: { job: expect.any(String) } })
    if (submitted.kind !== 'read') throw new Error('Host did not return the native job')
    const job = (submitted.data as { job: string }).job
    expect(await service.wait('parent', job, 5000)).toMatchObject({ status: 'ready' })
    const actualRequest = run.mock.calls.at(-1)![0], childInput = start.mock.calls.at(-1)![0]
    expect(actualRequest.permission).toBe(permission)
    expect(childInput.permission).toBe(permission)
    expect(childInput.documents).toEqual([])
    expect(childInput).not.toHaveProperty('boundReadPaths')
    expect(childInput.workspaceRoot).toBe(actualRequest.copyRoot)
    expect(childInput.workspaceRoot).not.toBe(parent.input.workspaceRoot)
    expect(path.relative(copyRootBase, childInput.workspaceRoot!)).not.toMatch(/^\.\./)
    expect(childInput.conversationId).not.toBe(parent.input.conversationId)
  }
  expect(start).toHaveBeenCalledTimes(2)
  expect(parent.input.documents[0]!.writable).toEqual([{ kind: 'document' }])
  parent.input.permission = 'workspace'
  const denied = await native.run({ ...nativeInput('forbidden-full'), permission: 'full', sources: [],
    copyRoot: run.mock.calls[0]![0].copyRoot })
  expect(denied).toMatchObject({ status: 'failed', externalChangesPossible: false })
  expect(start).toHaveBeenCalledTimes(2)
})
