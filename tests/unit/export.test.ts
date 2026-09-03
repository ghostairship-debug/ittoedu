import { describe, expect, it } from 'vitest'
import {
  pptxColor,
  pptxFontFace,
  pptxNodePosition,
  pptxRotation,
  pptxTransparency,
} from '../../src/renderer/export/pptxShared'
import { createShapeNode } from '../../src/renderer/project/nativeNodeFactories'

describe('PowerPoint 对象映射', () => {
  it('换算画布坐标、颜色、透明度和旋转角度', () => {
    const node = createShapeNode('rectangle', {
      id: 'pptx-measure',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const position = pptxNodePosition(node, {
      x: 13.333 / 1280,
      y: 7.5 / 720,
    })
    expect(position.x).toBe(0)
    expect(position.y).toBe(0)
    expect(position.w).toBeCloseTo(100 * 13.333 / 1280, 12)
    expect(position.h).toBeCloseTo(100 * 7.5 / 720, 12)
    expect(pptxColor('#3af')).toBe('33AAFF')
    expect(pptxColor('invalid', 'ABCDEF')).toBe('ABCDEF')
    expect(pptxFontFace('"Microsoft YaHei", "PingFang SC", sans-serif'))
      .toBe('Microsoft YaHei')
    expect(pptxFontFace('"<>')).toBe('Microsoft YaHei')
    expect(pptxTransparency(0.35)).toBe(65)
    expect(pptxRotation(450)).toBe(90)
    expect(pptxRotation(-90)).toBe(270)
  })
})
