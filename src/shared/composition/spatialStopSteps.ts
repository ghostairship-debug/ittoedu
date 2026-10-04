import { compositionStateNodeAttributes, sceneFragmentNodes } from './stateNodes'

/**
 * In-stop steps of a Spatial surface: a camera stop that follows a world item steps
 * through that item's `class="fragment"` elements in document order, with the same
 * node attributes as the in-page steps of a Slide scene. Nothing is stored for them;
 * playback derives them from the stops and the item content.
 */

type StepItem = { layerItemId: string; kind: string; content?: unknown }
type StepSurface = {
  readonly id: string
  readonly camera: { readonly frames: readonly { readonly id: string; readonly targetLayerItemId?: string }[] }
  readonly world: { readonly layerItems: readonly StepItem[] }
}
type StepLocation = { readonly id: string; readonly kind: string; readonly surfaceId: string; readonly cameraFrameId?: string }

/** Playback state ids of in-stop steps, named as the generated Slide step states are. */
export function spatialFragmentStepId(step: number): string {
  return `fragment_step_${step}`
}

export function spatialFragmentStepIndex(stateId: string | null | undefined): number | undefined {
  const match = stateId ? /^fragment_step_(0|[1-9]\d*)$/.exec(stateId) : null
  return match ? Number(match[1]) : undefined
}

/** The surface's stops in course order (its `spatial-camera` locations). */
export function spatialStopLocations<T extends StepLocation>(surface: Pick<StepSurface, 'id'>, locations: readonly T[]): T[] {
  return locations.filter(location => location.kind === 'spatial-camera' && location.surfaceId === surface.id)
}

/**
 * Stops that step, by location id, with the item they reveal and its fragment count.
 * Only the first stop that follows an item steps through it; later stops show it whole.
 */
export function spatialSteppingStops(surface: StepSurface, locations: readonly StepLocation[]): Map<string, { layerItemId: string; count: number }> {
  const frames = new Map(surface.camera.frames.map(frame => [frame.id, frame]))
  const items = new Map(surface.world.layerItems.map(item => [item.layerItemId, item]))
  const result = new Map<string, { layerItemId: string; count: number }>()
  const reached = new Set<string>()
  for (const location of spatialStopLocations(surface, locations)) {
    const targetId = location.cameraFrameId === undefined ? undefined : frames.get(location.cameraFrameId)?.targetLayerItemId
    const item = targetId === undefined ? undefined : items.get(targetId)
    if (!item || reached.has(item.layerItemId)) continue
    reached.add(item.layerItemId)
    const count = sceneFragmentNodes([item]).length
    if (count) result.set(location.id, { layerItemId: item.layerItemId, count })
  }
  return result
}

/**
 * Fragment attributes of the stepping items with playback at `locationId`, step `step`:
 * items of earlier stops show every fragment, the current stop's item shows `step`, later ones none.
 */
export function spatialFragmentNodeAttributes(
  surface: StepSurface,
  locations: readonly StepLocation[],
  locationId: string,
  step: number,
): Map<string, Map<string, Record<string, string>>> {
  const order = new Map(spatialStopLocations(surface, locations).map((location, index) => [location.id, index]))
  const current = order.get(locationId) ?? -1
  const items = new Map(surface.world.layerItems.map(item => [item.layerItemId, item]))
  const result = new Map<string, Map<string, Record<string, string>>>()
  for (const [stopId, stop] of spatialSteppingStops(surface, locations)) {
    const at = order.get(stopId)!
    const shown = at < current ? stop.count : at === current ? Math.max(0, Math.min(step, stop.count)) : 0
    const attributes = compositionStateNodeAttributes({ layerItems: [items.get(stop.layerItemId)!] }, { layerItemOverrides: {}, fragmentStep: shown })
    for (const [layerItemId, nodes] of attributes) result.set(layerItemId, nodes)
  }
  return result
}
