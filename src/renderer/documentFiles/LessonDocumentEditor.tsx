import { documentSaveLabel } from '../lessonWorkspace/view/WorkspaceDocumentStatus'
import type { MarkdownProjection } from '../../shared/document/markdownIdentity'
import { captureMarkdownSelection, usePinnedSelection, workbenchSelection } from '../workbench/SelectionContextController'
import { TextAiButton, textCardLabel } from '../workbench/elementCards/ElementTextCards'
import { prepareDocumentTextEdit, requestDocumentSelection } from '../document/documentSelectionCommands'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../document/SharedDocumentEditor'
import type { ContextualEditTarget, DocumentContextSelection } from '../../shared/document/ports'
import { parseDocumentMarkdown, type MarkdownDocument } from '../../shared/document/markdown'
import { documentRefLabel, type DocumentFileRef } from '../../shared/document/ports'
import { DocumentFileSession, type RecoverableDocumentFilePort } from './documentFileSession'
import { PlainTextDocumentEditor, type PlainTextDocumentEditorHandle } from './PlainTextDocumentEditor'
import { HtmlDocumentEditor } from './html/HtmlDocumentEditor'
import { type DocumentConflictHunk } from './documentSourceMerge'
import './documentFileEditor.css'
import { fileClipboardResourcePort, readFileClipboardContext, selectedFileClipboardContext, type FileClipboardContext } from './fileDocumentClipboard'
import type { FilePreparedDocumentResources } from '../document/fileDocumentResources'
import type { DocumentBlock } from '../../shared/document/content'
import { resolveFileDocumentImage } from '../../shared/document/fileImageReference'
import { cancelEditPreview, useEditPreviews } from '../workbench/EditPreviewProjection'
import { mapMarkdownRange } from '../../core/tools/ToolTargets'
import { Redo2, Undo2 } from 'lucide-react'

export interface LessonDocumentEditorHandle {
  session: DocumentFileSession
  getContextualEditTarget(): ContextualEditTarget | null
  flush(): Promise<boolean>
  saveAs(): Promise<boolean>
  close(): Promise<boolean>
  preserveDraft(): Promise<boolean>
  preserveAndClose(): Promise<boolean>
}
export interface LessonDocumentEditorProps {
  documentRef: DocumentFileRef
  documentId?: string
  sessionKey?: string
  active?: boolean
  port: RecoverableDocumentFilePort
  onDirtyChange?(dirty: boolean): void
  onClosed?(): void
  onSelectionChange?(target: ContextualEditTarget | null): void
  onContextualCommand?(instruction: string, target: ContextualEditTarget): void
  onContextualDismiss?(target: ContextualEditTarget | null): void
}
const empty: MarkdownDocument = { content: { blocks: [] }, resources: { assets: [], components: [] } }
function ConflictHunk({ hunk, index, session }: { hunk: DocumentConflictHunk; index: number; session: DocumentFileSession }) {
  const [merged, setMerged] = useState(hunk.local)
  return <fieldset className="document-conflict-hunk"><legend>冲突 {index + 1}</legend>
    <p>其余不冲突的修改已保留，只选择这一处。</p>
    <div className="document-conflict-alternatives"><div><strong>当前稿</strong><pre>{hunk.contextBefore}<mark>{hunk.local || '（删除）'}</mark>{hunk.contextAfter}</pre><button type="button" onClick={() => { void session.resolveConflictHunk(hunk.id, 'local') }}>此处保留当前稿</button></div>
      <div><strong>磁盘稿</strong><pre>{hunk.contextBefore}<mark>{hunk.remote || '（删除）'}</mark>{hunk.contextAfter}</pre><button type="button" onClick={() => { void session.resolveConflictHunk(hunk.id, 'remote') }}>此处采用磁盘稿</button></div></div>
    <details><summary>手动合并这一处</summary><label>合并内容<textarea value={merged} onChange={event => setMerged(event.target.value)} /></label><button type="button" onClick={() => { void session.resolveConflictHunk(hunk.id, 'local', merged) }}>应用这一处合并</button></details>
  </fieldset>
}

