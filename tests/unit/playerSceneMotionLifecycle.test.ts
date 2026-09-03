import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({
  Scene: class {},
  Math: {
    Clamp: (value: number, minimum: number, maximum: number) =>
      Math.max(minimum, Math.min(maximum, value)),
  },
}))

import { PlayerScene } from '../../src/player/PlayerScene'
import { CourseEventBus } from '../../src/player/CourseEventBus'
import {
  createRectangleNode,
} from '../../src/renderer/project/nativeNodeFactories'
import type { ExportPayload } from '../../src/shared/componentTypes'
import type { GlobalLayerItem, ProjectDocument } from '../../src/shared/projectTypes'

function legacyPlayerDocument(): ProjectDocument {
  return {
    schemaVersion: 8,
    id: 'player-project',
    title: '未命名课件',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    canvas: { width: 1280, height: 720 },
    scenes: [{
      id: 'scene_1',
      name: '场景 1',
      backgroundColor: '#ffffff',
      backgroundAssetId: null,
      nodes: [],
      presentation: {
        initialStateId: 'state_initial',
        states: [{ id: 'state_initial', name: '初始', nodeOverrides: {} }],
      },
      interactions: [],
    }],
    assets: {},
    componentPackages: {},
    globalLayer: [],
    globalInteractions: [],
    designTokens: { fonts: [], colors: [] },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
      },
    },
    playback: {
      controls: 'none',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
  }
}

type PrivateMethod<Args extends unknown[], Result> = (
  this: PlayerScene,
  ...args: Args
) => Result

function privateMethod<Args extends unknown[], Result>(
  name: string,
): PrivateMethod<Args, Result> {
  const value = Reflect.get(PlayerScene.prototype, name)
  if (typeof value !== 'function') {
    throw new Error(`PlayerScene private method missing: ${name}`)
  }
  return value as PrivateMethod<Args, Result>
}

function createPresentationHarness() {
  const project = legacyPlayerDocument()
  const sceneDocument = project.scenes[0]!
  const node = createRectangleNode({
    id: 'feedback',
    name: '反馈',
    x: 10,
  })
  sceneDocument.nodes = [node]
  sceneDocument.presentation = {
    initialStateId: 'initial',
    states: [
      {
        id: 'initial',
        name: '初始',
        nodeOverrides: { feedback: { x: 10 } },
      },
      {
        id: 'entry',
        name: '入场过渡状态',
        nodeOverrides: {
          feedback: {
            x: 20,
            playbackInitialVisibility: 'hidden',
          },
        },
      },
      {
        id: 'final',
        name: '最终状态',
        nodeOverrides: { feedback: { x: 30 } },
      },
    ],
  }

  const playerScene = Object.create(PlayerScene.prototype) as PlayerScene
  const events = new CourseEventBus()
  const order: string[] = []
  const handle = {
    id: node.id,
    root: {
      setDepth: vi.fn(),
    },
    update: vi.fn(),
  }
  const motionDirector = {
    prepareStableUpdate: vi.fn(),
    update: vi.fn(),
    beginActivationEpoch: vi.fn(),
    refreshInputStates: vi.fn(),
    flushActivations: vi.fn(() => {
      order.push(`flush:${playerScene.getCurrentPresentationStateId()}`)
    }),
  }

  Reflect.set(playerScene, 'payload', {
    project,
    assets: {},
    components: {},
  } satisfies ExportPayload)
  Reflect.set(playerScene, 'currentSceneIndex', 0)
  Reflect.set(playerScene, 'currentPresentationStateId', 'initial')
  Reflect.set(playerScene, 'renderedNodes', [handle])
  Reflect.set(playerScene, 'sceneMotionDirector', motionDirector)
  Reflect.set(playerScene, 'sceneNodesRoot', { moveTo: vi.fn() })
  Reflect.set(playerScene, 'runtimeKernel', { events })
  Reflect.set(playerScene, 'buildingSceneNodes', false)
  Reflect.set(playerScene, 'applyingPresentation', false)
  Reflect.set(playerScene, 'pendingPresentation', null)
  Reflect.set(playerScene, 'interactionsEnabled', true)
  Reflect.set(playerScene, 'applySceneBackground', vi.fn())

  return {
    playerScene,
    events,
    order,
    handle,
    motionDirector,
  }
}

