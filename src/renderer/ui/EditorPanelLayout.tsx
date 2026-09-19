import { Children, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Keeps the existing panel owners mounted while adapting the embedded workbench. */
export function EditorPanelLayout({ children, className = '' }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const launcher = useRef<HTMLButtonElement | null>(null)
  const [compact, setCompact] = useState(false)
  const [panel, setPanel] = useState<'structure' | 'properties' | null>(null)
  const slots = Children.toArray(children)
  useLayoutEffect(() => {
    const container = root.current?.closest('.lesson-course-tab')
    if (!container) return
    // 课件 tab 未激活时 .lesson-course-tab 是 display:none，宽度为 0；把 0 当"窄"会先判成紧凑布局，
    // 等 tab 显示后 ResizeObserver 再切回宽布局，紧凑控件条随之卸载——用户看到它闪一下，
    // 正在点它的人（含 e2e）会点到一个正在消失的按钮。宽度为 0 时布局尚未成立，不做判定。
    const update = () => {
      const width = container.getBoundingClientRect().width
      if (width > 0) setCompact(width < 1000)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  const close = () => { setPanel(null); launcher.current?.focus() }
  return <div ref={root} className={`${className} editor-panel-layout${compact ? ' editor-panel-layout--compact' : ''}`}
    onKeyDown={event => { if (compact && panel && event.key === 'Escape') { event.preventDefault(); close() } }}>
    {compact && <div className="editor-panel-controls" aria-label="课件编辑面板">
      {(['structure', 'properties'] as const).map(value => <button key={value} type="button"
        aria-expanded={panel === value} aria-controls={`embedded-editor-${value}`}
        onClick={event => { launcher.current = event.currentTarget; setPanel(panel === value ? null : value) }}>
        {value === 'structure' ? '页面与图层' : '属性与素材'}
      </button>)}
      {panel && <button type="button" onClick={close}>关闭面板</button>}
    </div>}
    <div id="embedded-editor-structure" className="editor-panel-slot editor-panel-slot--structure" hidden={compact && panel !== 'structure'}>{slots[0]}</div>
    {slots[1]}
    <div id="embedded-editor-properties" className="editor-panel-slot editor-panel-slot--properties" hidden={compact && panel !== 'properties'}>{slots[2]}</div>
    {slots.slice(3)}
  </div>
}
