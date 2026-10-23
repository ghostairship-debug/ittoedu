import { useEditorStore } from '../store/editorStore'

/** The visible scope changes only after the existing input owner accepts its draft. */
export async function changeCourseEditingScope(scope: 'scene' | 'global'): Promise<boolean> {
  const state = useEditorStore.getState()
  if (!state.courseView.activeDocumentId) return false
  if (state.editingScope === scope) return true
  return state.navigateCourseView(() => useEditorStore.getState().setEditingScope(scope))
}
