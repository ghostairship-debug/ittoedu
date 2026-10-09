// @vitest-environment node
import { createServer, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { createCourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { DocumentModel, DurableDocumentState } from '../../src/shared/workbench/document'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { ChatGPTImageProvider } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const directory of roots.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-host-tools-')); roots.push(root); return root }
const driver = createCourseV10Driver()
const fixture = (): Extract<DocumentModel, { kind: 'course-v10' }> => ({ kind: 'course-v10', project: createBlankCourseProjectV10('图片授权'), resources: { assets: {}, components: {} } })
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
  const owner = await gateway.issueTarget('run', session.documentId, { kind: 'course-surface', surfaceId: baseline.project.surfaces[0].id })
  const applied = await gateway.execute('run', 'insert', { name: 'media.insert', input: { target: owner, resource: result.resources[0].resource } })
  expect(applied).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = session.read(); expect(after.undoDepth).toBe(1); expect(await driver.load(await driver.serialize(after.model))).toEqual(after.model)
  expect((await Promise.all(Object.values(after.model.resources.assets))).some(bytes => Buffer.from(bytes).equals(edited))).toBe(true)
  await session.execute({ documentId: session.documentId, epoch: after.epoch, operationId: 'undo-image', actor: 'human', baseRevision: after.revision, mutation: { type: 'undo' } })
  expect(session.read().model.resources).toEqual(baseline.resources)
})

it('prepares one image after acknowledged professional inserts while preserving owner authority', async () => {
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
  const ownerTarget = { kind: 'course-surface' as const, surfaceId: baseline.project.surfaces[0].id }
  const owner = await gateway.issueTarget('run', session.documentId, ownerTarget)
  const first = await gateway.execute('run', 'native-first', { name: 'object.insert', input: { target: owner, kind: 'text', text: '先写文字', x: 600, y: 500, width: 250, height: 70 } })
  expect(first).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await gateway.execute('run', 'native-second', { name: 'object.insert', input: { target: owner, kind: 'text', text: '同一任务继续插入' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const generated = data(await gateway.execute('run', 'image-after-text', { name: 'image.generate',
    input: { target: owner, prompt: 'existing owner, fresh image', output: { size: '32x24', format: 'png' } } }))
  expect(generated).toMatchObject({ status: 'ready', resources: [{ width: 32, height: 24 }] })
  expect(requests).toBe(1)
  expect(session.read().undoDepth).toBe(2)
  const readonly = await gateway.issueTarget('run', session.documentId, ownerTarget, { readOnly: true })
  expect(await gateway.execute('run', 'image-readonly', { name: 'image.generate',
    input: { target: readonly, prompt: 'must not send' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(requests).toBe(1)
})

it('suppresses a stopped late HTTP image result without resending or writing author content', async () => {
  let entered!: () => void, release!: () => void, requests = 0
  const started = new Promise<void>(resolve => { entered = resolve })
  const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const transport = await http(async (_body, response) => { requests++; entered(); await new Promise<void>(resolve => { release = resolve }); complete(response, png) })
  const images = new ImageGenerationService({ directory: await directory(), provider: new ChatGPTImageProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'fixture-access', accountId: 'fixture-account' }) }) })
  const f = harness({ images: { selection: () => selection, run: images.run.bind(images), read: images.read.bind(images), stop: images.stop.bind(images), readResource: images.readResource.bind(images) } })
  const baseline = fixture(), imageSession = await f.registry.create(baseline, 'stopped-images.h5lesson'), imageTarget = await begin(f.gateway, imageSession.documentId)
  const call = { name: 'image.generate', input: { target: imageTarget, prompt: 'delayed' } }, running = f.gateway.execute('run', 'generate', call)
  await started; await f.gateway.stop('run'); release()
  expect(await running).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(await f.gateway.execute('run', 'generate', call)).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(requests).toBe(1); expect(imageSession.read().model).toEqual(baseline)
  expect((await images.read(`image-${f.gateway.operationIdentity('run', 'generate')}`)).stopped).toBe(true)
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
