import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import type { DocumentSession } from '../../src/core/documents/DocumentSession'
import type { DocumentEvent, DocumentModel, DurableDocumentState } from '../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentFileRef } from '../../src/shared/document/ports'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'

/** Real canonical writer and History, with a controllable file transport for mounted UI tests. */
export function attachMarkdownRendererHost(port: RecoverableDocumentFilePort, fixedRef?: DocumentFileRef) {
  const states = new Map<string, DurableDocumentState>()
  const listeners = new Set<(event: DocumentEvent) => void>()
  const attached = new Set<string>()
  const refFor = (filename: string): DocumentFileRef => fixedRef ?? { kind: 'file', path: filename }
  const model = (source: string): DocumentModel => ({ kind: 'markdown', source, resources: { assets: {}, components: {} } })
  const registry = new DocumentRegistry({
    createId: () => crypto.randomUUID(), drivers: [new MarkdownDriver()], bindingKey: binding => binding.path.replace(/\\/g, '/').toLowerCase(),
    persistence: {
      append: async state => { states.set(state.documentId, structuredClone(state)) },
      save: async input => {
        if (input.binding.kind !== 'file' || input.model.kind !== 'markdown') throw new Error('Expected bound Markdown')
        const ref = refFor(input.binding.path), disk = await port.openDocument(ref)
        if (disk.version.contentVersion !== input.binding.version) throw new Error('File changed')
        const result = await port.saveDocument({ ref, source: input.model.source, expectedVersion: disk.version, attachments: [], operationId: crypto.randomUUID() })
        if (result.status !== 'saved') throw new Error('File save failed')
        return { ...input.binding, version: result.version.contentVersion }
      },
    },
  })
  const attach = (session: DocumentSession) => {
    if (!attached.has(session.documentId)) {
      attached.add(session.documentId)
      session.subscribe(event => { for (const listener of listeners) listener(event) })
    }
    return session.read()
  }
  const documents: DocumentHostAPI = {
    async bootstrapCourse() { throw new Error('Course bootstrap is outside this Markdown fixture') },
    list: async () => registry.list(),
    create: async (initial, name) => attach(await registry.create(initial, name)),
    open: async filename => {
      const disk = await port.openDocument(refFor(filename))
      return attach(await registry.open({ kind: 'file', path: filename, version: disk.version.contentVersion, bindingVersion: 1 }, async () => model(disk.source)))
    },
    read: async id => registry.get(id).read(),
    dispatch: operation => registry.get(operation.documentId).execute(operation),
    lookup: async (id, operationId) => registry.get(id).lookupOperation(operationId),
    save: (id, filename) => registry.save(id, filename ? { kind: 'file', path: filename, version: null, bindingVersion: 2 } : undefined),
    saveWithDialog: async () => { throw new Error('Dialog is outside this fixture') },
    closeWithDialog: async () => { throw new Error('Dialog is outside this fixture') },
    observeFile: async id => {
      const current = registry.get(id).read()
      if (current.binding.kind !== 'file') throw new Error('Expected bound document')
      const disk = await port.openDocument(refFor(current.binding.path))
      return { bindingVersion: current.binding.bindingVersion, version: disk.version.contentVersion, model: model(disk.source) }
    },
    reconcileFile: input => registry.get(input.documentId).reconcileFile(input, async current => {
      const disk = await documents.observeFile(input.documentId)
      if (disk.version !== input.version || !disk.model) throw new Error('File changed')
      const next = input.choice === 'disk' ? disk.model : input.source === undefined ? current.model : { ...current.model, source: input.source }
      return { model: next, version: disk.version, matchesDisk: next.kind === 'markdown' && disk.model.kind === 'markdown' && next.source === disk.model.source }
    }),
    close: async (id, discardDirty) => { await registry.close(id, { discardDirty }); states.delete(id) },
    recoverable: async () => [],
    restore: async id => { const state = states.get(id); if (!state) throw new Error('Missing recovery'); return attach(await registry.restore(state)) },
    discardRecovery: async id => { states.delete(id) },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  port.documents = documents
  return { documents, registry, listeners }
}
