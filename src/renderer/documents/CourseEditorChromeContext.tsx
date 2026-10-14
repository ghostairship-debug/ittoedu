import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
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
/** View-only slots keep the surface's existing navigation owner in the active toolbar. */
const CourseToolbarSlots = createContext<{
  mode: CourseEditorMode
  targets: Partial<Record<CourseEditorMode, HTMLElement>>
  register(mode: CourseEditorMode, element: HTMLElement | null): void
} | null>(null)
export function CourseNavigationToolbarHost({ mode }: { mode: CourseEditorMode }) {
  const slots = useContext(CourseToolbarSlots)
  const register = slots?.register
  const ref = useCallback((element: HTMLSpanElement | null) => register?.(mode, element), [mode, register])
  return <span ref={ref} className="course-navigation-toolbar-host" data-toolbar-mode={mode} />
}
export const useCourseNavigationToolbarSlot = () => useContext(CourseToolbarSlots)
export function CourseAdvancedChrome({ children }: { children: ReactNode }) {
  const { mode } = useCourseEditorChrome()
  return <div className="course-advanced-chrome" hidden={mode === 'light'}>{children}</div>
}
export function CourseEditorFrame({ children, lightTools }: { children: ReactNode; lightTools: ReactNode }) {
  const { mode, documentId } = useCourseEditorChrome()
  const [targets, setTargets] = useState<Partial<Record<CourseEditorMode, HTMLElement>>>({})
  const register = useCallback((slot: CourseEditorMode, element: HTMLElement | null) => {
    setTargets(current => {
      if (current[slot] === element || !current[slot] && !element) return current
      const next = { ...current }
      if (element) next[slot] = element
      else delete next[slot]
      return next
    })
  }, [])
  const slots = useMemo(() => ({ mode, targets, register }), [mode, targets, register])
  return <CourseToolbarSlots.Provider value={slots}><div className={`app-shell course-editor-frame course-editor-frame--${mode}`} data-document-id={documentId ?? undefined} data-editor-mode={mode}>
    <div hidden={mode !== 'light'}>{lightTools}</div>
    {children}
  </div></CourseToolbarSlots.Provider>
}
