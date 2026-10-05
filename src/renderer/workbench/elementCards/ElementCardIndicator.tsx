import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { elementCards, useActiveElementCards, type ElementCardView } from './elementCardController'
import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import { readTarget } from '../../../core/tools/ToolTargets'
import { captureSelection, workbenchSelection } from '../SelectionContextController'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import './elementCards.css'

/** How the editor finds a card's element: whether it is still there, and how to bring it into view. */
export interface ElementCardNavigation {
  exists(card: ElementCardView): boolean
  jump(card: ElementCardView): void
}

/** Jump uses the existing Bridge selection holder and the card's original document. */
export function createComponentElementCardNavigation({ kernel, activateDocument, drainDocument, reportError }: {
  kernel: Pick<EditorStoreKernel, 'readView' | 'bridge' | 'selectSurface' | 'selectInstances'>
  activateDocument?(documentId: string): Promise<unknown>
  drainDocument?(documentId: string): Promise<DocumentSnapshot>
  reportError?(message: string): void
}): ElementCardNavigation {
  return {
    exists(card) {
      const model = kernel.readView().views.find(view => view.documentId === card.documentId)?.model
      if (!model || card.target.kind !== 'course-instance') return false
      try { readTarget(model, card.target); return true } catch { return false }
    },
    jump(card) {
      const target = structuredClone(card.target)
      if (target.kind !== 'course-instance') return
      void (async () => {
        await (activateDocument ? activateDocument(card.documentId) : kernel.bridge.activate(card.documentId))
        const snapshot = drainDocument ? await drainDocument(card.documentId) : (await kernel.bridge.drain([card.documentId]))[0]
        if (!snapshot) throw new Error('原文档已关闭')
        const selected = captureSelection(snapshot, [target], card.label)
        kernel.selectSurface(target.surfaceId, card.documentId)
        kernel.bridge.selectPresentationState(card.documentId, target.stateId ?? null, target.surfaceId)
        kernel.selectInstances([target.instanceId], target.surfaceId, card.documentId)
        workbenchSelection.setManual(card.documentId, selected)
        elementCards.requestOpen(card.key)
        requestAnimationFrame(() => {
          const element = [...document.querySelectorAll<HTMLElement>('[data-component-instance],[data-block-id]')]
            .find(node => node.dataset.componentInstance === target.instanceId || node.dataset.blockId === target.instanceId)
          element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
        })
      })().catch(error => reportError?.(error instanceof Error ? error.message : String(error)))
    },
  }
}

/**
 * The top bar's small "AI 进行中 / 需回答" indicator (M15): the document's element cards that are working or waiting
 * for the teacher. Choosing one jumps to its element and opens its card. Nothing is shown while no card is active;
 * the card of a deleted element is hidden until an undo brings the element back.
 */
export function ElementCardIndicator({ documentId, navigation }: { documentId: string | null; navigation: ElementCardNavigation }) {
  const cards = useActiveElementCards().filter(card => card.documentId === documentId && navigation.exists(card))
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => { if (!cards.length) setOpen(false) }, [cards.length])
  if (!cards.length) return null
  const waiting = cards.filter(card => card.question || card.approval).length
  const label = waiting ? `AI 需回答 ${waiting}` : `AI 进行中 ${cards.length}`
  return <div ref={root} className="element-card-indicator">
    <button type="button" className="element-card-indicator__button" data-waiting={waiting > 0 || undefined} aria-haspopup="menu" aria-expanded={open}
      title="正在处理或等你回答的元素 AI 卡" onClick={() => setOpen(value => !value)}>
      <Sparkles size={13} aria-hidden="true" />{label}
    </button>
    {open && <div className="element-card-indicator__menu" role="menu" aria-label="元素 AI 卡">
      {cards.map(card => {
        const state = card.question || card.approval ? '需回答' : '进行中'
        return <button key={card.key} type="button" role="menuitem" aria-label={`${card.label}：${state}`} onClick={() => { setOpen(false); navigation.jump(card) }}>
          <span>{card.label}</span><small>{state}</small>
        </button>
      })}
    </div>}
  </div>
}
