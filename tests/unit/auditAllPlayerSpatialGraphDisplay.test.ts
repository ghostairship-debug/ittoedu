import { expect, it } from 'vitest'
import { composeMatrices, framePointToSpace, IDENTITY_MATRIX, transformPoint } from '../../src/core/components/geometry'
import { spatialConnectionSegments, spatialConnectionTargets, spatialPathPoints, spatialRelationLabelPosition, type SpatialGeometryTarget } from '../../src/player/surfaces/spatial/componentPlatform/graph'

const stations: SpatialGeometryTarget[] = [70, 870, 1670].map((x, index) => ({ instanceId: `station-${index}`, parentToSurface: IDENTITY_MATRIX,
  frame: { width: 460, height: 210, transform: [1, 0, 0, 1, x, 185] } }))

it('draws the existing three-stop center sequence only in the gaps between nodes', () => {
  const path = { id: 'tour', frameIds: [], instanceIds: stations.map(target => target.instanceId) }, before = structuredClone({ path, stations })
  const points = spatialPathPoints(undefined, path, stations)
  expect(points).toEqual([{ x: 300, y: 290 }, { x: 1100, y: 290 }, { x: 1900, y: 290 }])
  expect(spatialConnectionSegments(points, stations)).toEqual([
    { start: { x: 530, y: 290 }, end: { x: 870, y: 290 } }, { start: { x: 1330, y: 290 }, end: { x: 1670, y: 290 } },
  ])
  expect(spatialConnectionSegments([points[0]!, points[2]!], stations)).toEqual(spatialConnectionSegments(points, stations))
  expect({ path, stations }).toEqual(before)
})

it('clips in the authored rectangle through both the frame and its parent affine transform', () => {
  const target: SpatialGeometryTarget = { instanceId: 'child', parentToSurface: [1, .25, .5, 1, 300, -50],
    frame: { width: 100, height: 60, transform: [0, 2, -1, .2, 100, 200] } }
  const matrix = composeMatrices(target.parentToSurface, target.frame.transform), start = framePointToSpace(target.frame, { x: 50, y: 30 }, target.parentToSurface)
  const end = transformPoint(matrix, { x: 350, y: 30 }), segments = spatialConnectionSegments([start, end], [target])
  expect(segments).toHaveLength(1)
  expect(segments[0]!.start.x).toBeCloseTo(transformPoint(matrix, { x: 100, y: 30 }).x)
  expect(segments[0]!.start.y).toBeCloseTo(transformPoint(matrix, { x: 100, y: 30 }).y)
  expect(segments[0]!.end).toEqual(end)
})

it('centers measured labels off the stroke and clears node frames in a narrow gap', () => {
  const targets: SpatialGeometryTarget[] = [0, 150].map((x, index) => ({ instanceId: String(index), parentToSurface: IDENTITY_MATRIX,
    frame: { width: 100, height: 80, transform: [1, 0, 0, 1, x, 0] } }))
  const segments = spatialConnectionSegments([{ x: 50, y: 40 }, { x: 200, y: 40 }], targets)
  const position = spatialRelationLabelPosition(segments, targets, IDENTITY_MATRIX, { width: 120, height: 16 })!
  expect(position.x).toBe(125)
  expect(position.y + 8).toBeLessThan(0)
})

it('keeps a child-to-child connection inside its parent without making other group nodes transparent', () => {
  const parent: SpatialGeometryTarget = { instanceId: 'parent', parentToSurface: IDENTITY_MATRIX, frame: { width: 2300, height: 700, transform: [1, 0, 0, 1, 0, 0] } }
  const children = stations.map(target => ({ ...target, ancestors: ['parent'] })), targets = [parent, ...children]
  const points = [{ x: 300, y: 290 }, { x: 1100, y: 290 }]
  expect(spatialConnectionSegments(points, targets)).toEqual([])
  expect(spatialConnectionSegments(points, spatialConnectionTargets(targets, ['station-0', 'station-1']))).toEqual([
    { start: { x: 530, y: 290 }, end: { x: 870, y: 290 } },
  ])
  expect(spatialConnectionTargets(targets, ['parent', 'station-0'])).toContain(parent)
  expect(spatialConnectionTargets(targets, [])).toContain(parent)
})
