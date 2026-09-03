import * as Phaser from 'phaser'
import type {
  ArrowHead,
  ShapeLineStyle,
  ShapeNode,
} from './contracts/native-v1/types'

export interface ShapeRenderSize {
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

const colorNumber = (value: string): number => Number.parseInt(value.slice(1), 16)

function dashPattern(style: ShapeLineStyle, width: number): [number, number] | null {
  if (style === 'solid') return null
  if (style === 'dotted') return [Math.max(1, width), Math.max(3, width * 1.8)]
  return [Math.max(6, width * 3), Math.max(4, width * 2)]
}

function drawSegment(
  graphics: Phaser.GameObjects.Graphics,
  start: Point,
  end: Point,
  pattern: [number, number] | null,
): void {
  if (!pattern) {
    graphics.lineBetween(start.x, start.y, end.x, end.y)
    return
  }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length <= 0) return
  const ux = dx / length
  const uy = dy / length
  let position = 0
  while (position < length) {
    const to = Math.min(length, position + pattern[0])
    graphics.lineBetween(
      start.x + ux * position,
      start.y + uy * position,
      start.x + ux * to,
      start.y + uy * to,
    )
    position += pattern[0] + pattern[1]
  }
}

function drawPolyline(
  graphics: Phaser.GameObjects.Graphics,
  points: Point[],
  style: ShapeLineStyle,
  width: number,
  closed = false,
): void {
  const pattern = dashPattern(style, width)
  for (let index = 1; index < points.length; index += 1) {
    drawSegment(graphics, points[index - 1], points[index], pattern)
  }
  if (closed && points.length > 2) {
    drawSegment(graphics, points.at(-1)!, points[0], pattern)
  }
}

function fillPolygon(graphics: Phaser.GameObjects.Graphics, points: Point[]): void {
  if (points.length < 3) return
  graphics.beginPath()
  graphics.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) graphics.lineTo(point.x, point.y)
  graphics.closePath()
  graphics.fillPath()
}

function arrowHeadPoints(
  point: Point,
  toward: Point,
  head: ArrowHead,
  size: number,
): Point[] {
  if (head === 'none') return []
  const dx = point.x - toward.x
  const dy = point.y - toward.y
  const length = Math.max(0.001, Math.hypot(dx, dy))
  const ux = dx / length
  const uy = dy / length
  const px = -uy
  const py = ux
  if (head === 'circle') {
    const segments = 16
    const radius = size * 0.42
    return Array.from({ length: segments }, (_, index) => {
      const angle = (Math.PI * 2 * index) / segments
      return {
        x: point.x + Math.cos(angle) * radius,
        y: point.y + Math.sin(angle) * radius,
      }
    })
  }
  if (head === 'diamond') {
    return [
      point,
      { x: point.x - ux * size * 0.55 + px * size * 0.38, y: point.y - uy * size * 0.55 + py * size * 0.38 },
      { x: point.x - ux * size, y: point.y - uy * size },
      { x: point.x - ux * size * 0.55 - px * size * 0.38, y: point.y - uy * size * 0.55 - py * size * 0.38 },
    ]
  }
  const spread = head === 'stealth' ? 0.42 : 0.58
  const inset = head === 'stealth' ? 0.3 : 0
  return [
    point,
    { x: point.x - ux * size + px * size * spread, y: point.y - uy * size + py * size * spread },
    { x: point.x - ux * size * inset, y: point.y - uy * size * inset },
    { x: point.x - ux * size - px * size * spread, y: point.y - uy * size - py * size * spread },
  ]
}

function sampleCubic(a: Point, b: Point, c: Point, d: Point, count = 10): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count
    const mt = 1 - t
    return {
      x: mt ** 3 * a.x + 3 * mt ** 2 * t * b.x + 3 * mt * t ** 2 * c.x + t ** 3 * d.x,
      y: mt ** 3 * a.y + 3 * mt ** 2 * t * b.y + 3 * mt * t ** 2 * c.y + t ** 3 * d.y,
    }
  })
}

