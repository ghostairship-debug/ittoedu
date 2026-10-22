import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewLease } from '../../../shared/workbench/htmlPreview'
import { PlainTextDocumentEditor, type PlainTextDocumentEditorHandle } from '../PlainTextDocumentEditor'
import { HtmlPreviewPane } from './HtmlPreviewPane'
import { HtmlTextDrafts } from './htmlTextDrafts'
import { htmlTargetNode, type HtmlEditingTarget, type HtmlSourceSelection } from './htmlEditingTarget'
import { HtmlSourceAnalysis } from './htmlSourceAnalysis'

export interface HtmlDocumentEditorProps {
  tabId: string
  active?: boolean
  committed: DocumentSnapshot
  source: string
  onDraft(source: string): void
  onUndo(): void
  onRedo(): void
  onSave?(): void
  onPendingDraftChange?(dirty: boolean): void
  documentActions?: ReactNode
  onTargetSource?(target: HtmlSourceSelection | null): void
}

export interface HtmlDocumentEditorHandle extends PlainTextDocumentEditorHandle {
  flush(): { ready: boolean; source: string; sourceChangeHints?: Array<{ from: number; to: number; inserted: number }> }
}

/** HTML is still one canonical text document. The preview lease is a view of its committed source. */
export const HtmlDocumentEditor = forwardRef<HtmlDocumentEditorHandle, HtmlDocumentEditorProps>(function HtmlDocumentEditor({ tabId, active = true, committed, source, onDraft, onUndo, onRedo, onSave, onPendingDraftChange, documentActions, onTargetSource }, ref) {
  const committedSource = committed.model.kind === 'text' ? committed.model.source : ''
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [lease, setLease] = useState<HtmlPreviewLease | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [viewIssue, setViewIssue] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const sourceEditor = useRef<PlainTextDocumentEditorHandle>(null)
  const composing = useRef(false)
  const latestRevision = useRef(committed.revision); latestRevision.current = committed.revision
  const [target, setTarget] = useState<HtmlEditingTarget | null>(null)
  const selectTarget = (value: HtmlEditingTarget | null) => {
    setTarget(value)
    onTargetSource?.(value?.source && source === committedSource && value.revision === committed.revision
      ? { revision: value.revision, from: value.source.from, to: value.source.to } : null)
  }
  useEffect(() => { selectTarget(null) }, [committed.documentId, committed.epoch])
  const textDrafts = useMemo(() => new HtmlTextDrafts(), [committed.documentId, committed.epoch])
  const retained = useSyncExternalStore(textDrafts.subscribe, textDrafts.read)
  const leaseQueue = useRef<Promise<void>>(Promise.resolve())
  const reloadPreview = useRef<(() => void) | null>(null)
  const analysis = useMemo(() => new HtmlSourceAnalysis(committedSource), [committedSource, committed.documentId, committed.epoch])
  textDrafts.setAnalysis(analysis)
  const sourceAddress = useMemo(() => mode === 'source' && source === committedSource && target?.revision === committed.revision
    ? target.source ?? htmlTargetNode(target, analysis.nodes, committed.revision)?.address : undefined, [mode, source, committedSource, target, analysis, committed.revision])
  useEffect(() => {
    if (mode === 'source' && active && sourceAddress) sourceEditor.current?.revealRange({
      revision: committed.revision, from: sourceAddress.from, to: sourceAddress.to,
    })
  }, [mode, active, committed.revision, analysis])
  useEffect(() => { if (source !== committedSource && target) selectTarget(null) }, [source, committedSource, target])
  useEffect(() => { textDrafts.reconcile(committedSource) }, [textDrafts, committedSource, committed.revision])
  useEffect(() => { onPendingDraftChange?.(retained.length > 0) }, [retained.length, onPendingDraftChange])
  useImperativeHandle(ref, () => ({ flush: () => {
    if (composing.current) return { ready: false, source }
    const current = sourceEditor.current?.flush() ?? { ready: true, source }
    if (!current.ready) return current
    const sourceChangeHints: Array<{ from: number; to: number; inserted: number }> = []
    const prepared = textDrafts.prepare(current.source, sourceChangeHints)
    return prepared.ready && sourceChangeHints.length ? { ...prepared, sourceChangeHints } : prepared
  }, clearSelection: () => { sourceEditor.current?.clearSelection(); window.getSelection()?.removeAllRanges(); selectTarget(null) },
    revealRange: range => {
      if (range.revision !== committed.revision || source !== committedSource) return false
      selectTarget({ revision: range.revision, source: { kind: 'text', from: range.from, to: range.to } })
      setMode('source')
      sourceEditor.current?.revealRange(range)
      return true
    } }), [source, textDrafts, committed.revision, onTargetSource])

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
    let opening = false
    let requestedRevision: number | null = null
    setLease(null)
    setPreviewError(null)
    // A source reload creates a real new lease through the same owner. Keep the
    // mounted pane and its view/drafts while Main replaces only this tab's lease.
    const open = () => {
      if (!live) return
      setPreviewError(null)
      requestedRevision = latestRevision.current
      if (opening) return
      opening = true
      leaseQueue.current = leaseQueue.current.catch(() => {}).then(async () => {
        while (live && requestedRevision !== null) {
          requestedRevision = null
          try {
            const value = await files({ type: 'html-preview.open', documentId, epoch, expectedBindingVersion: bindingVersion, tabId })
            opened = value
            if (live) {
              setLease(value)
              if (requestedRevision !== null && requestedRevision <= value.revision) requestedRevision = null
            } else await files({ type: 'html-preview.release', leaseId: value.leaseId, tabId })
          } catch (reason) { if (live) setPreviewError(reason instanceof Error ? reason.message : String(reason)) }
        }
      }).finally(() => { opening = false; if (live && requestedRevision !== null) open() })
    }
    reloadPreview.current = open
    open()
    return () => {
      live = false
      requestedRevision = null
      if (reloadPreview.current === open) reloadPreview.current = null
      if (opened) leaseQueue.current = leaseQueue.current.then(async () => { await files({ type: 'html-preview.release', leaseId: opened!.leaseId, tabId }).catch(() => {}) })
    }
  }, [filename, documentId, epoch, bindingVersion, tabId, retry])

  const showPreview = () => {
    if (mode === 'source') {
      const draft = sourceEditor.current?.flush()
      if (composing.current || draft?.ready === false) { setViewIssue('请先完成当前输入，再切换预览。'); return }
      if (draft && draft.source !== source) onDraft(draft.source)
    }
    setViewIssue(null)
    setMode('preview')
  }
  const viewControls = <>
    {documentActions}
    <div className="html-document-editor__views" role="group" aria-label="HTML 视图">
      <button type="button" aria-pressed={mode === 'preview'} onClick={showPreview}>预览</button>
      <button type="button" aria-pressed={mode === 'source'} onClick={() => { setViewIssue(null); setMode('source') }}>源码</button>
    </div>
  </>
  return <div className="html-document-editor" onCompositionStartCapture={() => { composing.current = true }}
    onCompositionEndCapture={() => { composing.current = false; setViewIssue(null) }}>
    {(mode === 'source' || !lease) && <div role="toolbar" aria-label="HTML 文档工具" className="html-document-editor__toolbar">{viewControls}</div>}
    {viewIssue && <p role="alert">{viewIssue}</p>}
    {retained.length > 0 && <details open={retained.some(draft => Boolean(draft.issue))} style={{ flex: '0 0 auto', maxHeight: '35%', overflow: 'auto' }}>
      <summary>{retained.length} 处文字草稿尚未应用{retained.some(draft => Boolean(draft.issue)) ? '；请先处理原文变化' : '；保存时一并应用'}</summary>
      {retained.map(draft => <label key={draft.id} style={{ display: 'block', padding: 8 }}>
        原文：{draft.original}
        <textarea aria-label={`保留的 HTML 文字草稿：${draft.original}`} value={draft.value}
          onChange={event => textDrafts.changeRetained(draft.id, event.target.value)} style={{ display: 'block', width: '100%' }} />
        {draft.issue && <p role="alert">{draft.issue}</p>}
        <button type="button" onClick={() => textDrafts.discard(draft.id)}>放弃这份草稿</button>
      </label>)}
    </details>}
    <div className="html-document-editor__preview" hidden={mode !== 'preview'}>
      {lease ? <HtmlPreviewPane lease={lease} committed={committed} analysis={analysis} tabId={tabId} textDrafts={textDrafts} active={active && mode === 'preview'}
        target={target} onTargetChange={selectTarget}
        onUndo={onUndo} onRedo={onRedo} onSave={onSave} toolbarLeading={viewControls}
        pendingSourceDraft={source !== committedSource} onReloadRequest={() => reloadPreview.current?.()}
        reloadIssue={previewError} />
        : <p role={previewError ? 'alert' : 'status'}>{previewError ?? '正在准备 HTML 预览…'}{previewError && <button type="button" onClick={() => setRetry(value => value + 1)}>重试预览</button>}</p>}
    </div>
    {mode === 'source' && <div className="html-document-editor__source">
      {target?.authorKey && !sourceAddress && <p role="status">当前作者字段在这版源码中没有唯一的静态位置；可继续修改实现源码。</p>}
      <PlainTextDocumentEditor snapshot={committed} documentEpoch={committed.epoch} documentId={committed.documentId} active={active} ref={sourceEditor} source={source} revision={revision} onDraft={onDraft} onUndo={onUndo} onRedo={onRedo}
        onSelectionRange={range => selectTarget(range && source === committedSource ? { revision: range.revision, source: { kind: 'text', from: range.from, to: range.to } } : null)} />
    </div>}
  </div>
})
