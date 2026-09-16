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
    const update = () => setCompact(container.getBoundingClientRect().width < 1000)
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
