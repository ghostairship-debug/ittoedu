import { planLayerOrder, type LayerOrderMove } from '../../editing/quickbar/layerOrder'
import { selectEffectiveLayerProjection, useEditorStore } from '../../store/editorStore'

/**
 * Store-backed commands the selection quick bar uses for the current selection. They route through the same
 * cross-surface store actions as the keyboard and the layer panel, so every action is one History step.
 */
export const selectionObjectCommands = {
  duplicate(): void { useEditorStore.getState().duplicateSelectedNodes() },
  remove(): void { useEditorStore.getState().deleteSelectedNodes() },
  canReorder(itemId: string, move: LayerOrderMove): boolean {
    const projection = selectEffectiveLayerProjection(useEditorStore.getState())
    return Boolean(projection && planLayerOrder(projection.unifiedRows, itemId, move))
  },
  reorder(itemId: string, move: LayerOrderMove): void {
    const projection = selectEffectiveLayerProjection(useEditorStore.getState())
    const order = projection ? planLayerOrder(projection.unifiedRows, itemId, move) : null
    if (order) useEditorStore.getState().reorderNodes(order)
  },
}
