import type { ComponentDefinition, ComponentImplementation, ComponentInstance } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { convertLineGeometryForShapeType } from '../../shared/nativeLineGeometry'
import { defaultShapeData, shapeDataSchema, shapeLineSchema, shapePathSchema, shapeStyleSchema } from './data'
import type { ShapeData, ShapeLine, ShapePath, ShapeStyle } from './data'

export const SHAPE_IMPLEMENTATION_KEY = 'guoling.shape'
export const SHAPE_DEFINITION: ComponentDefinition = {
  id: 'guoling.shape', role: 'content', version: '1', title: '形状',
  implementation: { kind: 'builtin', key: SHAPE_IMPLEMENTATION_KEY },
}

export type ShapeInstance = ComponentInstance<ShapeData>

/** Commands enter the canonical DocumentSession writer; this module owns no history. */
export function editShapePath(instanceId: string, path: ShapePath): ComponentEdit {
  return { type: 'data.set', instanceId, path: ['pathGeometry'], value: shapePathSchema.parse(path) }
}

export function editShapeLine(instanceId: string, line: ShapeLine): ComponentEdit {
  return { type: 'data.set', instanceId, path: ['lineGeometry'], value: shapeLineSchema.parse(line) }
}

export function editShapeStyle(instanceId: string, style: ShapeStyle): ComponentEdit {
  return { type: 'data.set', instanceId, path: ['style'], value: shapeStyleSchema.parse(style) }
}

export function editShapeData(instanceId: string, data: ShapeData): ComponentEdit {
  return { type: 'data.set', instanceId, path: [], value: shapeDataSchema.parse(data) }
}

export function switchShapeType(instance: ShapeInstance, shapeType: ShapeData['shapeType']): ComponentEdit {
  // A new primitive replaces an explicit path/brace. Reuse the line conversion algorithm.
  const { pathGeometry: _path, braceGeometry: _brace, lineGeometry: _line, ...data } = instance.data
  const lineGeometry = convertLineGeometryForShapeType(instance.data.lineGeometry, shapeType)
  return editShapeData(instance.id, { ...data, shapeType, ...(lineGeometry ? { lineGeometry } : {}) })
}

export function customizeShapeImplementation(instanceId: string,
  implementation: Extract<ComponentImplementation, { kind: 'source' }>): ComponentEdit {
  return { type: 'implementation.set', instanceId, implementation: structuredClone(implementation) }
}

/** Restores the shared default renderer, preserving author data and the canonical frame. */
export function restoreShapeImplementation(instanceId: string): ComponentEdit {
  return { type: 'implementation.set', instanceId, implementation: null }
}

export { defaultShapeData }
