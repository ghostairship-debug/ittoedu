import { describe, expect, it } from 'vitest'
import type {
  CourseRuntimeDefinition,
  RuntimeLayerItem,
  ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import {
  buildSlidePreviewRebuildKey,
  slidePreviewComponentPackageFingerprint,
  type SlidePreviewIdentityNode,
  type SlidePreviewRebuildKeyInput,
  type SlidePreviewRebuildScene,
} from '@/renderer/ui/workspaceSlidePreviewRebuild'

/**
 * Proves Slide Published authoring rebuild keys follow scene/global/asset/package
 * structure, not `project` / `componentPackages` / `assetFiles` object identity.
 * Does not prove Workspace, Electron, or a live browser host.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clonePlainObject(value: unknown): unknown {
  return isPlainObject(value) ? { ...value } : value
}

function scene(
  id: string,
  nodeIds: readonly string[] = ['n1'],
): SlidePreviewRebuildScene {
  return {
    id,
    nodes: nodeIds.map((nodeId) => ({
      id: nodeId,
      type: 'text' satisfies SlidePreviewIdentityNode['type'],
    })),
    presentation: { states: [{ id: `${id}-state` }] },
    runtime: { runtimeApiVersion: 2 as const, source: 'runtime-a' },
  }
}

function runtime(
  overrides: Partial<CourseRuntimeDefinition> = {},
): CourseRuntimeDefinition {
  return {
    protocol: 'canvas-runtime',
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: 'dom',
    source: 'runtime-a',
    content: {
      values: { title: '初始标题' },
      metadata: { title: { label: '标题' } },
    },
    assets: { hero: { assetId: 'asset-photo' } },
    nodeBindings: { anchor: 'n1' },
    staticFallback: { assetId: 'asset-photo', coverage: 'scene' },
    ...overrides,
  }
}

function globalRuntime(
  runtimeDefinition: ReturnType<typeof runtime>,
  overrides: Partial<RuntimeLayerItem> = {},
): ScopedLayerItem & { item: RuntimeLayerItem } {
  return {
    item: {
      layerItemId: 'runtime-global',
      label: '全局运行时',
      frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
      order: 1,
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'surface',
      playbackInitialVisibility: 'inherit',
      kind: 'runtime',
      runtime: runtimeDefinition,
      ...overrides,
    },
    visibility: { mode: 'all', locationIds: [] },
  }
}

function input(
  overrides: Partial<SlidePreviewRebuildKeyInput> = {},
): SlidePreviewRebuildKeyInput {
  const current = scene('scene-1')
  return {
    canvasMode: 'edit',
    editingScope: 'scene',
    activePresentationStateId: 'scene-1-state',
    scene: current,
    scenes: [current, scene('scene-2', ['n2'])],
    globalLayer: [{
      node: { id: 'g1', type: 'teacher-controller' satisfies SlidePreviewIdentityNode['type'] },
      layer: 'overlay',
      visibility: { mode: 'all', sceneIds: [] },
    }],
    globalRuntime: null,
    assets: {
      'asset-photo': {
        id: 'asset-photo',
        kind: 'image',
        byteLength: 8,
        path: 'assets/photo.png',
      },
    },
    candidateGlobals: null,
    candidateLocalItems: null,
    candidateAssets: null,
    sidecarFileIds: ['asset-photo'],
    componentPackages: {
      'pkg-clock': {
        manifest: { id: 'pkg-clock', version: '1.0.0' },
      },
    },
    ...overrides,
  }
}

describe('buildSlidePreviewRebuildKey', () => {
  it('stays equal when project, packages, and asset files are new identities of the same structure', () => {
    const left = input()
    const right = input({
      scene: { ...left.scene, nodes: left.scene.nodes.map((node) => ({ ...node })) },
      scenes: left.scenes.map((item) => ({
        ...item,
        nodes: item.nodes.map((node) => ({ ...node })),
      })),
      globalLayer: left.globalLayer.map((item) => ({
        ...item,
        node: { ...item.node },
        visibility: clonePlainObject(item.visibility),
      })),
      assets: { ...left.assets, 'asset-photo': { ...left.assets['asset-photo']! } },
      sidecarFileIds: [...left.sidecarFileIds],
      componentPackages: {
        'pkg-clock': {
          manifest: { id: 'pkg-clock', version: '1.0.0' },
        },
      },
    })

    expect(buildSlidePreviewRebuildKey(left)).toBe(buildSlidePreviewRebuildKey(right))
    expect(JSON.stringify(left.componentPackages)).toBe(JSON.stringify(right.componentPackages))
    expect(left.componentPackages).not.toBe(right.componentPackages)
    expect(left.scene).not.toBe(right.scene)
    expect(left.assets).not.toBe(right.assets)
  })

  it('changes when the scene, node set, runtime, asset set, or package set changes', () => {
    const baseline = buildSlidePreviewRebuildKey(input())

    expect(
      buildSlidePreviewRebuildKey(input({ scene: scene('scene-2', ['n2']) })),
    ).not.toBe(baseline)

    expect(
      buildSlidePreviewRebuildKey(input({
        scene: scene('scene-1', ['n1', 'n-added']),
      })),
    ).not.toBe(baseline)

    expect(
      buildSlidePreviewRebuildKey(input({
        scene: { ...scene('scene-1'), runtime: { runtimeApiVersion: 2, source: 'runtime-b' } },
      })),
    ).not.toBe(baseline)

    expect(
      buildSlidePreviewRebuildKey(input({
        sidecarFileIds: ['asset-photo', 'asset-new'],
        assets: {
          'asset-photo': {
            id: 'asset-photo',
            kind: 'image',
            byteLength: 8,
            path: 'assets/photo.png',
          },
          'asset-new': {
            id: 'asset-new',
            kind: 'image',
            byteLength: 4,
            path: 'assets/new.png',
          },
        },
      })),
    ).not.toBe(baseline)

    expect(
      buildSlidePreviewRebuildKey(input({
        componentPackages: {
          'pkg-clock': { manifest: { id: 'pkg-clock', version: '1.0.0' } },
          'pkg-quiz': { manifest: { id: 'pkg-quiz', version: '2.0.0' } },
        },
      })),
    ).not.toBe(baseline)
  })

  it('keeps patchable Runtime values in one authoring host but rebuilds for other Runtime changes', () => {
    const baselineRuntime = runtime()
    const baseline = buildSlidePreviewRebuildKey(input({
      scene: { ...scene('scene-1'), runtime: baselineRuntime },
    }))

    expect(buildSlidePreviewRebuildKey(input({
      scene: {
        ...scene('scene-1'),
        runtime: runtime({
          content: {
            values: { title: '作者补写的新标题' },
            metadata: { title: { label: '标题' } },
          },
        }),
      },
    }))).toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      scene: {
        ...scene('scene-1'),
        runtime: runtime({
          content: {
            values: { title: '初始标题', extra: '新增目标' },
            metadata: { title: { label: '标题' } },
          },
        }),
      },
    }))).not.toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      scene: {
        ...scene('scene-1'),
        runtime: runtime({
          content: {
            values: { title: '初始标题' },
            metadata: { title: { label: '改名后的标题' } },
          },
        }),
      },
    }))).not.toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      scene: {
        ...scene('scene-1'),
        runtime: runtime({ source: 'runtime-b' }),
      },
    }))).not.toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      scene: {
        ...scene('scene-1'),
        runtime: runtime({ assets: { hero: { assetId: 'asset-other' } } }),
      },
    }))).not.toBe(baseline)

    for (const structuralRuntime of [
      runtime({ protocol: 'surface-runtime', runtimeApiVersion: 3 }),
      runtime({ enabled: false }),
      runtime({ renderMode: 'hybrid' }),
      runtime({ nodeBindings: { anchor: 'n-other' } }),
      runtime({ staticFallback: { assetId: 'asset-other', coverage: 'scene' } }),
    ]) {
      expect(buildSlidePreviewRebuildKey(input({
        scene: { ...scene('scene-1'), runtime: structuralRuntime },
      }))).not.toBe(baseline)
    }
  })

  it('applies the Runtime values exception to global authoring only and keeps run mode complete', () => {
    const initialRuntime = runtime()
    const changedValues = runtime({
      content: {
        values: { title: '全局新标题' },
        metadata: { title: { label: '标题' } },
      },
    })
    const authoringBaseline = buildSlidePreviewRebuildKey(input({
      candidateGlobals: [globalRuntime(initialRuntime)],
      globalRuntime: initialRuntime,
    }))
    expect(buildSlidePreviewRebuildKey(input({
      candidateGlobals: [globalRuntime(changedValues)],
      globalRuntime: changedValues,
    }))).toBe(authoringBaseline)

    const runBaseline = buildSlidePreviewRebuildKey(input({
      canvasMode: 'run',
      candidateGlobals: [globalRuntime(initialRuntime)],
      globalRuntime: initialRuntime,
    }))
    expect(buildSlidePreviewRebuildKey(input({
      canvasMode: 'run',
      candidateGlobals: [globalRuntime(changedValues)],
      globalRuntime: changedValues,
    }))).not.toBe(runBaseline)

    for (const structuralLayerChange of [
      { frame: { mode: 'absolute' as const, x: 24, y: 0, width: 1280, height: 720 } },
      { order: 2 },
      { visible: false },
    ]) {
      expect(buildSlidePreviewRebuildKey(input({
        candidateGlobals: [globalRuntime(initialRuntime, structuralLayerChange)],
        globalRuntime: initialRuntime,
      }))).not.toBe(authoringBaseline)
    }
  })

  it('keeps local Runtime text patches incremental but rebuilds for its V9 carrier structure', () => {
    const item = globalRuntime(runtime()).item
    const local = {
      owner: 'scene' as const,
      item: { ...item, layerItemId: 'runtime-scene' },
    }
    const baseline = buildSlidePreviewRebuildKey(input({
      candidateLocalItems: [local],
    }))

    expect(buildSlidePreviewRebuildKey(input({
      candidateLocalItems: [{
        ...local,
        item: {
          ...local.item,
          runtime: runtime({
            content: {
              values: { title: '原位更新' },
              metadata: { title: { label: '标题' } },
            },
          }),
        },
      }],
    }))).toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      candidateLocalItems: [{
        ...local,
        item: {
          ...local.item,
          frame: { ...local.item.frame, x: 32 },
        },
      }],
    }))).not.toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      candidateLocalItems: [{
        owner: 'surface',
        item: local.item,
        visibility: { mode: 'only', locationIds: ['location-1'] },
      }],
    }))).not.toBe(baseline)
  })

  it('ignores patchable local node order but keeps component carrier and package code identity', () => {
    const first = {
      id: 'component-a',
      name: '组件',
      type: 'external-component',
      x: 100,
      y: 120,
      width: 480,
      height: 280,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      playbackInitialVisibility: 'inherit',
      component: { packageId: 'pkg-clock', version: '1.0.0' },
      props: { title: '初始标题' },
    }
    const second = {
      id: 'text-b',
      type: 'text' as const,
    }
    const changedComponent = {
      ...first,
      x: 260,
      width: 620,
      rotation: 12,
      visible: false,
      props: { title: '作者改写后的标题' },
    }
    const baseline = buildSlidePreviewRebuildKey(input({
      scene: { ...scene('scene-1'), nodes: [first, second] },
      componentPackages: {
        'pkg-clock': {
          manifest: { id: 'pkg-clock', version: '1.0.0' },
          files: { 'runtime.js': Uint8Array.of(1, 2, 3) },
        },
      },
    }))

    expect(buildSlidePreviewRebuildKey(input({
      scene: { ...scene('scene-1'), nodes: [second, first] },
      componentPackages: {
        'pkg-clock': {
          manifest: { id: 'pkg-clock', version: '1.0.0' },
          files: { 'runtime.js': Uint8Array.of(1, 2, 3) },
        },
      },
    }))).toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      scene: {
        ...scene('scene-1'),
        nodes: [changedComponent, second],
      },
      componentPackages: {
        'pkg-clock': {
          manifest: { id: 'pkg-clock', version: '1.0.0' },
          files: { 'runtime.js': Uint8Array.of(1, 2, 3) },
        },
      },
    }))).toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      scene: {
        ...scene('scene-1'),
        nodes: [{
          ...first,
          component: { packageId: 'pkg-clock', version: '2.0.0' },
        }, second],
      },
      componentPackages: {
        'pkg-clock': {
          manifest: { id: 'pkg-clock', version: '1.0.0' },
          files: { 'runtime.js': Uint8Array.of(1, 2, 3) },
        },
      },
    }))).not.toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      scene: { ...scene('scene-1'), nodes: [first, second] },
      componentPackages: {
        'pkg-clock': {
          manifest: { id: 'pkg-clock', version: '1.0.0' },
          files: { 'runtime.js': Uint8Array.of(1, 2, 4) },
        },
      },
    }))).not.toBe(baseline)
  })

  it('does not stringify the whole project in run mode', () => {
    const structured = {
      canvasMode: 'run' as const,
      editingScope: 'scene',
      activePresentationStateId: 'scene-1-state',
    }
    const left = input({ ...structured })
    const right = input({
      ...structured,
      scene: { ...left.scene, nodes: left.scene.nodes.map((node) => ({ ...node })) },
      scenes: left.scenes.map((item) => ({
        ...item,
        nodes: item.nodes.map((node) => ({ ...node })),
      })),
      componentPackages: {
        'pkg-clock': { manifest: { id: 'pkg-clock', version: '1.0.0' } },
      },
    })
    const leftKey = buildSlidePreviewRebuildKey(left)
    const rightKey = buildSlidePreviewRebuildKey(right)

    expect(leftKey).toBe(rightKey)
    expect(leftKey).not.toContain('"title"')
    expect(leftKey).not.toContain('"updatedAt"')
    expect(leftKey).toContain('"mode":"run"')
    expect(leftKey).toContain('"currentSceneId":"scene-1"')
  })

  it('patches controller frame/rotation/visibility without remounting on authoring scope selection', () => {
    const controller = (frame: { x: number; y: number }, rotation: number) => ({
      item: {
        layerItemId: 'teacher-controller',
        label: '教师控制器',
        frame: { mode: 'absolute' as const, x: frame.x, y: frame.y, width: 900, height: 64 },
        order: 80,
        visible: true,
        locked: false,
        rotation,
        opacity: 1,
        hitPolicy: 'auto' as const,
        playbackInitialVisibility: 'inherit' as const,
        kind: 'native' as const,
        content: {
          nativeType: 'teacher-controller' as const,
          data: {
            title: '教师控制台',
            showSceneProgress: true,
            compact: false,
            collapsible: true,
            defaultCollapsed: false,
            buttons: [],
            style: {
              backgroundColor: '#172033',
              backgroundOpacity: 0.94,
              accentColor: '#e7b85c',
              textColor: '#f8fafc',
              cornerRadius: 16,
            },
            includeInStaticExports: false,
          },
        },
      },
      visibility: { mode: 'all' as const, locationIds: [] },
    })

    const baseline = buildSlidePreviewRebuildKey(input({
      candidateGlobals: [controller({ x: 190, y: 638 }, 0)],
    }))
    expect(buildSlidePreviewRebuildKey(input({
      candidateGlobals: [controller({ x: 240, y: 600 }, 12)],
    }))).toBe(baseline)

    expect(buildSlidePreviewRebuildKey(input({
      editingScope: 'global',
      candidateGlobals: [controller({ x: 240, y: 600 }, 12)],
    }))).toBe(baseline)

    const hidden = controller({ x: 190, y: 638 }, 0)
    hidden.item.visible = false
    expect(buildSlidePreviewRebuildKey(input({
      candidateGlobals: [hidden],
    }))).toBe(baseline)

    const reordered = controller({ x: 190, y: 638 }, 0)
    reordered.item.order = 2
    expect(buildSlidePreviewRebuildKey(input({
      candidateGlobals: [reordered],
    }))).not.toBe(baseline)
  })
})

describe('slidePreviewComponentPackageFingerprint', () => {
  it('is stable across record identity and sensitive to packageId+version', () => {
    const first = {
      b: { manifest: { id: 'b', version: '1' } },
      a: { manifest: { id: 'a', version: '2' } },
    }
    const second = {
      a: { manifest: { id: 'a', version: '2' } },
      b: { manifest: { id: 'b', version: '1' } },
    }
    expect(slidePreviewComponentPackageFingerprint(first)).toEqual(
      slidePreviewComponentPackageFingerprint(second),
    )
    expect(slidePreviewComponentPackageFingerprint({
      a: { packageId: 'a', version: '3' },
    })).not.toEqual(slidePreviewComponentPackageFingerprint(second))
  })
})
