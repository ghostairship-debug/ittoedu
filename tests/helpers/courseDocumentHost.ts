import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'
import type { CourseProjectLifecyclePorts } from '../../src/renderer/app/useCourseProjectLifecycle'
import type { DocumentModel, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** In-memory I/O only. Identity, History, ACK, save and recovery use the real kernel. */
export async function createCourseDocumentHost() {
  const driver = new CourseV9Driver()
  const disk = new Map<string, Uint8Array>()
  const durable = new Map<string, DurableDocumentState>()
  const controls: {
    savePath: string | null
    beforeSave?: (input: Parameters<DocumentPersistence['save']>[0]) => Promise<void>
    beforeAppend?: (state: DurableDocumentState) => Promise<void>
  } = { savePath: 'saved.h5lesson' }
  let count = 0, operation = 0, generation = 0, activeId = ''
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
  const makeRegistry = (target = persistence) => new DocumentRegistry({
    drivers: [driver], persistence: target, createId: () => `lifecycle-${++count}`,
    bindingKey: binding => binding.path,
  })
  let registry = makeRegistry()
  const model = (surface: 'slide' | 'flow' | 'spatial', title: string): DocumentModel => ({
    kind: 'course-v9',
    project: ({ slide: createBlankCourseProject, flow: createBlankFlowCourseProject, spatial: createBlankSpatialCourseProject })[surface]({
      title, includeDefaultController: false, controls: 'none',
    }),
    resources: { assets: {}, components: {} },
  })
  const select = (id: string) => { activeId = id; generation += 1 }
  const read = () => registry.get(activeId).read()
  const documents: NonNullable<CourseProjectLifecyclePorts['documents']> = {
    async ready() {}, snapshot: read,
    async create(surface) {
      const session = await registry.create(model(surface, `new ${surface}`), `new-${surface}.h5lesson`)
      select(session.documentId)
    },
    async open(path) {
      const session = await registry.open({ kind: 'file', path, version: 'disk', bindingVersion: 1 }, async () => {
        const bytes = disk.get(path)
        if (!bytes) throw new Error(`Missing course: ${path}`)
        return driver.load(Uint8Array.from(bytes))
      })
      select(session.documentId)
    },
    async save(saveAs = false) {
      const snapshot = await registry.get(activeId).drain()
      if (!saveAs && snapshot.binding.kind === 'file') return registry.save(snapshot.documentId)
      if (controls.savePath === null) return null
      return registry.save(snapshot.documentId, { kind: 'file', path: controls.savePath, version: null, bindingVersion: 1 })
    },
    async drain() { return registry.get(activeId).drain() },
  }
  async function seedFile(path: string, title: string) {
    disk.set(path, await driver.serialize(model('slide', title)))
  }
  async function editTitle(title: string) {
    const snapshot = read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('Not a course')
    return registry.get(activeId).execute({
      documentId: activeId, epoch: snapshot.epoch, operationId: `edit-${++operation}`,
      baseRevision: snapshot.revision, actor: 'human',
      mutation: { type: 'command', command: { type: 'course.replace', project: { ...snapshot.model.project, title } } },
    })
  }
  await seedFile('initial.h5lesson', 'initial')
  await documents.open('initial.h5lesson')
  return {
    documents, controls, durable, disk, driver, read, seedFile, editTitle,
    get registry() { return registry },
    identity() {
      const snapshot = read()
      if (snapshot.model.kind !== 'course-v9') throw new Error('Not a course')
      return { projectId: snapshot.model.project.id, revision: snapshot.revision, sessionGeneration: generation }
    },
    async restart() {
      // Simulate process loss: retain only durable state and disk; never copy live History.
      registry = makeRegistry()
      await seedFile('startup.h5lesson', 'startup')
      await documents.open('startup.h5lesson')
    },
  }
}

export type CourseDocumentTestHost = Awaited<ReturnType<typeof createCourseDocumentHost>>
