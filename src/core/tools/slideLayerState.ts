import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { MAX_SCENE_NODES } from '../../shared/constants'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { SlideCommandError, slideSceneContext } from './slideInsertion'
import { buildSlideEditorView } from './slideLayerView'
import { copySlideSceneClipboard, mutatePasteSlideSceneClipboard, sortSlideSceneLayerItems } from './slideClipboard'
import { deleteEmptyOverride } from './layerCommands'
const sameIds = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((id, index) => id === right[index])

/** The exact base/named-state reorder used by the manual Slide command. */
export function planReorderSlideSceneLayers(project: CourseProjectDocument, locationId: string, stateId: string | null, layerItemIds: readonly string[], now?: string): CourseProjectDocument {
  const currentIds = buildSlideEditorView({ project, locationId, stateId }).layers.filter(layer => layer.source === 'scene').map(layer => layer.selectionId)
  if (layerItemIds.length !== currentIds.length || new Set(layerItemIds).size !== layerItemIds.length || layerItemIds.some(id => !currentIds.includes(id))) throw new SlideCommandError('invalid-selection', '图层顺序必须包含当前场景的全部元素')
  if (sameIds(layerItemIds, currentIds)) return project
  return commitCourseProjectMutation(project, (draft) => {
      const { scene } = slideSceneContext(draft, { scope: 'scene', selection: { locationId, stateId } })
      if (stateId !== null) {
        const presentationState = scene.presentation?.states.find(
          (candidate) => candidate.id === stateId,
        )
        if (!presentationState) throw new Error('当前命名状态已失效')
        for (const [id, override] of Object.entries(presentationState.layerItemOverrides)) {
          delete override.order
          deleteEmptyOverride(presentationState.layerItemOverrides, id)
        }
        const baseIds = [...scene.layerItems]
          .sort((left, right) => left.order - right.order ||
            left.layerItemId.localeCompare(right.layerItemId))
          .map((item) => item.layerItemId)
        if (sameIds(layerItemIds, baseIds)) delete presentationState.layerItemOrder
        else presentationState.layerItemOrder = [...layerItemIds]
        return
      }
      const orderSlots = scene.layerItems.map((item) => item.order).sort((left, right) => left - right)
      const byId = new Map(scene.layerItems.map((item) => [item.layerItemId, item]))
      layerItemIds.forEach((id, index) => {
        const item = byId.get(id)
        if (!item) throw new Error('当前元素已失效')
        item.order = orderSlots[index]!
      })
      sortSlideSceneLayerItems(scene)
  }, now)
}

/** Copies the same resource/reference subgraph as manual duplicate, in one project mutation. */
export function planDuplicateSlideSceneLayers(project: CourseProjectDocument, locationId: string, stateId: string | null, layerItemIds: readonly string[], now?: string) {
  if (!layerItemIds.length) throw new Error('没有可重复的选择')
  const layers = buildSlideEditorView({ project, locationId, stateId }).layers.filter(layer => layer.source === 'scene')
  if (new Set(layerItemIds).size !== layerItemIds.length) throw new SlideCommandError('invalid-selection', '选择中不能包含重复元素')
  const selected = layerItemIds.map(id => { const layer = layers.find(layer => layer.selectionId === id); if (!layer) throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择'); return layer })
  if (selected.some(layer => layer.item.locked)) throw new SlideCommandError('locked', '当前元素已锁定')
  if (layers.length + selected.length > MAX_SCENE_NODES) throw new Error(`复制后将超过每场景 ${MAX_SCENE_NODES} 个图层的上限。`)
  const clipboard = copySlideSceneClipboard({ scope: 'scene', history: { present: project }, selection: { locationId, stateId } }, layerItemIds)
  let createdIds: string[] = []
  const nextDocument = commitCourseProjectMutation(project, draft => { createdIds = mutatePasteSlideSceneClipboard(draft, { locationId, stateId, clipboard }) }, now)
  return { nextDocument, createdIds }
}
