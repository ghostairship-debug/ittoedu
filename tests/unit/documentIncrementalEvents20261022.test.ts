// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createTextDriver } from '../../src/core/drivers/TextDriver'
import { DocumentProjection } from '../../src/renderer/documents/DocumentProjection'
import { uiDocumentEvent } from '../../src/main/workbench/uiDocumentSnapshot'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentHostEvent, DocumentOperation } from '../../src/shared/workbench/document'

async function fixture() {
  const session = await DocumentSession.create({ documentId: 'events', epoch: 'epoch', model: { kind: 'text', source: 'before',
    resources: { assets: { retained: new Uint8Array(512 * 1024).fill(7) }, components: {} } },
    binding: { kind: 'file', path: 'C:/event.txt', version: null, bindingVersion: 1 } }, createTextDriver(), {
    async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('path'); return input.binding },
  })
  const listeners = new Set<(event: DocumentHostEvent) => void>(), events: DocumentHostEvent[] = []
  let drop = false
  session.subscribe(event => {
    const transported = structuredClone(uiDocumentEvent(event))
    events.push(transported)
    if (!drop) for (const listener of listeners) listener(transported)
  })
  const read = vi.fn(async () => session.read())
  const api = { read, subscribe(listener: (event: DocumentHostEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispatch(operation: DocumentOperation) { return session.execute(operation) }, async lookup(_id: string, operationId: string) { return session.lookupOperation(operationId) },
  } as unknown as DocumentHostAPI
  const projection = await DocumentProjection.attach(api, session.documentId)
  const replace = (id: string, source: string) => session.execute({ ...session.readIdentity(), operationId: id, baseRevision: session.readIdentity().revision,
    actor: 'external', mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
  return { session, projection, events, read, replace, drop: (value: boolean) => { drop = value } }
}

describe('accepted document updates across the existing UI event stream', () => {
  it('retains content and resources on a same-revision read while accepting actual metadata', async () => {
    const h = await fixture(), model = h.projection.read().committed!.model
    await h.projection.drain()
    expect(h.projection.read().committed!.model).toBe(model)
    await h.session.save()
    await h.projection.drain()
    expect(h.projection.read().committed).toMatchObject({ dirty: false, saving: false })
    expect(h.projection.read().committed!.model).toBe(model)
    await h.replace('changed', 'new authority')
    expect(h.projection.read().committed!.model).not.toBe(model)
    expect(h.projection.read().committed!.model).toMatchObject({ source: 'new authority' })
    h.projection.dispose()
  })
  it('keeps unchanged media local and publishes save/error state without another model', async () => {
    const h = await fixture(), retained = h.projection.read().committed!.model.resources.assets.retained
    await h.replace('input', 'after')
    expect(h.projection.read().committed!.model).toMatchObject({ source: 'after' })
    expect(h.projection.read().committed!.model.resources.assets.retained).toBe(retained)
    expect(h.events[0]).toMatchObject({ type: 'updated', baseSequence: 0, model: { resources: { assets: {}, components: {} } } })
    expect(h.events[0]).not.toHaveProperty('snapshot')
    await h.session.save()
    h.session.reportSaveFailure(new Error('visible error'))
    expect(h.events.slice(1).every(event => event.type === 'state')).toBe(true)
    expect(h.projection.read().committed).toMatchObject({ saving: false, saveError: 'visible error', dirty: false })
    expect(h.projection.read().committed!.model.resources.assets.retained).toBe(retained)
    expect(h.read).toHaveBeenCalledTimes(1)
    retained[0] = 9
    expect(h.session.read().model.resources.assets.retained[0]).toBe(7)
    h.projection.dispose()
  })

  it('fills a missing accepted base from the canonical read instead of applying to an old model', async () => {
    const h = await fixture()
    h.drop(true); await h.replace('first', 'middle'); h.drop(false)
    await h.replace('second', 'latest')
    await vi.waitFor(() => expect(h.projection.read().committed!.model).toMatchObject({ source: 'latest' }))
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.projection.read().error).toBeNull()
    h.projection.dispose()
  })
})
