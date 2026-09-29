import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, Sparkles } from 'lucide-react'
import { ColorSwatchPanel, type ColorSwatchVariant } from '../color/ColorSwatchPanel'
import { CommandMenuItems, moveMenuFocus, type MenuCommand } from '../commands/CommandMenu'
import { placeQuickBar, type QuickBarBounds, type QuickBarRect } from './placeQuickBar'
import './quickBar.css'

interface QuickBarState {
  open: string | null
  setOpen(id: string | null): void
  /** Popovers open away from the selection when there is room. */
  direction: 'up' | 'down'
  maxHeight: number
}
const QuickBarContext = createContext<QuickBarState>({ open: null, setOpen: () => {}, direction: 'down', maxHeight: 320 })

const stop = (event: SyntheticEvent) => event.stopPropagation()
/** Keep the document's text selection and the canvas selection while the bar is used. */
const keepSelection = (event: SyntheticEvent) => event.preventDefault()

export interface SelectionQuickBarProps {
  /** Client rectangle of the selection (for several objects, their union). */
  anchor: QuickBarRect | null
  /** Visible client area the bar stays inside. */
  bounds: QuickBarBounds | null
  label: string
  /** Hidden while the selection is dragged or resized, or another toolbar owns it. */
  suspended?: boolean
  /** A different selection closes open popovers. */
  selectionKey?: string
  /** Distance kept above the selection, e.g. to leave a rotation handle reachable. */
  aboveOffset?: number
  children: ReactNode
}

/**
 * The floating toolbar shared by every selection: same look as the text editing toolbar, fixed to the viewport
 * next to the selection, never part of layout. Pointer, mouse, touch and key events stop here so the canvas under
 * it does not select, drag or delete anything.
 */
export function SelectionQuickBar({ anchor, bounds, label, suspended = false, selectionKey, aboveOffset, children }: SelectionQuickBarProps) {
  const [open, setOpen] = useState<string | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  useEffect(() => { setOpen(null) }, [selectionKey])
  useEffect(() => { if (suspended) setOpen(null) }, [suspended])
  const measureRow = useCallback((row: HTMLDivElement | null) => {
    observer.current?.disconnect(); observer.current = null
    if (!row) return
    const measure = () => {
      const next = { width: row.offsetWidth, height: row.offsetHeight }
      setSize(previous => previous && previous.width === next.width && previous.height === next.height ? previous : next)
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') { observer.current = new ResizeObserver(measure); observer.current.observe(row) }
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && container.current?.contains(event.target)) return
      setOpen(null)
    }
    // Buttons keep focus on the selection's owner, so Escape arrives at the document rather than the bar.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault(); event.stopPropagation()
      setOpen(null)
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open])
  if (!anchor || !bounds) return null
  const measured = size ?? { width: 0, height: 34 }
  const position = placeQuickBar(anchor, bounds, measured, 8, aboveOffset)
  // Popovers may leave the selection's editor; only the window limits them.
  const spaceAbove = position.top - 8, spaceBelow = window.innerHeight - position.top - measured.height - 8
  const direction = spaceBelow >= spaceAbove ? 'down' : 'up'
  const maxHeight = Math.max(0, (direction === 'up' ? spaceAbove : spaceBelow) - 8)
  const hidden = suspended || !size
  return createPortal(<QuickBarContext.Provider value={{ open, setOpen, direction, maxHeight }}>
    <div ref={container} className="selection-quick-bar" data-selection-quick-bar="true" data-placement={position.placement}
      data-suspended={suspended || undefined} style={{ left: position.left, top: position.top, visibility: hidden ? 'hidden' : undefined, pointerEvents: hidden ? 'none' : undefined }}
      onPointerDown={stop} onMouseDown={stop} onMouseUp={stop} onClick={stop} onDoubleClick={stop}
      onTouchStart={stop} onTouchEnd={stop} onTouchCancel={stop} onContextMenu={stop} onWheel={stop}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(null) } }}>
      <div ref={measureRow} className="selection-quick-bar__row" role="toolbar" aria-label={label}>{children}</div>
    </div>
  </QuickBarContext.Provider>, document.body)
}

export interface QuickBarButtonProps {
  label: string
  icon?: ReactNode
  /** Visible text next to the icon; icon-only buttons still carry `label` for assistive technology. */
  text?: string
  pressed?: boolean
  disabled?: boolean
  danger?: boolean
  onClick(): void
}
export function QuickBarButton({ label, icon, text, pressed, disabled, danger, onClick }: QuickBarButtonProps) {
  return <button type="button" className={`selection-quick-bar__button${text ? ' selection-quick-bar__button--text' : ''}${danger ? ' selection-quick-bar__button--danger' : ''}`}
    aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onMouseDown={keepSelection} onClick={onClick}>
    {icon}{text && <span>{text}</span>}
  </button>
}

export function QuickBarSeparator() { return <span className="selection-quick-bar__separator" aria-hidden="true" /> }

export function QuickBarLabel({ children }: { children: ReactNode }) { return <span className="selection-quick-bar__label">{children}</span> }

