import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
} from '../../src/core/drivers/codecs/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectActiveScene,
  useEditorStore,
  selectCandidateGlobalLayerItems,
} from '../../src/renderer/store/editorStore'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { withDefaultComponentController } from '../../src/renderer/components/teacherControllerComponent'
import { createTriageT4StoreHost } from '../helpers/triage-t4-store-host'

import { courseLayerItemToEditorCanvasNode } from '@/renderer/store/slideEditorProjection'

function projectedGlobalLayer(state: Parameters<typeof selectCandidateGlobalLayerItems>[0]) {
  return (selectCandidateGlobalLayerItems(state) ?? []).map((entry) => ({
    ...entry,
    layer: entry.plane ?? 'overlay',
    visibility: {
      mode: entry.visibility.mode,
      sceneIds: entry.visibility.locationIds,
    },
    node: courseLayerItemToEditorCanvasNode(entry.item)!,
  }))
}

/**
 * 2.0 keeps no renderer History: the projection only carries the current
 * document, while undo/redo live on the main-process DocumentSession.
 */
let host: Awaited<ReturnType<typeof createTriageT4StoreHost>>

function activeDocumentSession() {
  const documentId = useEditorStore.getState().courseDocument.documentId
  if (!documentId) throw new Error('expected an active course document')
  return host.registry.get(documentId)
}

function undoDepth(): number {
  return activeDocumentSession().read().undoDepth
}

async function settle(): Promise<void> {
  await useEditorStore.getState().drainCourseDocument()
}

async function navigateHistory(direction: 'undo' | 'redo'): Promise<void> {
  const before = undoDepth()
  useEditorStore.getState()[direction]()
  await waitFor(() => {
    expect(undoDepth()).not.toBe(before)
  })
  await settle()
}

const PACKAGE_ID = 'com.example.managed'
let initialPackages: ReturnType<typeof useEditorStore.getState>['componentPackages']
let initialMetadata: ReturnType<typeof activeCourseProject>['componentPackages']
function managedMenu() { return within(screen.getByLabelText('管理可管理组件').closest('details')!) }

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

/** Byte-level comparison: the host round-trip recreates every package. */
function expectComponentPackageRecord(
  actual: Readonly<Record<string, ComponentPackageData>>,
  expected: Readonly<Record<string, ComponentPackageData>>,
): void {
  expect(Object.keys(actual)).toEqual(Object.keys(expected))
  for (const [packageId, data] of Object.entries(expected)) {
    expectComponentPackageContents(actual[packageId], data)
  }
}

/**
 * 2.0 的 revision 是主进程文档的单调计数器，undo/redo 恢复内容时会重新盖章；
 * updatedAt 也随每次提交刷新。两者都不属于“内容是否还原”的差异。
 */
function documentContent(project: ReturnType<typeof activeCourseProject>) {
  const { revision: _revision, updatedAt: _updatedAt, ...content } = project
  return content
}

function clickLocateUsage() {
  fireEvent.click(screen.getByLabelText('管理可管理组件'))
  fireEvent.click(managedMenu().getByRole('menuitem', { name: '定位使用位置' }))
}

