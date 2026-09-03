import { describe, expect, it, vi } from 'vitest'
import type * as Phaser from 'phaser'
import { createShapeNode } from '../../src/renderer/project/nativeNodeFactories'

vi.mock('phaser', () => ({
  Geom: {
    Rectangle: class Rectangle {},
  },
}))

import { BaseNodeAdapter } from '../../src/renderer/phaser/adapters/NodeAdapter'

interface FakeGameObject {
  x: number
  y: number
  width: number
  height: number
  alpha: number
  angle: number
  scaleX: number
  scaleY: number
  visible: boolean
  active: boolean
  input?: {
    enabled: boolean
    cursor: string
    hitArea?: unknown
  }
  setPosition(x: number, y: number): FakeGameObject
  setAlpha(alpha: number): FakeGameObject
  setScale(scaleX: number, scaleY?: number): FakeGameObject
  setVisible(visible: boolean): FakeGameObject
  setAngle(angle: number): FakeGameObject
  setOrigin(origin: number): FakeGameObject
  setInteractive(config?: unknown): FakeGameObject
  setSize(width: number, height: number): FakeGameObject
  setDepth(depth: number): FakeGameObject
  add(child: unknown): FakeGameObject
  destroy(fromScene?: boolean): void
}

function gameObject(x: number, y: number): FakeGameObject {
  const object = {
    x,
    y,
    width: 0,
    height: 0,
    alpha: 1,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    visible: true,
    active: true,
    input: { enabled: true, cursor: 'move' },
  } as FakeGameObject

  object.setPosition = vi.fn((nextX: number, nextY: number) => {
    object.x = nextX
    object.y = nextY
    return object
  })
  object.setAlpha = vi.fn((alpha: number) => {
    object.alpha = alpha
    return object
  })
  object.setScale = vi.fn((scaleX: number, scaleY = scaleX) => {
    object.scaleX = scaleX
    object.scaleY = scaleY
    return object
  })
  object.setVisible = vi.fn((visible: boolean) => {
    object.visible = visible
    return object
  })
  object.setAngle = vi.fn((angle: number) => {
    object.angle = angle
    return object
  })
  object.setOrigin = vi.fn(() => object)
  object.setInteractive = vi.fn(() => object)
  object.setSize = vi.fn((width: number, height: number) => {
    object.width = width
    object.height = height
    return object
  })
  object.setDepth = vi.fn(() => object)
  object.add = vi.fn(() => object)
  object.destroy = vi.fn()
  return object
}

class TestNodeAdapter extends BaseNodeAdapter {
  getRoot(): FakeGameObject {
    return this.root as unknown as FakeGameObject
  }

  protected redraw(): void {}
}

function setup() {
  const containers: FakeGameObject[] = []
  const interactionTarget = gameObject(0, 0)
  const killTweensOf = vi.fn()
  const isTweening = vi.fn(() => true)
  const addTween = vi.fn()
  const scene = {
    add: {
      container: vi.fn((x: number, y: number) => {
        const result = gameObject(x, y)
        containers.push(result)
        return result
      }),
      zone: vi.fn((x: number, y: number, width: number, height: number) => {
        interactionTarget.x = x
        interactionTarget.y = y
        interactionTarget.width = width
        interactionTarget.height = height
        return interactionTarget
      }),
    },
    tweens: {
      isTweening,
      killTweensOf,
      add: addTween,
    },
    time: {
      delayedCall: vi.fn(() => ({ remove: vi.fn() })),
    },
  } as unknown as Phaser.Scene
  const node = createShapeNode('rectangle', {
    id: 'shape-1',
    x: 100,
    y: 80,
    width: 200,
    height: 100,
    opacity: 0.75,
  })
  const adapter = new TestNodeAdapter(scene, node)
  return { adapter, root: adapter.getRoot(), killTweensOf, addTween }
}

function putInIntermediateEntranceFrame(root: FakeGameObject): void {
  root.setPosition(152, 130)
  root.setAlpha(0)
  root.setScale(0.82)
}

describe('BaseNodeAdapter motion action preview cancellation', () => {
  it('previews the authored action relative to the stable editor frame', () => {
    const { adapter, root, addTween } = setup()

    expect(adapter.previewMotion({
      type: 'node.enter',
      nodeId: 'shape-1',
      effect: 'slide',
      direction: 'left',
      durationMs: 420,
      easing: 'ease-out',
    }, 80)).toBe(true)
    expect(root).toMatchObject({ x: 152, y: 130, alpha: 0.75 })
    expect(addTween).toHaveBeenCalledWith(expect.objectContaining({
      targets: root,
      x: 200,
      y: 130,
      delay: 80,
      duration: 420,
      ease: 'Sine.easeOut',
      onComplete: expect.any(Function),
    }))

    expect(adapter.previewMotion({
      type: 'node.exit',
      nodeId: 'another-node',
      effect: 'fade',
      durationMs: 200,
      easing: 'ease-in',
    })).toBe(false)
  })

  it('lets move, resize, and rotation edits kill a running action preview and settle the stable frame', () => {
    const moved = setup()
    putInIntermediateEntranceFrame(moved.root)
    moved.killTweensOf.mockClear()
    moved.adapter.setPosition(300, 200)
    expect(moved.killTweensOf).toHaveBeenCalledWith(moved.root)
    expect(moved.root).toMatchObject({
      x: 400,
      y: 250,
      alpha: 0.75,
      scaleX: 1,
      scaleY: 1,
    })

    const resized = setup()
    putInIntermediateEntranceFrame(resized.root)
    resized.killTweensOf.mockClear()
    expect(resized.adapter.previewResize(260, 140)).toEqual({
      x: 100,
      y: 80,
      width: 260,
      height: 140,
      rotation: 0,
    })
    expect(resized.killTweensOf).toHaveBeenCalledWith(resized.root)
    expect(resized.root).toMatchObject({
      x: 230,
      y: 150,
      alpha: 0.75,
      scaleX: 1,
      scaleY: 1,
    })

    const rotated = setup()
    putInIntermediateEntranceFrame(rotated.root)
    rotated.killTweensOf.mockClear()
    expect(rotated.adapter.previewRotation(30)).toEqual({
      x: 100,
      y: 80,
      width: 200,
      height: 100,
      rotation: 30,
    })
    expect(rotated.killTweensOf).toHaveBeenCalledWith(rotated.root)
    expect(rotated.root).toMatchObject({
      x: 200,
      y: 130,
      alpha: 0.75,
      scaleX: 1,
      scaleY: 1,
      angle: 30,
    })
  })
})
