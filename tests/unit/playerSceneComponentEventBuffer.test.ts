import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  order: [] as string[],
  handles: [] as Array<{
    id: string
    setPageVisible: ReturnType<typeof vi.fn>
    suspend: ReturnType<typeof vi.fn>
  }>,
  emitters: [] as Array<(detail: {
    scope: 'scene' | 'global'
    sceneId?: string
    componentId: string
    instanceId: string
    eventName: string
  }) => void>,
}))

vi.mock('phaser', () => ({
  Scene: class {},
  Math: {
    Clamp: (value: number, minimum: number, maximum: number) =>
      Math.max(minimum, Math.min(maximum, value)),
  },
}))

vi.mock('../../src/player/NodeMotionDirector', () => ({
  NodeMotionDirector: class {
    register(): void {}
    refreshInputStates(): void {}
    flushActivations(): void {}
    clear(): void {}
    update(): void {}
    play(): boolean { return false }
  },
}))

vi.mock('../../src/player/InteractionEngine', () => ({
  InteractionEngine: class {
    private bound = false
    private readonly off: () => void
    private readonly scope: 'scene' | 'global'

    constructor(options: {
      scope?: 'scene' | 'global'
      events: {
        on(
          eventName: string,
          listener: (detail: {
            scope: 'scene' | 'global'
            eventName: string
          }) => void,
        ): () => void
      }
    }) {
      this.scope = options.scope ?? 'scene'
      harness.order.push(`engine:${this.scope}`)
      this.off = options.events.on('component:event', (detail) => {
        if (detail.scope !== this.scope) return
        harness.order.push(
          `event:${this.scope}:${detail.eventName}:bound=${this.bound}`,
        )
      })
    }

    bindNodeHandles(): void {
      this.bound = true
      harness.order.push(`bind:${this.scope}`)
    }

    destroy(): void {
      this.off()
    }
  },
}))

vi.mock('../../src/player/renderNode', () => ({
  valuesEqual: (left: unknown, right: unknown) => Object.is(left, right),
  renderNode: (
    _scene: unknown,
    node: { id: string; type: string },
    _depth: number,
    context: {
      scope: 'scene' | 'global'
      sceneId?: string
      emitComponentEvent?: (detail: {
        scope: 'scene' | 'global'
        sceneId?: string
        componentId: string
        instanceId: string
        eventName: string
      }) => void
    },
  ) => {
    harness.order.push(`render:${context.scope}:${node.id}`)
    const emit = context.emitComponentEvent
    if (emit) {
      harness.emitters.push(emit)
      emit({
        scope: context.scope,
        ...(context.sceneId ? { sceneId: context.sceneId } : {}),
        componentId: 'test-component',
        instanceId: node.id,
        eventName: `mounted:${node.id}`,
      })
    }
    const root = {
      active: true,
      visible: true,
      setDepth: vi.fn(),
    }
    const handle = {
      id: node.id,
      type: node.type,
      root,
      setHostVisible: vi.fn(),
      setPageVisible: vi.fn(),
      suspend: vi.fn(),
      update: vi.fn(),
      destroy: vi.fn(() => {
        root.active = false
      }),
    }
    harness.handles.push(handle)
    return handle
  },
}))

import { PlayerScene } from '../../src/player/PlayerScene'
import { CourseEventBus } from '../../src/player/CourseEventBus'
import {
  createExternalComponentNode,
} from '../../src/renderer/project/nativeNodeFactories'
import type { ExportPayload } from '../../src/shared/componentTypes'
import type { InteractionRule } from '../../src/shared/interactionTypes'
import type { ProjectDocument } from '../../src/shared/projectTypes'

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

function componentRule(nodeId: string): InteractionRule {
  return {
    id: `rule-${nodeId}`,
    enabled: true,
    trigger: {
      type: 'component.event',
      nodeId,
      eventName: `mounted:${nodeId}`,
    },
    conditions: [],
    actions: [{
      id: `action-${nodeId}`,
      start: 'after-previous',
      delayMs: 0,
      action: {
        type: 'audio.toggle-mute',
        target: { kind: 'all' },
      },
    }],
  }
}

function componentNode(id: string) {
  return createExternalComponentNode({
    id,
    component: { packageId: 'test-component', version: '1.0.0' },
  })
}

