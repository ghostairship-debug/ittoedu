import { Sparkles } from 'lucide-react'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ExecutionFileContext, ExecutionFileReference } from '../../../shared/workbench/fileContext'
import type { FileArtifactBinding } from '../../../shared/workbench/mediaFiles'
import { QuickBarButton, SelectionQuickBar } from '../../editing/quickbar/SelectionQuickBar'
import { visibleBounds, type QuickBarBounds, type QuickBarRect } from '../../editing/quickbar/placeQuickBar'
import { usePointerGesture } from '../../editing/quickbar/usePointerGesture'
import { ElementAiCard } from '../../workbench/elementCards/ElementAiCard'
import { elementCards, useElementCard } from '../../workbench/elementCards/elementCardController'
import { focusPathKey, officeFocus } from '../../workbench/officeFocus'
import './officeSelectionTools.css'

export const OfficeSelectionHost = createContext<{ path: string; prepare(): Promise<boolean>; inputPending?: boolean; closing?: boolean; toolbarTrailing?: ReactNode } | null>(null)

export interface OfficeSelection {
  scope: 'page' | 'object' | 'range' | 'paragraph'
  focus: NonNullable<ExecutionFileReference['focus']>
  label: string
  text?: string
  readText?(): string | undefined
  editScope?: NonNullable<ExecutionFileContext['officeCard']>['selection']
  readEditVersion?(): number
  validatePrepared?(binding: FileArtifactBinding): void
}

function useSelectionPlace(active: boolean, view: () => HTMLElement | null, measure: () => QuickBarRect | null, identity: string) {
  const latest = useRef({ view, measure }); latest.current = { view, measure }
  const [place, setPlace] = useState<{ identity: string; anchor: QuickBarRect; bounds: QuickBarBounds } | null>(null)
  useLayoutEffect(() => {
    if (!active) { setPlace(null); return }
    let frame = 0
    function update() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const root = latest.current.view(), anchor = latest.current.measure()
        const bounds = root && visibleBounds(root)
        const next = bounds && anchor && anchor.left + anchor.width >= bounds.left && anchor.left <= bounds.right
          && anchor.top + anchor.height >= bounds.top && anchor.top <= bounds.bottom ? { identity, anchor, bounds } : null
        setPlace(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      })
    }
    const root = latest.current.view()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (root) resize?.observe(root)
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => { cancelAnimationFrame(frame); resize?.disconnect(); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [active, identity])
  // A new selection must never borrow the preceding selection's anchor while
  // its own client rectangle is waiting for the next animation frame.
  return active && place?.identity === identity ? place : null
}

