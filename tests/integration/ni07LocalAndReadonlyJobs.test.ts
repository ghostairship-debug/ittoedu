import { artifactDeliverySource } from '../../src/core/tools/HostArtifactTools'
// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import { ReadonlyTaskRunner } from '../../src/main/workbench/delegation/ReadonlyTaskRunner'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import type { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { HostToolCoordinator } from '../../src/core/tools/HostToolServices'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { HostArtifactDeliveryService } from '../../src/main/workbench/execution/HostArtifactDeliveryService'
import type { LocalToolRunIntent } from '../../src/shared/workbench/toolPorts'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const electronDirectory = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronDirectory.value, getAppPath: () => process.cwd(), getVersion: () => '0.0.1', whenReady: async () => undefined },
  shell: {}, dialog: {}, BrowserWindow: class {}, session: {}, WebContentsView: class {}, net: {}, protocol: {}, ipcMain: {},
  safeStorage: { isEncryptionAvailable: () => false, isAsyncEncryptionAvailable: async () => false }, clipboard: {}, screen: {}, webContents: {} }))

async function fixture() {
  const base = path.resolve('output/ni07-jobs')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'run-'))
  const workspaceRoot = path.join(root, 'workspace')
  await fs.mkdir(workspaceRoot)
  return { root, workspaceRoot, directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies') }
}
const identity = (name: string) => ({ runId: 'parent', jobId: `delegate-${name}`, taskId: name })

it('production task input freezes the opened current draft and its document version before the real local JSON task', async () => {
  const paths = await fixture()
  electronDirectory.value = paths.root
  const { documentHost } = await import('../../src/main/workbench/documentHost')
  const { installWorkbenchToolServices, disposeHeadlessWorkbenchWorkers } = await import('../../src/main/workbench/workbenchToolServices')
  const { createLessonDocumentFiles } = await import('../../src/main/lessonDocumentFiles')
  const { DocumentFileSession } = await import('../../src/renderer/documentFiles/documentFileSession')
  const { SelectionContextController } = await import('../../src/renderer/workbench/SelectionContextController')
  const host = documentHost(), configured = vi.spyOn(host.tools, 'configureHostServices')
  installWorkbenchToolServices({ getMainWindow: () => null, getRendererEntryUrl: () => null })
  const services = configured.mock.calls.at(-1)![0]
  const filename = path.join(paths.workspaceRoot, 'numbers.txt')
  await fs.writeFile(filename, '[1]')
  await fs.writeFile(path.join(paths.workspaceRoot, 'unopened.json'), '[7]')
  await fs.writeFile(path.join(paths.workspaceRoot, 'data.bin'), Uint8Array.from([0, 128, 255]))
  const documents: DocumentHostAPI = { ...host.internalAPI, subscribe: listener => host.subscribeEvents(listener),
    close: async id => { await host.operate({ type: 'close', documentId: id }) }, discardRecovery: async id => { await host.operate({ type: 'discard-recovery', documentId: id }) },
    bootstrapCourse: async () => { throw new Error('No course') }, saveWithDialog: async () => { throw new Error('Must not save') }, closeWithDialog: async () => false }
  const files = createLessonDocumentFiles({ recoveryDirectory: path.join(paths.root, 'source-recovery'), validateTarget: async () => {}, documents })
  const view = new DocumentFileSession({ kind: 'file', path: filename }, { ...files, documents })
  await view.open()
  const documentId = view.documentId!, controller = new SelectionContextController(id => documents.read(id))
  const unregister = controller.register(documentId, async () => {
    if (!await view.drain() || !view.committedDocument) throw new Error('Source input not ready')
    return view.committedDocument
  })
  let prepared!: () => void
  const entered = new Promise<void>(resolve => { prepared = resolve })
  host.setDocumentInputPreparer(async id => { expect(id).toBe(documentId); prepared(); await controller.prepare(id) })
  await host.tools.beginRun({ runId: 'dirty-parent', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: paths.workspaceRoot } })
  try {
    view.setComposing(true); view.edit('[10,20,30]')
    expect(host.registry.get(documentId).read().model).toMatchObject({ source: '[1]' })
    const pending = services.taskInputs!.freeze('dirty-parent', ['numbers.txt', 'unopened.json', 'data.bin'])
    expect(await Promise.race([entered.then(() => 'prepared'), pending.then(() => 'disk-only')])).toBe('prepared')
    view.setComposing(false)
    const sources = await pending, snapshot = await host.registry.get(documentId).drain()
    expect(snapshot).toMatchObject({ dirty: true, model: { source: '[10,20,30]' } })
    expect(Buffer.from(sources[0]!.bytes).toString()).toBe('[10,20,30]')
    expect(sources[0]!.version).toBe(`document:${snapshot.documentId}:${snapshot.epoch}:${snapshot.revision}`)
    expect(Buffer.from(sources[1]!.bytes).toString()).toBe('[7]')
    expect([...sources[2]!.bytes]).toEqual([0, 128, 255])
    const request = { runId: 'dirty-parent', jobId: 'delegate-current-draft', taskId: 'dirty-input', intent: {
      command: process.execPath, sources: ['numbers.txt'], outputs: ['current.json'], args: ['-e',
        'const fs=require("fs");const values=JSON.parse(fs.readFileSync("numbers.txt","utf8"));fs.writeFileSync("current.json",JSON.stringify({total:values.reduce((a,b)=>a+b,0)}));'] } }
    await expect(services.taskInputs!.freeze('dirty-parent', [path.join(paths.root, 'outside.txt')])).rejects.toThrow()
    if (process.platform !== 'win32') {
      await expect(services.delegation!.prepareLocal!({ ...request, sources })).rejects.toThrow('仅支持 Windows')
      await expect(services.jobs!.status({ runId: request.runId, jobId: request.jobId, kind: 'delegation' })).rejects.toMatchObject({ code: 'unknown-job' })
      expect(await fs.readFile(filename, 'utf8')).toBe('[1]')
      expect(host.registry.get(documentId).read()).toMatchObject({ dirty: true, revision: snapshot.revision })
      return
    }
    const preview = await services.delegation!.prepareLocal!({ ...request, sources })
    expect(preview.sources[0]!.version).toBe(sources[0]!.version)
    await services.delegation!.authorizeLocal!(request)
    await services.delegation!.startLocal!(request)
    expect(await services.jobs!.wait({ runId: request.runId, jobId: request.jobId, kind: 'delegation', milliseconds: 10_000 })).toMatchObject({ status: 'ready' })
    const artifact = await services.delegation!.readArtifact(request.runId, request.jobId, 'current.json')
    expect(JSON.parse(Buffer.from(artifact.bytes).toString())).toEqual({ total: 60 })
    expect(await fs.readFile(filename, 'utf8')).toBe('[1]')
    expect(host.registry.get(documentId).read()).toMatchObject({ dirty: true, revision: snapshot.revision })
    await expect(services.taskInputs!.freeze('dirty-parent', [path.join(paths.root, 'outside.txt')])).rejects.toThrow()
  } finally {
    view.setComposing(false); unregister(); view.dispose(); host.setDocumentInputPreparer()
    await host.tools.stop('dirty-parent'); configured.mockRestore(); disposeHeadlessWorkbenchWorkers()
  }
}, 30_000)

