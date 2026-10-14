// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { IMAGE_DEFINITION, createImageData, imageDataSchema } from '../../src/components/image'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import * as imagePreparation from '../../src/main/workbench/admittedImageResource'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { ToolResult } from '../../src/shared/workbench/tools'

const evidence = path.resolve('output/repair-image-composition')
const selection: ImageModelSelection = { imageModel: 'controlled-png-no-network', connection: {
  id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture',
  auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
} }
type ImageResult = { job: string; status: string; stopped?: boolean;
  resources: { resource?: string; source: string; resourceId: string }[];
  generation?: { status: string }; application?: { status: string; code?: string; reason?: string; receipt?: { operationId: string } };
  save?: { status: string } }
function read(result: ToolResult): ImageResult {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as ImageResult
}
function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}
function content(snapshot: DocumentSnapshot) {
  const model = course(snapshot)
  return { ...model, project: { ...model.project, revision: 0 } }
}
async function record(name: string, value: unknown) {
  await fs.mkdir(evidence, { recursive: true })
  await fs.writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value, null, 2), 'utf8')
}
async function fixture(withImage = false, deferred = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'software-image-composition-'))
  const png = async (color: string, width: number, height: number) => new Uint8Array(await sharp({ create: {
    width, height, channels: 4, background: color,
  } }).png().toBuffer())
  const original = await png('#336699', 12, 8), generated = await png('#e6a02b', 32, 24)
  const project = createBlankCourseProjectV10('图片自动组合验收')
  const frame = { width: 312, height: 208, transform: [1, 0, 0, 1, 73, 91] as [number, number, number, number, number, number] }
  if (withImage) {
    project.definitions[IMAGE_DEFINITION.id] = structuredClone(IMAGE_DEFINITION)
    project.assets.original = { id: 'original', path: 'assets/original.png', filename: 'original.png', mimeType: 'image/png', width: 12, height: 8, byteLength: original.byteLength }
    project.instances.picture = { id: 'picture', definitionId: IMAGE_DEFINITION.id, name: '人工图片', frame,
      data: { ...createImageData('original', '保留的人工说明'), fit: 'cover', crop: { left: 0.1, top: 0, right: 0, bottom: 0.1 },
        flipX: true, cornerRadius: 16, filters: { brightness: 0.8, contrast: 1.2, saturation: 0.9, grayscale: 0, blur: 0 } } }
    project.instances.neighbor = { id: 'neighbor', definitionId: IMAGE_DEFINITION.id, data: createImageData('original', '邻居不可改'),
      frame: { width: 100, height: 70, transform: [1, 0, 0, 1, 550, 80] } }
    project.surfaces[0].childIds = ['picture', 'neighbor']
  }
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const initial = await documents.internalAPI.create({ kind: 'course-v10', project,
    resources: { assets: withImage ? { original } : {}, components: {} } }, 'fixture.glx')
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  const references: Uint8Array[][] = []
  const images = new ImageGenerationService({ directory: path.join(root, 'images'), provider: { async generate(request, refs) {
    calls++; references.push(refs.map(ref => Uint8Array.from(ref.bytes))); entered()
    if (deferred) await gate
    return { status: 'completed', images: [{ bytes: generated, mimeType: 'image/png', filename: 'generated.png' }], provenance: imageProvenance(request, refs) }
  } } })
  const gateway = documents.tools
  gateway.configureHostServices({ images: { selection: () => selection, run: images.run.bind(images), read: images.read.bind(images),
    stop: images.stop.bind(images), readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) } })
  await gateway.beginRun({ runId: 'author', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  const page = await gateway.issueTarget('author', initial.documentId, { kind: 'course-surface', surfaceId: project.surfaces[0].id })
  const picture = withImage ? await gateway.issueTarget('author', initial.documentId,
    { kind: 'course-instance', surfaceId: project.surfaces[0].id, instanceId: 'picture' }) : undefined
  let sequence = 0
  const call = (name: string, input: unknown, id = `call-${++sequence}`) => gateway.execute('author', id, { name, input })
  const current = () => documents.internalAPI.read(initial.documentId)
  const human = async (edits: ComponentEdit[]) => {
    const snapshot = await current()
    return documents.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      actor: 'human', operationId: `human-${++sequence}`, mutation: { type: 'command', command: captureComponentOperation(course(snapshot).project, edits) } })
  }
  const history = async (type: 'undo' | 'redo') => {
    const snapshot = await current()
    return documents.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      actor: 'human', operationId: `${type}-${++sequence}`, mutation: { type } })
  }
  const persist = async (filename: string) => {
    await fs.mkdir(evidence, { recursive: true })
    const saved = path.join(root, filename)
    await documents.internalAPI.save(initial.documentId, saved)
    const cold = await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(saved)
    await fs.copyFile(saved, path.join(evidence, filename))
    return cold
  }
  const cleanup = async () => {
    release(); await gateway.stop('author')
    const resolved = path.resolve(root), allowed = path.resolve(os.tmpdir()) + path.sep
    if (!resolved.startsWith(allowed)) throw new Error('Fixture cleanup escaped temp directory')
    await fs.rm(resolved, { recursive: true, force: true })
  }
  return { root, original, generated, project, initial, frame, documents, images, gateway, page, picture, call, current, human, history, persist,
    started, release, calls: () => calls, references, cleanup }
}

