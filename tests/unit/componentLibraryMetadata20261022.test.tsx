import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import { componentDefinitionEntry, insertComponentDefinitionAtTarget } from '../../src/renderer/components/insertComponentPackages'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { exportComponentLibraryArchive } from '../../src/core/components/library/archive'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { CapturedCourseTarget, CourseV10ViewState } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function project(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'work', revision: 0, title: 'Work', rootIds: ['example'],
    definitions: {
      implementation: { id: 'implementation', role: 'content', title: '用户组件',
        implementation: { kind: 'source', language: 'javascript', source: 'export default {}' },
        library: { packageId: 'shared-package', version: '1.0.0' } },
      native: { id: 'native', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
    },
    instances: { example: { id: 'example', definitionId: 'implementation', data: { title: '原稿', assetId: 'photo' } } },
    assets: { photo: { id: 'photo', kind: 'image', path: 'assets/photo.png', mimeType: 'image/png', filename: 'photo.png', byteLength: 3 } },
    global: { underlay: [], overlay: [] } }
}

it('lists installed component identities without reading snapshots, resources or extracting packages on project updates', () => {
  const listeners = new Set<() => void>()
  let view = { project: project(), activeDocumentId: 'document' } as CourseV10ViewState
  Object.defineProperty(view, 'views', { get() { throw new Error('Library cards must not read resource snapshots') } })
  const kernel = { bridge: { subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) } },
    readView: () => view, captureTarget: vi.fn(() => { throw new Error('Library cards must not capture documents') }) } as unknown as EditorStoreKernel
  const ports: ComponentLibraryPorts = { kernel, desktopAvailable: () => false,
    selectComponentPackage: async () => null, selectComponentPackages: async () => null,
    loadCatalog: async () => ({ sources: [], packages: [], issues: [] }), readCatalogPackage: vi.fn(),
    runBusy: operation => operation(), commitStatus: vi.fn(), reportError: vi.fn() }
  const hook = renderHook(() => useComponentLibrary(ports))
  expect(hook.result.current.installedEntries).toEqual([{ id: 'shared-package', title: '用户组件', definitionId: 'implementation' }])
  expect(hook.result.current.installedEntries[0]).not.toHaveProperty('definitions')
  act(() => {
    view = { ...view, project: { ...view.project!, revision: 1, title: '局部输入后的作品' } }
    listeners.forEach(listener => listener())
  })
  expect(hook.result.current.installedEntries).toEqual([{ id: 'shared-package', title: '用户组件', definitionId: 'implementation' }])
  expect(kernel.captureTarget).not.toHaveBeenCalled()
  expect(ports.reportError).not.toHaveBeenCalled()
})

it('extracts the chosen definition from its frozen target while preserving its existing package identity and detached resources', () => {
  const selected = project(), bytes = new Uint8Array([1, 2, 3])
  selected.definitions.implementation.implementation = { kind: 'source', language: 'javascript', source: 'export default {}', resourceBindings: { photo: 'photo' } }
  const target: CapturedCourseTarget = { documentId: 'original-document', epoch: 'original-epoch',
    project: selected, editingProject: selected, resources: { assets: { photo: bytes }, components: {} },
    activeStateId: null, surfaceId: null, instanceIds: ['example'], instanceId: 'example' }
  const kernel = { readDocument() { throw new Error('Use the original insertion target') }, readResources() { throw new Error('Use the original resources') } } as unknown as EditorStoreKernel
  const entry = componentDefinitionEntry(kernel, 'implementation', target)
  expect(entry.id).toBe('shared-package')
  expect(entry.title).toBe('用户组件')
  expect(entry.example.instances.example.data).toEqual({ title: '原稿', assetId: 'photo' })
  expect(entry.resources.assets.photo).toEqual(bytes)
  expect(entry.resources.assets.photo).not.toBe(bytes)
  expect(entry.definitions.implementation).not.toBe(selected.definitions.implementation)
  delete selected.definitions.implementation.library
  expect(componentDefinitionEntry(kernel, 'implementation', target).id).toBe('implementation')
})