export interface QuickBarPopoverButtonProps extends Omit<QuickBarButtonProps, 'onClick' | 'pressed'> {
  /** Popover content; `close` returns focus to the selection's owner. */
  children(close: () => void): ReactNode
  popoverLabel?: string
  popupRole?: 'dialog' | 'menu'
  /** Opens the popover each time this grows (a jump to the element asked for its card, M15). */
  openToken?: number
}
export function QuickBarPopoverButton({ children, popoverLabel, popupRole = 'dialog', openToken, ...button }: QuickBarPopoverButtonProps) {
  const id = useId()
  const { open, setOpen, direction, maxHeight } = useContext(QuickBarContext)
  const expanded = open === id
  const close = () => setOpen(null)
  useEffect(() => { if (openToken) setOpen(id) }, [openToken])
  return <span className="selection-quick-bar__anchor">
    <button type="button" className={`selection-quick-bar__button${button.text ? ' selection-quick-bar__button--text' : ''}`}
      aria-label={button.label} title={button.label} aria-expanded={expanded} aria-haspopup={popupRole} disabled={button.disabled}
      onMouseDown={keepSelection} onClick={() => setOpen(expanded ? null : id)}>
      {button.icon}{button.text && <span>{button.text}</span>}
    </button>
    {expanded && <div className={`selection-quick-bar__popover selection-quick-bar__popover--${direction}`} role={popupRole === 'menu' ? undefined : 'dialog'} aria-label={popupRole === 'menu' ? undefined : popoverLabel ?? button.label} style={{ maxHeight, '--element-ai-card-max-height': `${maxHeight}px` } as CSSProperties}>
      {children(close)}
    </div>}
  </span>
}

export interface QuickBarColorButtonProps {
  label: string
  icon: ReactNode
  value?: string | null
  variant?: ColorSwatchVariant
  disabled?: boolean
  onPick(color: string | null): void
}
/** Colour and highlight entries: a palette first, a continuous picker only behind "更多颜色". */
export function QuickBarColorButton({ label, icon, value, variant = 'color', disabled, onPick }: QuickBarColorButtonProps) {
  return <QuickBarPopoverButton label={label} disabled={disabled} icon={<span className="selection-quick-bar__color-icon">
    {icon}<span className="selection-quick-bar__color-bar" style={{ background: value ?? 'transparent' }} /></span>}>
    {close => <ColorSwatchPanel label={label} value={value} variant={variant} onPick={color => { onPick(color); close() }} />}
  </QuickBarPopoverButton>
}

/** The bar's "⋯": the same command items, names and behaviour as the right-click menu of the selection (M21). */
export function QuickBarMenu({ label = '更多操作', items }: { label?: string; items: readonly MenuCommand[] }) {
  if (!items.length) return null
  return <QuickBarPopoverButton label={label} icon={<MoreHorizontal size={15} />} popoverLabel={label} popupRole="menu">
    {close => <div className="command-menu" role="menu" aria-label={label} onKeyDown={moveMenuFocus}>
      <CommandMenuItems items={items} onRun={item => { close(); item.run() }} />
    </div>}
  </QuickBarPopoverButton>
}

export interface QuickBarAiButtonProps {
  /** Short description of what the instruction applies to, e.g. "所选文字". */
  targetLabel: string
  disabledReason?: string | null
  /** Resolves when the request was handed over; a rejection keeps the draft and shows the reason. */
  onSubmit(instruction: string): Promise<void>
  /** Controlled draft, for owners that keep the target while a draft exists. */
  instruction?: string
  onInstructionChange?(value: string): void
  /** Extra actions under the input, such as moving a stale draft to the current selection. */
  footer?: ReactNode
  /** Discard the draft and release its target. */
  onCancel?(): void
}
/** Fixed "AI 修改" entry of every quick bar. M15 replaces the popover with the element AI card. */
export function QuickBarAiButton(props: QuickBarAiButtonProps) {
  return <QuickBarPopoverButton label="AI 修改" text="AI 修改" icon={<Sparkles size={14} />} popoverLabel={`AI 修改${props.targetLabel}`}>
    {close => <QuickBarAiForm {...props} onSubmit={async instruction => { await props.onSubmit(instruction); close() }} onCancel={props.onCancel ? () => { props.onCancel!(); close() } : undefined} />}
  </QuickBarPopoverButton>
}

function QuickBarAiForm({ targetLabel, disabledReason, onSubmit, instruction: controlled, onInstructionChange, footer, onCancel }: QuickBarAiButtonProps) {
  const [local, setLocal] = useState('')
  const instruction = controlled ?? local
  const setInstruction = onInstructionChange ?? setLocal
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  const send = async () => {
    const text = instruction.trim()
    if (!text || sending || disabledReason) return
    setSending(true); setError('')
    try { await onSubmit(text); if (controlled === undefined) setLocal('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSending(false) }
  }
  return <form className="selection-quick-bar__ai" onSubmit={event => { event.preventDefault(); void send() }}>
    <span className="selection-quick-bar__ai-target">修改：{targetLabel}</span>
    <textarea ref={input} aria-label="AI 修改要求" value={instruction} placeholder="告诉 AI 怎么改" rows={3}
      onChange={event => setInstruction(event.target.value)}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
        event.preventDefault(); void send()
      }} />
    {disabledReason && <p role="status">{disabledReason}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="selection-quick-bar__ai-actions">
      {footer}
      {onCancel && <button type="button" onClick={onCancel}>取消</button>}
      <button type="submit" disabled={!instruction.trim() || sending || Boolean(disabledReason)}>{sending ? '发送中…' : '发送'}</button>
    </div>
  </form>
}
