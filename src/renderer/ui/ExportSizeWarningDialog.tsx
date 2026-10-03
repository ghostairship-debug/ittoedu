import { AlertTriangle, Archive, FileDown } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface ExportSizeWarningDialogProps {
  open: boolean
  byteLength: number
  onCancel(): void
  onExportWebPackage(): void
  onContinueSingleHtml(): void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExportSizeWarningDialog({
  open,
  byteLength,
  onCancel,
  onExportWebPackage,
  onContinueSingleHtml,
}: ExportSizeWarningDialogProps) {
  const recommendedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    recommendedRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, open])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal modal--export-warning"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="export-size-warning-title"
        aria-describedby="export-size-warning-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__body">
          <div className="modal__icon modal__icon--warning">
            <AlertTriangle size={23} />
          </div>
          <div>
            <h2 className="modal__title" id="export-size-warning-title">
              单 HTML 文件较大
            </h2>
            <p className="modal__message" id="export-size-warning-message">
              {`预计文件大小为 ${formatFileSize(byteLength)}。大型单 HTML 打开时需要一次性解码全部内容，可能启动缓慢或占用较多内存；建议改用网页包。`}
            </p>
          </div>
        </div>
        <div className="modal__actions modal__actions--three">
          <button type="button" className="secondary-button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onContinueSingleHtml}
          >
            <FileDown size={14} />
            仍导出单 HTML
          </button>
          <button
            ref={recommendedRef}
            type="button"
            className="primary-button"
            onClick={onExportWebPackage}
          >
            <Archive size={14} />
            导出网页包（推荐）
          </button>
        </div>
      </section>
    </div>
  )
}
