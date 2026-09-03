import { useEffect, useRef } from 'react'
import {
  isEditorInteractiveControlTarget,
  isEditorTextInputTarget,
  resolveKeyboardDeleteDisposition,
  type KeyboardDeleteSessionSnapshot,
} from '../course/editorActionRouting'
import type {
  EditorActionId,
  EditorActionResult,
  EditorSelectionSnapshot,
} from '../course/editorActionTypes'

export interface EditorKeyboardActionPorts {
  captureDeleteSnapshot(target: EventTarget | null): KeyboardDeleteSessionSnapshot
  routeEditorAction(
    actionId: EditorActionId,
    snapshot: EditorSelectionSnapshot,
  ): Pick<EditorActionResult, 'ok' | 'reason'>
  deleteSelectedNodes(): void
  copySelection(): void
  pasteClipboard(): void
  duplicateSelection(): void
  nudgeSelection(dx: number, dy: number): void
  undo(): void
  redo(): void
  selectAll(): void
  clearSelection(): void
  selectedCount(): number
  saveProject(saveAs: boolean): void
  newProject(): void
  openProject(): void
}

/**
 * Normalizes window keydown, applies IME/focus guards, and dispatches injected
 * action ports. Does not implement Surface commands or save/open.
 */
export function useEditorKeyboardRouter(ports: EditorKeyboardActionPorts): void {
  const portsRef = useRef(ports)
  portsRef.current = ports

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isEditorTextInputTarget(event.target)) return
      const key = event.key.toLowerCase()
      const current = portsRef.current
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        current.saveProject(event.shiftKey)
      } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) current.redo()
        else current.undo()
      } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault()
        current.redo()
      } else if ((event.ctrlKey || event.metaKey) && key === 'n') {
        event.preventDefault()
        current.newProject()
      } else if ((event.ctrlKey || event.metaKey) && key === 'o') {
        event.preventDefault()
        current.openProject()
      } else if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault()
        current.selectAll()
      } else if ((event.ctrlKey || event.metaKey) && key === 'c') {
        event.preventDefault()
        current.copySelection()
      } else if ((event.ctrlKey || event.metaKey) && key === 'v') {
        event.preventDefault()
        current.pasteClipboard()
      } else if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault()
        current.duplicateSelection()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const snapshot = current.captureDeleteSnapshot(event.target)
        const disposition = resolveKeyboardDeleteDisposition(snapshot)
        if (disposition.action === 'ignore') return
        if (disposition.action === 'route') {
          const result = current.routeEditorAction('delete', disposition.snapshot)
          if (result.ok || result.reason) {
            event.preventDefault()
          }
          return
        }
        event.preventDefault()
        current.deleteSelectedNodes()
      } else if (event.key.startsWith('Arrow')) {
        if (isEditorInteractiveControlTarget(event.target)) return
        const distance = event.shiftKey ? 10 : 1
        const movement = {
          ArrowLeft: [-distance, 0],
          ArrowRight: [distance, 0],
          ArrowUp: [0, -distance],
          ArrowDown: [0, distance],
        }[event.key]
        if (movement && current.selectedCount() > 0) {
          event.preventDefault()
          current.nudgeSelection(movement[0], movement[1])
        }
      } else if (event.key === 'Escape') {
        current.clearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
