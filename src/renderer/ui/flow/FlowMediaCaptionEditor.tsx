import { useEffect, useRef, useState } from 'react'
import { DocumentSession } from '../../../core/documents/DocumentSession'
import { MarkdownDriver } from '../../../core/drivers/MarkdownDriver'
import type { FlowTextContent } from '../../../shared/document/content'
import type { DocumentResources } from '../../../shared/document/resources'
import { parseDocumentMarkdown, serializeDocumentMarkdown, type MarkdownDocument } from '../../../shared/document/markdown'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../document'

type CaptionSource = { source: string; revision: number }

/** The existing Session owns only this temporary source, never the course project. */
function createCaptionDraft(source: string) {
  let disposed = false
  const ready = DocumentSession.create({ documentId: `caption-${crypto.randomUUID()}`, epoch: crypto.randomUUID(),
    model: { kind: 'markdown', source, resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: '说明文字.md' } },
    new MarkdownDriver(), { append: async () => {}, save: async () => { throw new Error('说明文字草稿只在确认时提交到课件') } })
  let queued = Promise.resolve()
  const read = (session: DocumentSession): CaptionSource => {
    const snapshot = session.read()
    if (snapshot.model.kind !== 'markdown') throw new Error('说明文字草稿类型已改变')
    return { source: snapshot.model.source, revision: snapshot.revision }
  }
  const enqueue = (work: (session: DocumentSession) => Promise<void>) => {
    const result = queued.then(async () => {
      const session = await ready
      if (!disposed) await work(session)
      return read(session)
    })
    queued = result.then(() => {}, () => {})
    return result
  }
  const execute = async (session: DocumentSession, mutation: Parameters<DocumentSession['execute']>[0]['mutation'], historyGroup?: string) => {
    const snapshot = session.read()
    const result = await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: crypto.randomUUID(), actor: 'human', historyGroup, mutation })
    if (result.status !== 'applied' && result.status !== 'unchanged') throw new Error('message' in result ? result.message : '说明文字草稿操作未应用')
  }
  return {
    edit: (next: string, historyGroup?: string) => enqueue(async session => {
      if (read(session).source !== next) await execute(session, { type: 'command', command: { type: 'markdown.replace', source: next } }, historyGroup)
    }),
    history: (direction: 'undo' | 'redo') => enqueue(session => execute(session, { type: direction })),
    drain: () => enqueue(async session => { await session.drain() }),
    dispose: async () => { disposed = true; await queued; await (await ready).close({ discardDirty: true }) },
  }
}

export function FlowMediaCaptionEditor({ content, resources, onConfirm, onCancel }: {
  content: FlowTextContent
  resources: DocumentResources
  onConfirm(content: FlowTextContent): void | Promise<void>
  onCancel(): void
}) {
  const [value, setValue] = useState(() => {
    const document: MarkdownDocument = { content: { blocks: [{ id: 'caption', type: 'paragraph', content }] }, resources }
    return { document, source: serializeDocumentMarkdown(document, 'flow'), revision: 'caption' }
  })
  const initialSource = useRef(value.source), latestSource = useRef(value.source)
  const editor = useRef<SharedDocumentEditorHandle>(null), draft = useRef<ReturnType<typeof createCaptionDraft> | null>(null)
  const [error, setError] = useState<string | null>(null), [confirming, setConfirming] = useState(false)
  useEffect(() => {
    const owner = createCaptionDraft(initialSource.current); draft.current = owner
    return () => { draft.current = null; void owner.dispose().catch(() => {}) }
  }, [])
  const report = (owner: ReturnType<typeof createCaptionDraft>, failure: unknown) => {
    if (draft.current === owner) setError(failure instanceof Error ? failure.message : String(failure))
  }
  const stage = (source: string, historyGroup?: string) => {
    const owner = draft.current
    if (owner) void owner.edit(source, historyGroup).catch(failure => report(owner, failure))
  }
  const history = (direction: 'undo' | 'redo') => {
    const owner = draft.current
    if (!owner) return
    // Invalid source remains editable and undoable; it is not a formal commit.
    void owner.history(direction).then(snapshot => {
      if (draft.current !== owner) return
      const parsed = parseDocumentMarkdown(snapshot.source, { target: 'flow', createId: () => crypto.randomUUID() })
      latestSource.current = snapshot.source
      setValue(previous => ({ document: parsed.status === 'valid' ? parsed.document : previous.document, source: snapshot.source, revision: String(snapshot.revision) }))
      setError(null)
    }).catch(failure => report(owner, failure))
  }
  const confirm = async () => {
    const owner = draft.current, flushed = editor.current?.flush()
    if (!owner || !flushed) return
    if (!flushed.ready || flushed.diagnostics.length) { setError(flushed.diagnostics[0]?.message ?? '请先完成当前输入'); return }
    setConfirming(true)
    try {
      await owner.edit(flushed.source)
      const snapshot = await owner.drain()
      if (draft.current !== owner) return
      const parsed = parseDocumentMarkdown(snapshot.source, { target: 'flow', createId: () => crypto.randomUUID() })
      if (parsed.status !== 'valid') { setError(parsed.diagnostics[0]?.message ?? '说明文字尚未完成'); return }
      const inlines: FlowTextContent['inlines'] = []
      for (const [index, block] of parsed.document.content.blocks.entries()) {
        if (block.type !== 'paragraph') { setError('说明文字可包含文字与行内公式，独立正文对象请放在正文中'); return }
        if (index) inlines.push({ type: 'text', text: '\n' })
        inlines.push(...block.content.inlines)
      }
      await onConfirm({ inlines })
    } catch (failure) { report(owner, failure) }
    finally { if (draft.current === owner) setConfirming(false) }
  }
  return <div role="dialog" aria-label="媒体说明文字" style={{position:'absolute',inset:24,zIndex:20,background:'#fff',padding:24}}>
    <SharedDocumentEditor ref={editor} document={value.document} revision={value.revision} sourceDraft={value.source} initialMode="layout" target="flow" readOnly={confirming}
      onDraft={(source, diagnostics) => {
        latestSource.current = source; setValue(previous => ({ ...previous, source })); setError(null)
        if (diagnostics.length) stage(source)
      }}
      onChange={(next, operation) => {
        setValue(previous => ({ ...previous, document: next, source: latestSource.current }))
        stage(latestSource.current, operation.historyGroup); return true
      }} onUndo={() => history('undo')} onRedo={() => history('redo')} />
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={confirming} onClick={() => { const owner=draft.current;draft.current=null;if(owner)void owner.dispose().catch(() => {});onCancel() }}>取消</button>
    <button type="button" disabled={confirming} onClick={() => { void confirm() }}>确认说明</button>
  </div>
}
