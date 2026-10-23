import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { setRootContainers } from '../helpers/glxWorkFixture'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { exportComponentLibraryArchive } from '../../src/core/components/library/archive'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'
import { insertComponentPackagesAtTarget } from '../../src/renderer/components/insertComponentPackages'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import { CourseComponentUnknownError } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { registerFlowMenuCapture } from '../../src/renderer/document/flowWorkspaceRegistry'
import { plainDocumentText } from '../../src/shared/document/content'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import * as packageAuthoring from '../../src/renderer/components/commitComponentPackageAuthoring'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'

const stops: (() => void)[] = []
afterEach(() => { cleanup(); stops.splice(0).reverse().forEach(stop => stop()); vi.restoreAllMocks() })
const jsonText = (text: string) => JSON.parse(JSON.stringify(createTextComponentData(text)))
function project(kind: 'slide' | 'flow' = 'slide') {
  const value = createBlankCourseProjectV10('目标原稿')
  setRootContainers(value, [{ id: 'page', kind, title: '原页', childIds: kind === 'flow' ? ['body'] : [] },
    { id: 'second', kind: 'slide', title: '后来选择', childIds: [] }])
  value.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  if (kind === 'flow') value.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: jsonText('ABCD') }
  return value
}
const entry: ComponentLibraryEntry = {
  schemaVersion: 2, id: 'test-fragment', title: '插入正文',
  // The public format permits omitting kind: it is an ordinary objects entry.
  definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION },
  example: { rootIds: ['sample'], instances: { sample: { id: 'sample', definitionId: TEXT_DEFINITION.id, data: jsonText('插入文字') } } },
  assets: {}, resources: { assets: {}, components: {} },
}
const catalog: AvailableComponentCatalogPackage = {
  packageId: entry.id, version: '1.0.0', name: entry.title, description: '', subject: [], schoolStage: [], tags: [],
  packagePath: 'fragment.h5component', thumbnailPath: '', sha256: '', componentSchemaVersion: 2, runtimeApiVersion: 5,
  renderMode: 'dom', supportedScopes: ['scene'], quality: 'candidate', maintainer: 'fixture', verifiedCases: [],
  sourceId: 'fixture', sourceLabel: '测试库', sourceTrust: 'trusted',
}
function ports(h: Awaited<ReturnType<typeof createV10StoreHost>>): ComponentLibraryPorts {
  return { kernel: h.kernel, desktopAvailable: () => false, loadCatalog: async () => ({ sources: [], packages: [], issues: [] }),
    selectComponentPackage: async () => null, selectComponentPackages: async () => null,
    readCatalogPackage: async () => ({ bytes: exportComponentLibraryArchive(entry), sha256: '' }),
    async runBusy(work) { try { return await work() } catch { return undefined } }, commitStatus: vi.fn(), reportError: vi.fn() }
}

it('keeps a newer page selection after the actual insertion ACK returns', async () => {
  const h = await createV10StoreHost(project()), started = deferred(), gate = deferred()
  stops.push(() => h.bridge.dispose())
  h.controls.after = async () => { started.resolve(); await gate.promise }
  const target = h.kernel.captureTarget()
  const pending = insertComponentPackagesAtTarget(h.kernel, target, [entry])
  await started.promise
  h.bridge.selectSurface(h.first.documentId, 'second')
  gate.resolve()
  expect(await pending).toMatchObject({ ok: true })
  expect(h.bridge.read().surfaceId).toBe('second')
  expect(h.model().project.instances.page.childIds).toHaveLength(1)
  expect(h.first.read().undoDepth).toBe(1)
})

it('carries a picker bookmark into the real Flow insertion even when kind is omitted', async () => {
  const h = await createV10StoreHost(project('flow')), released = vi.fn(), loaded = deferred(), gate = deferred()
  stops.push(() => h.bridge.dispose())
  const point = { blockId: 'body', offset: 2, slot: { kind: 'field' as const, field: 'content' as const }, affinity: 'after' as const }
  stops.push(registerFlowMenuCapture(() => ({ ok: true, documentId: h.first.documentId, projectId: h.model().project.id,
    epoch: h.first.read().epoch, revision: 0, locationId: 'page', surfaceId: 'page', generation: 1,
    selectedBlockId: 'body', selectionSignature: 'body@2', paperWidth: 800, bodyWidth: 728, paragraphRects: [],
    insertionSelection: { read: () => ({ revision: '0', kind: 'text', anchor: point, head: point }), drain: async () => true, release: released } })))
  const p = ports(h)
  p.readCatalogPackage = async () => { loaded.resolve(); await gate.promise; return { bytes: exportComponentLibraryArchive(entry), sha256: '' } }
  const hook = renderHook(() => useComponentLibrary(p))
  let pending!: Promise<boolean>
  act(() => { pending = hook.result.current.addCatalogPackages([catalog], { attemptId: 'picker' }) })
  await loaded.promise
  await act(async () => { gate.resolve(); expect(await pending).toBe(true) })
  const body = projectFlowDocument(h.model().project, 'page').content.blocks
  expect(body.map(block => 'content' in block ? plainDocumentText(block.content) : block.type)).toEqual(['AB', '插入文字', 'CD'])
  expect(released).toHaveBeenCalledOnce()
  expect(h.first.read().undoDepth).toBe(1)
})

