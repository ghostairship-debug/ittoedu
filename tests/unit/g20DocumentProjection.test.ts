// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DocumentProjection } from '../../src/renderer/documents/DocumentProjection'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentCommand, DocumentEvent, DocumentModel, DocumentOperation, DurableDocumentState } from '../../src/shared/workbench/document'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const source = (model: DocumentModel | null | undefined) => model?.kind === 'markdown' ? model.source : undefined

/** Only transport timing/failure is controlled here; all state, History and ACKs use the real kernel. */
async function host() {
  const durable = new Map<string, DurableDocumentState>()
  let ids = 0, saves = 0
  const registry = new DocumentRegistry({ drivers: [new MarkdownDriver()], createId: () => `identity-${++ids}`,
    bindingKey: binding => binding.path,
    persistence: {
      async append(state) { durable.set(state.documentId, structuredClone(state)) },
      async save(input) { saves++; if (input.binding.kind !== 'file') throw new Error('path'); return input.binding },
    },
  })
  const listeners = new Set<(event: DocumentEvent) => void>()
  const events: DocumentEvent[] = [], operations: DocumentOperation[] = []
  const controls: { delayEvents: boolean; before?(operation: DocumentOperation): Promise<void>; after?(operation: DocumentOperation): Promise<void> } = { delayEvents: false }
  const emit = (event: DocumentEvent) => { for (const listener of listeners) listener(structuredClone(event)) }
  async function create(name: string) {
    const session = await registry.create({ kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, name)
    session.subscribe(event => { events.push(event); if (!controls.delayEvents) emit(event) })
    return session
  }
  const a = await create('a.md'), b = await create('b.md')
  const api: DocumentHostAPI = {
    async bootstrapCourse() { throw new Error('Course bootstrap is outside this Markdown fixture') },
    async list() { return registry.list() },
    async create(model, name) { return (await registry.create(model, name)).read() },
    async open() { throw new Error('This test uses untitled documents') },
    async read(id) { return registry.get(id).read() },
    async dispatch(operation) {
      operations.push(structuredClone(operation))
      await controls.before?.(operation)
      const result = await registry.get(operation.documentId).execute(operation)
      await controls.after?.(operation)
      return result
    },
    async lookup(id, operationId) { return registry.get(id).lookupOperation(operationId) },
    async save(id) { return registry.save(id) },
    async saveWithDialog() { throw new Error('This projection test does not open native dialogs') },
    async observeFile() { throw new Error('This projection test uses untitled documents') },
    async reconcileFile() { throw new Error('This projection test uses untitled documents') },
    async close(id, discardDirty) { await registry.close(id, { discardDirty }) },
    async closeWithDialog() { throw new Error('This projection test does not open native dialogs') },
    async recoverable() { return registry.list() },
    async restore(id) { return (await registry.restore(durable.get(id)!)).read() },
    async discardRecovery() { throw new Error('This projection test keeps its recovery state') },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { api, a, b, controls, operations, events, emit, saves: () => saves }
}

describe('G20 acknowledged document projection', () => {
  it('projects rapid typing immediately, serializes ACKs, ignores old/duplicate events and reattaches to main History', async () => {
    const h = await host(), projection = await DocumentProjection.attach(h.api, h.a.documentId)
    const hold = deferred(), firstApplied = deferred()
    let first = true
    h.controls.after = async () => { if (first) { first = false; firstApplied.resolve(); await hold.promise } }
    const p1 = projection.edit({ type: 'markdown.splice', from: 0, to: 0, text: '甲' })
    const p2 = projection.edit({ type: 'markdown.splice', from: 1, to: 1, text: '乙' })
    const p3 = projection.edit({ type: 'markdown.splice', from: 2, to: 2, text: '丙' })
    expect(source(projection.read().draft)).toBe('甲乙丙')
    expect(projection.read().pending).toHaveLength(3)
    await firstApplied.promise
    expect(source(projection.read().committed?.model)).toBe('甲')
    // A save/status broadcast at the same own revision is not an external content conflict.
    h.emit({ type: 'changed', snapshot: h.a.read() })
    expect(projection.read().error).toBeNull()
    expect(h.operations).toHaveLength(1)
    hold.resolve()
    await Promise.all([p1, p2, p3])
    const current = await projection.drain()
    expect(source(current.model)).toBe('甲乙丙')
    expect(current.undoDepth).toBe(3)
    expect(h.operations.map(value => value.baseRevision)).toEqual([0, 1, 2])
    expect(new Set(h.operations.map(value => value.operationId)).size).toBe(3)
    for (const event of [...h.events].reverse()) { h.emit(event); h.emit(event) }
    expect(projection.read().committed?.revision).toBe(3)
    expect(projection.read().draft).toBeNull()
    expect(h.saves()).toBe(0)
    projection.dispose()
    const rebuilt = await DocumentProjection.attach(h.api, h.a.documentId)
    expect(rebuilt.read().committed?.undoDepth).toBe(3)
    await rebuilt.undo()
    expect(source((await rebuilt.drain()).model)).toBe('甲乙')
    await rebuilt.redo()
    expect(source((await rebuilt.drain()).model)).toBe('甲乙丙')
    rebuilt.dispose()
  })

  it('retains the complete local draft on an external revision conflict and never rebases a queued replacement silently', async () => {
    const h = await host(), projection = await DocumentProjection.attach(h.api, h.a.documentId)
    const hold = deferred(), sent = deferred()
    h.controls.before = async () => { sent.resolve(); await hold.promise }
    const first = projection.edit({ type: 'markdown.replace', source: 'local first' })
    const second = projection.edit({ type: 'markdown.replace', source: 'local final' }).catch(error => error)
    await sent.promise
    const baseline = h.a.read()
    await h.a.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId: 'external', actor: 'external', baseRevision: baseline.revision,
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'remote preserved' } } })
    expect(source(projection.read().draft)).toBe('local final')
    expect(source(projection.read().committed?.model)).toBe('remote preserved')
    expect(projection.read().error?.kind).toBe('conflict')
    hold.resolve()
    expect((await first).status).toBe('conflict')
    expect(await second).toBeInstanceOf(Error)
    await expect(projection.drain()).rejects.toThrow()
    await projection.reattach()
    expect(projection.read().pending).toHaveLength(2)
    expect(source(projection.read().draft)).toBe('local final')
    expect(h.operations).toHaveLength(1)
    expect(source(h.a.read().model)).toBe('remote preserved')
    projection.dispose()
  })

  it('forwards typing groups to the main History and keeps a later group as a separate undo', async () => {
    const h = await host(), projection = await DocumentProjection.attach(h.api, h.a.documentId)
    const hold = deferred(), sent = deferred()
    let first = true
    h.controls.before = async () => { if (first) { first = false; sent.resolve(); await hold.promise } }
    const a = projection.edit({ type: 'markdown.splice', from: 0, to: 0, text: 'A' }, { historyGroup: 'typing-1' })
    const b = projection.edit({ type: 'markdown.splice', from: 1, to: 1, text: 'B' }, { historyGroup: 'typing-1' })
    const c = projection.edit({ type: 'markdown.splice', from: 2, to: 2, text: 'C' }, { historyGroup: 'typing-2' })
    await sent.promise
    expect(source(projection.read().draft)).toBe('ABC')
    hold.resolve()
    await Promise.all([a, b, c])
    expect(h.operations.map(operation => operation.historyGroup)).toEqual(['typing-1', 'typing-1', 'typing-2'])
    expect((await projection.drain()).undoDepth).toBe(2)
    await projection.undo()
    expect(source((await projection.drain()).model)).toBe('AB')
    await projection.undo()
    expect(source((await projection.drain()).model)).toBe('')
    await projection.redo()
    expect(source((await projection.drain()).model)).toBe('AB')
    expect(h.saves()).toBe(0)
    projection.dispose()
  })

  it('queries a lost ACK before reconnecting and resumes the local chain without repeating the committed write', async () => {
    const h = await host(), projection = await DocumentProjection.attach(h.api, h.a.documentId)
    h.controls.delayEvents = true
    let lose = true
    h.controls.after = async () => { if (lose) { lose = false; throw new Error('transport disconnected after commit') } }
    const first = projection.edit({ type: 'markdown.splice', from: 0, to: 0, text: 'A' }).catch(error => error)
    const second = projection.edit({ type: 'markdown.splice', from: 1, to: 1, text: 'B' }).catch(error => error)
    expect(await first).toBeInstanceOf(Error)
    expect(await second).toBeInstanceOf(Error)
    expect(projection.read().pending[0]?.status).toBe('unknown')
    expect(source(projection.read().draft)).toBe('AB')
    expect(source(h.a.read().model)).toBe('A')
    await projection.reattach()
    expect(source((await projection.drain()).model)).toBe('AB')
    expect(h.operations).toHaveLength(2)
    expect(h.a.read().undoDepth).toBe(2)
    expect(projection.read().error).toBeNull()
    expect(h.saves()).toBe(0)
    projection.dispose()
  })

  it('retains asynchronously prepared input when a real external commit arrives during preview', async () => {
    const h = await host(), hold = deferred(), preparing = deferred(), driver = new MarkdownDriver()
    const projection = await DocumentProjection.attach(h.api, h.a.documentId, {
      kind: driver.kind, load: driver.load.bind(driver), serialize: driver.serialize.bind(driver), validate: driver.validate.bind(driver), withRevision: driver.withRevision.bind(driver),
      async apply(model: DocumentModel, command: DocumentCommand) { preparing.resolve(); await hold.promise; return driver.apply(model, command) },
    })
    const input = projection.edit({ type: 'markdown.replace', source: 'local draft' }).catch(error => error)
    await preparing.promise
    const baseline = h.a.read()
    await h.a.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId: 'external-during-preview', actor: 'external', baseRevision: baseline.revision,
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'remote preserved' } } })
    hold.resolve()
    expect(await input).toBeInstanceOf(Error)
    expect(source(projection.read().draft)).toBe('local draft')
    expect(source(projection.read().committed?.model)).toBe('remote preserved')
    expect(projection.read().error?.kind).toBe('conflict')
    expect(h.operations).toHaveLength(0)
    await expect(projection.drain()).rejects.toThrow()
    await projection.reattach()
    expect(source(projection.read().draft)).toBe('local draft')
    expect(projection.read().error?.kind).toBe('conflict')
    expect(h.operations).toHaveLength(0)
    projection.dispose()
  })

  it('keeps another document responsive while one is disconnected and preserves the rejected input for recovery', async () => {
    const h = await host()
    const a = await DocumentProjection.attach(h.api, h.a.documentId), b = await DocumentProjection.attach(h.api, h.b.documentId)
    const hold = deferred(), sent = deferred()
    h.controls.before = async operation => { if (operation.documentId === h.a.documentId) { sent.resolve(); await hold.promise; throw new Error('offline') } }
    const pending = a.edit({ type: 'markdown.replace', source: 'recover me' }).catch(error => error)
    await sent.promise
    await b.edit({ type: 'markdown.replace', source: 'independent' })
    expect(source((await b.drain()).model)).toBe('independent')
    hold.resolve()
    expect(await pending).toBeInstanceOf(Error)
    expect(source(a.read().draft)).toBe('recover me')
    expect(source(a.read().committed?.model)).toBe('')
    expect(a.read().connected).toBe(false)
    expect(b.read().error).toBeNull()
    await b.undo()
    expect(source((await b.drain()).model)).toBe('')
    a.dispose(); b.dispose()
  })
})
