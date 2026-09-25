import { createContext, useContext } from 'react'

/** App-owned course actions the floating selection controls reuse instead of opening the editor. */
export interface CourseEditorActions {
  /** Pick an image file and replace the selected image in place. */
  replaceImage(): void
}

export const CourseEditorActionsContext = createContext<CourseEditorActions | null>(null)

export function useCourseEditorActions(): CourseEditorActions | null {
  return useContext(CourseEditorActionsContext)
}
