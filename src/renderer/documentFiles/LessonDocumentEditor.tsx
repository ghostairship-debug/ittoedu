import { documentSaveLabel } from '../lessonWorkspace/view/WorkspaceDocumentStatus'
import type { MarkdownProjection } from '../../shared/document/markdownIdentity'
import { captureMarkdownSelection, usePinnedSelection, workbenchSelection } from '../workbench/SelectionContextController'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../document/SharedDocumentEditor'
import type { ContextualEditTarget, DocumentContextSelection } from '../../shared/document/ports'
import { parseDocumentMarkdown, type MarkdownDocument } from '../../shared/document/markdown'
import { documentRefLabel, type DocumentFileRef } from '../../shared/document/ports'
import { DocumentFileSession, type RecoverableDocumentFilePort } from './documentFileSession'
import { type DocumentConflictHunk } from './documentSourceMerge'
import './documentFileEditor.css'
import { fileClipboardResourcePort, readFileClipboardContext, selectedFileClipboardContext, type FileClipboardContext } from './fileDocumentClipboard'
import type { FilePreparedDocumentResources } from '../document/fileDocumentResources'
import type { DocumentBlock } from '../../shared/document/content'
import { resolveFileDocumentImage } from '../../shared/document/fileImageReference'
import { cancelEditPreview, useEditPreview } from '../workbench/EditPreviewProjection'
import { mapMarkdownRange } from '../../core/tools/ToolTargets'