function verticalBrace(width: number, height: number, side: 'left' | 'right'): Point[] {
  const direction = side === 'left' ? 1 : -1
  const edge = side === 'left' ? width * 0.82 : width * 0.18
  const inner = edge - direction * width * 0.48
  const middle = height / 2
  return [
    ...sampleCubic({ x: edge, y: 0 }, { x: inner, y: 0 }, { x: inner, y: middle * 0.72 }, { x: inner, y: middle * 0.84 }),
    ...sampleCubic({ x: inner, y: middle * 0.84 }, { x: inner, y: middle }, { x: edge - direction * width * 0.7, y: middle }, { x: edge - direction * width * 0.7, y: middle }),
    ...sampleCubic({ x: edge - direction * width * 0.7, y: middle }, { x: inner, y: middle }, { x: inner, y: middle * 1.16 }, { x: inner, y: middle * 1.16 }),
    ...sampleCubic({ x: inner, y: middle * 1.16 }, { x: inner, y: height }, { x: edge, y: height }, { x: edge, y: height }),
  ]
}

function transformPoints(points: Point[], transform: (point: Point) => Point): Point[] {
  return points.map(transform)
}

function blockArrow(type: ShapeNode['shapeType'], width: number, height: number): Point[] {
  const shaft = 0.32
  if (type === 'arrow-right') {
    return [
      { x: 0, y: height * shaft }, { x: width * 0.62, y: height * shaft },
      { x: width * 0.62, y: 0 }, { x: width, y: height / 2 },
      { x: width * 0.62, y: height }, { x: width * 0.62, y: height * (1 - shaft) },
      { x: 0, y: height * (1 - shaft) },
    ]
  }
  if (type === 'arrow-left') {
    return transformPoints(blockArrow('arrow-right', width, height), (point) => ({ x: width - point.x, y: point.y }))
  }
  if (type === 'arrow-up') {
    return transformPoints(blockArrow('arrow-right', height, width), (point) => ({ x: point.y, y: height - point.x }))
  }
  if (type === 'arrow-down') {
    return transformPoints(blockArrow('arrow-right', height, width), (point) => ({ x: width - point.y, y: point.x }))
  }
  return [
    { x: 0, y: height / 2 }, { x: width * 0.22, y: 0 },
    { x: width * 0.22, y: height * shaft }, { x: width * 0.78, y: height * shaft },
    { x: width * 0.78, y: 0 }, { x: width, y: height / 2 },
    { x: width * 0.78, y: height }, { x: width * 0.78, y: height * (1 - shaft) },
    { x: width * 0.22, y: height * (1 - shaft) }, { x: width * 0.22, y: height },
  ]
}

