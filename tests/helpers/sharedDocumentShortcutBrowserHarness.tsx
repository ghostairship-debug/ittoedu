import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useState } from 'react'
import { SharedDocumentEditor } from '../../src/renderer/document/SharedDocumentEditor'
import { parseDocumentMarkdown, type MarkdownDocument } from '../../src/shared/document/markdown'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

export function mountSharedDocumentShortcuts(container: HTMLElement, initial: DocumentSnapshot) {
  if (initial.model.kind !== 'markdown') throw new Error('Expected Markdown')
  const parsed = parseDocumentMarkdown(initial.model.source, { target: 'file', createId: () => crypto.randomUUID() })
  if (parsed.status !== 'valid') throw new Error('Expected supported source')
  const root = createRoot(container)
  const facts = { source: initial.model.source, changes: 0, history: [] as string[], errors: [] as string[], document: parsed.document }
  function View() {
    const [state, setState] = useState({ document: parsed.document, source: facts.source, revision: initial.revision })
    const history = async (direction: 'undo' | 'redo') => {
      facts.history.push(direction)
      const next: DocumentSnapshot = await (window as any).sharedShortcutHistory(direction)
      if (next.model.kind !== 'markdown') throw new Error('Expected Markdown')
      const projection = parseDocumentMarkdown(next.model.source, { target: 'file', createId: () => crypto.randomUUID() })
      if (projection.status !== 'valid') throw new Error('Expected valid history')
      facts.document = projection.document; facts.source = next.model.source
      flushSync(() => setState({ document: projection.document, source: facts.source, revision: next.revision }))
    }
    return <SharedDocumentEditor target="file" initialMode="layout" document={state.document} revision={String(state.revision)} sourceDraft={state.source}
      onDraft={source => { facts.source = source; setState(previous => ({ ...previous, source })) }}
      onChange={async (document: MarkdownDocument, operation) => {
        facts.document = document; facts.changes++
        try {
          const next: DocumentSnapshot = await (window as any).sharedShortcutCommit(facts.source, operation.historyGroup)
          flushSync(() => setState({ document, source: facts.source, revision: next.revision }))
          return true
        } catch (error) { facts.errors.push(String(error)); return false }
      }} onUndo={() => { void history('undo') }} onRedo={() => { void history('redo') }} />
  }
  flushSync(() => root.render(<View />))
  return facts
}
