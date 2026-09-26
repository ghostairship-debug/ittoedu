import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import './commandMenu.css'

/**
 * One operation, defined once and shown the same way in a right-click menu, a "⋯" menu and a toolbar dropdown,
 * in the workbench and the editor alike (M21).
 */
export interface MenuCommand {
  id: string
  label: string
  run(): void
  /** Items of one group are drawn together; a new group starts a new section. */
  group?: string
  danger?: boolean
  shortcut?: string
  /** Set when the command cannot run now: it stays in the list, disabled, and says why. */
  disabledReason?: string | null
}

/** Where a menu opens; `above` puts its bottom edge at `y` (for controls at the bottom of the window). */
export interface MenuPoint { x: number; y: number; above?: boolean }

const MENU_ITEM = '[role="menuitem"]'

/** The item list shared by context menus and "⋯" popovers. Unavailable items keep their place and show why. */
export function CommandMenuItems({ items, onRun }: { items: readonly MenuCommand[]; onRun(command: MenuCommand): void }) {
  return <>{items.map((item, index) => {
    const disabled = Boolean(item.disabledReason)
    const newGroup = index > 0 && item.group !== items[index - 1]!.group
    return <button key={item.id} type="button" role="menuitem" data-command-id={item.id}
      className={`command-menu__item${item.danger ? ' command-menu__item--danger' : ''}${newGroup ? ' command-menu__item--group' : ''}`}
      aria-label={item.label} aria-keyshortcuts={item.shortcut} aria-disabled={disabled || undefined}
      aria-description={item.disabledReason ?? undefined} title={item.disabledReason ?? undefined}
      // Keep the canvas and text selection the command acts on.
      onMouseDown={event => event.preventDefault()}
      onClick={() => { if (!disabled) onRun(item) }}>
      <span className="command-menu__label">{item.label}</span>
      {item.shortcut && <kbd className="command-menu__shortcut">{item.shortcut}</kbd>}
      {disabled && <small className="command-menu__reason">{item.disabledReason}</small>}
    </button>
  })}</>
}

/** Arrow keys, Home and End move between the items of a menu. */
export function moveMenuFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM)]
  if (!items.length) return
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
  items[next]!.focus({ preventScroll: true })
}

/** A right-click menu at the pointer, kept inside the window; outside press, Escape, blur or resize close it. */
export function ContextMenu({ at, label, items, onClose }: { at: MenuPoint; label: string; items: readonly MenuCommand[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(at)
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    const top = at.above ? at.y - height : at.y
    setPosition({ x: Math.max(4, Math.min(at.x, window.innerWidth - width - 4)), y: Math.max(4, Math.min(top, window.innerHeight - height - 4)) })
    menu.querySelector<HTMLElement>(`${MENU_ITEM}:not([aria-disabled="true"])`)?.focus({ preventScroll: true })
  }, [at.x, at.y, at.above])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Node && ref.current?.contains(event.target))) onClose() }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); onClose()
    }
    const dismiss = () => onClose()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [onClose])
  return createPortal(<div ref={ref} className="command-menu command-menu--context" role="menu" aria-label={label}
    style={{ left: position.x, top: position.y }} onKeyDown={moveMenuFocus}
    onContextMenu={event => event.preventDefault()} onPointerDown={event => event.stopPropagation()}>
    <CommandMenuItems items={items} onRun={item => { onClose(); item.run() }} />
  </div>, document.body)
}

/** State for one right-click menu per owner: `open` shows it at a point, `element` renders it. */
export function useContextMenu() {
  const [state, setState] = useState<{ at: MenuPoint; label: string; items: readonly MenuCommand[] } | null>(null)
  const close = useCallback(() => setState(null), [])
  const open = useCallback((at: MenuPoint, label: string, items: readonly MenuCommand[]) => {
    setState(items.length ? { at, label, items } : null)
  }, [])
  const element = state ? <ContextMenu at={state.at} label={state.label} items={state.items} onClose={close} /> : null
  return { open, close, element, isOpen: state !== null }
}