export function renderShapeGraphics(
  graphics: Phaser.GameObjects.Graphics,
  node: ShapeNode,
  size: ShapeRenderSize = node,
): void {
  const { width, height } = size
  const style = node.style
  const borderWidth = Math.max(0, style.borderWidth)
  const fill = colorNumber(style.fillColor)
  const border = colorNumber(style.borderColor)
  const polygonStroke = (points: Point[], closed = true) => {
    if (style.fillOpacity > 0 && closed) {
      graphics.fillStyle(fill, style.fillOpacity)
      fillPolygon(graphics, points)
    }
    if (borderWidth > 0 && style.borderOpacity > 0) {
      graphics.lineStyle(borderWidth, border, style.borderOpacity)
      drawPolyline(graphics, points, style.lineStyle, borderWidth, closed)
    }
  }

  graphics.clear()
  switch (node.shapeType) {
    case 'rectangle':
    case 'rounded-rectangle': {
      const radius = Math.min(
        node.shapeType === 'rounded-rectangle' ? Math.max(1, style.cornerRadius) : 0,
        width / 2,
        height / 2,
      )
      if (style.fillOpacity > 0) {
        graphics.fillStyle(fill, style.fillOpacity)
        graphics.fillRoundedRect(0, 0, width, height, radius)
      }
      if (borderWidth > 0 && style.borderOpacity > 0) {
        graphics.lineStyle(borderWidth, border, style.borderOpacity)
        if (style.lineStyle === 'solid') {
          const inset = borderWidth / 2
          graphics.strokeRoundedRect(inset, inset, Math.max(1, width - borderWidth), Math.max(1, height - borderWidth), Math.max(0, radius - inset))
        } else {
          drawPolyline(graphics, [
            { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
          ], style.lineStyle, borderWidth, true)
        }
      }
      break
    }
    case 'ellipse': {
      if (style.fillOpacity > 0) {
        graphics.fillStyle(fill, style.fillOpacity)
        graphics.fillEllipse(width / 2, height / 2, width, height)
      }
      if (borderWidth > 0 && style.borderOpacity > 0) {
        graphics.lineStyle(borderWidth, border, style.borderOpacity)
        const points = Array.from({ length: 48 }, (_, index) => {
          const angle = (Math.PI * 2 * index) / 48
          return { x: width / 2 + Math.cos(angle) * width / 2, y: height / 2 + Math.sin(angle) * height / 2 }
        })
        drawPolyline(graphics, points, style.lineStyle, borderWidth, true)
      }
      break
    }
    case 'triangle':
    case 'emphasis-triangle':
      polygonStroke([{ x: width / 2, y: 0 }, { x: width, y: height }, { x: 0, y: height }])
      break
    case 'diamond':
      polygonStroke([{ x: width / 2, y: 0 }, { x: width, y: height / 2 }, { x: width / 2, y: height }, { x: 0, y: height / 2 }])
      break
    case 'emphasis-dot': {
      graphics.fillStyle(fill, Math.max(style.fillOpacity, 0.001))
      graphics.fillCircle(width / 2, height / 2, Math.min(width, height) / 2)
      if (borderWidth > 0) {
        graphics.lineStyle(borderWidth, border, style.borderOpacity)
        graphics.strokeCircle(width / 2, height / 2, Math.max(1, Math.min(width, height) / 2 - borderWidth / 2))
      }
      break
    }
    case 'line':
    case 'elbow-arrow': {
      if (borderWidth <= 0 || style.borderOpacity <= 0) break
      const points = node.shapeType === 'line'
        ? [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }]
        : [{ x: 0, y: height * 0.2 }, { x: width * 0.55, y: height * 0.2 }, { x: width * 0.55, y: height * 0.8 }, { x: width, y: height * 0.8 }]
      graphics.lineStyle(borderWidth, border, style.borderOpacity)
      drawPolyline(graphics, points, style.lineStyle, borderWidth)
      graphics.fillStyle(border, style.borderOpacity)
      fillPolygon(graphics, arrowHeadPoints(points[0], points[1], style.startArrow, Math.max(12, borderWidth * 4)))
      fillPolygon(graphics, arrowHeadPoints(points.at(-1)!, points.at(-2)!, style.endArrow, Math.max(12, borderWidth * 4)))
      break
    }
    case 'arrow-left':
    case 'arrow-right':
    case 'arrow-up':
    case 'arrow-down':
    case 'arrow-left-right':
      polygonStroke(blockArrow(node.shapeType, width, height))
      break
    case 'brace-left':
    case 'brace-right':
    case 'brace-top':
    case 'brace-bottom':
    case 'brace-pair-horizontal':
    case 'brace-pair-vertical':
    case 'bracket-left':
    case 'bracket-right': {
      if (borderWidth <= 0 || style.borderOpacity <= 0) break
      graphics.lineStyle(borderWidth, border, style.borderOpacity)
      const draw = (points: Point[]) => drawPolyline(graphics, points, style.lineStyle, borderWidth)
      if (node.shapeType === 'brace-left' || node.shapeType === 'brace-pair-horizontal') draw(verticalBrace(width, height, 'left'))
      if (node.shapeType === 'brace-right' || node.shapeType === 'brace-pair-horizontal') draw(verticalBrace(width, height, 'right'))
      if (node.shapeType === 'brace-top' || node.shapeType === 'brace-pair-vertical') {
        draw(transformPoints(verticalBrace(height, width, 'left'), (point) => ({ x: point.y, y: point.x })))
      }
      if (node.shapeType === 'brace-bottom' || node.shapeType === 'brace-pair-vertical') {
        draw(transformPoints(verticalBrace(height, width, 'right'), (point) => ({ x: point.y, y: point.x })))
      }
      if (node.shapeType === 'bracket-left') draw([{ x: width * 0.75, y: 0 }, { x: width * 0.25, y: 0 }, { x: width * 0.25, y: height }, { x: width * 0.75, y: height }])
      if (node.shapeType === 'bracket-right') draw([{ x: width * 0.25, y: 0 }, { x: width * 0.75, y: 0 }, { x: width * 0.75, y: height }, { x: width * 0.25, y: height }])
      break
    }
  }
}
