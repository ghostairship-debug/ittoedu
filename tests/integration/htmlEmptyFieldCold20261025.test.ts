// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { HTML_AUTHORING_CONSUMER_ID, readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import type { HtmlTargetReport } from '../../src/renderer/documentFiles/html/htmlPreviewController'

it('clears two text leaves sharing one source parent without replacing its first software anchor or reviving either value after cold open', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'html-empty-fields-')), filename = path.join(directory, 'fields.html')
  const source = '<html><head></head><body><p>A<span>B</span>C</p></body></html>'
  await fs.writeFile(filename, source)
  const host = new DocumentHostService(path.join(directory, 'journal')), initial = await host.open(filename)
  if (initial.binding.kind !== 'file') throw new Error('Expected file')
  const lease = { leaseId: 'empty-fields', loadId: 'empty-fields', documentId: initial.documentId, epoch: initial.epoch, revision: initial.revision, bindingVersion: initial.binding.bindingVersion, url: 'preview://fields' }
  const service = new HtmlSourceEditService({ readDocument: id => host.internalAPI.read(id), execute: operation => host.internalAPI.dispatch(operation), withFileAccess: work => host.fileCoordinator.withFileAccess(work) })
  const frame = document.createElement('iframe'); document.body.append(frame)
  const doc = frame.contentDocument!; doc.open(); doc.write(source); doc.close()
  const adapter = createDomAuthoring(doc.documentElement, { records: () => ({}) }), parent = doc.querySelector('p')!
  const reports = [parent.firstChild!, parent.lastChild!].map((node, index): HtmlTargetReport => {
    const described = adapter.describe(node)!
    return { handle: `leaf-${index}`, kind: 'text', domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }],
      sectionOrder: null, rawText: node.textContent!, attributeName: null, rect: { x: 0, y: 0, width: 10, height: 10 }, scriptCreated: false,
      authoring: { authorKey: described.authorKey, record: described.record }, bindingStatus: described.bindingStatus }
  })
  adapter.dispose()
  try {
    for (const report of reports) {
      const snapshot = await host.internalAPI.read(initial.documentId)
      const context = { lease, tabId: 'tab', snapshot, entryRealPath: filename, rootRealPath: directory, bindingPath: filename }
      expect((await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: lease.leaseId, loadId: lease.loadId, revision: snapshot.revision, targets: [report] }, context)).targets[0].status).toBe('editable')
      expect((await service.edit({ type: 'html-preview.edit', operationId: randomUUID(), documentId: snapshot.documentId, epoch: snapshot.epoch,
        baseRevision: snapshot.revision, bindingVersion: lease.bindingVersion, leaseId: lease.leaseId, loadId: lease.loadId, target: report.handle, change: { kind: 'text', value: '' } }, context)).status).toBe('applied')
    }
    const current = await host.internalAPI.read(initial.documentId)
    if (current.model.kind !== 'text') throw new Error('Expected source')
    const records = Object.values(readHtmlAuthoringRecords(current.model.source))
    expect(records).toHaveLength(2)
    expect(records.map(record => record.binding.textIndex)).toEqual([0, 1])
    expect(new Set(records.map(record => record.binding.path.at(-1)?.attributes?.['data-cw-author-key'])).size).toBe(1)
    await host.internalAPI.save(initial.documentId)
    const cold = await new DocumentHostService(path.join(directory, 'cold')).open(filename)
    if (cold.model.kind !== 'text') throw new Error('Expected source')
    doc.open(); doc.write(cold.model.source); doc.close()
    new Function('window', 'document', doc.getElementById(HTML_AUTHORING_CONSUMER_ID)!.textContent!)(doc.defaultView!, doc)
    expect(doc.querySelector('p')!.textContent).toBe('B')
    expect(doc.querySelector('span')!.textContent).toBe('B')
    Reflect.get(doc.defaultView!, '__cwHtmlAuthoringConsumer').dispose()
  } finally { frame.remove(); await fs.rm(directory, { recursive: true, force: true }) }
})
