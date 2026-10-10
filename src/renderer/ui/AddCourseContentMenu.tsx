import { ChevronDown, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type {
  CourseEditorDropdownAction,
  CourseEditorLayoutResult,
  CourseEditorPrimaryAction,
} from '../course/courseEditorLayout'

const DROPDOWN_LABELS: Record<CourseEditorDropdownAction, string> = {
  'slide-page': '新增演示页面',
  'flow-page': '新增流式布局',
  'spatial-page': '新增无限画布',
}

const PRIMARY_LABELS: Record<CourseEditorPrimaryAction, string> = {
  scene: '新建场景',
  'slide-page': '新增演示页面',
  'flow-page': '新增流式布局',
  'spatial-page': '新增无限画布',
}

export interface AddCourseContentMenuProps {
  layout: CourseEditorLayoutResult
  onPrimary(): void
  onAddSlidePage?(): void
  onAddFlowPage?(): void
  onAddSpatialPage?(): void
}

export function AddCourseContentMenu({
  layout,
  onPrimary,
  onAddSlidePage,
  onAddFlowPage,
  onAddSpatialPage,
}: AddCourseContentMenuProps) {
  const menuId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')

  useEffect(() => {
    if (!open || !panelRef.current) return
    const panel = panelRef.current
    const rect = panel.getBoundingClientRect()
    const viewportPadding = 8
    const overflowBottom = rect.bottom > window.innerHeight - viewportPadding
    const overflowTop = rect.top < viewportPadding
    if (overflowBottom && !overflowTop) setPlacement('top')
    else setPlacement('bottom')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const dropdownHandlers: Record<CourseEditorDropdownAction, (() => void) | undefined> = {
    'slide-page': onAddSlidePage,
    'flow-page': onAddFlowPage,
    'spatial-page': onAddSpatialPage,
  }

  const primaryAlias = layout.primary.action === 'scene'
    ? 'add-scene'
    : layout.primary.action === 'flow-page'
      ? 'add-flow-page'
      : undefined

  return (
    <div className="add-content-menu__cluster">
      <button
        type="button"
        className="secondary-button"
        data-testid="add-content-primary"
        {...(primaryAlias ? { 'data-alias-testid': primaryAlias } : {})}
        onClick={onPrimary}
      >
        <Plus size={14} />
        {PRIMARY_LABELS[layout.primary.action]}
      </button>
      {layout.dropdown.length > 0 ? (
        <div className="add-content-menu" data-testid="add-content-menu">
          <button
            type="button"
            className="secondary-button add-content-menu__toggle"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            title="新增其他类型页面"
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown size={14} />
          </button>
          {open ? (
            <div
              ref={panelRef}
              id={menuId}
              className={`add-content-menu__panel add-content-menu__panel--${placement}`}
              role="menu"
              aria-label="新增内容"
            >
              {layout.dropdown.map((action) => {
                const handler = dropdownHandlers[action]
                if (!handler) return null
                return (
                  <button
                    key={action}
                    type="button"
                    role="menuitem"
                    data-testid={`add-${action}`}
                    onClick={() => {
                      setOpen(false)
                      handler()
                    }}
                  >
                    {DROPDOWN_LABELS[action]}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
