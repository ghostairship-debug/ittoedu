import { documentDigest } from '../../src/core/documents/documentDigest'
import type { BuildJobInput } from '../../src/shared/workbench/build'
// @vitest-environment node
import { createServer, type Server, type ServerResponse } from 'node:http'
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { DocumentModel, DurableDocumentState } from '../../src/shared/workbench/document'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { ChatGPTImageProvider } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const directory of roots.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-host-tools-')); roots.push(root); return root }
const driver = new CourseV9Driver()
const fixture = () => driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
function harness(services?: HostToolServices) {
  const states: DurableDocumentState[] = []
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path, persistence: { async append(state) { states.push(structuredClone(state)) }, async save() { throw new Error('Not requested') } } })
  const gateway = new DocumentToolGateway(registry, [driver], () => `${++id}`, { prepareImage: prepareImageResource, ...(services ? { services } : {}) })
  return { registry, gateway, states }
}
const data = (result: ToolResult): any => { if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return result.data }
const selection: ImageModelSelection = { imageModel: 'local-protocol-image', connection: { id: 'image-connection', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture-account', auth: { kind: 'oauth', credentialRef: 'fixture-reference' }, billing: { kind: 'subscription' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } }
async function http(handler: (body: any, response: ServerResponse) => Promise<void> | void): Promise<typeof fetch> {
  const server = createServer((request, response) => { void (async () => {
    const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part))
    await handler(JSON.parse(Buffer.concat(parts).toString()), response)
  })().catch(() => response.destroy()) })
  servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server')
  return (url, init) => fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init)
}
function complete(response: ServerResponse, bytes: Uint8Array) {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ created: 123, data: [{ generation_id: 'local-image', b64_json: Buffer.from(bytes).toString('base64') }], size: '32x24', output_format: 'png' }))
}
async function begin(gateway: DocumentToolGateway, documentId: string, runId = 'run') {
  await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId, writable: [{ kind: 'document' }] }] })
  return gateway.issueTarget(runId, documentId, { kind: 'document' })
}
function builds(root: string) { return new ControlledBuildService({ directory: root, admission: { async run() { throw new Error('Static fixture must not substitute for dynamic admission') } } }) }

it('uses one catalog for real HTTP image generation/edit, decoded run-bound resources, media commit and archive/undo', async () => {
  const original = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#aabbcc' } }).png().toBuffer()
  const edited = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#ddaa00' } }).png().toBuffer()
  const bodies: any[] = [], operations: string[] = []
  const transport = await http((body, response) => { bodies.push(body); complete(response, bodies.length === 1 ? original : edited) })
  let gateway!: DocumentToolGateway
  const service = new ImageGenerationService({ directory: await directory(), provider: new ChatGPTImageProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'fixture-access', accountId: 'fixture-account' }) }), resolveReference: (run, document, reference) => gateway.readImageResource(run, document, reference) })
  const f = harness(); gateway = f.gateway
  let settings = structuredClone(selection), frozen!: ImageModelSelection
  const services: HostToolServices = { beginRun: async grant => { expect(grant.runId).toBe('run'); frozen = structuredClone(settings) }, images: { selection: (_run, _doc, operation) => { operations.push(operation); return frozen }, run: service.run.bind(service), read: service.read.bind(service), stop: service.stop.bind(service), readResource: service.readResource.bind(service) } }
  gateway.configureHostServices(services)
  const baseline = fixture(), session = await f.registry.create(baseline, 'images.h5lesson'), target = await begin(gateway, session.documentId)
  settings = { ...selection, imageModel: 'changed-after-run-start' }
  expect(() => gateway.configureHostServices(services)).toThrow()
  expect((await gateway.describe()).map(tool => tool.name)).toEqual(expect.arrayContaining(['image.generate', 'image.edit', 'image.status', 'media.insert']))
  expect((await gateway.describe()).some(tool => tool.name === 'build.create')).toBe(false)
  const call = { name: 'image.generate', input: { target, prompt: 'fixture generation', output: { size: '32x24', format: 'png' } } }
  const generated = data(await gateway.execute('run', 'generate', call))
  expect(generated).toMatchObject({ status: 'ready', resources: [{ width: 32, height: 24, resource: expect.stringMatching(/^r/) }] })
  expect(session.read().undoDepth).toBe(0)
  expect(data(await gateway.execute('run', 'generate', call))).toEqual(generated)
  const result = data(await gateway.execute('run', 'edit', { name: 'image.edit', input: { target, prompt: 'edit fixture', references: [generated.resources[0].resource] } }))
  expect(bodies[0].model).toBe(selection.imageModel)
  expect(result.status).toBe('ready'); expect(operations).toEqual(['generate', 'edit']); expect(bodies).toHaveLength(2)
  expect(bodies[1].images[0].image_url).toBe(`data:image/png;base64,${original.toString('base64')}`)
  expect(Buffer.from((await gateway.readImageResource('run', session.documentId, generated.resources[0].resource)).bytes)).toEqual(original)
  expect(data(await gateway.execute('run', 'status', { name: 'image.status', input: { job: result.job } })).resources[0].resource).toBe(result.resources[0].resource)
  const location = baseline.project.locations.find(location => location.kind === 'slide-scene')!
  const owner = await gateway.issueTarget('run', session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
  const applied = await gateway.execute('run', 'insert', { name: 'media.insert', input: { target: owner, resource: result.resources[0].resource, properties: {} } })
  expect(applied).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = session.read(); expect(after.undoDepth).toBe(1); expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  expect(Object.values(after.model.resources.assets).some(bytes => Buffer.from(bytes).equals(edited))).toBe(true)
  await session.execute({ documentId: session.documentId, epoch: after.epoch, operationId: 'undo-image', actor: 'human', baseRevision: after.revision, mutation: { type: 'undo' } })
  expect(session.read().model.resources).toEqual(baseline.resources)
})

