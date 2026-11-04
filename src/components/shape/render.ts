import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform/runtime'
import { renderShapeCanvas } from '../../shared/canvasShapeRenderer'
import { shapeDataSchema } from './data'
import type { ShapeData } from './data'
import { resolveNativeShapePath } from '../../shared/nativeShapePath'
import { resolveNativeLinePoints } from '../../shared/nativeLineGeometry'

/** Disposable paint envelope; authored frame and endpoints retain their own coordinates. */
export function shapePaintBounds(data: ShapeData, frame: Pick<ComponentFrame, 'width' | 'height'>) {
  const points = [{ x: 0, y: 0 }, { x: frame.width, y: frame.height }]
  const path = resolveNativeShapePath(data, frame.width, frame.height)
  for (const part of path?.paths ?? []) for (const command of part.commands) {
    if ('to' in command) points.push({ x: command.to[0] * frame.width, y: command.to[1] * frame.height })
    if ('control' in command) points.push({ x: command.control[0] * frame.width, y: command.control[1] * frame.height })
    if ('control1' in command) points.push({ x: command.control1[0] * frame.width, y: command.control1[1] * frame.height },
      { x: command.control2[0] * frame.width, y: command.control2[1] * frame.height })
  }
  let margin = data.style.borderWidth / 2 + 1
  if (data.shapeType === 'line' || data.shapeType === 'elbow-arrow') {
    points.push(...resolveNativeLinePoints(data.lineGeometry, frame.width, frame.height, data.shapeType))
    if (data.style.startArrow !== 'none' || data.style.endArrow !== 'none') margin = Math.max(margin, Math.max(12, data.style.borderWidth * 4))
  }
  const left = Math.floor(Math.min(...points.map(point => point.x)) - margin), top = Math.floor(Math.min(...points.map(point => point.y)) - margin)
  const right = Math.ceil(Math.max(...points.map(point => point.x)) + margin), bottom = Math.ceil(Math.max(...points.map(point => point.y)) + margin)
  return { left, top, width: right - left, height: bottom - top }
}

/** Draw in local coordinates. L01/the host owns placement and affine transforms. */
export function renderShape(context: CanvasRenderingContext2D, data: ShapeData,
  frame: Pick<ComponentFrame, 'width' | 'height'>,
  geometryTransform?: readonly [number, number, number, number]): void {
  // The old direct renderer reads only these drawing fields. No V9 node is
  // created, registered, stored, or returned; this projection is disposable.
  const drawing = { ...data, type: 'shape', width: frame.width, height: frame.height } as Parameters<typeof renderShapeCanvas>[1]
  renderShapeCanvas(context, drawing, frame.width, frame.height, geometryTransform)
}

// Placement nodes own authored transforms. Camera and viewport fitting live
// on separate ancestors and should still zoom the entire painted shape.
const placementSelector = '[data-component-instance],[data-component-object],[data-component-instance-id]'
function shapePlacement(root: HTMLElement) {
  const nodes: HTMLElement[] = []
  let matrix = new DOMMatrixReadOnly()
  for (let node = root.parentElement; node; node = node.parentElement) {
    if (!node.matches(placementSelector)) continue
    nodes.push(node)
    if (node.dataset.componentObject && node.dataset.componentPlacement !== 'free') continue
    // The placement matrix can follow a view transform (for example Flow's
    // observation transform). Only the final authored matrix belongs here;
    // the view transform should continue to scale the painted result normally.
    const transform = node.style.transform.match(/matrix\([^()]*\)\s*$/)?.[0]
    if (transform) {
      const { a, b, c, d } = new DOMMatrixReadOnly(transform)
      matrix = new DOMMatrixReadOnly([a, b, c, d, 0, 0]).multiply(matrix)
    }
  }
  return { nodes, matrix }
}

