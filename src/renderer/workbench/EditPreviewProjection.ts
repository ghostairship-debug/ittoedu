import { useEffect, useSyncExternalStore } from 'react'
import type { EditEvent, EditSessionSnapshot } from '../../shared/workbench/editSession'
import type { ExecutionDesktopAPI } from '../../shared/workbench/executionDesktop'

type PreviewAPI = Pick<ExecutionDesktopAPI, 'edits' | 'subscribeEdits' | 'stop'>
/** Volatile render state only. This store never dispatches document commands or saves source. */
export class EditPreviewProjection {
  private readonly values = new Map<string, EditSessionSnapshot>()
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
        this.frame = undefined; this.values.clear(); this.loading.clear()
      }
    }
  }
  read(documentId: string | null | undefined, revision?: number): EditSessionSnapshot | null {
    const value = documentId ? this.values.get(documentId) : undefined
    if (!value || value.status === 'aborted') return null
    if (value.status === 'finished' && (revision === undefined || revision >= value.revision)) return null
    return value
  }
  receive(event: EditEvent) {
    const next = event.snapshot, current = this.values.get(next.documentId)
    this.versions.set(next.documentId, (this.versions.get(next.documentId) ?? 0) + 1)
    if (event.type !== 'edit.changed') {
      this.terminal.add(next.editId)
      if (current?.editId === next.editId) {
        if (event.type === 'edit.finished') this.values.set(next.documentId, structuredClone(next))
        else this.values.delete(next.documentId)
      }
      this.notify(true); return
    }
    if (this.terminal.has(next.editId)) return
    if (current?.editId === next.editId && (next.sequence < current.sequence || next.revision < current.revision)) return
    this.values.set(next.documentId, structuredClone(next)); this.notify()
  }
  attach(documentId: string): Promise<void> {
    const pending = this.loading.get(documentId)
    if (pending) return pending
    const version = this.versions.get(documentId) ?? 0
    const load = this.api.edits(documentId).then(values => {
      if (!this.listeners.size || (this.versions.get(documentId) ?? 0) !== version) return
      for (const value of values) if (value.status === 'active' && !this.terminal.has(value.editId)) this.values.set(documentId, structuredClone(value))
      this.notify()
    }).finally(() => { if (this.loading.get(documentId) === load) this.loading.delete(documentId) })
    this.loading.set(documentId, load); return load
  }
}
const clients = new WeakMap<PreviewAPI, EditPreviewProjection>()
const emptySubscribe = () => () => undefined
const api = () => typeof window === 'undefined' ? undefined : window.desktopAPI?.execution
export function useEditPreview(documentId: string | null | undefined, canonicalRevision?: number): EditSessionSnapshot | null {
  const host = api()
  let client = host ? clients.get(host) : undefined
  if (host && !client) { client = new EditPreviewProjection(host); clients.set(host, client) }
  const value = useSyncExternalStore(client?.subscribe ?? emptySubscribe, () => client?.read(documentId, canonicalRevision) ?? null)
  useEffect(() => { if (documentId) void client?.attach(documentId).catch(() => { /* A disconnected host exposes no speculative preview. */ }) }, [client, documentId])
  return value
}
export async function cancelEditPreview(preview: EditSessionSnapshot): Promise<void> { await api()?.stop(preview.runId) }
