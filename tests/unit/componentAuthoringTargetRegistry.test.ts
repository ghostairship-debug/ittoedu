import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ComponentAuthoringTargetRegistry,
  type ComponentHostNode,
} from '@/player/ComponentAuthoringTargetRegistry'
import { componentManifestSchema } from '@/shared/componentSchema'
import type {
  ComponentEditorHost,
  ComponentEditableTextBounds,
  ComponentManifestV4,
} from '@/shared/componentTypes'

const manifest = componentManifestSchema.parse({
  schemaVersion: 4,
  runtimeApiVersion: 4,
  renderMode: 'hybrid',
  supportedScopes: ['scene', 'global'],
  id: 'com.example.authoring-targets',
  name: '画布文字组件',
  version: '4.0.0',
  entry: 'runtime.js',
  defaultSize: { width: 400, height: 200 },
  minSize: { width: 100, height: 50 },
  preserveAspectRatio: false,
  assets: {},
  defaultProps: {
    content: { title: '默认标题', body: '默认正文' },
    count: 7,
  },
  editor: {
    properties: [
      {
        key: 'content.title',
        label: '主标题',
        type: 'text',
        maxLength: 80,
      },
      {
        key: 'content.body',
        label: '正文',
        type: 'textarea',
        maxLength: 500,
      },
      { key: 'count', label: '数量', type: 'number' },
    ],
  },
}) as ComponentManifestV4

