import { useState } from 'react'
import type { ExportPageOptions } from '../../shared/workbench/toolPorts'
import type { ComponentDeliveryPage } from '../export/componentPlatform/deliveryPages'

export type StaticCourseExportFormat = 'pdf' | 'pptx' | 'docx'
export interface CourseExportSettingsDialogProps {
  pages: readonly ComponentDeliveryPage[]
  onCancel(): void
  onConfirm(format: StaticCourseExportFormat, options: ExportPageOptions): void
}

/** Optional output settings; quick export continues to use the existing defaults. */
export function CourseExportSettingsDialog({ pages, onCancel, onConfirm }: CourseExportSettingsDialogProps) {
  const [format, setFormat] = useState<StaticCourseExportFormat>('pdf')
  const [selected, setSelected] = useState(() => pages.map(page => page.id))
  const [pageSize, setPageSize] = useState<NonNullable<ExportPageOptions['pageSize']>>('surface-native')
  const [orientation, setOrientation] = useState<NonNullable<ExportPageOptions['orientation']>>('auto')
  const move = (id: string, offset: number) => setSelected(current => {
    const index = current.indexOf(id), next = index + offset
    if (next < 0 || next >= current.length) return current
    const result = [...current]; result.splice(index, 1); result.splice(next, 0, id); return result
  })
  const ordered = [...selected, ...pages.filter(page => !selected.includes(page.id)).map(page => page.id)]
  return <div className="modal-backdrop" role="presentation" onKeyDown={event => { if (event.key === 'Escape') onCancel() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="course-export-settings-title" style={{ width: 560, maxWidth: '90vw' }}>
      <h2 id="course-export-settings-title">导出设置</h2>
      <p>选择导出页面及顺序。PPTX 输出演示页和空间镜头，DOCX 输出流式讲义。</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>格式 <select autoFocus aria-label="导出格式" value={format} onChange={event => setFormat(event.target.value as StaticCourseExportFormat)}>
          <option value="pdf">PDF</option><option value="pptx">PPTX</option><option value="docx">DOCX</option>
        </select></label>
        <label>纸型 <select aria-label="导出纸型" value={pageSize} onChange={event => setPageSize(event.target.value as typeof pageSize)}>
          <option value="surface-native">作品尺寸（讲义 A4）</option><option value="A4">A4</option><option value="letter">Letter</option>
        </select></label>
        <label>方向 <select aria-label="导出方向" value={orientation} onChange={event => setOrientation(event.target.value as typeof orientation)}>
          <option value="auto">自动</option><option value="portrait">纵向</option><option value="landscape">横向</option>
        </select></label>
      </div>
      <ol aria-label="导出页面顺序" style={{ maxHeight: '45vh', overflowY: 'auto', paddingLeft: 24 }}>
        {ordered.map(id => {
          const page = pages.find(value => value.id === id)!, index = selected.indexOf(id)
          return <li key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
            <label style={{ flex: 1 }}><input type="checkbox" checked={index >= 0} aria-label={`导出 ${page.title}`}
              onChange={event => setSelected(current => event.target.checked ? [...current, id] : current.filter(value => value !== id))} /> {page.title}</label>
            <button type="button" aria-label={`上移 ${page.title}`} disabled={index <= 0} onClick={() => move(id, -1)}>↑</button>
            <button type="button" aria-label={`下移 ${page.title}`} disabled={index < 0 || index === selected.length - 1} onClick={() => move(id, 1)}>↓</button>
          </li>
        })}
      </ol>
      <div className="modal__actions"><button type="button" onClick={onCancel}>取消</button>
        <button type="button" disabled={!selected.length} onClick={() => onConfirm(format, { pageIds: selected, pageSize, orientation })}>导出</button>
      </div>
    </section>
  </div>
}
