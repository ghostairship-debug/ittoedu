import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewLease } from '../../../shared/workbench/htmlPreview'
import { PlainTextDocumentEditor, type PlainTextDocumentEditorHandle } from '../PlainTextDocumentEditor'
import { HtmlPreviewPane } from './HtmlPreviewPane'

export interface HtmlDocumentEditorProps {
  tabId: string
  committed: DocumentSnapshot
  source: string
  onDraft(source: string): void
  onUndo(): void
  onRedo(): void
  onSave?(): void
}

/** HTML is still one canonical text document. The preview lease is a view of its committed source. */
export const HtmlDocumentEditor = forwardRef<PlainTextDocumentEditorHandle, HtmlDocumentEditorProps>(function HtmlDocumentEditor({ tabId, committed, source, onDraft, onUndo, onRedo, onSave }, ref) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [lease, setLease] = useState<HtmlPreviewLease | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const sourceEditor = useRef<PlainTextDocumentEditorHandle>(null)
  const leaseQueue = useRef<Promise<void>>(Promise.resolve())
  useImperativeHandle(ref, () => ({ flush: () => sourceEditor.current?.flush() ?? { ready: true, source } }), [source])

  const binding = committed.binding
  const documentId = committed.documentId
  const epoch = committed.epoch
  const revision = committed.revision
  const bindingVersion = binding.kind === 'file' ? binding.bindingVersion : null
  const filename = binding.kind === 'file' ? binding.path : null
  useEffect(() => {
    const files = window.desktopAPI?.workspaceFiles
    if (!filename || bindingVersion === null || !files) { setLease(null); setPreviewError('HTML 预览服务尚未就绪，可切换到源码继续编辑。'); return }
    let live = true
    let opened: HtmlPreviewLease | null = null
    setLease(null)
    setPreviewError(null)
    leaseQueue.current = leaseQueue.current.catch(() => {}).then(async () => {
      if (!live) return
      try {
        const value = await files({ type: 'html-preview.open', documentId, epoch, expectedBindingVersion: bindingVersion, tabId })
        opened = value
        if (live) setLease(value)
        else await files({ type: 'html-preview.release', leaseId: value.leaseId, tabId })
      } catch (reason) { if (live) setPreviewError(reason instanceof Error ? reason.message : String(reason)) }
    })
    return () => {
      live = false
      if (opened) leaseQueue.current = leaseQueue.current.then(async () => { await files({ type: 'html-preview.release', leaseId: opened!.leaseId, tabId }).catch(() => {}) })
    }
  }, [filename, documentId, epoch, bindingVersion, tabId])

  return <div className="html-document-editor">
    <div role="toolbar" aria-label="HTML 视图" className="html-document-editor__toolbar">
      <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>预览</button>
      <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>源码</button>
    </div>
    <div className="html-document-editor__preview" hidden={mode !== 'preview'}>
      {lease ? <HtmlPreviewPane lease={lease} committed={committed} tabId={tabId} active={mode === 'preview'}
        onUndo={onUndo} onRedo={onRedo} onSave={onSave} />
        : <p role={previewError ? 'alert' : 'status'}>{previewError ?? '正在准备 HTML 预览…'}</p>}
    </div>
    <div className="html-document-editor__source" hidden={mode !== 'source'}>
      <PlainTextDocumentEditor ref={sourceEditor} source={source} revision={revision} onDraft={onDraft} onUndo={onUndo} onRedo={onRedo} />
    </div>
  </div>
})
