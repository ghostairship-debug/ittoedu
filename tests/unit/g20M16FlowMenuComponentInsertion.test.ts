import { act, cleanup, renderHook } from '@testing-library/react'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../src/components/document-block'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { exportComponentLibraryArchive } from '../../src/core/components/library/archive'
import { insertComponentPackagesAtTarget } from '../../src/renderer/components/insertComponentPackages'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import { registerFlowMenuCapture, type FlowMenuPageCapture } from '../../src/renderer/document/flowWorkspaceRegistry'
import { captureFlowMenuTarget, resolveFlowMenuInsertionOptions } from '../../src/renderer/ui/flow/flowInsertCommands'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

const dispose: (() => void)[] = []
beforeEach(() => { vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor) })
afterEach(() => { cleanup(); for (const action of dispose.splice(0)) action(); vi.unstubAllGlobals() })

it('inserts an API 5 library example into the captured nested Flow slot with private resources and one History entry after a late choice', async () => {
  const text = (id: string) => ({ id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData(id))) })
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'original-flow', revision: 0, title: '讲义',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [DOCUMENT_BLOCK_DEFINITION.id]: DOCUMENT_BLOCK_DEFINITION },
    instances: { before: text('before'), after: text('after'), section: { id: 'section', definitionId: DOCUMENT_BLOCK_DEFINITION.id,
      data: documentBlockData({ id: 'section', type: 'section', title: { inlines: [] }, collapsedByDefault: false, blocks: [] }), childIds: ['before', 'after'] } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['section'] }], global: { underlay: [], overlay: [] },
    assets: { logo: { id: 'logo', path: 'assets/logo.svg', mimeType: 'image/svg+xml' } } }
  const resources = { assets: { logo: new TextEncoder().encode('<svg>original</svg>') },
    components: { files: { 'main.js': new TextEncoder().encode('export default 99') } } }
  const h = await createV10StoreHost(project, resources)
  dispose.push(() => h.bridge.dispose())
  h.kernel.selectInstances(['before'], 'flow')
  let page: FlowMenuPageCapture = { ok: true, documentId: h.first.documentId, projectId: project.id, revision: 0,
    locationId: 'flow', surfaceId: 'flow', generation: 1, selectedBlockId: 'before', selectionSignature: 'before', paperWidth: 800, bodyWidth: 728,
    paragraphRects: [{ blockId: 'before', depth: 1, x: 36, y: 150, width: 728, height: 50 }] }
  dispose.push(registerFlowMenuCapture(() => page))
  const target = captureFlowMenuTarget(h.kernel)
  const command = { kind: 'component' as const, destination: 'document' as const, label: '组件' }
  const options = resolveFlowMenuInsertionOptions(target, command, { width: 420, height: 240 })
  const entry: ComponentLibraryEntry = { schemaVersion: 1, id: 'com.example.menu-flow', title: '视觉卡片',
    definitions: { visual: { id: 'visual', role: 'content', implementation: { kind: 'source', language: 'javascript',
      workspace: { ownerId: 'files', entry: 'main.js' }, resourceBindings: { logo: 'logo' } } } },
    example: { rootIds: ['visual'], instances: { visual: { id: 'visual', definitionId: 'visual',
      data: { title: '自定义', content: { a: '作者正文', b: '作者说明' } }, flowLayout: { width: 'content-width', wrap: 'left' },
      frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 0, 0] } } } },
    assets: { logo: { id: 'logo', path: 'assets/logo.svg', mimeType: 'image/svg+xml' } },
    resources: { assets: { logo: new TextEncoder().encode('<svg>library</svg>') }, components: { files: {
      'main.js': new TextEncoder().encode("import { label } from './part.js'; export default { mount(ctx) { const el = document.createElement('img'); el.alt = label; el.src = ctx.resources.url('logo'); ctx.root.append(el); return { dispose() { el.remove() } } } }"),
      'part.js': new TextEncoder().encode("export const label = '库组件'"),
    } } } }
  const catalog: AvailableComponentCatalogPackage = { packageId: entry.id, version: '1.0.0', name: entry.title, description: '当前组件',
    sourceId: 'built-in', sourceLabel: '内置', sourceTrust: 'built-in', subject: [], schoolStage: [], tags: [], packagePath: 'card.h5component',
    thumbnailPath: 'card.png', sha256: '0'.repeat(64), componentSchemaVersion: 1, runtimeApiVersion: 5, renderMode: 'dom', supportedScopes: ['scene'],
    quality: 'experimental', maintainer: 'fixture', verifiedCases: [] }
  const choosing = deferred(), read = vi.fn(async () => { await choosing.promise; return { bytes: exportComponentLibraryArchive(entry), sha256: catalog.sha256 } })
  const ports: ComponentLibraryPorts = { kernel: h.kernel, desktopAvailable: () => false,
    loadCatalog: async () => ({ sources: [], packages: [], issues: [] }), readCatalogPackage: read,
    selectComponentPackage: async () => null, selectComponentPackages: async () => null,
    runBusy: async operation => operation(), commitStatus: vi.fn(), reportError: vi.fn() }
  const hook = renderHook(() => useComponentLibrary(ports))
  // Cancelling a chooser and an empty choice do not enter the document writer.
  hook.result.current.importExternalPackages()
  await act(async () => {})
  expect(await insertComponentPackagesAtTarget(h.kernel, target, [], options)).toMatchObject({ ok: false })
  const original = h.first.read()
  expect(h.operations).toEqual([])
  const pending = hook.result.current.prepareCatalogPackage(catalog)
  expect(read).toHaveBeenCalledWith({ sourceId: catalog.sourceId, packageId: catalog.packageId, version: catalog.version })
  h.kernel.selectInstances(['after'], 'flow')
  page = { ...page, selectedBlockId: 'after', selectionSignature: 'after' }
  await h.bridge.create({ kind: 'course-v10', project: { ...structuredClone(project), id: 'other-flow' }, resources: structuredClone(resources) })
  const other = h.bridge.read().snapshot!
  h.kernel.selectInstances(['after'], 'flow')
  const otherBefore = h.registry.get(other.documentId).read(), otherSelection = [...h.bridge.read().selectedInstanceIds]
  expect(h.first.read()).toEqual(original)
  let inserted: Awaited<ReturnType<typeof insertComponentPackagesAtTarget>> | undefined
  await act(async () => {
    choosing.resolve()
    const prepared = await pending
    if (!prepared) throw new Error('Current catalog read failed')
    inserted = await insertComponentPackagesAtTarget(h.kernel, target, [prepared], options)
  })
  expect(inserted?.ok).toBe(true)
  const id = inserted!.layerItemIds![0], model = h.model(), instance = model.project.instances[id]
  expect(model.project.instances.section.childIds).toEqual(['before', id, 'after'])
  expect(model.project.surfaces[0].childIds).toEqual(['section'])
  expect(instance.data).toEqual(entry.example.instances.visual.data)
  expect(instance.flowLayout).toEqual(entry.example.instances.visual.flowLayout)
  expect(instance.flowPlacement).toBeUndefined()
  expect(instance.frame).toMatchObject({ width: 420, height: 240 })
  const implementation = model.project.definitions[instance.definitionId].implementation
  if (implementation.kind !== 'source' || !implementation.workspace) throw new Error('Lost private source owner')
  const owner = implementation.workspace.ownerId, asset = implementation.resourceBindings!.logo
  expect(owner).not.toBe('files'); expect(asset).not.toBe('logo')
  expect(model.resources.components[owner]).toEqual(entry.resources.components.files)
  expect(model.resources.assets[asset]).toEqual(entry.resources.assets.logo)
  expect(model.resources.components.files).toEqual(resources.components.files)
  expect(model.resources.assets.logo).toEqual(resources.assets.logo)
  expect(Object.keys(model.project.assets)).toHaveLength(2)
  expect(h.first.read().undoDepth).toBe(original.undoDepth + 1)
  expect(h.operations).toHaveLength(1)
  expect(h.registry.get(other.documentId).read()).toEqual(otherBefore)
  expect(h.bridge.read().activeDocumentId).toBe(other.documentId)
  expect(h.bridge.read().selectedInstanceIds).toEqual(otherSelection)
  await h.bridge.undo(h.first.documentId)
  expect({ ...h.model().project, revision: 0 }).toEqual({ ...project, revision: 0 })
  expect(h.model().resources).toEqual(resources)
  await h.bridge.redo(h.first.documentId)
  await h.api.save(h.first.documentId, 'flow-component.glx')
  const reopened = h.driver.load(h.disk.get('flow-component.glx')!)
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10 archive')
  expect(reopened.project).toEqual(h.model().project)
  for (const [key, bytes] of Object.entries(model.resources.assets)) expect(Array.from(reopened.resources.assets[key])).toEqual(Array.from(bytes))
  for (const [key, files] of Object.entries(model.resources.components)) for (const [name, bytes] of Object.entries(files)) {
    expect(Array.from(reopened.resources.components[key][name])).toEqual(Array.from(bytes))
  }
  expect(await h.bridge.close(h.first.documentId)).toBe(true)
  const closedOriginal = h.first.read(), operations = h.operations.length
  expect(await insertComponentPackagesAtTarget(h.kernel, target, [entry], options)).toMatchObject({ ok: false })
  expect(h.operations).toHaveLength(operations)
  expect(h.first.read()).toEqual(closedOriginal)
  expect(h.registry.get(other.documentId).read()).toEqual(otherBefore)
  expect(h.bridge.read().selectedInstanceIds).toEqual(otherSelection)
})
