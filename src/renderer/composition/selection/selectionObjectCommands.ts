import type { ObjectCommandPorts } from '../../editing/commands/objectCommands'
import type { LayerOrderMove } from '../../editing/quickbar/layerOrder'
import { containerChildIds, owningContainer } from '../../../shared/contracts/component-platform/project'
import { selectEditingScope, useEditorStore } from '../../store/editorStore'

function planOrder(itemId: string, move: LayerOrderMove): string[] | null {
  const project = useEditorStore.getState().courseView.editingProject
  if (!project || project.instances[itemId]?.locked) return null
  const owner = owningContainer(project,itemId)
  if (!owner) return null
  const ids = [...containerChildIds(project,owner)], index = ids.indexOf(itemId)
  const target = move==='front'?ids.length-1:move==='back'?0:index+(move==='forward'?1:-1)
  if(index<0 || target<0 || target>=ids.length || target===index) return null
  ids.splice(index,1); ids.splice(target,0,itemId)
  return ids
}
/** The original quickbar and context menus share the canonical cross-surface actions. */
export const selectionObjectCommands = {
  copy(): void { useEditorStore.getState().copySelectedNodes() },
  paste(): void { useEditorStore.getState().pasteNodes() },
  duplicate(): void { useEditorStore.getState().duplicateSelectedNodes() },
  remove(): void { useEditorStore.getState().deleteSelectedNodes() },
  selectAll(): void {
    const state=useEditorStore.getState(), project=state.courseView.project
    if (!project) return
    state.selectNodes(selectEditingScope(state)==='global'?[...project.global.underlay,...project.global.overlay]:[...(project.surfaces.find(surface=>surface.id===state.courseView.surfaceId)?.childIds??[])])
  },
  canReorder(itemId: string, move: LayerOrderMove): boolean { return Boolean(planOrder(itemId,move)) },
  reorder(itemId: string, move: LayerOrderMove): void { const ids=planOrder(itemId,move); if(ids) useEditorStore.getState().reorderNodes(ids) },
  imageSource(assetId: string): { width:number; height:number; mimeType:string; bytes:Uint8Array|null } | null {
    const state=useEditorStore.getState(), view=state.courseView
    const meta=view.project?.assets[assetId]
    if(!meta || !meta.mimeType?.startsWith('image/')) return null
    const resources=view.views.find(item=>item.documentId===view.activeDocumentId)?.model.resources ?? view.snapshot?.model.resources
    const dimensions = meta as typeof meta & {width?:number;height?:number}
    return {width:dimensions.width??0,height:dimensions.height??0,mimeType:meta.mimeType,bytes:resources?.assets[assetId]??resources?.assets[meta.path]??null}
  },
  portsFor(itemId: string): ObjectCommandPorts {
    return {copy:selectionObjectCommands.copy,paste:selectionObjectCommands.paste,duplicate:selectionObjectCommands.duplicate,remove:selectionObjectCommands.remove,
      canReorder:move=>selectionObjectCommands.canReorder(itemId,move),reorder:move=>selectionObjectCommands.reorder(itemId,move)}
  },
}

