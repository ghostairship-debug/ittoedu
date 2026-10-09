import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { planCourseRecipeEdits, type RecipePlanResult } from '../../core/course/courseRecipeEdits'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { RecipeInput } from './recipeCatalog'
export type { RecipePlanResult } from '../../core/course/courseRecipeEdits'

export function planRecipe(project: CourseProjectV10, input: RecipeInput, options: { idFactory?: () => string; now?: string } = {}): RecipePlanResult {
  if (project.id !== input.target.project.id) return { ok: false, kind: 'invalid', reason: '配方目标工程已改变。' }
  return planCourseRecipeEdits(project, { recipeId: input.recipeId, surfaceId: input.target.surfaceId, slots: input.slots, accentTokenId: input.accentTokenId }, { createId: options.idFactory })
}
export async function applyRecipe(kernel: EditorStoreKernel, input: RecipeInput): Promise<RecipePlanResult> {
  const result = planRecipe(input.target.project, input)
  if (!result.ok) return result
  try {
    await kernel.editCaptured(kernel.capture(result.edits, input.target))
    if (kernel.readView().activeDocumentId === input.target.documentId) kernel.selectSurface(result.createdLocationId, input.target.documentId)
    return result
  } catch (error) { return { ok: false, kind: 'invalid', reason: error instanceof Error ? error.message : String(error) } }
}