/** The common runtime resolves overrides; the default never evaluates private source. */
export const shapeRuntimeImplementation: ComponentRuntimeImplementation<ShapeData> = {
  mount({ instance, root, scope }) {
    if (!root) throw new Error('形状组件需要绘制容器')
    const canvas = document.createElement('canvas')
    canvas.dataset.componentShapeCanvas = ''
    canvas.style.position = 'absolute'
    canvas.style.display = 'block'
    const context = canvas.getContext('2d')
    if (!context) throw new Error('形状组件无法创建 Canvas 2D')
    let disposed = false, current = instance, shown = instance
    let paintedLinear: string | undefined
    let placementNodes: HTMLElement[] = []
    const placementObserver = new MutationObserver(() => paint(shown, true))
    const paint = (next: typeof instance, placementOnly = false) => {
      if (disposed || !scope.isActive()) return
      shown = next
      const { nodes, matrix } = shapePlacement(root)
      if (nodes.length !== placementNodes.length || nodes.some((node, index) => node !== placementNodes[index])) {
        placementObserver.disconnect()
        for (const node of nodes) placementObserver.observe(node, { attributes: true, attributeFilter: ['style', 'data-component-placement'] })
        placementNodes = nodes
      }
      const { a, b, c, d } = matrix
      const linear = [a, b, c, d].join(',')
      if (placementOnly && linear === paintedLinear) return
      paintedLinear = linear
      const data = shapeDataSchema.parse(next.data)
      if (!next.frame) throw new Error('形状组件缺少 frame')
      const local = shapePaintBounds(data, next.frame)
      const inverse = matrix.inverse()
      const deformed = Number.isFinite(inverse.a) && (Math.abs(a * a + b * b - 1) > 1e-6
        || Math.abs(c * c + d * d - 1) > 1e-6 || Math.abs(a * c + b * d) > 1e-6)
      let bounds = local
      let transform = ''
      if (deformed) {
        const corners = [local.left, local.left + local.width].flatMap(x =>
          [local.top, local.top + local.height].map(y => matrix.transformPoint({ x, y })))
        const margin = data.style.borderWidth / 2 + 1
        const left = Math.floor(Math.min(...corners.map(point => point.x)) - margin)
        const top = Math.floor(Math.min(...corners.map(point => point.y)) - margin)
        bounds = { left, top,
          width: Math.ceil(Math.max(...corners.map(point => point.x)) + margin) - left,
          height: Math.ceil(Math.max(...corners.map(point => point.y)) + margin) - top }
        const origin = inverse.transformPoint({ x: left, y: top })
        transform = `matrix(${inverse.a},${inverse.b},${inverse.c},${inverse.d},${origin.x},${origin.y})`
      }
      // Very large authored objects still use a bounded backing bitmap.
      const resolution = Math.min(1, 8192 / Math.max(bounds.width, bounds.height), Math.sqrt(16_777_216 / (bounds.width * bounds.height)))
      canvas.width = Math.max(1, Math.ceil(bounds.width * resolution))
      canvas.height = Math.max(1, Math.ceil(bounds.height * resolution))
      Object.assign(canvas.style, { left: `${deformed ? 0 : bounds.left}px`, top: `${deformed ? 0 : bounds.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`, transformOrigin: '0 0', transform })
      context.setTransform(canvas.width / bounds.width, 0, 0, canvas.height / bounds.height, 0, 0)
      context.translate(-bounds.left, -bounds.top)
      renderShape(context, data, next.frame, deformed ? [a, b, c, d] : undefined)
    }
    const draw = (next: typeof instance) => { current = next; paint(next) }
    const preview = (event: Event) => {
      const value = (event as CustomEvent<{ frame: ComponentFrame; geometry: ShapeData['lineGeometry'] } | null>).detail
      paint(value ? { ...current, frame: value.frame, data: { ...shapeDataSchema.parse(current.data), lineGeometry: value.geometry } } : current)
    }
    root.addEventListener('component-shape-line-preview', preview)
    draw(instance)
    if (!root.isConnected) queueMicrotask(() => paint(shown, true))
    root.append(canvas)
    const dispose = () => { disposed = true; placementObserver.disconnect(); root.removeEventListener('component-shape-line-preview', preview); canvas.remove() }
    scope.cleanup(dispose)
    return { update: draw, updatePlacement(frame) { draw({ ...current, frame }) }, dispose }
  },
}
