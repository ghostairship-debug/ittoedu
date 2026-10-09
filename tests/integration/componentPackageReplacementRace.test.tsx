import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { unzipSync, zipSync } from 'fflate'
import path from 'node:path'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { scanComponentCatalogDirectory, readCatalogComponentPackage } from '../../src/main/componentCatalogScanner'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import { exportComponentLibraryArchive } from '../../src/core/components/library/archive'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'
import type { OpenBinaryFileResult } from '../../src/shared/ipcTypes'

const disposers: (() => Promise<unknown>)[] = []
afterEach(async () => { cleanup(); for (const dispose of disposers.splice(0).reverse()) await dispose(); vi.unstubAllGlobals() })
const bytes = (source: string) => new TextEncoder().encode(source)
function project(id = 'course'): CourseProjectV10 {
  return { schemaVersion: 10, id, revision: 0, title: id, definitions: {
    widget: { id: 'widget', version: '1.0.0', role: 'content', title: '共享组件', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'old', entry: 'main.js' } } },
  }, instances: { a: { id: 'a', definitionId: 'widget', data: { text: '用户正文', authorField: 7 }, frame: { width: 300, height: 120, transform: [1, .2, 0, 1, 21, 34] } },
    b: { id: 'b', definitionId: 'widget', data: { text: '另一实例' }, implementationOverride: { kind: 'source', language: 'javascript', source: 'export default {}' } } },
    surfaces: [{ id: 'page', kind: 'slide', title: '页面', childIds: ['a', 'b'] }], global: { underlay: [], overlay: [] }, assets: {} }
}
function entry(version = '2.0.0'): ComponentLibraryEntry {
  return { schemaVersion: 1, id: 'widget', title: '新版组件', definitions: {
    widget: { id: 'widget', version, role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'new-source', entry: 'main.js' }, resourceBindings: { icon: 'new-asset' } } },
  }, example: { rootIds: ['sample'], instances: { sample: { id: 'sample', definitionId: 'widget', data: { text: '示例内容' } } } },
    assets: { 'new-asset': { id: 'new-asset', path: 'assets/icon.bin', mimeType: 'application/octet-stream' } },
    resources: { assets: { 'new-asset': new Uint8Array([8, 9]) }, components: { 'new-source': { 'main.js': bytes('export default { mount() { return {update(){}, dispose(){}} } }') } } } }
}
const catalogEntry = (): AvailableComponentCatalogPackage => ({ packageId: 'widget', version: '2.0.0', name: '新版组件', description: '', subject: [], schoolStage: [], tags: [],
  packagePath: 'widget.h5component', thumbnailPath: '', sha256: 'a'.repeat(64), componentSchemaVersion: 1, runtimeApiVersion: 5, renderMode: 'dom', supportedScopes: ['scene', 'global'],
  quality: 'experimental', maintainer: 'fixture', verifiedCases: [], sourceId: 'fixture', sourceLabel: '组件库', sourceTrust: 'built-in' })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept }); return { promise, resolve } }
async function fixture() {
  vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor)
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'guoling-library-race-')); disposers.push(() => fs.rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'recovery')), initial = await host.internalAPI.create({ kind: 'course-v10', project: project(),
    resources: { assets: {}, components: { old: { 'main.js': bytes('export default {}') } } } }, '课件.h5lesson')
  const unavailable = async (): Promise<never> => { throw new Error('Fixture has no save dialog') }
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => initial, saveWithDialog: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable,
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) }, subscribe: listener => host.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge(); disposers.push(async () => bridge.dispose()); await bridge.connect(api)
  bridge.selectInstances(initial.documentId, ['a'], 'page')
  const kernel = createEditorStoreKernel({ bridge, commit: vi.fn() }), pending: Promise<unknown>[] = [], errors: string[] = [], item = catalogEntry()
  const archive = exportComponentLibraryArchive(entry()), file = { path: '/fixture/widget.h5component', name: 'widget.h5component', bytes: archive }
  const ports: ComponentLibraryPorts = { kernel, desktopAvailable: () => true, loadCatalog: async () => ({ sources: [], packages: [item], issues: [] }),
    selectComponentPackage: vi.fn(async () => file), selectComponentPackages: async () => null,
    readCatalogPackage: vi.fn(async () => ({ bytes: archive, sha256: createHash('sha256').update(archive).digest('hex') })),
    runBusy<T>(operation: () => Promise<T>, fallback: string) {
      const operationPromise = operation().catch(error => { errors.push(`${fallback} ${error instanceof Error ? error.message : String(error)}`); return undefined })
      pending.push(operationPromise); return operationPromise
    }, commitStatus: vi.fn(), reportError: message => errors.push(message) }
  const hook = renderHook(() => useComponentLibrary(ports)); await act(async () => { await pending[0] })
  return { host, initial, bridge, kernel, ports, hook, pending, errors, item, file, directory }
}