export const LessonDocumentEditor = forwardRef<LessonDocumentEditorHandle, LessonDocumentEditorProps>(function LessonDocumentEditor({ documentRef, documentId, sessionKey, active = true, port, onDirtyChange, onClosed, onSelectionChange, onContextualCommand, onContextualDismiss }, ref) {
  const identity = sessionKey ?? JSON.stringify(documentRef)
  const session = useMemo(() => new DocumentFileSession(documentRef, port, documentId), [identity, port])
  const lifetime = useMemo(() => ({ leases: 0, opened: false }), [session])
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const editor = useRef<SharedDocumentEditorHandle>(null)
  const textEditor = useRef<PlainTextDocumentEditorHandle>(null)
  const htmlEditor = useRef<PlainTextDocumentEditorHandle>(null)
  const htmlTabId = useMemo(() => sessionKey ?? crypto.randomUUID(), [sessionKey])
  const [error, setError] = useState<string | null>(null)
  const [htmlPendingDraft, setHtmlPendingDraft] = useState(false)
  const pinned = usePinnedSelection(session.documentId)
  useEffect(() => {
    if (!session.documentId) return
    return workbenchSelection.registerSelectionClearer(session.documentId, targets => {
      editor.current?.clearSelection(targets); textEditor.current?.clearSelection(); htmlEditor.current?.clearSelection()
    })
  }, [session.documentId])
  useEffect(() => {
    if (!session.documentId) return
    return workbenchSelection.register(session.documentId, async () => {
      const current = session.committedDocument?.model.kind === 'markdown' ? await editor.current?.drainSource() : activeDraft()
      if (current && !current.ready) throw new Error('请先完成当前输入。')
      if (current) session.edit(current.source, operationGroup.current)
      if (!await session.drain()) throw new Error('正文输入尚未确认。')
      const committed = session.committedDocument
      if (!committed || current && ((committed.model.kind !== 'markdown' && committed.model.kind !== 'text') || committed.model.source !== current.source)) throw new Error('正文输入尚未确认。')
      return committed
    })
  }, [session, session.documentId])
  const committed = session.committedDocument
  const generations = useEditPreviews(session.documentId, committed?.revision)
  const editPreviews = useMemo(() => generations.flatMap(generation => {
    if (generation.target.kind !== 'markdown-range' && generation.target.kind !== 'text-selection' || committed?.model.kind !== 'markdown' || generation.epoch !== committed.epoch
      || generation.status === 'active' && generation.revision !== committed.revision) return []
    try {
      const committedSource = committed.model.source
      const target = generation.target.kind === 'markdown-range' ? mapMarkdownRange(committedSource, state.source, generation.target)
        : { ...generation.target, fragments: generation.target.fragments.map(fragment => {
          if (fragment.target.kind !== 'markdown-range') throw new Error('当前文件选区已改变。')
          return { ...fragment, target: mapMarkdownRange(committedSource, state.source, fragment.target) }
        }) }
      return [{ editId: generation.editId, sequence: generation.sequence, target, value: generation.value, cancel: () => { void cancelEditPreview(generation).catch(reason => setError((reason as Error).message)) } }]
    } catch { return [] }
  }), [generations, committed?.epoch, committed?.revision, committed?.model.kind, committed?.model.kind === 'markdown' ? committed.model.source : undefined, state.source])
  const lastProjection = useRef<MarkdownProjection | undefined>(undefined)
  const [clipboard, setClipboard] = useState<FileClipboardContext | null>(null)
  const operationGroup = useRef<string | undefined>(undefined)
  const draftTicket = useRef(0)
  const currentRef = session.ref
  const resolveImage = (href: string) => resolveFileDocumentImage(documentRefLabel(currentRef), href)
  const isText = committed?.model.kind === 'text'
  const isHtml = isText && /\.html?$/i.test(committed.binding.kind === 'file' ? committed.binding.path : committed.binding.suggestedName)
  const parsedSource = useMemo(() => {
    if (isText) return null
    const parsed = parseDocumentMarkdown(state.source, { createId: () => crypto.randomUUID(), target: 'file', resolveImage, previous: lastProjection.current })
    if (parsed.status === 'valid') lastProjection.current = parsed
    return parsed
  }, [state.source, currentRef, isText])
  const document = parsedSource?.status === 'valid' ? parsedSource.document : lastProjection.current?.document ?? empty
  useEffect(() => {
    lifetime.leases++
    if (!lifetime.opened) {
      lifetime.opened = true
      void session.open().catch(reason => { if (lifetime.leases) setError((reason as Error).message) })
    }
    // StrictMode immediately replays setup. Retain the live session for that replay;
    // a real unmount or identity change releases this specific session permanently.
    return () => { lifetime.leases--; queueMicrotask(() => { if (!lifetime.leases) session.dispose() }) }
  }, [session, lifetime])
  useEffect(() => { onDirtyChange?.(state.dirty || htmlPendingDraft) }, [state.dirty, htmlPendingDraft, onDirtyChange])

  const resourceKey = JSON.stringify(document.resources)
  useEffect(() => {
    if (isText) { setClipboard(null); return }
    let live = true; setClipboard(null)
    void readFileClipboardContext(document.resources, relativePath => session.readResource(relativePath)).then(context => { if (live) setClipboard(context) }).catch(reason => { if (live) setError((reason as Error).message) })
    return () => { live = false }
  }, [session, resourceKey, state.disk?.version.contentVersion, isText])
  function activeDraft() {
    const current = session.committedDocument
    if (current?.model.kind !== 'text') return editor.current?.flush()
    const name = current.binding.kind === 'file' ? current.binding.path : current.binding.suggestedName
    return (/\.html?$/i.test(name) ? htmlEditor.current : textEditor.current)?.flush()
  }
  async function flush() {
    const current = activeDraft()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.flush()
  }
  async function saveAs() {
    const current = activeDraft()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.saveAs()
  }
  async function preserveDraft() {
    const current = activeDraft()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.preserveDraft()
  }
  async function preserveAndClose() {
    const current = activeDraft()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.preserveAndClose()
  }
  function bindTarget(selection: DocumentContextSelection | null): ContextualEditTarget | null {
    const snapshot = session.getSnapshot()
    if (!selection || !snapshot.disk || snapshot.source !== selection.source) return null
    return { ...selection, ref: session.ref, baseVersion: snapshot.disk.version, epoch: session.epoch, scope: 'selection' }
  }
  function renderObject(block: DocumentBlock, container: HTMLElement) {
    const assetId = block.type === 'media' ? block.assetId : block.type === 'component' ? block.staticFallbackAssetId : null
    const asset = assetId ? clipboard?.assets[assetId] : null
    if (!asset) { container.textContent = block.type === 'chart' ? `图表：${block.chart.title ?? ''}` : '正在读取图示'; return }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(asset.bytes)], { type: asset.meta.mimeType }))
    const element = asset.meta.kind === 'audio' ? window.document.createElement('audio') : asset.meta.kind === 'video' ? window.document.createElement('video') : window.document.createElement('img')
    element.src = url; element.style.maxWidth = '100%'; element.style.maxHeight = '440px'
    if (element instanceof HTMLImageElement) element.alt = block.type === 'media' ? block.altText ?? asset.meta.filename : '互动组件静态图示'
    else element.controls = true
    container.append(element)
    return () => URL.revokeObjectURL(url)
  }
  useImperativeHandle(ref, () => ({ session, getContextualEditTarget: () => isText ? null : bindTarget(editor.current?.getContextualEditTarget() ?? null), flush, saveAs, preserveDraft, close: async () => {
    const current = activeDraft()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.close()
  }, preserveAndClose }))
  const status = state.conflict ? '存在文件冲突' : committed ? documentSaveLabel({ ...committed, dirty: state.dirty || htmlPendingDraft, saving: state.saving }) : '正在打开'
  const documentActions = <>
    <span role="status" className="lesson-document-status">{status}</span>
    <button type="button" aria-label="撤销" title="撤销" disabled={!committed?.undoDepth || state.saving || state.composing || Boolean(state.conflict) || state.recovery} onClick={() => { void session.undo() }}><Undo2 size={16} aria-hidden="true" /></button>
    <button type="button" aria-label="重做" title="重做" disabled={!committed?.redoDepth || state.saving || state.composing || Boolean(state.conflict) || state.recovery} onClick={() => { void session.redo() }}><Redo2 size={16} aria-hidden="true" /></button>
    <button type="button" disabled={state.saving || state.composing || Boolean(state.conflict) || state.recovery} onClick={() => { void flush() }}>保存</button>
    <label><input type="checkbox" checked={state.autoSave} disabled={state.saving || state.composing || Boolean(state.conflict) || state.recovery} onChange={event => session.setAutoSave(event.target.checked)} />自动保存</label>
    <details className="lesson-document-more"><summary aria-label="文档更多操作">文件</summary>
      <div className="lesson-document-more__menu">
      <button type="button" disabled={state.saving || state.composing || state.conflictHunks.length > 0} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void saveAs() }}>另存为</button>
      {committed?.undoHead?.actor === 'agent' && !state.recovery && !state.conflict && <button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void session.undoLatestAgent() }}>撤销最近 AI 修改</button>}
      </div>
    </details>
  </>
  return <section className={isHtml ? "lesson-document-editor--html" : undefined} aria-label={`教学文档 ${documentRefLabel(currentRef)}`} onCompositionStartCapture={() => session.setComposing(true)} onCompositionEndCapture={() => { queueMicrotask(() => session.setComposing(false)) }} onKeyDownCapture={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void (event.shiftKey ? saveAs() : flush()) }
  }}>
    {!isHtml && <header><strong>{documentRefLabel(currentRef)}</strong>{documentActions}</header>}
    {(error || state.error) && <div role="alert">{error ?? state.error}<button type="button" onClick={() => { void flush() }}>重试保存</button>{onClosed && <><button type="button" onClick={() => { void preserveAndClose().then(closed => { if (closed) onClosed() }) }}>保留恢复稿后关闭</button><button type="button" onClick={() => { void session.discardAndClose().then(closed => { if (closed) onClosed() }) }}>放弃未保存更改并关闭</button></>}</div>}
    {state.recovery && <aside role="alert">已找到未保存恢复稿，请比较后继续。{state.conflictHunks.length ? <span>请逐处处理下方冲突。</span> : <button type="button" onClick={() => { void session.resolveConflict('recovery') }}>保留恢复稿并保存</button>}</aside>}
    {state.conflict && <aside role="alert">
      <p>{state.conflict === 'deleted' ? '磁盘文档已删除，当前稿已保留。' : '磁盘稿与当前稿在同一处有修改，请比较后选择。'}</p>
      {state.conflictHunks.map((hunk, index) => <ConflictHunk key={hunk.id} hunk={hunk} index={index} session={session} />)}
      {!state.conflictHunks.length && <>{state.conflict !== 'deleted' && <><details><summary>查看磁盘稿</summary><pre>{state.conflict.source}</pre></details><button type="button" onClick={() => { void session.resolveConflict('disk') }}>采用磁盘稿</button></>}
      <button type="button" disabled={state.saving || state.composing || state.conflictHunks.length > 0} onClick={() => { void (state.conflict === 'deleted' ? saveAs() : session.resolveConflict('local')) }}>{state.conflict === 'deleted' ? '另存当前稿' : '保留当前稿并保存'}</button></>}
    </aside>}
    {isHtml && committed && <div className="lesson-document-editor__html-body" inert={state.conflictHunks.length > 0}><HtmlDocumentEditor ref={htmlEditor} active={active} tabId={htmlTabId} committed={committed} source={state.source} documentActions={documentActions} onPendingDraftChange={setHtmlPendingDraft} onDraft={source => { const ticket = ++draftTicket.current; queueMicrotask(() => { if (ticket === draftTicket.current) session.edit(source, operationGroup.current) }) }} onUndo={() => session.undo()} onRedo={() => session.redo()} onSave={() => { void flush() }} /></div>}
    {isText && !isHtml && committed && <div inert={state.conflictHunks.length > 0}><PlainTextDocumentEditor documentEpoch={committed.epoch} documentId={session.documentId ?? undefined} active={active} ref={textEditor} source={state.source} revision={committed.revision} onDraft={source => { const ticket = ++draftTicket.current; queueMicrotask(() => { if (ticket === draftTicket.current) session.edit(source, operationGroup.current) }) }} onUndo={() => session.undo()} onRedo={() => session.redo()} /></div>}
    {committed && committed.model.kind !== 'text' && parsedSource && <div inert={state.conflictHunks.length > 0}><SharedDocumentEditor ref={editor} cardDocumentId={session.documentId ?? undefined} active={active} document={document} revision={state.source} sourceDraft={state.source} target="file" initialMode={parsedSource.status === 'valid' ? 'layout' : 'source'} resolveImage={resolveImage}
      sourceMap={parsedSource.status === 'valid' ? parsedSource.sourceMap : undefined}
      editPreviews={editPreviews}
      clipboardContext={(resources: MarkdownDocument['resources']) => selectedFileClipboardContext(clipboard, resources)} clipboardResourcePort={fileClipboardResourcePort}
      renderObject={renderObject} objectRevision={clipboard}
      onDraft={source => { const ticket = ++draftTicket.current; queueMicrotask(() => { if (ticket === draftTicket.current) session.edit(source, operationGroup.current) }) }}
       onChange={(next, operation) => {
         if (operation.preparedResources) session.prepareAttachments((operation.preparedResources as FilePreparedDocumentResources).attachments)
         operationGroup.current = operation.historyGroup; return true
       }} pinnedTargets={pinned?.revision === committed?.revision && pinned?.epoch === committed?.epoch ? pinned?.targets : undefined}
       onContextualTargetChange={target => {
         onSelectionChange?.(bindTarget(target))
         const snapshot = session.committedDocument
         if (snapshot) { try { workbenchSelection.setManual(snapshot.documentId, target ? captureMarkdownSelection(snapshot, target) : null) } catch { workbenchSelection.setManual(snapshot.documentId, null) } }
       }}
       renderAiButton={(target, issue) => {
         // Selected text opens a text card (M15); objects and table cells keep the assistant.
         const documentId = session.documentId
         if (!documentId || target.selection && target.selection.kind !== 'text' || !target.ranges?.length) return undefined
         const label = textCardLabel(target.ranges.map(range => range.before).join(''))
         return <TextAiButton documentId={documentId} selectionIdentity={JSON.stringify(target.ranges.map(range => [range.from, range.to, range.before]))}
           disabledReason={issue} start={async () => {
           return prepareDocumentTextEdit(documentId, target, captureMarkdownSelection, label)
         }} />
       }}
       onContextualCommand={async (instruction, selection) => {
         if (!session.documentId) throw new Error('文档尚未就绪。')
         await requestDocumentSelection(session.documentId, selection, instruction, captureMarkdownSelection)
       }}
       onContextualDismiss={target => onContextualDismiss?.(bindTarget(target))} onUndo={() => session.undo()} onRedo={() => session.redo()} /></div>}
  </section>
})
