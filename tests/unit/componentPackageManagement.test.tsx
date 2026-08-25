import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ComponentPackageData,
  ComponentScope,
} from '../../src/shared/componentTypes'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import { ComponentsTab } from '../../src/renderer/ui/ComponentsTab'
import { collectCourseComponentPackageUsage } from '../../src/renderer/components/courseComponentPackageTransactions'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../../src/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectActiveScene,
  useEditorStore,
} from '../../src/renderer/store/editorStore'

const PACKAGE_ID = 'com.example.managed'

function componentPackage(
  version: string,
  supportedScopes: ComponentScope[] = ['scene', 'global'],
  packageId = PACKAGE_ID,
): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      id: packageId,
      name: packageId === PACKAGE_ID ? '可管理组件' : '备用组件',
      version,
      entry: 'runtime.js',
      defaultSize: { width: 360, height: 220 },
      minSize: { width: 120, height: 80 },
      preserveAspectRatio: true,
      assets: {},
      defaultProps: { label: `默认 ${version}` },
      supportedScopes,
      renderMode: 'phaser',
  }
  const runtimeSource = `window.CoursewareComponent.define({ version: '${version}' })`
  const files = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(runtimeSource),
  }
  return {
    manifest,
    runtimeSource,
    files,
    contentSha256: componentContentSha256(files),
  }
}

function expectComponentPackageContents(
  actual: ComponentPackageData | undefined,
  expected: ComponentPackageData,
): void {
  if (!actual) throw new Error('Expected embedded component package')
  expect(actual.manifest).toEqual(expected.manifest)
  expect(actual.runtimeSource).toBe(expected.runtimeSource)
  expect(actual.contentSha256).toBe(expected.contentSha256)
  expect(Object.keys(actual.files).sort()).toEqual(Object.keys(expected.files).sort())
  for (const [path, bytes] of Object.entries(expected.files)) {
    expect([...actual.files[path]!], path).toEqual([...bytes])
  }
}

function activeCourseProject() {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function clickLocateUsage() {
  fireEvent.click(screen.getByLabelText('管理可管理组件'))
  fireEvent.click(screen.getByRole('menuitem', { name: '定位使用位置' }))
}

function openFlowProjectWithEmbeddedComponentBlock(): { surfaceId: string; blockId: string } {
  useEditorStore.getState().createNewFlowProject()
  useEditorStore.getState().importComponentPackage(componentPackage('1.0.0'))
  const exported = useEditorStore.getState().exportV9SlideCandidateArchive()
  if (!exported) throw new Error('Expected a Flow archive export')
  const archive = openCourseProjectArchive(exported)
  const project = structuredClone(archive.project)
  project.assets['component-fallback'] = {
    id: 'component-fallback',
    filename: 'component-fallback.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/component-fallback.png',
    byteLength: 4,
    width: 2,
    height: 2,
  }
  const surface = project.surfaces.find((candidate) => candidate.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('Expected a Flow surface')
  const blockId = 'flow-component-usage'
  surface.blocks.push({
    id: blockId,
    type: 'component',
    component: { packageId: PACKAGE_ID, version: '1.0.0' },
    props: {},
    staticFallbackAssetId: 'component-fallback',
  })
  const reopened = useEditorStore.getState().reopenV9SlideCandidateArchive(createCourseProjectArchive({
    project,
    assetFiles: { ...archive.assetFiles, 'component-fallback': new Uint8Array([1, 2, 3, 4]) },
    componentFiles: archive.componentFiles,
  }))
  if (!reopened) throw new Error('Expected the crafted Flow project to reopen')
  return { surfaceId: surface.id, blockId }
}

function expectFlowBlockUsageReference(surfaceId: string, blockId: string) {
  const reference = collectCourseComponentPackageUsage(activeCourseProject(), PACKAGE_ID)
    .references[0]
  expect(reference).toMatchObject({
    carrier: 'flow-block',
    scope: 'scene',
    instanceId: blockId,
    surfaceId,
  })
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'professional' })
})

afterEach(() => cleanup())

