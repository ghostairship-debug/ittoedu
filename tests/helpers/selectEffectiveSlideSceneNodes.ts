import { buildSlideEditorView } from '@/renderer/course/slideEditorView'
import { courseLayerItemToEditorCanvasNode } from '@/renderer/store/slideEditorProjection'
import {
  selectActiveCourseProjectDocument,
  selectActiveSceneId,
  useEditorStore,
} from '@/renderer/store/editorStore'
import type { LayerItem } from '@/shared/courseProjectTypes'

export function selectEffectiveSlideSceneNodes(
  stateId?: string | null,
) {
  const state = useEditorStore.getState()
  const project = selectActiveCourseProjectDocument(state)
  const sceneId = selectActiveSceneId(state)
  if (!project || !sceneId) throw new Error('expected active Course Project slide scene')
  const location = project.locations.find((candidate) => (
    candidate.kind === 'slide-scene' && candidate.sceneId === sceneId
  ))
  if (!location) throw new Error('expected active Course Project slide location')
  return buildSlideEditorView({
    project,
    locationId: location.id,
    stateId,
  }).layers.flatMap((layer) => {
    if (layer.source !== 'scene') return []
    const node = courseLayerItemToEditorCanvasNode(layer.item as LayerItem)
    return node ? [node] : []
  })
}