it('runs an installed native JSON task with stdin and frozen input, then reads and saves its actual result without replay', async () => {
  const paths = await fixture(), service = new DelegationJobService(paths)
  const jobs = new HostJobService({ delegation: service, images: {} as ImageGenerationService })
  const source = new TextEncoder().encode('[2,3,5]')
  const intent: LocalToolRunIntent = { command: process.execPath, cwd: 'data', sources: ['numbers.json'], outputs: ['summary.json'],
    stdin: '{"multiplier":4}', args: ['-e', 'const fs=require("fs"); const input=JSON.parse(fs.readFileSync("numbers.json","utf8")); let text="";process.stdin.on("data",x=>text+=x);process.stdin.on("end",()=>{const p=JSON.parse(text);const value={count:input.length,total:input.reduce((a,b)=>a+b,0)*p.multiplier};fs.writeFileSync("summary.json",JSON.stringify(value),{flag:"wx"});process.stdout.write("validated-json count="+value.count);});'] }
  const request = { ...identity('json'), jobId: `delegate-${documentDigest(['parent', 'json'])}`, intent }
  if (process.platform !== 'win32') {
    await expect(service.prepareLocal({ ...request, sources: [{ source: 'numbers.json', name: 'numbers.json', mimeType: 'application/json', version: 'source-v1', bytes: source }] })).rejects.toThrow('仅支持 Windows')
    await expect(service.status('parent', request.jobId)).rejects.toMatchObject({ code: 'unknown-job' })
    return
  }
  const preview = await service.prepareLocal({ ...request, sources: [{ source: 'numbers.json', name: 'numbers.json', mimeType: 'application/json', version: 'source-v1', bytes: source }] })
  expect(preview).toMatchObject({ executable: await fs.realpath(process.execPath), stdinByteLength: 16,
    sources: [{ source: 'numbers.json', name: 'numbers.json', version: 'source-v1', byteLength: 7 }] })
  source.fill(0)
  await expect(service.startLocal(request)).rejects.toThrow('明确批准')
  service.authorizeLocal(request)
  await expect(service.startLocal({ ...request, intent: { ...intent, args: ['-e', 'process.exit(0)'] } })).rejects.toThrow('明确批准')
  // Catalog parsing can reorder object keys; execution must still bind to the same approved intent.
  await service.startLocal({ ...request, intent: { args: intent.args, command: intent.command, cwd: intent.cwd,
    stdin: intent.stdin, sources: intent.sources, outputs: intent.outputs } })
  const result = await jobs.wait({ runId: 'parent', kind: 'delegation', jobId: request.jobId, milliseconds: 10_000 })
  expect(result).toMatchObject({ status: 'ready', terminal: true, snapshot: { executionKind: 'local', exitCode: 0 } })
  expect(result.snapshot).not.toHaveProperty('configuredModel')
  const artifact = await service.readArtifact('parent', request.jobId, 'summary.json')
  expect(JSON.parse(Buffer.from(artifact.bytes).toString())).toEqual({ count: 3, total: 40 })
  const logs = await jobs.logs({ runId: 'parent', kind: 'delegation', jobId: request.jobId })
  expect(logs.entries.some(entry => entry.message.includes('validated-json count=3'))).toBe(true)
  expect((await service.startLocal(request)).status).toBe('ready')
  expect((await jobs.logs({ runId: 'parent', kind: 'delegation', jobId: request.jobId })).entries).toEqual(logs.entries)
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document writer') }, async save() { throw new Error('No document writer') } } })
  const deliveries = new HostArtifactDeliveryService({ journalDirectory: path.join(paths.root, 'delivery'), withFileOperation: work => work() })
  const host = new HostToolCoordinator({ jobs, delegation: { availability: () => ({ ready: false, reason: 'legacy CLI remains blocked' }),
    startManaged: input => service.startManaged(input), readArtifact: (...args) => service.readArtifact(...args),
    cancel: (...args) => service.cancel(...args), cancelRun: run => service.cancelRun(run) }, artifacts: {
      lookup: (run, operation) => deliveries.lookup(operation, run), save: ({ grant, operationId, source: artifactSource, bytes, assertActive }) =>
        deliveries.deliver({ runId: grant.runId, operationId, workspaceRoot: paths.workspaceRoot, permission: 'workspace',
          destination: artifactSource.destination, ...artifactDeliverySource(artifactSource), bytes, assertActive }),
    } }, registry, { resolveImage: async () => { throw new Error('No document access') }, active() { throw new Error('No document access') },
    ownsDocument: () => false, provideImage: async () => { throw new Error('No document access') }, readImage: async () => { throw new Error('No document access') } })
  await host.beginRun({ runId: 'parent', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: paths.workspaceRoot } })
  const viewed = await host.jobStatus('parent', { kind: 'delegation', jobId: request.jobId })
  if (viewed.kind !== 'read') throw new Error('missing result')
  const view = viewed.data as { snapshot: { artifacts: { source: string; read: { job: string; name: string; version: string } }[] } }
  expect(await host.readDelegation('parent', view.snapshot.artifacts[0]!.read)).toMatchObject({ kind: 'read', data: { text: '{"count":3,"total":40}' } })
  expect(await host.saveArtifact('parent', 'save', 'request', { source: view.snapshot.artifacts[0]!.source, destination: 'summary.json' }))
    .toMatchObject({ kind: 'read', data: { status: 'written', sourceKind: 'delegation' } })
  expect(JSON.parse(await fs.readFile(path.join(paths.workspaceRoot, 'summary.json'), 'utf8'))).toEqual({ count: 3, total: 40 })
  expect(await host.lookup('parent', 'json', 'request', 'local.run')).toMatchObject({ kind: 'read', data: {
    job: request.jobId, status: 'ready', artifacts: [{ source: view.snapshot.artifacts[0]!.source }] } })
  expect((await service.logs('parent', request.jobId)).entries).toEqual(logs.entries)
}, 30_000)

