import { describe, expect, it } from 'vitest'
import type {
  PublishedComponentLayerItem,
  PublishedNativeLayerItem,
  PublishedRuntimeLayerItem,
} from '@/shared/publishedCourseTypes'
import type { NativeRenderInput } from '@/shared/contracts/native-v1/types'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'
import {
  applyPublishedSlideAuthoringItemPatch,
  mapRuntimeAuthoringTargetsToLayer,
  mergePublishedAuthoringFrame,
  publishedComponentAuthoringNode,
  validatePublishedSlideAuthoringIdentity,
  type PublishedSlideAuthoringIdentity,
  type PublishedSlideComponentAuthoringNode,
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

function componentHost(locked: boolean): PublishedSlideComponentAuthoringNode {
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

function publishedText(): PublishedNativeLayerItem {
  return {
    kind: 'native',
    layerItemId: 'text-one',
    frame: { mode: 'absolute', x: 40, y: 40, width: 240, height: 48 },
    order: 1,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    content: {
      nativeType: 'text',
      data: {
        text: '原文',
        runs: [],
        style: {
          fontFamily: 'sans-serif',
          fontSize: 18,
          color: '#172033',
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
          align: 'left',
          verticalAlign: 'top',
          writingMode: 'horizontal',
          lineSpacing: 1.2,
          letterSpacing: 0,
          padding: 0,
          overflow: 'fixed',
          backgroundColor: '#ffffff',
          backgroundOpacity: 0,
          cornerRadius: 0,
        },
      },
    },
  }
}

function textRenderInput(text: string): NativeRenderInput {
  return {
    id: 'text-one',
    name: 'text-one',
    type: 'text',
    x: 48,
    y: 52,
    width: 240,
    height: 48,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    playbackInitialVisibility: 'inherit',
    text,
    runs: [],
    style: {
      fontFamily: 'sans-serif',
      fontSize: 18,
      color: '#172033',
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      emphasis: false,
      highlightColor: null,
      align: 'left',
      verticalAlign: 'top',
      writingMode: 'horizontal',
      lineSpacing: 1.2,
      letterSpacing: 0,
      padding: 0,
      overflow: 'fixed',
      backgroundColor: '#ffffff',
      backgroundOpacity: 0,
      cornerRadius: 0,
    },
  }
}

function identity(
  itemId: string,
  extras: Partial<PublishedSlideAuthoringIdentity> = {},
): PublishedSlideAuthoringIdentity {
  return {
    target: { kind: 'native-node', scope: 'scene', nodeId: itemId },
    revision: 4,
    generation: 1,
    owner: 'scene',
    itemId,
    ...extras,
  }
}

describe('Published Slide authoring patch', () => {
  it('keeps the transient lock and suppresses component authoring targets', () => {
    const merged = mergePublishedAuthoringFrame(publishedComponent(), componentHost(true))
    expect(merged.ok).toBe(true)
    if (!merged.ok || merged.item.kind !== 'component') return

    expect(publishedComponentAuthoringNode(merged.item)).toMatchObject({
      locked: true,
      visible: false,
    })
  })

  it('merges Native render input without constructing SceneNode', () => {
    const merged = mergePublishedAuthoringFrame(publishedText(), textRenderInput('改写'))
    expect(merged.ok).toBe(true)
    if (!merged.ok || merged.item.kind !== 'native') return
    expect(merged.item.content.nativeType).toBe('text')
    expect(merged.item.content.data).toMatchObject({ text: '改写' })
    expect(merged.item.frame).toMatchObject({ x: 48, y: 52 })
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

  it('rejects stale revision and generation with zero merge', () => {
    const current = publishedText()
    const captured = identity('text-one')
    expect(validatePublishedSlideAuthoringIdentity({
      captured: { ...captured, revision: 3 },
      current: captured,
      item: current,
    })).toMatchObject({ ok: false, code: 'stale-revision' })
    expect(validatePublishedSlideAuthoringIdentity({
      captured: { ...captured, generation: 0 },
      current: captured,
      item: current,
    })).toMatchObject({ ok: false, code: 'stale-revision' })

    const stale = applyPublishedSlideAuthoringItemPatch({
      current,
      next: textRenderInput('不该写入'),
      captured: { ...captured, revision: 3 },
      currentIdentity: captured,
    })
    expect(stale).toMatchObject({ ok: false, code: 'stale-revision' })
    expect(current.content.data).toMatchObject({ text: '原文' })
  })

  it('rejects owner and missing item identity before writing', () => {
    const current = publishedText()
    const captured = identity('text-one')
    expect(applyPublishedSlideAuthoringItemPatch({
      current,
      next: textRenderInput('不该写入'),
      captured: { ...captured, owner: 'global' },
      currentIdentity: captured,
    })).toMatchObject({ ok: false, code: 'target-mismatch' })
    expect(applyPublishedSlideAuthoringItemPatch({
      current: null,
      next: textRenderInput('不该写入'),
      captured,
      currentIdentity: captured,
    })).toMatchObject({ ok: false, code: 'target-not-found' })
    expect(current.content.data).toMatchObject({ text: '原文' })
  })

  it('applies a current identity patch onto the Published item', () => {
    const current = publishedText()
    const captured = identity('text-one')
    const applied = applyPublishedSlideAuthoringItemPatch({
      current,
      next: textRenderInput('已写入'),
      captured,
      currentIdentity: captured,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok || applied.item.kind !== 'native') return
    expect(applied.item.content.data).toMatchObject({ text: '已写入' })
  })
})
