import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import { componentDefinitionEntry } from '../../src/renderer/components/insertComponentPackages'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { CapturedCourseTarget, CourseV10ViewState } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

afterEach(cleanup)

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