it('prepares one image for a still-authorized owner after its own Native edit without renewing stale edit authority', async () => {
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#2857aa' } }).png().toBuffer()
  let requests = 0
  const transport = await http((_body, response) => { requests++; complete(response, bytes) })
  let gateway!: DocumentToolGateway
  const images = new ImageGenerationService({ directory: await directory(),
    provider: new ChatGPTImageProvider({ fetch: transport, credentialResolver: async () => ({
      accessToken: 'fixture-access', accountId: 'fixture-account',
    }) }), resolveReference: (run, document, reference) => gateway.readImageResource(run, document, reference) })
  const f = harness({ images: { selection: () => selection, run: images.run.bind(images),
    read: images.read.bind(images), stop: images.stop.bind(images), readResource: images.readResource.bind(images) } })
  gateway = f.gateway
  const baseline = fixture(), session = await f.registry.create(baseline, 'stale-owner-image.h5lesson')
  await begin(gateway, session.documentId)
  const location = baseline.project.locations.find(item => item.kind === 'slide-scene')!
  const ownerTarget = { kind: 'course-owner' as const, owner: 'scene' as const, locationId: location.id }
  const owner = await gateway.issueTarget('run', session.documentId, ownerTarget)
  const first = await gateway.execute('run', 'native-first', { name: 'native.insert', input: { target: owner,
    template: { nativeType: 'text', text: '先写文字', x: 600, y: 500, width: 250, height: 70 } } })
  expect(first).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await gateway.execute('run', 'native-stale', { name: 'native.insert', input: { target: owner,
    template: { nativeType: 'text', text: '不能用旧句柄续写' } } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  const generated = data(await gateway.execute('run', 'image-after-text', { name: 'image.generate',
    input: { target: owner, prompt: 'existing owner, fresh image', output: { size: '32x24', format: 'png' } } }))
  expect(generated).toMatchObject({ status: 'ready', resources: [{ width: 32, height: 24 }] })
  expect(requests).toBe(1)
  expect(session.read().undoDepth).toBe(1)
  const readonly = await gateway.issueTarget('run', session.documentId, ownerTarget, { readOnly: true })
  expect(await gateway.execute('run', 'image-readonly', { name: 'image.generate',
    input: { target: readonly, prompt: 'must not send' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(requests).toBe(1)
})

it('runs real scratch repair/read/compile/check/import through Gateway with frozen artifacts, one History and durable receipt replay', async () => {
  const service = builds(await directory()), { registry, gateway, states } = harness({ builds: service })
  const baseline = fixture(), session = await registry.create(baseline, 'build.h5lesson'), target = await begin(gateway, session.documentId)
  const invoke = (id: string, name: string, input: unknown) => gateway.execute('run', id, { name, input })
  const created = data(await invoke('create', 'build.create', { target })), job = created.job
  expect(data(await invoke('create', 'build.create', { target })).job).toBe(job)
  expect(data(await invoke('list', 'build.read', { job })).files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'project.json' })]))
  expect(data(await invoke('read', 'build.read', { job, path: 'project.json', limit: 40 }))).toMatchObject({ nextOffset: 40, byteLength: expect.any(Number) })
  await invoke('broken-source', 'build.write', { job, path: 'runtime.js', content: 'function (' })
  expect(data(await invoke('compile-broken', 'build.compile', { job, path: 'runtime.js', kind: 'runtime' })).ok).toBe(false)
  await invoke('fix-source', 'build.write', { job, path: 'runtime.js', content: 'globalThis.example = 1' })
  expect(data(await invoke('compile-fixed', 'build.compile', { job, path: 'runtime.js', kind: 'runtime' }))).toMatchObject({ ok: true, stage: 'syntax-checked' })
  const project = structuredClone(baseline.project); project.title = 'prepared build'
  const meta = Object.values(project.assets)[0], bytes = baseline.resources.assets[meta.id]
  project.assets['build-added'] = { ...meta, id: 'build-added', path: 'assets/build-added.png' }
  await invoke('resource', 'build.write', { job, path: 'assets/build-added.png', content: Buffer.from(bytes).toString('base64'), encoding: 'base64' })
  await invoke('project', 'build.write', { job, path: 'project.json', content: JSON.stringify(project) })
  expect(data(await invoke('logs', 'build.logs', { job, limit: 2 })).entries).toHaveLength(2)
  const checked = data(await invoke('check', 'build.check', { job }))
  expect(checked).toMatchObject({ status: 'ready', prepared: true, artifact: expect.any(String) })
  expect(session.read().model).toEqual(baseline)
  const call = { name: 'build.import', input: { job, artifact: checked.artifact } }
  const imported = await gateway.execute('run', 'import', call)
  expect(imported).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = session.read(); expect(after.undoDepth).toBe(1)
  expect(after.model).toMatchObject({ project: { title: 'prepared build' }, resources: { assets: { 'build-added': bytes } } })
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  const recovery = harness({ builds: service }), restoredSession = await recovery.registry.restore(states.at(-1)!)
  const restored = recovery.gateway
  restored.recoverRun({ runId: 'run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  expect(await restored.lookup('run', 'import', call)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await restored.execute('run', 'import', call)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(session.read().undoDepth).toBe(1)
  expect(restoredSession.read().undoDepth).toBe(1)
  await session.execute({ documentId: session.documentId, epoch: after.epoch, operationId: 'undo-build', actor: 'human', baseRevision: after.revision, mutation: { type: 'undo' } })
  expect(session.read().model.resources).toEqual(baseline.resources)
  expect((session.read().model as typeof baseline).project.surfaces).toEqual(baseline.project.surfaces)
})

it('refuses changed build premises and partial grants, cancels prepared work and suppresses stopped image results without resend', async () => {
  const service = builds(await directory()), { registry, gateway } = harness({ builds: service })
  const baseline = fixture(), session = await registry.create(baseline, 'conflict.h5lesson'), target = await begin(gateway, session.documentId)
  const created = data(await gateway.execute('run', 'create', { name: 'build.create', input: { target } }))
  const checked = data(await gateway.execute('run', 'check', { name: 'build.check', input: { job: created.job } }))
  const before = session.read(), project = structuredClone(baseline.project); project.title = 'human change'
  await session.execute({ documentId: session.documentId, epoch: before.epoch, operationId: 'human', actor: 'human', baseRevision: before.revision, mutation: { type: 'command', command: { type: 'course.replace', project } } })
  expect(await gateway.execute('run', 'conflict', { name: 'build.import', input: { job: created.job, artifact: checked.artifact } })).toMatchObject({ kind: 'error', code: 'build-target-conflict' })
  expect((session.read().model as typeof baseline).project.title).toBe('human change')
  const location = baseline.project.locations.find(location => location.kind === 'slide-scene')!
  const partial = { kind: 'course-owner' as const, locationId: location.id, owner: 'scene' as const }
  await gateway.beginRun({ runId: 'partial', actor: 'agent', documents: [{ documentId: session.documentId, writable: [partial] }] })
  const partialHandle = await gateway.issueTarget('partial', session.documentId, partial)
  expect(await gateway.execute('partial', 'create', { name: 'build.create', input: { target: partialHandle } })).toMatchObject({ kind: 'error' })
  await gateway.stop('run')
  expect(await gateway.execute('run', 'stopped-import', { name: 'build.import', input: { job: created.job, artifact: checked.artifact } })).toMatchObject({ kind: 'error', code: 'run-stopped' })
  await expect(service.artifact('run', created.job, checked.artifact)).rejects.toThrow()
  let entered!: () => void, release!: () => void, requests = 0
  const started = new Promise<void>(resolve => { entered = resolve })
  const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const transport = await http(async (_body, response) => { requests++; entered(); await new Promise<void>(resolve => { release = resolve }); complete(response, png) })
  const images = new ImageGenerationService({ directory: await directory(), provider: new ChatGPTImageProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'fixture-access', accountId: 'fixture-account' }) }) })
  const f = harness({ images: { selection: () => selection, run: images.run.bind(images), read: images.read.bind(images), stop: images.stop.bind(images), readResource: images.readResource.bind(images) } })
  const imageSession = await f.registry.create(baseline, 'stopped-images.h5lesson'), imageTarget = await begin(f.gateway, imageSession.documentId)
  const call = { name: 'image.generate', input: { target: imageTarget, prompt: 'delayed' } }, running = f.gateway.execute('run', 'generate', call)
  await started; await f.gateway.stop('run'); release()
  expect(await running).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(await f.gateway.execute('run', 'generate', call)).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(requests).toBe(1); expect(imageSession.read().model).toEqual(baseline)
  expect((await images.read(`image-${f.gateway.operationIdentity('run', 'generate')}`)).stopped).toBe(true)
})


