import type { CourseProjectDocument, CourseSurfaceDocument } from './courseProjectTypes'
import { layerDynamicInstanceIds, projectDynamicInstanceInput, visitProjectDynamicInstances } from './composition/dynamic'
import { walkDocument } from './document/content'
import { effectiveSceneCanvas } from './slideCanvas'

/** Include hidden/disabled instances and named states in the existing admission host. */
export function projectDynamicTargets(project: CourseProjectDocument, before: CourseProjectDocument, resourcesChanged: boolean) {
  const previous = new Map<string, unknown>(), changed = new Set<string>()
  visitProjectDynamicInstances(before, entry => previous.set(entry.instanceId, projectDynamicInstanceInput(entry)))
  visitProjectDynamicInstances(project, entry => {
    if (resourcesChanged || JSON.stringify(previous.get(entry.instanceId)) !== JSON.stringify(projectDynamicInstanceInput(entry))) changed.add(entry.instanceId)
  })
  const ids = (items: readonly { item: Parameters<typeof layerDynamicInstanceIds>[0] }[]) => items.flatMap(entry => layerDynamicInstanceIds(entry.item))
  return project.locations.flatMap(location => {
    const surface = project.surfaces.find(entry => entry.id === location.surfaceId)!
    const scene = surface.type === 'slide' && location.kind === 'slide-scene' ? surface.scenes.find(entry => entry.id === location.sceneId) : undefined
    const priorSurface = before.surfaces.find(entry => entry.id === surface.id)
    const priorScene = priorSurface?.type === 'slide' ? priorSurface.scenes.find(entry => entry.id === scene?.id) : undefined
    const geometry = (value: CourseSurfaceDocument | undefined, currentScene?: typeof scene) => value?.type === 'flow' ? value.layout
      : value?.type === 'slide' ? { reference: value.canvas, effective: effectiveSceneCanvas(value, currentScene) }
        : value?.type === 'spatial-2d' ? value.camera : null
    const layoutChanged = JSON.stringify(geometry(surface, scene)) !== JSON.stringify(geometry(priorSurface, priorScene))
      || JSON.stringify(scene?.presentation) !== JSON.stringify(priorScene?.presentation)
      || (surface.type === 'flow' && JSON.stringify(surface.blocks) !== JSON.stringify(priorSurface?.type === 'flow' ? priorSurface.blocks : undefined))
    const localIds = surface.type === 'flow' ? (() => {
      const values: string[] = []; walkDocument(surface.blocks, block => { if (block.type === 'component') values.push(block.id) }); return values
    })() : (surface.type === 'spatial-2d' ? surface.world.layerItems : scene?.layerItems ?? []).flatMap(layerDynamicInstanceIds)
    const instanceIds = [...new Set([...ids(project.globalLayerItems), ...ids(surface.surfaceLayerItems), ...localIds])]
      .filter(id => layoutChanged || changed.has(id))
    if (!instanceIds.length) return []
    const states = scene?.presentation?.states.map(state => state.id) ?? []
    return (states.length ? states : [null]).map(stateId => ({ locationId: location.id, stateId, instanceIds }))
  })
}
