// @vitest-environment node
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { ImageResultsDesktopService } from '../../src/main/workbench/images/ImageResultsDesktopService'
import { imageProvenance } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import type { ImageModelSelection, ImageGenerationRequest } from '../../src/shared/workbench/images'
import type { ImageResultView } from '../../src/shared/workbench/imageResultsDesktop'

const roots: string[] = [], services: ImageResultsDesktopService[] = []
afterEach(async () => { for (const service of services.splice(0)) { await service.flush(); service.dispose() }; for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
const selection: ImageModelSelection = { imageModel: 'fixture-image', connection: { id: 'connection', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture', auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'subscription' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } }
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-image-results-')); roots.push(root)
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const model = new CourseV9Driver().load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson')))
  const snapshot = await documents.internalAPI.create(model, 'images.h5lesson')
  const conversations = new ConversationStore({ directory: path.join(root, 'conversations') })
  await conversations.registerWorkspace({ workspaceId: 'workspace', rootPath: root, managed: false, authorization: 'user-selected' })
  const conversation = await conversations.createConversation({ workspaceId: 'workspace', conversationId: 'conversation' })
  await conversations.updateConversation({ workspaceId: 'workspace', conversationId: 'conversation', expectedRevision: conversation.revision, patch: { runIndex: { builtinRunIds: [], externalRunIds: ['external-run'], externalPortIds: [] } } })
  await conversations.createConversation({ workspaceId: 'workspace', conversationId: 'other' })
  const runs = new ExecutionRunStore(path.join(root, 'runs')), events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const original = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#abcdff' } }).png().toBuffer()
  const edited = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#cc8800' } }).png().toBuffer()
  const requests: ImageGenerationRequest[] = [], references: Uint8Array[][] = []
  let release: (() => void) | undefined, entered: (() => void) | undefined
  const images = new ImageGenerationService({ directory: path.join(root, 'images'), resolveReference: (runId, documentId, resource) => documents.tools.readImageResource(runId, documentId, resource), provider: { async generate(request, refs) {
    requests.push(request); references.push(refs.map(ref => ref.bytes))
    if (request.jobId === 'late') { entered?.(); await new Promise<void>(resolve => { release = resolve }) }
    return { status: 'completed', images: [{ bytes: request.operation === 'edit' ? edited : original, mimeType: 'image/png', filename: 'image.png' }], provenance: imageProvenance(request, refs) }
  } } })
  const options = { directory: path.join(root, 'actions'), images, documents, execution: { conversations, runs, appendExternalEvent: events.append.bind(events) }, selection: async () => ({ ...selection, imageModel: 'current-edit-model' }) }
  const service = new ImageResultsDesktopService(options); services.push(service)
  const owner = { workspaceId: 'workspace', conversationId: 'conversation', runId: 'external-run', jobId: 'original' }
  const request = (jobId: string): ImageGenerationRequest => ({ jobId, runId: owner.runId, documentId: snapshot.documentId, operation: 'generate', prompt: 'fixture', selection })
  const generated = await images.run(request('original'))
  return { root, options, service, conversations, documents, snapshot, model, images, events, original, edited, requests, references, owner, request, resourceId: generated.resources[0]!.resourceId,
    waitForLate: () => new Promise<void>(resolve => { entered = resolve }), release: () => release!() }
}

it('S14 results enforce conversation/job/resource ownership and retain real stopped-late bytes without model calls on preview', async () => {
  const h = await fixture()
  expect((await h.service.list(h.owner))[0]).toMatchObject({ source: 'external-mcp', job: { status: 'ready' }, applications: [] })
  expect(Buffer.from((await h.service.preview({ ...h.owner, resourceId: h.resourceId })).bytes)).toEqual(h.original)
  expect(h.requests).toHaveLength(1)
  await expect(h.service.read({ ...h.owner, conversationId: 'other' })).rejects.toThrow('不属于')
  await expect(h.service.preview({ ...h.owner, resourceId: 'image_' + '0'.repeat(64) })).rejects.toThrow('资源不属于')
  const entered = h.waitForLate(), promise = h.images.run(h.request('late'))
  await entered; await h.images.stop('late'); h.release(); const late = await promise
  expect(late.status).toBe('unapplied')
  const restored = new ImageResultsDesktopService(h.options); services.push(restored)
  expect(Buffer.from((await restored.preview({ ...h.owner, jobId: 'late', resourceId: late.resources[0]!.resourceId })).bytes)).toEqual(h.original)
  await h.service.flush()
  expect((await h.events.readPage({ conversationId: 'conversation', limit: 100 })).events.filter(event => event.type === 'image').every(event => event.source === 'external-mcp')).toBe(true)
  expect(h.documents.registry.get(h.snapshot.documentId).read().undoDepth).toBe(0)
  expect(h.requests).toHaveLength(2)
})

it('S14 explicit apply uses a fresh grant with one atomic History and idempotent receipt; edit keeps original and freezes current model', async () => {
  const h = await fixture()
  if (h.model.kind !== 'course-v9') throw new Error('fixture')
  const location = h.model.project.locations.find(value => value.kind === 'slide-scene')!
  const frame = { x: 812, y: 356, width: 360, height: 270 }
  const input = { type: 'apply' as const, ...h.owner, actionId: crypto.randomUUID(), resourceId: h.resourceId,
    frame,
    target: { documentId: h.snapshot.documentId, epoch: h.snapshot.epoch, revision: h.snapshot.revision, label: location.label, address: { kind: 'course-owner' as const, locationId: location.id, owner: 'scene' as const } } }
  await expect(h.service.operate({ ...input, frame: undefined })).rejects.toThrow('明确画布位置与尺寸')
  await expect(h.service.operate({ ...input, frame: { ...frame, width: 0 } })).rejects.toThrow()
  expect(h.documents.registry.get(h.snapshot.documentId).read().revision).toBe(h.snapshot.revision)
  const result = await h.service.operate(input)
  expect(result).toMatchObject({ status: 'applied' })
  expect(await h.service.operate(input)).toEqual(result)
  let current = h.documents.registry.get(h.snapshot.documentId).read()
  expect(current.undoDepth).toBe(1)
  expect(Object.values(current.model.resources.assets).some(bytes => Buffer.from(bytes).equals(h.original))).toBe(true)
  await expect(h.service.operate({ ...input, actionId: crypto.randomUUID() })).rejects.toThrow('目标文档已改变')
  await h.documents.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  current = h.documents.registry.get(h.snapshot.documentId).read(); expect(current.model.resources).toEqual(h.model.resources)
  const editing = { type: 'edit' as const, ...h.owner, actionId: crypto.randomUUID(), resourceId: h.resourceId, prompt: '明确继续修改颜色' }
  const child = await h.service.operate(editing) as ImageResultView
  expect(child.job).toMatchObject({ operation: 'edit', status: 'ready', provenance: { requestedImageModel: 'current-edit-model' } })
  expect(h.references[1]?.map(bytes => Buffer.from(bytes))).toEqual([h.original])
  expect(Buffer.from((await h.service.preview({ ...h.owner, resourceId: h.resourceId })).bytes)).toEqual(h.original)
  expect(await h.service.operate(editing)).toEqual(child)
  expect(h.requests).toHaveLength(2)
  expect(h.documents.registry.get(h.snapshot.documentId).read().revision).toBe(current.revision)
  await h.documents.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'redo' } })
  const beforeReplace = h.documents.registry.get(h.snapshot.documentId).read()
  if (beforeReplace.model.kind !== 'course-v9') throw new Error('fixture')
  const oldIds = new Set(h.model.project.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems.map(item => item.layerItemId)) : []))
  const inserted = beforeReplace.model.project.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : []).find(item => !oldIds.has(item.layerItemId))!
  expect(inserted.frame).toMatchObject({ mode: 'absolute', ...frame })
  const replace = { type: 'apply' as const, ...h.owner, jobId: child.job.jobId, runId: child.runId, actionId: crypto.randomUUID(), resourceId: child.job.resources[0]!.resourceId,
    target: { documentId: current.documentId, epoch: current.epoch, revision: beforeReplace.revision, label: '刚插入的图片', address: { kind: 'course-object' as const, locationId: location.id, itemId: inserted.layerItemId } } }
  expect(await h.service.operate(replace)).toMatchObject({ status: 'applied' })
  const replaced = h.documents.registry.get(current.documentId).read()
  expect(replaced.undoDepth).toBe(beforeReplace.undoDepth + 1)
  expect(Object.values(replaced.model.resources.assets).some(bytes => Buffer.from(bytes).equals(h.edited))).toBe(true)
  const archive = path.join(h.root, 'saved.h5lesson'); await h.documents.saveToPath(current.documentId, archive)
  const reopened = new DocumentHostService(path.join(h.root, 'reopened'))
  expect((await reopened.open(archive)).model).toEqual(replaced.model)
  await h.documents.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: replaced.revision, operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(h.documents.registry.get(current.documentId).read().model.resources).toEqual(beforeReplace.model.resources)
})

