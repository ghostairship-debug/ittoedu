import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useState } from 'react'
import { CanvasPlainTextEditor } from '../../src/renderer/ui/CanvasPlainTextEditor'
import { useEditorKeyboardRouter } from '../../src/renderer/app/useEditorKeyboardRouter'

export function mountPlainTextShortcutHarness(container: HTMLElement) {
  const root = createRoot(container), facts = { draft: 'alpha beta', commits: [] as string[], objectActions: [] as string[] }
  const action = (name: string) => () => { facts.objectActions.push(name) }
  function View() {
    const [value, setValue] = useState(facts.draft)
    useEditorKeyboardRouter({ isReadOnly: () => false, captureDeleteSnapshot: () => ({ hasCourseProject: false, selection: null, contentEditable: false, selectedNodeCount: 1, editingText: false }),
      routeEditorAction: () => ({ ok: true, reason: 'accepted' }), deleteSelectedNodes: action('delete'), copySelection: action('copy'), cutSelection: action('cut'), pasteClipboard: action('paste'),
      duplicateSelection: action('duplicate'), nudgeSelection: action('nudge'), undo: action('undo'), redo: action('redo'), selectAll: action('all'), clearSelection: action('clear'), selectedCount: () => 1,
      saveProject: action('save'), newProject: action('new'), openProject: action('open') })
    return <CanvasPlainTextEditor presentation="inline" label="Shared inline text" bounds={{ x: 20, y: 20, width: 400, height: 80 }} value={value} multiline
      onDraftChange={text => { facts.draft = text; setValue(text) }} onCommit={text => { facts.commits.push(text) }} onCancel={() => {}} />
  }
  flushSync(() => root.render(<View />))
  return facts
}
