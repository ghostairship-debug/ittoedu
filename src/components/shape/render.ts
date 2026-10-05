import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform/runtime'
import { renderShapeCanvas } from '../../shared/canvasShapeRenderer'
import { shapeDataSchema } from './data'
import type { ShapeData } from './data'

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
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    const context = canvas.getContext('2d')
    if (!context) throw new Error('形状组件无法创建 Canvas 2D')
    let disposed = false
    const draw = (next: typeof instance) => {
      if (disposed || !scope.isActive()) return
      const data = shapeDataSchema.parse(next.data)
      if (!next.frame) throw new Error('形状组件缺少 frame')
      canvas.width = Math.max(1, Math.ceil(next.frame.width))
      canvas.height = Math.max(1, Math.ceil(next.frame.height))
      context.clearRect(0, 0, canvas.width, canvas.height)
      renderShape(context, data, next.frame)
    }
    draw(instance)
    root.append(canvas)
    const dispose = () => { disposed = true; canvas.remove() }
    scope.cleanup(dispose)
    return { update: draw, dispose }
  },
}
