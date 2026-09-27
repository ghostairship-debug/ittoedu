// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import type { DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'
import { HtmlImportService } from '../../src/main/workbench/htmlImport/HtmlImportService'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function fixture(admission?: BuildAdmissionPort) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-html-import-'))
  roots.push(root)
  const sourcePath = path.join(root, 'lesson.html')
  await fs.writeFile(sourcePath, '<!doctype html><style>body{color:red}</style><button onclick="this.textContent=\'Next\'">Start</button>')
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const states: DurableDocumentState[] = []
  const persistence: DocumentPersistence = {
    append: async state => { states.push(structuredClone(state)) },
    save: async () => { throw new Error('not used') },
  }
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: { kind: 'course-v9', project,
    resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: 'Lesson' } }, createCourseV9Driver(), persistence)
  const fallback = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const run = vi.fn<BuildAdmissionPort['run']>(async payload => ({ ok: true, message: 'observed', processId: 1,
    captures: [{ instanceId: payload.targets[0]!.instanceIds[0]!, locationId: payload.targets[0]!.locationId,
      width: 1, height: 1, dataUrl: `data:image/png;base64,${fallback.toString('base64')}` }],
    behaviorEvidence: [{ version: 1, status: 'observed', mode: 'full-admission', projectId: project.id, documentRevision: 0,
      locationId: project.locations[0]!.id, stateId: null, instanceIds: payload.targets[0]!.instanceIds, sourceIdentities: {}, actions: [],
      frames: [{ phase: 'running', elapsedMs: 0, capturedAt: 0, stateVersion: 0, publicState: {}, width: 1, height: 1,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }], elapsedMs: 0, semanticVerdict: 'requires-review' }] }))
  const service = new HtmlImportService({ session, admission: admission ?? { run } })
  const request = { operationId: 'html-import-1', sourcePath, locationId: project.locations[0]!.id }
  return { root, sourcePath, project, session, service, request, states, run }
}

describe('M17 HTML import orchestration', () => {
  it('prepares and admits without writes, then commits one canonical history entry', async () => {
    const f = await fixture()
    const ticket = await f.service.prepare(f.request)
    expect(f.session.read().revision).toBe(0)
    expect(f.states).toHaveLength(1)
    await f.service.admit(ticket)
    expect(f.session.read().revision).toBe(0)
    expect(f.run).toHaveBeenCalledOnce()
    const receipt = await f.service.commit(ticket)
    expect(receipt.status).toBe('applied')
    expect(await f.service.commit(ticket)).toEqual(receipt)
    const snapshot = f.session.read()
    expect(snapshot.revision).toBe(1)
    expect(snapshot.undoDepth).toBe(1)
    if (snapshot.model.kind !== 'course-v9') throw new Error('wrong model')
    const slide = snapshot.model.project.surfaces[0]
    if (slide?.type !== 'slide') throw new Error('wrong surface')
    const item = slide.scenes[0]!.layerItems[0]
    expect(item?.kind).toBe('runtime')
    if (item?.kind !== 'runtime') throw new Error('wrong carrier')
    expect(unpackHtmlDocumentRuntimeSource(item.runtime.source)?.html).toContain('onclick=')
    expect(f.states).toHaveLength(2)
  })

  it('keeps cancellation, admission failure and stale destination out of formal history', async () => {
    const cancelled = await fixture()
    const ticket = await cancelled.service.prepare(cancelled.request)
    cancelled.service.cancel(ticket)
    await expect(cancelled.service.admit(ticket)).rejects.toThrow()
    await expect(cancelled.service.commit(ticket)).rejects.toThrow()
    expect(cancelled.session.read().undoDepth).toBe(0)

    const failing = await fixture({ run: async () => ({ ok: false, message: 'smoke failed' }) })
    const failedTicket = await failing.service.prepare(failing.request)
    await expect(failing.service.admit(failedTicket)).rejects.toThrow('smoke failed')
    expect(failing.session.read().revision).toBe(0)

    const stale = await fixture()
    const staleTicket = await stale.service.prepare(stale.request)
    await stale.service.admit(staleTicket)
    const changed = structuredClone(stale.project); changed.title = 'Changed first'
    await stale.session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: 0, operationId: 'other', actor: 'human',
      mutation: { type: 'command', command: { type: 'course.replace', project: changed } } })
    await expect(stale.service.commit(staleTicket)).rejects.toThrow('已改变')
    expect(stale.session.read().undoDepth).toBe(1)
  })

  it('rejects remote references and mismatched replay payloads before admission', async () => {
    const f = await fixture()
    await fs.writeFile(f.sourcePath, '<img src="https://example.org/p.png">')
    await expect(f.service.prepare(f.request)).rejects.toThrow('远程资源')
    expect(f.run).not.toHaveBeenCalled()
    await fs.writeFile(f.sourcePath, '<p>local</p>')
    const ticket = await f.service.prepare(f.request)
    await expect(f.service.prepare({ ...f.request, sourcePath: path.join(f.root, 'other.html') })).rejects.toThrow('票据')
    expect(ticket.target.baseRevision).toBe(0)
  })

  it('binds extracted binary resources by content key in the candidate and committed project', async () => {
    const f = await fixture()
    const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')
    await fs.writeFile(f.sourcePath, `<img src="data:image/gif;base64,${gif.toString('base64')}">`)
    const ticket = await f.service.prepare(f.request)
    await f.service.admit(ticket)
    expect((await f.service.commit(ticket)).status).toBe('applied')
    const model = f.session.read().model
    if (model.kind !== 'course-v9') throw new Error('wrong model')
    const slide = model.project.surfaces[0]
    if (slide?.type !== 'slide') throw new Error('wrong surface')
    const item = slide.scenes[0]!.layerItems[0]
    if (item?.kind !== 'runtime') throw new Error('wrong carrier')
    const key = Object.keys(item.runtime.assets)[0]!
    expect(unpackHtmlDocumentRuntimeSource(item.runtime.source)?.html).toContain(`cw-resource:${key}`)
    const assetId = item.runtime.assets[key]!.assetId
    expect(model.resources.assets[assetId]).toEqual(new Uint8Array(gif))
    expect(model.project.assets[assetId]?.kind).toBe('image')
  })

  it('deduplicates concurrent preparation and discards a late admission result after cancellation', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const f = await fixture({ run: async () => { await gate; return { ok: true, message: 'late', processId: 1,
      behaviorEvidence: [{ version: 1, status: 'observed', mode: 'full-admission', projectId: 'p', documentRevision: 0,
        locationId: 'l', stateId: null, instanceIds: ['i'], sourceIdentities: {}, actions: [], frames: [], elapsedMs: 0,
        semanticVerdict: 'requires-review' }] } } })
    const [first, second] = await Promise.all([f.service.prepare(f.request), f.service.prepare(f.request)])
    expect(first).toEqual(second)
    const admitting = f.service.admit(first)
    f.service.cancel(first)
    release!()
    await expect(admitting).rejects.toThrow()
    expect(f.session.read().revision).toBe(0)
    expect(f.states).toHaveLength(1)
  })
})
