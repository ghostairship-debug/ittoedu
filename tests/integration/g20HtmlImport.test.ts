// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'
import { syncFlowCourseLocations } from '../../src/core/tools/flowDocumentModel'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { HtmlImportService } from '../../src/main/workbench/htmlImport/HtmlImportService'
import { HtmlImportNetworkGrants } from '../../src/main/workbench/htmlImport/htmlImportNetworkGrants'
import { normalizeDesktopError } from '../../src/main/errors'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture(admission?: BuildAdmissionPort, existingOrders: readonly number[] = [], kind: 'slide' | 'flow' = 'slide', emptyBody = false, shape?: 'next-heading' | 'nested-heading') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-html-import-'))
  roots.push(root)
  const sourcePath = path.join(root, 'lesson.html')
  await fs.writeFile(sourcePath, '<!doctype html><button onclick="this.textContent=\'Next\'">Start</button>')
  const blank = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const project = kind === 'flow' ? addCourseFlowPage(blank, { expectedRevision: blank.revision }).project : blank
  if (emptyBody) project.surfaces.filter(surface => surface.type === 'flow').forEach(surface => { surface.blocks = surface.blocks.filter(block => block.type === 'heading') })
  if (shape) {
    const flow = project.surfaces.find(surface => surface.type === 'flow')!
    const blocks = [
      { id: 'h1', type: 'heading' as const, level: 1 as const, content: { inlines: [{ type: 'text' as const, text: 'Current' }] } },
      { id: 'h2', type: 'heading' as const, level: 1 as const, content: { inlines: [{ type: 'text' as const, text: 'Next' }] } },
      { id: 'p2', type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: 'Next body' }] } },
    ]
    flow.blocks = shape === 'nested-heading' ? [{ id: 'section', type: 'section', title: { inlines: [{ type: 'text', text: 'Chapter' }] },
      collapsedByDefault: false, blocks }] : blocks
    syncFlowCourseLocations(project, flow.id)
  }
  const firstSurface = project.surfaces[0]
  if (firstSurface?.type !== 'slide') throw new Error('fixture requires Slide')
  for (const order of existingOrders) firstSurface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createTextNode(), order))
  const driver = new CourseV9Driver()
  const journal = createDocumentJournal({ directory: path.join(root, 'journal') })
  const registry = new DocumentRegistry({ persistence: journal, drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create({ kind: 'course-v9', project, resources: { assets: {}, components: {} } }, 'lesson.h5lesson')
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const run = vi.fn<BuildAdmissionPort['run']>(async payload => ({ ok: true, message: 'fake admission', processId: 1,
    captures: payload.targets.flatMap(target => target.instanceIds.map(instanceId => ({ instanceId, locationId: target.locationId,
      width: 1, height: 1, dataUrl: `data:image/png;base64,${png.toString('base64')}` })))
      .filter((capture, index, all) => all.findIndex(item => item.instanceId === capture.instanceId) === index),
    behaviorEvidence: payload.targets.map(target => ({ version: 1, status: 'observed', mode: 'full-admission',
      projectId: payload.project.id, documentRevision: payload.project.revision, locationId: target.locationId,
      stateId: target.stateId ?? null, instanceIds: target.instanceIds, sourceIdentities: {}, actions: [],
      frames: [{ phase: 'running', elapsedMs: 0, capturedAt: 0, stateVersion: 0, publicState: {}, width: 1, height: 1,
        dataUrl: `data:image/png;base64,${png.toString('base64')}` }], elapsedMs: 0, semanticVerdict: 'requires-review' })) }))
  const builds = new ControlledBuildService({ directory: path.join(root, 'builds'), admission: admission ?? { run } })
  const grants = new HtmlImportNetworkGrants()
  const hostedBuilds = Object.assign(builds, {
    policy: (runId: string, documentId: string) => grants.policy(runId, documentId, () => registry.get(documentId).read()),
  })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { services: { builds: hostedBuilds } })
  await gateway.beginRun({ runId: 'run', actor: 'human', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const targetHandle = await gateway.issueTarget('run', session.documentId, { kind: 'document' })
  const service = new HtmlImportService({ session, gateway, networkGrants: grants })
  const request = { operationId: 'html-import-1', runId: 'run', targetHandle, sourcePath, locationId: kind === 'flow'
    ? project.locations.find(item => item.kind === 'flow-block')!.id : project.locations[0]!.id }
  return { root, sourcePath, project, session, service, request, builds, gateway, run, journal, grants }
}

describe('M17 S13 HTML import orchestration', () => {
  it('writes a real S13 scratch, checks an artifact and imports one canonical History entry', async () => {
    const f = await fixture()
    const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')
    await fs.writeFile(f.sourcePath, `<img src="data:image/gif;base64,${gif.toString('base64')}">`)
    const ticket = await f.service.prepare(f.request)
    expect(f.session.read().revision).toBe(0)
    expect(await fs.readFile(path.join(f.root, 'builds', ticket.jobId, 'files', 'project.json'), 'utf8')).toContain(ticket.instanceId)
    await f.service.admit(ticket)
    expect(f.run).toHaveBeenCalledOnce()
    expect(f.session.read().undoDepth).toBe(0)
    const receipt = await f.service.commit(ticket)
    expect(receipt.status).toBe('applied')
    expect(await f.service.commit(ticket)).toEqual(receipt)
    const model = f.session.read().model
    if (model.kind !== 'course-v9') throw new Error('wrong model')
    const slide = model.project.surfaces[0]
    if (slide?.type !== 'slide') throw new Error('wrong surface')
    const item = slide.scenes[0]!.layerItems[0]
    if (item?.kind !== 'runtime') throw new Error('wrong carrier')
    const key = Object.keys(item.runtime.assets)[0]!
    expect(unpackHtmlDocumentRuntimeSource(item.runtime.source)?.html).toContain(`cw-resource:${key}`)
    expect(model.resources.assets[item.runtime.assets[key]!.assetId]).toEqual(new Uint8Array(gif))
    expect(f.session.read().undoDepth).toBe(1)
    const now = f.session.read()
    await f.session.execute({ documentId: now.documentId, epoch: now.epoch, baseRevision: now.revision, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })
    expect(f.session.read().model.resources.assets[item.runtime.assets[key]!.assetId]).toBeUndefined()
  })

  it('allocates above sparse scene orders without colliding with an existing layer', async () => {
    const f = await fixture(undefined, [0, 5])
    const ticket = await f.service.prepare(f.request)
    await f.service.admit(ticket)
    expect((await f.service.commit(ticket)).status).toBe('applied')
    const model = f.session.read().model
    if (model.kind !== 'course-v9') throw new Error('wrong model')
    const surface = model.project.surfaces[0]
    if (surface?.type !== 'slide') throw new Error('wrong surface')
    expect(surface.scenes[0]!.layerItems.map(item => item.order)).toEqual([0, 5, 6])
  })

  it('places an admitted Flow Runtime on paper at the selected paragraph and restores it with Redo', async () => {
    const f = await fixture(undefined, [], 'flow')
    const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')
    await fs.writeFile(f.sourcePath, `<img src="data:image/gif;base64,${gif.toString('base64')}">`)
    const flowLocation = f.project.locations.find(item => item.kind === 'flow-block')!
    const ticket = await f.service.prepare({ ...f.request, anchorBlockId: flowLocation.blockId })
    expect(ticket.target.anchorBlockId).toBe(flowLocation.blockId)
    expect(ticket.target.surfaceId).toBe(flowLocation.surfaceId)
    await f.service.admit(ticket)
    expect((await f.service.commit(ticket)).status).toBe('applied')
    const committed = f.session.read()
    if (committed.model.kind !== 'course-v9') throw new Error('wrong model')
    const flow = committed.model.project.surfaces.find(item => item.type === 'flow')!
    expect(flow.surfaceLayerItems).toHaveLength(1)
    const entry = flow.surfaceLayerItems[0]!
    expect(entry.item).toMatchObject({ kind: 'runtime', paperSpace: 'paper' })
    expect(entry.paragraphAnchor).toEqual({ blockId: flowLocation.blockId, offsetY: 0, xRatio: 0 })
    expect(entry.visibility).toEqual({ mode: 'all', locationIds: [] })
    if (entry.item.kind !== 'runtime') throw new Error('wrong carrier')
    const assetId = Object.values(entry.item.runtime.assets)[0]!.assetId
    expect(committed.model.resources.assets[assetId]).toEqual(new Uint8Array(gif))
    await f.session.execute({ documentId: committed.documentId, epoch: committed.epoch, baseRevision: committed.revision,
      operationId: 'flow-undo', actor: 'human', mutation: { type: 'undo' } })
    const undone = f.session.read()
    if (undone.model.kind !== 'course-v9') throw new Error('wrong model')
    expect(undone.model.project.surfaces.find(item => item.type === 'flow')!.surfaceLayerItems).toHaveLength(0)
    expect(undone.model.resources.assets[assetId]).toBeUndefined()
    await f.session.execute({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision,
      operationId: 'flow-redo', actor: 'human', mutation: { type: 'redo' } })
    const redone = f.session.read()
    if (redone.model.kind !== 'course-v9') throw new Error('wrong model')
    expect(redone.model.project.surfaces.find(item => item.type === 'flow')!.surfaceLayerItems[0]).toEqual(entry)
    expect(redone.model.resources.assets[assetId]).toEqual(new Uint8Array(gif))
  })

  it('creates the formal empty Flow paragraph inside the candidate when its body is empty', async () => {
    const f = await fixture(undefined, [], 'flow', true)
    const ticket = await f.service.prepare(f.request)
    expect(f.session.read().revision).toBe(f.project.revision)
    const before = f.session.read().model
    if (before.kind !== 'course-v9') throw new Error('wrong model')
    expect(before.project.surfaces.find(item => item.type === 'flow')!.blocks).toHaveLength(1)
    await f.service.admit(ticket)
    expect((await f.service.commit(ticket)).status).toBe('applied')
    const after = f.session.read().model
    if (after.kind !== 'course-v9') throw new Error('wrong model')
    const flow = after.project.surfaces.find(item => item.type === 'flow')!
    expect(flow.blocks).toHaveLength(2)
    expect(flow.blocks[1]).toMatchObject({ type: 'paragraph', id: ticket.target.anchorBlockId, content: { inlines: [] } })
    expect(flow.surfaceLayerItems[0]?.paragraphAnchor?.blockId).toBe(ticket.target.anchorBlockId)
  })

  it.each(['next-heading', 'nested-heading'] as const)('inserts an empty paragraph in the selected %s scope before the next heading', async shape => {
    const f = await fixture(undefined, [], 'flow', false, shape)
    const current = f.project.locations.find(item => item.kind === 'flow-block' && item.blockId === 'h1')!
    const ticket = await f.service.prepare({ ...f.request, locationId: current.id })
    await f.service.admit(ticket)
    expect((await f.service.commit(ticket)).status).toBe('applied')
    const model = f.session.read().model
    if (model.kind !== 'course-v9') throw new Error('wrong model')
    const flow = model.project.surfaces.find(item => item.type === 'flow')!
    const scoped = shape === 'nested-heading' ? flow.blocks[0]!.type === 'section' ? flow.blocks[0]!.blocks : [] : flow.blocks
    expect(scoped.map(block => block.id)).toEqual(['h1', ticket.target.anchorBlockId, 'h2', 'p2'])
    expect(scoped[1]).toMatchObject({ type: 'paragraph', content: { inlines: [] } })
    expect(flow.surfaceLayerItems[0]?.paragraphAnchor?.blockId).toBe(ticket.target.anchorBlockId)
  })

  it('binds the Flow anchor to the ticket and rejects replacement or unknown paragraphs before scratch', async () => {
    const f = await fixture(undefined, [], 'flow')
    const location = f.project.locations.find(item => item.kind === 'flow-block')!
    const ticket = await f.service.prepare({ ...f.request, anchorBlockId: location.blockId })
    await expect(f.service.prepare({ ...f.request, anchorBlockId: 'other' })).rejects.toThrow('不能改变')
    await expect(f.service.admit({ ...ticket, target: { ...ticket.target, anchorBlockId: 'other' } })).rejects.toThrow('票据无效')
    await f.service.cancel(ticket)
    const bad = await fixture(undefined, [], 'flow')
    await expect(bad.service.prepare({ ...bad.request, anchorBlockId: 'missing' })).rejects.toThrow('挂靠段落不存在')
    expect(bad.run).not.toHaveBeenCalled()
  })

  it('freezes runId so stopRun rejects a ready artifact without a formal write', async () => {
    const f = await fixture()
    const ticket = await f.service.prepare(f.request)
    await f.service.admit(ticket)
    await f.session.stopRun('run')
    const result = await f.service.commit(ticket)
    expect(result.status).toBe('cancelled')
    expect(f.session.read().revision).toBe(0)
    expect(f.session.read().undoDepth).toBe(0)
  })

  it('lets lexical namespace strings pass, but rejects real remote sinks before build.create', async () => {
    const f = await fixture()
    await fs.writeFile(f.sourcePath, '<script>const xmlns="http://www.w3.org/2000/svg"; const docs="https://react.dev";</script>')
    const ticket = await f.service.prepare(f.request)
    expect(ticket.jobId).toBeTruthy()
    await f.service.cancel(ticket)
    const bad = await fixture()
    await fs.writeFile(bad.sourcePath, '<script src="https://example.org/lesson.js"></script>')
    await expect(bad.service.prepare(bad.request)).rejects.toThrow('远程')
    const network = await fixture()
    await fs.writeFile(network.sourcePath, '<script>fetch("https://example.org/a.json")</script>')
    await expect(network.service.prepare(network.request)).rejects.toThrow('网络')
    expect(network.run).not.toHaveBeenCalled()
  })

  it('projects a rejected remote script through desktop IPC without writing the document', async () => {
    const f = await fixture()
    const urls = ['https://example.org/lesson.js', 'https://example.org/photo.png', 'https://example.org/audio.mp3']
    await fs.writeFile(f.sourcePath, `<script src="${urls[0]}"></script><img src="${urls[1]}"><audio src="${urls[2]}"></audio>`)
    const before = f.session.read()
    const execute = vi.spyOn(f.gateway, 'execute')
    const fallback = { code: 'HTML_IMPORT_FAILED', title: 'HTML 导入失败', message: '导入未完成。', suggestion: '请重试。' }
    let failure: unknown
    try { await f.service.prepare(f.request) } catch (error) { failure = error }
    expect(failure).toBeDefined()
    const shown = normalizeDesktopError(failure, fallback)
    expect(shown.title).toBe('HTML 导入失败')
    expect(shown.message).toContain(urls[0]!)
    expect(shown.message).not.toContain(urls[1]!)
    expect(shown.message).not.toContain(urls[2]!)
    expect(shown.suggestion).toContain('修正')
    expect(shown.message).not.toBe(fallback.message)
    expect(execute).not.toHaveBeenCalled()
    expect(f.session.read().revision).toBe(before.revision)
    expect(f.session.read().undoDepth).toBe(before.undoDepth)
    expect(f.session.read().model).toEqual(before.model)
  })

  it('imports HTTPS media with an exact origin, a visible notice and one undoable document write', async () => {
    const f = await fixture()
    const imageUrl = 'https://cdn.example.org/photo.png'
    const audioUrl = 'https://cdn.example.org/lesson.mp3'
    await fs.writeFile(f.sourcePath, `<img src="${imageUrl}"><audio controls src="${audioUrl}"></audio>`)
    const ticket = await f.service.prepare(f.request)
    expect(f.service.notices(ticket).join('\n')).toContain('离线时可能无法使用')
    const scratch = JSON.parse(await fs.readFile(path.join(f.root, 'builds', ticket.jobId, 'files', 'project.json'), 'utf8'))
    expect(scratch.network.connectOrigins).toEqual(['https://cdn.example.org'])
    await f.service.admit(ticket)
    expect((await f.service.commit(ticket)).status).toBe('applied')
    const committed = f.session.read()
    if (committed.model.kind !== 'course-v9') throw new Error('wrong model')
    expect(committed.model.project.network?.connectOrigins).toEqual(['https://cdn.example.org'])
    const item = committed.model.project.surfaces[0]
    if (item?.type !== 'slide' || item.scenes[0]?.layerItems[0]?.kind !== 'runtime') throw new Error('wrong imported carrier')
    const html = unpackHtmlDocumentRuntimeSource(item.scenes[0].layerItems[0].runtime.source)?.html ?? ''
    expect(html).toContain(imageUrl)
    expect(html).toContain(audioUrl)
    expect(committed.undoDepth).toBe(1)
    expect(f.grants.policy('run', committed.documentId, () => committed)).toBeUndefined()
    await f.session.execute({ documentId: committed.documentId, epoch: committed.epoch, baseRevision: committed.revision,
      operationId: 'undo-remote-media', actor: 'human', mutation: { type: 'undo' } })
    const undone = f.session.read()
    if (undone.model.kind !== 'course-v9') throw new Error('wrong model')
    expect(undone.model.project.network?.connectOrigins ?? []).toEqual([])
  })

  it('cancels an in-flight S13 check and keeps late results outside the document', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const f = await fixture({ run: async () => { await gate; return { ok: true, message: 'late', processId: 1 } } })
    const ticket = await f.service.prepare(f.request)
    const checking = f.service.admit(ticket)
    const rejected = expect(checking).rejects.toThrow()
    await f.service.cancel(ticket)
    release!()
    await rejected
    expect(f.session.read().revision).toBe(0)
  })
})