export interface LessonDocumentEditorHandle {
  session: DocumentFileSession
  getContextualEditTarget(): ContextualEditTarget | null
  flush(): Promise<boolean>
  saveAs(): Promise<boolean>
  close(): Promise<boolean>
  preserveAndClose(): Promise<boolean>
}
export interface LessonDocumentEditorProps {
  documentRef: DocumentFileRef
  documentId?: string
  sessionKey?: string
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

export const LessonDocumentEditor = forwardRef<LessonDocumentEditorHandle, LessonDocumentEditorProps>(function LessonDocumentEditor({ documentRef, documentId, sessionKey, port, onDirtyChange, onClosed, onSelectionChange, onContextualCommand, onContextualDismiss }, ref) {
  const identity = sessionKey ?? JSON.stringify(documentRef)
  const session = useMemo(() => new DocumentFileSession(documentRef, port, documentId), [identity, port])
  const lifetime = useMemo(() => ({ leases: 0, opened: false }), [session])
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const editor = useRef<SharedDocumentEditorHandle>(null)
  const [error, setError] = useState<string | null>(null)
  const pinned = usePinnedSelection(session.documentId)
  useEffect(() => {
    if (!session.documentId) return
    return workbenchSelection.register(session.documentId, async () => {
      const current = editor.current?.flush()
      if (current && !current.ready) throw new Error('请先完成当前输入。')
      if (current) session.edit(current.source, operationGroup.current)
      if (!await session.drain() || !session.committedDocument) throw new Error('正文输入尚未确认。')
      return session.committedDocument
    })
  }, [session, session.documentId])
  const committed = session.committedDocument
  const generation = useEditPreview(session.documentId, committed?.revision)
  const editPreview = useMemo(() => {
    if (!generation || generation.target.kind !== 'markdown-range' || committed?.model.kind !== 'markdown' || generation.epoch !== committed.epoch
      || generation.status === 'active' && generation.revision !== committed.revision) return undefined
    try {
      const target = mapMarkdownRange(committed.model.source, state.source, generation.target)
      return { editId: generation.editId, sequence: generation.sequence, target, value: generation.value, cancel: () => { void cancelEditPreview(generation).catch(reason => setError((reason as Error).message)) } }
    } catch { return undefined }
  }, [generation, committed, state.source])
  const lastProjection = useRef<MarkdownProjection | undefined>(undefined)
  const [clipboard, setClipboard] = useState<FileClipboardContext | null>(null)
  const operationGroup = useRef<string | undefined>(undefined)
  const draftTicket = useRef(0)
  const currentRef = session.ref
  const resolveImage = (href: string) => resolveFileDocumentImage(documentRefLabel(currentRef), href)
  const parsedSource = useMemo(() => {
    const parsed = parseDocumentMarkdown(state.source, { createId: () => crypto.randomUUID(), target: 'file', resolveImage, previous: lastProjection.current })
    if (parsed.status === 'valid') lastProjection.current = parsed
    return parsed
  }, [state.source, currentRef])
  const document = parsedSource.status === 'valid' ? parsedSource.document : lastProjection.current?.document ?? empty
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
  useEffect(() => { onDirtyChange?.(state.dirty) }, [state.dirty, onDirtyChange])

  const resourceKey = JSON.stringify(document.resources)
  useEffect(() => {
    let live = true; setClipboard(null)
    void readFileClipboardContext(document.resources, relativePath => session.readResource(relativePath)).then(context => { if (live) setClipboard(context) }).catch(reason => { if (live) setError((reason as Error).message) })
    return () => { live = false }
  }, [session, resourceKey, state.disk?.version.contentVersion])
  async function flush() {
    const current = editor.current?.flush()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.flush()
  }
  async function saveAs() {
    const current = editor.current?.flush()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.saveAs()
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
  useImperativeHandle(ref, () => ({ session, getContextualEditTarget: () => bindTarget(editor.current?.getContextualEditTarget() ?? null), flush, saveAs, close: async () => {
    const current = editor.current?.flush()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.close()
  }, preserveAndClose: () => session.preserveAndClose() }))
  const status = state.conflict ? '存在文件冲突' : committed ? documentSaveLabel({ ...committed, dirty: state.dirty, saving: state.saving }) : '正在打开'
  return <section aria-label={`教学文档 ${documentRefLabel(currentRef)}`} onCompositionStartCapture={() => session.setComposing(true)} onCompositionEndCapture={() => { queueMicrotask(() => session.setComposing(false)) }} onKeyDownCapture={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void (event.shiftKey ? saveAs() : flush()) }
  }}>
     <header><strong>{documentRefLabel(currentRef)}</strong> <span role="status">{status}</span> <button type="button" disabled={state.saving || state.composing || Boolean(state.conflict) || state.recovery} onClick={() => { void flush() }}>保存</button> <button type="button" disabled={state.saving || state.composing || state.conflictHunks.length > 0} onClick={() => { void saveAs() }}>另存为</button>{committed?.undoHead?.actor === 'agent' && !state.recovery && !state.conflict && !editPreview && <button type="button" onClick={() => { void session.undoLatestAgent() }}>撤销最近 AI 修改</button>}</header>
    {(error || state.error) && <div role="alert">{error ?? state.error}<button type="button" onClick={() => { void flush() }}>重试保存</button>{onClosed && <button type="button" onClick={() => { void session.preserveAndClose().then(closed => { if (closed) onClosed() }) }}>保留恢复稿后关闭</button>}</div>}
    {state.recovery && <aside role="alert">已找到未保存恢复稿，请比较后继续。{state.conflictHunks.length ? <span>请逐处处理下方冲突。</span> : <button type="button" onClick={() => { void session.resolveConflict('recovery') }}>保留恢复稿并保存</button>}</aside>}
    {state.conflict && <aside role="alert">
      <p>{state.conflict === 'deleted' ? '磁盘文档已删除，当前稿已保留。' : '磁盘稿与当前稿在同一处有修改，请比较后选择。'}</p>
      {state.conflictHunks.map((hunk, index) => <ConflictHunk key={hunk.id} hunk={hunk} index={index} session={session} />)}
      {!state.conflictHunks.length && <>{state.conflict !== 'deleted' && <><details><summary>查看磁盘稿</summary><pre>{state.conflict.source}</pre></details><button type="button" onClick={() => { void session.resolveConflict('disk') }}>采用磁盘稿</button></>}
      <button type="button" disabled={state.saving || state.composing || state.conflictHunks.length > 0} onClick={() => { void (state.conflict === 'deleted' ? saveAs() : session.resolveConflict('local')) }}>{state.conflict === 'deleted' ? '另存当前稿' : '保留当前稿并保存'}</button></>}
    </aside>}
    {committed && <div inert={state.conflictHunks.length > 0}><SharedDocumentEditor ref={editor} document={document} revision={state.source} sourceDraft={state.source} target="file" initialMode={parsedSource.status === 'valid' ? 'layout' : 'source'} resolveImage={resolveImage}
      sourceMap={parsedSource.status === 'valid' ? parsedSource.sourceMap : undefined}
      editPreview={editPreview}
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
       onContextualCommand={async (instruction, selection) => {
         if (!session.documentId) throw new Error('文档尚未就绪。')
         const snapshot = await workbenchSelection.prepare(session.documentId)
         await workbenchSelection.request(captureMarkdownSelection(snapshot, selection), instruction)
       }}
       onContextualDismiss={target => onContextualDismiss?.(bindTarget(target))} onUndo={() => session.undo()} onRedo={() => session.redo()} /></div>}
  </section>
})
