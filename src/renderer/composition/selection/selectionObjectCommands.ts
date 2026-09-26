import { planLayerOrder, type LayerOrderMove } from '../../editing/quickbar/layerOrder'
import type { ObjectCommandPorts } from '../../editing/commands/objectCommands'
import { selectEditingNodes, selectEffectiveLayerProjection, useEditorStore } from '../../store/editorStore'

/**
 * Store-backed commands for the current selection, used by the quick bar and the right-click menus. They route
 * through the same cross-surface store actions as the keyboard and the layer panel, so every action is one History
 * step.
 */
export const selectionObjectCommands = {
  copy(): void { useEditorStore.getState().copySelectedNodes() },
  paste(): void { useEditorStore.getState().pasteNodes() },
  duplicate(): void { useEditorStore.getState().duplicateSelectedNodes() },
  remove(): void { useEditorStore.getState().deleteSelectedNodes() },
  selectAll(): void {
    const state = useEditorStore.getState()
    state.selectNodes(selectEditingNodes(state).map(node => node.id))
  },
  canReorder(itemId: string, move: LayerOrderMove): boolean {
    const projection = selectEffectiveLayerProjection(useEditorStore.getState())
    return Boolean(projection && planLayerOrder(projection.unifiedRows, itemId, move))
  },
  reorder(itemId: string, move: LayerOrderMove): void {
    const projection = selectEffectiveLayerProjection(useEditorStore.getState())
    const order = projection ? planLayerOrder(projection.unifiedRows, itemId, move) : null
    if (order) useEditorStore.getState().reorderNodes(order)
  },
  /** The ports of one selected object, for the shared object command list. */
  portsFor(itemId: string): ObjectCommandPorts {
    return {
      copy: selectionObjectCommands.copy,
      paste: selectionObjectCommands.paste,
      duplicate: selectionObjectCommands.duplicate,
      remove: selectionObjectCommands.remove,
      canReorder: move => selectionObjectCommands.canReorder(itemId, move),
      reorder: move => selectionObjectCommands.reorder(itemId, move),
    }
  },
}
