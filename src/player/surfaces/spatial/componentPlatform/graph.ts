import { frameCorners, framePointToSpace, frameToSpaceMatrix, invertMatrix, rotationMatrix, transformPoint, type AffineFrame, type AffineMatrix, type GeometryPoint } from '../../../../core/components/geometry'
import type { ComponentSpatialAuthoring, ComponentSpatialPose } from '../../../../shared/contracts/component-platform'
export interface SpatialGeometryTarget { instanceId: string; frame: AffineFrame; parentToSurface: AffineMatrix; ancestors?: readonly string[] }

export function spatialComponentCenter(targets: readonly SpatialGeometryTarget[], instanceId: string) {
  const target = targets.find(value => value.instanceId === instanceId)
  return target ? framePointToSpace(target.frame, { x: target.frame.width / 2, y: target.frame.height / 2 }, target.parentToSurface) : null
}

export interface SpatialConnectionSegment { start: GeometryPoint; end: GeometryPoint }

/** Endpoint ancestors carry their children; their container frames must not erase a child-to-child connection. */
export function spatialConnectionTargets(targets: readonly SpatialGeometryTarget[], endpointIds: readonly string[]): readonly SpatialGeometryTarget[] {
  const ancestors = new Set(targets.filter(target => endpointIds.includes(target.instanceId)).flatMap(target => target.ancestors ?? []))
  return targets.filter(target => !ancestors.has(target.instanceId) || endpointIds.includes(target.instanceId))
}

export function spatialPathTargetIds(spatial: ComponentSpatialAuthoring | undefined, path: NonNullable<ComponentSpatialAuthoring['paths']>[number]): readonly string[] {
  return path.instanceIds?.length ? path.instanceIds : path.frameIds.flatMap(id => spatial?.frames.find(frame => frame.id === id)?.targetInstanceId ?? [])
}

/** Display only: keep the formal center sequence, but omit strokes inside authored world frames. */
export function spatialConnectionSegments(points: readonly GeometryPoint[], targets: readonly SpatialGeometryTarget[]): SpatialConnectionSegment[] {
  const segments: SpatialConnectionSegment[] = []
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!, end = points[index]!, dx = end.x - start.x, dy = end.y - start.y
    if (dx === 0 && dy === 0) continue
    const covered: [number, number][] = []
    for (const target of targets) {
      const matrix = frameToSpaceMatrix(target.frame, target.parentToSurface)
      if (matrix[0] * matrix[3] - matrix[1] * matrix[2] === 0) continue
      const inverse = invertMatrix(matrix), a = transformPoint(inverse, start), b = transformPoint(inverse, end)
      let from = 0, to = 1
      for (const [origin, delta, maximum] of [[a.x, b.x - a.x, target.frame.width], [a.y, b.y - a.y, target.frame.height]]) {
        if (delta === 0) { if (origin < 0 || origin > maximum) { from = 1; to = 0; break } }
        else { const first = -origin / delta, last = (maximum - origin) / delta; from = Math.max(from, Math.min(first, last)); to = Math.min(to, Math.max(first, last)) }
      }
      if (from < to) covered.push([from, to])
    }
    covered.sort((a, b) => a[0] - b[0])
    const append = (from: number, to: number) => { if (to - from > 0.000001) segments.push({ start: { x: start.x + dx * from, y: start.y + dy * from }, end: { x: start.x + dx * to, y: start.y + dy * to } }) }
    let cursor = 0
    for (const [from, to] of covered) { append(cursor, from); cursor = Math.max(cursor, to) }
    append(cursor, 1)
  }
  return segments
}

/** Labels stay upright in the viewport and clear node frames without changing their authored positions. */
export function spatialRelationLabelPosition(segments: readonly SpatialConnectionSegment[], targets: readonly SpatialGeometryTarget[], matrix: AffineMatrix,
  size: { width: number; height: number }): GeometryPoint | null {
  const screen = segments.map(segment => ({ start: transformPoint(matrix, segment.start), end: transformPoint(matrix, segment.end) }))
  const longest = screen.reduce<SpatialConnectionSegment | null>((best, segment) => !best || Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) > Math.hypot(best.end.x - best.start.x, best.end.y - best.start.y) ? segment : best, null)
  if (!longest) return null
  const point = { x: (longest.start.x + longest.end.x) / 2, y: (longest.start.y + longest.end.y) / 2 - size.height / 2 - 8 }
  const bounds = targets.map(target => { const corners = frameCorners(target.frame, target.parentToSurface).map(value => transformPoint(matrix, value))
    return { left: Math.min(...corners.map(value => value.x)), right: Math.max(...corners.map(value => value.x)), top: Math.min(...corners.map(value => value.y)), bottom: Math.max(...corners.map(value => value.y)) } })
  for (let pass = 0; pass < bounds.length; pass++) {
    const overlaps = bounds.filter(box => point.x + size.width / 2 + 4 > box.left && point.x - size.width / 2 - 4 < box.right
      && point.y + size.height / 2 + 4 > box.top && point.y - size.height / 2 - 4 < box.bottom)
    if (!overlaps.length) break
    point.y = Math.min(...overlaps.map(box => box.top)) - size.height / 2 - 8
  }
  return point
}