it('copies the explicitly chosen current instance and never picks the first example when no source is selected', () => {
  const selected = project()
  selected.instances.second = { id: 'second', definitionId: 'implementation', data: { title: '人工修改乙' } }
  const target = { documentId: 'document', epoch: 'epoch', project: selected, editingProject: structuredClone(selected), resources: { assets: {}, components: {} },
    activeStateId: null, surfaceId: null, instanceIds: [], instanceId: null } as CapturedCourseTarget
  target.editingProject.instances.second.data = { title: '当前展示状态乙' }
  const kernel = {} as EditorStoreKernel
  expect(() => componentDefinitionEntry(kernel, 'implementation', target)).toThrow('请选择要复制')
  expect(componentDefinitionEntry(kernel, 'implementation', target, 'second').example.instances.second.data).toEqual({ title: '当前展示状态乙' })
  expect(() => componentDefinitionEntry(kernel, 'native', target, 'second')).toThrow('没有可复制')
})

it('creates from the readable catalog default rather than an edited project instance and preserves explicit copy', async () => {
  const selected = createBlankCourseProjectV10(), surfaceId = selected.rootIds[0]
  selected.definitions.implementation = project().definitions.implementation
  selected.instances.authored = { id: 'authored', definitionId: 'implementation', data: { title: '人工改过的正文' } }
  selected.instances[surfaceId].childIds!.push('authored')
  const target = { documentId: 'document', epoch: 'epoch', project: selected, editingProject: selected, resources: { assets: {}, components: {} },
    activeStateId: null, surfaceId, instanceIds: [], instanceId: null } as CapturedCourseTarget
  let applied: ComponentEdit[] = []
  const editCaptured = vi.fn(async () => {})
  const kernel = { capture(edits: ComponentEdit[]) { applied = edits; return {} }, editCaptured,
    readView: () => ({ activeDocumentId: 'document' }), selectInstances: vi.fn(), setFeedback: vi.fn() } as unknown as EditorStoreKernel
  const archive: ComponentLibraryEntry = { schemaVersion: 2, id: 'shared-package', title: '库默认', definitions: { implementation: selected.definitions.implementation },
    example: { rootIds: ['default'], instances: { default: { id: 'default', definitionId: 'implementation', data: { title: '模板默认正文' } } } }, assets: {}, resources: { assets: {}, components: {} } }
  const catalog: AvailableComponentCatalogPackage = { packageId: 'shared-package', name: '库默认', version: '1.0.0', description: '测试', subject: [], schoolStage: [], tags: [], packagePath: 'default.h5component', thumbnailPath: 'default.svg', sha256: '0'.repeat(64), componentSchemaVersion: 2, runtimeApiVersion: 5,
    renderMode: 'dom', supportedScopes: ['scene'], quality: 'candidate', maintainer: 'test', verifiedCases: [], sourceId: 'trusted:library', sourceLabel: '我的资产库', sourceTrust: 'trusted' }
  const readCatalogPackage = vi.fn(async () => ({ bytes: exportComponentLibraryArchive(archive) }))
  vi.stubGlobal('desktopAPI', { loadComponentCatalog: async () => ({ sources: [], packages: [catalog], issues: [] }), readComponentCatalogPackage: readCatalogPackage })
  expect(await insertComponentDefinitionAtTarget(kernel, target, 'implementation')).toMatchObject({ ok: true })
  expect(readCatalogPackage).toHaveBeenCalledWith({ sourceId: 'trusted:library', packageId: 'shared-package', version: '1.0.0' })
  expect(applied.flatMap(edit => edit.type === 'instance.insert' ? edit.instances : []).map(value => value.data)).toContainEqual({ title: '模板默认正文' })
  expect(selected.instances.authored.data).toEqual({ title: '人工改过的正文' })
  expect(editCaptured).toHaveBeenCalledOnce()
  expect(await insertComponentDefinitionAtTarget(kernel, target, 'implementation', undefined, { sourceInstanceId: 'authored' })).toMatchObject({ ok: true })
  expect(applied.flatMap(edit => edit.type === 'instance.insert' ? edit.instances : []).map(value => value.data)).toContainEqual({ title: '人工改过的正文' })
  expect(readCatalogPackage).toHaveBeenCalledOnce()
})
