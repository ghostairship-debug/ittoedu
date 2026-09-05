import { describe, expect, it } from 'vitest'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import type { NativeLineGeometry } from '@/shared/contracts/native-v1/types'
import {
  collectLineSnapAxes,
  dragLineHandleGeometry,
  drawLineAuthoringGeometry,
  lineHandleWorldPoints,
  LINE_MIN_FRAME_SIZE,
  LINE_SNAP_SCREEN_PX,
  snapLinePoint,
  type LineSnapAxes,
} from '@/renderer/authoring/slideLineAuthoring'

/**
 * Proves the pure line-drawing helpers: canvas/layer snap candidates, the 8
 * screen-px snap threshold (and the Alt/`disabled` bypass), the direct-draw
 * commit geometry, world-space handle points, and rotation-aware handle
 * dragging. Pointer routing, hit-test priority against resize/rotate handles,
 * and command commit live in `workspaceSlideAuthoring.ts` /
 * `v9SlideContentCommands.ts` and are covered by their own tests
 * (`v9SlideViewportAdapter.test.ts`, `v9SlideContentCommands.test.ts`).
 */
describe('slideLineAuthoring', () => {
  it('re-exports the 16px minimum line frame size and 8px snap threshold', () => {
    expect(LINE_MIN_FRAME_SIZE).toBe(16)
    expect(LINE_SNAP_SCREEN_PX).toBe(8)
  })

  describe('collectLineSnapAxes', () => {
    it('always includes the canvas edges and center, even with no targets', () => {
      expect(collectLineSnapAxes([])).toEqual({
        xs: [0, CANVAS_WIDTH / 2, CANVAS_WIDTH],
        ys: [0, CANVAS_HEIGHT / 2, CANVAS_HEIGHT],
      })
    })

    it('adds the edges and center of visible, unlocked targets', () => {
      const axes = collectLineSnapAxes([
        {
          layerItemId: 'a',
          bounds: { x: 100, y: 200, width: 60, height: 40, rotation: 0 },
          hittable: true,
          locked: false,
        },
      ])
      expect(axes.xs).toEqual([0, CANVAS_WIDTH / 2, CANVAS_WIDTH, 100, 130, 160])
      expect(axes.ys).toEqual([0, CANVAS_HEIGHT / 2, CANVAS_HEIGHT, 200, 220, 240])
    })

    it('excludes targets that are not hittable (hidden)', () => {
      const axes = collectLineSnapAxes([
        {
          layerItemId: 'hidden',
          bounds: { x: 100, y: 200, width: 60, height: 40, rotation: 0 },
          hittable: false,
          locked: false,
        },
      ])
      expect(axes.xs).toEqual([0, CANVAS_WIDTH / 2, CANVAS_WIDTH])
      expect(axes.ys).toEqual([0, CANVAS_HEIGHT / 2, CANVAS_HEIGHT])
    })

    it('excludes locked targets', () => {
      const axes = collectLineSnapAxes([
        {
          layerItemId: 'locked',
          bounds: { x: 100, y: 200, width: 60, height: 40, rotation: 0 },
          hittable: true,
          locked: true,
        },
      ])
      expect(axes.xs).toEqual([0, CANVAS_WIDTH / 2, CANVAS_WIDTH])
    })

    it('excludes the layer item being dragged via excludeLayerItemId', () => {
      const targets = [
        {
          layerItemId: 'self',
          bounds: { x: 100, y: 200, width: 60, height: 40, rotation: 0 },
          hittable: true,
          locked: false,
        },
        {
          layerItemId: 'other',
          bounds: { x: 500, y: 500, width: 20, height: 20, rotation: 0 },
          hittable: true,
          locked: false,
        },
      ]
      const axes = collectLineSnapAxes(targets, 'self')
      expect(axes.xs).toEqual([0, CANVAS_WIDTH / 2, CANVAS_WIDTH, 500, 510, 520])
      expect(axes.ys).toEqual([0, CANVAS_HEIGHT / 2, CANVAS_HEIGHT, 500, 510, 520])
    })
  })

  describe('snapLinePoint', () => {
    const axes: LineSnapAxes = { xs: [0, 640, 1280], ys: [0, 360, 720] }

    it('snaps each axis independently to the nearest candidate within threshold', () => {
      const result = snapLinePoint({ x: 644, y: 245 }, axes, 1)
      expect(result.point).toEqual({ x: 640, y: 245 })
      expect(result.guideX).toBe(640)
      expect(result.guideY).toBeUndefined()
    })

    it('passes a coordinate through unchanged when it is outside threshold on both axes', () => {
      const result = snapLinePoint({ x: 300, y: 500 }, axes, 1)
      expect(result).toEqual({ point: { x: 300, y: 500 }, guideX: undefined, guideY: undefined })
    })

    it('treats the threshold boundary as inclusive (<=)', () => {
      // distance from 644 to 640 is exactly 4; threshold at scale 2 is 8/2=4.
      expect(snapLinePoint({ x: 644, y: 0 }, axes, 2).guideX).toBe(640)
      // one px further out must miss.
      expect(snapLinePoint({ x: 645, y: 0 }, axes, 2).guideX).toBeUndefined()
    })

    it('picks the nearest of several in-range candidates', () => {
      const closeAxes: LineSnapAxes = { xs: [0, 5], ys: [] }
      expect(snapLinePoint({ x: 3, y: 0 }, closeAxes, 1).guideX).toBe(5)
      expect(snapLinePoint({ x: 2, y: 0 }, closeAxes, 1).guideX).toBe(0)
    })

    it('scales the effective threshold by viewportScale', () => {
      // threshold = 8 / viewportScale
      expect(snapLinePoint({ x: 643, y: 0 }, axes, 2).guideX).toBe(640) // 3px <= 4px
      expect(snapLinePoint({ x: 648, y: 0 }, axes, 2).guideX).toBeUndefined() // 8px > 4px
      expect(snapLinePoint({ x: 648, y: 0 }, axes, 0.5).guideX).toBe(640) // 8px <= 16px
    })

    it('bypasses snapping entirely when disabled (Alt held)', () => {
      const result = snapLinePoint({ x: 644, y: 245 }, axes, 1, true)
      expect(result).toEqual({ point: { x: 644, y: 245 } })
      expect(result.guideX).toBeUndefined()
      expect(result.guideY).toBeUndefined()
    })

    it('falls back to scale 1 for a non-finite or non-positive viewportScale', () => {
      expect(snapLinePoint({ x: 644, y: 0 }, axes, 0).guideX).toBe(640)
      expect(snapLinePoint({ x: 644, y: 0 }, axes, -3).guideX).toBe(640)
      expect(snapLinePoint({ x: 644, y: 0 }, axes, Number.NaN).guideX).toBe(640)
    })
  })

  describe('drawLineAuthoringGeometry', () => {
    it('normalizes a fresh straight draw from two world points', () => {
      const result = drawLineAuthoringGeometry('line', { x: 20, y: 130 }, { x: 220, y: 30 })
      expect(result).toEqual({
        frame: { x: 20, y: 30, width: 200, height: 100 },
        lineGeometry: { kind: 'straight', start: [0, 1], end: [1, 0] },
      })
    })

    it('normalizes a fresh elbow draw at the horizontal midpoint of start/end', () => {
      const result = drawLineAuthoringGeometry('elbow-arrow', { x: 0, y: 0 }, { x: 200, y: 100 })
      expect(result).toEqual({
        frame: { x: 0, y: 0, width: 200, height: 100 },
        lineGeometry: { kind: 'elbow', start: [0, 0], end: [1, 1], axis: 'horizontal', position: 0.5 },
      })
    })

    it('returns null for a degenerate draw', () => {
      expect(drawLineAuthoringGeometry('line', { x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull()
    })
  })

  describe('lineHandleWorldPoints', () => {
    it('returns start/end for a straight line, translated by the frame origin', () => {
      const frame = { x: 100, y: 100, width: 200, height: 50 }
      const geometry: NativeLineGeometry = { kind: 'straight', start: [0, 0.5], end: [1, 0.5] }
      const points = lineHandleWorldPoints(frame, 0, geometry, 'line')
      expect(points).toEqual({ start: { x: 100, y: 125 }, end: { x: 300, y: 125 } })
    })

    it('includes an elbow handle point for elbow geometry', () => {
      const frame = { x: 0, y: 0, width: 200, height: 100 }
      const geometry: NativeLineGeometry = {
        kind: 'elbow', start: [0, 0.2], end: [1, 0.8], axis: 'horizontal', position: 0.5,
      }
      const points = lineHandleWorldPoints(frame, 0, geometry, 'elbow-arrow')
      expect(points).toEqual({
        start: { x: 0, y: 20 },
        elbow: { x: 100, y: 20 },
        end: { x: 200, y: 80 },
      })
    })

    it('falls back to the legacy default geometry without materializing it', () => {
      const frame = { x: 0, y: 0, width: 200, height: 100 }
      const points = lineHandleWorldPoints(frame, 0, undefined, 'line')
      expect(points).toEqual({ start: { x: 0, y: 50 }, end: { x: 200, y: 50 } })
    })

    it('rotates handle points about the frame center', () => {
      const frame = { x: 100, y: 100, width: 200, height: 50 }
      const geometry: NativeLineGeometry = { kind: 'straight', start: [0, 0.5], end: [1, 0.5] }
      // Center = (200,125). A 180deg turn swaps the two endpoints.
      const points = lineHandleWorldPoints(frame, 180, geometry, 'line')
      expect(points.start.x).toBeCloseTo(300, 9)
      expect(points.start.y).toBeCloseTo(125, 9)
      expect(points.end.x).toBeCloseTo(100, 9)
      expect(points.end.y).toBeCloseTo(125, 9)
    })
  })

  describe('dragLineHandleGeometry', () => {
    it('drags the start handle of a straight line (rotation 0)', () => {
      const result = dragLineHandleGeometry({
        shapeType: 'line',
        frame: { x: 300, y: 300, width: 200, height: 100 },
        rotation: 0,
        lineGeometry: undefined,
        handle: 'start',
        world: { x: 250, y: 350 },
      })
      expect(result).toEqual({
        frame: { x: 250, y: 342, width: 250, height: 16 },
        lineGeometry: { kind: 'straight', start: [0, 0.5], end: [1, 0.5] },
      })
    })

    it('drags the end handle of a straight line (rotation 0)', () => {
      const result = dragLineHandleGeometry({
        shapeType: 'line',
        frame: { x: 100, y: 100, width: 200, height: 50 },
        rotation: 0,
        lineGeometry: undefined,
        handle: 'end',
        world: { x: 260, y: 260 },
      })
      expect(result).toEqual({
        frame: { x: 100, y: 125, width: 160, height: 135 },
        lineGeometry: { kind: 'straight', start: [0, 0], end: [1, 1] },
      })
    })

    it('drags the elbow handle, recomputing the middle segment along the stored axis', () => {
      const result = dragLineHandleGeometry({
        shapeType: 'elbow-arrow',
        frame: { x: 0, y: 0, width: 200, height: 100 },
        rotation: 0,
        lineGeometry: { kind: 'elbow', start: [0, 0.2], end: [1, 0.8], axis: 'horizontal', position: 0.5 },
        handle: 'elbow',
        world: { x: 150, y: 999 },
      })
      expect(result).toEqual({
        frame: { x: 0, y: 20, width: 200, height: 60 },
        lineGeometry: { kind: 'elbow', start: [0, 0], end: [1, 1], axis: 'horizontal', position: 0.75 },
      })
    })

    it('drags the vertical-axis elbow handle using the y coordinate instead of x', () => {
      const result = dragLineHandleGeometry({
        shapeType: 'elbow-arrow',
        frame: { x: 0, y: 0, width: 100, height: 200 },
        rotation: 0,
        lineGeometry: { kind: 'elbow', start: [0.2, 0], end: [0.8, 1], axis: 'vertical', position: 0.5 },
        handle: 'elbow',
        world: { x: 999, y: 150 },
      })
      expect(result?.lineGeometry).toMatchObject({ kind: 'elbow', axis: 'vertical' })
      // The dragged coordinate is y (150), not x (999): the elbow move must
      // ignore the ignored axis entirely.
      expect(result?.lineGeometry.kind).toBe('elbow')
    })

    it('rotates the drag target into local frame space and rotates the result back into world space', () => {
      const result = dragLineHandleGeometry({
        shapeType: 'line',
        frame: { x: 100, y: 100, width: 200, height: 100 },
        rotation: 90,
        lineGeometry: undefined,
        handle: 'end',
        world: { x: 300, y: 250 },
      })
      expect(result?.frame.x).toBeCloseTo(150, 9)
      expect(result?.frame.y).toBeCloseTo(100, 9)
      expect(result?.frame.width).toBeCloseTo(200, 9)
      expect(result?.frame.height).toBeCloseTo(100, 9)
      // A 90deg rotation carries an irreducible cos(90deg) float epsilon
      // (~1e-17) through the unit-point division, so compare component-wise
      // rather than with a single deep-equal on the geometry object.
      expect(result?.lineGeometry.kind).toBe('straight')
      expect(result?.lineGeometry.start[0]).toBeCloseTo(0, 9)
      expect(result?.lineGeometry.start[1]).toBeCloseTo(1, 9)
      expect(result?.lineGeometry.end[0]).toBeCloseTo(1, 9)
      expect(result?.lineGeometry.end[1]).toBeCloseTo(0, 9)
    })

    it('returns null when dragging a handle collapses the segment to a single point', () => {
      const result = dragLineHandleGeometry({
        shapeType: 'line',
        frame: { x: 0, y: 0, width: 100, height: 16 },
        rotation: 0,
        lineGeometry: undefined,
        handle: 'start',
        world: { x: 100, y: 8 },
      })
      expect(result).toBeNull()
    })

    it('rejects an elbow-handle drag against straight (non-elbow) geometry', () => {
      const result = dragLineHandleGeometry({
        shapeType: 'line',
        frame: { x: 0, y: 0, width: 200, height: 100 },
        rotation: 0,
        lineGeometry: { kind: 'straight', start: [0, 0.5], end: [1, 0.5] },
        handle: 'elbow',
        world: { x: 100, y: 100 },
      })
      expect(result).toBeNull()
    })
  })
})
