import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { HTML_AUTHORING_CONSUMER_ID, extractHtmlAuthoringRecords, patchHtmlAuthoringRecords, readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'
import type { HtmlSelectedTarget } from '../../src/renderer/documentFiles/html/htmlPreviewController'
import type { HtmlPreviewEditContext } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'

function observation() {
  const container = document.createElement('div'); document.body.append(container)
  container.innerHTML = '<p data-item-id="a">same</p><p data-item-id="b">same</p><img src="old.png">'
  const consumer = createDomAuthoring(container, { records: () => ({}) })
  const value = consumer.describe(container.querySelectorAll('p')[1]!.firstChild!)!
  consumer.dispose(); container.remove()
  return { ...value, record: { ...value.record, binding: { ...value.record.binding,
    path: [{ tag: 'body', index: 1 }, ...value.record.binding.path] } } }
}

it('saves an inert author data region plus the shared consumer and strips it once on import', () => {
  const value = observation(), source = '<html><body><p data-item-id="a">same</p><p data-item-id="b">same</p></body></html>'
  const records = { [value.authorKey]: { ...value.record, overrides: { text: 'changed </script> only B' } } }
  const saved = patchHtmlAuthoringRecords(source, records)
  expect(saved).toContain('type="application/json"')
  expect(saved).not.toContain('changed </script>')
  expect(readHtmlAuthoringRecords(saved)).toEqual(records)
  expect(extractHtmlAuthoringRecords(saved)).toEqual({ source, authoringRecords: records })
  const frame = document.createElement('iframe'); document.body.append(frame)
  const doc = frame.contentDocument!
  doc.open(); doc.write(saved); doc.close()
  const script = doc.getElementById(HTML_AUTHORING_CONSUMER_ID)!.textContent!
  new Function('window', 'document', script)(doc.defaultView!, doc)
  expect([...doc.querySelectorAll('p')].map(node => node.textContent)).toEqual(['same', 'changed </script> only B'])
  ;(doc.defaultView as any).__cwHtmlAuthoringConsumer.dispose()
  frame.remove()
})

it('keeps dynamic IME input as a document draft until ACK, including typing after Save', () => {
  const value = observation(), source = '<html><body></body></html>'
  const target: HtmlSelectedTarget = { report: { handle: 'dynamic', kind: 'text', domPath: [], rawText: 'same', sectionOrder: null,
    attributeName: null, rect: { x: 0, y: 0, width: 20, height: 10 }, scriptCreated: true, authoring: value },
  resolved: { handle: 'dynamic', status: 'editable', locator: { documentId: 'doc', epoch: 'epoch', revision: 0,
    bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: 0 }, valueSpan: null, attributeName: null,
    expectedRaw: 'same', authoring: value } } }
  const drafts = new HtmlTextDrafts()
  drafts.change(target, source, '中文中段输入')
  const first = drafts.prepare(source)
  expect(first.ready).toBe(true)
  expect(drafts.find(target, source)?.value).toBe('中文中段输入')
  expect(drafts.read()).toHaveLength(1)
  drafts.change(target, source, '中文中段输入继续')
  drafts.reconcile(first.source)
  expect(drafts.read()[0]).toMatchObject({ original: '中文中段输入', value: '中文中段输入继续', issue: undefined })
  const second = drafts.prepare(first.source)
  expect(readHtmlAuthoringRecords(second.source)[value.authorKey].overrides.text).toBe('中文中段输入继续')
  drafts.reconcile(second.source)
  expect(drafts.read()).toHaveLength(0)
})

