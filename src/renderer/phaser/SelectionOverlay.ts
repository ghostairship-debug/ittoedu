import * as Phaser from 'phaser'
import type { AdapterBounds } from './adapters/NodeAdapter'

export const RESIZE_DIRECTIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number]

interface Point { x: number; y: number }

function rotate(point: Point, center: Point, angle: number): Point {
  const radians = Phaser.Math.DegToRad(angle)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const x = point.x - center.x
  const y = point.y - center.y
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  }
}

export class SelectionOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics
  readonly handles: Record<ResizeDirection, Phaser.GameObjects.Rectangle>
  readonly rotationHandle: Phaser.GameObjects.Ellipse

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(1_000_000).setVisible(false)
    this.handles = Object.fromEntries(
      RESIZE_DIRECTIONS.map((direction) => {
        const cursor = direction === 'n' || direction === 's'
          ? 'ns-resize'
          : direction === 'e' || direction === 'w'
            ? 'ew-resize'
            : direction === 'nw' || direction === 'se'
              ? 'nwse-resize'
              : 'nesw-resize'
        const handle = scene.add
          .rectangle(0, 0, 11, 11, 0x5b9cff)
          .setStrokeStyle(2, 0xffffff)
          .setDepth(1_000_001)
          .setVisible(false)
          .setInteractive({ cursor })
          .setData('resizeDirection', direction)
        scene.input.setDraggable(handle)
        return [direction, handle]
      }),
    ) as Record<ResizeDirection, Phaser.GameObjects.Rectangle>
    this.rotationHandle = scene.add
      .ellipse(0, 0, 13, 13, 0x151820)
      .setStrokeStyle(3, 0x5b9cff)
      .setDepth(1_000_001)
      .setVisible(false)
      .setInteractive({ cursor: 'grab' })
    scene.input.setDraggable(this.rotationHandle)
  }

  show(
    bounds: AdapterBounds,
    locked = false,
    lineHandles?: { start: Point; end: Point; elbow?: Point } | null,
  ): void {
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const corners = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ].map((point) => rotate(point, center, bounds.rotation))
    this.graphics.setVisible(true).clear()
    this.graphics.lineStyle(2, locked ? 0xf59e0b : 0x5b9cff, 1)
    this.graphics.beginPath()
    this.graphics.moveTo(corners[0].x, corners[0].y)
    corners.slice(1).forEach((point) => this.graphics.lineTo(point.x, point.y))
    this.graphics.closePath()
    this.graphics.strokePath()

    const positions: Record<ResizeDirection, Point> = {
      nw: corners[0],
      n: { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 },
      ne: corners[1],
      e: { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 },
      se: corners[2],
      s: { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 },
      sw: corners[3],
      w: { x: (corners[3].x + corners[0].x) / 2, y: (corners[3].y + corners[0].y) / 2 },
    }
    for (const direction of RESIZE_DIRECTIONS) {
      this.handles[direction]
        .setVisible(!locked)
        .setPosition(positions[direction].x, positions[direction].y)
    }
    const rotationPoint = rotate({ x: center.x, y: bounds.y - 34 }, center, bounds.rotation)
    this.graphics.lineBetween(positions.n.x, positions.n.y, rotationPoint.x, rotationPoint.y)
    this.rotationHandle
      .setVisible(!locked)
      .setPosition(rotationPoint.x, rotationPoint.y)

    if (lineHandles && !locked) {
      // Pure visual endpoint markers: proximity hit and drag live in the DOM
      // authoring controller, which shares lineHandleWorldPoints geometry.
      const markers = lineHandles.elbow
        ? [lineHandles.start, lineHandles.end, lineHandles.elbow]
        : [lineHandles.start, lineHandles.end]
      for (const marker of markers) {
        this.graphics.fillStyle(0xffffff, 1)
        this.graphics.fillCircle(marker.x, marker.y, 5.5)
        this.graphics.lineStyle(2, 0x5b9cff, 1)
        this.graphics.strokeCircle(marker.x, marker.y, 5.5)
      }
    }
  }

  hide(): void {
    this.graphics.setVisible(false)
    Object.values(this.handles).forEach((handle) => handle.setVisible(false))
    this.rotationHandle.setVisible(false)
  }

  destroy(): void {
    this.graphics.destroy()
    Object.values(this.handles).forEach((handle) => handle.destroy())
    this.rotationHandle.destroy()
  }
}
