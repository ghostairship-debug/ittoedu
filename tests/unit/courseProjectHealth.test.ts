import { strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createImageNode,
  createRectangleNode,
  createTeacherControllerNode,
  createVideoNode,
} from '@/renderer/project/createProject'
import {
  collectCourseProjectHealth,
  collectCourseProjectRuntimeHealth,
  type CourseProjectHealthArchiveFiles,
} from '@/shared/courseProjectHealth'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  LayerItem,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const EMPTY_FILES: CourseProjectHealthArchiveFiles = {
  assetFiles: {},
  componentFiles: {},
}

function blankProject(): CourseProjectDocument {
  return createBlankCourseProject({
    includeDefaultController: false,
    controls: 'none',
    id: 'health-project',
    now: '2026-08-26T00:00:00.000Z',
    idFactory: () => 'fixed',
  })
}

function slide(project: CourseProjectDocument) {
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('expected Slide surface')
  const scene = surface.scenes[0]
  if (!scene) throw new Error('expected Slide scene')
  return { surface, scene }
}

function runtimeItem(id: string, order: number): RuntimeLayerItem {
  return {
    layerItemId: id,
    label: id,
    frame: { mode: 'absolute', x: 0, y: 0, width: 320, height: 180 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})',
      content: { values: {} },
      assets: {},
      nodeBindings: { missing: `${id}-missing` },
    },
  }
}

function addFlowAndSpatial(project: CourseProjectDocument): {
  flow: Extract<CourseSurfaceDocument, { type: 'flow' }>
  spatial: Extract<CourseSurfaceDocument, { type: 'spatial-2d' }>
} {
  const { surface, scene } = slide(project)
  const flow: Extract<CourseSurfaceDocument, { type: 'flow' }> = {
    id: 'flow-surface',
    title: 'Flow',
    type: 'flow',
    surfaceLayerItems: [],
    layout: { readingWidth: 760, wideContentWidth: 1120 },
    blocks: [{ id: 'flow-block', type: 'paragraph', text: 'Flow 内容' }],
  }
  const spatial: Extract<CourseSurfaceDocument, { type: 'spatial-2d' }> = {
    id: 'spatial-surface',
    title: 'Spatial',
    type: 'spatial-2d',
    surfaceLayerItems: [],
    world: { bounds: { mode: 'infinite' }, layerItems: [] },
    camera: {
      home: { x: 0, y: 0, zoom: 1 },
      frames: [{ id: 'spatial-frame', name: '空间镜头', x: 0, y: 0, zoom: 1 }],
    },
    semanticZoom: [],
  }
  project.surfaces.push(flow, spatial)
  project.locations.push(
    {
      id: 'flow-location',
      label: 'Flow 内容',
      kind: 'flow-block',
      surfaceId: flow.id,
      blockId: 'flow-block',
    },
    {
      id: 'spatial-location',
      label: '空间镜头',
      kind: 'spatial-camera',
      surfaceId: spatial.id,
      cameraFrameId: 'spatial-frame',
    },
  )
  project.mixedPrintPlan = {
    pageSize: 'A4',
    orientation: 'auto',
    entries: [
      { id: 'print-slide', kind: 'slide-scenes', surfaceId: surface.id, sceneIds: [scene.id] },
      { id: 'print-flow', kind: 'flow-document', surfaceId: flow.id },
      {
        id: 'print-spatial',
        kind: 'spatial-frames',
        surfaceId: spatial.id,
        cameraFrameIds: ['spatial-frame'],
      },
    ],
  }
  return { flow, spatial }
}

function addImageAsset(
  project: CourseProjectDocument,
  files: Record<string, Uint8Array>,
  id: string,
  kind: 'image' | 'audio' | 'video' = 'image',
): void {
  const bytes = new Uint8Array([1, 2, 3])
  project.assets[id] = {
    id,
    filename: `${id}.${kind === 'image' ? 'png' : kind === 'audio' ? 'mp3' : 'mp4'}`,
    mimeType: kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
    kind,
    path: `assets/${id}`,
    byteLength: bytes.byteLength,
  }
  files[id] = bytes
}

