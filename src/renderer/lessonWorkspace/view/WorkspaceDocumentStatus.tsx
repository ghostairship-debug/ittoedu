import { useEffect, useState } from 'react'
import type { DocumentHostAPI } from '../../../shared/workbench/desktop'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import './workspaceDocumentStatus.css'

export function documentSaveLabel(snapshot: DocumentSnapshot): string {
  if (snapshot.saving) return '保存中'
  if (snapshot.saveError) return '保存失败'
  if (snapshot.recovered && snapshot.dirty) return '恢复稿 · 原文件未保存'
  return snapshot.dirty ? '未保存' : '已保存'
}

function saveFailureMessage(error: string): string {
  if (/\b(?:EACCES|EPERM|EROFS)\b/.test(error)) return '文件只读、被占用或没有写入权限。'
  if (/\bENOSPC\b/.test(error)) return '磁盘空间不足。'
  if (/\bENOENT\b/.test(error)) return '保存位置已不存在。'
  return '文件未能写入。'
}

/** A projection of the formal document; never estimates save completion from dirty alone. */
export function WorkspaceDocumentStatus({ api, documentId }: { api?: DocumentHostAPI; documentId?: string }) {
  const [current, setCurrent] = useState<DocumentSnapshot | null>(null)
  useEffect(() => {
    setCurrent(null)
    if (!api || !documentId) return
    let active = true, observed = false
    const stop = api.subscribe(event => {
      if (!active) return
      if (event.type === 'changed' && event.snapshot.documentId === documentId) {
        observed = true; setCurrent(event.snapshot)
      } else if (event.type === 'closed' && event.documentId === documentId) {
        observed = true; setCurrent(null)
      }
    })
    void api.read(documentId).then(snapshot => { if (active && !observed) setCurrent(snapshot) }).catch(() => {})
    return () => { active = false; stop() }
  }, [api, documentId])
  if (!current || current.documentId !== documentId) return null
  return <span className="workspace-document-status" role="status" data-save-state={current.saving ? 'saving' : current.saveError ? 'failed' : current.dirty ? 'dirty' : 'saved'}>
    {documentSaveLabel(current)}
    {current.saveError && <span className="workspace-document-status__error">{saveFailureMessage(current.saveError)}当前稿仍保留，可重试或另存。</span>}
  </span>
}
