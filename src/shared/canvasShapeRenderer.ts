import type { ArrowHead, ShapeNode } from './contracts/native-v1/types'

interface Point { x: number; y: number }

function lineDash(node: ShapeNode): number[] {
  const width = Math.max(1, node.style.borderWidth)
  if (node.style.lineStyle === 'dashed') return [Math.max(6, width * 3), Math.max(4, width * 2)]
  if (node.style.lineStyle === 'dotted') return [Math.max(1, width), Math.max(3, width * 1.8)]
  return []
}

function polygon(context: CanvasRenderingContext2D, points: Point[]): void {
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y))
  context.closePath()
}

function blockArrow(type: ShapeNode['shapeType'], width: number, height: number): Point[] {
  const shaft = 0.32
  const right: Point[] = [
    { x: 0, y: height * shaft }, { x: width * 0.62, y: height * shaft },
    { x: width * 0.62, y: 0 }, { x: width, y: height / 2 },
    { x: width * 0.62, y: height }, { x: width * 0.62, y: height * (1 - shaft) },
    { x: 0, y: height * (1 - shaft) },
  ]
  if (type === 'arrow-right') return right
  if (type === 'arrow-left') return right.map((point) => ({ x: width - point.x, y: point.y }))
  if (type === 'arrow-up') {
    return blockArrow('arrow-right', height, width).map((point) => ({ x: point.y, y: height - point.x }))
  }
  if (type === 'arrow-down') {
    return blockArrow('arrow-right', height, width).map((point) => ({ x: width - point.y, y: point.x }))
  }
  return [
    { x: 0, y: height / 2 }, { x: width * 0.22, y: 0 },
    { x: width * 0.22, y: height * shaft }, { x: width * 0.78, y: height * shaft },
    { x: width * 0.78, y: 0 }, { x: width, y: height / 2 },
    { x: width * 0.78, y: height }, { x: width * 0.78, y: height * (1 - shaft) },
    { x: width * 0.22, y: height * (1 - shaft) }, { x: width * 0.22, y: height },
  ]
}

function arrowHead(
  context: CanvasRenderingContext2D,
  point: Point,
  toward: Point,
  type: ArrowHead,
  size: number,
): void {
  if (type === 'none') return
  const dx = point.x - toward.x
  const dy = point.y - toward.y
  const length = Math.max(0.001, Math.hypot(dx, dy))
  const ux = dx / length
  const uy = dy / length
  const px = -uy
  const py = ux
  context.beginPath()
  if (type === 'circle') {
    context.arc(point.x, point.y, size * 0.42, 0, Math.PI * 2)
  } else if (type === 'diamond') {
    context.moveTo(point.x, point.y)
    context.lineTo(point.x - ux * size * 0.55 + px * size * 0.38, point.y - uy * size * 0.55 + py * size * 0.38)
    context.lineTo(point.x - ux * size, point.y - uy * size)
    context.lineTo(point.x - ux * size * 0.55 - px * size * 0.38, point.y - uy * size * 0.55 - py * size * 0.38)
    context.closePath()
  } else {
    const spread = type === 'stealth' ? 0.42 : 0.58
    const inset = type === 'stealth' ? 0.3 : 0
    context.moveTo(point.x, point.y)
    context.lineTo(point.x - ux * size + px * size * spread, point.y - uy * size + py * size * spread)
    context.lineTo(point.x - ux * size * inset, point.y - uy * size * inset)
    context.lineTo(point.x - ux * size - px * size * spread, point.y - uy * size - py * size * spread)
    context.closePath()
  }
  context.fill()
}

function verticalBrace(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  side: 'left' | 'right',
): void {
  const direction = side === 'left' ? 1 : -1
  const edge = side === 'left' ? width * 0.82 : width * 0.18
  const inner = edge - direction * width * 0.48
  const cusp = edge - direction * width * 0.7
  const middle = height / 2
  context.beginPath()
  context.moveTo(edge, 0)
  context.bezierCurveTo(inner, 0, inner, middle * 0.72, inner, middle * 0.84)
  context.bezierCurveTo(inner, middle, cusp, middle, cusp, middle)
  context.bezierCurveTo(inner, middle, inner, middle * 1.16, inner, middle * 1.16)
  context.bezierCurveTo(inner, height, edge, height, edge, height)
  context.stroke()
}

function bracket(context: CanvasRenderingContext2D, width: number, height: number, side: 'left' | 'right'): void {
  const inner = side === 'left' ? width * 0.25 : width * 0.75
  const outer = side === 'left' ? width * 0.75 : width * 0.25
  context.beginPath()
  context.moveTo(outer, 0)
  context.lineTo(inner, 0)
  context.lineTo(inner, height)
  context.lineTo(outer, height)
  context.stroke()
}

