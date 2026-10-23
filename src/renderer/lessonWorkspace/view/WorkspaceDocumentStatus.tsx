import { useEffect, useState } from 'react'
import type { DocumentHostAPI } from '../../../shared/workbench/desktop'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { DocumentFileSession } from '../../documentFiles/documentFileSession'
import './workspaceDocumentStatus.css'

type DocumentSaveStatus = Pick<DocumentSnapshot, 'documentId' | 'epoch' | 'saving' | 'saveError' | 'recovered' | 'recoveryDiagnostics' | 'dirty' | 'binding'>

export function documentSaveLabel(snapshot: DocumentSaveStatus): string {
  if (snapshot.saving) return '保存中'
  if (snapshot.saveError) return '保存失败'
  if (snapshot.recovered && snapshot.dirty) return '恢复稿 · 原文件未保存'
  return snapshot.dirty ? '未保存' : snapshot.binding.kind === 'file' ? '已保存' : '尚未保存'
}

function saveFailureMessage(error: string): string {
  if (/\b(?:EACCES|EPERM|EROFS)\b/.test(error)) return '文件只读、被占用或没有写入权限。'
  if (/\bENOSPC\b/.test(error)) return '磁盘空间不足。'
  if (/\bENOENT\b/.test(error)) return '保存位置已不存在。'
  return '文件未能写入。'
}

/** A projection of the formal document; never estimates save completion from dirty alone. */
export function WorkspaceDocumentStatus({ api, documentId, session }: {
  api?: DocumentHostAPI
  documentId?: string
  session?: Pick<DocumentFileSession, 'committedDocument' | 'subscribe'>
}) {
  const [current, setCurrent] = useState<DocumentSaveStatus | null>(null)
  useEffect(() => {
    setCurrent(null)
    if (session && documentId) {
      let closed = false
      const refresh = () => {
        const snapshot = session.committedDocument
        setCurrent(!closed && snapshot?.documentId === documentId ? snapshot : null)
      }
      const stop = session.subscribe(refresh)
      const stopClosed = api?.subscribe(event => {
        if (event.type === 'closed' && event.documentId === documentId
          && event.epoch === session.committedDocument?.epoch) { closed = true; setCurrent(null) }
      })
      refresh()
      return () => { stop(); stopClosed?.() }
    }
    if (!api || !documentId) return
    let active = true, observed = false
    const stop = api.subscribe(event => {
      if (!active) return
      if (event.type !== 'closed') {
        const facts = event.type === 'changed' ? event.head ?? event.snapshot : event.head
        if (facts.documentId !== documentId) return
        observed = true; setCurrent(facts)
      } else if (event.type === 'closed' && event.documentId === documentId) {
        observed = true; setCurrent(null)
      }
    })
    void api.read(documentId).then(snapshot => { if (active && !observed) setCurrent(snapshot) }).catch(() => {})
    return () => { active = false; stop() }
  }, [api, documentId, session])
  if (!current || current.documentId !== documentId) return null
  return <span className="workspace-document-status" role="status" data-save-state={current.saving ? 'saving' : current.saveError ? 'failed' : current.dirty ? 'dirty' : current.binding.kind === 'file' ? 'saved' : 'untitled'}>
    {documentSaveLabel(current)}
    {current.saveError && <span className="workspace-document-status__error">{saveFailureMessage(current.saveError)}当前稿仍保留，可重试或另存。</span>}
    {!!current.recoveryDiagnostics?.length && <details><summary>恢复历史需处理</summary>{current.recoveryDiagnostics.map((message, index) => <p key={index}>{message}</p>)}</details>}
  </span>
}
