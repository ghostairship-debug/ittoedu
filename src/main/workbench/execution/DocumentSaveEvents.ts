import { createHash } from 'node:crypto'
import type { DocumentHostService, DocumentSaveFact } from '../DocumentHostService'
import type { ExecutionDesktopService } from './ExecutionDesktopService'
import type { ExecutionEvent } from '../../../shared/workbench/executionEvents'
import { captureMainTiming } from './ExecutionEventStore'

interface CommitLink { conversationId: string; taskId: string; runId: string; source: ExecutionEvent['source']; firstRevision: number }
type TimedSave<T extends DocumentSaveFact = DocumentSaveFact> = { fact: T; stamp: ReturnType<typeof captureMainTiming> }
interface SaveProjectionOptions {
  documents: Pick<DocumentHostService, 'subscribeSaves'>
  execution: Pick<ExecutionDesktopService, 'events' | 'conversations' | 'appendExternalEvent'>
  onError?(error: unknown): void
}

/** An ephemeral index of the existing durable event log, never a second document/save writer. */
export function installDocumentSaveEvents({ documents, execution, onError }: SaveProjectionOptions) {
  const links = new Map<string, Map<string, CommitLink>>()
  const latest = new Map<string, TimedSave>()
  const lastStarted = new Map<string, TimedSave<Extract<DocumentSaveFact, { status: 'saving' }>>>()
  const lastSaved = new Map<string, TimedSave<Extract<DocumentSaveFact, { status: 'saved' }>>>()
  const pending = new Set<Promise<void>>()
  const workspaces = new Map<string, string>()
  let tail = Promise.resolve()
  let stopped = false, initialization: Promise<void> | undefined
  const report = (error: unknown) => { try { onError?.(error) } catch { /* Diagnostics cannot affect a user save. */ } }
  const schedule = (work: () => Promise<void>) => {
    if (stopped) return
    const job = tail.then(work).catch(report)
    tail = job
    pending.add(job)
    void job.finally(() => pending.delete(job))
  }
  const index = (event: ExecutionEvent): CommitLink | undefined => {
    if (event.type !== 'document.commit' || !event.data.documentId || event.data.revision === undefined
      || !['applied', 'unchanged'].includes(event.data.applicationStatus ?? event.data.status ?? '')) return
    const document = links.get(event.data.documentId) ?? new Map<string, CommitLink>()
    const key = JSON.stringify([event.conversationId, event.runId])
    const prior = document.get(key)
    const link = { conversationId: event.conversationId, taskId: event.taskId, runId: event.runId, source: event.source,
      firstRevision: Math.min(prior?.firstRevision ?? event.data.revision, event.data.revision) }
    document.set(key, link); links.set(event.data.documentId, document)
    return link
  }
  const ready = () => initialization ??= (async () => {
    // One lazy recovery pass. Subsequent saves use the durable append subscription.
    for (const workspace of await execution.conversations.listWorkspaces()) {
      for (const conversation of await execution.conversations.listConversations(workspace.workspaceId)) {
        workspaces.set(conversation.conversationId, workspace.workspaceId)
        let cursor = 0
        for (;;) {
          const page = await execution.events.readPage({ conversationId: conversation.conversationId, after: cursor, limit: 500 })
          for (const event of page.events) index(event)
          cursor = page.cursor
          if (!page.hasMore) break
        }
      }
    }
  })().catch(error => { initialization = undefined; throw error })
  const conversationExists = async (conversationId: string) => {
    const known = workspaces.get(conversationId)
    if (known) return Boolean(await execution.conversations.readConversation({ workspaceId: known, conversationId }))
    for (const workspace of await execution.conversations.listWorkspaces()) {
      for (const conversation of await execution.conversations.listConversations(workspace.workspaceId)) workspaces.set(conversation.conversationId, workspace.workspaceId)
    }
    return workspaces.has(conversationId)
  }
  const publish = async ({ fact, stamp }: TimedSave, link: CommitLink) => {
    if (stopped || !(await conversationExists(link.conversationId))) return
    const revision = fact.status === 'saved' ? fact.savedRevision : fact.revision
    if (link.firstRevision > revision) return
    {
      // The saving fact is emitted before disk persistence; terminal facts follow the disk/journal result.
      // Retain each Main monotonic instant even if commit association arrives later.
      const recording = execution.events.recordTiming({ conversationId: link.conversationId, taskId: link.taskId,
        runId: link.runId, markId: `${fact.saveId}:${link.runId}:save:${fact.status}`,
        stage: fact.status === 'saving' ? 'save.started' : 'save.finished',
        ...stamp, sourceWallTimeMs: fact.time, detail: { documentId: fact.documentId, saveStatus: fact.status,
          outcome: fact.status === 'saving' ? 'started' : fact.status === 'saved' ? 'completed' : 'failed' } }).catch(report)
      pending.add(recording); void recording.finally(() => pending.delete(recording))
    }
    const key = createHash('sha256').update(JSON.stringify([link.conversationId, link.runId])).digest('hex')
    await execution.appendExternalEvent({
      eventId: `document-save:${fact.saveId}:${fact.status}:${key}`, itemId: `document-save:${fact.saveId}`,
      conversationId: link.conversationId, taskId: link.taskId, runId: link.runId, source: link.source,
      type: 'document.save', update: 'snapshot', time: fact.time,
      data: { documentId: fact.documentId, documentName: fact.documentName, revision, saveStatus: fact.status,
        label: fact.status === 'saved' ? '文件已保存' : fact.status === 'saving' ? '正在保存文件' : '文件保存失败',
        ...(fact.status === 'saved' && fact.currentRevision > fact.savedRevision ? { text: `已保存版本 ${fact.savedRevision}，后续修改仍未保存。` } : {}),
        ...(fact.status === 'failed' ? { error: fact.error } : {}),
      },
    })
  }
  const stopEvents = execution.events.subscribe(event => {
    const link = index(event)
    const timed = event.data.documentId ? latest.get(event.data.documentId) : undefined
    // Commit publication can lag behind a real disk save. Only associate once that commit exists.
    if (link && timed) schedule(async () => {
      await ready()
      const started = lastStarted.get(timed.fact.documentId)
      if (started && started.fact.saveId === timed.fact.saveId) await publish(started, link)
      const saved = lastSaved.get(timed.fact.documentId)
      if (saved && saved.fact.saveId !== timed.fact.saveId) await publish(saved, link)
      await publish(timed, link)
    })
  })
  const stopSaves = documents.subscribeSaves(fact => {
    const stamp = captureMainTiming(), timed = { fact, stamp }
    latest.set(fact.documentId, timed)
    if (fact.status === 'saving') lastStarted.set(fact.documentId, { fact, stamp })
    if (fact.status === 'saved') lastSaved.set(fact.documentId, { fact, stamp })
    schedule(async () => {
      await ready()
      for (const link of links.get(fact.documentId)?.values() ?? []) {
        const started = lastStarted.get(fact.documentId)
        if (fact.status !== 'saving' && started?.fact.saveId === fact.saveId) await publish(started, link)
        await publish(timed, link)
      }
    })
  })
  return {
    async flush() { while (pending.size) await Promise.all([...pending]) },
    dispose() { stopped = true; stopSaves(); stopEvents(); links.clear(); latest.clear(); lastStarted.clear(); lastSaved.clear() },
  }
}
