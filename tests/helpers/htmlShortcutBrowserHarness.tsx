import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useState } from 'react'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { HtmlPreviewLease } from '../../src/shared/workbench/htmlPreview'
import { HtmlPreviewPane } from '../../src/renderer/documentFiles/html/HtmlPreviewPane'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'

export function mountHtmlShortcutHarness(container: HTMLElement, initial: DocumentSnapshot, lease: HtmlPreviewLease) {
  const root = createRoot(container), textDrafts = new HtmlTextDrafts(), facts = { errors: [] as string[] }
  function View() {
    const [committed, setCommitted] = useState(initial)
    const update = (next: DocumentSnapshot) => flushSync(() => setCommitted(next))
    ;(window as any).desktopAPI = { workspaceFiles: async (request: unknown) => {
      const packet = await (window as any).htmlShortcutCall(request)
      update(packet.snapshot)
      return packet.response
    } }
    const history = async (direction: 'undo' | 'redo') => {
      try { update(await (window as any).htmlShortcutHistory(direction)) }
      catch (error) { facts.errors.push(error instanceof Error ? error.message : String(error)) }
    }
    return <HtmlPreviewPane lease={lease} committed={committed} tabId="shortcut-tab" textDrafts={textDrafts}
      onUndo={() => { void history('undo') }} onRedo={() => { void history('redo') }} />
  }
  flushSync(() => root.render(<View />))
  return facts
}
