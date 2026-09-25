import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentBinding, DurableDocumentState } from '../../shared/workbench/document'
import type { DocumentRegistry } from '../../core/documents/DocumentRegistry'
import type { createDocumentJournal } from './documentJournal'
import type { WorkspaceAroundMutation, WorkspaceMutationAction } from './WorkspaceFiles'
import { FileAccessQueue } from './FileAccessQueue'

type FileBinding = Extract<DocumentBinding, { kind: 'file' }>
interface BindingIntent { schemaVersion: 1; operationId: string; source: string; target?: string; kind: 'rename' | 'move' | 'trash'; entries: { documentId: string; before: FileBinding; after: DocumentBinding }[] }
const key = (filename: string) => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename)
const exists = async (filename: string) => { try { await fs.lstat(filename); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
const inside = (filename: string, parent: string) => { const relative = path.relative(key(parent), key(filename)); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) }

/** A small physical-move intent repairs binding journals if the process dies between document ACKs. */
export class DocumentFileCoordinator {
  private readonly access = new FileAccessQueue()
  private needsRepair = true
  constructor(private readonly registry: DocumentRegistry, private readonly journal: ReturnType<typeof createDocumentJournal>, private readonly directory: string) {}

  async withFileAccess<T>(work: () => Promise<T>): Promise<T> {
    await this.repairBindings()
    return this.access.run(false, async () => {
      if (this.needsRepair) throw new Error('文件位置尚未恢复，请先解决文件操作失败后重试')
      return work()
    })
  }
  withFileOperation<T>(work: () => Promise<T>): Promise<T> {
    return this.access.run(true, async () => {
      if (this.needsRepair) { await this.repair(); this.needsRepair = false }
      this.needsRepair = true
      try { return await work() }
      finally { await this.repair(); this.needsRepair = false }
    })
  }

  private filename(operationId: string, source: string) { return path.join(this.directory, `${createHash('sha256').update(`${operationId}\0${source}`).digest('hex')}.json`) }
  private async record(filename: string, intent: BindingIntent) {
    await fs.mkdir(this.directory, { recursive: true })
    const temporary = `${filename}.${randomUUID()}.tmp`
    const handle = await fs.open(temporary, 'wx')
    try { await handle.writeFile(JSON.stringify(intent)); await handle.sync() } finally { await handle.close() }
    try { await fs.rename(temporary, filename) } catch (error) { await fs.rm(temporary, { force: true }); throw error }
  }
  private async states(): Promise<DurableDocumentState[]> {
    const states: DurableDocumentState[] = []
    for (const documentId of await this.journal.list()) { const state = await this.journal.recover(documentId); if (state) states.push(state) }
    return states
  }
  private destination(action: WorkspaceMutationAction, binding: FileBinding, source: string): DocumentBinding {
    if (action.kind === 'trash') return { kind: 'untitled', suggestedName: path.basename(binding.path) }
    if (!action.target) throw new Error('文件移动缺少正式目标')
    return { ...binding, path: path.join(action.target.resolvedPath, path.relative(source, binding.path)), bindingVersion: binding.bindingVersion + 1 }
  }

  readonly aroundMutation: WorkspaceAroundMutation = async (action, perform) => {
    if (action.kind !== 'rename' && action.kind !== 'move' && action.kind !== 'trash') return perform()
    const source = action.sources[0]
    if (!source) throw new Error('文件操作缺少源句柄')
    const affected = (await this.states()).filter(state => state.binding.kind === 'file' &&
      (source.kind === 'directory' ? inside(state.binding.path, source.resolvedPath) : key(state.binding.path) === key(source.resolvedPath)))
    if (!affected.length) return perform()
    const live = new Set(this.registry.list().map(snapshot => snapshot.documentId))
    const entries = affected.map(state => ({ documentId: state.documentId, before: state.binding as FileBinding,
      after: this.destination(action, state.binding as FileBinding, source.resolvedPath) }))
    const destinations = entries.flatMap(entry => [entry.before, ...(entry.after.kind === 'file' ? [entry.after] : [])])
    return this.registry.withFileBindings(entries.filter(entry => live.has(entry.documentId)).map(entry => entry.documentId), destinations, async leases => {
      // Capture after any earlier save finished; do not erase an existing external-file conflict.
      for (const entry of [...entries]) {
        const current = leases.get(entry.documentId)?.read().binding
        if (current) {
          if (current.kind !== 'file' || !(source.kind === 'directory' ? inside(current.path, source.resolvedPath) : key(current.path) === key(source.resolvedPath))) {
            entries.splice(entries.indexOf(entry), 1)
          } else { entry.before = current; entry.after = this.destination(action, current, source.resolvedPath) }
        }
      }
      if (!entries.length) return perform()
      const intent: BindingIntent = { schemaVersion: 1, operationId: action.operationId, source: source.resolvedPath,
        ...(action.target ? { target: action.target.resolvedPath } : {}), kind: action.kind as BindingIntent['kind'], entries }
      const filename = this.filename(action.operationId, source.resolvedPath)
      await this.record(filename, intent)
      const result = await perform()
      if (result.status !== 'success' && result.status !== 'partial') { await fs.rm(filename, { force: true }); return result }
      const choices = await Promise.all(entries.map(async entry => {
        if (result.status === 'success') return 'after' as const
        if (await exists(entry.before.path)) return 'before' as const
        if (entry.after.kind === 'file' && await exists(entry.after.path)) return 'after' as const
        return 'unknown' as const
      }))
      // On a journal failure leave the intent in place. WorkspaceFiles rolls back
      // reversible movement; repairBindings follows the actual physical outcome.
      for (const [index, entry] of entries.entries()) {
        if (choices[index] !== 'after') continue
        const lease = leases.get(entry.documentId)
        if (lease) await lease.rebind(entry.after)
        else {
          const state = await this.journal.recover(entry.documentId)
          if (state) await this.journal.append({ ...state, binding: entry.after, sequence: state.sequence + 1,
            ...(entry.after.kind === 'untitled' ? { savedRevision: null } : {}) })
        }
      }
      if (!choices.includes('unknown')) await fs.rm(filename, { force: true })
      return result
    })
  }

  /** Does not move/delete user files or rerun a task; only repairs proven file bindings. */
  repairBindings(): Promise<void> {
    if (!this.needsRepair) return Promise.resolve()
    return this.access.run(true, async () => { if (this.needsRepair) { await this.repair(); this.needsRepair = false } })
  }

  private async repair(): Promise<void> {
    let names: string[]
    try { names = await fs.readdir(this.directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
      const filename = path.join(this.directory, name)
      const intent = JSON.parse(await fs.readFile(filename, 'utf8')) as BindingIntent
      if (intent.schemaVersion !== 1 || !Array.isArray(intent.entries) || !path.isAbsolute(intent.source) ||
        !['rename', 'move', 'trash'].includes(intent.kind) || (intent.target !== undefined && !path.isAbsolute(intent.target))) throw new Error('文件绑定恢复记录无效')
      const choices = await Promise.all(intent.entries.map(async entry => {
        const atSource = await exists(entry.before.path)
        const atTarget = entry.after.kind === 'file' && await exists(entry.after.path)
        return { atSource, atTarget,
          physical: atSource ? 'before' as const : intent.kind === 'trash' || atTarget ? 'after' as const : 'unknown' as const }
      }))
      const live = new Set(this.registry.list().map(snapshot => snapshot.documentId))
      const bindings = intent.entries.flatMap(entry => [entry.before, ...(entry.after.kind === 'file' ? [entry.after] : [])])
      await this.registry.withFileBindings(intent.entries.filter(entry => live.has(entry.documentId)).map(entry => entry.documentId), bindings, async leases => {
        for (const [index, entry] of intent.entries.entries()) {
          const lease = leases.get(entry.documentId)
          const state = lease ? null : await this.journal.recover(entry.documentId)
          const current = lease?.read().binding ?? state?.binding
          const matches = (candidate: DocumentBinding) => current?.kind === candidate.kind && (candidate.kind === 'file'
            ? current.kind === 'file' && current.bindingVersion === candidate.bindingVersion && key(current.path) === key(candidate.path)
            : current.kind === 'untitled' && current.suggestedName === candidate.suggestedName)
          if (!matches(entry.before) && !matches(entry.after)) continue // A later Save As owns this binding now.
          const choice = matches(entry.after) && (entry.after.kind === 'untitled' || choices[index]!.atTarget)
            ? 'after' : choices[index]!.physical
          if (choice === 'unknown') continue // Never invent a location while both paths are missing.
          const binding = choice === 'after' ? entry.after : entry.before
          if (lease) await lease.rebind(binding)
          else if (state) await this.journal.append({ ...state, binding, sequence: state.sequence + 1, ...(binding.kind === 'untitled' ? { savedRevision: null } : {}) })
        }
      })
      if (choices.some(choice => choice.physical === 'unknown')) throw new Error('文件位置尚未确认，已阻止在旧路径重新创建文件')
      await fs.rm(filename, { force: true })
    }
  }
}