function node(
  overrides: Partial<ComponentHostNode> = {},
) {
  return {
    id: 'component-one',
    name: '测试组件',
    type: 'external-component',
    x: 100,
    y: 80,
    width: 400,
    height: 200,
    rotation: 90,
    opacity: 1,
    visible: true,
    playbackInitialVisibility: 'inherit',
    locked: false,
    component: {
      packageId: manifest.id,
      version: manifest.version,
    },
    props: {
      content: { title: '实例标题', body: '实例正文' },
      count: 12,
    },
    ...overrides,
  }
}

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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ComponentAuthoringTargetRegistry', () => {
  it('显式 invalidate 合并重算，注销和销毁后的调用安全无效', async () => {
    const onTargetsChanged = vi.fn()
    let bounds: ComponentEditableTextBounds = {
      x: 10,
      y: 20,
      width: 120,
      height: 30,
    }
    const registry = new ComponentAuthoringTargetRegistry({
      manifest,
      node: node({ x: 0, y: 0, rotation: 0 }),
      scope: 'scene',
      sceneId: 'scene-one',
      onTargetsChanged,
    })
    const editor: ComponentEditorHost = registry
    const dispose = editor.registerTextRegion({
      key: 'content.title',
      getBounds: () => bounds,
    })
    await flushTargets()

    expect(onTargetsChanged).toHaveBeenCalledTimes(1)
    expect(onTargetsChanged.mock.calls[0]?.[0]).toMatchObject({
      revision: 1,
      targets: [{ bounds }],
    })

    bounds = { x: 50, y: 60, width: 160, height: 40 }
    editor.invalidate()
    editor.invalidate()
    editor.invalidate()
    await flushTargets()

    expect(onTargetsChanged).toHaveBeenCalledTimes(2)
    expect(onTargetsChanged.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 2,
      targets: [{ bounds }],
    })

    dispose()
    dispose()
    await flushTargets()
    expect(onTargetsChanged.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 3,
      targets: [],
    })

    const callsBeforeDestroy = onTargetsChanged.mock.calls.length
    registry.destroy()
    expect(() => editor.invalidate()).not.toThrow()
    expect(() => dispose()).not.toThrow()
    expect(() => editor.registerTextRegion({
      key: 'content.title',
      getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    })()).not.toThrow()
    await flushTargets()
    expect(onTargetsChanged).toHaveBeenCalledTimes(callsBeforeDestroy)
  })

  it('接收 ctx.editor 区域但只输出 schema 公开且当前值为字符串的字段', async () => {
    const onTargetsChanged = vi.fn()
    let titleBounds: ComponentEditableTextBounds = {
      x: 40,
      y: 20,
      width: 200,
      height: 40,
    }
    let bodyBounds: ComponentEditableTextBounds = {
      x: 250,
      y: 120,
      width: 100,
      height: 60,
    }
    const registry = new ComponentAuthoringTargetRegistry({
      manifest,
      node: node(),
      scope: 'scene',
      sceneId: 'scene-one',
      onTargetsChanged,
    })
    const disposeTitle = registry.registerTextRegion({
      key: 'content.title',
      getBounds: () => titleBounds,
    })
    registry.registerTextRegion({
      key: 'content.body',
      multiline: false,
      getBounds: () => bodyBounds,
    })
    registry.registerTextRegion({
      key: 'count',
      getBounds: () => ({ x: 1, y: 1, width: 20, height: 20 }),
    })
    await flushTargets()

    const firstUpdate = onTargetsChanged.mock.calls[0]?.[0]
    expect(firstUpdate).toMatchObject({
      revision: 1,
      scope: 'scene',
      sceneId: 'scene-one',
      nodeId: 'component-one',
      targets: [
        {
          kind: 'component-text',
          targetId: 'registered:1',
          nodeId: 'component-one',
          componentId: manifest.id,
          key: 'content.title',
          label: '主标题',
          multiline: false,
          maxLength: 80,
          source: 'registered',
          bounds: { x: 260, y: 100, width: 200, height: 40 },
          rotation: 90,
        },
        {
          kind: 'component-text',
          targetId: 'registered:2',
          key: 'content.body',
          label: '正文',
          multiline: false,
          maxLength: 500,
          source: 'registered',
          bounds: { x: 200, y: 250, width: 100, height: 60 },
          rotation: 90,
        },
      ],
    })

    titleBounds = { x: 10, y: 10, width: 50, height: 20 }
    bodyBounds = { x: 50, y: 20, width: 100, height: 40 }
    registry.update(node({
      x: 20,
      y: 30,
      width: 200,
      height: 100,
      rotation: 0,
      props: { content: { title: 9, body: '更新正文' }, count: 12 },
    }))
    await flushTargets()

    expect(onTargetsChanged.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 2,
      targets: [{
        targetId: 'registered:2',
        key: 'content.body',
        bounds: { x: 70, y: 50, width: 100, height: 40 },
        rotation: 0,
      }],
    })

    registry.update(node({ visible: false }))
    await flushTargets()
    expect(onTargetsChanged.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 3,
      targets: [],
    })

    expect(() => registry.update(node({ id: 'another-component' })))
      .toThrow('不能切换到另一个节点实例')
    disposeTitle()
    registry.destroy()
  })

  it('扫描 DOM 显式 key，响应元素 resize/移除并在销毁后停止发布', async () => {
    let resizeCallback: ResizeObserverCallback | undefined
    const observe = vi.fn()
    const unobserve = vi.fn()
    const disconnect = vi.fn()
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe = observe
      unobserve = unobserve
      disconnect = disconnect
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const root = document.createElement('div')
    const title = document.createElement('h1')
    title.dataset.coursewareEditKey = 'content.title'
    title.dataset.coursewareEditLabel = '画布标题'
    title.dataset.coursewareEditMultiline = 'true'
    const count = document.createElement('span')
    count.dataset.coursewareEditKey = 'count'
    root.append(title, count)

    vi.spyOn(root, 'getBoundingClientRect')
      .mockReturnValue(rect(0, 0, 400, 200))
    let titleRect = rect(40, 20, 200, 40)
    vi.spyOn(title, 'getBoundingClientRect')
      .mockImplementation(() => titleRect)
    vi.spyOn(count, 'getBoundingClientRect')
      .mockReturnValue(rect(10, 10, 40, 20))

    const onTargetsChanged = vi.fn()
    const registry = new ComponentAuthoringTargetRegistry({
      manifest,
      node: node(),
      scope: 'global',
      domRoot: root,
      onTargetsChanged,
    })
    await flushTargets()

    expect(onTargetsChanged.mock.calls[0]?.[0]).toMatchObject({
      revision: 1,
      scope: 'global',
      nodeId: 'component-one',
      targets: [{
        kind: 'component-text',
        targetId: 'dom:1',
        key: 'content.title',
        label: '画布标题',
        multiline: true,
        maxLength: 80,
        source: 'dom',
        bounds: { x: 260, y: 100, width: 200, height: 40 },
        rotation: 90,
      }],
    })
    expect(observe).toHaveBeenCalledWith(root)
    expect(observe).toHaveBeenCalledWith(title)
    expect(observe).toHaveBeenCalledWith(count)

    titleRect = rect(80, 20, 100, 40)
    resizeCallback?.([], {} as ResizeObserver)
    await flushTargets()
    expect(onTargetsChanged.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 2,
      targets: [{
        bounds: { x: 310, y: 90, width: 100, height: 40 },
        rotation: 90,
      }],
    })

    title.remove()
    await flushTargets()
    expect(onTargetsChanged.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 3,
      targets: [],
    })
    expect(unobserve).toHaveBeenCalledWith(title)

    const callsBeforeDestroy = onTargetsChanged.mock.calls.length
    registry.destroy()
    expect(disconnect).toHaveBeenCalled()
    root.append(title)
    resizeCallback?.([], {} as ResizeObserver)
    await flushTargets()
    expect(onTargetsChanged).toHaveBeenCalledTimes(callsBeforeDestroy)
  })

  it('把编辑态中禁用的 DOM 按钮文字作为可编辑目标发布', async () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    button.disabled = true
    button.textContent = '锁定预测'
    button.dataset.coursewareEditKey = 'content.title'
    button.dataset.coursewareEditLabel = '按钮文字'
    root.append(button)

    vi.spyOn(root, 'getBoundingClientRect')
      .mockReturnValue(rect(0, 0, 400, 200))
    vi.spyOn(button, 'getBoundingClientRect')
      .mockReturnValue(rect(20, 30, 160, 32))

    const onTargetsChanged = vi.fn()
    const registry = new ComponentAuthoringTargetRegistry({
      manifest,
      node: node({ x: 0, y: 0, rotation: 0 }),
      scope: 'scene',
      sceneId: 'scene-one',
      domRoot: root,
      onTargetsChanged,
    })
    await flushTargets()

    expect(onTargetsChanged.mock.calls[0]?.[0]).toMatchObject({
      targets: [{
        kind: 'component-text',
        key: 'content.title',
        label: '按钮文字',
        source: 'dom',
        bounds: { x: 20, y: 30, width: 160, height: 32 },
      }],
    })

    registry.destroy()
  })
})
