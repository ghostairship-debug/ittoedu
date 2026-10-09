// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../../../../src/main/workbench/conversations/ConversationStore'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { ImageGenerationService } from '../../../../src/main/workbench/images/ImageGenerationService'
import { ImageResultsDesktopService } from '../../../../src/main/workbench/images/ImageResultsDesktopService'
import { imageProvenance } from '../../../../src/main/workbench/images/imageRoute'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { createImageData, imageDataSchema } from '../../../../src/components/image/data'
import { IMAGE_DEFINITION } from '../../../../src/components/image'
import { CourseV10DocumentBridge } from '../../../../src/renderer/documents/CourseV10DocumentBridge'
import type { DocumentHostAPI } from '../../../../src/shared/workbench/desktop'
import type { ImageModelSelection } from '../../../../src/shared/workbench/images'

it('local ready image applies to captured V10 image and surface despite neighbor selection and survives undo redo save cold reopen without generating again', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T09-image-v10-'))
  let results: ImageResultsDesktopService | undefined, bridge: CourseV10DocumentBridge | undefined
  try {
    const documents = new DocumentHostService(path.join(directory, 'documents'))
    const original = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#ff0000' } }).png().toBuffer()
    const ready = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#0000ff' } }).png().toBuffer()
    const project = createBlankCourseProjectV10('Current image target')
    const surfaceId = project.surfaces[0].id
    project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
    project.assets.original = { id: 'original', path: 'assets/original.png', mimeType: 'image/png' }
    const frame = { width: 160, height: 110, transform: [1, .2, -.1, 1, 70, 45] as [number, number, number, number, number, number] }
    const data = { ...createImageData('original', 'Teacher alt'), fit: 'cover' as const, crop: { left: .1, top: .05, right: .15, bottom: .1 }, flipX: true }
    project.instances.picture = { id: 'picture', definitionId: IMAGE_DEFINITION.id, data, frame }
    project.instances.neighbor = { id: 'neighbor', definitionId: IMAGE_DEFINITION.id, data: createImageData('original', 'Keep neighbor'), frame: { ...frame, transform: [1, 0, 0, 1, 270, 45] } }
    project.surfaces[0].childIds = ['picture', 'neighbor']
    project.surfaces.push({ id: 'insert-page', kind: 'slide', title: 'Insert here', childIds: [] })
    const initial = await documents.internalAPI.create({ kind: 'course-v10', project, resources: { assets: { original }, components: {} } }, 'images.h5lesson')
    const conversations = new ConversationStore({ directory: path.join(directory, 'conversations') })
    await conversations.registerWorkspace({ workspaceId: 'space', rootPath: directory, managed: false, authorization: 'user-selected' })
    const conversation = await conversations.createConversation({ workspaceId: 'space', conversationId: 'conversation' })
    await conversations.updateConversation({ workspaceId: 'space', conversationId: 'conversation', expectedRevision: conversation.revision,
      patch: { runIndex: { builtinRunIds: [], externalRunIds: ['local-run'], externalPortIds: [] } } })
    const runs = new ExecutionRunStore(path.join(directory, 'runs')), events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
    const selection: ImageModelSelection = { imageModel: 'local-fixture', connection: { id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
      baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture', auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
      capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } }
    let providerCalls = 0
    // A controlled provider returns a local PNG. This is software ready-result evidence, not an OAuth/provider call.
    const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { generate: async (request, references) => {
      providerCalls++
      return { status: 'completed', images: [{ bytes: ready, mimeType: 'image/png', filename: 'ready.png' }], provenance: imageProvenance(request, references) }
    } } })
    const job = await images.run({ jobId: 'ready-job', runId: 'local-run', documentId: initial.documentId, operation: 'generate', prompt: 'local fixture', selection })
    expect(job.status).toBe('ready')
    results = new ImageResultsDesktopService({ directory: path.join(directory, 'actions'), images, documents,
      execution: { conversations, runs, appendExternalEvent: async event => { await events.append(event) } }, selection: () => selection })
    const unavailable = async (): Promise<never> => { throw new Error('No fixture dialog') }
    const api: DocumentHostAPI = { ...documents.internalAPI, bootstrapCourse: async () => initial, saveWithDialog: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable,
      readAuthoringDrafts: id => documents.readAuthoringDrafts(id), writeAuthoringDrafts: (id, drafts) => documents.writeAuthoringDrafts(id, drafts), clearAuthoringDrafts: id => documents.clearAuthoringDrafts(id),
      close: async (id, discardDirty) => { await documents.operate({ type: 'close', documentId: id, discardDirty }) }, subscribe: listener => documents.subscribeEvents(listener) }
    bridge = new CourseV10DocumentBridge(); await bridge.connect(api)
    bridge.selectInstances(initial.documentId, ['picture'], surfaceId)
    const capture = { documentId: initial.documentId, epoch: initial.epoch, revision: initial.revision, label: 'Captured teacher picture',
      address: { kind: 'course-instance' as const, surfaceId, instanceId: 'picture' } }
    bridge.selectInstances(initial.documentId, ['neighbor'], surfaceId)
    const owner = { workspaceId: 'space', conversationId: 'conversation', runId: 'local-run', jobId: job.jobId, resourceId: job.resources[0].resourceId }
    const replace = { type: 'apply' as const, ...owner, actionId: randomUUID(), target: capture }
    expect(await results.operate(replace)).toMatchObject({ status: 'applied' })
    let current = await documents.internalAPI.read(initial.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    const replaced = imageDataSchema.parse(current.model.project.instances.picture.data)
    expect({ ...replaced, assetId: 'original', originalAssetId: 'original' }).toEqual(data)
    expect(current.model.project.instances.picture.frame).toEqual(frame)
    expect(current.model.project.instances.neighbor).toEqual(project.instances.neighbor)
    expect(bridge.read().selectedInstanceId).toBe('neighbor')
    expect(current.model.resources.assets[replaced.assetId]).toEqual(new Uint8Array(ready))
    const replaceRevision = current.revision
    expect(await results.operate(replace)).toMatchObject({ status: 'applied', revision: replaceRevision })
    expect((await documents.internalAPI.read(initial.documentId)).revision).toBe(replaceRevision)
    await bridge.undo(initial.documentId)
    const undone = await documents.internalAPI.read(initial.documentId)
    if (undone.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(imageDataSchema.parse(undone.model.project.instances.picture.data).assetId).toBe('original')
    await bridge.redo(initial.documentId)
    current = await documents.internalAPI.read(initial.documentId)
    const insert = { type: 'apply' as const, ...owner, actionId: randomUUID(), target: { documentId: current.documentId, epoch: current.epoch, revision: current.revision,
      label: 'Captured insert surface', address: { kind: 'course-surface' as const, surfaceId: 'insert-page' } } }
    expect(await results.operate(insert)).toMatchObject({ status: 'applied' })
    current = await documents.internalAPI.read(initial.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    const insertedIds = current.model.project.surfaces.find(surface => surface.id === 'insert-page')!.childIds
    expect(insertedIds).toHaveLength(1)
    const inserted = current.model.project.instances[insertedIds[0]], insertedData = imageDataSchema.parse(inserted.data)
    expect(inserted.frame?.width).toBeGreaterThan(0); expect(inserted.frame?.height).toBeGreaterThan(0)
    expect(current.model.resources.assets[insertedData.assetId]).toEqual(new Uint8Array(ready))
    expect(current.model.project.instances.neighbor).toEqual(project.instances.neighbor)
    const filename = path.join(directory, 'images.h5lesson'); await documents.saveToPath(current.documentId, filename)
    const cold = await new DocumentHostService(path.join(directory, 'cold')).open(filename)
    expect(cold.model).toEqual(current.model)
    expect(providerCalls).toBe(1)
  } finally {
    await results?.flush(); results?.dispose(); bridge?.dispose()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
