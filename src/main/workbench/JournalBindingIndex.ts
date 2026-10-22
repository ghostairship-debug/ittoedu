import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentBinding, DocumentDisposition, DocumentKind, DurableDocumentState } from '../../shared/workbench/document'

export interface JournalBindingMetadata {
  documentId: string; sequence: number; epoch: string; revision: number; savedRevision: number | null
  kind: DocumentKind; binding: DocumentBinding; offset: number; identity: string
  disposition: DocumentDisposition
  title?: string
  projectId?: string
  undoDepth?: number
  redoDepth?: number
  /** Reservation only when the underlying journal is unreadable; never a recovery snapshot. */
  unavailable?: boolean
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
export async function journalIdentity(filename: string): Promise<string | null> {
  try {
    const s = await fs.stat(filename, { bigint: true })
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

/** Rebuildable metadata, never a document writer. A changed journal invalidates its index. */
export class JournalBindingIndex {
  private readonly memory = new Map<string, JournalBindingMetadata>()
  private readonly pending = new Map<string, JournalBindingMetadata>()
  private readonly writing = new Map<string, Promise<void>>()
  async read(filename: string, allowStale = false): Promise<JournalBindingMetadata | null> {
    const identity = await journalIdentity(filename)
    if (!identity) { this.memory.delete(filename); return null }
    const known = this.memory.get(filename)
    if (known && (known.identity === identity || allowStale)) return structuredClone(known)
    this.memory.delete(filename)
    try {
      const indexFile = `${filename}.binding.json`
      if ((await fs.stat(indexFile)).size > 256 * 1024) return null
      const envelope = JSON.parse(await fs.readFile(indexFile, 'utf8'))
      if (![1, 2].includes(envelope.version) || typeof envelope.body !== 'string' || hash(envelope.body) !== envelope.digest) return null
      const entry = JSON.parse(envelope.body) as JournalBindingMetadata
      if (envelope.version === 1 && entry.disposition !== undefined
        || envelope.version === 2 && !['active', 'closed', 'discarded'].includes(entry.disposition)) return null
      entry.disposition ??= 'active'
      if ((!allowStale && entry.identity !== identity) || typeof entry.documentId !== 'string'
        || path.basename(filename) !== `${hash(entry.documentId)}.journal`
        || !Number.isSafeInteger(entry.offset) || entry.offset < 0
        || !Number.isSafeInteger(entry.sequence) || entry.sequence < 0
        || !Number.isSafeInteger(entry.revision) || !entry.epoch
        || !['text', 'markdown', 'course-v9', 'course-v10'].includes(entry.kind)
        || !entry.binding || !['file', 'untitled'].includes(entry.binding.kind)
        || entry.binding.kind === 'file' && (!path.isAbsolute(entry.binding.path)
          || !Number.isSafeInteger(entry.binding.bindingVersion))) return null
      this.memory.set(filename, entry)
      return structuredClone(entry)
    } catch { return null /* Missing/stale index must be rebuilt from the authoritative journal. */ }
  }

  async update(filename: string, state: DurableDocumentState, offset: number, capturedIdentity?: string | null): Promise<void> {
    const identity = capturedIdentity === undefined ? await journalIdentity(filename) : capturedIdentity
    if (!identity) { this.memory.delete(filename); this.pending.delete(filename); return }
    const entry: JournalBindingMetadata = { documentId: state.documentId, sequence: state.sequence,
      epoch: state.epoch, revision: state.revision, savedRevision: state.savedRevision,
      kind: state.model.kind, binding: structuredClone(state.binding), offset, identity, disposition: state.disposition ?? 'active',
      title: state.model.kind === 'course-v9' || state.model.kind === 'course-v10' ? state.model.project.title
        : state.binding.kind === 'untitled' ? state.binding.suggestedName : path.basename(state.binding.path),
      ...(state.model.kind === 'course-v9' || state.model.kind === 'course-v10' ? { projectId: state.model.project.id } : {}),
      undoDepth: state.past.length, redoDepth: state.future.length }
    this.memory.set(filename, entry)
    // The journal and its captured identity are already durable. Only the small,
    // rebuildable metadata is retained while optional disk maintenance catches up.
    this.pending.set(filename, entry)
    this.schedule(filename)
  }

  private schedule(filename: string): void {
    if (this.writing.has(filename)) return
    const writing = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      while (true) {
        const entry = this.pending.get(filename)
        if (!entry) return
        this.pending.delete(filename)
        await this.persist(filename, entry)
      }
    }).finally(() => {
      if (this.writing.get(filename) === writing) this.writing.delete(filename)
      if (this.pending.has(filename)) this.schedule(filename)
    })
    this.writing.set(filename, writing)
    void writing.catch(() => undefined)
  }

  private async persist(filename: string, entry: JournalBindingMetadata): Promise<void> {
    const { identity } = entry
    const body = JSON.stringify(entry), temporary = `${filename}.binding-${randomUUID()}.tmp`
    try {
      if (await journalIdentity(filename) !== identity) return
      const file = await fs.open(temporary, 'wx')
      try { await file.writeFile(JSON.stringify({ version: 2, body, digest: hash(body) })); await file.sync() }
      finally { await file.close() }
      if (await journalIdentity(filename) !== identity) return
      await fs.rename(temporary, `${filename}.binding.json`)
    } catch { /* An optional index cannot invalidate an acknowledged durable append. */ }
    finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  async discard(filename: string): Promise<void> {
    this.memory.delete(filename)
    this.pending.delete(filename)
    await this.writing.get(filename)
    await fs.rm(`${filename}.binding.json`, { force: true })
  }
}