it('reports actual stderr and nonzero exit, cancels a running process tree, and retains the original job when queried again', async () => {
  const paths = await fixture(), service = new DelegationJobService(paths)
  const failed = { ...identity('failure'), intent: { command: process.execPath, args: ['-e', 'process.stderr.write("invalid data");process.exit(7)'] } }
  if (process.platform !== 'win32') {
    await expect(service.prepareLocal({ ...failed, sources: [] })).rejects.toThrow('仅支持 Windows')
    await expect(service.status('parent', failed.jobId)).rejects.toMatchObject({ code: 'unknown-job' })
    await service.cancelRun('parent')
    await expect(service.prepareLocal({ ...identity('late'), intent: { command: process.execPath }, sources: [] })).rejects.toThrow('父任务已停止')
    return
  }
  await service.prepareLocal({ ...failed, sources: [] }); service.authorizeLocal(failed); await service.startLocal(failed)
  expect(await service.wait('parent', failed.jobId, 10_000)).toMatchObject({ status: 'failed', exitCode: 7, artifacts: [] })
  expect((await service.logs('parent', failed.jobId)).entries.some(entry => entry.kind === 'stderr' && entry.message.includes('invalid data'))).toBe(true)
  const cancelled = { ...identity('cancel'), intent: { command: process.execPath,
    args: ['-e', 'const fs=require("fs");fs.writeFileSync("started.txt","once",{flag:"wx"});process.stdout.write("ready-to-cancel");setInterval(()=>fs.appendFileSync("ticks.txt","tick"),30)'] } }
  await service.prepareLocal({ ...cancelled, sources: [] }); service.authorizeLocal(cancelled); await service.startLocal(cancelled)
  await expect.poll(async () => (await service.logs('parent', cancelled.jobId)).entries.some(entry => entry.message.includes('ready-to-cancel')), { timeout: 10_000 }).toBe(true)
  const stopped = await service.cancel('parent', cancelled.jobId)
  expect(stopped).toMatchObject({ status: 'cancelled', stopped: true, terminal: true, artifacts: [] })
  expect(await service.startLocal(cancelled)).toMatchObject({ status: 'cancelled', stopped: true })
  const restarted = new DelegationJobService(paths)
  expect(await restarted.status('parent', cancelled.jobId)).toMatchObject({ status: 'cancelled', stopped: true })
  await service.cancelRun('parent')
  await expect(service.prepareLocal({ ...identity('late'), intent: { command: process.execPath }, sources: [] })).rejects.toThrow('父任务已停止')
}, 30_000)

