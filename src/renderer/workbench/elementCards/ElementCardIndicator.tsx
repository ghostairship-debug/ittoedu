import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { elementCards, useActiveElementCards, type ElementCardView } from './elementCardController'
import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import { readTarget } from '../../../core/tools/ToolTargets'
import { captureSelection, workbenchSelection } from '../SelectionContextController'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { componentSurface } from '../../../shared/contracts/component-platform/project'
import { resolveCourseProjectDiagnosticTargetRoute, selectCourseProjectDiagnosticRoute } from '../../diagnostics/projectHealthNavigation'
import { selectElementCardField } from './elementCardSelection'
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
      const { documentId, label, key, epoch } = card
      const target = structuredClone(card.target)
      if (target.kind !== 'course-instance') return
      void (async () => {
        await (activateDocument ? activateDocument(documentId) : kernel.bridge.activate(documentId))
        const snapshot = drainDocument ? await drainDocument(documentId) : (await kernel.bridge.drain([documentId]))[0]
        if (!snapshot) throw new Error('原文档已关闭')
        if (epoch && snapshot.epoch !== epoch) throw new Error('这份作品已经重新打开，请重新定位当前内容。')
        const selected = captureSelection(snapshot, [target], label)
        if (snapshot.model.kind !== 'course-v10') throw new Error('原文档类型已改变')
        const project = snapshot.model.project
        const route = resolveCourseProjectDiagnosticTargetRoute(project, { projectId: project.id, kind: 'instance', instanceId: target.instanceId })
        if (!route.available) throw new Error(route.reason)
        const addressedRoot = project.rootIds.includes(target.surfaceId) ? target.surfaceId : undefined
        const scopedRoute = route.scope === 'global' && addressedRoot ? { ...route, rootInstanceId: addressedRoot } : route
        const precise = Boolean(target.authorField || target.dataPath || target.from !== undefined || target.to !== undefined)
        // The shared route uses current ownership, while every operation stays with
        // this card's document if the foreground tab changes during the input ACK.
        selectCourseProjectDiagnosticRoute({ ...kernel, readView: () => {
          const live = kernel.readView(), original = live.views.find(view => view.documentId === documentId)
          return { ...live, activeDocumentId: documentId, rootInstanceId: original?.rootInstanceId ?? null }
        } }, precise ? { ...scopedRoute, instanceId: undefined } : scopedRoute)
        if (componentSurface(project, target.surfaceId)) kernel.bridge.selectPresentationState(documentId, target.stateId ?? null, target.surfaceId)
        selectElementCardField(kernel.bridge, snapshot, target)
        workbenchSelection.setManual(documentId, selected)
        const manual = workbenchSelection.getManual(documentId), interaction = kernel.readView().interactionSelection
        elementCards.requestOpen(key)
        requestAnimationFrame(() => {
          if (kernel.readView().activeDocumentId !== documentId) return
          if (target.from !== undefined || target.to !== undefined) {
            if (workbenchSelection.getManual(documentId) !== manual || kernel.readView().interactionSelection !== interaction) return
            try { workbenchSelection.targetView(documentId)?.select(target) }
            catch (error) { reportError?.(error instanceof Error ? error.message : '原文字范围暂不可定位') }
          }
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
