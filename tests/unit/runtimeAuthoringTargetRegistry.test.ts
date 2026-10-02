import { describe, expect, it, vi } from 'vitest'
import {
  RuntimeAuthoringTargetRegistry,
} from '@/player/RuntimeAuthoringTargetRegistry'

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}

async function flushTargets(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('RuntimeAuthoringTargetRegistry', () => {
  it('只登记已公开的文字/素材键，并把动态区域归一化到 1280x720', async () => {
    const onTargetsChanged = vi.fn()
    const registry = new RuntimeAuthoringTargetRegistry({
      scope: 'scene',
      sceneId: 'scene-one',
      width: 640,
      height: 360,
      content: {
        values: { title: '标题' },
        metadata: {
          title: { label: '内容标题', multiline: true, maxLength: 80 },
        },
      },
      assets: { hero: { assetId: 'asset-hero' } },
      onTargetsChanged,
    })

    const disposeTitle = registry.register({
      kind: 'text',
      key: 'title',
      getBounds: () => ({ x: 10, y: 20, width: 100, height: 50 }),
    })
    registry.register({
      kind: 'asset',
      key: 'missing',
      getBounds: () => ({ x: 1, y: 1, width: 10, height: 10 }),
    })
    await flushTargets()

    expect(onTargetsChanged).toHaveBeenCalledOnce()
    const firstUpdate = onTargetsChanged.mock.calls[0]?.[0]
    expect(firstUpdate).toMatchObject({
      revision: 1,
      scope: 'scene',
      sceneId: 'scene-one',
      targets: [{
        targetId: 'registered:1',
        scope: 'scene',
        sceneId: 'scene-one',
        kind: 'text',
        key: 'title',
        label: '内容标题',
        multiline: true,
        maxLength: 80,
        layer: 'overlay',
        source: 'registered',
        bounds: { x: 20, y: 40, width: 200, height: 100 },
      }],
    })

    registry.resize(1280, 720)
    await flushTargets()
    expect(onTargetsChanged.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 2,
      targets: [{ bounds: { x: 10, y: 20, width: 100, height: 50 } }],
    })

    disposeTitle()
    await flushTargets()
    expect(onTargetsChanged.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 3,
      targets: [],
    })
    registry.destroy()
  })

  it('把登记边界归一化到调用方传入的非 16:9 画布', async () => {
    const onTargetsChanged = vi.fn()
    const registry = new RuntimeAuthoringTargetRegistry({
      scope: 'scene',
      sceneId: 'scene-portrait',
      width: 360,
      height: 640,
      canvas: { width: 720, height: 1280 },
      content: { values: { title: '标题' } },
      assets: {},
      onTargetsChanged,
    })
    registry.register({
      kind: 'text',
      key: 'title',
      getBounds: () => ({ x: 10, y: 20, width: 100, height: 50 }),
    })
    await flushTargets()
    expect(onTargetsChanged.mock.calls.at(-1)?.[0].targets[0].bounds).toEqual({
      x: 20,
      y: 40,
      width: 200,
      height: 100,
    })
    registry.destroy()
  })

  it('扫描两个 DOM 层的显式 data 属性，并在 DOM 变化与销毁时清理快照', async () => {
    const underlay = document.createElement('div')
    const overlay = document.createElement('div')
    vi.spyOn(underlay, 'getBoundingClientRect')
      .mockReturnValue(rect(100, 50, 640, 360))
    vi.spyOn(overlay, 'getBoundingClientRect')
      .mockReturnValue(rect(100, 50, 640, 360))

    const asset = document.createElement('img')
    asset.dataset.coursewareAssetKey = 'hero'
    asset.dataset.coursewareEditLabel = '主视觉'
    vi.spyOn(asset, 'getBoundingClientRect')
      .mockReturnValue(rect(100, 50, 128, 72))
    underlay.append(asset)

    const title = document.createElement('h1')
    title.dataset.coursewareEditKey = 'title'
    title.dataset.coursewareEditMultiline = 'false'
    vi.spyOn(title, 'getBoundingClientRect')
      .mockReturnValue(rect(164, 86, 320, 72))
    overlay.append(title)

    const ignored = document.createElement('span')
    ignored.dataset.coursewareEditKey = 'source-only-copy'
    vi.spyOn(ignored, 'getBoundingClientRect')
      .mockReturnValue(rect(200, 200, 100, 20))
    overlay.append(ignored)

    const onTargetsChanged = vi.fn()
    const registry = new RuntimeAuthoringTargetRegistry({
      scope: 'global',
      width: 1280,
      height: 720,
      content: {
        values: { title: '标题' },
        metadata: {
          title: { label: '标题文字', multiline: true, maxLength: 120 },
        },
      },
      assets: { hero: { assetId: 'asset-hero' } },
      domRoots: { underlay, overlay },
      onTargetsChanged,
    })
    await flushTargets()

    const firstUpdate = onTargetsChanged.mock.calls[0]?.[0]
    expect(firstUpdate).toMatchObject({ scope: 'global' })
    expect(firstUpdate.targets).toEqual([
      expect.objectContaining({
        targetId: 'dom:1:asset',
        scope: 'global',
        kind: 'asset',
        key: 'hero',
        label: '主视觉',
        layer: 'underlay',
        bounds: { x: 0, y: 0, width: 256, height: 144 },
      }),
      expect.objectContaining({
        targetId: 'dom:2:text',
        scope: 'global',
        kind: 'text',
        key: 'title',
        label: '标题文字',
        multiline: false,
        maxLength: 120,
        layer: 'overlay',
        bounds: { x: 128, y: 72, width: 640, height: 144 },
      }),
    ])

    registry.invalidate()
    await flushTargets()
    expect(onTargetsChanged).toHaveBeenCalledOnce()

    title.remove()
    await flushTargets()
    expect(onTargetsChanged.mock.calls.at(-1)?.[0].targets).toEqual([
      expect.objectContaining({ kind: 'asset', key: 'hero' }),
    ])

    const callsBeforeDestroy = onTargetsChanged.mock.calls.length
    registry.destroy()
    expect(onTargetsChanged).toHaveBeenCalledTimes(callsBeforeDestroy + 1)
    expect(onTargetsChanged.mock.calls.at(-1)?.[0].targets).toEqual([])

    overlay.append(title)
    await flushTargets()
    expect(onTargetsChanged).toHaveBeenCalledTimes(callsBeforeDestroy + 1)
  })

  it('每层只在第 401 个合格自动目标出现时提示截断，目标不变也发布提示增减', async () => {
    const underlay = document.createElement('div')
    const overlay = document.createElement('div')
    for (const root of [underlay, overlay]) {
      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 640, 360))
    }
    const addImage = (root: HTMLElement, src = 'https://assets.example/hero.png', width = 20) => {
      const image = document.createElement('img')
      image.src = src
      vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(10, 10, width, 20))
      root.append(image)
      return image
    }
    for (const root of [underlay, overlay]) {
      for (let index = 0; index < 400; index += 1) addImage(root)
    }
    const onTargetsChanged = vi.fn()
    const registry = new RuntimeAuthoringTargetRegistry({
      scope: 'scene',
      sceneId: 'scene-one',
      width: 640,
      height: 360,
      content: { values: { title: '声明文字' } },
      assets: { hero: { assetId: 'asset-hero' } },
      domRoots: { underlay, overlay },
      lightEdit: {
        assetKeyForUrl: (url) => url === 'https://assets.example/hero.png' ? 'hero' : undefined,
      },
      onTargetsChanged,
    })
    registry.register({
      kind: 'text', key: 'title', layer: 'overlay',
      getBounds: () => ({ x: 0, y: 0, width: 20, height: 20 }),
    })
    await flushTargets()
    const first = onTargetsChanged.mock.calls.at(-1)![0]
    expect(first.truncated).toBeUndefined()
    expect(first.targets.filter((target: { source: string; layer: string }) => target.source === 'auto' && target.layer === 'underlay')).toHaveLength(400)
    expect(first.targets.filter((target: { source: string; layer: string }) => target.source === 'auto' && target.layer === 'overlay')).toHaveLength(400)
    expect(first.targets).toHaveLength(801)

    addImage(overlay, 'https://assets.example/unknown.png')
    addImage(overlay, undefined, 0)
    await flushTargets()
    expect(onTargetsChanged).toHaveBeenCalledOnce()

    const extra = addImage(overlay)
    await flushTargets()
    expect(onTargetsChanged).toHaveBeenCalledTimes(2)
    expect(onTargetsChanged.mock.calls.at(-1)![0]).toMatchObject({ revision: 2, truncated: true })
    expect(onTargetsChanged.mock.calls.at(-1)![0].targets).toEqual(first.targets)

    extra.remove()
    await flushTargets()
    expect(onTargetsChanged).toHaveBeenCalledTimes(3)
    expect(onTargetsChanged.mock.calls.at(-1)![0].truncated).toBeUndefined()
    expect(onTargetsChanged.mock.calls.at(-1)![0].targets).toEqual(first.targets)
    registry.destroy()
    expect(onTargetsChanged.mock.calls.at(-1)![0].targets).toEqual([])
    expect(onTargetsChanged.mock.calls.at(-1)![0].truncated).toBeUndefined()
  })
})
