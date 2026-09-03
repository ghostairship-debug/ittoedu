import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { collectCourseProjectHealth } from '@/shared/courseProjectHealth'
import { selectEffectiveSlideSceneNodes } from '../helpers/selectEffectiveSlideSceneNodes'
import { selectActiveScene, useEditorStore,
  selectActiveCourseProjectDocument,
  selectActivePresentationStateId,
  selectSelectedNodeId,
} from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { RightSidebar } from '@/renderer/ui/RightSidebar'

function activeHistory() {
  const state = useEditorStore.getState()
  const backend = state.slideBackend
  if (!backend) throw new Error('expected active slideBackend')
  return backend.getSession().history
}

const TEST_COMPONENT_ID = 'com.example.mode-test'

function createTestComponentPackage(): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      supportedScopes: ['scene'],
      renderMode: 'phaser',
      id: TEST_COMPONENT_ID,
      name: '模式测试组件',
      version: '1.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 120, height: 80 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: {
        content: { title: '测试组件' },
      },
    },
    runtimeSource: `window.CoursewareComponent.define({id:${JSON.stringify(TEST_COMPONENT_ID)},runtimeApiVersion:4,create:function(){return{destroy:function(){}}}})`,
    files: {},
  }
}

beforeEach(() => {
  localStorage.clear()
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({
    editorMode: 'simple',
    activeTab: 'elements',
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('simple and professional editor modes', () => {
  it('uses one categorized element browser and exposes advanced authoring only in professional mode', () => {
    const props = {
      onAddImage: vi.fn(),
      onImportImage: vi.fn(),
      onReplaceImage: vi.fn(),
      onAddVideo: vi.fn(),
      onImportAudio: vi.fn(),
      onImportVideo: vi.fn(),
      onReplaceComponent: vi.fn(),
    }
    useEditorStore.getState().importComponentPackage(createTestComponentPackage())
    const projectBeforeSwitch = selectActiveCourseProjectDocument(useEditorStore.getState())!

    render(<RightSidebar {...props} />)

    expect(screen.getByRole('tab', { name: '元素' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '图层' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '属性' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '素材' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '组件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '互动与动画' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '开发' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '常用' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByRole('tab', { name: '文字' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '图形' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '媒体' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '素材库' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '互动组件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '控制与全局' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('components-tab')).not.toBeInTheDocument()

    expect(screen.getByTestId('add-text')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加右箭头' })).toBeInTheDocument()
    expect(screen.getByTestId('add-image')).toBeInTheDocument()
    expect(screen.getByTestId('add-video')).toBeInTheDocument()
    expect(screen.getByTestId('import-audio')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '媒体' }))
    expect(screen.getByTestId('media-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('add-text')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-image')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-video')).not.toBeInTheDocument()
    expect(screen.queryByTestId('import-audio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入图片' }))
    expect(props.onImportImage).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '导入声音' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入视频' })).toBeInTheDocument()
    expect(screen.getByText('声音库')).toBeInTheDocument()
    expect(screen.getByText('视频素材')).toBeInTheDocument()
    expect(screen.getByText('图片素材')).toBeInTheDocument()
    expect(screen.queryByText('全局声音设置')).not.toBeInTheDocument()

    act(() => useEditorStore.getState().setEditorMode('professional'))

    expect(screen.getByRole('tab', { name: '互动与动画' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '开发' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '组件' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '互动组件' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '控制与全局' })).toBeInTheDocument()
    expect(screen.getByText('全局声音设置')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '组件' }))
    expect(screen.getByTestId('components-tab')).toHaveTextContent(
      '模式测试组件',
    )
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!).toBe(projectBeforeSwitch)
    expect(localStorage.getItem('courseware-editor:mode')).toBe('professional')

    act(() => {
      useEditorStore.getState().setActiveTab('developer')
      useEditorStore.getState().setEditorMode('simple')
    })
    expect(useEditorStore.getState().activeTab).toBe('properties')
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!).toBe(projectBeforeSwitch)
  })

  it('filters element contents without exposing professional-only component results', () => {
    useEditorStore.getState().importComponentPackage(createTestComponentPackage())
    render(
      <RightSidebar
        onAddImage={vi.fn()}
        onReplaceImage={vi.fn()}
        onAddVideo={vi.fn()}
        onImportAudio={vi.fn()}
        onImportVideo={vi.fn()}
        onReplaceComponent={vi.fn()}
      />,
    )

    const search = screen.getByRole('searchbox', { name: '搜索元素内容' })
    fireEvent.change(search, { target: { value: '菱形' } })
    expect(screen.getByRole('button', { name: '添加菱形' })).toBeInTheDocument()
    expect(screen.queryByTestId('add-text')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '模式测试组件' } })
    expect(screen.queryByTestId(`component-${TEST_COMPONENT_ID}`))
      .not.toBeInTheDocument()
    expect(screen.getByText('没有找到“模式测试组件”')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByTestId('add-text')).toBeInTheDocument()
  })

  it('creates, updates, removes, and restores a complete entrance animation atomically', () => {
    act(() => useEditorStore.getState().addShapeNode('rectangle'))
    const nodeId = selectSelectedNodeId(useEditorStore.getState())!
    const historyBefore = activeHistory().past.length

    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '出现动画' })).toBeInTheDocument()
    expect(screen.queryByText('互动播放初始状态')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '交互' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '淡入' }))

    let state = useEditorStore.getState()
    let scene = selectActiveScene(state)
    let node = scene.nodes.find((item) => item.id === nodeId)!
    expect(node.playbackInitialVisibility).toBe('hidden')
    expect(scene.interactions).toHaveLength(1)
    expect(scene.interactions[0]).toMatchObject({
      enabled: true,
      trigger: { type: 'node.activated', nodeId },
      conditions: [],
      actions: [{
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'node.enter',
          nodeId,
          effect: 'fade',
          durationMs: 320,
          easing: 'ease-out',
        },
      }],
    })
    expect(activeHistory().past).toHaveLength(historyBefore + 1)
    expect(collectCourseProjectHealth(selectActiveCourseProjectDocument(state)!, {
      assetFiles: state.courseAssetSidecar?.files ?? {},
      componentFiles: {},
    }).some(
      (diagnostic) => diagnostic.code === 'interaction-enter-target-initially-visible',
    )).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '缩放' }))

    state = useEditorStore.getState()
    scene = selectActiveScene(state)
    expect(scene.interactions).toHaveLength(1)
    expect(scene.interactions[0]!.actions[0]!.action).toMatchObject({
      type: 'node.enter',
      effect: 'scale',
    })
    expect(activeHistory().past).toHaveLength(historyBefore + 2)

    fireEvent.click(screen.getByRole('button', { name: '无' }))

    state = useEditorStore.getState()
    scene = selectActiveScene(state)
    node = scene.nodes.find((item) => item.id === nodeId)!
    expect(scene.interactions).toHaveLength(0)
    expect(node.playbackInitialVisibility).toBe('inherit')
    expect(activeHistory().past).toHaveLength(historyBefore + 3)

    act(() => useEditorStore.getState().undo())

    state = useEditorStore.getState()
    scene = selectActiveScene(state)
    node = scene.nodes.find((item) => item.id === nodeId)!
    expect(scene.interactions).toHaveLength(1)
    expect(node.playbackInitialVisibility).toBe('hidden')
    expect(scene.interactions[0]!.actions[0]!.action).toMatchObject({
      type: 'node.enter',
      effect: 'scale',
    })
  })

  it('does not overwrite an advanced entrance rule from simple mode', () => {
    act(() => useEditorStore.getState().addShapeNode('rectangle'))
    const store = useEditorStore.getState()
    const scene = selectActiveScene(store)
    const nodeId = selectSelectedNodeId(store)!
    store.addInteractionRule(scene.id, {
      id: 'advanced-enter-rule',
      name: '复杂入场',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'advanced-enter-action',
        start: 'after-previous',
        delayMs: 250,
        action: {
          type: 'node.enter',
          nodeId,
          effect: 'slide',
          direction: 'right',
          durationMs: 800,
          easing: 'ease-in-out',
        },
      }],
    })
    const historyBefore = activeHistory().past.length

    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    expect(screen.getByText(
      '此元素已有专业动画规则，为避免重复播放，简洁模式不会覆盖它。',
    )).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '淡入' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开专业规则' }))

    expect(useEditorStore.getState().editorMode).toBe('professional')
    expect(useEditorStore.getState().activeTab).toBe('automation')
    expect(selectActiveScene(useEditorStore.getState()).interactions).toHaveLength(1)
    expect(activeHistory().past).toHaveLength(historyBefore)
  })

  it('does not claim an equivalent-shaped professional node activation rule', () => {
    act(() => useEditorStore.getState().addShapeNode('rectangle'))
    const store = useEditorStore.getState()
    const scene = selectActiveScene(store)
    const nodeId = selectSelectedNodeId(store)!
    store.addInteractionRule(scene.id, {
      id: 'professional-node-activation',
      name: '专业自定义入场',
      enabled: true,
      trigger: { type: 'node.activated', nodeId },
      conditions: [],
      actions: [{
        id: 'professional-node-activation-action',
        start: 'after-previous',
        delayMs: 777,
        action: {
          type: 'node.enter',
          nodeId,
          effect: 'fade',
          durationMs: 910,
          easing: 'linear',
        },
      }],
    })
    const historyBefore = activeHistory().past.length

    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    expect(screen.getByText(
      '此元素已有专业动画规则，为避免重复播放，简洁模式不会覆盖它。',
    )).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '淡入' })).not.toBeInTheDocument()
    expect(selectActiveScene(useEditorStore.getState()).interactions[0])
      .toMatchObject({
        id: 'professional-node-activation',
        actions: [{
          delayMs: 777,
          action: {
            durationMs: 910,
            easing: 'linear',
          },
        }],
      })
    expect(activeHistory().past).toHaveLength(historyBefore)
  })

  it('keeps simple entrance animations isolated between presentation states', () => {
    const store = useEditorStore.getState()
    store.addShapeNode('rectangle')
    const nodeId = selectSelectedNodeId(useEditorStore.getState())!

    store.addPresentationState('状态 A')
    const stateA = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().setSimpleEntranceAnimation(nodeId, {
      effect: 'fade',
      durationMs: 320,
      delayMs: 0,
    })

    useEditorStore.getState().addPresentationState('状态 B')
    const stateB = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().setSimpleEntranceAnimation(nodeId, {
      effect: 'slide',
      direction: 'right',
      durationMs: 500,
      delayMs: 300,
    })

    let scene = selectActiveScene(useEditorStore.getState())
    expect(scene.interactions).toHaveLength(2)
    expect(
      selectEffectiveSlideSceneNodes(stateA).find((node) => node.id === nodeId)
        ?.playbackInitialVisibility,
    ).toBe('hidden')
    expect(
      selectEffectiveSlideSceneNodes(stateB).find((node) => node.id === nodeId)
        ?.playbackInitialVisibility,
    ).toBe('hidden')

    useEditorStore.getState().setActivePresentationState(stateA)
    useEditorStore.getState().setSimpleEntranceAnimation(nodeId, null)

    scene = selectActiveScene(useEditorStore.getState())
    expect(scene.interactions).toHaveLength(1)
    expect(scene.interactions[0]!.conditions).toEqual([{
      type: 'presentation.in',
      stateIds: [stateB],
    }])
    expect(
      selectEffectiveSlideSceneNodes(stateA).find((node) => node.id === nodeId)
        ?.playbackInitialVisibility,
    ).toBe('inherit')
    expect(
      selectEffectiveSlideSceneNodes(stateB).find((node) => node.id === nodeId)
        ?.playbackInitialVisibility,
    ).toBe('hidden')
  })
})