describe('PlayerScene V7 motion lifecycle ordering', () => {
  it('在场景就绪前缓存页面可见性与暂停状态，供后续挂载继承', () => {
    const playerScene = Object.create(PlayerScene.prototype) as PlayerScene
    const runtimeKernel = {
      setVisible: vi.fn(),
      suspend: vi.fn(),
      resume: vi.fn(),
    }
    const handle = {
      setPageVisible: vi.fn(),
      suspend: vi.fn(),
      resume: vi.fn(),
    }
    Reflect.set(playerScene, 'ready', false)
    Reflect.set(playerScene, 'runtimeKernel', runtimeKernel)
    Reflect.set(playerScene, 'renderedNodes', [])
    Reflect.set(playerScene, 'renderedGlobalItems', [])

    playerScene.setDocumentVisible(false)
    playerScene.suspendRuntimes()
    expect(runtimeKernel.setVisible).not.toHaveBeenCalled()
    expect(runtimeKernel.suspend).not.toHaveBeenCalled()

    privateMethod<[typeof handle], void>('applyStoredLifecycleState')
      .call(playerScene, handle)
    expect(handle.setPageVisible).toHaveBeenCalledWith(false)
    expect(handle.suspend).toHaveBeenCalledOnce()

    Reflect.set(playerScene, 'ready', true)
    Reflect.set(playerScene, 'renderedNodes', [handle])
    playerScene.resumeRuntimes()
    expect(runtimeKernel.resume).toHaveBeenCalledOnce()
    expect(handle.resume).toHaveBeenCalledOnce()
    playerScene.setDocumentVisible(true)
    expect(runtimeKernel.setVisible).toHaveBeenCalledWith(true)
    expect(handle.setPageVisible).toHaveBeenLastCalledWith(true)
  })

  it('queues initial global activation until the caller explicitly allows a flush', () => {
    const playerScene = Object.create(PlayerScene.prototype) as PlayerScene
    const globalNode = createRectangleNode({
      id: 'global-hint',
      name: '全局提示',
    })
    const item: GlobalLayerItem = {
      node: globalNode,
      layer: 'overlay',
      visibility: { mode: 'all', sceneIds: [] },
    }
    const handle = { setHostVisible: vi.fn() }
    const motionDirector = {
      update: vi.fn(),
      refreshInputStates: vi.fn(),
      flushActivations: vi.fn(),
    }
    Reflect.set(playerScene, 'renderedGlobalItems', [{ item, handle }])
    Reflect.set(playerScene, 'globalVisibilityByNodeId', new Map<string, boolean>())
    Reflect.set(playerScene, 'globalMotionDirector', motionDirector)

    const updateVisibility = privateMethod<[string, boolean?], void>(
      'updateGlobalLayerVisibility',
    )
    updateVisibility.call(playerScene, 'scene-a', false)

    expect(handle.setHostVisible).toHaveBeenCalledWith(true)
    expect(motionDirector.update).toHaveBeenCalledTimes(1)
    expect(motionDirector.refreshInputStates).toHaveBeenCalledTimes(1)
    expect(motionDirector.flushActivations).not.toHaveBeenCalled()

    updateVisibility.call(playerScene, 'scene-a', true)

    expect(motionDirector.update).toHaveBeenCalledTimes(2)
    expect(motionDirector.refreshInputStates).toHaveBeenCalledTimes(2)
    expect(motionDirector.flushActivations).toHaveBeenCalledTimes(1)
  })

  it('publishes presentation change before flushing the resulting activation', () => {
    const { playerScene, events, order, motionDirector } =
      createPresentationHarness()
    events.on<{ stateId: string }>('presentation:change', ({ stateId }) => {
      order.push(`emit:${stateId}`)
      expect(motionDirector.flushActivations).not.toHaveBeenCalled()
    })

    expect(playerScene.setPresentationState('entry')).toBe(true)

    expect(order).toEqual(['emit:entry', 'flush:entry'])
    expect(playerScene.getCurrentPresentationStateId()).toBe('entry')
  })

  it('starts a new activation epoch when an author-visible node enters another state', () => {
    const { playerScene, events, motionDirector } = createPresentationHarness()
    events.on<{ stateId: string }>('presentation:change', ({ stateId }) => {
      if (stateId !== 'entry') return
      expect(motionDirector.beginActivationEpoch).toHaveBeenCalledWith(
        'feedback',
        expect.any(String),
      )
      expect(motionDirector.flushActivations).not.toHaveBeenCalled()
    })

    expect(playerScene.setPresentationState('entry')).toBe(true)

    expect(motionDirector.beginActivationEpoch).toHaveBeenCalledTimes(1)
    expect(motionDirector.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'feedback',
        visible: true,
        playbackInitialVisibility: 'hidden',
      }),
      true,
      expect.any(Object),
    )
  })

  it('lets presentation-enter redirect settle before flushing and never flushes the superseded state', () => {
    const { playerScene, events, order, motionDirector } =
      createPresentationHarness()
    events.on<{ stateId: string }>('presentation:change', ({ stateId }) => {
      order.push(`emit:${stateId}`)
      if (stateId === 'entry') {
        expect(playerScene.setPresentationState('final')).toBe(true)
      }
    })

    expect(playerScene.setPresentationState('entry')).toBe(true)

    expect(order).toEqual([
      'emit:entry',
      'emit:final',
      'flush:final',
    ])
    expect(order).not.toContain('flush:entry')
    expect(motionDirector.flushActivations).toHaveBeenCalledTimes(1)
    expect(playerScene.getCurrentPresentationStateId()).toBe('final')
  })
})