/** Follow uses the actual world geometry. Stored pose remains the author's recoverable snapshot. */
export function spatialFramePose(frame: ComponentSpatialAuthoring['frames'][number], viewport: { width: number; height: number }, targets: readonly SpatialGeometryTarget[]): ComponentSpatialPose {
  const target = frame.targetInstanceId && targets.find(value => value.instanceId === frame.targetInstanceId)
  if (!target) return { ...frame.pose }
  const center = framePointToSpace(target.frame, { x: target.frame.width / 2, y: target.frame.height / 2 }, target.parentToSurface)
  const transform = target.parentToSurface
  const a = transform[0] * target.frame.transform[0] + transform[2] * target.frame.transform[1]
  const b = transform[1] * target.frame.transform[0] + transform[3] * target.frame.transform[1]
  const rotation = Math.atan2(b, a) * 180 / Math.PI
  const corners = frameCorners(target.frame, target.parentToSurface).map(point => transformPoint(rotationMatrix(-rotation * Math.PI / 180), point))
  const width = Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x))
  const height = Math.max(...corners.map(point => point.y)) - Math.min(...corners.map(point => point.y))
  const zoom = Math.min(width > 0 ? viewport.width / width : Infinity, height > 0 ? viewport.height / height : Infinity)
  return { ...center, rotation, zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : frame.pose.zoom }
}

export function spatialPathPoints(spatial: ComponentSpatialAuthoring | undefined, path: NonNullable<ComponentSpatialAuthoring['paths']>[number], targets: readonly SpatialGeometryTarget[]) {
  if (path.instanceIds?.length) return path.instanceIds.flatMap(id => { const point = spatialComponentCenter(targets, id); return point ? [point] : [] })
  return path.frameIds.flatMap(id => { const frame = spatial?.frames.find(value => value.id === id)
    if (!frame) return []
    const followed = frame.targetInstanceId ? spatialComponentCenter(targets, frame.targetInstanceId) : null
    return [followed ?? { x: frame.pose.x, y: frame.pose.y }] })
}

export function spatialSemanticVisible(spatial: ComponentSpatialAuthoring | undefined, instanceId: string, zoom: number): boolean {
  return (spatial?.semanticZoom ?? []).filter(rule => rule.instanceIds.includes(instanceId) && zoom >= rule.minZoom && zoom < rule.maxZoom).every(rule => rule.visible)
}

/** An explicit session route is temporary; omission consumes the saved author choice. */
export function spatialPlaybackPathId(spatial: ComponentSpatialAuthoring | undefined, requestedPathId?: string | null): string | null {
  const id = requestedPathId === undefined ? spatial?.defaultPathId : requestedPathId
  return id && spatial?.paths?.some(path => path.id === id) ? id : null
}

export interface SpatialTourStop { pose: ComponentSpatialPose; frameId: string | null; instanceId?: string; title?: string }
/** The author's path remains the only order. Live cursors belong to Surface ViewState. */
export function spatialTourStops(spatial: ComponentSpatialAuthoring | undefined, pathId: string | null | undefined, viewport: { width: number; height: number }, targets: readonly SpatialGeometryTarget[]): SpatialTourStop[] {
  if (!spatial) return []
  const path = spatial.paths?.find(value => value.id === spatialPlaybackPathId(spatial, pathId))
  if (path?.instanceIds?.length) {
    const stops = path.instanceIds.flatMap(instanceId => {
      const center = spatialComponentCenter(targets, instanceId)
      return center ? [{ pose: { ...center, zoom: spatial.home.zoom }, frameId: null, instanceId } as SpatialTourStop] : []
    })
    return stops
  }
  const frames = path ? path.frameIds.flatMap(id => spatial.frames.find(value => value.id === id) ?? []) : spatial.frames
  return frames.map(frame => ({ pose: spatialFramePose(frame, viewport, targets), frameId: frame.id, title: frame.title }))
}

export interface SpatialTourStep extends SpatialTourStop { fragmentInstanceId?: string; fragmentStep?: number }
/** Fragment counts come from the professional HTML consumer, never from a second author list. */
export function spatialTourSteps(spatial: ComponentSpatialAuthoring | undefined, pathId: string | null | undefined, viewport: { width: number; height: number }, targets: readonly SpatialGeometryTarget[], fragmentCounts: ReadonlyMap<string, number>): SpatialTourStep[] {
  const reached = new Set<string>()
  return spatialTourStops(spatial, pathId, viewport, targets).flatMap(stop => {
    const targetId = stop.frameId ? spatial?.frames.find(frame => frame.id === stop.frameId)?.targetInstanceId : stop.instanceId
    if (!targetId || reached.has(targetId)) return [stop]
    reached.add(targetId)
    const count = fragmentCounts.get(targetId) ?? 0
    if (!count) return [stop]
    return Array.from({ length: count + 1 }, (_, fragmentStep) => ({ ...stop, fragmentInstanceId: targetId, fragmentStep }))
  })
}

/** Earlier follow stops reveal every fragment; the current reveals its step; future stops reveal none. */
export function spatialFragmentProgress(steps: readonly SpatialTourStep[], currentIndex: number | null, fragmentCounts: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const result = new Map<string, number>(), at = currentIndex ?? -1
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!, id = step.fragmentInstanceId
    if (!id) continue
    if (!result.has(id)) result.set(id, 0)
    if (index < at) result.set(id, fragmentCounts.get(id) ?? 0)
    if (index === at) result.set(id, step.fragmentStep ?? 0)
  }
  return result
}
