// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { documentHostAPI } from '../helpers/documentHostAPI'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentProjection } from '../../src/renderer/documents/DocumentProjection'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { captureComponentSourceSession } from '../../src/renderer/components/ComponentSourceEditor'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'

const roots: string[] = [], views: Array<{ dispose(): void }> = []
afterEach(async () => {
  for (const view of views.splice(0)) view.dispose()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture(source = 'A\nB\nC', name = 'notes.md') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-all-save-')); roots.push(root)
  const filename = path.join(root, name); await fs.writeFile(filename, source)
  const journal = path.join(root, 'journal'), { host, documents } = createMarkdownTestHost(journal)
  const port = { ...createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {}, documents }), documents }
  const session = new DocumentFileSession({ kind: 'file', path: filename }, port); views.push(session); await session.open()
  return { root, filename, journal, host, documents, port, session }
}
async function observe(f: Awaited<ReturnType<typeof fixture>>) {
  const observation = await f.documents.observeFile(f.session.documentId!)
  await (f.session as any).observe(observation)
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

describe('Audit save owners', () => {
  it('CA183 own publication before ACK remains clean', async () => {
    const f = await fixture(); f.session.edit('A saved\nB\nC'); await f.session.drain()
    const journal = (f.host as any).journal, save = journal.save.bind(journal), entered = deferred(), release = deferred()
    vi.spyOn(journal, 'save').mockImplementation(async input => { const result = await save(input); entered.resolve(); await release.promise; return result })
    const saving = f.session.flush(); await entered.promise
    await observe(f)
    expect(f.session.getSnapshot().conflict).toBeNull()
    release.resolve(); expect(await saving).toBe(true)
    expect(f.session.getSnapshot().dirty).toBe(false)
  })

  it('CA295 scanning another save does not append beyond the live writer', async () => {
    const f = await fixture(); f.session.edit('A saved\nB\nC'); await f.session.drain()
    const otherPath = path.join(f.root, 'other.txt'); await fs.writeFile(otherPath, 'other')
    const other = await f.documents.open(otherPath)
    const journal = (f.host as any).journal, save = journal.save.bind(journal), entered = deferred(), release = deferred()
    vi.spyOn(journal, 'save').mockImplementation(async input => {
      const result = await save(input)
      if ((input as any).documentId === f.session.documentId) { entered.resolve(); await release.promise }
      return result
    })
    const saving = f.session.flush(); await entered.promise
    await f.documents.save(other.documentId)
    f.session.edit('A saved\nB teacher\nC'); expect(await f.session.drain()).toBe(true)
    release.resolve(); expect(await saving).toBe(true)
    expect(f.session.getSnapshot().source).toContain('B teacher')
    expect(f.session.getSnapshot().error).toBeNull()
  })

  it('CA353 ends IME with non-overlapping disk edits reconciled', async () => {
    const f = await fixture(); f.session.setComposing(true); f.session.edit('A teacher\nB\nC')
    await fs.writeFile(f.filename, 'A\nB\nC external'); await observe(f)
    expect(f.session.getSnapshot().conflict).toBeNull()
    f.session.setComposing(false); expect(await f.session.drain()).toBe(true)
    expect(f.session.getSnapshot()).toMatchObject({ source: 'A teacher\nB\nC external', conflict: null })
    expect(await f.session.flush()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe('A teacher\nB\nC external')
  })

  it('CA172 cold recovery retains the real saved baseline', async () => {
    const f = await fixture(); f.session.edit('A teacher\nB\nC'); await f.session.drain(); f.session.dispose()
    await fs.writeFile(f.filename, 'A\nB\nC external')
    const restarted = createMarkdownTestHost(f.journal), port = { ...f.port, documents: restarted.documents }
    const view = new DocumentFileSession({ kind: 'file', path: f.filename }, port); views.push(view); await view.open()
    expect(view.getSnapshot().conflictHunks).toHaveLength(0)
    expect(view.getSnapshot().source).toBe('A teacher\nB\nC external')
    expect(await view.flush()).toBe(true)
  })

  it('CA329 accepted partial choices and unapplied manual text survive cold recovery', async () => {
    const f = await fixture('A\nkeep1\nB\nkeep2\nC')
    f.session.edit('A local\nkeep1\nB\nkeep2\nC local'); await f.session.drain()
    await fs.writeFile(f.filename, 'A remote\nkeep1\nB\nkeep2\nC remote'); await observe(f)
    expect(f.session.getSnapshot().conflictHunks).toHaveLength(2)
    const [first, second] = f.session.getSnapshot().conflictHunks
    f.session.setConflictDraft(second!.id, 'C handtyped and unapplied')
    await f.session.resolveConflictHunk(first!.id, 'local', 'A accepted')
    expect(f.session.committedDocument!.model).toMatchObject({ source: expect.stringContaining('A accepted') })
    await fs.writeFile(f.filename, 'whole new disk'); await observe(f)
    expect(f.session.getSnapshot().conflictDrafts[second!.id]).toContain('handtyped')
    f.session.dispose()
    const restarted = createMarkdownTestHost(f.journal)
    const view = new DocumentFileSession({ kind: 'file', path: f.filename }, { ...f.port, documents: restarted.documents }); views.push(view); await view.open()
    expect(view.committedDocument!.model).toMatchObject({ source: expect.stringContaining('A accepted') })
    expect(Object.values(view.getSnapshot().conflictDrafts)).toContain('C handtyped and unapplied')
    expect(view.committedDocument!.model).not.toMatchObject({ source: expect.stringContaining('handtyped') })
  })

  it('CA065 newly referenced local image previews, saves elsewhere and cold opens', async () => {
    const f = await fixture('body'); await fs.mkdir(path.join(f.root, 'images')); await fs.writeFile(path.join(f.root, 'images', 'new.png'), new Uint8Array([2, 3]))
    f.session.edit('body\n\n![new](images/new.png)'); await f.session.drain()
    expect((await f.session.readResource('images/new.png')).bytes).toEqual(new Uint8Array([2, 3]))
    const directory = path.join(f.root, 'copy'); await fs.mkdir(directory); const target = path.join(directory, 'notes.md')
    const saved = await f.documents.save(f.session.documentId!, target)
    expect(saved.dirty).toBe(false); expect(await fs.readFile(path.join(directory, 'images', 'new.png'))).toEqual(Buffer.from([2, 3]))
    const cold = new DocumentHostService(path.join(f.root, 'cold')); const opened = await cold.open(target)
    expect(opened.model).toMatchObject({ source: expect.stringContaining('images/new.png') })
    expect(opened.model.resources.assets['images/new.png']).toEqual(new Uint8Array([2, 3]))
  })

  it('CA065 removed references do not publish or conflict on retained History resources', async () => {
    const f = await fixture('![old](old.png)'); await fs.writeFile(path.join(f.root, 'old.png'), Buffer.from([1]))
    // Reopen with the resource actually present.
    const current = await f.documents.read(f.session.documentId!), observation = await f.documents.observeFile(current.documentId)
    await f.documents.reconcileFile({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, bindingVersion: observation.bindingVersion, version: observation.version, choice: 'disk' })
    f.session.edit('text only'); await f.session.drain()
    const directory = path.join(f.root, 'copy'); await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'old.png'), Buffer.from([9]))
    const saved = await f.documents.save(f.session.documentId!, path.join(directory, 'notes.md'))
    expect(saved.dirty).toBe(false); expect(await fs.readFile(path.join(directory, 'old.png'))).toEqual(Buffer.from([9]))
  })

  it('CA208 local prose adopts externally replaced image bytes before saving', async () => {
    const f = await fixture('![photo](photo.png)\n\noriginal'); await fs.writeFile(path.join(f.root, 'photo.png'), Buffer.from([1]))
    await observe(f); f.session.edit('![photo](photo.png)\n\nlocal'); await f.session.drain()
    await fs.writeFile(path.join(f.root, 'photo.png'), Buffer.from([2])); await observe(f)
    expect(f.session.committedDocument!.model.resources.assets['photo.png']).toEqual(new Uint8Array([2]))
    expect(await f.session.flush()).toBe(true)
  })

  it('CA239 HTML Save As keeps local CSS, JS and nested CSS media', async () => {
    const f = await fixture('<link rel="stylesheet" href="style.css"><script src="main.js"></script><img src="pic.png">', 'page.html')
    await fs.writeFile(path.join(f.root, 'style.css'), '.hero{background:url(nested.png)}'); await fs.writeFile(path.join(f.root, 'main.js'), 'window.local=true')
    await fs.writeFile(path.join(f.root, 'pic.png'), Buffer.from([1])); await fs.writeFile(path.join(f.root, 'nested.png'), Buffer.from([2]))
    const directory = path.join(f.root, 'copy'); await fs.mkdir(directory)
    const saved = await f.documents.save(f.session.documentId!, path.join(directory, 'page.html'))
    expect(saved.dirty).toBe(false)
    for (const name of ['style.css', 'main.js', 'pic.png', 'nested.png']) expect(await fs.readFile(path.join(directory, name))).toEqual(await fs.readFile(path.join(f.root, name)))
    expect((await new DocumentHostService(path.join(f.root, 'cold')).open(path.join(directory, 'page.html'))).model).toMatchObject({ source: expect.stringContaining('style.css') })
  })

  it('CA003 pristine raw course input is discoverable without a canonical edit', async () => {
    const f = await fixture(), snapshot = await f.host.bootstrapCourse()
    if (snapshot.model.kind !== 'course-v10') throw new Error('fixture')
    await f.host.writeAuthoringDrafts(snapshot.documentId, { advanced: [{ kind: 'json', documentId: snapshot.documentId, epoch: snapshot.epoch, projectId: snapshot.model.project.id, key: 'network', payload: '{' }], properties: [] })
    const cold = new DocumentHostService(f.journal), items = await cold.internalAPI.recoverable()
    expect(items.some(item => item.documentId === snapshot.documentId)).toBe(true)
    const restored = await cold.internalAPI.restore(snapshot.documentId)
    expect(restored.revision).toBe(snapshot.revision)
    expect((await cold.readAuthoringDrafts(restored.documentId))?.advanced[0]?.payload).toBe('{')
  })

  it('CA104 malformed local object metadata leaves the actual Markdown source open and saveable', async () => {
    const original = 'healthy prose\n\n```cw-object-v1\n{"resources":{"assets":[{"assetId":"hero"}]}}\n```'
    const f = await fixture(original)
    expect(f.session.getSnapshot().source).toBe(original)
    f.session.edit(original + '\n\nrepaired prose'); expect(await f.session.flush()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe(original + '\n\nrepaired prose')
  })

  it('CA068 cancelling unchanged V10 IME reveals the external formal update', async () => {
    const f = await fixture(), project = createBlankCourseProjectV10(), id = project.global.overlay[0]!
    project.instances[id]!.data = { text: 'original' }
    const snapshot = await f.host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'ime.glx')
    const api = documentHostAPI(f.host), projection = await DocumentProjection.attach(api, snapshot.documentId, new CourseV10Driver()); views.push(projection)
    projection.beginComposition(id, ['text'])
    const result = await f.host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'external', baseRevision: snapshot.revision, actor: 'agent', mutation: { type: 'command', command: captureComponentOperation(project, [{ type: 'data.set', instanceId: id, path: ['text'], value: 'external' }]) } })
    expect(result.status).toBe('applied'); await projection.endComposition()
    expect((await projection.drain()).model).toMatchObject({ project: { instances: { [id]: { data: { text: 'external' } } } } })
    expect(projection.read().error).toBeNull()
  })

  it('CA128 valid formal whitespace IDs keep all project file observations available', async () => {
    const project = createBlankCourseProjectV10(), surface = project.surfaces[0]!
    surface.kind = 'flow'; const id = surface.childIds[0] ?? project.global.overlay[0]!, original = project.instances[id]!
    delete project.instances[id]; const adapted = { ...original, id: ' intro ', data: { text: 'body' } }; project.instances[adapted.id] = adapted
    surface.childIds = [adapted.id]; project.global.overlay = project.global.overlay.filter(value => value !== id)
    expect(componentProjectFiles(project, { assets: {}, components: {} }).find(file => file.path.endsWith('.body.md'))?.content).toBeDefined()
  })

  it('CA253 a definition draft can reload its baseline after the representative was removed', async () => {
    const f = await fixture(), project = createBlankCourseProjectV10(), id = project.global.overlay[0]!, definitionId = project.instances[id]!.definitionId
    delete project.instances[id]; project.global.overlay = []
    const snapshot = await f.host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'definition.glx')
    const bridge = new CourseV10DocumentBridge(); views.push(bridge); await bridge.connect(documentHostAPI(f.host)); await bridge.activate(snapshot.documentId)
    expect(captureComponentSourceSession(bridge, snapshot.documentId, id, 'definition', definitionId).scope).toMatchObject({ kind: 'definition', definition: { id: definitionId } })
    expect(() => captureComponentSourceSession(bridge, snapshot.documentId, id, 'instance')).toThrow('原源码对象已不存在')
  })
})