it('commits dynamic text through the same HTML Session, undo/redo and normal disk SaveAs', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'html-author-records-'))
  const filename = path.join(folder, 'original.html'), copied = path.join(folder, 'saved-as.html')
  const source = '<html><body><script>document.body.dataset.keep="interaction"</script><img src="old.png"></body></html>'
  await fs.writeFile(filename, source)
  const driver = new TextDriver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
    binding: { kind: 'file', path: filename, version: 'original', bindingVersion: 1 }, saved: true }, driver, {
    async append() {}, async save(input) {
      if (input.binding.kind !== 'file') throw new Error('file')
      await fs.writeFile(input.binding.path, input.bytes)
      return { ...input.binding, version: 'saved' }
    },
  })
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
  const value = observation()
  const context: HtmlPreviewEditContext = { lease: { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 0, bindingVersion: 1, loadId: 'load', url: 'https://preview.invalid' },
    tabId: 'tab', entryRealPath: filename, rootRealPath: folder, bindingPath: filename, snapshot: session.read() }
  try {
    await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load', revision: 0,
      targets: [{ handle: 'dynamic', kind: 'text', domPath: [], sectionOrder: null, rawText: 'same', attributeName: null,
        rect: { x: 0, y: 0, width: 20, height: 10 }, scriptCreated: true, authoring: { authorKey: value.authorKey, record: value.record } }] }, context)
    expect(await service.edit({ type: 'html-preview.edit', operationId: 'text-edit', documentId: 'doc', epoch: 'epoch', baseRevision: 0,
      bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: 'dynamic', change: { kind: 'text', value: '正式作者修改' } }, context)).toMatchObject({ status: 'applied' })
    expect(session.read().undoDepth).toBe(1)
    await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: 1, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })
    expect(session.read().model).toMatchObject({ source })
    await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: 2, operationId: 'redo', actor: 'human', mutation: { type: 'redo' } })
    await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load', revision: 3,
      targets: [{ handle: 'image', kind: 'image', domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'img', index: 1 }],
        sectionOrder: null, rawText: 'old.png', attributeName: 'src', rect: { x: 0, y: 0, width: 1, height: 1 }, scriptCreated: false }] },
      { ...context, snapshot: session.read() })
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64'))
    expect(await service.edit({ type: 'html-preview.edit', operationId: 'image-edit', documentId: 'doc', epoch: 'epoch', baseRevision: 3,
      bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: 'image', change: { kind: 'image', name: 'selected.png', mimeType: 'image/png', bytes: png } },
      { ...context, snapshot: session.read() })).toMatchObject({ status: 'applied' })
    await session.save({ kind: 'file', path: copied, version: null, bindingVersion: 2 })
    const cold = driver.load(await fs.readFile(copied))
    expect(cold.kind).toBe('text')
    if (cold.kind === 'text') {
      expect(readHtmlAuthoringRecords(cold.source)[value.authorKey].overrides.text).toBe('正式作者修改')
      expect(cold.source).toContain(`src="data:image/png;base64,${Buffer.from(png).toString('base64')}"`)
    }
    expect(await fs.readdir(folder)).toEqual(['original.html', 'saved-as.html'])
    expect(await fs.readFile(filename, 'utf8')).toBe(source)
  } finally { await fs.rm(folder, { recursive: true, force: true }) }
})

it('keeps manual geometry when an exactly mapped HTML text value changes', async () => {
  const value = observation(), original = '<html><body><p data-item-id="a">same</p><p data-item-id="b">same</p></body></html>'
  const record = { ...value.record, overrides: { geometry: { translateX: 20, translateY: 10 } } }
  const source = patchHtmlAuthoringRecords(original, { [value.authorKey]: record })
  const driver = new TextDriver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
    binding: { kind: 'file', path: 'sample.html', version: null, bindingVersion: 1 } }, driver,
    { async append() {}, async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> } })
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
  const context: HtmlPreviewEditContext = { lease: { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 0,
    bindingVersion: 1, loadId: 'load', url: 'https://preview.invalid' }, tabId: 'tab', entryRealPath: 'sample.html',
    rootRealPath: '.', bindingPath: 'sample.html', snapshot: session.read() }
  const targets = [{ handle: 'static', kind: 'text' as const, domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 1 }],
    sectionOrder: null, rawText: 'same', attributeName: null, rect: { x: 0, y: 0, width: 20, height: 10 }, scriptCreated: false,
    authoring: { authorKey: value.authorKey, record } }]
  const resolved = (await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load', revision: 0, targets }, context)).targets[0]!
  expect(resolved).toMatchObject({ status: 'editable', locator: { valueSpan: expect.any(Object) } })
  const drafts = new HtmlTextDrafts()
  drafts.change({ report: targets[0]!, resolved }, source, 'normal draft save')
  const prepared = drafts.prepare(source)
  expect(extractHtmlAuthoringRecords(prepared.source).source).toContain('<p data-item-id="b">normal draft save</p>')
  expect(readHtmlAuthoringRecords(prepared.source)[value.authorKey]).toMatchObject({ binding: { baseline: 'normal draft save' }, overrides: { geometry: record.overrides.geometry } })
  await service.edit({ type: 'html-preview.edit', operationId: 'source-text', documentId: 'doc', epoch: 'epoch', baseRevision: 0,
    bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: 'static', change: { kind: 'text', value: 'new value' } }, context)
  const saved = session.read().model
  if (saved.kind !== 'text') throw new Error('text')
  expect(extractHtmlAuthoringRecords(saved.source).source).toContain('<p data-item-id="b">new value</p>')
  expect(readHtmlAuthoringRecords(saved.source)[value.authorKey]).toMatchObject({ binding: { baseline: 'new value' }, overrides: { geometry: { translateX: 20, translateY: 10 } } })
})
