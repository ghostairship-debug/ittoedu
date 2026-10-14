import { FileInput, ChevronDown, FileText, Presentation, Code } from 'lucide-react'
import { useRef } from 'react'
import { useDismissableDetails } from './useDismissableDetails'
import './workbenchChrome.css'

export function CourseImportMenu({ busy, onPptx, onFlow, onHtml }: { busy?: boolean; onPptx?(): void; onFlow?(): void; onHtml?(): void }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useDismissableDetails(ref)
  const choose = (action: () => void) => { ref.current?.removeAttribute('open'); action() }
  return <details ref={ref} className="export-menu course-import-menu">
    <summary className="tool-button transfer-menu__trigger export-menu__trigger" aria-label="导入" aria-haspopup="menu" title="导入内容" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault() }}><FileInput size={18} aria-hidden="true" /><ChevronDown size={11} aria-hidden="true" /></summary>
    <div className="export-menu__panel" role="menu" aria-label="导入内容">
      <div className="export-menu__title">导入内容</div>
      {onFlow && <button type="button" role="menuitem" disabled={busy} className="export-menu__item" onClick={() => choose(onFlow)}><FileText size={18} /><span><strong>Word、MD、TXT → Flow</strong><small>新增可编辑流式页；原文件保留</small></span></button>}
      {onPptx && <button type="button" role="menuitem" disabled={busy} className="export-menu__item" onClick={() => choose(onPptx)}><Presentation size={18} /><span><strong>PowerPoint（PPTX）</strong><small>导入可编辑演示页</small></span></button>}
      {onHtml && <button type="button" role="menuitem" disabled={busy} className="export-menu__item" onClick={() => choose(onHtml)}><Code size={18} /><span><strong>HTML 页面</strong><small>导入现有内容与互动</small></span></button>}
    </div>
  </details>
}