export function renderShapeCanvas(
  context: CanvasRenderingContext2D,
  node: ShapeNode,
  width = node.width,
  height = node.height,
): void {
  const style = node.style
  context.save()
  context.lineWidth = Math.max(1, style.borderWidth)
  context.strokeStyle = style.borderColor
  context.fillStyle = style.fillColor
  context.setLineDash(lineDash(node))
  context.lineJoin = 'round'
  context.lineCap = style.lineStyle === 'dotted' ? 'round' : 'butt'

  const fillAndStroke = (allowFill = true) => {
    if (allowFill && style.fillOpacity > 0) {
      context.save(); context.globalAlpha *= style.fillOpacity; context.fill(); context.restore()
    }
    if (style.borderWidth > 0 && style.borderOpacity > 0) {
      context.save(); context.globalAlpha *= style.borderOpacity; context.stroke(); context.restore()
    }
  }

  switch (node.shapeType) {
    case 'rectangle':
      context.beginPath(); context.rect(0, 0, width, height); fillAndStroke(); break
    case 'rounded-rectangle': {
      const radius = Math.min(Math.max(1, style.cornerRadius), width / 2, height / 2)
      context.beginPath(); context.roundRect(0, 0, width, height, radius); fillAndStroke(); break
    }
    case 'ellipse':
    case 'emphasis-dot':
      context.beginPath(); context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); fillAndStroke(); break
    case 'triangle':
    case 'emphasis-triangle':
      polygon(context, [{ x: width / 2, y: 0 }, { x: width, y: height }, { x: 0, y: height }]); fillAndStroke(); break
    case 'diamond':
      polygon(context, [{ x: width / 2, y: 0 }, { x: width, y: height / 2 }, { x: width / 2, y: height }, { x: 0, y: height / 2 }]); fillAndStroke(); break
    case 'arrow-left':
    case 'arrow-right':
    case 'arrow-up':
    case 'arrow-down':
    case 'arrow-left-right':
      polygon(context, blockArrow(node.shapeType, width, height)); fillAndStroke(); break
    case 'line':
    case 'elbow-arrow': {
      if (style.borderWidth <= 0 || style.borderOpacity <= 0) break
      const points = node.shapeType === 'line'
        ? [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }]
        : [{ x: 0, y: height * 0.2 }, { x: width * 0.55, y: height * 0.2 }, { x: width * 0.55, y: height * 0.8 }, { x: width, y: height * 0.8 }]
      context.save(); context.globalAlpha *= style.borderOpacity; context.beginPath(); context.moveTo(points[0].x, points[0].y)
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.stroke(); context.fillStyle = style.borderColor
      arrowHead(context, points[0], points[1], style.startArrow, Math.max(12, style.borderWidth * 4))
      arrowHead(context, points.at(-1)!, points.at(-2)!, style.endArrow, Math.max(12, style.borderWidth * 4)); context.restore(); break
    }
    case 'brace-left':
      if (style.borderWidth > 0 && style.borderOpacity > 0) {
        context.save(); context.globalAlpha *= style.borderOpacity; verticalBrace(context, width, height, 'left'); context.restore()
      }
      break
    case 'brace-right':
      if (style.borderWidth > 0 && style.borderOpacity > 0) {
        context.save(); context.globalAlpha *= style.borderOpacity; verticalBrace(context, width, height, 'right'); context.restore()
      }
      break
    case 'brace-pair-horizontal':
      if (style.borderWidth > 0 && style.borderOpacity > 0) {
        context.save(); context.globalAlpha *= style.borderOpacity; verticalBrace(context, width, height, 'left'); verticalBrace(context, width, height, 'right'); context.restore()
      }
      break
    case 'brace-top':
    case 'brace-bottom':
    case 'brace-pair-vertical': {
      if (style.borderWidth <= 0 || style.borderOpacity <= 0) break
      context.save(); context.globalAlpha *= style.borderOpacity; context.translate(width, 0); context.rotate(Math.PI / 2)
      if (node.shapeType === 'brace-top' || node.shapeType === 'brace-pair-vertical') verticalBrace(context, height, width, 'left')
      if (node.shapeType === 'brace-bottom' || node.shapeType === 'brace-pair-vertical') verticalBrace(context, height, width, 'right')
      context.restore(); break
    }
    case 'bracket-left':
      if (style.borderWidth > 0 && style.borderOpacity > 0) {
        context.save(); context.globalAlpha *= style.borderOpacity; bracket(context, width, height, 'left'); context.restore()
      }
      break
    case 'bracket-right':
      if (style.borderWidth > 0 && style.borderOpacity > 0) {
        context.save(); context.globalAlpha *= style.borderOpacity; bracket(context, width, height, 'right'); context.restore()
      }
      break
  }
  context.restore()
}
