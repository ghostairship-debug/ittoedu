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
import type { ComponentPackageData } from '../../src/shared/componentTypes'

/** Extended Store Host fixture for T4 triage; supports arbitrary component packages. */
export async function createTriageT4StoreHost() {
  const driver = new CourseV9Driver()
  const disk = new Map<string, Uint8Array>()
  const durable = new Map<string, DurableDocumentState>()
  const listeners = new Set<(event: DocumentEvent) => void>()
  const observed = new Set<string>()
  const componentRegistry = new Map<string, Record<string, Uint8Array>>()
  const assetRegistry = new Map<string, Uint8Array>()
  let identity = 0
  let fixture = 0

  const registerPackageData = (pkg: ComponentPackageData) => {
    const key = `${pkg.manifest.id}@${pkg.manifest.version}`
    const files: Record<string, Uint8Array> = {}
    for (const [path, bytes] of Object.entries(pkg.files)) {
      files[path] = Uint8Array.from(bytes)
    }
    if (!files['manifest.json']) {
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(pkg.manifest, null, 2))
    }
    if (!files['runtime.js'] && pkg.runtimeSource) {
      files['runtime.js'] = new TextEncoder().encode(pkg.runtimeSource)
    }
    componentRegistry.set(key, files)
    componentRegistry.set(pkg.manifest.id, files)
  }

  const registerAsset = (id: string, bytes: Uint8Array) => {
    assetRegistry.set(id, bytes)
  }

  const registry = new DocumentRegistry({
    drivers: [driver],
    createId: () => `course-store-t4-${++identity}`,
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
      assetRegistry.get(meta.id) ?? new Uint8Array(meta.byteLength),
    ]))
    const components: DocumentResources['components'] = {}
    const controller = createDefaultTeacherControllerPackage()
    for (const meta of Object.values(project.componentPackages)) {
      const key = `${meta.packageId}@${meta.version}`
      if (meta.packageId === controller.manifest.id && meta.version === controller.manifest.version) {
        components[key] = Object.fromEntries(
          Object.entries(controller.files).map(([path, bytes]) => [path, Uint8Array.from(bytes)]),
        )
      } else if (componentRegistry.has(key) || componentRegistry.has(meta.packageId)) {
        components[key] = componentRegistry.get(key) ?? componentRegistry.get(meta.packageId)!
      } else {
        const manifest = {
          schemaVersion: 4, runtimeApiVersion: 4, id: meta.packageId, version: meta.version,
          name: meta.packageId, entry: 'runtime.js', renderMode: 'dom' as const, supportedScopes: ['scene'] as any,
          defaultSize: { width: 320, height: 180 }, minSize: { width: 100, height: 50 }, preserveAspectRatio: false,
          assets: {}, defaultProps: {},
        }
        const runtime = 'window.CoursewareComponent.define({ runtimeApiVersion: 4 })'
        const files: Record<string, Uint8Array> = {
          'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
          'runtime.js': new TextEncoder().encode(runtime),
        }
        components[key] = files
      }
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
    registerPackageData,
    registerAsset,
    async open(project: CourseProjectDocument, packages?: ComponentPackageData[], assets?: Record<string, Uint8Array>) {
      if (packages) {
        for (const pkg of packages) registerPackageData(pkg)
      }
      if (assets) {
        for (const [id, bytes] of Object.entries(assets)) registerAsset(id, bytes)
      }
      const path = `course-store-t4-${++fixture}.h5lesson`
      disk.set(path, driver.serialize(modelFor(project)))
      await useEditorStore.getState().openCourseDocument(path)
      return useEditorStore.getState().drainCourseDocument()
    },
  }
}
