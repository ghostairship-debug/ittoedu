import { describe, expect, it, vi } from 'vitest'
import {
  convertLineGeometryForShapeType,
  DEFAULT_ELBOW_LINE_GEOMETRY,
  DEFAULT_STRAIGHT_LINE_GEOMETRY,
  distanceToLinePoints,
  getDefaultLineGeometry,
  lineHitWidth,
  lineStrokeHit,
  normalizeElbowLineAuthoring,
  normalizeStraightLineAuthoring,
  resolveNativeLinePoints,
} from '../../src/shared/nativeLineGeometry'
import { renderShapeCanvas } from '../../src/shared/canvasShapeRenderer'
import type { ShapeNode } from '../../src/shared/contracts/native-v1/types'

describe('nativeLineGeometry', () => {
  describe('straight line point resolution', () => {
    it('resolves default straight line points (horizontal center)', () => {
      const points = resolveNativeLinePoints(DEFAULT_STRAIGHT_LINE_GEOMETRY, 200, 100)
      expect(points).toHaveLength(2)
      expect(points[0]).toEqual({ x: 0, y: 50 })
      expect(points[1]).toEqual({ x: 200, y: 50 })
    })

    it('resolves custom diagonal straight line', () => {
      const geometry = {
        kind: 'straight' as const,
        start: [0.1, 0.2] as [number, number],
        end: [0.9, 0.8] as [number, number],
      }
      const points = resolveNativeLinePoints(geometry, 1000, 500)
      expect(points).toHaveLength(2)
      expect(points[0]).toEqual({ x: 100, y: 100 })
      expect(points[1]).toEqual({ x: 900, y: 400 })
    })

    it('resolves inverted straight line (bottom-right to top-left)', () => {
      const geometry = {
        kind: 'straight' as const,
        start: [1, 1] as [number, number],
        end: [0, 0] as [number, number],
      }
      const points = resolveNativeLinePoints(geometry, 300, 200)
      expect(points[0]).toEqual({ x: 300, y: 200 })
      expect(points[1]).toEqual({ x: 0, y: 0 })
    })

    it('resolves vertical straight line', () => {
      const geometry = {
        kind: 'straight' as const,
        start: [0.5, 0] as [number, number],
        end: [0.5, 1] as [number, number],
      }
      const points = resolveNativeLinePoints(geometry, 100, 400)
      expect(points[0]).toEqual({ x: 50, y: 0 })
      expect(points[1]).toEqual({ x: 50, y: 400 })
    })

    it('handles degenerate dimensions gracefully (zero and non-finite)', () => {
      const geometry = {
        kind: 'straight' as const,
        start: [0, 0.5] as [number, number],
        end: [1, 0.5] as [number, number],
      }
      const zeroPoints = resolveNativeLinePoints(geometry, 0, 0)
      expect(zeroPoints).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }])

      const nanPoints = resolveNativeLinePoints(geometry, Number.NaN, Number.POSITIVE_INFINITY)
      expect(nanPoints).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }])
    })
  })

  describe('elbow line point resolution', () => {
    it('resolves default elbow points (horizontal axis, position 0.55)', () => {
      const points = resolveNativeLinePoints(DEFAULT_ELBOW_LINE_GEOMETRY, 1000, 500)
      expect(points).toHaveLength(4)
      expect(points[0]).toEqual({ x: 0, y: 100 })
      expect(points[1]).toEqual({ x: 550, y: 100 })
      expect(points[2]).toEqual({ x: 550, y: 400 })
      expect(points[3]).toEqual({ x: 1000, y: 400 })
    })

    it('resolves elbow with horizontal axis and position 0.3', () => {
      const geometry = {
        kind: 'elbow' as const,
        start: [0.1, 0.2] as [number, number],
        end: [0.9, 0.8] as [number, number],
        axis: 'horizontal' as const,
        position: 0.3,
      }
      const points = resolveNativeLinePoints(geometry, 500, 200)
      expect(points).toHaveLength(4)
      expect(points[0]).toEqual({ x: 50, y: 40 })
      expect(points[1]).toEqual({ x: 150, y: 40 })
      expect(points[2]).toEqual({ x: 150, y: 160 })
      expect(points[3]).toEqual({ x: 450, y: 160 })
    })

    it('resolves elbow with vertical axis and position 0.4', () => {
      const geometry = {
        kind: 'elbow' as const,
        start: [0.2, 0.1] as [number, number],
        end: [0.8, 0.9] as [number, number],
        axis: 'vertical' as const,
        position: 0.4,
      }
      const points = resolveNativeLinePoints(geometry, 500, 1000)
      expect(points).toHaveLength(4)
      expect(points[0]).toEqual({ x: 100, y: 100 })
      expect(points[1]).toEqual({ x: 100, y: 400 })
      expect(points[2]).toEqual({ x: 400, y: 400 })
      expect(points[3]).toEqual({ x: 400, y: 900 })
    })

    it('handles elbow position at boundary 0 and 1', () => {
      const geomAtZero = {
        kind: 'elbow' as const,
        start: [0.2, 0.2] as [number, number],
        end: [0.8, 0.8] as [number, number],
        axis: 'horizontal' as const,
        position: 0,
      }
      const pointsZero = resolveNativeLinePoints(geomAtZero, 100, 100)
      expect(pointsZero[1]).toEqual({ x: 0, y: 20 })
      expect(pointsZero[2]).toEqual({ x: 0, y: 80 })

      const geomAtOne = {
        kind: 'elbow' as const,
        start: [0.2, 0.2] as [number, number],
        end: [0.8, 0.8] as [number, number],
        axis: 'vertical' as const,
        position: 1,
      }
      const pointsOne = resolveNativeLinePoints(geomAtOne, 100, 100)
      expect(pointsOne[1]).toEqual({ x: 20, y: 100 })
      expect(pointsOne[2]).toEqual({ x: 80, y: 100 })
    })

    it('handles degenerate elbow dimensions (zero and non-finite)', () => {
      const points = resolveNativeLinePoints(DEFAULT_ELBOW_LINE_GEOMETRY, 0, 0)
      expect(points).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ])
    })
  })

  describe('fallback resolution when geometry is null or undefined', () => {
    it('falls back to default straight line for line shape', () => {
      const points = resolveNativeLinePoints(undefined, 400, 200, 'line')
      expect(points).toHaveLength(2)
      expect(points[0]).toEqual({ x: 0, y: 100 })
      expect(points[1]).toEqual({ x: 400, y: 100 })
    })

    it('falls back to default elbow line for elbow-arrow shape', () => {
      const points = resolveNativeLinePoints(null, 1000, 500, 'elbow-arrow')
      expect(points).toHaveLength(4)
      expect(points[0]).toEqual({ x: 0, y: 100 })
      expect(points[1]).toEqual({ x: 550, y: 100 })
      expect(points[2]).toEqual({ x: 550, y: 400 })
      expect(points[3]).toEqual({ x: 1000, y: 400 })
    })

    it('getDefaultLineGeometry returns distinct geometry objects', () => {
      expect(getDefaultLineGeometry('line')).toEqual(DEFAULT_STRAIGHT_LINE_GEOMETRY)
      expect(getDefaultLineGeometry('elbow-arrow')).toEqual(DEFAULT_ELBOW_LINE_GEOMETRY)
    })
  })

  describe('lineHitWidth', () => {
    it('returns Math.max(12 / viewportScale, borderWidth)', () => {
      // Scale 1: 12 / 1 = 12. Border width 2 -> 12
      expect(lineHitWidth(2, 1)).toBe(12)
      // Border width 16 -> 16
      expect(lineHitWidth(16, 1)).toBe(16)
      // Scale 2: 12 / 2 = 6. Border width 2 -> 6
      expect(lineHitWidth(2, 2)).toBe(6)
      // Scale 0.5: 12 / 0.5 = 24. Border width 4 -> 24
      expect(lineHitWidth(4, 0.5)).toBe(24)
      // Border width 30 at scale 0.5 -> 30
      expect(lineHitWidth(30, 0.5)).toBe(30)
    })

    it('handles zero or non-positive borderWidth and scale gracefully', () => {
      expect(lineHitWidth(0, 1)).toBe(12)
      expect(lineHitWidth(-5, 1)).toBe(12)
      expect(lineHitWidth(2, 0)).toBe(12)
      expect(lineHitWidth(2, -1)).toBe(12)
      expect(lineHitWidth(2, Number.NaN)).toBe(12)
    })
  })

  describe('renderShapeCanvas integration', () => {
    function createMockContext(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        rect: vi.fn(),
        roundRect: vi.fn(),
        ellipse: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        setLineDash: vi.fn(),
        lineWidth: 1,
        strokeStyle: '',
        fillStyle: '',
        lineJoin: 'round',
        lineCap: 'butt',
        globalAlpha: 1,
      } as unknown as CanvasRenderingContext2D
    }

    it('renders straight line shape using custom lineGeometry', () => {
      const context = createMockContext()
      const node: ShapeNode = {
        id: 'line_1',
        name: '直线',
        type: 'shape',
        shapeType: 'line',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        playbackInitialVisibility: 'inherit',
        lineGeometry: {
          kind: 'straight',
          start: [0.1, 0.2],
          end: [0.9, 0.8],
        },
        style: {
          fillColor: '#000000',
          fillOpacity: 0,
          borderColor: '#2563eb',
          borderOpacity: 1,
          borderWidth: 2,
          lineStyle: 'solid',
          cornerRadius: 0,
          startArrow: 'none',
          endArrow: 'none',
        },
      }

      renderShapeCanvas(context, node)
      expect(context.moveTo).toHaveBeenCalledWith(20, 20)
      expect(context.lineTo).toHaveBeenCalledWith(180, 80)
      expect(context.stroke).toHaveBeenCalled()
    })

    it('renders elbow-arrow shape using custom lineGeometry', () => {
      const context = createMockContext()
      const node: ShapeNode = {
        id: 'elbow_1',
        name: '折线',
        type: 'shape',
        shapeType: 'elbow-arrow',
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        playbackInitialVisibility: 'inherit',
        lineGeometry: {
          kind: 'elbow',
          start: [0, 0.2],
          end: [1, 0.8],
          axis: 'horizontal',
          position: 0.55,
        },
        style: {
          fillColor: '#000000',
          fillOpacity: 0,
          borderColor: '#2563eb',
          borderOpacity: 1,
          borderWidth: 2,
          lineStyle: 'solid',
          cornerRadius: 0,
          startArrow: 'none',
          endArrow: 'none',
        },
      }

      renderShapeCanvas(context, node)
      expect(context.moveTo).toHaveBeenCalledWith(0, 100)
      expect(context.lineTo).toHaveBeenCalledWith(550, 100)
      expect(context.lineTo).toHaveBeenCalledWith(550, 400)
      expect(context.lineTo).toHaveBeenCalledWith(1000, 400)
      expect(context.stroke).toHaveBeenCalled()
    })

    it('renders straight line without lineGeometry using default geometry', () => {
      const context = createMockContext()
      const node: ShapeNode = {
        id: 'line_default',
        name: '默认直线',
        type: 'shape',
        shapeType: 'line',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        playbackInitialVisibility: 'inherit',
        style: {
          fillColor: '#000000',
          fillOpacity: 0,
          borderColor: '#2563eb',
          borderOpacity: 1,
          borderWidth: 2,
          lineStyle: 'solid',
          cornerRadius: 0,
          startArrow: 'none',
          endArrow: 'none',
        },
      }

      renderShapeCanvas(context, node)
      expect(context.moveTo).toHaveBeenCalledWith(0, 50)
      expect(context.lineTo).toHaveBeenCalledWith(200, 50)
    })
  })

  describe('normalizeStraightLineAuthoring', () => {
    it('wraps two points into an axis-aligned frame and 0-1 geometry', () => {
      const result = normalizeStraightLineAuthoring({ x: 20, y: 130 }, { x: 220, y: 30 })
      expect(result).toEqual({
        frame: { x: 20, y: 30, width: 200, height: 100 },
        lineGeometry: { kind: 'straight', start: [0, 1], end: [1, 0] },
      })
    })

    it('clamps a sub-16px segment to the 16x16 minimum frame without degenerating', () => {
      const result = normalizeStraightLineAuthoring({ x: 100, y: 100 }, { x: 105, y: 100 })
      expect(result).toEqual({
        frame: { x: 94.5, y: 92, width: 16, height: 16 },
        lineGeometry: { kind: 'straight', start: [0.34375, 0.5], end: [0.65625, 0.5] },
      })
    })

    it('returns null for a degenerate (identical start/end) segment', () => {
      expect(normalizeStraightLineAuthoring({ x: 50, y: 50 }, { x: 50, y: 50 })).toBeNull()
    })

    it('returns null when any coordinate is non-finite', () => {
      expect(normalizeStraightLineAuthoring(
        { x: Number.NaN, y: 0 },
        { x: 1, y: 1 },
      )).toBeNull()
      expect(normalizeStraightLineAuthoring(
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 1 },
      )).toBeNull()
    })

    it('honors a custom minimumSize', () => {
      const result = normalizeStraightLineAuthoring({ x: 0, y: 0 }, { x: 4, y: 0 }, 8)
      expect(result?.frame).toEqual({ x: -2, y: -4, width: 8, height: 8 })
    })
  })

  describe('normalizeElbowLineAuthoring', () => {
    it('builds a horizontal-axis elbow frame and geometry from start/end/coordinate', () => {
      const result = normalizeElbowLineAuthoring(
        { x: 10, y: 20 },
        { x: 210, y: 120 },
        'horizontal',
        110,
      )
      expect(result).toEqual({
        frame: { x: 10, y: 20, width: 200, height: 100 },
        lineGeometry: { kind: 'elbow', start: [0, 0], end: [1, 1], axis: 'horizontal', position: 0.5 },
      })
    })

    it('builds a vertical-axis elbow frame and geometry from start/end/coordinate', () => {
      const result = normalizeElbowLineAuthoring(
        { x: 50, y: 10 },
        { x: 150, y: 210 },
        'vertical',
        110,
      )
      expect(result).toEqual({
        frame: { x: 50, y: 10, width: 100, height: 200 },
        lineGeometry: { kind: 'elbow', start: [0, 0], end: [1, 1], axis: 'vertical', position: 0.5 },
      })
    })

    it('clamps a degenerately thin elbow to the 16x16 minimum frame without degenerating', () => {
      const result = normalizeElbowLineAuthoring(
        { x: 100, y: 100 },
        { x: 104, y: 100 },
        'vertical',
        100,
      )
      expect(result).toEqual({
        frame: { x: 94, y: 92, width: 16, height: 16 },
        lineGeometry: { kind: 'elbow', start: [0.375, 0.5], end: [0.625, 0.5], axis: 'vertical', position: 0.5 },
      })
    })

    it('returns null when start, end and elbow coordinate collapse to one point', () => {
      expect(normalizeElbowLineAuthoring(
        { x: 30, y: 30 },
        { x: 30, y: 30 },
        'horizontal',
        30,
      )).toBeNull()
    })

    it('returns null when any coordinate (including the elbow coordinate) is non-finite', () => {
      expect(normalizeElbowLineAuthoring(
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
        'horizontal',
        5,
      )).toBeNull()
      expect(normalizeElbowLineAuthoring(
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        'horizontal',
        Number.NaN,
      )).toBeNull()
    })

    it('honors a custom minimumSize', () => {
      const result = normalizeElbowLineAuthoring(
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        'horizontal',
        1,
        8,
      )
      expect(result?.frame).toEqual({ x: -3, y: -4, width: 8, height: 8 })
    })
  })

  describe('distanceToLinePoints', () => {
    it('returns 0 for a point exactly on a segment', () => {
      expect(distanceToLinePoints(
        { x: 50, y: 0 },
        [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      )).toBe(0)
    })

    it('returns the perpendicular distance for a point beside a segment', () => {
      expect(distanceToLinePoints(
        { x: 50, y: 30 },
        [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      )).toBe(30)
    })

    it('clamps to the nearest endpoint beyond either end of a segment', () => {
      expect(distanceToLinePoints(
        { x: 150, y: 0 },
        [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      )).toBe(50)
      expect(distanceToLinePoints(
        { x: -30, y: 40 },
        [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      )).toBe(50)
    })

    it('takes the shortest distance across a multi-segment polyline', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 50 },
      ]
      expect(distanceToLinePoints({ x: 50, y: 25 }, points)).toBe(0)
      // Nearest to the elbow corner (50,50), not the first segment's (0,0).
      expect(distanceToLinePoints({ x: 0, y: 100 }, points)).toBe(Math.hypot(50, 50))
    })

    it('treats a zero-length segment as a point without producing NaN', () => {
      const points = [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 50, y: 10 }]
      expect(distanceToLinePoints({ x: 10, y: 20 }, points)).toBe(10)
    })
  })

  describe('lineStrokeHit', () => {
    const horizontal = [{ x: 0, y: 0 }, { x: 100, y: 0 }]

    it('returns false when fewer than two points are given', () => {
      expect(lineStrokeHit({ x: 0, y: 0 }, [{ x: 0, y: 0 }], 2, 1)).toBe(false)
      expect(lineStrokeHit({ x: 0, y: 0 }, [], 2, 1)).toBe(false)
    })

    it('hits within max(12/viewportScale, borderWidth) / 2 of the stroke', () => {
      // lineHitWidth(2, 1) = 12, half-width = 6
      expect(lineStrokeHit({ x: 50, y: 5 }, horizontal, 2, 1)).toBe(true)
      expect(lineStrokeHit({ x: 50, y: 6 }, horizontal, 2, 1)).toBe(true)
      expect(lineStrokeHit({ x: 50, y: 6.01 }, horizontal, 2, 1)).toBe(false)
    })

    it('misses outside the hit width and never enlarges the visual stroke', () => {
      expect(lineStrokeHit({ x: 50, y: 10 }, horizontal, 2, 1)).toBe(false)
    })

    it('uses the real borderWidth once it exceeds the 12px floor', () => {
      // lineHitWidth(30, 1) = 30, half-width = 15
      expect(lineStrokeHit({ x: 50, y: 14 }, horizontal, 30, 1)).toBe(true)
      expect(lineStrokeHit({ x: 50, y: 16 }, horizontal, 30, 1)).toBe(false)
    })

    it('shrinks the hit width as viewportScale grows', () => {
      // lineHitWidth(2, 2) = 6, half-width = 3
      expect(lineStrokeHit({ x: 50, y: 3 }, horizontal, 2, 2)).toBe(true)
      expect(lineStrokeHit({ x: 50, y: 4 }, horizontal, 2, 2)).toBe(false)
    })
  })

  describe('convertLineGeometryForShapeType', () => {
    it('passes straight geometry through unchanged for shapeType line', () => {
      const geometry = { kind: 'straight' as const, start: [0.2, 0.3] as [number, number], end: [0.7, 0.8] as [number, number] }
      expect(convertLineGeometryForShapeType(geometry, 'line')).toEqual(geometry)
    })

    it('passes elbow geometry through unchanged for shapeType elbow-arrow', () => {
      const geometry = {
        kind: 'elbow' as const,
        start: [0.1, 0.2] as [number, number],
        end: [0.8, 0.9] as [number, number],
        axis: 'vertical' as const,
        position: 0.35,
      }
      expect(convertLineGeometryForShapeType(geometry, 'elbow-arrow')).toEqual(geometry)
    })

    it('keeps start/end and fills in default axis/position when switching straight to elbow', () => {
      const geometry = { kind: 'straight' as const, start: [0.2, 0.3] as [number, number], end: [0.7, 0.8] as [number, number] }
      expect(convertLineGeometryForShapeType(geometry, 'elbow-arrow')).toEqual({
        kind: 'elbow',
        start: [0.2, 0.3],
        end: [0.7, 0.8],
        // DEFAULT_ELBOW_LINE_GEOMETRY's axis/position (asserted by name above).
        axis: 'horizontal',
        position: 0.55,
      })
    })

    it('keeps start/end and drops axis/position when switching elbow to straight', () => {
      const geometry = {
        kind: 'elbow' as const,
        start: [0.15, 0.25] as [number, number],
        end: [0.85, 0.75] as [number, number],
        axis: 'vertical' as const,
        position: 0.4,
      }
      expect(convertLineGeometryForShapeType(geometry, 'line')).toEqual({
        kind: 'straight',
        start: [0.15, 0.25],
        end: [0.85, 0.75],
      })
    })

    it('materializes the legacy default straight start/end when no geometry is stored yet', () => {
      expect(convertLineGeometryForShapeType(undefined, 'line')).toEqual({
        kind: 'straight',
        start: [...DEFAULT_STRAIGHT_LINE_GEOMETRY.start],
        end: [...DEFAULT_STRAIGHT_LINE_GEOMETRY.end],
      })
      // With no prior geometry, the default *straight* start/end seed the new
      // elbow geometry, while axis/position come from the elbow defaults.
      expect(convertLineGeometryForShapeType(undefined, 'elbow-arrow')).toEqual({
        kind: 'elbow',
        start: [...DEFAULT_STRAIGHT_LINE_GEOMETRY.start],
        end: [...DEFAULT_STRAIGHT_LINE_GEOMETRY.end],
        // DEFAULT_ELBOW_LINE_GEOMETRY's axis/position (asserted by name above).
        axis: 'horizontal',
        position: 0.55,
      })
    })

    it('returns undefined for any shapeType other than line/elbow-arrow', () => {
      const geometry = { kind: 'straight' as const, start: [0, 0.5] as [number, number], end: [1, 0.5] as [number, number] }
      expect(convertLineGeometryForShapeType(geometry, 'rectangle')).toBeUndefined()
      expect(convertLineGeometryForShapeType(undefined, 'ellipse')).toBeUndefined()
    })
  })
})
