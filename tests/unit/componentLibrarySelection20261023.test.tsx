import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { exportComponentLibraryArchive } from '../../src/core/components/library/archive'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import type { CapturedComponentOperation, CapturedCourseTarget, CourseV10ViewState } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { ComponentLibraryDialog } from '../../src/renderer/ui/ComponentsTab'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentModel } from '../../src/shared/workbench/document'

afterEach(cleanup)

const catalogEntry: AvailableComponentCatalogPackage = {
  packageId: 'selection-card', version: '1.0.0', name: '目录图文卡片', description: '可以继续编辑的目录示例。',
  subject: [], schoolStage: [], tags: [], packagePath: 'selection-card.h5component', thumbnailPath: '', sha256: '',
  componentSchemaVersion: 2, runtimeApiVersion: 5, renderMode: 'dom', supportedScopes: ['scene'], quality: 'candidate',
  maintainer: '', verifiedCases: [], sourceId: 'personal', sourceLabel: '我的资产库', sourceTrust: 'trusted',
}
const card: ComponentLibraryEntry = {
  schemaVersion: 2, id: catalogEntry.packageId, title: catalogEntry.name, kind: 'objects',
  definitions: { card: { id: 'card', title: catalogEntry.name, role: 'content',
    implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){return {update(){},dispose(){}}}}' } } },
  example: { rootIds: ['card'], instances: { card: { id: 'card', definitionId: 'card', name: '目录示例',
    data: { title: '目录正文' }, frame: { width: 120, height: 80, transform: [1, 0, 0, 1, 0, 0] } } } },
  assets: {}, resources: { assets: {}, components: {} },
}

