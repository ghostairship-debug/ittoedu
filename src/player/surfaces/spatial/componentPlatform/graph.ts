import { frameCorners, framePointToSpace, rotationMatrix, transformPoint, type AffineFrame, type AffineMatrix } from '../../../../core/components/geometry'
import type { ComponentSpatialAuthoring, ComponentSpatialPose } from '../../../../shared/contracts/component-platform'
export interface SpatialGeometryTarget { instanceId: string; frame: AffineFrame; parentToSurface: AffineMatrix }

export function spatialComponentCenter(targets: readonly SpatialGeometryTarget[], instanceId: string) {
  const target = targets.find(value => value.instanceId === instanceId)
  return target ? framePointToSpace(target.frame, { x: target.frame.width / 2, y: target.frame.height / 2 }, target.parentToSurface) : null
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
  return { ...center, rotation, zoom: Math.min(viewport.width / Math.max(1, width), viewport.height / Math.max(1, height)) }
}

export function spatialPathPoints(spatial: ComponentSpatialAuthoring | undefined, path: NonNullable<ComponentSpatialAuthoring['paths']>[number], targets: readonly SpatialGeometryTarget[]) {
  if (path.instanceIds?.length) return path.instanceIds.flatMap(id => { const point = spatialComponentCenter(targets, id); return point ? [point] : [] })
  return path.frameIds.flatMap(id => { const frame = spatial?.frames.find(value => value.id === id); return frame ? [{ x: frame.pose.x, y: frame.pose.y }] : [] })
}

export function spatialSemanticVisible(spatial: ComponentSpatialAuthoring | undefined, instanceId: string, zoom: number): boolean {
  return (spatial?.semanticZoom ?? []).filter(rule => rule.instanceIds.includes(instanceId) && zoom >= rule.minZoom && zoom < rule.maxZoom).every(rule => rule.visible)
}

export interface SpatialTourStop { pose: ComponentSpatialPose; frameId: string | null; instanceId?: string; title?: string }
/** The author's path remains the only order. Live cursors belong to Surface ViewState. */
export function spatialTourStops(spatial: ComponentSpatialAuthoring | undefined, pathId: string | null, viewport: { width: number; height: number }, targets: readonly SpatialGeometryTarget[]): SpatialTourStop[] {
  if (!spatial) return []
  const path = spatial.paths?.find(value => value.id === pathId)
  if (path?.instanceIds?.length) {
    const stops = path.instanceIds.flatMap(instanceId => {
      const center = spatialComponentCenter(targets, instanceId)
      return center ? [{ pose: { ...center, zoom: spatial.home.zoom }, frameId: null, instanceId } as SpatialTourStop] : []
    })
    if (stops.length) return stops
  }
  const frames = path?.frameIds.length ? path.frameIds.flatMap(id => spatial.frames.find(value => value.id === id) ?? []) : spatial.frames
  return frames.map(frame => ({ pose: spatialFramePose(frame, viewport, targets), frameId: frame.id, title: frame.title }))
}

export interface SpatialTourStep extends SpatialTourStop { fragmentInstanceId?: string; fragmentStep?: number }
/** Fragment counts come from the professional HTML consumer, never from a second author list. */
export function spatialTourSteps(spatial: ComponentSpatialAuthoring | undefined, pathId: string | null, viewport: { width: number; height: number }, targets: readonly SpatialGeometryTarget[], fragmentCounts: ReadonlyMap<string, number>): SpatialTourStep[] {
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