const selection: ModelSelection = { model: 'deepseek-flash', parameters: { temperature: 0.2 }, connection: {
  id: 'parent-connection', revision: 1, provider: 'deepseek', protocol: 'openai-chat', baseURL: 'https://api.teamorouter.com/v1', accountId: 'existing',
  auth: { kind: 'api-key', credentialRef: 'host-only' }, billing: { kind: 'metered' }, capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'supported' } } }
it('runs one finite readonly request with the parent selection, returns source-bound candidate, and aborts on parent stop', async () => {
  const paths = await fixture(), requests: ModelRequest[] = []
  let parentStopObserved = false
  const provider: ModelProvider = { async *stream(request, options) {
    requests.push(request)
    if (requests.length === 2) {
      await new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => { parentStopObserved = true; resolve() }, { once: true }))
      return
    }
    yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: 'readonly-response', actualModel: 'actual-parent-model',
      assistant: { role: 'assistant', content: '候选：总数为 3，来源 numbers.txt。' }, toolCalls: [], finishReason: 'stop', nativeResponse: {},
      usage: { inputTokens: 40, outputTokens: 12, totalTokens: 52, raw: {} } }
  } }
  const service = new DelegationJobService({ ...paths, readonlyRunner: new ReadonlyTaskRunner({ provider, parentSelection: () => selection }) })
  const sources = [{ source: 'numbers.txt', name: 'numbers.txt', mimeType: 'text/plain', version: 'frozen-version', bytes: new TextEncoder().encode('1,2,3') }]
  const intent = { goal: '统计个数并引用来源', sources: ['numbers.txt'], budget: { maxOutputTokens: 128, maxDurationMs: 5000 } }
  const request = { ...identity('readonly'), intent, sources }
  await service.startReadonly(request)
  expect(await service.wait('parent', request.jobId, 5000)).toMatchObject({ status: 'ready', executionKind: 'readonly',
    configuredModel: 'deepseek-flash', actualModel: 'actual-parent-model', connectionId: 'parent-connection', usage: { totalTokens: 52 } })
  expect(requests[0]).toMatchObject({ selection: { model: selection.model, connection: selection.connection, parameters: { max_tokens: 128 } }, tools: [] })
  const report = Buffer.from((await service.readArtifact('parent', request.jobId, 'report.md')).bytes).toString()
  expect(report).toContain('frozen-version'); expect(report).toContain('numbers.txt')
  expect(await service.startReadonly(request)).toMatchObject({ status: 'ready' }); expect(requests).toHaveLength(1)
  const second = { ...request, ...identity('readonly-stop') }
  await service.startReadonly(second)
  await expect.poll(() => requests.length).toBe(2)
  await service.cancelRun('parent')
  expect(parentStopObserved).toBe(true)
  expect(await service.status('parent', second.jobId)).toMatchObject({ status: 'cancelled', stopped: true, artifacts: [] })
  expect(await fs.readdir(paths.workspaceRoot)).toEqual([])
}, 15_000)
