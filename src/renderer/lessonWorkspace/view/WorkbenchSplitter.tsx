import { useCallback, useRef } from 'react'

export type ContentDockEdge = 'left' | 'right' | 'top' | 'bottom'

/** left/top grow when the pointer moves toward positive axes; right/bottom invert. */
export function contentDockResizeSign(dock: ContentDockEdge): 1 | -1 {
  return dock === 'right' || dock === 'bottom' ? -1 : 1
}

interface SplitterProps {
  /** 分隔线可访问名称 */
  label: string
  /** 拖动方向：vertical 分隔线调整水平宽度；horizontal 调整上下高度 */
  orientation: 'vertical' | 'horizontal'
  /** 当前尺寸（仅用于 aria-valuenow 展示） */
  value: number
  /** 方向符号：+1 表示向坐标轴正方向拖动增大尺寸，-1 表示反向 */
  direction?: 1 | -1
  onResizeDelta(deltaPx: number): void
  className?: string
}

/**
 * 可调分隔线：指针拖动 + 键盘方向键，输出像素增量由父级换算并夹取。
 */
export function WorkbenchSplitter({ label, orientation, value, direction = 1, onResizeDelta, className }: SplitterProps) {
  const dragState = useRef<{ pointerId: number; startPos: number } | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const host = event.currentTarget
    host.setPointerCapture(event.pointerId)
    dragState.current = {
      pointerId: event.pointerId,
      startPos: orientation === 'vertical' ? event.clientX : event.clientY,
    }
    host.classList.add('is-dragging')
  }, [orientation])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const pos = orientation === 'vertical' ? event.clientX : event.clientY
    const delta = (pos - drag.startPos) * direction
    if (delta !== 0) {
      drag.startPos = pos
      onResizeDelta(delta)
    }
  }, [orientation, direction, onResizeDelta])

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = null
    event.currentTarget.classList.remove('is-dragging')
  }, [])

  const nudge = useCallback((delta: number) => {
    onResizeDelta(delta * direction)
  }, [direction, onResizeDelta])

  return <div
    role="separator"
    tabIndex={0}
    aria-label={label}
    aria-orientation={orientation}
    aria-valuenow={Math.round(value)}
    className={`workbench-splitter workbench-splitter--${orientation}${className ? ` ${className}` : ''}`}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
    onKeyDown={event => {
      if (orientation === 'vertical' && event.key === 'ArrowLeft') { event.preventDefault(); nudge(-16) }
      if (orientation === 'vertical' && event.key === 'ArrowRight') { event.preventDefault(); nudge(16) }
      if (orientation === 'horizontal' && event.key === 'ArrowUp') { event.preventDefault(); nudge(-16) }
      if (orientation === 'horizontal' && event.key === 'ArrowDown') { event.preventDefault(); nudge(16) }
    }}
  />
}
