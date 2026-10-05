import type { ProductivityContext, DesignProductionStep } from '../authoring/productivity'
import type { EditorStoreKernel } from '../store/editorStoreKernel'

interface DesignProductionPorts {
  kernel: Pick<EditorStoreKernel, 'captureTarget' | 'editCaptured' | 'readView' | 'selectSurface' | 'setFeedback'>
  hasContentDraft?(): boolean
}
/** UI previews carry their captured document through the one formal Session writer. */
export function createDesignProductionActions({ kernel }: DesignProductionPorts) {
  const readContext = (documentId?: string): ProductivityContext | null => {
    try { const target = kernel.captureTarget(documentId); return { document: target.editingProject, target } }
    catch { return null }
  }
  return {
    prepareDesignProduction: readContext,
    readDesignProductionContext: readContext,
    async commitDesignProduction(step: DesignProductionStep): Promise<boolean> {
      try {
        const { createdSurfaceId, originSurfaceId, ...command } = step
        const result = await kernel.editCaptured(command)
        if (!('revision' in result)) throw new Error(result.message)
        const current = kernel.readView()
        if (createdSurfaceId && current.activeDocumentId === step.documentId && current.surfaceId === originSurfaceId) kernel.selectSurface(createdSurfaceId, step.documentId)
        kernel.setFeedback({ errorMessage: null, statusMessage: '已应用设计修改，可一次撤销' })
        return true
      } catch (error) {
        kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : '设计修改未能提交' })
        return false
      }
    },
  }
}