it('freezes manual replacement before the picker and rejects a stale shared definition without writing bytes or the newly active document', async () => {
  const h = await fixture(), selection = deferred<OpenBinaryFileResult | null>()
  h.ports.selectComponentPackage = () => selection.promise
  act(() => h.hook.result.current.replacePackage('widget'))
  await act(async () => { await h.kernel.edit([{ type: 'definition.set', definition: { ...h.kernel.readDocument().definitions.widget, title: '人工修改' } }]) })
  const before = await h.host.internalAPI.read(h.initial.documentId)
  const other = await h.host.internalAPI.create({ kind: 'course-v10', project: project('other'), resources: before.model.resources }, 'other.h5lesson')
  await act(async () => { await h.bridge.activate(other.documentId); selection.resolve(h.file); await h.pending.at(-1) })
  expect(h.hook.result.current.replacementRequest?.target.captured.documentId).toBe(h.initial.documentId)
  await act(async () => { h.hook.result.current.confirmReplacement(); await h.pending.at(-1) })
  expect(h.errors).toHaveLength(1)
  expect(await h.host.internalAPI.read(h.initial.documentId)).toEqual(before)
  expect(await h.host.internalAPI.read(other.documentId)).toEqual(other)
})

it('keeps deferred catalog update and cancelled/manual malformed selection at zero writes after target revision changes', async () => {
  const h = await fixture(), read = deferred<{ bytes: Uint8Array; sha256: string }>()
  h.ports.readCatalogPackage = () => read.promise
  act(() => h.hook.result.current.requestCatalogUpdate(h.item))
  act(() => h.hook.result.current.confirmCatalogUpdate())
  const update = h.pending.at(-1)
  await act(async () => { await h.kernel.edit([{ type: 'definition.set', definition: { ...h.kernel.readDocument().definitions.widget, version: '3.0.0' } }]) })
  const before = await h.host.internalAPI.read(h.initial.documentId)
  await act(async () => { read.resolve({ bytes: h.file.bytes, sha256: h.item.sha256 }); await update })
  expect(h.errors).toHaveLength(1)
  expect(await h.host.internalAPI.read(h.initial.documentId)).toEqual(before)
  h.ports.selectComponentPackage = async () => null
  await act(async () => { h.hook.result.current.replacePackage('widget'); await h.pending.at(-1) })
  expect(h.hook.result.current.replacementRequest).toBeNull()
  h.ports.selectComponentPackage = async () => ({ ...h.file, bytes: bytes('not an archive') })
  await act(async () => { h.hook.result.current.replacePackage('widget'); await h.pending.at(-1) })
  expect(h.errors).toHaveLength(2)
  expect(await h.host.internalAPI.read(h.initial.documentId)).toEqual(before)
})

