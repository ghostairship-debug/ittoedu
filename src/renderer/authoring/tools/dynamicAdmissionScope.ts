import type { CourseProjectDocument, LayerItem, FlowBlock } from '../../../shared/courseProjectTypes'
import { createTextNode } from '../../project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../../shared/courseProjectModel'

/** Inactive locations retain their catalog, state and object identities, but do
 * not require executable code or media that this admission will never mount.
 * Active surfaces and global content keep their complete real environment.
 * This projection is disposable and never used as a transaction document. */
export function dynamicAdmissionScope(project: CourseProjectDocument, locationIds: readonly string[]): CourseProjectDocument {
  const next = structuredClone(project), active = new Set(locationIds)
  const activeSurfaces = new Set(project.locations.filter(location => active.has(location.id)).map(location => location.surfaceId))
  const placeholder = (item: LayerItem): LayerItem => {
    const { layerItemId, label, order, frame, rotation, visible, locked, hitPolicy, playbackInitialVisibility } = item
    return { ...sceneNodeToCourseLayerItem(createTextNode({ text: '' })), layerItemId, label, order, frame, rotation, visible, locked, hitPolicy, playbackInitialVisibility, opacity: 0 }
  }
  const inertBlocks = (blocks: FlowBlock[]): FlowBlock[] => blocks.map(block => block.type === 'section'
    ? { ...block, blocks: inertBlocks(block.blocks) } : { id: block.id, type: 'paragraph', text: '' })
  for (const surface of next.surfaces) {
    if (!activeSurfaces.has(surface.id)) {
      surface.backgroundAssetId = null
      surface.surfaceLayerItems.forEach(entry => { entry.item = placeholder(entry.item) })
      if (surface.type === 'flow') surface.blocks = inertBlocks(surface.blocks)
      if (surface.type === 'spatial-2d') surface.world.layerItems = surface.world.layerItems.map(placeholder)
    }
    if (surface.type === 'slide') for (const scene of surface.scenes) {
      if (project.locations.some(location => active.has(location.id) && location.kind === 'slide-scene' && location.surfaceId === surface.id && location.sceneId === scene.id)) continue
      scene.backgroundAssetId = null
      scene.layerItems = scene.layerItems.map(placeholder)
      scene.interactions = []
      if (scene.presentation) for (const state of scene.presentation.states) {
        state.layerItemOverrides = {}
        state.backgroundAssetId = null
      }
    }
  }
  return next
}