it('keeps ordinary target-bound generation as a candidate without a document or History write', async () => {
  const f = await fixture()
  try {
    const result = read(await f.call('image.generate', { target: f.page, prompt: '只生成候选' }))
    expect(result.status).toBe('ready'); expect(result.resources).toHaveLength(1)
    expect(result.application).toBeUndefined()
    const after = await f.current()
    expect(after.revision).toBe(f.initial.revision); expect(after.undoDepth).toBe(0)
    expect(after.model).toEqual(f.initial.model); expect(f.calls()).toBe(1)
    await record('candidate', { result, documentRevision: after.revision, undoDepth: after.undoDepth, providerCalls: f.calls() })
  } finally { await f.cleanup() }
})

it('automatically inserts once, replays without generation or application, and survives undo, redo, save and cold open', async () => {
  const f = await fixture()
  try {
    const input = { prompt: '生成并插入原页面', application: { mode: 'insert', target: f.page } }
    const result = read(await f.call('image.generate', input, 'insert-once'))
    expect(result).toMatchObject({ status: 'ready', generation: { status: 'ready' }, application: { status: 'applied' }, save: { status: 'not_requested' } })
    const applied = await f.current(), model = course(applied), id = model.project.surfaces[0].childIds[0]
    expect(applied.revision).toBe(f.initial.revision + 1); expect(applied.undoDepth).toBe(1)
    expect(model.project.surfaces[0].childIds).toHaveLength(1)
    const assetId = imageDataSchema.parse(model.project.instances[id].data).assetId
    expect((await sharp(model.resources.assets[assetId]).metadata())).toMatchObject({ format: 'png', width: 32, height: 24 })
    expect(read(await f.call('image.generate', input, 'insert-once')).application).toEqual(result.application)
    expect(read(await f.call('image.status', { job: result.job })).application).toEqual(result.application)
    expect((await f.current()).revision).toBe(applied.revision); expect(f.calls()).toBe(1)
    expect(await f.history('undo')).toMatchObject({ status: 'applied' })
    expect(content(await f.current())).toEqual(content(f.initial))
    expect(await f.history('redo')).toMatchObject({ status: 'applied' })
    expect(content(await f.current())).toEqual(content(applied))
    const final = await f.current()
    const cold = await f.persist('auto-insert.glx')
    expect(cold.model).toEqual(final.model)
    const decoded = await sharp(course(cold).resources.assets[assetId]).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 32, height: 24 }); expect(Array.from(decoded.data.subarray(0, 3))).toEqual([230, 160, 43])
    await record('insert', { result, appliedRevision: applied.revision, appliedUndoDepth: applied.undoDepth, finalRevision: final.revision,
      coldRevision: cold.revision, instance: model.project.instances[id], asset: model.project.assets[assetId], decoded: decoded.info, providerCalls: f.calls() })
  } finally { await f.cleanup() }
})

