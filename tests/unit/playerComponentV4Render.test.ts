import type * as Phaser from 'phaser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ComponentCreateContextV4,
  ComponentDefinitionV4,
  ComponentPackageData,
  ComponentRenderMode,
  ExportPayload,
} from '../../src/shared/componentTypes'
import type { ExternalComponentNode } from '../../src/shared/projectTypes'

const domHostMocks = vi.hoisted(() => ({
  create: vi.fn(),
}))

vi.mock('phaser', () => ({
  Geom: {
    Rectangle: class Rectangle {},
  },
}))

vi.mock('../../src/shared/phaserDomComponentHost', () => ({
  createPhaserDomComponentMount: domHostMocks.create,
}))

import {
  renderNode,
  type RenderNodeContext,
} from '../../src/player/renderNode'

type Listener = (...args: unknown[]) => void

class FakeGameObject {
  active = true
  visible = true
  alpha = 1
  depth = 0
  x = 0
  y = 0
  width = 0
  height = 0
  parentContainer: FakeContainer | null = null
  readonly emit = vi.fn()

  setName(): this { return this }
  setDepth(value: number): this { this.depth = value; return this }
  setAngle(): this { return this }
  setAlpha(value: number): this { this.alpha = value; return this }
  setVisible(value: boolean): this { this.visible = value; return this }
  setOrigin(): this { return this }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this }
  setSize(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }
  destroy(): void { this.active = false }
}

class FakeContainer extends FakeGameObject {
  readonly list: FakeGameObject[] = []

  add(children: FakeGameObject | FakeGameObject[]): this {
    for (const child of Array.isArray(children) ? children : [children]) {
      if (!this.list.includes(child)) this.list.push(child)
      child.parentContainer = this
    }
    return this
  }

  override destroy(): void {
    super.destroy()
    for (const child of this.list) child.destroy()
  }
}

class FakeGraphics extends FakeGameObject {
  clear(): this { return this }
  fillStyle(): this { return this }
  fillRoundedRect(): this { return this }
  lineStyle(): this { return this }
  strokeRoundedRect(): this { return this }
}

class FakeText extends FakeGameObject {
  setText(): this { return this }
  setWordWrapWidth(): this { return this }
}

function sceneHarness(): Phaser.Scene {
  const children: FakeGameObject[] = []
  const addToDisplayList = <T extends FakeGameObject>(object: T): T => {
    children.push(object)
    return object
  }
  return {
    add: {
      container: (x = 0, y = 0) => addToDisplayList(
        new FakeContainer().setPosition(x, y),
      ),
      graphics: () => addToDisplayList(new FakeGraphics()),
      text: () => addToDisplayList(new FakeText()),
    },
    children: { list: children },
    tweens: {
      killTweensOf: vi.fn(),
      add: vi.fn(),
    },
  } as unknown as Phaser.Scene
}

function packageData(renderMode: ComponentRenderMode): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      id: `com.example.${renderMode}`,
      name: `${renderMode} component`,
      version: '4.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 16, height: 16 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: {
        title: '可编辑标�?',
        previewPageId: 'intro',
      },
      editor: {
        properties: [{ key: 'title', label: '标题', type: 'text' }],
        pages: [
          { id: 'intro', label: '导入�?', propertyKeys: ['title'] },
          { id: 'detail', label: '讲解�?', propertyKeys: ['title'] },
        ],
        defaultPageId: 'intro',
        previewPageProp: 'previewPageId',
      },
      supportedScopes: ['scene'],
      renderMode,
    },
    runtimeSource: '',
    files: {},
  }
}

function componentNode(packageId: string): ExternalComponentNode {
  return {
    id: `node-${packageId}`,
    name: '测试组件',
    type: 'external-component',
    x: 10,
    y: 20,
    width: 320,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    playbackInitialVisibility: 'inherit',
    locked: false,
    component: { packageId, version: '4.0.0' },
    props: {},
  }
}

function mountHarness() {
  const host = document.createElement('div')
  const root = document.createElement('div')
  host.append(root)
  document.body.append(host)
  const gameObject = new FakeGameObject()
  return {
    root,
    host,
    gameObject,
    resize: vi.fn(),
    setInteractive: vi.fn(),
    setSelected: vi.fn(),
    sync: vi.fn(),
    destroy: vi.fn(() => {
      gameObject.destroy()
      host.remove()
    }),
  }
}

function renderComponent(
  renderMode: ComponentRenderMode,
  create: ComponentDefinitionV4['create'],
  contextOverrides: Partial<RenderNodeContext> = {},
  nodeOverrides: Partial<ExternalComponentNode> = {},
) {
  const component = packageData(renderMode)
  const definition: ComponentDefinitionV4 = {
    id: component.manifest.id,
    runtimeApiVersion: 4,
    create,
  }
  const registry = {
    get: vi.fn(() => definition),
    getLoadError: vi.fn(() => undefined),
  }
  const payload = {
    project: {
      canvas: { width: 1280, height: 720 },
    },
    assets: {},
    components: { [component.manifest.id]: component },
  } as unknown as ExportPayload
  const context: RenderNodeContext = {
    payload,
    registry: registry as never,
    actions: {
      goToScene: () => false,
      nextScene: () => false,
      previousScene: () => false,
      replayScene: () => false,
      restartCourse: () => false,
    },
    scope: 'scene',
    mode: 'preview',
    sceneId: 'scene-1',
    textureKey: (assetId) => assetId,
    ...contextOverrides,
  }
  const scene = sceneHarness()
  const node = {
    ...componentNode(component.manifest.id),
    ...nodeOverrides,
  }
  const handle = renderNode(scene, node, 1, context)
  return { component, context, definition, handle, node, registry, scene }
}

async function flushAuthoringTargets(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Player Component API 4 renderer capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.replaceChildren()
    domHostMocks.create.mockImplementation(() => mountHarness())
  })

  // Owner ruling (2026-09-03): hybrid dual-face rendering is a V2 product gap
  // (implementation pending). This table keeps only the hybrid row as the
  // behavior pin; phaser/dom rows are covered by V2 equivalents.
  it.each([
    ['hybrid', true, true],
  ] as const)(
    '%s 组件只获�? manifest 声明的渲染面',
    (renderMode, hasPhaser, hasDom) => {
      let received: ComponentCreateContextV4 | undefined
      const { handle } = renderComponent(renderMode, (context) => {
        received = context
        return { destroy() {} }
      })

      expect(received?.renderMode).toBe(renderMode)
      expect(received && 'phaser' in received).toBe(hasPhaser)
      expect(received && 'dom' in received).toBe(hasDom)
      expect(received && 'Phaser' in received).toBe(false)
      expect(received && 'root' in received).toBe(false)
      expect(domHostMocks.create).toHaveBeenCalledTimes(hasDom ? 1 : 0)

      handle.destroy()
      expect(document.body).toBeEmptyDOMElement()
    },
  )

})
