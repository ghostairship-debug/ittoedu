import type { ComponentFrame } from '../../../../shared/contracts/component-platform/frame'
import { transformPoint, type AffineMatrix } from '../../../../core/components/geometry'

/** Office rotates about the center, while C0 transforms the local top-left. */
export function officeFrame(frame: ComponentFrame, matrix: AffineMatrix) {
  const [a, b, c, d] = matrix
  const scaleX = Math.hypot(a, b), scaleY = Math.hypot(c, d)
  if (scaleX === 0 || scaleY === 0) throw new Error('PPTX 无法表达零面积变换')
  if (Math.abs(a * c + b * d) > scaleX * scaleY * 1e-7) throw new Error('此仿射倾斜需要真实运行捕获，PPTX 原生对象无法表达')
  const center = transformPoint(matrix, { x: frame.width / 2, y: frame.height / 2 })
  const width = frame.width * scaleX, height = frame.height * scaleY
  return { x: center.x - width / 2, y: center.y - height / 2, width, height,
    rotation: Math.atan2(b, a) * 180 / Math.PI, flipY: a * d - b * c < 0, scaleX, scaleY }
}
