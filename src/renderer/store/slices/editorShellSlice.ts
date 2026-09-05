import type { EditorStoreKernel } from '../editorStoreKernel'

export type SidebarTab =
  | 'elements'
  | 'components'
  | 'layers'
  | 'properties'
  | 'automation'
  | 'developer'
export type EditorShellTab = SidebarTab
export type EditorMode = 'simple' | 'professional'
export type EditingScope = 'scene' | 'global'
export type CanvasMode = 'edit' | 'run'
export type TextEditSource = 'canvas' | 'properties'
export type SlideLineDrawTool = 'line' | 'elbow-arrow' | null

export type EditorShellOwnedState = {
  editorMode: EditorMode
  activeTab: EditorShellTab
  canvasMode: CanvasMode
  statusMessage: string | null
  errorMessage: string | null
  editingTextNodeId: string | null
  slideDrawTool: SlideLineDrawTool
}

export type EditorShellPorts = {
  read(): EditorShellOwnedState
  patch(patch: Partial<EditorShellOwnedState>): void
}

const EDITOR_MODE_STORAGE_KEY = 'courseware-editor:mode'

function persistEditorMode(mode: EditorMode): void {
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
  setEditorMode(mode: EditorMode): void
  setActiveTab(tab: EditorShellTab): void
  setStatus(message: string | null): void
  setError(message: string | null): void
  setSlideDrawTool(tool: SlideLineDrawTool): void
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
    setSlideDrawTool(tool) {
      shell.patch({
        slideDrawTool: tool,
        ...(tool === 'line'
          ? { statusMessage: '在画布上拖拽绘制直线；Esc 取消' }
          : tool === 'elbow-arrow'
            ? { statusMessage: '在画布上拖拽绘制折线箭头；Esc 取消' }
            : {}),
      })
    },
  }
}