it('replaces a shared implementation once while retaining instance data, affine frames and private source, then undoes/redoes and cold reopens its resources', async () => {
  const h = await fixture(), before = h.kernel.captureTarget()
  await act(async () => { h.hook.result.current.replacePackage('widget'); await h.pending.at(-1) })
  await act(async () => { h.hook.result.current.confirmReplacement(); await h.pending.at(-1) })
  expect(h.errors).toEqual([])
  const current = await h.host.internalAPI.read(h.initial.documentId)
  expect(current.undoDepth).toBe(1)
  if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(current.model.project.instances).toEqual(before.project.instances)
  expect(current.model.project.definitions.widget.version).toBe('2.0.0')
  const implementation = current.model.project.definitions.widget.implementation
  if (implementation.kind !== 'source' || !implementation.workspace) throw new Error('Expected source workspace')
  expect(current.model.resources.components[implementation.workspace.ownerId]['main.js']).toEqual(entry().resources.components['new-source']['main.js'])
  expect(Object.values(current.model.resources.assets)).toContainEqual(new Uint8Array([8, 9]))
  await act(async () => { await h.bridge.undo(h.initial.documentId) })
  expect(h.kernel.readDocument().definitions).toEqual(before.project.definitions)
  expect(h.kernel.readDocument().instances).toEqual(before.project.instances)
  expect(h.kernel.readResources()).toEqual(before.resources)
  await act(async () => { await h.bridge.redo(h.initial.documentId) })
  const saved = h.kernel.captureTarget(), filename = path.join(h.directory, 'saved.h5lesson')
  await h.host.internalAPI.save(h.initial.documentId, filename)
  const fresh = new DocumentHostService(path.join(h.directory, 'fresh-host')), reopened = await fresh.open(filename)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.model.project).toEqual(saved.project)
  expect(reopened.model.resources).toEqual(saved.resources)
})

it('prepares current archives without a transaction and rejects wrong identity/version and corrupt bytes while preserving the original course', async () => {
  const h = await fixture(), before = await h.host.internalAPI.read(h.initial.documentId)
  await act(async () => { expect(await h.hook.result.current.prepareCatalogPackage(h.item)).toEqual(entry()) })
  const wrongId = { ...entry(), id: 'other' }
  for (const archive of [exportComponentLibraryArchive(wrongId), exportComponentLibraryArchive(entry(), '99.0.0'), bytes('corrupt')]) {
    h.ports.readCatalogPackage = async () => ({ bytes: archive, sha256: 'unused metadata' })
    await act(async () => { expect(await h.hook.result.current.prepareCatalogPackage(h.item)).toBeNull() })
  }
  expect(h.errors).toHaveLength(3)
  expect(await h.host.internalAPI.read(h.initial.documentId)).toEqual(before)
})

it('reads the actual current catalog bytes and hash, then diagnoses identity changes, missing resources and damaged packages', async () => {
  const h = await fixture(), root = path.join(h.directory, 'catalog'); await fs.mkdir(root)
  const filename = path.join(root, 'widget.h5component'); await fs.writeFile(filename, h.file.bytes)
  const source = await scanComponentCatalogDirectory(root, 'built-in')
  const read = await readCatalogComponentPackage(source, 'widget', '2.0.0')
  expect(Array.from(read.bytes)).toEqual(Array.from(h.file.bytes))
  expect(read.sha256).toBe(createHash('sha256').update(h.file.bytes).digest('hex'))
  await fs.writeFile(filename, exportComponentLibraryArchive({ ...entry(), id: 'other' }))
  await expect(readCatalogComponentPackage(source, 'widget', '2.0.0')).rejects.toThrow('身份已改变')
  const incomplete = unzipSync(h.file.bytes); delete incomplete['assets/new-asset']
  await fs.writeFile(filename, zipSync(incomplete))
  await expect(readCatalogComponentPackage(source, 'widget', '2.0.0')).rejects.toThrow('组件资源缺失')
  await fs.writeFile(filename, bytes('corrupt'))
  await expect(readCatalogComponentPackage(source, 'widget', '2.0.0')).rejects.toThrow()
  const corrupted = await scanComponentCatalogDirectory(root, 'built-in')
  expect(corrupted.packages).toEqual([])
  expect(corrupted.issues).toContainEqual(expect.objectContaining({ code: 'package-unreadable' }))
  expect((await h.host.internalAPI.read(h.initial.documentId)).undoDepth).toBe(0)
})