function componentManifest(id: string, version = '1.0.0') {
  return {
    schemaVersion: 4 as const,
    runtimeApiVersion: 4 as const,
    id,
    name: id,
    version,
    entry: 'runtime.js',
    defaultSize: { width: 320, height: 180 },
    minSize: { width: 160, height: 90 },
    preserveAspectRatio: false,
    assets: {},
    defaultProps: {},
    supportedScopes: ['scene'] as const,
    renderMode: 'dom' as const,
  }
}

function componentArchiveFiles(id: string, version = '1.0.0') {
  return {
    'manifest.json': strToU8(JSON.stringify(componentManifest(id, version))),
    'runtime.js': strToU8('window.CoursewareComponent.define({})'),
  }
}

describe('V9-native Course Project health', () => {
  it('returns no findings for a schema-valid blank project and remains read-only', () => {
    const project = blankProject()
    const before = JSON.stringify(project)

    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    expect(collectCourseProjectHealth(project, EMPTY_FILES)).toEqual([])
    expect(collectCourseProjectHealth(project, EMPTY_FILES)).toEqual([])
    expect(JSON.stringify(project)).toBe(before)
  })

  it('covers global, surface, Slide scene and Spatial world runtime owners', () => {
    const project = blankProject()
    const assetFiles: Record<string, Uint8Array> = {}
    addImageAsset(project, assetFiles, 'runtime-dynamic-asset')
    const { surface, scene } = slide(project)
    const { spatial } = addFlowAndSpatial(project)
    const globalRuntime = runtimeItem('runtime-global', 0)
    const surfaceRuntime = runtimeItem('runtime-surface', 1)
    const sceneRuntime = runtimeItem('runtime-scene', 2)
    const worldRuntime = runtimeItem('runtime-world', 3)
    globalRuntime.runtime.nodeBindings!.crossOwner = sceneRuntime.layerItemId
    project.globalLayerItems.push({
      item: globalRuntime,
      visibility: { mode: 'all', locationIds: [] },
    })
    surface.surfaceLayerItems.push({
      item: surfaceRuntime,
      visibility: { mode: 'all', locationIds: [] },
    })
    scene.layerItems.push(sceneRuntime)
    spatial.world.layerItems.push(worldRuntime)

    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    const first = collectCourseProjectRuntimeHealth(project, EMPTY_FILES)
    const second = collectCourseProjectRuntimeHealth(project, EMPTY_FILES)

    expect(second).toEqual(first)
    expect(first.filter(({ code }) => code === 'runtime-node-reference-missing')).toHaveLength(4)
    expect(first.filter(({ code }) => code === 'runtime-static-fallback-missing')).toHaveLength(4)
    expect(new Set(first.map(({ target }) => (
      target.kind === 'layer-item' ? target.owner : target.kind
    )))).toEqual(new Set(['global', 'surface', 'scene', 'world']))
    expect(collectCourseProjectHealth(project, {
      assetFiles,
      componentFiles: {},
    }).some(({ code }) => code === 'asset-unused')).toBe(false)
  })

  it('checks schema-valid Slide rules while accepting global Flow and Spatial layer references', () => {
    const project = blankProject()
    const { scene } = slide(project)
    const { flow, spatial } = addFlowAndSpatial(project)
    const slideItem = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'slide-shape',
      name: 'Slide 图形',
    }), 0)
    const flowItem = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'flow-shape',
      name: 'Flow 图形',
    }), 0)
    const spatialItem = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'spatial-shape',
      name: 'Spatial 图形',
    }), 0)
    const stateHiddenEnterTarget = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'state-hidden-enter-target',
      name: '状态中初始隐藏',
    }), 1)
    scene.layerItems.push(slideItem, stateHiddenEnterTarget)
    scene.presentation!.states[0]!.layerItemOverrides[stateHiddenEnterTarget.layerItemId] = {
      playbackInitialVisibility: 'hidden',
    }
    flow.surfaceLayerItems.push({
      item: flowItem,
      visibility: { mode: 'all', locationIds: [] },
    })
    spatial.world.layerItems.push(spatialItem)
    project.globalInteractions.push(
      {
        id: 'flow-click',
        enabled: true,
        trigger: { type: 'node.click', nodeId: flowItem.layerItemId },
        conditions: [],
        actions: [{
          id: 'flow-next',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      {
        id: 'spatial-click',
        enabled: true,
        trigger: { type: 'node.click', nodeId: spatialItem.layerItemId },
        conditions: [],
        actions: [{
          id: 'spatial-next',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
    )
    scene.interactions.push(
      {
        id: 'wrong-component',
        enabled: true,
        trigger: { type: 'component.event', nodeId: slideItem.layerItemId, eventName: 'done' },
        conditions: [],
        actions: [{
          id: 'wrong-component-next',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      {
        id: 'missing-animation',
        enabled: true,
        trigger: { type: 'animation.completed', actionId: 'not-an-action' },
        conditions: [],
        actions: [{
          id: 'enter-shape',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: slideItem.layerItemId,
            durationMs: 200,
            easing: 'linear',
            effect: 'fade',
          },
        }],
      },
      {
        id: 'missing-state',
        enabled: true,
        trigger: { type: 'presentation.enter', stateId: 'missing-state' },
        conditions: [],
        actions: [{
          id: 'missing-state-next',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      {
        id: 'missing-scene',
        enabled: true,
        trigger: { type: 'scene.enter' },
        conditions: [],
        actions: [{
          id: 'go-missing',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.go', sceneId: 'missing-slide-scene' },
        }],
      },
      {
        id: 'state-hidden-enter',
        enabled: true,
        trigger: { type: 'scene.enter' },
        conditions: [{
          type: 'presentation.in',
          stateIds: [scene.presentation!.initialStateId],
        }],
        actions: [{
          id: 'state-hidden-enter-action',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: stateHiddenEnterTarget.layerItemId,
            durationMs: 200,
            easing: 'linear',
            effect: 'fade',
          },
        }],
      },
    )

    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    const findings = collectCourseProjectHealth(project, EMPTY_FILES)
    expect(new Set(findings.map(({ code }) => code))).toEqual(new Set([
      'interaction-action-reference-missing',
      'interaction-enter-target-initially-visible',
      'interaction-node-type-mismatch',
      'interaction-scene-reference-missing',
      'interaction-state-reference-missing',
    ]))
    expect(findings.every(({ target }) => target.version === 1)).toBe(true)
    expect(findings).not.toContainEqual(expect.objectContaining({
      code: 'interaction-enter-target-initially-visible',
      layerItemId: stateHiddenEnterTarget.layerItemId,
    }))
  })

  it('derives component metadata and usage from opened package files and nested Flow blocks', () => {
    const project = blankProject()
    const packageId = 'com.example.health'
    const version = '1.0.0'
    project.componentPackages[packageId] = {
      packageId,
      version,
      name: 'Health component',
      manifestPath: 'manifest.json',
      runtimePath: 'runtime.js',
      contentSha256: '0'.repeat(64),
    }
    const files: CourseProjectHealthArchiveFiles = {
      assetFiles: {},
      componentFiles: {
        [`${packageId}@${version}`]: componentArchiveFiles(packageId, version),
      },
    }

    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    expect(new Set(collectCourseProjectHealth(project, files).map(({ code }) => code))).toEqual(
      new Set([
        'component-package-hash-missing',
        'component-package-source-missing',
        'component-package-unused',
        'component-thumbnail-missing',
      ]),
    )

    const assetFiles: Record<string, Uint8Array> = {}
    addImageAsset(project, assetFiles, 'component-fallback')
    const { flow } = addFlowAndSpatial(project)
    flow.blocks.push({
      id: 'component-section',
      type: 'section',
      title: '组件',
      collapsedByDefault: false,
      blocks: [{
        id: 'flow-component',
        type: 'component',
        component: { packageId, version },
        props: {},
        staticFallbackAssetId: 'component-fallback',
      }],
    })
    const usedFiles = { ...files, assetFiles }
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    const usedFindings = collectCourseProjectHealth(project, usedFiles)
    expect(usedFindings.some(({ code }) => code === 'component-package-unused')).toBe(false)
    expect(usedFindings.filter(({ code }) => code.startsWith('component-')).every(
      ({ target }) => target.kind === 'component-package',
    )).toBe(true)
  })

  it('checks V9 controller, media, asset overrides and video reachability', () => {
    const project = blankProject()
    const { scene } = slide(project)
    addFlowAndSpatial(project)
    const assetFiles: Record<string, Uint8Array> = {}
    addImageAsset(project, assetFiles, 'base-image')
    addImageAsset(project, assetFiles, 'wrong-audio-kind')
    addImageAsset(project, assetFiles, 'video-asset', 'video')
    addImageAsset(project, assetFiles, 'unused-image')
    project.playback.controls = 'canvas'
    project.media.audio.sounds.sound_key = {
      id: 'different_sound_id',
      name: '错误声音',
      assetId: 'wrong-audio-kind',
      channel: 'sfx',
      defaultVolume: 1,
      defaultLoop: false,
    }
    const image = sceneNodeToCourseLayerItem(createImageNode({
      id: 'state-image',
      assetId: 'base-image',
    }), 0)
    const video = sceneNodeToCourseLayerItem(createVideoNode({
      id: 'loop-video',
      assetId: 'video-asset',
      loop: true,
      clickToToggle: true,
      showControls: true,
    }), 1)
    const controller = sceneNodeToCourseLayerItem(createTeacherControllerNode({
      id: 'bad-controller',
      buttons: [{
        id: 'bad-target',
        label: 'Slide 目标',
        visible: true,
        action: { type: 'scene.go', sceneId: scene.id },
      }, {
        id: 'flow-target',
        label: 'Flow 目标',
        visible: true,
        action: { type: 'scene.go', sceneId: 'flow-block' },
      }, {
        id: 'spatial-target',
        label: 'Spatial 目标',
        visible: true,
        action: { type: 'scene.go', sceneId: 'spatial-frame' },
      }],
    }), 2)
    scene.layerItems.push(image, video, controller)
    scene.presentation!.states[0]!.layerItemOverrides[image.layerItemId] = {
      nativeData: { assetId: 'missing-state-asset' },
    }
    scene.presentation!.states[0]!.layerItemOverrides[controller.layerItemId] = {
      nativeData: {
        buttons: [{
          id: 'bad-state-target',
          label: '坏目标',
          visible: true,
          action: { type: 'scene.go', sceneId: 'missing-location' },
        }],
      },
    }
    scene.interactions.push(
      {
        id: 'video-click',
        enabled: true,
        trigger: { type: 'node.click', nodeId: video.layerItemId },
        conditions: [],
        actions: [{
          id: 'video-click-next',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      {
        id: 'video-ended',
        enabled: true,
        trigger: { type: 'video.ended', nodeId: video.layerItemId },
        conditions: [],
        actions: [{
          id: 'video-ended-next',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
    )

    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    const findings = collectCourseProjectHealth(project, { assetFiles, componentFiles: {} })
    const codes = new Set(findings.map(({ code }) => code))
    expect(codes).toEqual(new Set([
      'asset-kind-mismatch',
      'asset-reference-missing',
      'asset-unused',
      'controller-required-for-canvas',
      'controller-scene-target-missing',
      'looping-video-ended-unreachable',
      'sound-id-mismatch',
      'video-click-interaction-conflict',
    ]))
    expect(findings.every(({ target }) => target.version === 1)).toBe(true)
  })

  it('covers global partial states, cross-surface scene ids and hidden reveal paths', () => {
    const project = blankProject()
    const { surface, scene } = slide(project)
    const selfHidden = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'self-hidden',
      name: '自触发隐藏元素',
      playbackInitialVisibility: 'hidden',
    }), 0)
    const unreachable = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'unreachable-hidden',
      name: '不可达隐藏元素',
      playbackInitialVisibility: 'hidden',
    }), 1)
    const globallyReachable = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'globally-reachable-hidden',
      name: '全局规则可达隐藏元素',
      playbackInitialVisibility: 'hidden',
    }), 2)
    const controller = sceneNodeToCourseLayerItem(createTeacherControllerNode({
      id: 'state-controller',
      buttons: [{
        id: 'missing-target-state',
        label: '缺失状态',
        visible: true,
        action: {
          type: 'scene.go',
          sceneId: scene.id,
          targetStateId: 'missing-controller-state',
        },
      }],
    }), 3)
    scene.layerItems.push(selfHidden, unreachable, globallyReachable, controller)
    scene.interactions.push(
      {
        id: 'self-reveal',
        enabled: true,
        trigger: { type: 'node.click', nodeId: selfHidden.layerItemId },
        conditions: [],
        actions: [{
          id: 'self-enter',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: selfHidden.layerItemId,
            durationMs: 200,
            easing: 'linear',
            effect: 'fade',
          },
        }],
      },
      {
        id: 'animation-loop',
        enabled: true,
        trigger: { type: 'animation.completed', actionId: 'loop-enter' },
        conditions: [],
        actions: [{
          id: 'loop-enter',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: unreachable.layerItemId,
            durationMs: 200,
            easing: 'linear',
            effect: 'fade',
          },
        }],
      },
    )

    const duplicateSurface: Extract<CourseSurfaceDocument, { type: 'slide' }> = {
      id: 'duplicate-slide-surface',
      title: '第二 Slide',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [{
        id: scene.id,
        name: '重复 ID 场景',
        backgroundColor: '#ffffff',
        backgroundAssetId: null,
        layerItems: [],
        presentation: {
          initialStateId: 'state_second',
          states: [{ id: 'state_second', name: '第二状态', layerItemOverrides: {} }],
        },
        interactions: [],
      }],
    }
    project.surfaces.push(duplicateSurface)
    project.locations.push({
      id: 'duplicate-scene-location',
      label: '重复 ID 场景',
      kind: 'slide-scene',
      surfaceId: duplicateSurface.id,
      sceneId: scene.id,
    })
    project.mixedPrintPlan = {
      pageSize: 'surface-native',
      orientation: 'auto',
      entries: [
        { id: 'print-first', kind: 'slide-scenes', surfaceId: surface.id, sceneIds: [scene.id] },
        {
          id: 'print-duplicate',
          kind: 'slide-scenes',
          surfaceId: duplicateSurface.id,
          sceneIds: [scene.id],
        },
      ],
    }
    project.globalInteractions.push({
      id: 'partial-global-state',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'set-partial-state',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'presentation.set', stateId: 'state_initial' },
      }],
    })
    project.globalInteractions.push({
      id: 'global-reveal',
      enabled: true,
      trigger: { type: 'node.click', nodeId: controller.layerItemId },
      conditions: [{ type: 'scene.in', sceneIds: [scene.id] }],
      actions: [{
        id: 'global-reveal-enter',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'node.enter',
          nodeId: globallyReachable.layerItemId,
          durationMs: 200,
          easing: 'linear',
          effect: 'fade',
        },
      }],
    })
    project.globalInteractions.push({
      id: 'union-global-state-reference',
      enabled: true,
      trigger: { type: 'presentation.enter', stateId: 'state_initial' },
      conditions: [],
      actions: [{
        id: 'union-global-state-next',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'scene.next' },
      }],
    })

    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    const findings = collectCourseProjectHealth(project, EMPTY_FILES)
    const codes = new Set(findings.map(({ code }) => code))
    expect(codes).toEqual(new Set([
      'controller-state-target-missing',
      'global-interaction-state-target-partial',
      'information-release-hidden-self-trigger',
      'information-release-hidden-unreachable',
      'interaction-animation-self-loop',
      'scene-id-duplicate',
    ]))
    expect(findings.filter(
      ({ code }) => code === 'global-interaction-state-target-partial',
    )).toHaveLength(1)
    expect(findings.some(({ layerItemId }) => (
      layerItemId === globallyReachable.layerItemId
    ))).toBe(false)
  })

  it('checks presenter strategy variants without changing their legacy severity', () => {
    const authored = blankProject()
    authored.playback.presenter.strategy = 'authored-command'
    authored.playback.presenter.additionalBindings.push({
      id: 'f5-binding',
      command: 'next',
      key: 'F5',
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
    })
    const authoredFindings = collectCourseProjectHealth(authored, EMPTY_FILES)
    expect(authoredFindings.filter(({ code }) => code === 'presenter-command-unhandled')).toHaveLength(1)
    expect(authoredFindings.find(({ code }) => code === 'presenter-f5-browser-reserved')?.severity)
      .toBe('warning')

    const disabled = blankProject()
    disabled.playback.presenter.enabled = false
    disabled.globalInteractions.push({
      id: 'disabled-presenter-rule',
      enabled: true,
      trigger: { type: 'presenter.command', command: 'next' },
      conditions: [],
      actions: [{
        id: 'disabled-presenter-next',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'scene.next' },
      }],
    })
    expect(courseProjectDocumentSchema.safeParse(disabled).success).toBe(true)
    expect(collectCourseProjectHealth(disabled, EMPTY_FILES)).toContainEqual(
      expect.objectContaining({ code: 'presenter-rules-disabled', severity: 'warning' }),
    )

    const bypassed = blankProject()
    bypassed.globalInteractions.push(structuredClone(disabled.globalInteractions[0]!))
    expect(courseProjectDocumentSchema.safeParse(bypassed).success).toBe(true)
    expect(collectCourseProjectHealth(bypassed, EMPTY_FILES)).toContainEqual(
      expect.objectContaining({ code: 'presenter-rules-bypassed', severity: 'info' }),
    )
  })

  it('uses opened Component API 4 manifest image properties for asset references', () => {
    const project = blankProject()
    const { scene } = slide(project)
    const assetFiles: Record<string, Uint8Array> = {}
    addImageAsset(project, assetFiles, 'component-audio', 'audio')
    const manifest = {
      ...componentManifest('com.example.image-prop'),
      defaultProps: { imageAssetId: 'missing-component-image' },
      editor: {
        properties: [
          { key: 'imageAssetId', label: '组件图片', type: 'image' as const },
          { key: 'alternateImageId', label: '备用图片', type: 'image' as const },
        ],
      },
    }
    const imported = parseComponentPackageFiles({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'runtime.js': strToU8('window.CoursewareComponent.define({})'),
    })
    project.componentPackages[manifest.id] = imported.metadata
    const component: LayerItem = {
      layerItemId: 'image-component',
      label: '图片组件',
      frame: { mode: 'absolute', x: 0, y: 0, width: 320, height: 180 },
      order: 0,
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      kind: 'component',
      component: { packageId: manifest.id, version: manifest.version },
      props: { alternateImageId: 'component-audio' },
    }
    scene.layerItems.push(component)

    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    expect(collectCourseProjectHealth(project, {
      assetFiles,
      componentFiles: { [imported.key]: imported.files },
    })).toContainEqual(expect.objectContaining({
      code: 'asset-reference-missing',
      severity: 'error',
      target: expect.objectContaining({
        kind: 'component-package',
        packageId: manifest.id,
      }),
    }))
    expect(collectCourseProjectHealth(project, {
      assetFiles,
      componentFiles: { [imported.key]: imported.files },
    })).toContainEqual(expect.objectContaining({
      code: 'asset-kind-mismatch',
      layerItemId: component.layerItemId,
      severity: 'error',
    }))
  })

  it('detects a delivery-visible global controller when controls are disabled', () => {
    const project = blankProject()
    const item = sceneNodeToCourseLayerItem(createTeacherControllerNode({
      id: 'global-controller',
    }), 0)
    project.globalLayerItems.push({
      item,
      visibility: { mode: 'all', locationIds: [] },
    })

    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    expect(collectCourseProjectHealth(project, EMPTY_FILES).map(({ code }) => code)).toContain(
      'controller-visible-while-disabled',
    )
  })
})
