import type { DocumentBinding, DocumentDriver, DocumentModel, DocumentPersistence, DurableDocumentState } from '../../shared/workbench/document'
import { DocumentSession, type DocumentFileLease, type DocumentSaveObserver } from './DocumentSession'

export interface DocumentRegistryOptions {
  persistence: DocumentPersistence
  drivers: readonly DocumentDriver[]
  createId(): string
  /** Main supplies canonical realpath/case handling; the pure core does no IO. */
  bindingKey(binding: Extract<DocumentBinding, { kind: 'file' }>): string
}

export class DocumentRegistry {
  private readonly sessions = new Map<string, DocumentSession>()
  private readonly bindings = new Map<string, string>()
  private readonly opening = new Map<string, Promise<DocumentSession>>()
  private readonly savingBindings = new Map<string, string>()
  private readonly saving = new Map<string, Promise<ReturnType<DocumentSession['read']>>>()
  private readonly restoring = new Map<string, Promise<DocumentSession>>()
  private readonly fileBarriers = new Map<string, Promise<void>>()
  private readonly documentSaves = new Map<string, Promise<unknown>>()

  constructor(private readonly options: DocumentRegistryOptions) {}

  private driver(model: DocumentModel): DocumentDriver {
    const driver = this.options.drivers.find(value => value.kind === model.kind)
    if (!driver) throw new Error(`未支持文档格式：${model.kind}`)
    return driver
  }

  get(documentId: string): DocumentSession {
    const session = this.sessions.get(documentId)
    if (!session) throw new Error(`文档未打开：${documentId}`)
    return session
  }

  list(): ReturnType<DocumentSession['read']>[] { return [...this.sessions.values()].map(session => session.read()) }

  /** pristine is reserved for host-created automatic starter content, never an IPC option. */
  async create(model: DocumentModel, suggestedName: string, pristine = false): Promise<DocumentSession> {
    const session = await DocumentSession.create({
      documentId: this.options.createId(), epoch: this.options.createId(),
      model, binding: { kind: 'untitled', suggestedName }, saved: pristine,
    }, this.driver(model), this.options.persistence)
    this.sessions.set(session.documentId, session)
    return session
  }

  open(binding: Extract<DocumentBinding, { kind: 'file' }>, load: () => Promise<DocumentModel>): Promise<DocumentSession> {
    const key = this.options.bindingKey(binding)
    const moving = this.fileBarriers.get(key)
    if (moving) return moving.then(() => this.open(binding, load))
    const existing = this.bindings.get(key)
    if (existing) return Promise.resolve(this.get(existing))
    const writing = this.saving.get(key)
    if (writing) return writing.then(() => this.open(binding, load))
    const pending = this.opening.get(key)
    if (pending) return pending
    const operation = (async () => {
      const model = await load()
      const session = await DocumentSession.create({
        documentId: this.options.createId(), epoch: this.options.createId(), model, binding, saved: true,
      }, this.driver(model), this.options.persistence)
      this.sessions.set(session.documentId, session)
      this.bindings.set(key, session.documentId)
      return session
    })()
    this.opening.set(key, operation)
    void operation.finally(() => { this.opening.delete(key) }).catch(() => undefined)
    return operation
  }

  restore(state: DurableDocumentState): Promise<DocumentSession> {
    const existing = this.sessions.get(state.documentId)
    if (existing) return Promise.resolve(existing)
    const restoring = this.restoring.get(state.documentId)
    if (restoring) return restoring
    const key = state.binding.kind === 'file' ? this.options.bindingKey(state.binding) : null
    if (key && this.fileBarriers.has(key)) return this.fileBarriers.get(key)!.then(() => this.restore(state))
    if (key && (this.bindings.has(key) || this.opening.has(key) || this.savingBindings.has(key))) return Promise.reject(new Error('恢复文档的文件已被其他会话打开'))
    const operation = (async () => {
      const session = await DocumentSession.restore(state, this.options.createId(), this.driver(state.model), this.options.persistence)
      this.sessions.set(session.documentId, session)
      if (key) this.bindings.set(key, session.documentId)
      return session
    })()
    this.restoring.set(state.documentId, operation)
    if (key) this.opening.set(key, operation)
    void operation.finally(() => {
      this.restoring.delete(state.documentId)
      if (key && this.opening.get(key) === operation) this.opening.delete(key)
    }).catch(() => undefined)
    return operation
  }