async function openFlowProjectWithEmbeddedComponentBlock(): Promise<{ surfaceId: string; blockId: string }> {
  await useEditorStore.getState().createCourseDocument('flow')
  await settle()
  useEditorStore.getState().importComponentPackage(componentPackage('1.0.0'))
  await settle()
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
  const reopened = await useEditorStore.getState().reopenV9SlideCandidateArchive(createCourseProjectArchive({
    project,
    assetFiles: { ...archive.assetFiles, 'component-fallback': new Uint8Array([1, 2, 3, 4]) },
    componentFiles: archive.componentFiles,
  }))
  if (!reopened) throw new Error('Expected the crafted Flow project to reopen')
  await settle()
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

beforeEach(async () => {
  host = await createTriageT4StoreHost()
  const bundle = withDefaultComponentController(createBlankCourseProject())
  await host.open(bundle.project, Object.values(bundle.componentPackages))
  initialPackages = structuredClone(useEditorStore.getState().componentPackages)
  initialMetadata = structuredClone(activeCourseProject().componentPackages)
})

afterEach(() => cleanup())

describe('editorStore component package management', () => {
  it('imports multiple packages in one undoable transaction', async () => {
    const first = componentPackage('1.0.0')
    const second = componentPackage('1.0.0', ['scene'], 'com.example.second')

    useEditorStore.getState().importComponentPackages([first, second])
    await settle()
    let state = useEditorStore.getState()
    expect(Object.keys(state.componentPackages)).toEqual([
      ...Object.keys(initialPackages), PACKAGE_ID,
      'com.example.second',
    ])
    expect(undoDepth()).toBe(1)

    await navigateHistory('undo')
    state = useEditorStore.getState()
    expectComponentPackageRecord(state.componentPackages, initialPackages)
    expect(selectActiveCourseProjectDocument(state)!.componentPackages).toEqual(initialMetadata)

    await navigateHistory('redo')
    state = useEditorStore.getState()
    expectComponentPackageContents(state.componentPackages[PACKAGE_ID], first)
    expectComponentPackageContents(state.componentPackages['com.example.second'], second)
  })

  it('deletes only unused packages and keeps delete undoable with runtime data', async () => {
    const store = useEditorStore.getState()
    const imported = componentPackage('1.0.0')
    store.importComponentPackage(imported)
    await settle()

    expect(useEditorStore.getState().deleteComponentPackage(PACKAGE_ID)).toBe(true)
    await settle()
    let state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!.componentPackages[PACKAGE_ID]).toBeUndefined()
    expect(state.componentPackages[PACKAGE_ID]).toBeUndefined()
    expect(undoDepth()).toBe(2)

    await navigateHistory('undo')
    state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!.componentPackages[PACKAGE_ID]?.version).toBe('1.0.0')
    expectComponentPackageContents(state.componentPackages[PACKAGE_ID], imported)

    await navigateHistory('redo')
    state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!.componentPackages[PACKAGE_ID]).toBeUndefined()
    expect(state.componentPackages[PACKAGE_ID]).toBeUndefined()
  })

  it('blocks deletion while any scene or global instance still references the package', async () => {
    const store = useEditorStore.getState()
    store.importComponentPackage(componentPackage('1.0.0'))
    await settle()
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    await settle()
    useEditorStore.getState().setEditingScope('global')
    await settle()
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    await settle()
    const before = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState())!)
    const historyBefore = undoDepth()

    expect(useEditorStore.getState().deleteComponentPackage(PACKAGE_ID)).toBe(false)
    const state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!).toEqual(before)
    expect(state.componentPackages[PACKAGE_ID]).toBeDefined()
    expect(undoDepth()).toBe(historyBefore)
    expect(state.errorMessage).toContain('1 个场景实例和 1 个全局实例')
  })

  it('uses one V9 resource transaction for unreferenced Flow and Spatial package deletion', async () => {
    const cases = [
      ['Flow', async () => { await useEditorStore.getState().createCourseDocument('flow') }],
      ['Spatial', async () => { await useEditorStore.getState().createCourseDocument('spatial') }],
    ] as const

    for (const [surface, create] of cases) {
      await create()
      await settle()
      const imported = componentPackage('1.0.0')
      useEditorStore.getState().importComponentPackage(imported)
      await settle()
      const beforeDocument = structuredClone(activeCourseProject())
      const historyBefore = undoDepth()

      expect(useEditorStore.getState().deleteComponentPackage(PACKAGE_ID), surface).toBe(true)
      await settle()
      expect(activeCourseProject().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(undoDepth(), surface).toBe(historyBefore + 1)
      // One history step owns both the project metadata and the package bytes:
      // a single undo has to restore the archive exactly.
      const committed = activeDocumentSession().read().model
      if (committed.kind !== 'course-v9') throw new Error('Expected a Course Project V9 document')
      expect(committed.project.componentPackages[PACKAGE_ID], surface).toBeUndefined()
      expect(
        Object.keys(committed.resources.components).some(key => key.startsWith(`${PACKAGE_ID}@`)),
        surface,
      ).toBe(false)

      await navigateHistory('undo')
      expect(documentContent(activeCourseProject())).toEqual(documentContent(beforeDocument))
      expectComponentPackageContents(
        useEditorStore.getState().componentPackages[PACKAGE_ID],
        imported,
      )

      const restoredArchive = useEditorStore.getState().exportV9SlideCandidateArchive()
      expect(restoredArchive).not.toBeNull()

      await navigateHistory('redo')
      expect(activeCourseProject().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()

      const deletedArchive = useEditorStore.getState().exportV9SlideCandidateArchive()
      expect(deletedArchive).not.toBeNull()
      expect(await useEditorStore.getState().reopenV9SlideCandidateArchive(restoredArchive!)).toBe(true)
      await settle()
      expect(documentContent(activeCourseProject())).toEqual(documentContent(beforeDocument))
      expectComponentPackageContents(
        useEditorStore.getState().componentPackages[PACKAGE_ID],
        imported,
      )
      expect(await useEditorStore.getState().reopenV9SlideCandidateArchive(deletedArchive!)).toBe(true)
      await settle()
      expect(activeCourseProject().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()
    }
  })

  it('blocks referenced Flow and Spatial packages without history, document, or success-message writes', async () => {
    const cases = [
      ['Flow', async () => { await useEditorStore.getState().createCourseDocument('flow') }],
      ['Spatial', async () => { await useEditorStore.getState().createCourseDocument('spatial') }],
    ] as const

    for (const [surface, create] of cases) {
      await create()
      await settle()
      useEditorStore.getState().importComponentPackage(componentPackage('1.0.0'))
      await settle()
      useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
      await settle()
      const beforeDocument = structuredClone(activeCourseProject())
      const beforePackages = structuredClone(useEditorStore.getState().componentPackages)
      const historyBefore = undoDepth()

      expect(useEditorStore.getState().deleteComponentPackage(PACKAGE_ID), surface).toBe(false)
      expect(activeCourseProject()).toEqual(beforeDocument)
      expectComponentPackageRecord(useEditorStore.getState().componentPackages, beforePackages)
      expect(undoDepth(), surface).toBe(historyBefore)
      expect(useEditorStore.getState().statusMessage).toBeNull()
      expect(useEditorStore.getState().errorMessage).toContain('1 个场景实例和 0 个全局实例')
    }
  })

  it('replaces every scene/global instance in one undo step and preserves props', async () => {
    const store = useEditorStore.getState()
    const first = componentPackage('1.0.0')
    const second = componentPackage('2.0.0')
    store.importComponentPackage(first)
    await settle()
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    await settle()
    const sceneNodeId = selectActiveScene(useEditorStore.getState()).nodes
      .find((node) => node.type === 'external-component')!.id
    useEditorStore.getState().updateNode(sceneNodeId, {
      props: { label: '场景自定义', score: 7 },
    })
    await settle()
    useEditorStore.getState().setEditingScope('global')
    await settle()
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    await settle()
    const globalNodeId = projectedGlobalLayer(useEditorStore.getState())
      .find(({ node }) => node.type === 'external-component' && node.component?.packageId === PACKAGE_ID)!.node.id
    useEditorStore.getState().updateNode(globalNodeId, {
      props: { label: '全局自定义', theme: 'dark' },
    })
    await settle()
    const historyBefore = undoDepth()

    useEditorStore.getState().replaceComponentPackage(PACKAGE_ID, second)
    await settle()
    let state = useEditorStore.getState()
    expect(undoDepth()).toBe(historyBefore + 1)
    expect(state.activeTab).toBe('components')
    expect(selectActiveCourseProjectDocument(state)!.componentPackages[PACKAGE_ID]?.version).toBe('2.0.0')
    expectComponentPackageContents(state.componentPackages[PACKAGE_ID], second)
    expect(state.componentPackages[PACKAGE_ID]).not.toBe(second)
    expect(selectActiveScene(state).nodes.find((node) => node.id === sceneNodeId))
      .toMatchObject({
        component: { packageId: PACKAGE_ID, version: '2.0.0' },
        props: { label: '场景自定义', score: 7 },
      })
    expect(projectedGlobalLayer(state).find(({ node }) => node.id === globalNodeId)?.node)
      .toMatchObject({
        component: { packageId: PACKAGE_ID, version: '2.0.0' },
        props: { label: '全局自定义', theme: 'dark' },
      })

    await navigateHistory('undo')
    state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!.componentPackages[PACKAGE_ID]?.version).toBe('1.0.0')
    expectComponentPackageContents(state.componentPackages[PACKAGE_ID], first)
    expect(state.componentPackages[PACKAGE_ID]).not.toBe(first)
    expect(selectActiveScene(state).nodes.find((node) => node.id === sceneNodeId))
      .toMatchObject({
        component: { version: '1.0.0' },
        props: { label: '场景自定义', score: 7 },
      })

    await navigateHistory('redo')
    state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!.componentPackages[PACKAGE_ID]?.version).toBe('2.0.0')
    expectComponentPackageContents(state.componentPackages[PACKAGE_ID], second)
    expect(state.componentPackages[PACKAGE_ID]).not.toBe(second)
  })

  it('rejects a different ID or incompatible scope without changing the project', async () => {
    const store = useEditorStore.getState()
    const first = componentPackage('1.0.0')
    store.importComponentPackage(first)
    await settle()
    useEditorStore.getState().setEditingScope('global')
    await settle()
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    await settle()
    const before = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState())!)
    const historyBefore = undoDepth()

    expect(() => useEditorStore.getState().replaceComponentPackage(
      PACKAGE_ID,
      componentPackage('2.0.0', ['scene'], 'com.example.other'),
    )).toThrow('ID 为')
    expect(() => useEditorStore.getState().replaceComponentPackage(
      PACKAGE_ID,
      componentPackage('2.0.0', ['scene']),
    )).toThrow('全局层')

    const state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!).toEqual(before)
    expectComponentPackageContents(state.componentPackages[PACKAGE_ID], first)
    expect(undoDepth()).toBe(historyBefore)
  })
})