function createHarness(project = legacyPlayerDocument()) {
  const playerScene = Object.create(PlayerScene.prototype) as PlayerScene
  const events = new CourseEventBus()
  const domLayers = {
    global: {
      underlay: document.createElement('div'),
      overlay: document.createElement('div'),
    },
    scene: {
      underlay: document.createElement('div'),
      overlay: document.createElement('div'),
    },
  }
  Reflect.set(playerScene, 'payload', {
    project,
    assets: {},
    components: {},
  } satisfies ExportPayload)
  Reflect.set(playerScene, 'componentRegistry', {})
  Reflect.set(playerScene, 'hostActions', {})
  Reflect.set(playerScene, 'audio', {})
  Reflect.set(playerScene, 'runtimeKernel', {
    events,
    courseState: {},
    leaveCurrentScene: vi.fn(),
    enterScene: vi.fn(),
  })
  Reflect.set(playerScene, 'interactionsEnabled', true)
  Reflect.set(playerScene, 'canvasControlsEnabled', true)
  Reflect.set(playerScene, 'domLayers', domLayers)
  Reflect.set(playerScene, 'renderedNodes', [])
  Reflect.set(playerScene, 'renderedGlobalItems', [])
  Reflect.set(playerScene, 'interactionEngine', null)
  Reflect.set(playerScene, 'globalInteractionEngine', null)
  Reflect.set(playerScene, 'sceneMotionDirector', null)
  Reflect.set(playerScene, 'globalMotionDirector', null)
  Reflect.set(playerScene, 'sceneComponentEvents', null)
  Reflect.set(playerScene, 'globalComponentEvents', null)
  Reflect.set(playerScene, 'globalVisibilityByNodeId', new Map())
  Reflect.set(playerScene, 'currentSceneIndex', -1)
  Reflect.set(playerScene, 'currentPresentationStateId', null)
  Reflect.set(playerScene, 'currentBackgroundAssetId', null)
  Reflect.set(playerScene, 'pendingNavigation', null)
  Reflect.set(playerScene, 'pendingPresentation', null)
  Reflect.set(playerScene, 'buildingSceneNodes', false)
  Reflect.set(playerScene, 'applyingPresentation', false)
  Reflect.set(playerScene, 'renderingScene', false)
  Reflect.set(playerScene, 'sceneNodesRoot', { active: false })
  Reflect.set(playerScene, 'sceneBackgroundRoot', { active: false })
  Reflect.set(playerScene, 'sceneUnderlayRoot', {})
  Reflect.set(playerScene, 'sceneOverlayRoot', {})
  Reflect.set(playerScene, 'globalUnderlayRoot', {})
  Reflect.set(playerScene, 'globalOverlayRoot', {})
  Reflect.set(playerScene, 'applySceneBackground', vi.fn())
  Reflect.set(playerScene, 'updateGlobalLayerVisibility', vi.fn())
  Reflect.set(playerScene, 'releaseUnusedNativeTextures', vi.fn())
  Reflect.set(playerScene, 'onSceneChanged', vi.fn())
  return playerScene
}

describe('PlayerScene component mount event buffering', () => {
  beforeEach(() => {
    harness.order.length = 0
    harness.handles.length = 0
    harness.emitters.length = 0
  })

  it('replays scene component events only after the scene engine binds, in mount order', () => {
    const project = legacyPlayerDocument()
    const scene = project.scenes[0]!
    scene.nodes = [componentNode('scene-a'), componentNode('scene-b')]
    scene.interactions = [componentRule('scene-a'), componentRule('scene-b')]
    const playerScene = createHarness(project)

    privateMethod<[number, typeof scene, string?], void>('renderScene')
      .call(playerScene, 0, scene)

    expect(harness.order).toEqual([
      'render:scene:scene-a',
      'render:scene:scene-b',
      'engine:scene',
      'bind:scene',
      'event:scene:mounted:scene-a:bound=true',
      'event:scene:mounted:scene-b:bound=true',
    ])
  })

  it('keeps global mount ordering and ignores an emitter retained by a destroyed mount', () => {
    const project = legacyPlayerDocument()
    project.globalLayer = [
      {
        node: componentNode('global-a'),
        layer: 'overlay',
        visibility: { mode: 'all', sceneIds: [] },
      },
      {
        node: componentNode('global-b'),
        layer: 'overlay',
        visibility: { mode: 'all', sceneIds: [] },
      },
    ]
    project.globalInteractions = [
      componentRule('global-a'),
      componentRule('global-b'),
    ]
    const playerScene = createHarness(project)
    const renderGlobalLayer = privateMethod<[], void>('renderGlobalLayer')

    renderGlobalLayer.call(playerScene)
    const staleEmitter = harness.emitters[0]!
    expect(harness.order).toEqual([
      'render:global:global-a',
      'render:global:global-b',
      'engine:global',
      'bind:global',
      'event:global:mounted:global-a:bound=true',
      'event:global:mounted:global-b:bound=true',
    ])

    harness.order.length = 0
    renderGlobalLayer.call(playerScene)
    staleEmitter({
      scope: 'global',
      componentId: 'test-component',
      instanceId: 'global-a',
      eventName: 'late-from-destroyed-mount',
    })

    expect(harness.order).not.toContain(
      'event:global:late-from-destroyed-mount:bound=true',
    )
  })

  it('隐藏且暂停期间新建的场景与全局组件继承宿主生命周期状态', () => {
    const project = legacyPlayerDocument()
    const scene = project.scenes[0]!
    scene.nodes = [componentNode('scene-hidden')]
    project.globalLayer = [{
      node: componentNode('global-hidden'),
      layer: 'overlay',
      visibility: { mode: 'all', sceneIds: [] },
    }]
    const playerScene = createHarness(project)
    Reflect.set(playerScene, 'documentVisible', false)
    Reflect.set(playerScene, 'runtimesSuspended', true)

    privateMethod<[], void>('renderGlobalLayer').call(playerScene)
    privateMethod<[number, typeof scene, string?], void>('renderScene')
      .call(playerScene, 0, scene)

    const sceneHandle = harness.handles.find(({ id }) => id === 'scene-hidden')
    const globalHandle = harness.handles.find(({ id }) => id === 'global-hidden')
    for (const handle of [sceneHandle, globalHandle]) {
      expect(handle?.setPageVisible).toHaveBeenCalledWith(false)
      expect(handle?.suspend).toHaveBeenCalledOnce()
    }
  })
})
