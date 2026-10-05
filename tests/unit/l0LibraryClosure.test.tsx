import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { componentAssetIds, extractComponentLibraryEntry, prepareComponentLibraryInsertion } from '../../src/core/components/library'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../src/core/components/library/archive'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import { ComponentLibraryDialog } from '../../src/renderer/ui/ComponentsTab'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { CapturedCourseTarget, CourseV10ViewState } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { CapturedComponentOperation } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { DocumentModel } from '../../src/shared/workbench/document'

afterEach(cleanup)
const blank = (id: string): CourseProjectV10 => ({ schemaVersion: 10, id, revision: 0, title: id,
  definitions: {}, instances: {}, assets: {}, surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: [] }],
  global: { underlay: [], overlay: [] } })
const catalogEntry: AvailableComponentCatalogPackage = { packageId: 'library-card', version: '1.0.0', name: '卡片',
  description: '含图像', subject: [], schoolStage: [], tags: [], packagePath: 'card.h5component', thumbnailPath: '',
  sha256: '', componentSchemaVersion: 1, runtimeApiVersion: 5, renderMode: 'dom', supportedScopes: ['scene'],
  quality: 'candidate', maintainer: '', verifiedCases: [], sourceId: 'personal', sourceLabel: '我的资产库', sourceTrust: 'trusted' }

it('shares declared references across rebound Web definitions and effective source overrides without requiring bytes', () => {
  const web = { id: 'renamed-web', role: 'content' as const, implementation: { kind: 'builtin' as const, key: 'guoling.web' } }
  const instance = { id: 'example', definitionId: web.id, data: { html: '<img src="cw-resource:photo">', resourceBindings: { 'cw-resource:photo': 'absent' } } }
  expect(componentAssetIds(instance, web)).toEqual(['absent'])
  expect(componentAssetIds({ ...instance, implementationOverride: { kind: 'source', language: 'javascript', source: 'export default {}',
    resourceBindings: { image: 'source-asset' } } }, web)).toEqual(['source-asset'])
  const source = { ...web, id: 'guoling.web', implementation: { kind: 'source' as const, language: 'javascript' as const,
    source: 'export default {}', resourceBindings: { image: 'definition-asset' } } }
  expect(componentAssetIds(instance, source)).toEqual(['definition-asset'])
  expect(componentAssetIds({ ...instance, implementationOverride: { kind: 'builtin', key: 'fixture' } }, source)).toEqual([])
})

it('preserves missing-byte metadata in library archives, maps unresolved references and leaves same-name destination bytes intact', () => {
  const original = blank('original')
  original.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  original.instances.web = { id: 'web', definitionId: 'web', data: { html: '<img src="cw-resource:photo">', resourceBindings: { 'cw-resource:photo': 'photo' } } }
  original.surfaces[0].childIds = ['web']
  original.assets.photo = { id: 'photo', path: 'assets/photo.png', filename: '原图.png', mimeType: 'image/png' }
  const extracted = extractComponentLibraryEntry(original, { assets: {}, components: {} }, { id: 'library-card', title: '卡片', rootIds: ['web'] })
  expect(extracted.diagnostics).toEqual([{ code: 'missing-asset', message: '保留了待修复的素材引用：photo' }])
  const entry = importComponentLibraryArchive(exportComponentLibraryArchive(extracted.entry)).entry
  expect(entry.assets.photo).toEqual(original.assets.photo)
  expect(entry.resources.assets.photo).toBeUndefined()
  const destination = blank('destination')
  destination.assets.photo = { id: 'photo', path: 'assets/destination.png' }
  const before: DocumentModel = { kind: 'course-v10', project: destination, resources: { assets: { photo: new Uint8Array([9]) }, components: {} } }
  const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: 'page' }, index: 0 })
  expect(insertion.diagnostics).toEqual(extracted.diagnostics)
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize(driver.apply(before, insertion.command)))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project.instances[insertion.rootIds[0]].data).toEqual({ html: '<img src="cw-resource:photo">', resourceBindings: { 'cw-resource:photo': insertion.identities.assets.get('photo') } })
  expect(insertion.identities.assets.get('photo')).not.toBe('photo')
  expect(reopened.resources.assets.photo).toEqual(new Uint8Array([9]))
  expect(reopened.resources.assets[insertion.identities.assets.get('photo')!]).toBeUndefined()
  expect(entry.assets.photo).toEqual(original.assets.photo)
})

