import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ComponentPackageData,
  ComponentScope,
} from '../../src/shared/componentTypes'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import { ComponentsTab } from '../../src/renderer/ui/ComponentsTab'
import {
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
    expect(state.componentPackages[PACKAGE_ID]).toBe(imported)

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
})
