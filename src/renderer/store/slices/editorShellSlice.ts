import type { EditorStoreKernel } from '../editorStoreKernel'

export type EditorShellTab =
  | 'elements'
  | 'components'
  | 'layers'
  | 'properties'
  | 'automation'
  | 'developer'

export type EditorShellOwnedState = {
  editorMode: 'simple' | 'professional'
  activeTab: EditorShellTab
  canvasMode: 'edit' | 'run'
  statusMessage: string | null
  errorMessage: string | null
  editingTextNodeId: string | null
}

export type EditorShellPorts = {
  read(): EditorShellOwnedState
  patch(patch: Partial<EditorShellOwnedState>): void
}

const EDITOR_MODE_STORAGE_KEY = 'courseware-editor:mode'

function persistEditorMode(mode: 'simple' | 'professional'): void {
  try {
    globalThis.localStorage?.setItem(EDITOR_MODE_STORAGE_KEY, mode)
  } catch {
    // UI preference persistence is best-effort and never affects project data.
  }
}

export function createEditorShellSlice(
  kernel: EditorStoreKernel,
  shell: EditorShellPorts,
): {
  setEditorMode(mode: 'simple' | 'professional'): void
  setActiveTab(tab: EditorShellTab): void
  setStatus(message: string | null): void
  setError(message: string | null): void
} {
  return {
    setEditorMode(mode) {
      persistEditorMode(mode)
      const current = shell.read()
      const activeTab = mode === 'simple'
        && (
          current.activeTab === 'components'
          || current.activeTab === 'automation'
          || current.activeTab === 'developer'
        )
        ? 'properties'
        : current.activeTab
      shell.patch({
        editorMode: mode,
        activeTab,
        statusMessage: mode === 'simple' ? '已切换到简洁模式' : '已切换到专业模式',
      })
    },
    setActiveTab(tab) {
      const mode = shell.read().editorMode
      const activeTab = mode === 'simple'
        && (tab === 'components' || tab === 'automation' || tab === 'developer')
        ? 'elements'
        : tab
      shell.patch({ activeTab })
    },
    setStatus(message) {
      shell.patch({ statusMessage: message })
      kernel.setFeedback({ statusMessage: message })
    },
    setError(message) {
      shell.patch({ errorMessage: message })
      kernel.setFeedback({ errorMessage: message })
    },
  }
}
