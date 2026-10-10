import { useEffect, useSyncExternalStore } from 'react'
import type { EditEvent, EditSessionSnapshot } from '../../shared/workbench/editSession'
import type { ExecutionDesktopAPI } from '../../shared/workbench/executionDesktop'

type PreviewAPI = Pick<ExecutionDesktopAPI, 'edits' | 'subscribeEdits' | 'stop'>
/** Volatile render state only. This store never dispatches document commands or saves source. */
export class EditPreviewProjection {
  private readonly values = new Map<string, EditSessionSnapshot>()
  private readonly cached = new Map<string, Map<number | undefined, readonly EditSessionSnapshot[]>>()
  private generation = 0
  private readonly terminal = new Set<string>()
  private readonly versions = new Map<string, number>()
  private readonly loading = new Map<string, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private unsubscribe?: () => void
  private frame?: number
  constructor(private readonly api: PreviewAPI) {}
  private notify(immediate = false) {
    if (immediate) {
      if (this.frame !== undefined) cancelAnimationFrame(this.frame)
      this.frame = undefined; for (const listener of this.listeners) listener()
    } else if (this.frame === undefined) this.frame = requestAnimationFrame(() => {
      this.frame = undefined; for (const listener of this.listeners) listener()
    })
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    this.unsubscribe ??= this.api.subscribeEdits(event => this.receive(event))
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) {
        this.unsubscribe?.(); this.unsubscribe = undefined
        if (this.frame !== undefined) cancelAnimationFrame(this.frame)
        this.frame = undefined; this.values.clear(); this.cached.clear(); this.loading.clear(); this.generation += 1
      }
    }
  }
  readAll(documentId: string | null | undefined, revision?: number): readonly EditSessionSnapshot[] {
    if (!documentId) return EMPTY_PREVIEWS
    const cached = this.cached.get(documentId)
    const observed = cached?.get(revision)
    if (observed) return observed
    const values = [...this.values.values()].filter(value => value.documentId === documentId && value.status !== 'aborted'
      && (value.status !== 'finished' || revision !== undefined && revision < value.revision))
    // Multiple mounted consumers may observe the same document at different
    // canonical revisions; each getSnapshot must retain its array identity.
    const result = values.length ? [...(cached?.values() ?? [])].find(current => current.length === values.length
      && current.every((value, index) => value === values[index])) ?? values : EMPTY_PREVIEWS
    const revisions = cached ?? new Map<number | undefined, readonly EditSessionSnapshot[]>()
    revisions.set(revision, result); this.cached.set(documentId, revisions)
    return result
  }
  /** Single-preview adapter for existing consumers; canonical editors use readAll/useEditPreviews. */
  read(documentId: string | null | undefined, revision?: number): EditSessionSnapshot | null {
    return this.readAll(documentId, revision)[0] ?? null
  }
  receive(event: EditEvent) {
    const next = event.snapshot, current = this.values.get(next.editId)
    this.versions.set(next.editId, (this.versions.get(next.editId) ?? 0) + 1)
    this.cached.delete(next.documentId)
    if (event.type !== 'edit.changed') {
      this.terminal.add(next.editId)
      if (event.type === 'edit.finished') this.values.set(next.editId, structuredClone(next))
      else this.values.delete(next.editId)
      this.notify(true); return
    }
    if (this.terminal.has(next.editId)) return
    if (current?.editId === next.editId && (next.sequence < current.sequence || next.revision < current.revision)) return
    this.values.set(next.editId, structuredClone(next)); this.notify()
  }
  attach(documentId: string): Promise<void> {
    const pending = this.loading.get(documentId)
    if (pending) return pending
    const versions = new Map(this.versions), generation = this.generation
    const load = this.api.edits(documentId).then(values => {
      if (!this.listeners.size || this.generation !== generation) return
      for (const value of values) if (value.documentId === documentId && value.status === 'active' && !this.terminal.has(value.editId)
        && (this.versions.get(value.editId) ?? 0) === (versions.get(value.editId) ?? 0)) this.values.set(value.editId, structuredClone(value))
      this.cached.delete(documentId); this.notify()
    }).finally(() => { if (this.loading.get(documentId) === load) this.loading.delete(documentId) })
    this.loading.set(documentId, load); return load
  }
}
const EMPTY_PREVIEWS: readonly EditSessionSnapshot[] = Object.freeze([])
const clients = new WeakMap<PreviewAPI, EditPreviewProjection>()
const emptySubscribe = () => () => undefined
const api = () => typeof window === 'undefined' ? undefined : window.desktopAPI?.execution
export function useEditPreviews(documentId: string | null | undefined, canonicalRevision?: number): readonly EditSessionSnapshot[] {
  const host = api()
  let client = host ? clients.get(host) : undefined
  if (host && !client) { client = new EditPreviewProjection(host); clients.set(host, client) }
  const value = useSyncExternalStore(client?.subscribe ?? emptySubscribe, () => client?.readAll(documentId, canonicalRevision) ?? EMPTY_PREVIEWS)
  useEffect(() => { if (documentId) void client?.attach(documentId).catch(() => { /* A disconnected host exposes no speculative preview. */ }) }, [client, documentId])
  return value
}
export function useEditPreview(documentId: string | null | undefined, canonicalRevision?: number): EditSessionSnapshot | null {
  return useEditPreviews(documentId, canonicalRevision)[0] ?? null
}
export async function cancelEditPreview(preview: EditSessionSnapshot): Promise<void> { await api()?.stop(preview.runId) }
