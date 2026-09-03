import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  selectActivePresentationStateId,
  selectSlideAuthoringDocument,
  selectSlideAuthoringSnapshot,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { AutomationTab } from '@/renderer/ui/AutomationTab'
import { ScenePanel } from '@/renderer/ui/ScenePanel'
import { SceneStateStrip } from '@/renderer/ui/SceneStateStrip'
import type {
  NativeLayerItem,
  SlideSceneDocument,
} from '@/shared/courseProjectTypes'

function activeV9Scene(): SlideSceneDocument {
  const state = useEditorStore.getState()
  const document = selectSlideAuthoringDocument(state)
  const snapshot = selectSlideAuthoringSnapshot(state)
  if (!document || !snapshot) throw new Error('Expected an active Slide authoring session')
  const surface = document.surfaces.find((candidate) => candidate.id === snapshot.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('Expected an active Slide surface')
  const scene = surface.scenes.find((candidate) => candidate.id === snapshot.sceneId)
  if (!scene) throw new Error('Expected an active V9 Slide scene')
  return scene
}

function v9SlideScenes(): SlideSceneDocument[] {
  const document = selectSlideAuthoringDocument(useEditorStore.getState())
  if (!document) throw new Error('Expected a Slide authoring document')
  return document.surfaces.flatMap((surface) => (
    surface.type === 'slide' ? surface.scenes : []
  ))
}

function videoLayerItem(id: string, name: string): NativeLayerItem {
  return {
    layerItemId: id,
    label: name,
    frame: { mode: 'absolute', x: 120, y: 100, width: 640, height: 360 },
    order: 0,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'video',
      data: {
        assetId: 'asset_video',
        fit: 'contain',
        autoplay: false,
        loop: false,
        muted: false,
        volume: 1,
        playbackRate: 1,
        showControls: true,
        clickToToggle: true,
        startTime: 0,
        endTime: null,
        poster: { mode: 'video-frame', time: 0 },
        backgroundAudioMode: 'none',
      },
    },
  }
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'professional' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('scene presentation state UI', () => {
  it('keeps scene automation in a dedicated tab and adds through the store', () => {
    render(<AutomationTab />)

    expect(screen.getByRole('heading', { name: '场景规则' })).toBeInTheDocument()
    expect(screen.getByLabelText('规则由触发、条件和动作组成')).toHaveTextContent(
      '何时发生',
    )
    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))

    const scene = activeV9Scene()
    expect(scene.interactions).toHaveLength(1)
    expect(scene.interactions[0]).toMatchObject({
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: expect.stringMatching(/^action_/),
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'presentation.set', stateId: 'state_initial' },
      }],
    })
  })

  it('keeps state cards as accessible buttons and describes every state role', () => {
    const store = useEditorStore.getState()
    store.updatePresentationState('state_initial', {
      backgroundColor: '#123456',
    })

    render(<SceneStateStrip />)

    const list = screen.getByRole('list', { name: '当前场景状态列表' })
    const base = within(list).getByRole('button', {
      name: '基础场景，所有命名状态的继承源',
    })
    const initial = within(list).getByRole('button', {
      name: '初始，命名状态，运行初始状态，场景缩略图状态，1 项覆盖',
    })

    expect(base).toHaveAttribute('aria-pressed', 'true')
    expect(initial).toHaveAttribute('aria-pressed', 'false')
    expect(within(initial).getByTitle('运行初始状态')).toHaveTextContent('初始')
    expect(within(initial).getByTitle('场景缩略图状态')).toHaveTextContent(
      '缩略图',
    )

    fireEvent.click(initial)
    expect(selectActivePresentationStateId(useEditorStore.getState())).toBe(
      'state_initial',
    )
    expect(initial).toHaveAttribute('aria-pressed', 'true')
  })

  it('explains named-state override behavior for a multi-selection', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    const [text, shape] = activeV9Scene().layerItems.slice(-2)
    if (!text || !shape || text.frame.mode !== 'absolute') {
      throw new Error('Expected two absolute V9 Slide layer items')
    }
    store.setActivePresentationState('state_initial')
    store.updateNode(text.layerItemId, { x: text.frame.x + 20 })
    store.selectNodes([text.layerItemId, shape.layerItemId])

    render(<PropertiesTab onReplaceImage={() => undefined} />)

    expect(screen.getByText('状态：初始 · 多选')).toBeInTheDocument()
    expect(screen.getByText(
      '1/2 个所选元素已有覆盖；批量修改只写入当前状态。',
    )).toBeInTheDocument()
  })

  it('edits playback initial visibility without changing stable canvas visibility', () => {
    const store = useEditorStore.getState()
    store.addRectangleNode()
    const nodeId = activeV9Scene().layerItems.at(-1)!.layerItemId
    store.selectNode(nodeId)

    render(<PropertiesTab onReplaceImage={() => undefined} />)

    expect(screen.getByText('互动播放初始状态')).toBeInTheDocument()
    const playbackVisibility = screen.getByLabelText('播放开始时')
    expect(playbackVisibility).toHaveValue('inherit')
    fireEvent.change(playbackVisibility, { target: { value: 'hidden' } })

    const updated = activeV9Scene().layerItems.find((item) => item.layerItemId === nodeId)!
    expect(updated.playbackInitialVisibility).toBe('hidden')
    expect(updated.visible).toBe(true)
  })

  it('keeps video diagnostics scoped to the selected scene when legacy ids repeat', () => {
    const store = useEditorStore.getState()
    store.addScene()
    const [firstScene, secondScene] = v9SlideScenes()
    const sharedVideoId = 'legacy_shared_video'
    const document = selectSlideAuthoringDocument(useEditorStore.getState())
    if (document) {
      for (const surface of document.surfaces) {
        if (surface.type !== 'slide') continue
        for (const scene of surface.scenes) {
          if (scene.id === firstScene!.id) {
            scene.layerItems = [videoLayerItem(sharedVideoId, '第一场景视频')]
            scene.interactions = [{
              id: 'legacy_click',
              name: '旧视频点击规则',
              enabled: true,
              trigger: { type: 'node.click', nodeId: sharedVideoId },
              conditions: [],
              actions: [{
                id: 'legacy_click_step',
                start: 'after-previous',
                delayMs: 0,
                action: { type: 'scene.next' },
              }],
            }]
          }
          if (scene.id === secondScene!.id) {
            scene.layerItems = [videoLayerItem(sharedVideoId, '第二场景视频')]
            scene.interactions = []
          }
        }
      }
    }

    act(() => {
      useEditorStore.getState().setActiveScene(secondScene!.id)
      useEditorStore.getState().selectNode(sharedVideoId)
    })

    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.queryByText(/会覆盖这条单击规则/)).not.toBeInTheDocument()

    act(() => {
      useEditorStore.getState().setActiveScene(firstScene!.id)
      useEditorStore.getState().selectNode(sharedVideoId)
    })
    expect(screen.getByText(/会覆盖这条单击规则/)).toBeInTheDocument()
  })

  it('labels which authored state is used by each scene thumbnail', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      null as never,
    )
    const scene = activeV9Scene()

    render(<ScenePanel />)

    expect(screen.getByRole('button', {
      name: `打开场景“${scene.name}”；缩略图使用状态“初始”`,
    })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('缩略图 · 初始')).toBeInTheDocument()
  })
})
