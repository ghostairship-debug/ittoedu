import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type {
  DocumentEvent,
  DocumentModel,
  DocumentResources,
  DurableDocumentState,
} from '../../src/shared/workbench/document'

/** Real Registry/Driver/Bridge fixture for Store tests; only disk and journal I/O are in memory. */
export async function createCourseStoreHost() {
  const driver = new CourseV9Driver()
  const disk = new Map<string, Uint8Array>()
  const durable = new Map<string, DurableDocumentState>()
  const listeners = new Set<(event: DocumentEvent) => void>()
  const observed = new Set<string>()
  let identity = 0
  let fixture = 0
  const registry = new DocumentRegistry({
    drivers: [driver],
    createId: () => `course-store-${++identity}`,
    bindingKey: binding => binding.path,
    persistence: {
      async append(state) { durable.set(state.documentId, structuredClone(state)) },
      async save(input) {
        if (input.binding.kind !== 'file') throw new Error('Course Store fixture requires a file binding')
        disk.set(input.binding.path, input.bytes.slice())
        return { ...input.binding, version: `revision-${input.revision}` }
      },
    },
  })

  const resourcesFor = (project: CourseProjectDocument): DocumentResources => {
    const assets = Object.fromEntries(Object.values(project.assets).map(meta => [
      meta.id,
      new Uint8Array(meta.byteLength),
    ]))
    const components: DocumentResources['components'] = {}
    const controller = createDefaultTeacherControllerPackage()
    for (const meta of Object.values(project.componentPackages)) {
      if (meta.packageId !== controller.manifest.id || meta.version !== controller.manifest.version) {
        throw new Error(`Course Store fixture has no bytes for component ${meta.packageId}@${meta.version}`)
      }
      components[`${meta.packageId}@${meta.version}`] = Object.fromEntries(
        Object.entries(controller.files).map(([path, bytes]) => [path, Uint8Array.from(bytes)]),
      )
    }
    return { assets, components }
  }
  const modelFor = (project: CourseProjectDocument): DocumentModel => ({
    kind: 'course-v9',
    project: structuredClone(project),
    resources: resourcesFor(project),
  })
  const subscribeSession = (documentId: string) => {
    if (observed.has(documentId)) return
    observed.add(documentId)
    registry.get(documentId).subscribe(event => {
      for (const listener of listeners) listener(event)
    })
  }

  const startup = await registry.create(modelFor(createBlankCourseProject()), 'startup.h5lesson', true)
  subscribeSession(startup.documentId)
  const api: DocumentHostAPI = {
    async bootstrapCourse() { return startup.read() },
    async list() { return registry.list() },
    async read(documentId) { return registry.get(documentId).read() },
    async create(model, suggestedName) {
      const session = await registry.create(model, suggestedName)
      subscribeSession(session.documentId)
      return session.read()
    },
    async open(path) {
      const session = await registry.open(
        { kind: 'file', path, version: 'fixture', bindingVersion: 1 },
        async () => {
          const bytes = disk.get(path)
          if (!bytes) throw new Error(`Missing fixture ${path}`)
          return driver.load(bytes)
        },
      )
      subscribeSession(session.documentId)
      return session.read()
    },
    async dispatch(operation) { return registry.get(operation.documentId).execute(operation) },
    async lookup(documentId, operationId) { return registry.get(documentId).lookupOperation(operationId) },
    async save(documentId, path) {
      return registry.save(documentId, path
        ? { kind: 'file', path, version: null, bindingVersion: 1 }
        : undefined)
    },
    async saveWithDialog(documentId) { return api.save(documentId, 'saved.h5lesson') },
    async observeFile() { throw new Error('File observation is outside this Store fixture') },
    async reconcileFile() { throw new Error('File reconciliation is outside this Store fixture') },
    async close(documentId, discardDirty) { await registry.close(documentId, { discardDirty }) },
    async closeWithDialog(documentId) { await api.saveWithDialog(documentId); await registry.close(documentId); return true },
    async recoverable() { return registry.list() },
    async restore(documentId) {
      const state = durable.get(documentId)
      if (!state) throw new Error(`Missing recovery journal ${documentId}`)
      const session = await registry.restore(state)
      subscribeSession(documentId)
      return session.read()
    },
    async discardRecovery(documentId) { durable.delete(documentId) },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }

  await useEditorStore.getState().connectCourseDocuments(api)
  await useEditorStore.getState().drainCourseDocument()
  return {
    api,
    registry,
    async open(project: CourseProjectDocument) {
      const path = `course-store-${++fixture}.h5lesson`
      disk.set(path, driver.serialize(modelFor(project)))
      await useEditorStore.getState().openCourseDocument(path)
      return useEditorStore.getState().drainCourseDocument()
    },
  }
}
