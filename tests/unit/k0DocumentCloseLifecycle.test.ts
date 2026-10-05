// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentProjection, DocumentExactAckUnknownError } from '../../src/renderer/documents/DocumentProjection'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentEvent, DocumentOperation } from '../../src/shared/workbench/document'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function host() {
  let sequence = 0
  const registry = new DocumentRegistry({ drivers: [new CourseV10Driver()], createId: () => `close-${++sequence}`,
    bindingKey: binding => binding.path,
    persistence: { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('file required'); return input.binding } } })
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'close-project', revision: 0, title: 'Close',
    definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } } },
    instances: { text: { id: 'text', definitionId: 'text', data: { text: 'committed' }, frame: { transform: [1, 0, 0, 1, 0, 0], width: 200, height: 100 } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['text'], designSize: { width: 1280, height: 720 } }],
    global: { underlay: [], overlay: [] }, assets: {} }
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'close.h5lesson', true)
  const listeners = new Set<(event: DocumentEvent) => void>()
  session.subscribe(event => { for (const listener of listeners) listener(structuredClone(event)) })
  const controls: { cancel: boolean; beforeDispatch?(operation: DocumentOperation): Promise<void>; afterClose?(): void } = { cancel: false }
  const unused = async (): Promise<never> => { throw new Error('Outside close lifecycle fixture') }
  const api: DocumentHostAPI = {
    async bootstrapCourse() { return session.read() }, async list() { return registry.list() },
    create: unused, open: unused, async read(id) { return registry.get(id).read() },
    async dispatch(operation) { await controls.beforeDispatch?.(operation); return registry.get(operation.documentId).execute(operation) },
    async lookup(id, operationId) { return registry.get(id).lookupOperation(operationId) },
    save: unused, saveWithDialog: unused, observeFile: unused, reconcileFile: unused,
    async close(id, discardDirty) { await registry.close(id, { discardDirty }) },
    async closeWithDialog(id) {
      if (controls.cancel) return false
      await registry.close(id, { discardDirty: true })
      controls.afterClose?.()
      return true
    },
    recoverable: unused, restore: unused, discardRecovery: unused,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const command = (text: string) => captureComponentOperation(project, [{ type: 'data.set', instanceId: 'text', path: ['text'], value: text }])
  return { api, session, controls, command, listeners }
}

describe('V10 close lifecycle', () => {
  it('publishes no transient error on normal close and keeps a canceled view editable', async () => {
    const h = await host(), bridge = new CourseV10DocumentBridge(), errors: string[] = []
    await bridge.connect(h.api)
    const stop = bridge.subscribe(() => { if (bridge.read().error) errors.push(bridge.read().error!) })
    try {
      h.controls.cancel = true
      expect(await bridge.close(h.session.documentId)).toBe(false)
      expect(h.listeners.size).toBe(1)
      await bridge.edit([{ type: 'data.set', instanceId: 'text', path: ['text'], value: 'after cancel' }])
      expect((await bridge.drain())[0]).toMatchObject({ revision: 1, undoDepth: 1 })
      h.controls.cancel = false
      h.controls.afterClose = () => { expect(errors).toEqual([]); expect(h.listeners.size).toBe(0) }
      expect(await bridge.close(h.session.documentId)).toBe(true)
      expect(bridge.read()).toMatchObject({ activeDocumentId: null, documents: [], error: null })
      expect(errors).toEqual([])
    } finally { stop(); bridge.dispose() }
  })

  it('retains an unacknowledged edit when Main closes before its dispatch resolves', async () => {
    const h = await host(), projection = await DocumentProjection.attach(h.api, h.session.documentId, new CourseV10Driver())
    const sent = deferred(), hold = deferred()
    h.controls.beforeDispatch = async () => { sent.resolve(); await hold.promise }
    const editing = projection.edit(h.command('recover input')).catch(error => error)
    try {
      await sent.promise
      await h.api.close(h.session.documentId, true)
      expect(projection.read()).toMatchObject({ connected: false, error: { kind: 'closed' }, pending: [{ status: 'sending' }],
        draft: { project: { instances: { text: { data: { text: 'recover input' } } } } } })
      hold.resolve()
      expect(await editing).toBeInstanceOf(Error)
      expect(projection.read()).toMatchObject({ error: { kind: 'disconnected', code: 'ack-unknown' }, pending: [{ status: 'unknown' }],
        draft: { project: { instances: { text: { data: { text: 'recover input' } } } } } })
    } finally { hold.resolve(); await editing; projection.dispose() }
  })

  it('retains composition input and its close diagnostic', async () => {
    const h = await host(), projection = await DocumentProjection.attach(h.api, h.session.documentId, new CourseV10Driver())
    try {
      projection.beginComposition('text', ['text'])
      await projection.updateComposition('正在输入')
      await h.api.close(h.session.documentId, true)
      expect(projection.read()).toMatchObject({ connected: false, error: { kind: 'closed' }, composing: { instanceId: 'text' },
        draft: { project: { instances: { text: { data: { text: '正在输入' } } } } } })
    } finally { projection.dispose() }
  })

  it('keeps an exact operation with an unknown receipt diagnosable even outside the normal queue', async () => {
    const h = await host(), projection = await DocumentProjection.attach(h.api, h.session.documentId, new CourseV10Driver())
    const snapshot = await projection.drain(), release = projection.reservePrecommit(), sent = deferred(), hold = deferred()
    h.controls.beforeDispatch = async () => { sent.resolve(); await hold.promise; throw new Error('receipt unavailable') }
    const editing = projection.editExact(snapshot, h.command('exact input'), 'exact-close').catch(error => error)
    try {
      await sent.promise
      await h.api.close(h.session.documentId, true)
      expect(projection.read()).toMatchObject({ connected: false, error: { kind: 'closed' }, pending: [], draft: null })
      hold.resolve()
      expect(await editing).toBeInstanceOf(DocumentExactAckUnknownError)
      expect(projection.read().error?.kind).toBe('closed')
    } finally { hold.resolve(); await editing; release(); projection.dispose() }
  })
})
