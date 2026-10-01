import { Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { QuickBarButton } from '../../editing/quickbar/SelectionQuickBar'
import type { ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import { ElementAiCard } from './ElementAiCard'
import { elementCards, useTextCards, type ElementCardView } from './elementCardController'
import './elementCards.css'

/** What a text card starts from: the selected range, a name for it, and what the range holds now. */
export interface TextCardStart { target: ExecutionSelectionTarget; label: string; content: string | null }

/** A short name for selected text, as a card title. */
export function textCardLabel(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 16 ? `“${flat.slice(0, 16)}…”` : `“${flat}”`
}

const textAnchors = new Map<string, { node: HTMLElement; target: string; selectionIdentity: string; stable?: boolean }>()
const anchorChanged = 'guoling:text-card-anchor-changed'
let rebindKey: string | null = null
const rebindListeners = new Set<() => void>()
const subscribeRebind = (listener: () => void) => { rebindListeners.add(listener); return () => { rebindListeners.delete(listener) } }
const requestedRebind = () => rebindKey
function setRebind(key: string | null) {
  if (rebindKey === key) return
  rebindKey = key
  for (const listener of rebindListeners) listener()
}
function attachAnchor(key: string, node: HTMLElement | null, target?: ExecutionSelectionTarget, selectionIdentity?: string, stable = false) {
  if (node && target && selectionIdentity) textAnchors.set(key, { node, target: JSON.stringify(target), selectionIdentity, stable })
  else textAnchors.delete(key)
  window.dispatchEvent(new Event(anchorChanged))
}
function cardPosition(card: ElementCardView, node: HTMLElement | undefined, width: number, height: number) {
  const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight
  const rect = node?.isConnected ? node.getBoundingClientRect() : null
  const visible = Boolean(rect && getComputedStyle(node!).visibility !== 'hidden'
    && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight
    && rect.right > 0 && rect.left < viewportWidth)
  const left = visible ? rect!.left : card.anchor?.left ?? 24
  const below = visible ? rect!.bottom + 8 : card.anchor?.top ?? 24
  const top = visible && below + height > viewportHeight - 8 && rect!.top - height - 8 >= 8
    ? rect!.top - height - 8 : below
  let placedLeft = Math.max(8, Math.min(left, viewportWidth - width - 8))
  let placedTop = Math.max(8, Math.min(top, viewportHeight - height - 8))
  if (!visible) {
    // The old card remains available, but must not cover the new selection's AI button needed to rebind it.
    for (const bar of document.querySelectorAll<HTMLElement>('[data-selection-quick-bar]')) {
      if (getComputedStyle(bar).visibility === 'hidden') continue
      const box = bar.getBoundingClientRect()
      if (!(placedLeft < box.right && placedLeft + width > box.left && placedTop < box.bottom && placedTop + height > box.top)) continue
      if (box.bottom + 8 + height <= viewportHeight - 8) placedTop = box.bottom + 8
      else if (box.top - 8 - height >= 8) placedTop = box.top - 8 - height
      else if (box.right + 8 + width <= viewportWidth - 8) placedLeft = box.right + 8
      else if (box.left - 8 - width >= 8) placedLeft = box.left - 8 - width
    }
  }
  return { left: placedLeft, top: placedTop, detached: !visible }
}

/**
 * The quick bar's "AI 修改" for selected text in a Markdown document or a Flow page (M15): it opens a text card
 * under the bar. The card stays until it is closed, so follow-ups and undo keep working while the AI changes the
 * text; selecting text again later opens a new card.
 */
export function TextAiButton({ documentId, selectionIdentity, start, disabledReason }: {
  documentId: string; selectionIdentity: string; start(): Promise<TextCardStart>; disabledReason?: string | null
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const latestIdentity = useRef(selectionIdentity); latestIdentity.current = selectionIdentity
  const [error, setError] = useState('')
  useLayoutEffect(() => {
    const node = anchor.current
    for (const [key, linked] of textAnchors) if (linked.node === node && linked.selectionIdentity !== selectionIdentity) attachAnchor(key, null)
  }, [selectionIdentity])
  useEffect(() => {
    const node = anchor.current
    return () => {
      if (!node) return
      for (const [key, linked] of textAnchors) if (linked.node === node && !linked.stable) attachAnchor(key, null)
    }
  }, [])
  return <span ref={anchor} className="selection-quick-bar__anchor">
    <QuickBarButton label="AI 修改" text="AI 修改" icon={<Sparkles size={14} />} disabled={Boolean(disabledReason)} onClick={() => {
      setError('')
      const openingIdentity = selectionIdentity
      const requestedKey = rebindKey
      const selection = window.getSelection()
      const selectedNode = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null
      const selectedElement = selectedNode instanceof HTMLElement ? selectedNode : selectedNode?.parentElement
      const textAnchor = selectedElement?.closest<HTMLElement>('.ProseMirror p,.ProseMirror h1,.ProseMirror h2,[data-block-id],.cm-line') ?? selectedElement
      const rect = anchor.current?.getBoundingClientRect()
      void start().then(value => {
        if (latestIdentity.current !== openingIdentity) throw new Error('选区已变化，请重新选中文字再试。')
        const position = { left: rect?.left ?? 24, top: (rect?.bottom ?? 24) + 8 }
        const requested = rebindKey ? elementCards.view(rebindKey) : null
        let key: string
        if (requested?.kind === 'text') {
          elementCards.rebindText(requested.key, { documentId, ...value, anchor: position })
          key = requested.key
          setRebind(null)
        } else {
          if (rebindKey) setRebind(null)
          const same = elementCards.texts().find(card => card.documentId === documentId && card.textLost === null
            && JSON.stringify(card.target) === JSON.stringify(value.target))
          key = same?.key ?? elementCards.openText({ documentId, ...value, anchor: position })
        }
        attachAnchor(key, textAnchor ?? anchor.current, value.target, openingIdentity, Boolean(textAnchor))
      }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => { if (requestedKey && rebindKey === requestedKey) setRebind(null) })
    }} />
    {error && <span role="alert" className="selection-quick-bar__notice" title={error}>{error}</span>}
  </span>
}

function TextCardPanel({ card }: { card: ElementCardView }) {
  const holder = useRef<HTMLDivElement>(null)
  const pendingRebind = useSyncExternalStore(subscribeRebind, requestedRebind, () => null) === card.key
  const [position, setPosition] = useState(() => ({ left: card.anchor?.left ?? 24, top: card.anchor?.top ?? 24, detached: false }))
  useEffect(() => {
    let observed: HTMLElement | null = null
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    function update() {
      const linked = textAnchors.get(card.key)
      // A stale quick bar cannot stand in for text that the host has moved. The user can explicitly reselect it.
      const anchor = linked && (linked.stable || linked.target === JSON.stringify(card.target)) ? linked.node : null
      if (anchor !== observed) {
        if (observed) resize?.unobserve(observed)
        observed = anchor
        if (observed) resize?.observe(observed)
      }
      const box = holder.current?.getBoundingClientRect()
      const next = cardPosition(card, anchor ?? undefined, box?.width || 320, box?.height || 300)
      setPosition(current => current.left === next.left && current.top === next.top && current.detached === next.detached ? current : next)
    }
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    window.addEventListener(anchorChanged, update)
    if (holder.current) resize?.observe(holder.current)
    update()
    return () => {
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      window.removeEventListener(anchorChanged, update)
      resize?.disconnect()
    }
  }, [card.key, card.anchor?.left, card.anchor?.top, card.textLost, pendingRebind])
  useEffect(() => () => { attachAnchor(card.key, null); if (rebindKey === card.key) setRebind(null) }, [card.key])
  return <div ref={holder} className="element-text-card" style={{ left: position.left, top: position.top }} role="dialog" aria-label={`AI 修改：${card.label}`}>
    {(position.detached || card.textLost || pendingRebind) && <div className="element-text-card__binding" role="status">
      <span>{pendingRebind ? '请重新选中文字，再点选区旁的“AI 修改”；当前输入会保留。'
        : card.textLost ? '原文字已改变，请重新选择要修改的文字。'
          : '原选区暂不在视图中；滚回原位置可继续查看。'}</span>
      <button type="button" onClick={() => setRebind(pendingRebind ? null : card.key)}>
        {pendingRebind ? '取消重新选择' : '重新选择文字并保留输入'}
      </button>
    </div>}
    <ElementAiCard cardKey={card.key} onRebind={() => setRebind(card.key)}
      onClose={() => { void elementCards.closeText(card.key).catch(() => undefined) }} />
  </div>
}

/** Floats the open text cards over the workbench; closing one ends it. */
export function ElementTextCardLayer() {
  const cards = useTextCards()
  if (!cards.length) return null
  return createPortal(<>{cards.map(card => <TextCardPanel key={card.key} card={card} />)}</>, document.body)
}