it('automatically applies an image edit to its original full target while preserving authored display, frame, identity and neighbor', async () => {
  const f = await fixture(true)
  try {
    const before = course(f.initial), old = before.project.instances.picture
    const result = read(await f.call('image.edit', { prompt: '只替换来源', references: [f.picture],
      application: { mode: 'replace', target: f.picture } }))
    expect(result).toMatchObject({ status: 'ready', application: { status: 'applied' }, save: { status: 'not_requested' } })
    expect(f.references).toHaveLength(1); expect(f.references[0]).toHaveLength(1)
    expect((await sharp(f.references[0][0]).metadata()).width).toBe(12)
    const after = await f.current(), model = course(after), replaced = model.project.instances.picture
    expect(after.undoDepth).toBe(1); expect(after.revision).toBe(f.initial.revision + 1)
    expect({ ...replaced, data: undefined }).toEqual({ ...old, data: undefined })
    const data = imageDataSchema.parse(replaced.data), oldData = imageDataSchema.parse(old.data)
    expect({ ...data, assetId: oldData.assetId, originalAssetId: oldData.originalAssetId }).toEqual(oldData)
    expect(data.assetId).not.toBe('original'); expect(data.originalAssetId).toBe(data.assetId)
    expect(model.project.instances.neighbor).toEqual(before.project.instances.neighbor)
    expect(model.project.surfaces[0].childIds).toEqual(['picture', 'neighbor'])
    expect(await f.history('undo')).toMatchObject({ status: 'applied' }); expect(content(await f.current())).toEqual(content(f.initial))
    expect(await f.history('redo')).toMatchObject({ status: 'applied' }); expect(content(await f.current())).toEqual(content(after))
    const final = await f.current(), cold = await f.persist('auto-replace.glx')
    expect(cold.model).toEqual(final.model)
    await record('replace', { result, beforeInstance: old, afterInstance: replaced, neighbor: model.project.instances.neighbor,
      appliedRevision: after.revision, appliedUndoDepth: after.undoDepth, coldRevision: cold.revision, providerCalls: f.calls() })
  } finally { await f.cleanup() }
})

