import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentEvent, DocumentOperation, DocumentResources, DurableDocumentState } from '../../src/shared/workbench/document'

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

/** The transport controls timing only; Driver, Projection, History and file bytes are real. */
export async function createV10StoreHost(project: CourseProjectV10, resources: DocumentResources = { assets: {}, components: {} }, connect = true) {
  const driver = new CourseV10Driver(), disk = new Map<string, Uint8Array>(), durable = new Map<string, DurableDocumentState>()
  const listeners = new Set<(event: DocumentEvent) => void>(), observed = new Set<string>()
  const controls: { bootstrap?: Promise<void>; before?(operation: DocumentOperation): Promise<void>; after?(operation: DocumentOperation): Promise<void>; save?(): Promise<void>; cancelClose?: boolean } = {}
  const operations: DocumentOperation[] = []
  let ids = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `store-v10-${++ids}`, bindingKey: binding => binding.path,
    persistence: {
      async append(state) { durable.set(state.documentId, structuredClone(state)) },
      async save(input) {
        await controls.save?.()
        if (input.binding.kind !== 'file') throw new Error('Fixture requires a file binding')
        disk.set(input.binding.path, input.bytes.slice())
        return { ...input.binding, version: `saved-${input.revision}` }
      },
    },
  })
  const observe = (documentId: string) => {
    if (observed.has(documentId)) return
    observed.add(documentId)
    registry.get(documentId).subscribe(event => { for (const listener of listeners) listener(event) })
  }
  const first = await registry.create({ kind: 'course-v10', project, resources }, 'course.glx'); observe(first.documentId)
  const unavailable = async (): Promise<never> => { throw new Error('File observation is outside the in-memory transport fixture') }
  const api: DocumentHostAPI = {
    async bootstrapCourse() { await controls.bootstrap; return first.read() },
    async list() { return registry.list() },
    async read(documentId) { return registry.get(documentId).read() },
    async create(model, name) { const session = await registry.create(model, name); observe(session.documentId); return session.read() },
    async open(path) {
      const session = await registry.open({ kind: 'file', path, version: null, bindingVersion: 1 }, async () => {
        const bytes = disk.get(path)
        if (!bytes) throw new Error(`Missing fixture archive: ${path}`)
        return driver.load(bytes)
      })
      observe(session.documentId); return session.read()
    },
    async dispatch(operation) {
      operations.push(structuredClone(operation)); await controls.before?.(operation)
      const result = await registry.get(operation.documentId).execute(operation)
      await controls.after?.(operation); return result
    },
    async lookup(documentId, operationId) { return registry.get(documentId).lookupOperation(operationId) },
    async save(documentId, path) { return registry.save(documentId, path ? { kind: 'file', path, version: null, bindingVersion: 1 } : undefined) },
    async saveWithDialog(documentId) { return api.save(documentId, 'saved.glx') },
    observeFile: unavailable, reconcileFile: unavailable,
    async readAuthoringDrafts() { return null }, async writeAuthoringDrafts() {}, async clearAuthoringDrafts() {},
    async close(documentId, discardDirty) { await registry.close(documentId, { discardDirty }) },
    async closeWithDialog(documentId) { if (controls.cancelClose) return false; await api.close(documentId, true); return true },
    async recoverable() { return registry.list() },
    async restore(documentId) {
      const saved = durable.get(documentId)
      if (!saved) throw new Error(`Missing recovery: ${documentId}`)
      const session = await registry.restore(saved); observe(documentId); return session.read()
    },
    async discardRecovery(documentId) { durable.delete(documentId) },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const bridge = new CourseV10DocumentBridge(), kernel = createEditorStoreKernel({ bridge, commit() {} })
  if (connect) await bridge.connect(api)
  const model = () => { const value = first.read().model; if (value.kind !== 'course-v10') throw new Error('Expected V10'); return value }
  return { api, driver, registry, first, bridge, kernel, controls, disk, durable, operations, model }
}
