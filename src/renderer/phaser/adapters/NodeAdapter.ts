import * as Phaser from 'phaser'
import type {
  MotionDirection,
  MotionEasing,
  NodeMotionAction,
} from '../../../shared/interactionTypes'
import type { EditorCanvasNode } from '../editorCanvasNode'

const MOTION_SLIDE_DISTANCE = 48
const MOTION_SCALE_MULTIPLIER = 0.84
const EXIT_PREVIEW_HOLD_MS = 180

function previewEase(easing: MotionEasing): string {
  switch (easing) {
    case 'linear': return 'Linear'
    case 'ease-in': return 'Sine.easeIn'
    case 'ease-out': return 'Sine.easeOut'
    case 'ease-in-out': return 'Sine.easeInOut'
  }
}

function previewSlideOffset(direction: MotionDirection | undefined): {
  x: number
  y: number
} {
  switch (direction) {
    case 'right': return { x: MOTION_SLIDE_DISTANCE, y: 0 }
    case 'up': return { x: 0, y: -MOTION_SLIDE_DISTANCE }
    case 'down': return { x: 0, y: MOTION_SLIDE_DISTANCE }
    case 'left':
    default: return { x: -MOTION_SLIDE_DISTANCE, y: 0 }
  }
}

export interface AdapterBounds {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export interface NodeAdapter<T extends EditorCanvasNode = EditorCanvasNode> {
  readonly nodeId: string
  readonly interactionTarget: Phaser.GameObjects.Zone
  getNode(): T
  update(node: T): void
  setPosition(x: number, y: number): void
  previewResize(width: number, height: number): AdapterBounds
  previewRotation(rotation: number): AdapterBounds
  getBounds(): AdapterBounds
  setDepth(depth: number): void
  setSelected(selected: boolean): void
  setEditMode(enabled: boolean): void
  previewMotion(action: NodeMotionAction, delayMs?: number): boolean
  destroy(): void
}

export abstract class BaseNodeAdapter<T extends EditorCanvasNode = EditorCanvasNode>
  implements NodeAdapter<T>
{
  readonly nodeId: string
  readonly interactionTarget: Phaser.GameObjects.Zone
  protected readonly root: Phaser.GameObjects.Container
  protected readonly content: Phaser.GameObjects.Container
  protected node: T
  protected width: number
  protected height: number
  private previewRestoreTimer?: Phaser.Time.TimerEvent

  constructor(
    protected readonly scene: Phaser.Scene,
    node: T,
  ) {
    this.node = node
    this.nodeId = node.id
    this.width = node.width
    this.height = node.height
    this.root = scene.add.container(node.x + node.width / 2, node.y + node.height / 2)
    this.root
      .setVisible(node.visible)
      .setAlpha(node.opacity)
      .setAngle(node.rotation)
    this.content = scene.add.container(-node.width / 2, -node.height / 2)
    this.root.add(this.content)
    this.interactionTarget = scene.add
      .zone(node.x + node.width / 2, node.y + node.height / 2, node.width, node.height)
      .setOrigin(0.5)
      .setAngle(node.rotation)
      .setVisible(node.visible)
      .setInteractive({ cursor: 'move' })
    if (this.interactionTarget.input) {
      this.interactionTarget.input.enabled = node.visible
      this.interactionTarget.input.cursor = node.locked ? 'default' : 'move'
    }
  }

  getNode(): T {
    return this.node
  }

  update(node: T): void {
    this.node = node
    this.width = node.width
    this.height = node.height
    this.setPosition(node.x, node.y)
    this.root.setVisible(node.visible)
    this.root.setAlpha(node.opacity).setAngle(node.rotation)
    this.interactionTarget.setVisible(node.visible)
    this.interactionTarget.setAngle(node.rotation)
    if (this.interactionTarget.input) {
      this.interactionTarget.input.enabled = node.visible
      this.interactionTarget.input.cursor = node.locked ? 'default' : 'move'
    }
    this.redraw()
  }

  setPosition(x: number, y: number): void {
    // Manual edits always win over the optional entrance preview. Otherwise a
    // still-running tween can later snap the node back to its old final frame.
    this.scene.tweens.killTweensOf(this.root)
    this.root
      .setPosition(x + this.width / 2, y + this.height / 2)
      .setAlpha(this.node.opacity)
      .setScale(1)
    this.interactionTarget.setPosition(x + this.width / 2, y + this.height / 2)
  }

  previewResize(width: number, height: number): AdapterBounds {
    this.settleMotionPreview()
    const before = this.getBounds()
    this.width = width
    this.height = height
    this.content.setPosition(-width / 2, -height / 2)
    this.setPosition(before.x, before.y)
    this.redraw()
    return this.getBounds()
  }

  previewRotation(rotation: number): AdapterBounds {
    this.settleMotionPreview()
    this.node = { ...this.node, rotation }
    this.root.setAngle(rotation)
    this.interactionTarget.setAngle(rotation)
    return this.getBounds()
  }

  getBounds(): AdapterBounds {
    return {
      x: this.root.x - this.width / 2,
      y: this.root.y - this.height / 2,
      width: this.width,
      height: this.height,
      rotation: this.node.rotation,
    }
  }

  setDepth(depth: number): void {
    this.root.setDepth(depth)
    this.interactionTarget.setDepth(depth)
  }

  setSelected(_selected: boolean): void {}

  setEditMode(_enabled: boolean): void {}

  previewMotion(action: NodeMotionAction, delayMs = 0): boolean {
    this.settleMotionPreview()
    if (action.nodeId !== this.node.id || !this.node.visible || !this.root.active) {
      return false
    }

    const stable = {
      x: this.node.x + this.width / 2,
      y: this.node.y + this.height / 2,
      alpha: this.node.opacity,
      scaleX: 1,
      scaleY: 1,
    }
    const hidden = { ...stable }
    switch (action.effect) {
      case 'fade':
        hidden.alpha = 0
        break
      case 'slide': {
        const offset = previewSlideOffset(action.direction)
        hidden.x += offset.x
        hidden.y += offset.y
        break
      }
      case 'scale':
        hidden.scaleX = MOTION_SCALE_MULTIPLIER
        hidden.scaleY = MOTION_SCALE_MULTIPLIER
        break
      case 'none':
        break
    }

    const entering = action.type === 'node.enter'
    const start = entering ? hidden : stable
    const end = entering ? stable : hidden
    this.root
      .setVisible(true)
      .setPosition(start.x, start.y)
      .setAlpha(start.alpha)
      .setScale(start.scaleX, start.scaleY)

    const restore = (): void => {
      if (!this.root.active) return
      this.root
        .setVisible(this.node.visible)
        .setPosition(stable.x, stable.y)
        .setAlpha(stable.alpha)
        .setScale(stable.scaleX, stable.scaleY)
    }
    const finish = (): void => {
      if (entering) {
        restore()
        return
      }
      this.root.setVisible(false)
      this.previewRestoreTimer = this.scene.time.delayedCall(
        EXIT_PREVIEW_HOLD_MS,
        restore,
      )
    }
    const duration = action.effect === 'none'
      ? 0
      : Math.max(0, Math.min(10_000, action.durationMs))
    this.scene.tweens.add({
      targets: this.root,
      ...end,
      delay: Math.max(0, Math.min(60_000, delayMs)),
      duration,
      ease: previewEase(action.easing),
      onComplete: finish,
    })
    return true
  }

  destroy(): void {
    this.interactionTarget.destroy()
    this.root.destroy(true)
  }

  protected resizeInteractionTarget(): void {
    this.interactionTarget.setSize(this.width, this.height)
    this.content.setPosition(-this.width / 2, -this.height / 2)
    const hitArea = this.interactionTarget.input?.hitArea
    if (hitArea instanceof Phaser.Geom.Rectangle) {
      hitArea.setSize(this.width, this.height)
    }
  }

  private settleMotionPreview(): void {
    this.previewRestoreTimer?.remove(false)
    this.previewRestoreTimer = undefined
    this.scene.tweens.killTweensOf(this.root)
    this.root
      .setVisible(this.node.visible)
      .setPosition(
        this.node.x + this.width / 2,
        this.node.y + this.height / 2,
      )
      .setAlpha(this.node.opacity)
      .setScale(1)
  }

  protected abstract redraw(): void
}
