import { createRoot } from 'react-dom/client'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { PptxImportIssue } from './pptxPackage'

let prompts = Promise.resolve()
/** Both creation entrances require the same readable loss review before making a formal document. */
export function confirmPptxLosses(filename: string, issues: readonly PptxImportIssue[]): Promise<boolean> {
  if (!issues.length) return Promise.resolve(true)
  const summary = issues.map(issue => `${issue.page ? `第 ${issue.page} 页` : '整份文件'} · ${issue.type}：${issue.message}`).join('\n\n')
  const request = prompts.then(() => new Promise<boolean>(resolve => {
    const mount = document.createElement('div'), previous = document.activeElement
    document.body.append(mount)
    const root = createRoot(mount)
    let settled = false
    const finish = (accepted: boolean) => {
      if (settled) return
      settled = true; resolve(accepted)
      queueMicrotask(() => { root.unmount(); mount.remove(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() })
    }
    root.render(<ConfirmDialog open title="确认 PPT 转换结果" message={`${filename} 有 ${issues.length} 项未保留或已简化的内容。原 PPT 不会被修改；确认后新建可编辑 果铃工程。`}
      confirmLabel="确认并新建" onConfirm={() => finish(true)} onCancel={() => finish(false)}
      details={<textarea readOnly aria-label="完整 PPT 转换损失详情" value={summary}
        style={{ width: 'calc(100% - 32px)', margin: '0 16px 12px', height: 'min(42dvh, 360px)', resize: 'vertical', boxSizing: 'border-box', whiteSpace: 'pre-wrap' }} />} />)
  }))
  prompts = request.then(() => undefined, () => undefined)
  return request
}
