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
      // A document created or opened from inside the editor stays in the editor.
      // The workbench never enters it by itself: its only entry is the button.
      if (focused && documentId && mode !== 'deep') setModes(current => ({ ...current, [documentId]: 'deep' }))
      else if (focused && !documentId) exit()
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
