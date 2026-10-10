import { Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { QuickBarButton } from '../../editing/quickbar/SelectionQuickBar'
import type { ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import type { ExecutionSendInput } from '../../../shared/workbench/executionDesktop'
import { captureSelection, workbenchSelection, type SelectionCapture } from '../SelectionContextController'
import { useEditorStore } from '../../store/editorStore'
import { ElementAiCard } from './ElementAiCard'
import { elementCards, useVisibleCards, type ElementCardView } from './elementCardController'
import './elementCards.css'

/** What a text card starts from: the selected range, a name for it, and what the range holds now. */
export interface TextCardStart { target: ExecutionSelectionTarget; capture: SelectionCapture;
  contentOutput?: ExecutionSendInput['contentOutput']; label: string; content: string | null }

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
function locateTarget(card: ElementCardView): { node: HTMLElement | null; rect: DOMRect | null } {
  const target = card.target, registered = workbenchSelection.targetView(card.documentId)
  const measured = registered?.rect(target)
  if (measured) return { node: registered!.root(), rect: measured }
  const id = target.kind === 'course-instance' ? target.instanceId : target.kind === 'course-object' ? target.itemId
    : target.kind === 'flow-block' || target.kind === 'flow-range' ? target.blockId : null
  const node = id ? [...document.querySelectorAll<HTMLElement>('[data-component-instance],[data-layer-item-id],[data-flow-block-id],[data-block-id]')]
    .find(node => node.dataset.componentInstance === id || node.dataset.layerItemId === id || node.dataset.flowBlockId === id || node.dataset.blockId === id) ?? null : null
  if (node) return { node, rect: node.getBoundingClientRect() }
  const linked = textAnchors.get(card.key)
  return { node: linked?.node ?? null, rect: linked?.node.isConnected ? linked.node.getBoundingClientRect() : null }
}
export function cardPosition(card: ElementCardView, node: HTMLElement | null, rect: DOMRect | null, width: number, height: number) {
  const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight
  let clip = { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight }
  let hidden = false
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    if (style.display === 'none' || style.visibility === 'hidden') hidden = true
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
      const box = ancestor.getBoundingClientRect()
      clip = { left: Math.max(clip.left, box.left), top: Math.max(clip.top, box.top), right: Math.min(clip.right, box.right), bottom: Math.min(clip.bottom, box.bottom) }
    }
  }
  const visible = Boolean(rect && node?.isConnected && !hidden && rect.width > 0 && rect.height > 0
    && rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right)
  if (!visible || !rect) return null
  const below = rect.bottom + 8
  const top = below + height > viewportHeight - 8 && rect.top - height - 8 >= 8 ? rect.top - height - 8 : below
  return { left: Math.max(8, Math.min(rect.left, viewportWidth - width - 8)), top: Math.max(8, Math.min(top, viewportHeight - height - 8)),
    target: { left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top), width: Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left), height: Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top) } }
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
            && elementCards.matchesTextCapture(card.key, value.capture))
          key = same?.key ?? elementCards.openText({ documentId, ...value, anchor: position })
          if (same) elementCards.revealText(key, position)
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
  const [position, setPosition] = useState<ReturnType<typeof cardPosition>>(null)
  const [selectionError, setSelectionError] = useState('')
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.composedPath().includes(holder.current!) || (event.target as HTMLElement)?.closest?.('.element-text-card,.selection-quick-bar')) return
      // Only cancelling a selection in the original editor ends idle interaction; navigation merely hides it.
      const owner = locateTarget(card).node?.closest('.workspace,.document-editor,.ProseMirror,.cm-editor')
      if (owner?.contains(event.target as Node)) elementCards.dismiss(card.key)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [card.key, card.target])
  useEffect(() => {
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    let observed: HTMLElement | null = null
    function update() {
      const target = locateTarget(card)
      if (target.node !== observed) { if (observed) resize?.unobserve(observed); observed = target.node; if (observed) resize?.observe(observed) }
      const box = holder.current?.getBoundingClientRect()
      const next = cardPosition(card, target.node, target.rect, box?.width || 320, box?.height || 300)
      setPosition(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }
    const observer = new MutationObserver(update); observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('scroll', update, true); window.addEventListener('resize', update); window.addEventListener(anchorChanged, update)
    update()
    return () => { observer.disconnect(); resize?.disconnect(); document.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); window.removeEventListener(anchorChanged, update) }
  }, [card.key, JSON.stringify(card.target), card.textLost, pendingRebind])
  const completed = card.entries.some(entry => ['completed', 'partial'].includes(entry.state))
  const selectResult = () => {
    try { if (workbenchSelection.targetView(card.documentId)?.select(card.target)) return } catch (error) { setSelectionError(error instanceof Error ? error.message : '结果暂不可定位，请重新选择。'); return }
    setSelectionError('')
    void workbenchSelection.prepare(card.documentId).then(snapshot => {
      if (card.epoch && snapshot.epoch !== card.epoch) throw new Error('这份作品已经重新打开，请重新定位当前内容。')
      const selected = captureSelection(snapshot, [card.target], card.label)
      if (card.target.kind === 'course-instance') useEditorStore.getState().selectNodes([card.target.instanceId])
      else if (card.target.kind === 'course-object') useEditorStore.getState().selectNodes([card.target.itemId])
      workbenchSelection.setManual(card.documentId, selected)
    }).catch(error => setSelectionError(error instanceof Error ? error.message : '结果暂不可定位，请重新选择。'))
  }
  if (card.dismissed) return position ? <button type="button" className="element-card-result-select" style={{ left: position.target.left, top: position.target.top }}
    aria-label={`恢复 AI 草稿：${card.label}`} title={card.draft} onClick={() => elementCards.reveal(card.key)}>AI 草稿</button> : null
  return <>
    {completed && position && <>
      <span className="element-card-result-highlight" aria-hidden="true" style={position.target} />
      <button type="button" className="element-card-result-select" aria-label={`选中 AI 修改结果：${card.label}`} style={{ left: position.target.left, top: position.target.top }} onClick={selectResult}>AI</button>
    </>}
    <div ref={holder} className="element-text-card" style={{ display: position ? undefined : 'none', left: position?.left ?? 0, top: position?.top ?? 0 }} role="dialog" aria-label={`AI 修改：${card.label}`}>{selectionError && <p role="alert">{selectionError}</p>}
      {card.textLost && <div className="element-text-card__binding" role="status">原文字已改变，请重新选择要修改的文字。</div>}
      <ElementAiCard cardKey={card.key} capture={card.kind === 'element' ? () => elementCards.captureCurrent(card.key) : undefined}
        onRebind={card.kind === 'text' ? () => setRebind(card.key) : undefined}
        onClose={() => { if (card.kind === 'text') void elementCards.closeText(card.key).catch(() => undefined); else elementCards.dismiss(card.key) }} />
    </div>
  </>
}

/** Floats visible text cards; folded unsent cards remain in their original lifetime. */
export function ElementTextCardLayer() {
  const cards = useVisibleCards()
  return createPortal(<>{cards.map(card => <TextCardPanel key={card.key} card={card} />)}</>, document.body)
}
