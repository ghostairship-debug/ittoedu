import { Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QuickBarButton } from '../../editing/quickbar/SelectionQuickBar'
import type { ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import { ElementAiCard } from './ElementAiCard'
import { elementCards, useTextCards } from './elementCardController'
import './elementCards.css'

/** What a text card starts from: the selected range, a name for it, and what the range holds now. */
export interface TextCardStart { target: ExecutionSelectionTarget; label: string; content: string | null }

/** A short name for selected text, as a card title. */
export function textCardLabel(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 16 ? `“${flat.slice(0, 16)}…”` : `“${flat}”`
}

/**
 * The quick bar's "AI 修改" for selected text in a Markdown document or a Flow page (M15): it opens a text card
 * under the bar. The card stays until it is closed, so follow-ups and undo keep working while the AI changes the
 * text; selecting text again later opens a new card.
 */
export function TextAiButton({ documentId, start, disabledReason }: { documentId: string; start(): Promise<TextCardStart>; disabledReason?: string | null }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [error, setError] = useState('')
  return <span ref={anchor} className="selection-quick-bar__anchor">
    <QuickBarButton label="AI 修改" text="AI 修改" icon={<Sparkles size={14} />} disabled={Boolean(disabledReason)} onClick={() => {
      setError('')
      const rect = anchor.current?.getBoundingClientRect()
      void start().then(value => {
        elementCards.openText({ documentId, ...value, anchor: { left: rect?.left ?? 24, top: (rect?.bottom ?? 24) + 8 } })
      }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    }} />
    {error && <span role="alert" className="selection-quick-bar__notice" title={error}>{error}</span>}
  </span>
}

/** Floats the open text cards over the workbench; closing one ends it. */
export function ElementTextCardLayer() {
  const cards = useTextCards()
  if (!cards.length) return null
  return createPortal(<>{cards.map(card => {
    const left = Math.max(8, Math.min(card.anchor?.left ?? 24, window.innerWidth - 340))
    const top = Math.max(8, Math.min(card.anchor?.top ?? 24, window.innerHeight - 320))
    return <div key={card.key} className="element-text-card" style={{ left, top }} role="dialog" aria-label={`AI 修改：${card.label}`}>
      <ElementAiCard cardKey={card.key} onClose={() => { void elementCards.closeText(card.key).catch(() => undefined) }} />
    </div>
  })}</>, document.body)
}