it('keeps a deferred picker insertion on captured document A after browsing B and awaits the canonical ACK', async () => {
  const source = blank('source')
  source.definitions.card = { id: 'card', role: 'content', implementation: { kind: 'builtin', key: 'fixture' } }
  source.instances.card = { id: 'card', definitionId: 'card', data: { assetId: 'picture' } }
  source.surfaces[0].childIds = ['card']; source.assets.picture = { id: 'picture', path: 'assets/picture.png' }
  const entry = extractComponentLibraryEntry(source, { assets: { picture: new Uint8Array([1]) }, components: {} }, { id: catalogEntry.packageId, title: '卡片', rootIds: ['card'] }).entry
  const projectA = blank('A'), projectB = blank('B'), driver = new CourseV10Driver()
  const models: Record<string, DocumentModel> = { A: { kind: 'course-v10', project: projectA, resources: { assets: {}, components: {} } }, B: { kind: 'course-v10', project: projectB, resources: { assets: {}, components: {} } } }
  const target: CapturedCourseTarget = { documentId: 'A', epoch: 'epoch-A', project: projectA, resources: models.A.resources,
    editingProject: projectA, activeStateId: null, surfaceId: 'page', instanceIds: [], instanceId: null }
  let activeDocumentId = 'A', releaseRead!: () => void, releaseCommit!: () => void
  const view = { project: projectA, activeDocumentId, views: [{ documentId: 'A', model: models.A }] } as unknown as CourseV10ViewState
  const selectInstances = vi.fn(), editCaptured = vi.fn(async (command: CapturedComponentOperation) => {
    await new Promise<void>(resolve => { releaseCommit = resolve })
    const { documentId, epoch: _epoch, ...operation } = command
    models[documentId] = driver.apply(models[documentId], operation)
    return { status: 'applied', revision: 1 }
  })
  const kernel = { bridge: { subscribe: () => () => {} }, readView: () => ({ ...view, activeDocumentId }), captureTarget: () => target,
    readResources: () => models[activeDocumentId].resources, capture: (edits: ComponentEdit[], captured: CapturedCourseTarget) => ({ ...captureComponentOperation(captured.project, edits), documentId: captured.documentId, epoch: captured.epoch }),
    editCaptured, selectInstances } as unknown as EditorStoreKernel
  // useSyncExternalStore receives a stable snapshot; readView above remains the live imperative port.
  const ports: ComponentLibraryPorts = { kernel: { ...kernel, readView: () => view }, desktopAvailable: () => false,
    loadCatalog: async () => ({ sources: [], packages: [], issues: [] }), selectComponentPackage: async () => null, selectComponentPackages: async () => null,
    readCatalogPackage: async () => { await new Promise<void>(resolve => { releaseRead = resolve }); return { bytes: exportComponentLibraryArchive(entry), sha256: '' } },
    runBusy: operation => operation(), commitStatus: vi.fn(), reportError: vi.fn() }
  // Use the same kernel identity through the await, with its captured document/session target.
  const { result } = renderHook(() => useComponentLibrary(ports))
  let pending!: Promise<boolean>, settled = false
  act(() => { pending = result.current.addCatalogPackages([catalogEntry]).then(value => { settled = true; return value }) })
  activeDocumentId = 'B'; view.activeDocumentId = 'B'
  await act(async () => { releaseRead(); await Promise.resolve() })
  await waitFor(() => expect(editCaptured).toHaveBeenCalledTimes(1))
  expect(settled).toBe(false)
  await act(async () => { releaseCommit(); expect(await pending).toBe(true) })
  expect(editCaptured.mock.calls[0][0].documentId).toBe('A')
  expect(models.B).toEqual({ kind: 'course-v10', project: projectB, resources: { assets: {}, components: {} } })
  expect(selectInstances).not.toHaveBeenCalled()
  expect(Object.keys(models.A.resources.assets)).toHaveLength(1)
  expect(Object.values(models.A.resources.assets)[0]).toEqual(new Uint8Array([1]))
})

it('shows picker insertion errors, clears busy and retains the selected entry for retry', async () => {
  const onAdd = vi.fn(() => { throw new Error('提交失败，原选择保留') })
  render(<ComponentLibraryDialog catalog={{ sources: [], packages: [catalogEntry], issues: [] }} components={{}} onClose={vi.fn()} onAdd={onAdd} />)
  fireEvent.click(screen.getByLabelText('选择卡片'))
  fireEvent.click(screen.getByRole('button', { name: '添加到画布（1）' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('提交失败，原选择保留')
  expect(screen.getByLabelText('选择卡片')).toBeChecked()
  expect(screen.getByRole('button', { name: '添加到画布（1）' })).toBeEnabled()
})
