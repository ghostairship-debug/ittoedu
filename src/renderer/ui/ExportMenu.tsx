import { Archive, ChevronDown, FileDown, FileText, Presentation } from 'lucide-react'
import { useRef, type MouseEvent } from 'react'
import type { SingleHtmlExportMode } from '../export/course/coursePackagePreflight'
import { useDismissableDetails } from './useDismissableDetails'

export type ExportFormat = 'single-html' | 'web-package' | 'pptx' | 'pdf' | 'docx'

/**
 * The export formats, defined once for the editor toolbar and the workbench top bar (M21): same names, same order,
 * same behaviour. `variant` only changes how the trigger looks.
 */
export function ExportMenu({ busy, hasFlowSurface, onExport, variant = 'toolbar' }: {
  busy: boolean
  hasFlowSurface: boolean
  onExport(format: ExportFormat, singleHtmlMode?: SingleHtmlExportMode): void
  variant?: 'toolbar' | 'light'
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useDismissableDetails(ref)
  // Both menus stay mounted (one is hidden per mode), so each keeps its own test ids.
  const testId = (name: string) => variant === 'light' ? `light-${name}` : name
  const choose = (event: MouseEvent<HTMLElement>, format: ExportFormat, mode?: SingleHtmlExportMode) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
    if (mode) onExport(format, mode)
    else onExport(format)
  }
  return <details ref={ref} className={`export-menu${variant === 'light' ? ' export-menu--light' : ''}`}>
    <summary
      className={variant === 'light' ? 'export-menu__trigger export-menu__trigger--light' : 'tool-button tool-button--accent export-menu__trigger'}
      data-testid={testId('export-menu-trigger')}
      title="导出"
      aria-label="导出"
      aria-disabled={busy}
      onClick={(event) => { if (busy) event.preventDefault() }}
    >
      {variant === 'light' ? <>导出<ChevronDown size={11} aria-hidden="true" /></> : <>
        <span className="export-menu__trigger-icon">
          <FileDown size={18} />
          <ChevronDown size={11} />
        </span>
        <span>导出</span>
      </>}
    </summary>
    <div className="export-menu__panel" role="menu" aria-label="选择导出格式">
      <div className="export-menu__title">选择导出格式</div>
      <button type="button" role="menuitem" data-testid={testId('export-single-html')} className="export-menu__item" onClick={(event) => choose(event, 'single-html', 'offline-portable')}>
        <FileDown size={18} />
        <span><strong>离线便携单 HTML</strong><small>资源全部内嵌，无网络也能使用，文件较大</small></span>
      </button>
      <button type="button" role="menuitem" data-testid={testId('export-single-html-online')} className="export-menu__item" onClick={(event) => choose(event, 'single-html', 'online-lightweight')}>
        <FileDown size={18} />
        <span><strong>在线轻量单 HTML</strong><small>保留已声明的远程素材地址，文件较小但依赖网络</small></span>
      </button>
      <button type="button" role="menuitem" data-testid={testId('export-web-package')} className="export-menu__item" onClick={(event) => choose(event, 'web-package')}>
        <Archive size={18} />
        <span><strong>网页包</strong><small>资源独立存放，推荐大型 H5 演示使用</small></span>
      </button>
      <button type="button" role="menuitem" data-testid={testId('export-pptx')} className="export-menu__item" onClick={(event) => choose(event, 'pptx')}>
        <Presentation size={18} />
        <span><strong>PowerPoint（PPTX）</strong><small>文字、图形、图片和组件为独立对象</small></span>
      </button>
      <button type="button" role="menuitem" data-testid={testId('export-pdf')} className="export-menu__item" onClick={(event) => choose(event, 'pdf')}>
        <FileText size={18} />
        <span><strong>PDF</strong><small>静态页面，互动组件将静态化</small></span>
      </button>
      <button type="button" role="menuitem" data-testid={testId('export-docx')} className="export-menu__item" disabled={!hasFlowSurface}
        title={hasFlowSurface ? undefined : '请先新增流式讲义页面'}
        onClick={(event) => { if (hasFlowSurface) choose(event, 'docx') }}>
        <FileText size={18} />
        <span><strong>DOCX 讲义</strong><small>Flow 内容导出为可编辑 Word 文档</small></span>
      </button>
    </div>
  </details>
}