it('retains a ready candidate when a human changes the same target during generation, without retrying or overwriting, and allows explicit fresh application', async () => {
  const f = await fixture(true, true)
  try {
    const pending = f.call('image.generate', { prompt: '替换原图片但保全人工后续改动', application: { mode: 'replace', target: f.picture } })
    await f.started
    const humanFrame = { ...f.frame, transform: [1, 0, 0, 1, 900, 440] as [number, number, number, number, number, number] }
    expect(await f.human([{ type: 'frame.set', instanceId: 'picture', frame: humanFrame }, { type: 'data.set', instanceId: 'picture', path: ['alt'], value: '生成期间人工改稿' }]))
      .toMatchObject({ status: 'applied' })
    const manual = await f.current(); f.release()
    const result = read(await pending)
    expect(result).toMatchObject({ status: 'ready', generation: { status: 'ready' }, application: { status: 'not_applied' }, save: { status: 'not_requested' } })
    expect(result.application?.reason).toBeTruthy(); expect(result.resources).toHaveLength(1)
    expect((await f.current()).model).toEqual(manual.model); expect((await f.current()).undoDepth).toBe(1)
    expect(read(await f.call('image.status', { job: result.job })).resources[0].resourceId).toBe(result.resources[0].resourceId)
    expect((await f.current()).model).toEqual(manual.model); expect(f.calls()).toBe(1)
    const fresh = await f.gateway.issueTarget('author', f.initial.documentId, { kind: 'course-instance', surfaceId: f.project.surfaces[0].id, instanceId: 'picture' })
    expect(await f.call('media.apply', { target: fresh, resource: result.resources[0].resource })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const final = await f.current(), data = imageDataSchema.parse(course(final).project.instances.picture.data)
    expect(final.undoDepth).toBe(2); expect(course(final).project.instances.picture.frame).toEqual(humanFrame)
    expect(data.alt).toBe('生成期间人工改稿'); expect(data.assetId).not.toBe('original'); expect(f.calls()).toBe(1)
    await record('manual-conflict', { result, manualRevision: manual.revision, manualInstance: course(manual).project.instances.picture,
      finalRevision: final.revision, finalUndoDepth: final.undoDepth, finalInstance: course(final).project.instances.picture, providerCalls: f.calls() })
  } finally { await f.cleanup() }
})

it('preserves the immutable late image source after Stop without restoring write authority or writing the document', async () => {
  const f = await fixture(false, true)
  try {
    const pending = f.call('image.generate', { prompt: '停止后保留晚到候选', application: { mode: 'insert', target: f.page } })
    await f.started; await f.gateway.stop('author'); f.release()
    const result = read(await pending)
    expect(result).toMatchObject({ status: 'unapplied', stopped: true, generation: { status: 'unapplied' }, application: { status: 'not_applied' }, save: { status: 'not_requested' } })
    expect(result.resources).toHaveLength(1); expect(result.resources[0].source).toContain(result.job)
    expect(result.resources[0].resource).toBe(result.resources[0].source)
    expect(await f.call('media.insert', { target: f.page, resource: result.resources[0].source })).toMatchObject({ kind: 'error', code: 'run-stopped' })
    const late = await f.images.read(result.job)
    expect(late).toMatchObject({ status: 'unapplied', stopped: true })
    const bytes = await f.images.readResource(result.resources[0].resourceId)
    expect((await sharp(bytes.bytes).metadata())).toMatchObject({ width: 32, height: 24 })
    expect((await f.current()).model).toEqual(f.initial.model); expect((await f.current()).undoDepth).toBe(0); expect(f.calls()).toBe(1)
    await record('stopped-late', { result, late, documentRevision: (await f.current()).revision, undoDepth: (await f.current()).undoDepth, providerCalls: f.calls() })
  } finally { await f.cleanup() }
})

it('another run querying the same ready image during preparation cannot apply or overwrite its author run application', async () => {
  let enterPreparation!: () => void, releasePreparation!: () => void
  const preparing = new Promise<void>(resolve => { enterPreparation = resolve })
  const held = new Promise<void>(resolve => { releasePreparation = resolve })
  const originalPrepare = imagePreparation.prepareImageResource
  let imagePreparations = 0
  const spy = vi.spyOn(imagePreparation, 'prepareImageResource').mockImplementation(async (input, createId) => {
    // Generation admission uses generated.png. Hold the original run's immutable candidate
    // admission so another run's ready-status query arrives before its automatic application.
    if (input.filename.startsWith('image_')) {
      imagePreparations++
      if (imagePreparations === 1) { enterPreparation(); await held }
    }
    return originalPrepare(input, createId)
  })
  const f = await fixture(true)
  let pending: Promise<ToolResult> | undefined
  try {
    pending = f.call('image.generate', { prompt: '原任务生成并应用，另一任务只查询', application: { mode: 'replace', target: f.picture } }, 'author-owner')
    await preparing
    const job = (await f.images.list())[0]
    expect(job.status).toBe('ready')
    expect((await f.current()).revision).toBe(f.initial.revision)
    await f.gateway.beginRun({ runId: 'readonly', actor: 'agent', documents: [{ documentId: f.initial.documentId, writable: [] }],
      fileAccess: { permission: 'read-only', workspaceRoot: f.root } })
    const readonly = await f.gateway.execute('readonly', 'observe-ready', { name: 'image.status', input: { job: job.jobId } })
    expect(readonly).toMatchObject({ kind: 'error', code: 'not-authorized' })
    // This run may use configured image tools but cannot write the original picture target.
    await f.gateway.beginRun({ runId: 'observer', actor: 'agent', documents: [{ documentId: f.initial.documentId,
      writable: [{ kind: 'course-instance', surfaceId: f.project.surfaces[0].id, instanceId: 'neighbor' }] }],
      fileAccess: { permission: 'read-only', workspaceRoot: f.root } })
    const observer = read(await f.gateway.execute('observer', 'observe-ready', { name: 'image.status', input: { job: job.jobId } }))
    expect(observer.status).toBe('ready'); expect(observer.resources).toHaveLength(1)
    expect(observer.application?.status).not.toBe('not_applied')
    expect(observer.application?.code).toBeUndefined()
    expect((await f.current()).model).toEqual(f.initial.model); expect((await f.current()).undoDepth).toBe(0)
    releasePreparation()
    const author = read(await pending)
    expect(author).toMatchObject({ status: 'ready', application: { status: 'applied' } })
    const applied = await f.current()
    expect(applied.revision).toBe(f.initial.revision + 1); expect(applied.undoDepth).toBe(1)
    expect(course(applied).project.surfaces[0].childIds).toEqual(['picture', 'neighbor'])
    expect(imageDataSchema.parse(course(applied).project.instances.picture.data).assetId).not.toBe('original')
    expect(course(applied).project.instances.neighbor).toEqual(f.project.instances.neighbor)
    expect(read(await f.call('image.status', { job: job.jobId })).application).toEqual(author.application)
    const observedComplete = read(await f.gateway.execute('observer', 'observe-complete', { name: 'image.status', input: { job: job.jobId } }))
    expect(observedComplete.application).toEqual(author.application)
    expect((await f.current()).revision).toBe(applied.revision); expect(f.calls()).toBe(1)
    await record('readonly-status-owner', { readonly, observer, author, observedComplete, imagePreparations,
      appliedRevision: applied.revision, undoDepth: applied.undoDepth, providerCalls: f.calls() })
  } finally {
    releasePreparation(); await pending
    await f.gateway.stop('readonly').catch(() => undefined)
    await f.gateway.stop('observer').catch(() => undefined)
    await f.cleanup(); spy.mockRestore()
  }
})
