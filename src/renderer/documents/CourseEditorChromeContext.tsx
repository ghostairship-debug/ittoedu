import { createContext, useContext, type ReactNode } from 'react'
export type CourseEditorMode = 'light' | 'deep'
export interface CourseEditorChrome {
  documentId: string | null
  mode: CourseEditorMode
  setMode(mode: CourseEditorMode): void
  workbench?: {
    documentStatus: ReactNode
  }
}
export const CourseEditorChromeContext = createContext<CourseEditorChrome>({ documentId: null, mode: 'deep', setMode: () => {} })
export const useCourseEditorChrome = () => useContext(CourseEditorChromeContext)
export function CourseAdvancedChrome({ children }: { children: ReactNode }) {
  const { mode } = useCourseEditorChrome()
  return <div className="course-advanced-chrome" hidden={mode === 'light'}>{children}</div>
}
export function CourseEditorFrame({ children, lightTools }: { children: ReactNode; lightTools: ReactNode }) {
  const { mode, documentId } = useCourseEditorChrome()
  return <div className={`app-shell course-editor-frame course-editor-frame--${mode}`} data-document-id={documentId ?? undefined} data-editor-mode={mode}>
    <div hidden={mode !== 'light'}>{lightTools}</div>
    {children}
  </div>
}
