import { ChevronDown, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { CourseEditorDropdownAction, CourseEditorLayoutResult } from '../course/courseEditorLayout'
import { CommandMenuItems, moveMenuFocus } from '../editing/commands/CommandMenu'
import { newPageCommands } from '../editing/commands/pageCommands'

export interface AddCourseContentMenuProps {
  layout: CourseEditorLayoutResult
  onPrimary(): void
  onAddSlidePage?(): void
  onAddFlowPage?(): void
  onAddSpatialPage?(): void
}

export function AddCourseContentMenu({ layout, onPrimary, onAddSlidePage, onAddFlowPage, onAddSpatialPage }: AddCourseContentMenuProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const primaryKind = layout.primary.action === 'scene' ? 'slide-page' : layout.primary.action
  const handlers: Record<CourseEditorDropdownAction, (() => void) | undefined> = {
    'slide-page': primaryKind === 'slide-page' ? onPrimary : onAddSlidePage,
    'flow-page': primaryKind === 'flow-page' ? onPrimary : onAddFlowPage,
    'spatial-page': primaryKind === 'spatial-page' ? onPrimary : onAddSpatialPage,
  }
  const items = newPageCommands(kind => handlers[kind]?.())

  useEffect(() => {
    if (!open || !panelRef.current) return
    const panel = panelRef.current
    const rect = panel.getBoundingClientRect()
    const viewportPadding = 8
    const overflowBottom = rect.bottom > window.innerHeight - viewportPadding
    const overflowTop = rect.top < viewportPadding
    setPlacement(overflowBottom && !overflowTop ? 'top' : 'bottom')
    panel.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return <div ref={rootRef} className="add-content-menu__cluster">
    <div className="add-content-menu" data-testid="add-content-menu">
      <button type="button" className="secondary-button add-content-menu__toggle" data-testid="add-content-primary"
        aria-label="新建页面" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} title="新建页面"
        onClick={() => setOpen(value => !value)}><Plus size={14} aria-hidden="true" />新建页面<ChevronDown size={14} aria-hidden="true" /></button>
      {open && <div ref={panelRef} id={menuId} className={`add-content-menu__panel add-content-menu__panel--${placement}`}
        role="menu" aria-label="新建页面" onKeyDown={moveMenuFocus}>
        <CommandMenuItems items={items} onRun={item => { setOpen(false); item.run() }} />
      </div>}
    </div>
  </div>
}
