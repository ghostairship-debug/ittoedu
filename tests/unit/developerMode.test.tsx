import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentPackageData } from '../../src/shared/componentTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import { RightSidebar } from '../../src/renderer/ui/RightSidebar'
import { DeveloperTab } from '../../src/renderer/ui/DeveloperTab'
import {
  editableComponentPackageId,
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActiveScene,
  useEditorStore,
} from '../../src/renderer/store/editorStore'

const originalUpdateRuntimeSourceAtTarget =
  useEditorStore.getState().updateRuntimeSourceAtTarget

function refreshCourseAuthoringLocation(): void {
  const locationId = selectActiveCourseLocationId(useEditorStore.getState())
  if (locationId) useEditorStore.getState().activateCourseLocation(locationId)
}

function installSceneRuntime(
  sceneId: string,
  source: string,
): void {
  useEditorStore.getState().setSceneRuntime(sceneId, {
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: 'phaser',
    source,
    content: { values: {} },
    assets: {},
  })
  refreshCourseAuthoringLocation()
}

function installGlobalRuntime(source: string): void {
  useEditorStore.getState().setGlobalRuntime({
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: 'phaser',
    source,
    content: { values: {} },
    assets: {},
  })
  refreshCourseAuthoringLocation()
}

function editableSource(id: string, marker = ''): string {
  return `window.CoursewareComponent.define({id:${JSON.stringify(id)},runtimeApiVersion:4,create(){${marker};return{destroy(){}}}})`
}

function componentPackage(
  id = 'com.example.developer',
): ComponentPackageData {
  const manifest = {
    schemaVersion: 4 as const,
    runtimeApiVersion: 4 as const,
    id,
    name: '开发测试组件',
    version: '4.0.0',
    entry: 'runtime.js',
    defaultSize: { width: 320, height: 180 },
    minSize: { width: 16, height: 16 },
    preserveAspectRatio: false,
    assets: {},
    defaultProps: { content: { title: '标题' } },
    supportedScopes: ['scene', 'global'] as Array<'scene' | 'global'>,
    renderMode: 'phaser' as const,
    editor: {
      properties: [
        { key: 'content.title', label: '标题', type: 'text' as const },
      ],
    },
  }
  const runtimeSource = editableSource(manifest.id)
  return {
    manifest,
    runtimeSource,
    files: {
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      'runtime.js': new TextEncoder().encode(runtimeSource),
    },
  }
}

function domComponentPackage(): ComponentPackageData {
  const source = componentPackage('com.example.developer-dom')
  const manifest = {
    ...source.manifest,
    renderMode: 'dom' as const,
  }
  const runtimeSource = editableSource(manifest.id)
  return {
    ...source,
    manifest,
    runtimeSource,
    files: {
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      'runtime.js': new TextEncoder().encode(runtimeSource),
    },
  }
}

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    updateRuntimeSourceAtTarget: originalUpdateRuntimeSourceAtTarget,
  })
  useEditorStore.getState().createNewProject()
})

