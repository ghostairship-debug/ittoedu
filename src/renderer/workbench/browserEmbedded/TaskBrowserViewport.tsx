import { useEffect, useRef, useState } from 'react'
import type { EmbeddedBrowserViewportRequest, EmbeddedBrowserViewportState } from '../../../shared/workbench/embeddedBrowser'

export interface TaskBrowserViewportProps {
  workspaceId: string
  conversationId: string
  runId: string
  pageUrl: string
  viewport(input: EmbeddedBrowserViewportRequest): Promise<EmbeddedBrowserViewportState>
  onReady?(ready: boolean): void
}

/** Placeholder for the main-owned native view; it does not host another iframe or browser. */
export function TaskBrowserViewport({ workspaceId, conversationId, runId, pageUrl, viewport, onReady }: TaskBrowserViewportProps) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const readiness = useRef(onReady)
  readiness.current = onReady
  useEffect(() => {
    const node = container.current
    if (!node) return
    let disposed = false, frame = 0
    let tail: Promise<unknown> = Promise.resolve()
    let previous = ''
    const send = (input: EmbeddedBrowserViewportRequest) => {
      tail = tail.catch(() => undefined).then(() => viewport(input)).then(state => {
        if (!disposed) {
          readiness.current?.(state.embedded && state.visible)
          setError(state.embedded ? undefined : '当前浏览器连接尚未提供内嵌页面。')
        }
      }).catch(cause => {
        if (!disposed) {
          readiness.current?.(false)
          setError(cause instanceof Error ? cause.message : '任务网页暂时无法显示')
        }
      })
    }
    const measure = () => {
      frame = 0
      if (disposed) return
      const rect = node.getBoundingClientRect()
      const visible = document.visibilityState !== 'hidden' && rect.width >= 1 && rect.height >= 1
        && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
      const input: EmbeddedBrowserViewportRequest = { workspaceId, conversationId, runId, visible,
        ...(visible ? { bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : {}) }
      if (!visible) readiness.current?.(false)
      const identity = JSON.stringify(input)
      if (identity !== previous) { previous = identity; send(input) }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    resize.observe(node)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    measure()
    return () => {
      disposed = true
      readiness.current?.(false)
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      send({ workspaceId, conversationId, runId, visible: false })
    }
  }, [workspaceId, conversationId, runId, viewport])

  return <div aria-label="任务浏览器" style={{ display: 'flex', flexDirection: 'column', minHeight: 260 }}>
    <div title={pageUrl} style={{ padding: '6px 10px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageUrl}</div>
    <div ref={container} data-task-browser-viewport={runId} style={{ minHeight: 260, height: 260, width: '100%', background: '#fff' }}>
      {error && <div role="status" style={{ padding: 16, color: '#b42318' }}>{error}</div>}
    </div>
  </div>
}
