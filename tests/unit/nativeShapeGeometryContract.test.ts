import { describe, expect, it } from 'vitest'
import { nativePathGeometrySchema, nativeLinearGradientSchema, shapeNativeContentSchema } from '../../src/shared/contracts/native-v1'
import { layerItemSchema } from '../../src/shared/contracts/course-project-v9/schema'
import { publishedLayerItemSchema } from '../../src/shared/contracts/published-course-v2/schema'

const pathGeometry = { paths: [{ fill: true, stroke: true, commands: [
  { kind: 'move', to: [0, 0] },
  { kind: 'cubic', control1: [-0.01, 0.3], control2: [1.01, 0.7], to: [1, 1] },
  { kind: 'line', to: [0, 1] }, { kind: 'close' },
] }] }
const gradient = { kind: 'linear', start: [0, 0], end: [1, 1], stops: [
  { offset: 0, color: '#112233', opacity: 0.2 }, { offset: 1, color: '#445566', opacity: 1 },
] }
const data = { shapeType: 'rectangle', pathGeometry, style: {
  fillColor: '#ffffff', fillGradient: gradient, fillOpacity: 0.5,
  borderColor: '#000000', borderOpacity: 1, borderWidth: 2, lineStyle: 'solid',
  cornerRadius: 0, startArrow: 'none', endArrow: 'none',
} }

describe('additive Native shape geometry contract', () => {
  it('preserves identical path/gradient data in V9 and Published V2', () => {
    const published = { layerItemId: 'shape', frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 100 },
      order: 0, visible: true, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
      kind: 'native', content: { nativeType: 'shape', data } }
    expect(publishedLayerItemSchema.parse(published)).toEqual(published)
    const author = { ...published, label: 'Path', locked: false }
    expect(layerItemSchema.parse(author)).toEqual(author)
    const old = { ...data, pathGeometry: undefined, style: { ...data.style, fillGradient: undefined } }
    expect(shapeNativeContentSchema.parse(JSON.parse(JSON.stringify(old)))).toEqual(JSON.parse(JSON.stringify(old)))
  })

  it('rejects malformed paths, unknown commands, XML and conflicting preset geometry', () => {
    for (const commands of [
      [{ kind: 'line', to: [0, 0] }, { kind: 'close' }],
      [{ kind: 'move', to: [0, 0] }, { kind: 'arc', to: [1, 1] }],
      [{ kind: 'move', to: [0, 0] }, { kind: 'line', to: [Infinity, 1] }],
    ]) expect(nativePathGeometrySchema.safeParse({ paths: [{ fill: true, stroke: true, commands }] }).success).toBe(false)
    expect(nativePathGeometrySchema.safeParse({ ...pathGeometry, xml: '<custGeom/>' }).success).toBe(false)
    expect(shapeNativeContentSchema.safeParse({ ...data, shapeType: 'ellipse' }).success).toBe(false)
    expect(shapeNativeContentSchema.safeParse({ ...data, lineGeometry: { kind: 'straight', start: [0, 0], end: [1, 1] } }).success).toBe(false)
  })

  it('retains hard color stops but rejects unordered, degenerate and unknown gradient fields', () => {
    expect(nativeLinearGradientSchema.safeParse({ ...gradient, stops: [gradient.stops[0], { ...gradient.stops[1], offset: 0 }] }).success).toBe(true)
    expect(nativeLinearGradientSchema.safeParse({ ...gradient, stops: [...gradient.stops].reverse() }).success).toBe(false)
    expect(nativeLinearGradientSchema.safeParse({ ...gradient, end: [0, 0] }).success).toBe(false)
    expect(nativeLinearGradientSchema.safeParse({ ...gradient, sourceXml: 'anything' }).success).toBe(false)
  })
})
