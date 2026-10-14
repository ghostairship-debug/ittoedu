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
  frame: Pick<ComponentFrame, 'width' | 'height'>): void {
  // The old direct renderer reads only these drawing fields. No V9 node is
  // created, registered, stored, or returned; this projection is disposable.
  const drawing = { ...data, type: 'shape', width: frame.width, height: frame.height } as Parameters<typeof renderShapeCanvas>[1]
  renderShapeCanvas(context, drawing, frame.width, frame.height)
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
    let disposed = false, current = instance
    const paint = (next: typeof instance) => {
      if (disposed || !scope.isActive()) return
      const data = shapeDataSchema.parse(next.data)
      if (!next.frame) throw new Error('形状组件缺少 frame')
      const bounds = shapePaintBounds(data, next.frame)
      canvas.width = Math.max(1, bounds.width)
      canvas.height = Math.max(1, bounds.height)
      Object.assign(canvas.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` })
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.translate(-bounds.left, -bounds.top)
      renderShape(context, data, next.frame)
    }
    const draw = (next: typeof instance) => { current = next; paint(next) }
    const preview = (event: Event) => {
      const value = (event as CustomEvent<{ frame: ComponentFrame; geometry: ShapeData['lineGeometry'] } | null>).detail
      paint(value ? { ...current, frame: value.frame, data: { ...shapeDataSchema.parse(current.data), lineGeometry: value.geometry } } : current)
    }
    root.addEventListener('component-shape-line-preview', preview)
    draw(instance)
    root.append(canvas)
    const dispose = () => { disposed = true; root.removeEventListener('component-shape-line-preview', preview); canvas.remove() }
    scope.cleanup(dispose)
    return { update: draw, updatePlacement(frame) { draw({ ...current, frame }) }, dispose }
  },
}