/** Keeps a card bound to its opening selection while the canvas moves or focus enters its input. */
export function OfficeSelectionTools({ active, selection, selectionKey, measure, viewport, children, suspended = false, aboveOffset }: {
  active: boolean
  selection: OfficeSelection | null
  selectionKey: string
  measure(): QuickBarRect | null
  viewport(): HTMLElement | null
  suspended?: boolean
  aboveOffset?: number
  children?: ReactNode
}) {
  const host = useContext(OfficeSelectionHost)
  const latestHost = useRef(host); latestHost.current = host
  const visible = active && !host?.closing
  const place = useSelectionPlace(visible, viewport, measure, selectionKey)
  const pointerGesture = usePointerGesture(visible ? viewport() : null)
  const [opening, setOpening] = useState<{ key: string; anchor: QuickBarRect; previousFocus: HTMLElement | null; canRestrict: boolean } | null>(null)
  const opened = useRef(opening); opened.current = opening
  const card = useElementCard(opening?.key ?? null)
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => {
    const current = opened.current
    if (current) void elementCards.closeTransient(current.key).catch(() => undefined)
  }, [])
  const close = () => {
    if (!opening) return
    void elementCards.closeTransient(opening.key).then(() => {
      setOpening(null)
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && opening.previousFocus?.isConnected) opening.previousFocus.focus({ preventScroll: true })
      })
    }, () => undefined)
  }
  const open = (target: OfficeSelection, anchor: QuickBarRect) => {
    if (!host || opened.current) return
    const { path, prepare, inputPending } = host
    const lookup = () => officeFocus.capture().find(file => focusPathKey(file.path) === focusPathKey(path))
    const sameBinding = (left: ReturnType<typeof lookup>, right: ReturnType<typeof lookup>) =>
      !!left && !!right && left.bindingVersion === right.bindingVersion && left.fileVersion === right.fileVersion
    let binding = lookup()
    let mayDrainInput = inputPending
    const revision = target.readEditVersion?.()
    const focus = structuredClone(target.focus), selectedText = target.text ?? target.readText?.()
    let canRestrict = Boolean(target.editScope)
    if (canRestrict && !inputPending && binding?.fileVersion && binding.bindingVersion !== undefined) {
      try { target.validatePrepared?.({ path, fileVersion: binding.fileVersion, bindingVersion: binding.bindingVersion }) }
      catch { canRestrict = false }
    }
    const isCurrent = () => sameBinding(lookup(), binding) && target.readEditVersion?.() === revision
    const key = elementCards.openOffice(target.label, async restricted => {
      const wasCurrent = isCurrent(), before = target.readEditVersion?.()
      if (restricted && (!target.editScope || !wasCurrent)) throw new Error('精确选区已变化或无法定位。请重新选择，或取消仅修改此选区。')
      if (!await prepare()) throw new Error('当前文档的草稿尚未同步，请处理编辑区提示后重试。')
      if (target.readEditVersion?.() !== before) throw new Error('同步草稿期间内容已更改，请完成输入后重试。')
      const prepared = lookup()
      if (!prepared?.fileVersion?.startsWith('office-draft:') || prepared.bindingVersion === undefined) throw new Error('原文档已关闭或草稿版本尚未就绪。')
      const { fileVersion, bindingVersion } = prepared
      let selection = wasCurrent && (mayDrainInput || sameBinding(prepared, binding)) ? target.editScope : undefined
      if (selection) {
        binding = prepared
        mayDrainInput = false
        try { target.validatePrepared?.({ path, fileVersion, bindingVersion }) }
        catch (error) { if (restricted) throw error; selection = undefined }
      }
      if (restricted && !selection) throw new Error('精确选区已变化或无法定位。请重新选择，或取消仅修改此选区。')
      const reference: ExecutionFileReference = { path, scope: target.scope, focus, pinned: true, fileVersion, bindingVersion }
      const { active: _active, focus: _focus, ...file } = prepared
      return {
        fileContext: { openFiles: [{ ...file, active: true, focus }], references: [reference],
          officeCard: { path, fileVersion, bindingVersion, selection, restrictToSelection: restricted } },
        selectionInstruction: [
          !wasCurrent ? '打开卡片后文档已有更新，请核对原选区现在的位置和内容。' : '',
          selectedText ? `打开卡片时选中的原文（文档数据）：${JSON.stringify(selectedText)}` : '',
        ].filter(Boolean).join('\n'),
      }
    }, async () => {
      if (latestHost.current?.inputPending && !await prepare())
        throw new Error('当前手动输入尚未同步，请完成输入后再确认。')
    })
    const next = { key, anchor, previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null, canRestrict }
    opened.current = next
    setOpening(next)
  }
  const [cardPlace, setCardPlace] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!opening || !visible || !cardRef.current) return
    const node = cardRef.current
    const update = () => {
      const anchor = opening.anchor, width = node.offsetWidth, height = node.offsetHeight
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
      const below = anchor.top + anchor.height + 8
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, Math.min(anchor.top - height - 8, window.innerHeight - height - 8))
      setCardPlace(previous => previous.left === left && previous.top === top ? previous : { left, top })
    }
    update()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(node); window.addEventListener('resize', update)
    return () => { resize?.disconnect(); window.removeEventListener('resize', update) }
  }, [opening, visible])
  return <>
    {visible && <SelectionQuickBar label="选中内容快捷工具" anchor={place?.anchor ?? null} bounds={place?.bounds ?? null}
      selectionKey={selectionKey} aboveOffset={aboveOffset} suspended={suspended || pointerGesture || Boolean(opening)}>
      {selection && host && place && <QuickBarButton label="AI 修改" text="AI 修改" icon={<Sparkles size={14} />}
        onClick={() => open(selection, place.anchor)} />}
      {children}
    </SelectionQuickBar>}
    {visible && opening && card && createPortal(
      <div ref={cardRef} className="element-text-card office-selection-card" style={cardPlace} role="dialog" aria-label={`AI 修改：${card.label}`}
        onKeyDownCapture={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing && !card.busy) { event.preventDefault(); event.stopPropagation(); close() }
        }}>
        <ElementAiCard cardKey={card.key} onClose={close} canRestrict={opening.canRestrict} />
      </div>, document.body)}
  </>
}