it('S14 releases deleted-conversation image cache after durable deletion while shared results and document History survive', async () => {
  const h = await fixture()
  if (h.model.kind !== 'course-v9') throw new Error('fixture')
  const location = h.model.project.locations.find(value => value.kind === 'slide-scene')!
  expect(await h.service.operate({ type: 'apply', ...h.owner, actionId: crypto.randomUUID(), resourceId: h.resourceId,
    frame: { x: 720, y: 330, width: 320, height: 240 },
    target: { documentId: h.snapshot.documentId, epoch: h.snapshot.epoch, revision: h.snapshot.revision,
      label: location.label, address: { kind: 'course-owner', locationId: location.id, owner: 'scene' } } })).toMatchObject({ status: 'applied' })
  let current = h.documents.registry.get(h.snapshot.documentId).read()
  await h.documents.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  const other = await h.conversations.readConversation({ workspaceId: 'workspace', conversationId: 'other' })
  if (!other) throw new Error('fixture')
  await h.conversations.updateConversation({ workspaceId: 'workspace', conversationId: 'other', expectedRevision: other.revision,
    patch: { runIndex: { builtinRunIds: [], externalRunIds: ['other-run'], externalPortIds: [] } } })
  const shared = await h.images.run({ ...h.request('other-job'), runId: 'other-run' })
  expect(shared.resources[0]!.resourceId).toBe(h.resourceId)

  // A prepared cleanup intent alone cannot remove a still-live conversation.
  const original = await h.conversations.readConversation(h.owner)
  if (!original) throw new Error('fixture')
  const ports = { stopBuiltinRuns: async () => {}, revokeExternalPorts: async () => {},
    prepareResourceRelease: (input: { workspaceId: string; conversationId: string; runIds: readonly string[] }) => h.service.prepareConversationDeletion(input) }
  await h.service.prepareConversationDeletion({ ...h.owner, runIds: original.runIndex.externalRunIds })
  const restarted = new ImageResultsDesktopService(h.options); services.push(restarted)
  await restarted.flush()
  expect((await h.images.read('original')).status).toBe('ready')

  await h.conversations.deleteConversation({ workspaceId: 'workspace', conversationId: 'conversation', expectedRevision: original.revision, ports })
  restarted.requestCollect(); await restarted.flush()
  await expect(h.images.read('original')).rejects.toThrow('图片任务不存在')
  await expect(h.images.run(h.request('original'))).rejects.toThrow('不能再次发送')
  expect(h.requests).toHaveLength(2)
  expect(Buffer.from((await h.images.readResource(h.resourceId)).bytes)).toEqual(h.original)
  current = h.documents.registry.get(h.snapshot.documentId).read()
  await h.documents.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'redo' } })
  current = h.documents.registry.get(h.snapshot.documentId).read()
  expect(Object.values(current.model.resources.assets).some(bytes => Buffer.from(bytes).equals(h.original))).toBe(true)
  const archive = path.join(h.root, 'retained.h5lesson'); await h.documents.saveToPath(current.documentId, archive)
  const reopened = new DocumentHostService(path.join(h.root, 'retained-reopen'))
  expect((await reopened.open(archive)).model).toEqual(current.model)

  const remaining = await h.conversations.readConversation({ workspaceId: 'workspace', conversationId: 'other' })
  if (!remaining) throw new Error('fixture')
  await h.conversations.deleteConversation({ workspaceId: 'workspace', conversationId: 'other', expectedRevision: remaining.revision, ports })
  restarted.requestCollect(); await restarted.flush()
  await expect(h.images.read('other-job')).rejects.toThrow('图片任务不存在')
  await expect(h.images.readResource(h.resourceId)).rejects.toThrow()
  const reopenedAfterGc = new DocumentHostService(path.join(h.root, 'retained-after-gc'))
  expect((await reopenedAfterGc.open(archive)).model).toEqual(current.model)
})
