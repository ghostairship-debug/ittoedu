import { useSyncExternalStore } from 'react'
import type { SidebarTab } from '../store/slices/editorShellSlice'

/** View-only panels. The document, assistant and workspace owners stay mounted elsewhere. */
export type ProEditorPanel = SidebarTab | 'ai' | 'resources' | 'conversations' | null
export interface ProEditorRailState { activePanel: ProEditorPanel }

const listeners = new Set<() => void>()
let state: ProEditorRailState = { activePanel: null }

function setActivePanel(activePanel: ProEditorPanel) {
  if (state.activePanel === activePanel) return
  state = { activePanel }
  for (const listener of listeners) listener()
}

export const proEditorRailController = {
  getSnapshot: (): ProEditorRailState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  open(panel: Exclude<ProEditorPanel, null>) { setActivePanel(panel) },
  toggle(panel: Exclude<ProEditorPanel, null>) {
    setActivePanel(state.activePanel === panel ? null : panel)
  },
  close(expected?: Exclude<ProEditorPanel, null>) {
    if (expected && state.activePanel !== expected) return
    setActivePanel(null)
  },
}

export function useProEditorRailState(): ProEditorRailState {
  return useSyncExternalStore(proEditorRailController.subscribe, proEditorRailController.getSnapshot)
}

export function isProEditorTool(panel: ProEditorPanel): panel is SidebarTab {
  return panel !== null && panel !== 'ai' && panel !== 'resources' && panel !== 'conversations'
}
