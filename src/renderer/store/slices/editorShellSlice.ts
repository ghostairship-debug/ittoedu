import type { EditorStoreKernel } from '../editorStoreKernel'
import { sameBackgroundPreviewTarget, type BackgroundPreview, type BackgroundPreviewTarget } from '../../authoring/backgroundPreview'

export type SidebarTab =
  | 'elements'
  | 'components'
  | 'layers'
  | 'properties'
  | 'automation'
  | 'developer'
export type EditorShellTab = SidebarTab
export type EditingScope = 'scene' | 'global'
export type CanvasMode = 'edit' | 'run'
export type TextEditSource = 'canvas' | 'properties'
export type SlideLineDrawTool = 'line' | 'elbow-arrow' | null

export type EditorShellOwnedState = {
  activeTab: EditorShellTab
  canvasMode: CanvasMode
  statusMessage: string | null
  errorMessage: string | null
  editingTextNodeId: string | null
  slideDrawTool: SlideLineDrawTool
  previewBackgroundColor: BackgroundPreview | null
}

export type EditorShellPorts = {
  read(): EditorShellOwnedState
  patch(patch: Partial<EditorShellOwnedState>): void
}

export function createEditorShellSlice(
  kernel: EditorStoreKernel,
  shell: EditorShellPorts,
): {
  setActiveTab(tab: EditorShellTab): void
  setStatus(message: string | null): void
  setError(message: string | null): void
  setSlideDrawTool(tool: SlideLineDrawTool): void
  setPreviewBackgroundColor(preview: BackgroundPreview | null, expected?: BackgroundPreviewTarget): void
} {
  return {
    setActiveTab(tab) {
      shell.patch({ activeTab: tab })
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
    setPreviewBackgroundColor(preview, expected) {
      const current = shell.read().previewBackgroundColor
      if (!preview && expected && current && !sameBackgroundPreviewTarget(current.target, expected)) return
      shell.patch({ previewBackgroundColor: preview })
    },
  }
}
