import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { CourseRecipeIntent } from '../../core/course/courseRecipeEdits'
export { RECIPE_CATALOG, recipeDefaults, type RecipeId } from '../../core/course/courseRecipeEdits'
export interface RecipeInput extends Omit<CourseRecipeIntent, 'surfaceId'> {
  readonly target: CapturedCourseTarget
}
