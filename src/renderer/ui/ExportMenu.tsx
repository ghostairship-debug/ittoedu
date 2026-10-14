import { Archive, ChevronDown, Code, Forward, FileText, Presentation, SlidersHorizontal } from 'lucide-react'
import { useRef, type MouseEvent } from 'react'
import type { SingleHtmlExportMode } from '../export/course/coursePackagePreflight'
import { useDismissableDetails } from './useDismissableDetails'
import './workbenchChrome.css'

export type ExportFormat = 'single-html' | 'web-package' | 'pptx' | 'pdf' | 'docx'

/**
 * The export formats, defined once for the editor toolbar and the workbench top bar (M21): same names, same order,
 * same behaviour and trigger. `variant` keeps the two mounted hosts' test IDs distinct.
 */
export function ExportMenu({ busy, hasFlowSurface, onExport, onExportSettings, variant = 'toolbar' }: {
  busy: boolean
  hasFlowSurface: boolean
  onExport(format: ExportFormat, singleHtmlMode?: SingleHtmlExportMode): void
  onExportSettings?(): void
  variant?: 'toolbar' | 'light'
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useDismissableDetails(ref)
  // Both menus stay mounted (one is hidden per mode), so each keeps its own test ids.
  const testId = (name: string) => variant === 'light' ? `light-${name}` : name
  const choose = (event: MouseEvent<HTMLElement>, format: ExportFormat, mode?: SingleHtmlExportMode) => {
    if (busy) return
    event.currentTarget.closest('details')?.removeAttribute('open')
    if (mode) onExport(format, mode)
    else onExport(format)
  }
  return <details ref={ref} className={`export-menu${variant === 'light' ? ' export-menu--light' : ''}`}>
    <summary
      className="tool-button transfer-menu__trigger export-menu__trigger"
      data-testid={testId('export-menu-trigger')}
      title="导出文件"
      aria-label="导出"
      aria-haspopup="menu"
      aria-disabled={busy}
      onClick={(event) => { if (busy) event.preventDefault() }}
    >
      <Forward size={18} strokeWidth={3} style={{ transform: 'rotate(-35deg)' }} aria-hidden="true" /><ChevronDown size={11} aria-hidden="true" />
    </summary>
    <div className="export-menu__panel" role="menu" aria-label="选择导出格式">
      <div className="export-menu__title">选择导出格式</div>
      <button type="button" role="menuitem" disabled={busy} data-testid={testId('export-single-html')} className="export-menu__item" onClick={(event) => choose(event, 'single-html', 'offline-portable')}>
        <Code size={18} />
        <span><strong>单文件 HTML</strong><small>包含工程资源；若内容需要联网，导出时会提示</small></span>
      </button>
      <button type="button" role="menuitem" disabled={busy} data-testid={testId('export-web-package')} className="export-menu__item" onClick={(event) => choose(event, 'web-package')}>
        <Archive size={18} />
        <span><strong>网页包</strong><small>资源独立存放，推荐大型 果铃工程使用</small></span>
      </button>
      <button type="button" role="menuitem" disabled={busy} data-testid={testId('export-pptx')} className="export-menu__item" onClick={(event) => choose(event, 'pptx')}>
        <Presentation size={18} />
        <span><strong>PowerPoint（PPTX）</strong><small>文字、图形、图片和组件为独立对象</small></span>
      </button>
      <button type="button" role="menuitem" disabled={busy} data-testid={testId('export-pdf')} className="export-menu__item" onClick={(event) => choose(event, 'pdf')}>
        <FileText size={18} />
        <span><strong>PDF</strong><small>静态页面，互动组件将静态化</small></span>
      </button>
      <button type="button" role="menuitem" data-testid={testId('export-docx')} className="export-menu__item" disabled={busy || !hasFlowSurface}
        title={hasFlowSurface ? undefined : '请先新增流式布局页面'}
        onClick={(event) => { if (hasFlowSurface) choose(event, 'docx') }}>
        <FileText size={18} />
        <span><strong>DOCX 讲义</strong><small>Flow 内容导出为可编辑 Word 文档</small></span>
      </button>
      {onExportSettings && <button type="button" role="menuitem" disabled={busy} data-testid={testId('export-settings')} className="export-menu__item" onClick={event => {
        event.currentTarget.closest('details')?.removeAttribute('open')
        onExportSettings()
      }}><SlidersHorizontal size={18} /><span><strong>导出设置</strong><small>页面、顺序与纸型</small></span></button>}
    </div>
  </details>
}
