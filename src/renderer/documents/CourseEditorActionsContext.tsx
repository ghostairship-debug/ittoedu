import { createContext, useContext } from 'react'
import type { SlideLightEditingPort } from '../composition/selection/slideLightEditingPort'

/** App-owned course actions the floating selection controls reuse instead of opening the editor. */
export interface CourseEditorActions {
  /** Pick an image file and replace the selected image in place. */
  replaceImage(): void
  /** Pick a video file and replace the selected video, keeping its frame. */
  replaceVideo?(): void
  slideLight?: SlideLightEditingPort
}

export const CourseEditorActionsContext = createContext<CourseEditorActions | null>(null)

export function useCourseEditorActions(): CourseEditorActions | null {
  return useContext(CourseEditorActionsContext)
}
