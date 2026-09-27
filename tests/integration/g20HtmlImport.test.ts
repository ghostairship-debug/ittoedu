// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { HtmlImportService } from '../../src/main/workbench/htmlImport/HtmlImportService'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture(admission?: BuildAdmissionPort) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-html-import-'))
  roots.push(root)
  const sourcePath = path.join(root, 'lesson.html')
  await fs.writeFile(sourcePath, '<!doctype html><button onclick="this.textContent=\'Next\'">Start</button>')
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const driver = new CourseV9Driver()
  const journal = createDocumentJournal({ directory: path.join(root, 'journal') })
  const registry = new DocumentRegistry({ persistence: journal, drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create({ kind: 'course-v9', project, resources: { assets: {}, components: {} } }, 'lesson.h5lesson')
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const run = vi.fn<BuildAdmissionPort['run']>(async payload => ({ ok: true, message: 'fake admission', processId: 1,
    captures: payload.targets.flatMap(target => target.instanceIds.map(instanceId => ({ instanceId, locationId: target.locationId,
      width: 1, height: 1, dataUrl: `data:image/png;base64,${png.toString('base64')}` }))),
    behaviorEvidence: payload.targets.map(target => ({ version: 1, status: 'observed', mode: 'full-admission',
      projectId: payload.project.id, documentRevision: payload.project.revision, locationId: target.locationId,
      stateId: target.stateId ?? null, instanceIds: target.instanceIds, sourceIdentities: {}, actions: [],
      frames: [{ phase: 'running', elapsedMs: 0, capturedAt: 0, stateVersion: 0, publicState: {}, width: 1, height: 1,
        dataUrl: `data:image/png;base64,${png.toString('base64')}` }], elapsedMs: 0, semanticVerdict: 'requires-review' })) }))
  const builds = new ControlledBuildService({ directory: path.join(root, 'builds'), admission: admission ?? { run } })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { services: { builds } })
  await gateway.beginRun({ runId: 'run', actor: 'human', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const targetHandle = await gateway.issueTarget('run', session.documentId, { kind: 'document' })
  const service = new HtmlImportService({ session, gateway })
  const request = { operationId: 'html-import-1', runId: 'run', targetHandle, sourcePath, locationId: project.locations[0]!.id }
  return { root, sourcePath, project, session, service, request, builds, gateway, run, journal }
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
    await fs.writeFile(bad.sourcePath, '<img src="https://example.org/a.png">')
    await expect(bad.service.prepare(bad.request)).rejects.toThrow('远程')
    const network = await fixture()
    await fs.writeFile(network.sourcePath, '<script>fetch("https://example.org/a.json")</script>')
    await expect(network.service.prepare(network.request)).rejects.toThrow('网络')
    expect(network.run).not.toHaveBeenCalled()
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