describe('ComponentsTab project component management', () => {
  it('shows version and usage, blocks referenced deletion, and requests replacement', async () => {
    useEditorStore.getState().importComponentPackage(componentPackage('1.0.0'))
    await settle()
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    await settle()
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
      expect(managedMenu().getByRole('menuitem', { name: '从工程移除' })).toBeDisabled()

      fireEvent.click(managedMenu().getByRole('menuitem', { name: '替换组件包' }))
      expect(onReplaceComponent).toHaveBeenCalledWith(PACKAGE_ID)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('deletes an unreferenced package from the management list', async () => {
    const imported = componentPackage('1.0.0')
    useEditorStore.getState().importComponentPackage(imported)
    await settle()
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab onReplaceComponent={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('管理可管理组件'))
      const deleteButton = managedMenu().getByRole('menuitem', { name: '从工程移除' })
      expect(deleteButton).toBeEnabled()
      fireEvent.click(deleteButton)
      await waitFor(() => {
        expect(screen.queryByTestId(`component-package-${PACKAGE_ID}`))
          .not.toBeInTheDocument()
      })
      await settle()
      expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()
      expect(undoDepth()).toBe(2)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('uses the active Flow V9 document to disable deletion for a floating component', async () => {
    await useEditorStore.getState().createCourseDocument('flow')
    await settle()
    useEditorStore.getState().importComponentPackage(componentPackage('1.0.0'))
    await settle()
    useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
    await settle()
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab onReplaceComponent={vi.fn()} />)
      const manager = screen.getByTestId(`component-package-${PACKAGE_ID}`)
      expect(manager).toHaveTextContent('场景 1 · 全局 0')
      fireEvent.click(screen.getByLabelText('管理可管理组件'))
      expect(managedMenu().getByRole('menuitem', { name: '从工程移除' })).toBeDisabled()
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })
})

describe('ComponentsTab locate component usage', () => {
  it('selects a Flow component block that has no location with the same ID', async () => {
    const { surfaceId, blockId } = await openFlowProjectWithEmbeddedComponentBlock()
    expectFlowBlockUsageReference(surfaceId, blockId)
    const targetLocation = activeCourseProject().locations.find((location) => (
      location.kind === 'flow-block' && location.surfaceId === surfaceId
    ))
    if (!targetLocation) throw new Error('Expected a target Flow location')
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
      expect(state.flowSession?.selection.locationId).toBe(targetLocation.id)
      expect(state.flowSession?.selection.selectedBlockId).toBe(blockId)
      expect(state.statusMessage).toBe('已定位组件使用位置')
      expect(state.errorMessage).toBeNull()
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('does not bypass a composing location-switch refusal on the same Flow surface', async () => {
    const { surfaceId, blockId } = await openFlowProjectWithEmbeddedComponentBlock()
    expectFlowBlockUsageReference(surfaceId, blockId)
    const exported = useEditorStore.getState().exportV9SlideCandidateArchive()
    if (!exported) throw new Error('Expected a Flow archive export')
    const archive = openCourseProjectArchive(exported)
    const project = structuredClone(archive.project)
    const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
    if (!surface || surface.type !== 'flow') throw new Error('Expected the usage Flow surface')
    const currentBlockId = 'flow-composing-current-block'
    const currentLocationId = 'flow-composing-current-location'
    surface.blocks.push({ id: currentBlockId, type: 'paragraph', content: { inlines: [{ type: 'text', text: '输入中的段落' }] } })
    project.locations.push({
      id: currentLocationId,
      label: '输入中的位置',
      kind: 'flow-block',
      surfaceId,
      blockId: currentBlockId,
    })
    project.startLocationId = currentLocationId
    expect(await useEditorStore.getState().reopenV9SlideCandidateArchive(createCourseProjectArchive({
      project,
      assetFiles: archive.assetFiles,
      componentFiles: archive.componentFiles,
    }))).toBe(true)
    await settle()
    const active = useEditorStore.getState()
    expect(active.flowSession?.selection.locationId).toBe(currentLocationId)
    const composingEdit = {
      kind: 'rich-text' as const,
      source: 'paper' as const,
      blockId: currentBlockId,
      surfaceId,
      parentId: null,
      field: 'text' as const,
      composing: true,
      pendingAction: null,
      pendingStyle: {},
      revision: activeCourseProject().revision,
      original: { text: '输入中的段落', runs: [] },
      draft: { text: '尚未提交的拼音草稿', runs: [] },
      range: { start: 0, end: 0 },
    }
    useEditorStore.setState({ flowTextEdit: composingEdit })
    const beforeDocument = structuredClone(activeCourseProject())
    const flowHistoryBefore = undoDepth()
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab />)
      clickLocateUsage()
      const state = useEditorStore.getState()
      expect(state.statusMessage).toBeNull()
      expect(state.errorMessage).toContain('无法切换')
      expect(state.flowSession?.selection.locationId).toBe(currentLocationId)
      expect(state.flowSession?.selection.selectedBlockId).toBe(currentBlockId)
      expect(state.flowSession?.selection.selectedBlockId).not.toBe(blockId)
      expect(state.flowTextEdit).toBe(composingEdit)
      expect(activeCourseProject()).toEqual(beforeDocument)
      expect(undoDepth()).toBe(flowHistoryBefore)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('leaves a stale active Flow surface to select the usage block on its own surface', async () => {
    const { surfaceId, blockId } = await openFlowProjectWithEmbeddedComponentBlock()
    expectFlowBlockUsageReference(surfaceId, blockId)
    useEditorStore.getState().addCourseContent('flow-page')
    await settle()
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

  it('reports an actionable failure without document or history writes when the usage surface has no valid location', async () => {
    const { surfaceId, blockId } = await openFlowProjectWithEmbeddedComponentBlock()
    useEditorStore.getState().addCourseContent('flow-page')
    await settle()
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
    expect(await useEditorStore.getState().reopenV9SlideCandidateArchive(createCourseProjectArchive({
      project: relocated,
      assetFiles: archive.assetFiles,
      componentFiles: archive.componentFiles,
    }))).toBe(true)
    await settle()
    expectFlowBlockUsageReference(surfaceId, blockId)
    expect(activeCourseProject().locations.some((location) =>
      location.surfaceId === surfaceId,
    )).toBe(false)
    const beforeDocument = structuredClone(activeCourseProject())
    const flowHistoryBefore = undoDepth()
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
      expect(undoDepth()).toBe(flowHistoryBefore)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })
})


describe('add component packages directly to the current canvas', () => {
  it.each(['slide', 'flow', 'spatial'] as const)('inserts a %s instance and its package in one saveable history step', async surface => {
    if (surface !== 'slide') await useEditorStore.getState().createCourseDocument(surface)
    await settle()
    const data = componentPackage('1.0.0')
    const before = activeCourseProject()
    const target = useEditorStore.getState().captureComponentInsertionTarget()!
    const result = useEditorStore.getState().insertComponentPackagesAtTarget(target, [data])
    expect(result.ok, result.reason).toBe(true)
    expect(result.layerItemIds).toHaveLength(1)
    await settle()
    expect(activeCourseProject().revision).toBe(before.revision + 1)
    expect(collectCourseComponentPackageUsage(activeCourseProject(), PACKAGE_ID).references).toHaveLength(1)
    const bytes = useEditorStore.getState().exportV9SlideCandidateArchive()!
    const reopened = openCourseProjectArchive(bytes)
    expect(collectCourseComponentPackageUsage(reopened.project, PACKAGE_ID).references).toHaveLength(1)
    await navigateHistory('undo')
    expect(documentContent(activeCourseProject())).toEqual(documentContent(before))
    expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeUndefined()
    await navigateHistory('redo')
    expect(collectCourseComponentPackageUsage(activeCourseProject(), PACKAGE_ID).references).toHaveLength(1)
    expectComponentPackageContents(useEditorStore.getState().componentPackages[PACKAGE_ID], data)
  })

  it('reuses an embedded package and undoes only the new instance', async () => {
    const data = componentPackage('1.0.0')
    for (let i = 0; i < 2; i++) {
      const target = useEditorStore.getState().captureComponentInsertionTarget()!
      expect(useEditorStore.getState().insertComponentPackagesAtTarget(target, [data]).ok).toBe(true)
      await settle()
    }
    expect(Object.keys(activeCourseProject().componentPackages)).toEqual([...Object.keys(initialMetadata), PACKAGE_ID])
    expect(collectCourseComponentPackageUsage(activeCourseProject(), PACKAGE_ID).references).toHaveLength(2)
    await navigateHistory('undo')
    expect(collectCourseComponentPackageUsage(activeCourseProject(), PACKAGE_ID).references).toHaveLength(1)
    expect(useEditorStore.getState().componentPackages[PACKAGE_ID]).toBeDefined()
  })

  it.each(['revision', 'owner', 'project'] as const)('rejects a late addition after a %s change without embedding anything', async change => {
    const target = useEditorStore.getState().captureComponentInsertionTarget()!
    if (change === 'revision') useEditorStore.getState().addTextNode()
    if (change === 'owner') useEditorStore.getState().setEditingScope('global')
    if (change === 'project') await useEditorStore.getState().createCourseDocument('slide')
    await settle()
    const before = activeCourseProject()
    expect(useEditorStore.getState().insertComponentPackagesAtTarget(target, [componentPackage('1.0.0')]).ok).toBe(false)
    expect(activeCourseProject()).toEqual(before)
    expectComponentPackageRecord(useEditorStore.getState().componentPackages, initialPackages)
  })

  it('rolls back the whole batch if one component cannot be placed', async () => {
    useEditorStore.getState().setEditingScope('global')
    await settle()
    const before = activeCourseProject()
    const target = useEditorStore.getState().captureComponentInsertionTarget()!
    const result = useEditorStore.getState().insertComponentPackagesAtTarget(target, [
      componentPackage('1.0.0'), componentPackage('1.0.0', ['scene'], 'com.example.scene-only'),
    ])
    expect(result.ok).toBe(false)
    expect(activeCourseProject()).toEqual(before)
    expectComponentPackageRecord(useEditorStore.getState().componentPackages, initialPackages)
  })
})