it('queries the original unknown attempt without adding twice, while a different document is a new intent', async () => {
  const h = await createV10StoreHost(project()), original = h.kernel.editCaptured
  stops.push(() => h.bridge.dispose())
  let resolved = false
  const resolver = vi.fn(async () => resolved ? 'applied' as const : 'pending' as const)
  const failure = new CourseComponentUnknownError('回执暂未收到', 'original-operation', resolver)
  const submit = vi.spyOn(h.kernel, 'editCaptured').mockImplementationOnce(async captured => { await original(captured); throw failure })
  const p = ports(h), hook = renderHook(() => useComponentLibrary(p))
  await act(async () => { await expect(hook.result.current.addCatalogPackages([catalog], { attemptId: 'first-attempt' })).rejects.toBe(failure) })
  expect(submit).toHaveBeenCalledOnce()
  resolved = true
  await act(async () => { expect(await hook.result.current.addCatalogPackages([catalog], { attemptId: 'first-attempt' })).toBe(true) })
  expect(submit).toHaveBeenCalledOnce()
  // Start another unknown attempt in A, then choose B before resolving it.
  resolved = false
  submit.mockImplementationOnce(async captured => { await original(captured); throw failure })
  await act(async () => { await expect(hook.result.current.addCatalogPackages([catalog], { attemptId: 'next-attempt' })).rejects.toBe(failure) })
  const b = await h.api.create({ kind: 'course-v10', project: project(), resources: { assets: {}, components: {} } }, 'B.glx')
  await act(async () => { await h.bridge.activate(b.documentId) })
  resolved = true
  await act(async () => { expect(await hook.result.current.addCatalogPackages([catalog], { attemptId: 'next-attempt' })).toBe(true) })
  expect(submit).toHaveBeenCalledTimes(3)
  const current = h.registry.get(b.documentId).read().model
  expect(current.kind === 'course-v10' && current.project.instances.page.childIds).toHaveLength(1)
  expect(resolver).toHaveBeenCalled()
})

it('does not consume a new external import click when a previous catalog attempt is confirmed applied', async () => {
  const h = await createV10StoreHost(project()), original = h.kernel.editCaptured
  stops.push(() => h.bridge.dispose())
  let resolved = false
  const failure = new CourseComponentUnknownError('回执暂未收到', 'catalog-operation', async () => resolved ? 'applied' : 'pending')
  vi.spyOn(h.kernel, 'editCaptured').mockImplementationOnce(async captured => { await original(captured); throw failure })
  const p = ports(h)
  p.selectComponentPackages = vi.fn(async () => null)
  const hook = renderHook(() => useComponentLibrary(p))
  await act(async () => { await expect(hook.result.current.addCatalogPackages([catalog], { attemptId: 'catalog' })).rejects.toBe(failure) })
  resolved = true
  await act(async () => { hook.result.current.importExternalPackages(); await Promise.resolve(); await Promise.resolve() })
  expect(p.selectComponentPackages).toHaveBeenCalledOnce()
})

it('retains the exact replacement review on failure and closes only its successful retry', async () => {
  const h = await createV10StoreHost(project())
  stops.push(() => h.bridge.dispose())
  const commit = vi.spyOn(packageAuthoring, 'commitComponentReplacementAtTarget')
    .mockResolvedValueOnce({ ok: false, reason: '尚未应用，审阅仍可继续' }).mockResolvedValueOnce({ ok: true })
  const p = ports(h)
  p.selectComponentPackage = async () => ({ path: 'C:\\fixture\\fragment.h5component', name: 'fragment.h5component', bytes: exportComponentLibraryArchive(entry) })
  const hook = renderHook(() => useComponentLibrary(p))
  await act(async () => { hook.result.current.replacePackage(TEXT_DEFINITION.id) })
  await waitFor(() => expect(hook.result.current.replacementRequest).not.toBeNull())
  const originalReview = hook.result.current.replacementRequest
  await act(async () => { hook.result.current.confirmReplacement() })
  expect(commit).toHaveBeenCalledOnce()
  expect(hook.result.current.replacementRequest).toBe(originalReview)
  await act(async () => { hook.result.current.confirmReplacement() })
  expect(commit).toHaveBeenCalledTimes(2)
  expect(hook.result.current.replacementRequest).toBeNull()
})

it('ends a definite one-shot removal refusal so a concurrent reference remains editable', async () => {
  const h = await createV10StoreHost(project())
  stops.push(() => h.bridge.dispose())
  h.controls.before = async () => {
    h.controls.before = undefined
    const snapshot = h.first.read()
    const result = await h.first.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: 'concurrent-reference', actor: 'agent', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
        [{ type: 'instance.insert', container: { kind: 'surface', surfaceId: 'page' }, index: 0, rootIds: ['new-reference'],
          instances: [{ id: 'new-reference', definitionId: TEXT_DEFINITION.id, data: jsonText('另一处的新引用') }] }]) } })
    expect(result.status).toBe('applied')
  }
  expect(await packageAuthoring.createComponentAuthoringActions(h.kernel).deleteComponentPackage(TEXT_DEFINITION.id)).toBe(false)
  expect(h.model().project.definitions[TEXT_DEFINITION.id]).toBeDefined()
  expect(h.bridge.read().error).toBeNull()
  await h.kernel.edit([{ type: 'instance.patch', instanceId: 'new-reference', patch: { name: '可继续编辑' } }])
  expect(h.model().project.instances['new-reference'].name).toBe('可继续编辑')
})
