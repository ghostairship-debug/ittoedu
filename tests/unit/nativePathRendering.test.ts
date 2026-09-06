import { describe, expect, it } from 'vitest'
import { createShapeNode } from '../../src/renderer/project/nativeNodeFactories'
import { paintPublishedNativeRenderInput } from '../../src/player/surfaces/slide/publishedNativeRendering'
import { parsePptxCustomGeometry, parsePptxGradient } from '../../src/renderer/project/pptxShapeImport'
import { drawingMlGradientStops } from '../../src/renderer/export/drawingMlShapeGeometry'

describe('Native custom shape consumers', () => {
  it('retains the full 64-stop contract without adding out-of-budget endpoint stops', () => {
    const stops = Array.from({ length: 64 }, (_, index) => ({ offset: 0.1 + index / 63 * 0.8, color: '#112233', opacity: 1 }))
    const output = drawingMlGradientStops({ kind: 'linear', start: [0, 0], end: [1, 0], stops }, 200, 100).stops
    expect(output).toHaveLength(64)
    output.forEach((stop, index) => expect(stop.offset).toBeCloseTo(stops[index].offset, 12))
    const xml = new DOMParser().parseFromString('<gradFill><gsLst><gs pos="0"><srgbClr val="000000"/></gs><gs pos="100000"><srgbClr val="ffffff"/></gs></gsLst><lin ang="2700000" scaled="1"/></gradFill>', 'application/xml').documentElement
    const gradient = parsePptxGradient(xml, 200, 100, element => `#${element!.children[0].getAttribute('val')}`).fillGradient!
    expect(gradient.start[0]).toBeCloseTo(0); expect(gradient.start[1]).toBeCloseTo(0)
    expect(gradient.end[0]).toBeCloseTo(1); expect(gradient.end[1]).toBeCloseTo(1)
  })
  it('paints the actual Published shape as unclipped paths with independent fill/stroke and gradient alpha', () => {
    const node = createShapeNode('rectangle', { width: 200, height: 100, style: { borderWidth: 2, fillGradient: {
      kind: 'linear', start: [0, 0], end: [1, 1], stops: [{ offset: 0, color: '#000000', opacity: 0.2 }, { offset: 1, color: '#ffffff', opacity: 1 }],
    } }, pathGeometry: { paths: [{ fill: false, stroke: true, commands: [{ kind: 'move', to: [-0.1, 0] }, { kind: 'cubic', control1: [0, 0.5], control2: [1, 0.5], to: [1.1, 1] }] }] } })
    const wrap = document.createElement('div')
    paintPublishedNativeRenderInput(wrap, node, { resolveAsset: () => undefined })
    expect(wrap.querySelector('canvas')).toBeNull()
    expect(wrap.querySelector('svg')?.style.overflow).toBe('visible')
    expect(wrap.querySelector('path')?.getAttribute('d')).toBe('M-20 0 C0 50 200 50 220.00000000000003 100')
    expect(wrap.querySelector('path')?.getAttribute('fill')).toBe('none')
    expect(wrap.querySelector('stop')?.getAttribute('stop-opacity')).toBe('0.2')
  })

  it('rejects unknown path formulas and collapses uniform source gradient without guessing geometry', () => {
    const xml = (source: string) => new DOMParser().parseFromString(source, 'application/xml').documentElement
    expect(() => parsePptxCustomGeometry(xml('<custGeom><gdLst><gd name="x" fmla="*/ w 2 3"/></gdLst><pathLst/></custGeom>'))).toThrow('直接数值')
    const gradient = xml('<gradFill><gsLst><gs pos="0"><srgbClr val="000000"><alpha val="1999"/></srgbClr></gs><gs pos="71001"><srgbClr val="000000"><alpha val="1999"/></srgbClr></gs><gs pos="71001"><srgbClr val="000000"><alpha val="1999"/></srgbClr></gs><gs pos="100000"><srgbClr val="000000"><alpha val="1999"/></srgbClr></gs></gsLst><path path="rect"/></gradFill>')
    expect(parsePptxGradient(gradient, 100, 100, () => '#000000')).toEqual({ fillColor: '#000000', fillOpacity: 0.01999 })
  })
})