  save(documentId: string, binding?: Extract<DocumentBinding, { kind: 'file' }>, observer?: DocumentSaveObserver): Promise<ReturnType<DocumentSession['read']>> {
    const target = binding ? structuredClone(binding) : undefined
    const previous = this.documentSaves.get(documentId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(() => this.saveCurrent(documentId, target, observer))
    this.documentSaves.set(documentId, operation)
    void operation.finally(() => { if (this.documentSaves.get(documentId) === operation) this.documentSaves.delete(documentId) }).catch(() => undefined)
    return operation
  }

  private async saveCurrent(documentId: string, binding?: Extract<DocumentBinding, { kind: 'file' }>, observer?: DocumentSaveObserver): Promise<ReturnType<DocumentSession['read']>> {
    const session = this.get(documentId)
    const currentBinding = session.read().binding
    const sameBinding = binding && currentBinding.kind === 'file' && this.options.bindingKey(binding) === this.options.bindingKey(currentBinding)
    const actualBinding = !binding || sameBinding ? undefined : { ...binding, bindingVersion: currentBinding.kind === 'file' ? currentBinding.bindingVersion + 1 : 1 }
    const target = actualBinding ?? currentBinding
    if (target.kind !== 'file') throw new Error('未保存文档需要选择保存路径')
    const key = this.options.bindingKey(target)
    const moving = this.fileBarriers.get(key)
    if (moving) { await moving; return this.saveCurrent(documentId, binding, observer) }
    const owner = this.bindings.get(key) ?? this.savingBindings.get(key)
    if ((owner && owner !== documentId) || this.opening.has(key)) throw new Error('目标文件已被其他文档占用')
    this.savingBindings.set(key, documentId)
    const saved = session.save(actualBinding, observer)
    this.saving.set(key, saved)
    try {
      const snapshot = await saved
      for (const [oldKey, oldOwner] of this.bindings) if (oldOwner === documentId && oldKey !== key) this.bindings.delete(oldKey)
      this.bindings.set(key, documentId)
      return snapshot
    } finally {
      if (this.saving.get(key) === saved) { this.savingBindings.delete(key); this.saving.delete(key) }
    }
  }

  /** Locks only affected documents; unrelated editors and saves remain usable. */
  async withFileBindings<T>(documentIds: readonly string[], destinations: readonly Extract<DocumentBinding, { kind: 'file' }>[],
    work: (leases: ReadonlyMap<string, DocumentFileLease>) => Promise<T>): Promise<T> {
    const ids = [...new Set(documentIds)].sort()
    await Promise.all(ids.map(id => this.documentSaves.get(id)))
    const sessions = ids.map(id => this.get(id))
    const keys = new Set(destinations.map(binding => this.options.bindingKey(binding)))
    for (const session of sessions) {
      const binding = session.read().binding
      if (binding.kind === 'file') keys.add(this.options.bindingKey(binding))
    }
    for (const key of keys) {
      if (this.fileBarriers.has(key) || this.opening.has(key)) throw new Error('文件正在打开或移动，请稍后再试')
      const owner = this.bindings.get(key) ?? this.savingBindings.get(key)
      if (owner && !ids.includes(owner)) throw new Error('文件目标已由其他文档占用')
    }
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    for (const key of keys) this.fileBarriers.set(key, barrier)
    const leases = new Map<string, DocumentFileLease>()
    const lock = (index: number): Promise<T> => {
      if (index === sessions.length) return work(leases)
      const session = sessions[index]
      return session.withFileLease(async lease => { leases.set(session.documentId, lease); return lock(index + 1) })
    }
    try { return await lock(0) }
    finally {
      for (const [key, owner] of this.bindings) if (ids.includes(owner)) this.bindings.delete(key)
      for (const session of sessions) {
        const binding = session.read().binding
        if (this.sessions.has(session.documentId) && binding.kind === 'file') this.bindings.set(this.options.bindingKey(binding), session.documentId)
      }
      for (const key of keys) if (this.fileBarriers.get(key) === barrier) this.fileBarriers.delete(key)
      release()
    }
  }

  async close(documentId: string, options: { discardDirty?: boolean; expected?: { epoch: string; revision: number } } = {}): Promise<void> {
    await this.documentSaves.get(documentId)
    const session = this.get(documentId)
    await session.close(options)
    this.sessions.delete(documentId)
    for (const [key, owner] of this.bindings) if (owner === documentId) this.bindings.delete(key)
  }
}
