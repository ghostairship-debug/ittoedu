import { AlertCircle, AlertTriangle, CheckCircle2, FileJson } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type {
  CourseProjectExportPreflightReportV1,
  ExportPreflightItem,
} from '../export/exportPreflight'

interface ExportPreflightDialogProps {
  report: CourseProjectExportPreflightReportV1 | null
  onCancel(): void
  onContinue(): void
  onLocate(item: ExportPreflightItem): void
  onSaveReport(): void
}

const targetLabels: Record<CourseProjectExportPreflightReportV1['target'], string> = {
  'single-html': '单 HTML',
  'web-package': '网页包',
  pdf: 'PDF',
  pptx: 'PPTX',
}

const severityLabels = {
  error: '错误',
  warning: '警告',
  info: '说明',
}

function SeverityIcon({ severity }: Pick<ExportPreflightItem, 'severity'>) {
  if (severity === 'error') return <AlertCircle size={16} />
  if (severity === 'warning') return <AlertTriangle size={16} />
  return <CheckCircle2 size={16} />
}

export function ExportPreflightDialog({
  report,
  onCancel,
  onContinue,
  onLocate,
  onSaveReport,
}: ExportPreflightDialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!report) return
    primaryRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, report])

  if (!report) return null
  const { summary } = report

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal modal--preflight"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="export-preflight-title"
        aria-describedby="export-preflight-summary"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="export-preflight__header">
          <div className={`modal__icon${summary.canExport ? '' : ' modal__icon--warning'}`}>
            {summary.canExport
              ? <CheckCircle2 size={23} />
              : <AlertTriangle size={23} />}
          </div>
          <div>
            <h2 className="modal__title" id="export-preflight-title">
              {targetLabels[report.target]} 导出预检
            </h2>
            <p className="modal__message" id="export-preflight-summary">
              {summary.error} 个错误、{summary.warning} 个警告、{summary.info} 条说明。
              {summary.canExport
                ? '可以继续导出；请确认警告和静态格式差异。'
                : '错误会造成缺失、裁切或离线失败，必须先修复。'}
            </p>
          </div>
        </header>
        <div className="export-preflight__list" aria-label="导出预检问题">
          {report.items.map((item, index) => {
            const locatable = Boolean(item.diagnosticTarget || item.sceneId || item.nodeId)
            return (
              <article
                className={`export-preflight__item is-${item.severity}`}
                key={`${item.code}:${item.sceneId ?? ''}:${item.stateId ?? ''}:${item.nodeId ?? ''}:${index}`}
              >
                <SeverityIcon severity={item.severity} />
                <div>
                  <strong>{severityLabels[item.severity]}</strong>
                  <span>{item.message}</span>
                  <small>{item.code}</small>
                </div>
                {locatable ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onLocate(item)}
                  >
                    定位
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
        <footer className="modal__actions modal__actions--three">
          <button type="button" className="secondary-button" onClick={onCancel}>
            返回编辑
          </button>
          <button type="button" className="secondary-button" onClick={onSaveReport}>
            <FileJson size={14} />保存报告
          </button>
          {summary.canExport ? (
            <button
              ref={primaryRef}
              type="button"
              className="primary-button"
              onClick={onContinue}
            >
              继续导出
            </button>
          ) : (
            <button
              ref={primaryRef}
              type="button"
              className="primary-button"
              onClick={onCancel}
            >
              去修复
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