describe('专业开发模式', () => {
  it('生成的可编辑副本 ID 会消除随机后缀中的分隔符边界', () => {
    expect(editableComponentPackageId('com.example.widget', '-A_b-')).toBe(
      'com.example.widget.editable.xaxbx',
    )
  })

  it('专业模式显示开发工作流，切回简洁模式时安全返回属性', () => {
    useEditorStore.getState().createNewProject()
    useEditorStore.setState({
      editorMode: 'professional',
      activeTab: 'properties',
    })
    render(
      <RightSidebar
        onAddImage={() => undefined}
        onReplaceImage={() => undefined}
        onAddVideo={() => undefined}
        onImportAudio={() => undefined}
        onImportVideo={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: '开发' }))
    expect(screen.getByTestId('developer-tab')).toBeInTheDocument()
    expect(screen.getByText('工程开发工作台')).toBeInTheDocument()
    expect(screen.getByLabelText('编辑面板')).toHaveClass(
      'right-sidebar--developer',
    )
    expect(screen.getByRole('tab', { name: /运行时/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: /对象 JSON/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /规则 JSON/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /组件代码/ })).toBeInTheDocument()
    useEditorStore.getState().setEditorMode('simple')
    expect(useEditorStore.getState().activeTab).toBe('properties')
  })

  it('场景运行时源码更新进入正常撤销历史', () => {
    useEditorStore.getState().createNewProject()
    const scene = selectActiveScene(useEditorStore.getState())
    const initialSource =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})'
    const nextSource =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){ctx.emit("ready");return{destroy(){}}}})'
    installSceneRuntime(scene.id, initialSource)
    useEditorStore.getState().updateSceneRuntime(scene.id, { source: nextSource })
    expect(selectActiveScene(useEditorStore.getState()).runtime?.source).toBe(nextSource)

    useEditorStore.getState().undo()
    expect(selectActiveScene(useEditorStore.getState()).runtime?.source).toBe(initialSource)
  })

  it('代码编辑器拒绝模块语法，只提交通过校验的运行时源码', () => {
    useEditorStore.getState().createNewProject()
    const scene = selectActiveScene(useEditorStore.getState())
    const initialSource =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})'
    const validSource =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){ctx.emit("ok");return{destroy(){}}}})'
    installSceneRuntime(scene.id, initialSource)
    render(<DeveloperTab />)
    const editor = screen.getByLabelText('场景运行时源码')
    expect(editor).toHaveAttribute('wrap', 'off')
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    fireEvent.change(editor, { target: { value: 'import value from "pkg"' } })
    fireEvent.click(screen.getByRole('button', { name: '校验并应用' }))
    expect(screen.getByRole('status')).toHaveTextContent('未应用')
    expect(selectActiveScene(useEditorStore.getState()).runtime?.source)
      .toBe(initialSource)

    fireEvent.change(editor, { target: { value: validSource } })
    fireEvent.click(screen.getByRole('button', { name: '校验并应用' }))
    expect(selectActiveScene(useEditorStore.getState()).runtime?.source)
      .toBe(validSource)
  })

  it('同源应用显示零写入，并在输入法组合期间禁用应用与取消', () => {
    useEditorStore.getState().createNewProject()
    const scene = selectActiveScene(useEditorStore.getState())
    const source =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})'
    installSceneRuntime(scene.id, source)
    const beforeRevision = selectActiveCourseProjectDocument(
      useEditorStore.getState(),
    )!.revision

    render(<DeveloperTab />)
    const editor = screen.getByLabelText('场景运行时源码')
    const apply = screen.getByRole('button', { name: '校验并应用' })
    const cancel = screen.getByRole('button', { name: '取消' })

    fireEvent.compositionStart(editor)
    expect(apply).toBeDisabled()
    expect(cancel).toBeDisabled()
    fireEvent.compositionEnd(editor)
    expect(apply).toBeEnabled()
    expect(cancel).toBeEnabled()

    fireEvent.click(apply)
    expect(screen.getByRole('status')).toHaveTextContent(
      '源码没有变化，未写入工程历史',
    )
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.revision)
      .toBe(beforeRevision)
  })

  it('脏草稿只绑定原 Runtime：切换目标时保持并禁用，返回后恢复，取消可加载当前目标', () => {
    useEditorStore.getState().createNewProject()
    const scene = selectActiveScene(useEditorStore.getState())
    const localSource =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){const scope="local";return{destroy(){}}}})'
    const globalSource =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){const scope="global";return{destroy(){}}}})'
    const draftSource =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){const draft=true;return{destroy(){}}}})'
    installSceneRuntime(scene.id, localSource)
    installGlobalRuntime(globalSource)
    useEditorStore.getState().setEditingScope('scene')

    render(<DeveloperTab />)
    const editor = screen.getByLabelText('场景运行时源码')
    fireEvent.change(editor, { target: { value: draftSource } })

    act(() => useEditorStore.getState().setEditingScope('global'))
    expect(screen.getByLabelText('场景运行时源码')).toHaveValue(draftSource)
    expect(screen.getByTestId('runtime-source-stale')).toHaveTextContent(
      '当前目标已经切换',
    )
    expect(screen.getByRole('button', { name: '校验并应用' })).toBeDisabled()

    act(() => useEditorStore.getState().setEditingScope('scene'))
    expect(screen.queryByTestId('runtime-source-stale')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '校验并应用' })).toBeEnabled()
    expect(screen.getByLabelText('场景运行时源码')).toHaveValue(draftSource)

    act(() => useEditorStore.getState().setEditingScope('global'))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByLabelText('全局运行时源码')).toHaveValue(globalSource)
    expect(screen.queryByTestId('runtime-source-stale')).not.toBeInTheDocument()
  })

  it('两个同源 Runtime 之间切换也按稳定目标标记脏草稿过期', () => {
    useEditorStore.getState().createNewProject()
    const scene = selectActiveScene(useEditorStore.getState())
    const source =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})'
    installSceneRuntime(scene.id, source)
    installGlobalRuntime(source)
    useEditorStore.getState().setEditingScope('scene')

    render(<DeveloperTab />)
    fireEvent.change(screen.getByLabelText('场景运行时源码'), {
      target: { value: `${source}\n// local draft` },
    })
    act(() => useEditorStore.getState().setEditingScope('global'))

    expect(screen.getByLabelText('场景运行时源码')).toHaveValue(
      `${source}\n// local draft`,
    )
    expect(screen.getByTestId('runtime-source-stale')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '校验并应用' })).toBeDisabled()
  })

  it('命名状态切换不重绑草稿，提交仍携带绑定时捕获的状态目标', () => {
    useEditorStore.getState().createNewProject()
    const scene = selectActiveScene(useEditorStore.getState())
    const source =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})'
    const nextSource = `${source}\n// captured base state`
    installSceneRuntime(scene.id, source)
    useEditorStore.getState().addPresentationState('讲解状态')
    const namedStateId = useEditorStore.getState().activePresentationStateId
    expect(namedStateId).not.toBeNull()
    useEditorStore.getState().setActivePresentationState(null)
    refreshCourseAuthoringLocation()
    let capturedStateId: string | null | undefined = undefined
    useEditorStore.setState({
      updateRuntimeSourceAtTarget: (target, draft) => {
        capturedStateId = target.stateId
        return originalUpdateRuntimeSourceAtTarget(target, draft)
      },
    })

    render(<DeveloperTab />)
    fireEvent.change(screen.getByLabelText('场景运行时源码'), {
      target: { value: nextSource },
    })
    act(() => useEditorStore.getState().setActivePresentationState(namedStateId))

    expect(screen.queryByTestId('runtime-source-stale')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '校验并应用' }))
    expect(capturedStateId).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('修改已写入工程历史')
  })

  it('完整保留 V9 Surface Runtime 定义，并显示动态协议与 API 版本', () => {
    const fixture = listCourseProjectV9Fixtures().find(
      (candidate) => candidate.id === 'surface-runtime',
    )!
    useEditorStore.getState().loadCourseProject(
      structuredClone(fixture.data.project),
      null,
      structuredClone(fixture.data.assetFiles),
      {},
    )
    const before = selectActiveCourseProjectDocument(useEditorStore.getState())!
    const beforeSurface = before.surfaces[0]
    if (beforeSurface?.type !== 'slide') throw new Error('expected Slide fixture')
    const beforeRuntime = beforeSurface.scenes[0]!.layerItems.find(
      (item) => item.kind === 'runtime',
    )
    if (beforeRuntime?.kind !== 'runtime') throw new Error('expected Runtime fixture')
    const original = structuredClone(beforeRuntime.runtime)
    const nextSource =
      'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){const changed=true;return{destroy(){}}}})'

    render(<DeveloperTab />)
    expect(screen.getByText(/Surface Runtime \/ Runtime API 3/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('场景运行时源码'), {
      target: { value: nextSource },
    })
    fireEvent.click(screen.getByRole('button', { name: '校验并应用' }))

    const after = selectActiveCourseProjectDocument(useEditorStore.getState())!
    const afterSurface = after.surfaces[0]
    if (afterSurface?.type !== 'slide') throw new Error('expected Slide fixture')
    const afterRuntime = afterSurface.scenes[0]!.layerItems.find(
      (item) => item.kind === 'runtime',
    )
    if (afterRuntime?.kind !== 'runtime') throw new Error('expected Runtime fixture')
    expect(afterRuntime.runtime).toEqual({ ...original, source: nextSource })
    expect(screen.getByRole('status')).toHaveTextContent('修改已写入工程历史')
  })

  it('把 typed Store 提交失败原因显示在原草稿旁且不宣称成功', () => {
    useEditorStore.getState().createNewProject()
    const scene = selectActiveScene(useEditorStore.getState())
    const source =
      'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})'
    installSceneRuntime(scene.id, source)
    useEditorStore.setState({
      updateRuntimeSourceAtTarget: () => ({
        ok: false,
        code: 'revision-conflict',
        reason: '模拟的 Runtime revision 冲突',
      }),
    })

    render(<DeveloperTab />)
    fireEvent.change(screen.getByLabelText('场景运行时源码'), {
      target: { value: `${source}\n// draft` },
    })
    fireEvent.click(screen.getByRole('button', { name: '校验并应用' }))

    expect(screen.getByRole('status')).toHaveTextContent(
      '未应用：模拟的 Runtime revision 冲突',
    )
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.surfaces[0])
      .toEqual(expect.objectContaining({ type: 'slide' }))
    expect(screen.queryByText('校验通过，修改已写入工程历史。'))
      .not.toBeInTheDocument()
  })

  it('Flow 与 Spatial 缺少本地 Runtime 时不提供会造成假成功的模板按钮', () => {
    useEditorStore.getState().createNewFlowProject()
    const { unmount } = render(<DeveloperTab />)
    expect(screen.getByTestId('runtime-source-missing')).toHaveTextContent(
      '尚未创建 Runtime',
    )
    expect(screen.queryByRole('button', { name: '创建运行时模板' }))
      .not.toBeInTheDocument()

    unmount()
    useEditorStore.getState().createNewSpatialProject()
    render(<DeveloperTab />)
    expect(screen.getByTestId('runtime-source-missing')).toHaveTextContent(
      '尚未创建 Runtime',
    )
    expect(screen.queryByRole('button', { name: '创建运行时模板' }))
      .not.toBeInTheDocument()
  })

  it('开发工作区一次只呈现一类任务，并给未就绪任务明确空状态', () => {
    useEditorStore.getState().createNewProject()
    render(<DeveloperTab />)

    expect(screen.getByText('当前作用域没有自定义运行时')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /对象 JSON/ }))
    expect(screen.getByText('未选择对象')).toBeInTheDocument()
    expect(screen.queryByText('当前作用域没有自定义运行时'))
      .not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /规则 JSON/ }))
    expect(screen.getByText('当前作用域没有规则')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '当前规则' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /组件代码/ }))
    expect(screen.getByText('未选择互动组件')).toBeInTheDocument()
  })

  it('Slide 既有模板入口创建后刷新为可编辑的 canonical Runtime', () => {
    useEditorStore.getState().createNewProject()
    render(<DeveloperTab />)

    fireEvent.click(screen.getByRole('button', { name: '创建运行时模板' }))

    expect((screen.getByLabelText('场景运行时源码') as HTMLTextAreaElement).value)
      .toContain('runtimeApiVersion: 2')
    expect(screen.getByText(/Canvas Runtime \/ Runtime API 2/)).toBeInTheDocument()
  })

  it('全局 Runtime 模板创建后保留全局作用域与当前命名状态', () => {
    useEditorStore.getState().createNewProject()
    useEditorStore.getState().addPresentationState('讲解状态')
    const namedStateId = useEditorStore.getState().activePresentationStateId
    expect(namedStateId).not.toBeNull()
    refreshCourseAuthoringLocation()
    useEditorStore.getState().setActivePresentationState(namedStateId)
    useEditorStore.getState().setEditingScope('global')
    render(<DeveloperTab />)

    fireEvent.click(screen.getByRole('button', { name: '创建运行时模板' }))

    expect(useEditorStore.getState().editingScope).toBe('global')
    expect(useEditorStore.getState().activePresentationStateId).toBe(namedStateId)
    expect((screen.getByLabelText('全局运行时源码') as HTMLTextAreaElement).value)
      .toContain('runtimeApiVersion: 2')
    expect(screen.getByText(/Canvas Runtime \/ Runtime API 2/)).toBeInTheDocument()
  })

  it('创建组件可编辑副本会生成新身份、切换当前实例且一次撤销恢复', () => {
    useEditorStore.getState().createNewProject()
    const source = componentPackage()
    useEditorStore.getState().importComponentPackage(source)
    useEditorStore.getState().addExternalComponentNode(source.manifest.id)
    const originalNode = selectActiveScene(useEditorStore.getState()).nodes[0]
    expect(originalNode?.type).toBe('external-component')
    const copyId = useEditorStore.getState().createEditableComponentCopy(
      source.manifest.id,
      originalNode!.id,
    )
    expect(copyId).toMatch(/^com\.example\.developer\.editable\./)
    const copiedPackage = useEditorStore.getState().componentPackages[copyId!]
    expect(copiedPackage?.manifest.id).toBe(copyId)
    expect(copiedPackage?.runtimeSource).toContain(copyId)
    expect(useEditorStore.getState().project.componentPackages[copyId!])
      .toMatchObject({
        editableCopy: true,
        sourcePackageId: source.manifest.id,
      })
    expect(useEditorStore.getState().componentPackages[source.manifest.id]).toBe(source)
    expect(selectActiveScene(useEditorStore.getState()).nodes[0]).toMatchObject({
      type: 'external-component',
      component: { packageId: copyId },
    })

    const updatedSource = editableSource(copyId!, 'const changed = true')
    useEditorStore.getState().updateEditableComponentPackage(copyId!, {
      runtimeSource: updatedSource,
    })
    expect(useEditorStore.getState().componentPackages[copyId!]?.runtimeSource)
      .toBe(updatedSource)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().componentPackages[copyId!]?.runtimeSource)
      .not.toBe(updatedSource)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().componentPackages[copyId!]).toBeUndefined()
    expect(selectActiveScene(useEditorStore.getState()).nodes[0]).toMatchObject({
      type: 'external-component',
      component: { packageId: source.manifest.id },
    })
  })

  it('拒绝直接改写第三方组件代码', () => {
    useEditorStore.getState().createNewProject()
    const source = componentPackage()
    useEditorStore.getState().importComponentPackage(source)
    expect(() => useEditorStore.getState().updateEditableComponentPackage(
      source.manifest.id,
      { runtimeSource: editableSource(source.manifest.id, 'const changed = true') },
    )).toThrow('第三方组件包默认只读')
  })

  it('不会把名称中碰巧含 editable 的第三方组件视为可编辑副本', () => {
    useEditorStore.getState().createNewProject()
    const source = componentPackage('vendor.editable.widget')
    useEditorStore.getState().importComponentPackage(source)
    expect(() => useEditorStore.getState().updateEditableComponentPackage(
      source.manifest.id,
      { runtimeSource: editableSource(source.manifest.id, 'const changed = true') },
    )).toThrow('第三方组件包默认只读')
  })

  it('命名状态下阻止创建组件副本且不产生孤儿包', () => {
    useEditorStore.getState().createNewProject()
    const source = componentPackage()
    useEditorStore.getState().importComponentPackage(source)
    useEditorStore.getState().addExternalComponentNode(source.manifest.id)
    const node = selectActiveScene(useEditorStore.getState()).nodes[0]!
    useEditorStore.getState().addPresentationState('反馈')
    const beforeIds = Object.keys(useEditorStore.getState().componentPackages)

    expect(useEditorStore.getState().createEditableComponentCopy(
      source.manifest.id,
      node.id,
    )).toBeNull()
    expect(Object.keys(useEditorStore.getState().componentPackages)).toEqual(beforeIds)
    expect(selectActiveScene(useEditorStore.getState()).nodes[0]).toMatchObject({
      type: 'external-component',
      component: { packageId: source.manifest.id },
    })
    expect(useEditorStore.getState().errorMessage).toContain('切换到“基础”')
  })

  it('可编辑组件提交前复用完整包校验并保护现有实例作用域', () => {
    useEditorStore.getState().createNewProject()
    const source = domComponentPackage()
    useEditorStore.getState().importComponentPackage(source)
    useEditorStore.getState().addExternalComponentNode(source.manifest.id)
    const node = selectActiveScene(useEditorStore.getState()).nodes[0]!
    const copyId = useEditorStore.getState().createEditableComponentCopy(
      source.manifest.id,
      node.id,
    )!
    const copied = useEditorStore.getState().componentPackages[copyId]!

    expect(() => useEditorStore.getState().updateEditableComponentPackage(
      copyId,
      {
        manifest: {
          ...copied.manifest,
          supportedScopes: ['global'],
        } as typeof copied.manifest,
      },
    )).toThrow('仍有场景实例')

    expect(() => useEditorStore.getState().updateEditableComponentPackage(
      copyId,
      {
        manifest: {
          ...copied.manifest,
          thumbnail: 'missing.png',
        } as typeof copied.manifest,
      },
    )).toThrow('缺少缩略图')
  })
})