it('recovers one persisted build-create ticket without old handles, duplicates or renewed run authority', async () => {
  const root = await directory(), service = builds(root), { registry, gateway } = harness({ builds: service })
  const baseline = fixture(), session = await registry.create(baseline, 'create-recovery.h5lesson'), target = await begin(gateway, session.documentId)
  const call = { name: 'build.create', input: { target } }, created = data(await gateway.execute('run', 'durable-create', call))
  const snapshot = session.read(), newer = structuredClone(baseline.project); newer.title = 'human remains'
  await session.execute({ documentId: session.documentId, epoch: snapshot.epoch, operationId: 'human-after-create', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'command', command: { type: 'course.replace', project: newer } } })
  const reopenedService = builds(root), recovered = new DocumentToolGateway(registry, [driver], () => 'recovery', { services: { builds: reopenedService } })
  recovered.recoverRun({ runId: 'run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  expect(data((await recovered.lookup('run', 'durable-create', call))!)).toMatchObject({ job: created.job, status: 'editing' })
  expect(await recovered.execute('run', 'durable-create', call)).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(await recovered.execute('run', 'write-after-recovery', { name: 'build.write', input: { job: created.job, path: 'project.json', content: '{}' } })).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(await recovered.lookup('run', 'durable-create', { name: 'build.create', input: { target: 'different-input' } })).toMatchObject({ kind: 'error', code: 'operation-payload-mismatch' })
  const ticket = { operationId: gateway.operationIdentity('run', 'durable-create'), requestDigest: documentDigest(call) }
  const lookup = await reopenedService.lookupCreate('run', ticket)
  if (lookup?.status !== 'created') throw new Error('persisted creation')
  expect(lookup.job.target.baseRevision).toBe(snapshot.revision)
  expect(lookup.job.target.modelDigest).toBe(documentDigest(baseline))
  expect((await fs.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name !== 'requests')).toHaveLength(1)
  expect((session.read().model as typeof baseline).project.title).toBe('human remains')
  const restricted = new DocumentToolGateway(registry, [driver], () => 'restricted', { services: { builds: builds(root) } })
  restricted.recoverRun({ runId: 'run', actor: 'agent', documents: [] })
  expect(await restricted.lookup('run', 'durable-create', call)).toMatchObject({ kind: 'error' })
  expect(await reopenedService.lookupCreate('other-run', ticket)).toBeNull()
})

it('keeps an incomplete durable create reservation uncertain and never recreates scratch on retry', async () => {
  const root = await directory(), service = builds(root), baseline = fixture(), digest = documentDigest(baseline)
  const frozen: BuildJobInput = { runId: 'run', target: { documentId: 'document', projectId: baseline.project.id, epoch: 'epoch', baseRevision: baseline.project.revision, modelDigest: digest }, readSet: [{ documentId: 'document', epoch: 'epoch', revision: baseline.project.revision, digest }], baseline, allowedOrigins: [], budget: { maxBytes: 1 } }
  const ticket = { operationId: 'host-operation', requestDigest: documentDigest({ name: 'build.create', input: { target: 't-frozen' } }) }
  // Real disk initialization fails after durable reservation/baseline, before a completed state file.
  await expect(service.create(frozen, ticket)).rejects.toMatchObject({ code: 'build-budget' })
  const restarted = builds(root), lookup = await restarted.lookupCreate('run', ticket)
  expect(lookup).toMatchObject({ status: 'unknown', runId: 'run', target: frozen.target })
  const before = (await fs.readdir(root)).sort()
  await expect(restarted.create(frozen, ticket)).rejects.toMatchObject({ code: 'build-create-unknown' })
  expect((await fs.readdir(root)).sort()).toEqual(before)
  expect(await restarted.lookupCreate('run', ticket)).toEqual(lookup)
  await expect(restarted.create({ ...frozen, budget: undefined }, ticket)).rejects.toMatchObject({ code: 'operation-payload-mismatch' })
  await expect(restarted.lookupCreate('run', { ...ticket, requestDigest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'operation-payload-mismatch' })
  if (lookup?.status !== 'unknown') throw new Error('unknown')
  await expect(fs.access(path.join(root, lookup.jobId, 'state.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
})


it('blocks pending and new writable grants across nested lifecycle barriers while allowing readonly grants and finally releasing', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const hold = new Promise<void>(resolve => { release = resolve })
  const { registry, gateway } = harness({ async beginRun(grant) { if (grant.runId === 'pending') { entered(); await hold } } })
  const session = await registry.create(fixture(), 'barrier.h5lesson')
  const grant = (runId: string, writable = true) => ({ runId, actor: 'agent' as const, documents: [{ documentId: session.documentId, writable: writable ? [{ kind: 'document' as const }] : [] }] })
  const pending = gateway.beginRun(grant('pending'))
  await started
  await expect(gateway.withWriteTaskBarrier([session.documentId], async () => {
    await expect(gateway.beginRun(grant('new'))).rejects.toMatchObject({ code: 'document-write-tasks-blocked' })
    await gateway.beginRun(grant('readonly', false))
    await gateway.withWriteTaskBarrier([session.documentId], async () => {
      await expect(gateway.beginRun(grant('nested'))).rejects.toMatchObject({ code: 'document-write-tasks-blocked' })
    })
    await expect(gateway.beginRun(grant('after-inner'))).rejects.toMatchObject({ code: 'document-write-tasks-blocked' })
    throw new Error('file work failed')
  })).rejects.toThrow('file work failed')
  // A grant that crossed the barrier remains invalid even if its async initializer finishes later.
  const rejected = expect(pending).rejects.toMatchObject({ code: 'document-write-tasks-blocked' })
  release(); await rejected
  await expect(gateway.issueTarget('pending', session.documentId, { kind: 'document' })).rejects.toThrow()
  await expect(gateway.issueTarget('readonly', session.documentId, { kind: 'document' })).resolves.toMatch(/^t/)
  await gateway.beginRun(grant('after-release'))
  await expect(gateway.issueTarget('after-release', session.documentId, { kind: 'document' })).resolves.toMatch(/^t/)
  expect(session.read().undoDepth).toBe(0)
})
