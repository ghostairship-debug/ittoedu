import type { ObjectCommandPorts } from '../../editing/commands/objectCommands'
import type { LayerOrderMove } from '../../editing/quickbar/layerOrder'
import { courseObjectOrder } from '../../../core/course/courseObjectEdits'
import { prepareCourseGroup, type CourseGroupIntent } from '../../../core/course/courseGroupEdits'
import { useEditorStore } from '../../store/editorStore'

function planOrder(itemId: string, move: LayerOrderMove): string[] | null {
  const project = useEditorStore.getState().courseView.editingProject
  return project ? courseObjectOrder(project, itemId, move) : null
}
/** The original quickbar and context menus share the canonical cross-surface actions. */
export const selectionObjectCommands = {
  groupReason(intent: CourseGroupIntent): string | null {
    const view = useEditorStore.getState().courseView
    if (!view.editingProject) return '文档尚未就绪'
    if (view.activeStateId) return '组合改变正式层级，请切回母版后操作'
    try { let id=0; prepareCourseGroup(view.editingProject,view.selectedInstanceIds,intent,()=> 'group-preflight-'+(++id)); return null }
    catch (error) { return error instanceof Error ? error.message : String(error) }
  },
  async group(intent: CourseGroupIntent): Promise<void> {
    const state=useEditorStore.getState(), before=state.courseView
    const identity=JSON.stringify([before.activeDocumentId,before.snapshot?.epoch,before.surfaceId,before.activeStateId,before.selectedInstanceIds])
    await state.commitSlideContentEdit()
    const current=useEditorStore.getState(),view=current.courseView
    if(identity!==JSON.stringify([view.activeDocumentId,view.snapshot?.epoch,view.surfaceId,view.activeStateId,view.selectedInstanceIds])) throw new Error('准备期间选择或文档已改变，请重新操作')
    if(view.activeStateId)throw new Error('组合改变正式层级，请切回母版后操作')
    const bridge=current.courseBridge,captured=bridge.captureOwnedTarget()
    const prepared=prepareCourseGroup(captured.editingProject,view.selectedInstanceIds,intent)
    await bridge.editCaptured(bridge.capture(prepared.edits,captured),crypto.randomUUID())
    const after=bridge.read()
    if(after.activeDocumentId===captured.documentId && after.snapshot?.epoch===captured.epoch)bridge.selectInstances(captured.documentId,prepared.selectedIds)
  },
  copy(): void { useEditorStore.getState().copySelectedNodes() },
  paste(): void { useEditorStore.getState().pasteNodes() },
  duplicate(): void { useEditorStore.getState().duplicateSelectedNodes() },
  remove(): void { useEditorStore.getState().deleteSelectedNodes() },
  selectAll(): void { useEditorStore.getState().selectAllNodes() },
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

