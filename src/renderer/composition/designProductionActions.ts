import type { CourseAuthoringSessionToken } from '../authoring/courseAuthoringSession'
import type { ProductivityContext } from '../authoring/productivity'
import { createEditorTransactionStep, type EditorTransactionStep } from '../authoring/editorTransaction'
import { planRecipe } from '../recipes/applyRecipe'
import type { RecipeInput } from '../recipes/recipeCatalog'

interface DesignProductionPorts {
  readContext(): ProductivityContext | null
  prepare(): { ok: true } | { ok: false; reason: string }
  persist(step: EditorTransactionStep, message: string): boolean
  activate(locationId: string): void
  feedback(reason: string): void
}

/** Composes existing planners with the one active Surface transaction owner. */
export function createDesignProductionActions(ports: DesignProductionPorts) {
  const prepare = () => {
    const result = ports.prepare()
    if (!result.ok) { ports.feedback(result.reason); return null }
    return ports.readContext()
  }
  const matches = (current: CourseAuthoringSessionToken, captured: CourseAuthoringSessionToken) =>
    current.generation === captured.generation && current.locationId === captured.locationId
    && current.surfaceType === captured.surfaceType && current.revision === captured.revision
  return {
    prepareDesignProduction: prepare,
    readDesignProductionContext: ports.readContext,
    commitDesignProduction(step: EditorTransactionStep, captured: CourseAuthoringSessionToken): boolean {
      const context = prepare()
      if (!context) return false
      if (!matches(context.sessionToken, captured) || context.document.id !== step.projectId
        || context.document.revision !== step.baseRevision) {
        ports.feedback('工程或页面已改变，请重新预览后再应用')
        return false
      }
      return ports.persist(step, '已应用设计修改，可一次撤销')
    },
    applyCourseRecipe(input: RecipeInput, captured: CourseAuthoringSessionToken): boolean {
      const context = prepare()
      if (!context) return false
      if (!matches(context.sessionToken, captured)
        || input.target.locationId !== context.sessionToken.locationId
        || input.target.revision !== context.document.revision
        || (input.target.sessionGeneration !== undefined && input.target.sessionGeneration !== context.sessionToken.generation)) {
        ports.feedback('配方目标已过期，请重新打开配方')
        return false
      }
      const result = planRecipe(context.document, input)
      if (!result.ok) { ports.feedback(result.reason); return false }
      const step = createEditorTransactionStep(context.document, result.plan)
      if (!step || !ports.persist(step, '已新建配方页，可继续编辑')) return false
      ports.activate(result.createdLocationId)
      return true
    },
  }
}