describe('editorStore component package management', () => {
  it('imports multiple packages in one undoable transaction', () => {
    const first = componentPackage('1.0.0')
    const second = componentPackage('1.0.0', ['scene'], 'com.example.second')

    useEditorStore.getState().importComponentPackages([first, second])
    let state = useEditorStore.getState()
    expect(Object.keys(state.componentPackages)).toEqual([
      PACKAGE_ID,
      'com.example.second',
    ])
    expect(state.history.past).toHaveLength(1)

    state.undo()
    state = useEditorStore.getState()
    expect(state.componentPackages).toEqual({})
    expect(state.project.componentPackages).toEqual({})

    state.redo()
    state = useEditorStore.getState()
    expect(state.componentPackages[PACKAGE_ID]).toBe(first)
    expect(state.componentPackages['com.example.second']).toBe(second)
  })

  it('deletes only unused packages and keeps delete undoable with runtime data', () => {
    const store = useEditorStore.getState()
    const imported = componentPackage('1.0.0')
    store.importComponentPackage(imported)

    expect(store.deleteComponentPackage(PACKAGE_ID)).toBe(true)
    let state = useEditorStore.getState()
    expect(state.project.componentPackages[PACKAGE_ID]).toBeUndefined()
    expect(state.componentPackages[PACKAGE_ID]).toBeUndefined()
    expect(state.history.past).toHaveLength(2)

    state.undo()
    state = useEditorStore.getState()
    expect(state.project.componentPackages[PACKAGE_ID]?.version).toBe('1.0.0')
    expectComponentPackageContents(state.componentPackages[PACKAGE_ID], imported)

    state.redo()
    state = useEditorStore.getState()
    expect(state.project.componentPackages[PACKAGE_ID]).toBeUndefined()
    expect(state.componentPackages[PACKAGE_ID]).toBeUndefined()
  })

  it('blocks deletion while any scene or global instance still references the package', () => {
    const store = useEditorStore.getState()
    store.importComponentPackage(componentPackage('1.0.0'))
    store.addExternalComponentNode(PACKAGE_ID)
    store.setEditingScope('global')
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    const before = structuredClone(useEditorStore.getState().project)
    const historyBefore = useEditorStore.getState().history.past.length

    expect(useEditorStore.getState().deleteComponentPackage(PACKAGE_ID)).toBe(false)
    const state = useEditorStore.getState()
    expect(state.project).toEqual(before)
    expect(state.componentPackages[PACKAGE_ID]).toBeDefined()
    expect(state.history.past).toHaveLength(historyBefore)
    expect(state.errorMessage).toContain('1 个场景实例和 1 个全局实例')
  })

  it('uses one V9 resource transaction for unreferenced Flow and Spatial package deletion', () => {
    const cases = [
      ['Flow', () => useEditorStore.getState().createNewFlowProject()],
      ['Spatial', () => useEditorStore.getState().createNewSpatialProject()],
    ] as const

    for (const [surface, create] of cases) {
      create()
      const imported = componentPackage('1.0.0')
      useEditorStore.getState().importComponentPackage(imported)
      const beforeDocument = structuredClone(activeCourseProject())
      const historyBefore = useEditorStore.getState().history.past.length

      expect(useEditorStore.getState().deleteComponentPackage(PACKAGE_ID), surface).toBe(true)
      expect(activeCourseProject().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(useEditorStore.getState().history.past).toHaveLength(historyBefore + 1)
      const session = surface === 'Flow'
        ? useEditorStore.getState().flowSession
        : useEditorStore.getState().spatialSession
      expect(session?.history.past.at(-1)).toMatchObject({
        kind: 'editor-transaction',
        resourceChanges: {
          componentPackageChanges: [{ packageId: PACKAGE_ID }],
        },
      })

      useEditorStore.getState().undo()
      expect(activeCourseProject()).toEqual(beforeDocument)
      expectComponentPackageContents(
        useEditorStore.getState().componentPackages[PACKAGE_ID],
        imported,
      )

      const restoredArchive = useEditorStore.getState().exportV9SlideCandidateArchive()
      expect(restoredArchive).not.toBeNull()

      useEditorStore.getState().redo()
      expect(activeCourseProject().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()

      const deletedArchive = useEditorStore.getState().exportV9SlideCandidateArchive()
      expect(deletedArchive).not.toBeNull()
      expect(useEditorStore.getState().reopenV9SlideCandidateArchive(restoredArchive!)).toBe(true)
      expect(activeCourseProject()).toEqual(beforeDocument)
      expectComponentPackageContents(
        useEditorStore.getState().componentPackages[PACKAGE_ID],
        imported,
      )
      expect(useEditorStore.getState().reopenV9SlideCandidateArchive(deletedArchive!)).toBe(true)
      expect(activeCourseProject().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()
    }
  })

  it('blocks referenced Flow and Spatial packages without history, document, or success-message writes', () => {
    const cases = [
      ['Flow', () => useEditorStore.getState().createNewFlowProject()],
      ['Spatial', () => useEditorStore.getState().createNewSpatialProject()],
    ] as const

    for (const [surface, create] of cases) {
      create()
      useEditorStore.getState().importComponentPackage(componentPackage('1.0.0'))
      useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
      const beforeDocument = structuredClone(activeCourseProject())
      const beforePackages = structuredClone(useEditorStore.getState().componentPackages)
      const historyBefore = useEditorStore.getState().history.past.length

      expect(useEditorStore.getState().deleteComponentPackage(PACKAGE_ID), surface).toBe(false)
      expect(activeCourseProject()).toEqual(beforeDocument)
      expect(useEditorStore.getState().componentPackages).toEqual(beforePackages)
      expect(useEditorStore.getState().history.past).toHaveLength(historyBefore)
      expect(useEditorStore.getState().statusMessage).toBeNull()
      expect(useEditorStore.getState().errorMessage).toContain('1 个场景实例和 0 个全局实例')
    }
  })

  it('replaces every scene/global instance in one undo step and preserves props', () => {
    const store = useEditorStore.getState()
    const first = componentPackage('1.0.0')
    const second = componentPackage('2.0.0')
    store.importComponentPackage(first)
    store.addExternalComponentNode(PACKAGE_ID)
    const sceneNodeId = selectActiveScene(useEditorStore.getState()).nodes
      .find((node) => node.type === 'external-component')!.id
    useEditorStore.getState().updateNode(sceneNodeId, {
      props: { label: '场景自定义', score: 7 },
    })
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    const globalNodeId = useEditorStore.getState().project.globalLayer
      .find(({ node }) => node.type === 'external-component')!.node.id
    useEditorStore.getState().updateNode(globalNodeId, {
      props: { label: '全局自定义', theme: 'dark' },
    })
    const historyBefore = useEditorStore.getState().history.past.length

    useEditorStore.getState().replaceComponentPackage(PACKAGE_ID, second)
    let state = useEditorStore.getState()
    expect(state.history.past).toHaveLength(historyBefore + 1)
    expect(state.activeTab).toBe('components')
    expect(state.project.componentPackages[PACKAGE_ID]?.version).toBe('2.0.0')
    expect(state.componentPackages[PACKAGE_ID]).toEqual(second)
    expect(state.componentPackages[PACKAGE_ID]).not.toBe(second)
    expect(selectActiveScene(state).nodes.find((node) => node.id === sceneNodeId))
      .toMatchObject({
        component: { packageId: PACKAGE_ID, version: '2.0.0' },
        props: { label: '场景自定义', score: 7 },
      })
    expect(state.project.globalLayer.find(({ node }) => node.id === globalNodeId)?.node)
      .toMatchObject({
        component: { packageId: PACKAGE_ID, version: '2.0.0' },
        props: { label: '全局自定义', theme: 'dark' },
      })

    state.undo()
    state = useEditorStore.getState()
    expect(state.project.componentPackages[PACKAGE_ID]?.version).toBe('1.0.0')
    expect(state.componentPackages[PACKAGE_ID]).toEqual(first)
    expect(state.componentPackages[PACKAGE_ID]).not.toBe(first)
    expect(selectActiveScene(state).nodes.find((node) => node.id === sceneNodeId))
      .toMatchObject({
        component: { version: '1.0.0' },
        props: { label: '场景自定义', score: 7 },
      })

    state.redo()
    state = useEditorStore.getState()
    expect(state.project.componentPackages[PACKAGE_ID]?.version).toBe('2.0.0')
    expect(state.componentPackages[PACKAGE_ID]).toEqual(second)
    expect(state.componentPackages[PACKAGE_ID]).not.toBe(second)
  })

  it('rejects a different ID or incompatible scope without changing the project', () => {
    const store = useEditorStore.getState()
    const first = componentPackage('1.0.0')
    store.importComponentPackage(first)
    store.setEditingScope('global')
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    const before = structuredClone(useEditorStore.getState().project)
    const historyBefore = useEditorStore.getState().history.past.length

    expect(() => useEditorStore.getState().replaceComponentPackage(
      PACKAGE_ID,
      componentPackage('2.0.0', ['scene'], 'com.example.other'),
    )).toThrow('ID 为')
    expect(() => useEditorStore.getState().replaceComponentPackage(
      PACKAGE_ID,
      componentPackage('2.0.0', ['scene']),
    )).toThrow('全局层')

    const state = useEditorStore.getState()
    expect(state.project).toEqual(before)
    expect(state.componentPackages[PACKAGE_ID]).toBe(first)
    expect(state.history.past).toHaveLength(historyBefore)
  })
})

describe('ComponentsTab project component management', () => {
  it('shows version and usage, blocks referenced deletion, and requests replacement', () => {
    const store = useEditorStore.getState()
    store.importComponentPackage(componentPackage('1.0.0'))
    store.addExternalComponentNode(PACKAGE_ID)
    const onReplaceComponent = vi.fn()
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(
        <ComponentsTab
          onReplaceComponent={onReplaceComponent}
        />,
      )

      const manager = screen.getByTestId(`component-package-${PACKAGE_ID}`)
      expect(manager).toHaveTextContent('v1.0.0')
      expect(manager).toHaveTextContent('场景 1 · 全局 0')
      fireEvent.click(screen.getByLabelText('管理可管理组件'))
      expect(screen.getByRole('menuitem', { name: '从工程移除' })).toBeDisabled()

      fireEvent.click(screen.getByRole('menuitem', { name: '替换组件包' }))
      expect(onReplaceComponent).toHaveBeenCalledWith(PACKAGE_ID)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('deletes an unreferenced package from the management list', () => {
    const imported = componentPackage('1.0.0')
    useEditorStore.getState().importComponentPackage(imported)
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab onReplaceComponent={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('管理可管理组件'))
      const deleteButton = screen.getByRole('menuitem', { name: '从工程移除' })
      expect(deleteButton).toBeEnabled()
      fireEvent.click(deleteButton)
      expect(screen.queryByTestId(`component-package-${PACKAGE_ID}`))
        .not.toBeInTheDocument()
      expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('uses the active Flow V9 document to disable deletion for a floating component', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().importComponentPackage(componentPackage('1.0.0'))
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab onReplaceComponent={vi.fn()} />)
      const manager = screen.getByTestId(`component-package-${PACKAGE_ID}`)
      expect(manager).toHaveTextContent('场景 1 · 全局 0')
      fireEvent.click(screen.getByLabelText('管理可管理组件'))
      expect(screen.getByRole('menuitem', { name: '从工程移除' })).toBeDisabled()
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })
})

describe('ComponentsTab locate component usage', () => {
  it('selects a Flow component block that has no location with the same ID', () => {
    const { surfaceId, blockId } = openFlowProjectWithEmbeddedComponentBlock()
    expectFlowBlockUsageReference(surfaceId, blockId)
    expect(activeCourseProject().locations.some((location) =>
      location.kind === 'flow-block' && location.blockId === blockId,
    )).toBe(false)
    expect(useEditorStore.getState().flowSession?.selection.selectedBlockId).not.toBe(blockId)
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab />)
      clickLocateUsage()
      const state = useEditorStore.getState()
      expect(state.flowSession?.selection.surfaceId).toBe(surfaceId)
      expect(state.flowSession?.selection.selectedBlockId).toBe(blockId)
      expect(state.statusMessage).toBe('已定位组件使用位置')
      expect(state.errorMessage).toBeNull()
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('leaves a stale active Flow surface to select the usage block on its own surface', () => {
    const { surfaceId, blockId } = openFlowProjectWithEmbeddedComponentBlock()
    expectFlowBlockUsageReference(surfaceId, blockId)
    useEditorStore.getState().addCourseContent('flow-page')
    const staleSurfaceId = useEditorStore.getState().flowSession?.selection.surfaceId
    expect(staleSurfaceId).toBeDefined()
    expect(staleSurfaceId).not.toBe(surfaceId)
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab />)
      clickLocateUsage()
      const state = useEditorStore.getState()
      expect(state.flowSession?.selection.surfaceId).toBe(surfaceId)
      expect(state.flowSession?.selection.selectedBlockId).toBe(blockId)
      expect(state.statusMessage).toBe('已定位组件使用位置')
      expect(state.errorMessage).toBeNull()
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('reports an actionable failure without document or history writes when the usage surface has no valid location', () => {
    const { surfaceId, blockId } = openFlowProjectWithEmbeddedComponentBlock()
    useEditorStore.getState().addCourseContent('flow-page')
    const exported = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(exported).not.toBeNull()
    const archive = openCourseProjectArchive(exported!)
    const relocated = structuredClone(archive.project)
    const fallbackLocation = relocated.locations.find((location) =>
      location.kind === 'flow-block' && location.surfaceId !== surfaceId,
    )
    if (!fallbackLocation) throw new Error('Expected a fallback Flow location')
    relocated.locations = relocated.locations.filter((location) =>
      location.surfaceId !== surfaceId,
    )
    relocated.startLocationId = fallbackLocation.id
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(createCourseProjectArchive({
      project: relocated,
      assetFiles: archive.assetFiles,
      componentFiles: archive.componentFiles,
    }))).toBe(true)
    expectFlowBlockUsageReference(surfaceId, blockId)
    expect(activeCourseProject().locations.some((location) =>
      location.surfaceId === surfaceId,
    )).toBe(false)
    const beforeDocument = structuredClone(activeCourseProject())
    const historyBefore = useEditorStore.getState().history.past.length
    const flowHistoryBefore = useEditorStore.getState().flowSession?.history.past.length
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab />)
      clickLocateUsage()
      const state = useEditorStore.getState()
      expect(state.statusMessage).toBeNull()
      expect(state.errorMessage).toContain('没有可激活的位置')
      expect(state.flowSession?.selection.surfaceId).toBe(fallbackLocation.surfaceId)
      expect(activeCourseProject()).toEqual(beforeDocument)
      expect(state.history.past).toHaveLength(historyBefore)
      expect(state.flowSession?.history.past).toHaveLength(flowHistoryBefore)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })
})
