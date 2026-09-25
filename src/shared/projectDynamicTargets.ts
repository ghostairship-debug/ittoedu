import type { CourseProjectDocument } from './courseProjectTypes'

/** Include hidden/disabled instances and named states in the existing admission host. */
export function projectDynamicTargets(project: CourseProjectDocument, before: CourseProjectDocument, resourcesChanged: boolean) {
  const previous = new Map<string, unknown>(), changed = new Set<string>()
  const scan = (value: unknown, baseline: boolean, path = ''): void => {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, any>
    if (node.kind === 'runtime' || node.kind === 'component' || node.type === 'component') {
      const id = node.layerItemId ?? node.id
      const identity = { path, node }
      if (baseline) previous.set(id, identity)
      else if (resourcesChanged || JSON.stringify(previous.get(id)) !== JSON.stringify(identity)) changed.add(id)
      return
    }
    Object.entries(node).forEach(([key, value]) => scan(value, baseline, `${path}/${key}`))
  }
  scan(before, true); scan(project, false)
  const ids = (value: unknown): string[] => {
    if (!value || typeof value !== 'object') return []
    const node = value as Record<string, any>
    if (node.kind === 'runtime' || node.kind === 'component') return [node.layerItemId]
    if (node.type === 'component') return [node.id]
    return Object.values(node).flatMap(ids)
  }
  return project.locations.flatMap(location => {
    const surface = project.surfaces.find(entry => entry.id === location.surfaceId)!
    const scene = surface.type === 'slide' && location.kind === 'slide-scene' ? surface.scenes.find(entry => entry.id === location.sceneId) : undefined
    const priorSurface = before.surfaces.find(entry => entry.id === surface.id)
    const priorScene = priorSurface?.type === 'slide' ? priorSurface.scenes.find(entry => entry.id === scene?.id) : undefined
    const geometry = (value: typeof surface | undefined) => value?.type === 'flow' ? value.layout : value?.type === 'slide' ? value.canvas : value?.type === 'spatial-2d' ? value.camera : null
    const layoutChanged = JSON.stringify(geometry(surface)) !== JSON.stringify(geometry(priorSurface))
      || JSON.stringify(scene?.presentation) !== JSON.stringify(priorScene?.presentation)
      || (surface.type === 'flow' && JSON.stringify(surface.blocks) !== JSON.stringify(priorSurface?.type === 'flow' ? priorSurface.blocks : undefined))
    const instanceIds = [...new Set([...ids(project.globalLayerItems), ...ids(surface.surfaceLayerItems),
      ...ids(surface.type === 'flow' ? surface.blocks : surface.type === 'spatial-2d' ? surface.world : scene?.layerItems)])]
      .filter(id => layoutChanged || changed.has(id))
    if (!instanceIds.length) return []
    const states = scene?.presentation?.states.map(state => state.id) ?? []
    return (states.length ? states : [null]).map(stateId => ({ locationId: location.id, stateId, instanceIds }))
  })
}
