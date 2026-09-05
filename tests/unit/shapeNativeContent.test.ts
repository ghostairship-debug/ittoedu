import { describe, expect, it } from 'vitest'
import {
  nativeLineGeometrySchema,
  shapeNativeContentSchema,
  shapeNodeSchema,
  type NativeShapeContent,
  type ShapeNode,
} from '../../src/shared/contracts/native-v1'

describe('shapeNativeContent contract validation', () => {
  const baseStyle = {
    fillColor: '#ffffff',
    fillOpacity: 0,
    borderColor: '#2563eb',
    borderOpacity: 1,
    borderWidth: 2,
    lineStyle: 'solid' as const,
    cornerRadius: 0,
    startArrow: 'none' as const,
    endArrow: 'none' as const,
  }

  describe('valid shapes without lineGeometry', () => {
    it('accepts standard shapes without lineGeometry', () => {
      const rectContent: NativeShapeContent = {
        shapeType: 'rectangle',
        style: { ...baseStyle, fillOpacity: 1 },
      }
      expect(shapeNativeContentSchema.safeParse(rectContent).success).toBe(true)

      const lineContent: NativeShapeContent = {
        shapeType: 'line',
        style: baseStyle,
      }
      expect(shapeNativeContentSchema.safeParse(lineContent).success).toBe(true)

      const elbowContent: NativeShapeContent = {
        shapeType: 'elbow-arrow',
        style: { ...baseStyle, endArrow: 'triangle' },
      }
      expect(shapeNativeContentSchema.safeParse(elbowContent).success).toBe(true)
    })
  })

  describe('valid shapes with lineGeometry', () => {
    it('accepts line shape with straight lineGeometry', () => {
      const content: NativeShapeContent = {
        shapeType: 'line',
        lineGeometry: {
          kind: 'straight',
          start: [0, 0.5],
          end: [1, 0.5],
        },
        style: baseStyle,
      }
      const parsed = shapeNativeContentSchema.safeParse(content)
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.lineGeometry).toEqual({
          kind: 'straight',
          start: [0, 0.5],
          end: [1, 0.5],
        })
      }
    })

    it('accepts elbow-arrow shape with horizontal elbow lineGeometry', () => {
      const content: NativeShapeContent = {
        shapeType: 'elbow-arrow',
        lineGeometry: {
          kind: 'elbow',
          start: [0, 0.2],
          end: [1, 0.8],
          axis: 'horizontal',
          position: 0.55,
        },
        style: { ...baseStyle, endArrow: 'triangle' },
      }
      const parsed = shapeNativeContentSchema.safeParse(content)
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.lineGeometry).toEqual({
          kind: 'elbow',
          start: [0, 0.2],
          end: [1, 0.8],
          axis: 'horizontal',
          position: 0.55,
        })
      }
    })

    it('accepts elbow-arrow shape with vertical elbow lineGeometry', () => {
      const content: NativeShapeContent = {
        shapeType: 'elbow-arrow',
        lineGeometry: {
          kind: 'elbow',
          start: [0.2, 0.1],
          end: [0.8, 0.9],
          axis: 'vertical',
          position: 0.4,
        },
        style: { ...baseStyle, endArrow: 'triangle' },
      }
      const parsed = shapeNativeContentSchema.safeParse(content)
      expect(parsed.success).toBe(true)
    })
  })

  describe('invalid shapes with lineGeometry', () => {
    it('rejects non-linear shape (rectangle) carrying lineGeometry', () => {
      const content = {
        shapeType: 'rectangle',
        lineGeometry: {
          kind: 'straight',
          start: [0, 0],
          end: [1, 1],
        },
        style: baseStyle,
      }
      const result = shapeNativeContentSchema.safeParse(content)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('lineGeometry') && i.message.includes('不支持'))).toBe(true)
      }
    })

    it('rejects ellipse carrying lineGeometry', () => {
      const content = {
        shapeType: 'ellipse',
        lineGeometry: {
          kind: 'straight',
          start: [0, 0],
          end: [1, 1],
        },
        style: baseStyle,
      }
      expect(shapeNativeContentSchema.safeParse(content).success).toBe(false)
    })

    it('rejects line shape paired with elbow lineGeometry', () => {
      const content = {
        shapeType: 'line',
        lineGeometry: {
          kind: 'elbow',
          start: [0, 0.2],
          end: [1, 0.8],
          axis: 'horizontal',
          position: 0.5,
        },
        style: baseStyle,
      }
      const result = shapeNativeContentSchema.safeParse(content)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('只支持 straight'))).toBe(true)
      }
    })

    it('rejects elbow-arrow shape paired with straight lineGeometry', () => {
      const content = {
        shapeType: 'elbow-arrow',
        lineGeometry: {
          kind: 'straight',
          start: [0, 0.5],
          end: [1, 0.5],
        },
        style: baseStyle,
      }
      const result = shapeNativeContentSchema.safeParse(content)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('只支持 elbow'))).toBe(true)
      }
    })
  })

  describe('strict validation of lineGeometry values', () => {
    it('rejects start point outside [0, 1]', () => {
      const negativeStart = {
        kind: 'straight',
        start: [-0.1, 0.5],
        end: [1, 0.5],
      }
      expect(nativeLineGeometrySchema.safeParse(negativeStart).success).toBe(false)

      const excessiveStart = {
        kind: 'straight',
        start: [1.1, 0.5],
        end: [0, 0.5],
      }
      expect(nativeLineGeometrySchema.safeParse(excessiveStart).success).toBe(false)
    })

    it('rejects end point outside [0, 1]', () => {
      const negativeEnd = {
        kind: 'straight',
        start: [0, 0.5],
        end: [1, -0.01],
      }
      expect(nativeLineGeometrySchema.safeParse(negativeEnd).success).toBe(false)
    })

    it('rejects identical start and end points', () => {
      const identicalPoints = {
        kind: 'straight',
        start: [0.5, 0.5],
        end: [0.5, 0.5],
      }
      const result = nativeLineGeometrySchema.safeParse(identicalPoints)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('起点和终点不能相同'))).toBe(true)
      }
    })

    it('rejects elbow position outside [0, 1]', () => {
      const badPosition = {
        kind: 'elbow',
        start: [0, 0.2],
        end: [1, 0.8],
        axis: 'horizontal',
        position: 1.5,
      }
      expect(nativeLineGeometrySchema.safeParse(badPosition).success).toBe(false)

      const negativePosition = {
        kind: 'elbow',
        start: [0, 0.2],
        end: [1, 0.8],
        axis: 'horizontal',
        position: -0.1,
      }
      expect(nativeLineGeometrySchema.safeParse(negativePosition).success).toBe(false)
    })

    it('rejects invalid elbow axis', () => {
      const badAxis = {
        kind: 'elbow',
        start: [0, 0.2],
        end: [1, 0.8],
        axis: 'diagonal',
        position: 0.5,
      }
      expect(nativeLineGeometrySchema.safeParse(badAxis).success).toBe(false)
    })

    it('rejects unknown properties on lineGeometry (strict)', () => {
      const extraProp = {
        kind: 'straight',
        start: [0, 0.5],
        end: [1, 0.5],
        curvature: 0.2,
      }
      expect(nativeLineGeometrySchema.safeParse(extraProp).success).toBe(false)
    })
  })

  describe('ShapeNode schema validation', () => {
    const baseNode: ShapeNode = {
      id: 'shape_1',
      name: '形状',
      type: 'shape',
      shapeType: 'line',
      x: 100,
      y: 100,
      width: 200,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      playbackInitialVisibility: 'inherit',
      style: baseStyle,
    }

    it('accepts valid line ShapeNode with straight lineGeometry', () => {
      const node: ShapeNode = {
        ...baseNode,
        shapeType: 'line',
        lineGeometry: {
          kind: 'straight',
          start: [0, 0.5],
          end: [1, 0.5],
        },
      }
      expect(shapeNodeSchema.safeParse(node).success).toBe(true)
    })

    it('accepts valid elbow ShapeNode with elbow lineGeometry', () => {
      const node: ShapeNode = {
        ...baseNode,
        shapeType: 'elbow-arrow',
        lineGeometry: {
          kind: 'elbow',
          start: [0, 0.2],
          end: [1, 0.8],
          axis: 'horizontal',
          position: 0.55,
        },
      }
      expect(shapeNodeSchema.safeParse(node).success).toBe(true)
    })

    it('rejects line ShapeNode with elbow lineGeometry', () => {
      const node = {
        ...baseNode,
        shapeType: 'line',
        lineGeometry: {
          kind: 'elbow',
          start: [0, 0.2],
          end: [1, 0.8],
          axis: 'horizontal',
          position: 0.55,
        },
      }
      expect(shapeNodeSchema.safeParse(node).success).toBe(false)
    })

    it('rejects rectangle ShapeNode with straight lineGeometry', () => {
      const node = {
        ...baseNode,
        shapeType: 'rectangle',
        lineGeometry: {
          kind: 'straight',
          start: [0, 0.5],
          end: [1, 0.5],
        },
      }
      expect(shapeNodeSchema.safeParse(node).success).toBe(false)
    })
  })
})
