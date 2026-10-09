// @vitest-environment node
import { createHash } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { HostToolCoordinator, type HostToolServices } from '../../src/core/tools/HostToolServices'
import { ChatGPTImageProvider } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { ToolResult, ToolRunGrant } from '../../src/shared/workbench/tools'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve())
  })))
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const selection: ImageModelSelection = { imageModel: 'local-image-protocol', connection: {
  id: 'image-connection', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture-account',
  auth: { kind: 'oauth', credentialRef: 'fixture-reference' }, billing: { kind: 'subscription' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
} }
const result = (value: ToolResult): any => {
  if (value.kind !== 'read') throw new Error(JSON.stringify(value))
  return value.data
}
async function transport(handler: (body: any, response: ServerResponse) => void): Promise<typeof fetch> {
  const server = createServer((request, response) => { void (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    handler(JSON.parse(Buffer.concat(chunks).toString()), response)
  })().catch(() => response.destroy()) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server')
  return (url, init) => fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init)
}
function complete(response: ServerResponse, bytes: Uint8Array) {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ created: 123, data: [{ generation_id: 'local-image', b64_json: Buffer.from(bytes).toString('base64') }],
    size: '32x24', output_format: 'png' }))
}
function fixture(images: ImageGenerationService, workspaceRoot: string) {
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unexpected-document', bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No V9 document should be created') }, async save() { throw new Error('No V9 document should be saved') } } })
  const never = async (): Promise<never> => { throw new Error('Standalone image must not touch V9 authority') }
  const services: HostToolServices = { images: { selection: () => selection, run: images.start.bind(images), read: images.read.bind(images),
    stop: images.stop.bind(images), readResource: images.readResource.bind(images),
    readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) } }
  const coordinator = new HostToolCoordinator(services, registry, {
    resolveImage: never, active: never, ownsDocument: () => false,
    provideImage: never, readImage: never,
  })
  const grant: ToolRunGrant = { runId: 'run', actor: 'agent', documents: [],
    fileAccess: { permission: 'workspace', workspaceRoot } }
  return { coordinator, grant }
}

it('generates and edits a persistent workspace image without any V9 document, then rejects forged references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-standalone-images-')); roots.push(root)
  const original = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#152f54' } }).png().toBuffer()
  const edited = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#ed9832' } }).png().toBuffer()
  const bodies: any[] = []
  const fetch = await transport((body, response) => { bodies.push(body); complete(response, bodies.length === 1 ? original : edited) })
  const directory = path.join(root, 'owner'), images = new ImageGenerationService({ directory,
    provider: new ChatGPTImageProvider({ fetch, credentialResolver: async () => ({ accessToken: 'fixture-access', accountId: 'fixture-account' }) }) })
  const { coordinator, grant } = fixture(images, root)
  await coordinator.beginRun(grant)
  const createId = `tool:${createHash('sha256').update('generation').digest('hex')}`
  const submitted = result(await coordinator.invoke('run', createId, 'generation-digest', 'image.generate',
    { prompt: 'generate an independent image', output: { size: '32x24', format: 'png' } }))
  expect(submitted).toMatchObject({ job: `image-${createId}`, scope: 'workspace', status: expect.stringMatching(/preparing|running|ready/) })
  await images.wait('run', submitted.job, 5000)
  const ready = result(await coordinator.invoke('run', 'status', '', 'image.status', { job: submitted.job }))
  expect(ready).toMatchObject({ status: 'ready', resources: [{ mimeType: 'image/png', width: 32, height: 24,
    resource: expect.stringMatching(/^image-tool:[a-f0-9]{64}@image_[a-f0-9]{64}$/) }] })
  expect(Buffer.from((await coordinator.readStandaloneImage('run', ready.job, ready.resources[0].resourceId)).bytes)).toEqual(original)
  expect(result(await coordinator.invoke('run', createId, 'generation-digest', 'image.generate',
    { prompt: 'generate an independent image', output: { size: '32x24', format: 'png' } })).job).toBe(submitted.job)
  expect(bodies).toHaveLength(1)

  await expect(coordinator.invoke('run', 'tool:' + 'f'.repeat(64), 'forged', 'image.edit',
    { prompt: 'forged', references: [ready.resources[0].resourceId] })).rejects.toThrow('句柄无效')
  const editId = `tool:${createHash('sha256').update('edit').digest('hex')}`
  const editing = result(await coordinator.invoke('run', editId, 'edit-digest', 'image.edit',
    { prompt: 'edit the original', references: [ready.resources[0].resource] }))
  await images.wait('run', editing.job, 5000)
  const editReady = result(await coordinator.invoke('run', 'edit-status', '', 'image.status', { job: editing.job }))
  expect(editReady.status).toBe('ready')
  expect(Buffer.from((await coordinator.readStandaloneImage('run', editReady.job, editReady.resources[0].resourceId)).bytes)).toEqual(edited)
  expect(bodies).toHaveLength(2)
  expect(bodies[1].images[0].image_url).toBe(`data:image/png;base64,${original.toString('base64')}`)

  const reopened = new ImageGenerationService({ directory, provider: new ChatGPTImageProvider({ fetch,
    credentialResolver: async () => { throw new Error('Reopen must not call provider') } }) })
  const recovery = fixture(reopened, root)
  await recovery.coordinator.beginRun(recovery.grant)
  expect(result(await recovery.coordinator.invoke('run', 'recovered', '', 'image.status', { job: editing.job })).status).toBe('ready')
  expect(Buffer.from((await recovery.coordinator.readStandaloneImage('run', ready.job, ready.resources[0].resourceId)).bytes)).toEqual(original)
  expect(bodies).toHaveLength(2)
  const otherRun = fixture(reopened, root)
  await otherRun.coordinator.beginRun({ ...otherRun.grant, runId: 'different-run',
    fileAccess: { permission: 'workspace', workspaceRoot: path.join(root, 'another-workspace') } })
  await expect(otherRun.coordinator.readStandaloneImage('different-run', ready.job, ready.resources[0].resourceId)).rejects.toThrow('不属于')
  const readOnly = fixture(reopened, root)
  await readOnly.coordinator.beginRun({ ...readOnly.grant, fileAccess: { permission: 'read-only', workspaceRoot: root } })
  await expect(readOnly.coordinator.invoke('run', `tool:${'9'.repeat(64)}`, 'read-only', 'image.generate',
    { prompt: 'must not send' })).rejects.toThrow('只读')
  expect(bodies).toHaveLength(2)
  await recovery.coordinator.stop('run')
  await expect(recovery.coordinator.readStandaloneImage('run', ready.job, ready.resources[0].resourceId)).rejects.toThrow('停止')
})
