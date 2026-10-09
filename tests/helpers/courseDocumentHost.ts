import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createCourseProjectContent } from '../../src/renderer/store/slices/courseLifecycleSlice'
import type { CourseProjectLifecyclePorts } from '../../src/renderer/app/useCourseProjectLifecycle'
import { authoringDraftRecoverySchema, type AuthoringDraftRecovery, type DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentEvent, DocumentModel, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** Only I/O is in memory. V10 authoring uses the real Bridge, Driver and unique DocumentSession. */
export async function createCourseDocumentHost() {
  const driver = new CourseV10Driver()
  const bridge = new CourseV10DocumentBridge()
  const disk = new Map<string, Uint8Array>()
  const durable = new Map<string, DurableDocumentState>()
  const authoringDrafts = new Map<string, AuthoringDraftRecovery>()
  const listeners = new Set<(event: DocumentEvent) => void>()
  const observed = new Set<string>()
  const controls: {
    savePath: string | null
    beforeSave?: (input: Parameters<DocumentPersistence['save']>[0]) => Promise<void>
    beforeAppend?: (state: DurableDocumentState) => Promise<void>
  } = { savePath: 'saved.h5lesson' }
  let count = 0, startupId = ''
  const persistence: DocumentPersistence = {
    async append(state) {
      await controls.beforeAppend?.(state)
      durable.set(state.documentId, structuredClone(state))
    },
    async save(input) {
      await controls.beforeSave?.(input)
      if (input.binding.kind !== 'file') throw new Error('Save requires a file binding')
      disk.set(input.binding.path, input.bytes.slice())
      return { ...input.binding, version: `revision-${input.revision}` }
    },
  }
  const makeRegistry = () => new DocumentRegistry({
    drivers: [driver], persistence, createId: () => `lifecycle-${++count}`,
    bindingKey: binding => binding.path,
  })
  let registry = makeRegistry()
  const model = (surface: 'slide' | 'flow' | 'spatial', title: string): DocumentModel => {
    const content = createCourseProjectContent(surface)
    content.project.title = title
    return { kind: 'course-v10', ...content }
  }
  const observe = (documentId: string) => {
    if (observed.has(documentId)) return
    observed.add(documentId)
    registry.get(documentId).subscribe(event => {
      for (const listener of listeners) listener(event)
    })
  }
  const activeDocumentId = () => {
    const id = bridge.read().activeDocumentId
    if (!id) throw new Error('No active course document')
    return id
  }
  const read = () => registry.get(activeDocumentId()).read()
  const api: DocumentHostAPI = {
    async bootstrapCourse() { return registry.get(startupId).read() },
    async list() { return registry.list() },
    async read(documentId) { return registry.get(documentId).drain() },
    async readAuthoringDrafts(documentId) {
      registry.get(documentId)
      return structuredClone(authoringDrafts.get(documentId) ?? null)
    },
    async writeAuthoringDrafts(documentId, drafts) {
      registry.get(documentId)
      authoringDrafts.set(documentId, structuredClone(authoringDraftRecoverySchema.parse(drafts)))
    },
    async clearAuthoringDrafts(documentId) {
      registry.get(documentId)
      authoringDrafts.delete(documentId)
    },
    async create(input, suggestedName) {
      const session = await registry.create(input, suggestedName)
      observe(session.documentId)
      return session.read()
    },
    async open(path) {
      const session = await registry.open({ kind: 'file', path, version: 'disk', bindingVersion: 1 }, async () => {
        const bytes = disk.get(path)
        if (!bytes) throw new Error(`Missing course: ${path}`)
        return driver.load(Uint8Array.from(bytes))
      })
      observe(session.documentId)
      return session.read()
    },
    async dispatch(operation) { return registry.get(operation.documentId).execute(operation) },
    async lookup(documentId, operationId) { return registry.get(documentId).lookupOperation(operationId) },
    async save(documentId, path) {
      return registry.save(documentId, path ? { kind: 'file', path, version: null, bindingVersion: 1 } : undefined)
    },
    async saveWithDialog(documentId, saveAs = false) {
      const snapshot = await registry.get(documentId).drain()
      if (!saveAs && snapshot.binding.kind === 'file') return api.save(documentId)
      if (controls.savePath === null) return null
      return api.save(documentId, controls.savePath)
    },
    async observeFile() { throw new Error('File observation is outside this lifecycle fixture') },
    async reconcileFile() { throw new Error('File reconciliation is outside this lifecycle fixture') },
    async close(documentId, discardDirty) { await registry.close(documentId, { discardDirty }) },
    async closeWithDialog(documentId) {
      if (!await api.saveWithDialog(documentId)) return false
      await registry.close(documentId)
      return true
    },
    async recoverable() { return registry.list() },
    async restore(documentId) {
      const state = durable.get(documentId)
      if (!state) throw new Error(`Missing recovery journal ${documentId}`)
      const session = await registry.restore(state)
      observe(session.documentId)
      return session.read()
    },
    async discardRecovery(documentId) { durable.delete(documentId); authoringDrafts.delete(documentId) },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const documents: NonNullable<CourseProjectLifecyclePorts['documents']> = {
    ready: () => bridge.connect(api), snapshot: () => bridge.read().snapshot,
    async create(surface, canvas) { await bridge.create({ kind: 'course-v10', ...createCourseProjectContent(surface, canvas) }) },
    async createFrom(content) { await bridge.create({ kind: 'course-v10', ...content }) },
    open: path => bridge.open(path),
    async save(saveAs = false) {
      const documentId = activeDocumentId()
      if (!await bridge.save(saveAs, undefined, documentId)) return null
      return registry.get(documentId).read()
    },
    async drain() {
      const [snapshot] = await bridge.drain([activeDocumentId()])
      if (!snapshot) throw new Error('Course document has closed')
      return snapshot
    },
  }
  async function seedFile(path: string, title: string) {
    disk.set(path, driver.serialize(model('slide', title)))
  }
  async function start(path: string, title: string) {
    await seedFile(path, title)
    startupId = (await api.open(path)).documentId
    await documents.ready()
  }
  await start('initial.h5lesson', 'initial')
  return {
    api, bridge, documents, controls, durable, disk, driver, read, seedFile,
    get registry() { return registry },
    editTitle: (title: string) => bridge.edit([{ type: 'project.title.set', title }]),
    identity() {
      const snapshot = read()
      if (snapshot.model.kind !== 'course-v10') throw new Error('Not a V10 course')
      return { projectId: snapshot.model.project.id, revision: snapshot.revision,
        documentId: snapshot.documentId, epoch: snapshot.epoch }
    },
    dispose() { bridge.dispose() },
    async restart() {
      // Simulate process loss: retain only durable state and disk; never copy live History.
      bridge.dispose()
      registry = makeRegistry()
      observed.clear()
      await start('startup.h5lesson', 'startup')
    },
  }
}

export type CourseDocumentTestHost = Awaited<ReturnType<typeof createCourseDocumentHost>>
