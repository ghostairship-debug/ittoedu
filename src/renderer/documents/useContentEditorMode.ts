import { useEffect, useRef, useState } from 'react'
import type { CourseEditorMode } from './CourseEditorChromeContext'

/** View-only preference, keyed by host DocumentId rather than the copied project ID. */
export function useContentEditorMode(documentId: string | null, focused: boolean, enter: () => void, exit: () => void) {
  const [modes, setModes] = useState<Record<string, CourseEditorMode>>({})
  const mode = documentId ? modes[documentId] ?? 'light' : 'light'
  const previous = useRef({ documentId, focused })
  useEffect(() => {
    const before = previous.current
    previous.current = { documentId, focused }
    if (before.documentId !== documentId) {
      if (mode === 'deep' && !focused) enter()
      else if (mode === 'light' && focused) exit()
    } else if (before.focused && !focused && mode === 'deep' && documentId) {
      setModes(current => ({ ...current, [documentId]: 'light' }))
    }
  }, [documentId, focused, mode, enter, exit])
  const setMode = (next: CourseEditorMode) => {
    if (!documentId) return
    setModes(current => ({ ...current, [documentId]: next }))
    if (next === 'deep') enter(); else exit()
  }
  return { documentId, mode, setMode }
}
