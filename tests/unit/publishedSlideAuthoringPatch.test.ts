import { describe, expect, it } from 'vitest'
import type {
  PublishedComponentLayerItem,
  PublishedRuntimeLayerItem,
} from '@/shared/publishedCourseTypes'
import type { ExternalComponentNode } from '@/shared/projectTypes'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'
import {
  mapRuntimeAuthoringTargetsToLayer,
  mergePublishedAuthoringNode,
  publishedComponentAuthoringNode,
} from '@/player/surfaces/slide/publishedSlideAuthoringPatch'

function publishedComponent(): PublishedComponentLayerItem {
  return {
    kind: 'component',
    layerItemId: 'component-one',
    frame: { mode: 'absolute', x: 100, y: 80, width: 400, height: 180 },
    order: 1,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    component: { packageId: 'com.example.locked', version: '4.0.0' },
    props: { title: '标题' },
  }
}

function componentNode(locked: boolean): ExternalComponentNode {
  return {
    id: 'component-one',
    name: '组件',
    type: 'external-component',
    x: 100,
    y: 80,
    width: 400,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked,
    playbackInitialVisibility: 'inherit',
    component: { packageId: 'com.example.locked', version: '4.0.0' },
    props: { title: '标题' },
  }
}

describe('Published Slide authoring patch', () => {
  it('keeps the transient lock and suppresses component authoring targets', () => {
    const merged = mergePublishedAuthoringNode(publishedComponent(), componentNode(true))
    expect(merged.ok).toBe(true)
    if (!merged.ok || merged.item.kind !== 'component') return

    expect(publishedComponentAuthoringNode(merged.item)).toMatchObject({
      locked: true,
      visible: false,
    })
  })

  it('adds the stable Runtime layer owner while mapping host-local targets', () => {
    const item: PublishedRuntimeLayerItem = {
      kind: 'runtime',
      layerItemId: 'runtime-layer-one',
      frame: { mode: 'absolute', x: 100, y: 80, width: 640, height: 360 },
      order: 2,
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      runtime: {
        protocol: 'canvas-runtime',
        runtimeApiVersion: 2,
        enabled: true,
        renderMode: 'dom',
        code: { encoding: 'base64-utf16le', data: '' },
        content: { values: { title: '标题' }, metadata: {} },
        assets: {},
        nodeBindings: {},
      },
    }
    const update: RuntimeAuthoringTargetUpdate = {
      revision: 1,
      scope: 'scene',
      sceneId: 'scene-one',
      targets: [{
        targetId: 'registered:1',
        scope: 'scene',
        sceneId: 'scene-one',
        kind: 'text',
        key: 'title',
        layer: 'overlay',
        source: 'registered',
        bounds: { x: 0, y: 0, width: 320, height: 180 },
      }],
    }

    expect(mapRuntimeAuthoringTargetsToLayer(update, item).targets[0])
      .toMatchObject({
        targetId: 'registered:1',
        nodeId: 'runtime-layer-one',
        bounds: { x: 100, y: 80, width: 160, height: 90 },
      })
  })
})