it('keeps mixed selections across filtering and retries through one shared add callback per submission', async () => {
  const onAdd = vi.fn().mockRejectedValueOnce(new Error('提交失败，原选择保留')).mockResolvedValueOnce(true)
  const onClose = vi.fn()
  render(<ComponentLibraryDialog catalog={{ sources: [], packages: [catalogEntry], issues: [] }} components={{}} onAdd={onAdd} onClose={onClose} />)
  fireEvent.click(screen.getByLabelText('选择自主 Web 程序'))
  fireEvent.click(screen.getByLabelText(`选择${catalogEntry.name}`))
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组件' }), { target: { value: '目录图文' } })
  expect(screen.queryByLabelText('选择自主 Web 程序')).toBeNull()
  expect(screen.getByText('已选择 2 项')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '添加所选（2）' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('提交失败，原选择保留')
  expect(onAdd).toHaveBeenCalledTimes(1)
  expect(onAdd).toHaveBeenCalledWith([catalogEntry], { builtInAssetIds: ['guoling.work.program'], attemptId: expect.any(String) })
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText(`选择${catalogEntry.name}`)).toBeChecked()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组件' }), { target: { value: '' } })
  expect(screen.getByLabelText('选择自主 Web 程序')).toBeChecked()
  expect(screen.getByRole('button', { name: '添加所选（2）' })).toBeEnabled()

  fireEvent.click(screen.getByRole('button', { name: '添加所选（2）' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(onAdd).toHaveBeenCalledTimes(2)
  expect(onAdd.mock.calls[1][1].attemptId).toBe(onAdd.mock.calls[0][1].attemptId)
})

it('selects ordinary assets without choosing a transition and keeps explicit transition choices exclusive across filtering', async () => {
  const onAdd = vi.fn(async () => true)
  const project = insertionHarness(true).model().project
  render(<ComponentLibraryDialog catalog={{ sources: [], packages: [], issues: [] }} components={project.definitions} project={project} navigationTargetId="navigation" onAdd={onAdd} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '全选普通条目' }))
  expect(screen.getByLabelText('选择自主 Web 程序')).toBeChecked()
  expect(screen.getByLabelText('选择淡入淡出转场')).not.toBeChecked()
  expect(screen.getByLabelText('选择滑动转场')).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  fireEvent.click(screen.getByLabelText('选择自主 Web 程序'))
  fireEvent.click(screen.getByLabelText('选择淡入淡出转场'))
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组件' }), { target: { value: '滑动转场' } })
  fireEvent.click(screen.getByLabelText('选择滑动转场'))
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组件' }), { target: { value: '' } })
  expect(screen.getByLabelText('选择淡入淡出转场')).not.toBeChecked()
  expect(screen.getByLabelText('选择滑动转场')).toBeChecked()
  expect(screen.getByLabelText('选择自主 Web 程序')).toBeChecked()
  expect(screen.getByText('已选择 2 项')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全选普通条目' }))
  expect(screen.getByLabelText('选择滑动转场')).toBeChecked()
  expect(screen.getByLabelText('选择淡入淡出转场')).not.toBeChecked()
})

function insertionHarness(selectedNavigation = false) {
  const project: CourseProjectV10 = {
    schemaVersion: 11, id: 'selection-work', title: '选择插入', revision: 0,
    definitions: {
      page: { id: 'page', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      navigation: { id: 'navigation', role: 'content', implementation: { kind: 'builtin', key: 'guoling.navigation' } },
    },
    instances: {
      page: { id: 'page', definitionId: 'page', data: {}, childIds: [], container: { kind: 'slide' } },
      navigation: { id: 'navigation', definitionId: 'navigation', data: { buttons: [{ id: 'next', label: '继续', action: { type: 'step.next' } }] } },
    },
    rootIds: ['page'], entry: { rootInstanceId: 'page' }, assets: {}, global: { underlay: [], overlay: ['navigation'] },
  }
  const driver = new CourseV10Driver()
  let model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
  let view = { project, activeDocumentId: 'document', views: [{ documentId: 'document', model }] } as unknown as CourseV10ViewState
  const listeners = new Set<() => void>()
  const editCaptured = vi.fn(async (captured: CapturedComponentOperation) => {
    const { documentId: _documentId, epoch: _epoch, ...command } = captured
    model = driver.apply(model, command) as typeof model
    view = { ...view, project: model.project, views: [{ ...view.views[0], model }] }
    listeners.forEach(listener => listener())
    return { status: 'applied', revision: model.project.revision }
  })
  const kernel = {
    bridge: { subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) } },
    readView: () => view,
    captureTarget: (): CapturedCourseTarget => ({ documentId: 'document', epoch: 'epoch', project: model.project,
      editingProject: model.project, resources: model.resources, activeStateId: null, surfaceId: 'page',
      instanceIds: selectedNavigation ? ['navigation'] : [], instanceId: selectedNavigation ? 'navigation' : null }),
    capture: (edits: ComponentEdit[], target: CapturedCourseTarget) => ({ ...captureComponentOperation(target.project, edits), documentId: target.documentId, epoch: target.epoch }),
    editCaptured, selectInstances: vi.fn(), setFeedback: vi.fn(),
  } as unknown as EditorStoreKernel
  const reportError = vi.fn()
  const ports: ComponentLibraryPorts = {
    kernel, desktopAvailable: () => false, loadCatalog: async () => ({ sources: [], packages: [], issues: [] }),
    selectComponentPackage: async () => null, selectComponentPackages: async () => null,
    readCatalogPackage: vi.fn(async () => ({ bytes: exportComponentLibraryArchive(card), sha256: '' })),
    capturePlacement: vi.fn(() => ({ center: { x: 400, y: 300 } })),
    async runBusy(operation) { try { return await operation() } catch (error) { reportError(String(error)); return undefined } },
    commitStatus: vi.fn(), reportError,
  }
  return { ports, editCaptured, model: () => model, reopen: () => driver.load(driver.serialize(model)), reportError }
}

it('commits builtin and catalog selections in one captured operation and reopens both editable examples', async () => {
  const harness = insertionHarness()
  const hook = renderHook(() => useComponentLibrary(harness.ports))
  await act(async () => expect(await hook.result.current.addCatalogPackages([catalogEntry], { builtInAssetIds: ['guoling.work.program'] })).toBe(true))
  expect(harness.editCaptured).toHaveBeenCalledTimes(1)
  expect(harness.ports.capturePlacement).toHaveBeenCalledTimes(1)
  const reopened = harness.reopen()
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10 document')
  const children = reopened.project.instances.page.childIds!.map(id => reopened.project.instances[id])
  expect(children.map(instance => instance.data)).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: '输入、运动与记录', speed: 1 }), { title: '目录正文' },
  ]))
  expect(children).toHaveLength(2)
  for (const instance of children) {
    expect(reopened.project.definitions[instance.definitionId].implementation.kind).toBe('source')
    expect(instance.frame!.transform[4] + instance.frame!.width / 2).toBe(400)
    expect(instance.frame!.transform[5] + instance.frame!.height / 2).toBe(300)
  }
  expect(harness.reportError).not.toHaveBeenCalled()
})

it('attaches a selected transition to its captured navigation and leaves the whole batch untouched without a target', async () => {
  const attached = insertionHarness(true)
  const hook = renderHook(() => useComponentLibrary(attached.ports))
  await act(async () => expect(await hook.result.current.addCatalogPackages([], { builtInAssetIds: ['guoling.work.transition.fade'] })).toBe(true))
  expect(attached.editCaptured).toHaveBeenCalledTimes(1)
  expect(attached.editCaptured.mock.calls[0][0].edits.map(edit => edit.type)).toEqual(['data.set'])
  const reopened = attached.reopen()
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10 document')
  expect(Object.keys(reopened.project.instances)).toEqual(['page', 'navigation'])
  expect(reopened.project.instances.navigation.data).toMatchObject({ buttons: [{ action: { transition: { effect: 'fade' } } }] })

  const invalid = insertionHarness()
  const before = invalid.model()
  const invalidHook = renderHook(() => useComponentLibrary(invalid.ports))
  await act(async () => expect(invalidHook.result.current.addCatalogPackages([], {
    builtInAssetIds: ['guoling.work.program', 'guoling.work.transition.fade'],
  })).rejects.toThrow('请选择实际导航控件或互动规则作为转场目标。'))
  expect(invalid.editCaptured).not.toHaveBeenCalled()
  expect(invalid.model()).toBe(before)
  expect(invalid.reportError).toHaveBeenCalledWith(expect.stringContaining('请选择实际导航控件或互动规则'))
})
