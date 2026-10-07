import { expect, it, vi } from 'vitest'
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
import { inspectHtmlSource, flattenHtmlSourceNodes } from '../../src/shared/html/htmlSourceStructure'
import { mountHtmlPreviewAgent } from '../../src/player/htmlPreview/htmlPreviewAgent'
import { createElement } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { HtmlPreviewPane } from '../../src/renderer/documentFiles/html/HtmlPreviewPane'

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
  const rebound = patchHtmlAuthoringRecords(source, { [value.authorKey]: { ...value.record, scope: { 'dom:0:data-item-id': 'other' } } })
  expect(drafts.prepare(rebound).ready).toBe(false)
  expect(readHtmlAuthoringRecords(rebound)[value.authorKey].overrides.text).toBeUndefined()
  expect(drafts.read()[0].value).toBe('中文中段输入')
  const first = drafts.prepare(source)
  expect(first.ready).toBe(true)
  expect(drafts.prepare(first.source)).toEqual(first)
  expect(drafts.find(target, source)?.value).toBe('中文中段输入')
  expect(drafts.read()).toHaveLength(1)
  drafts.change(target, source, '中文中段输入继续')
  const optimistic = drafts.prepare(first.source)
  expect(optimistic.ready).toBe(true)
  expect(readHtmlAuthoringRecords(optimistic.source)[value.authorKey].overrides.text).toBe('中文中段输入继续')
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
  const record = { ...value.record, overrides: { style: { color: 'red' }, geometry: { translateX: 20, translateY: 10, width: 180 } } }
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
  const nextRecord = readHtmlAuthoringRecords(saved.source)[value.authorKey]
  await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load', revision: 1,
    targets: [{ ...targets[0]!, rawText: 'new value', authoring: { authorKey: value.authorKey, record: nextRecord } }] }, { ...context, snapshot: session.read() })
  await service.edit({ type: 'html-preview.edit', operationId: 'record-style', documentId: 'doc', epoch: 'epoch', baseRevision: 1,
    bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: 'static', change: { kind: 'style', patch: { width: '140px' } } }, { ...context, snapshot: session.read() })
  const restyled = session.read().model
  if (restyled.kind !== 'text') throw new Error('text')
  expect(readHtmlAuthoringRecords(restyled.source)[value.authorKey].overrides).toMatchObject({ style: { width: '140px' }, geometry: { translateX: 20, translateY: 10 } })
  expect(readHtmlAuthoringRecords(restyled.source)[value.authorKey].overrides.geometry?.width).toBeUndefined()
})

it('anchors a repeated static object and keeps its geometry through structure text, style and move on a cold consumer', async () => {
  const original = '<html><body><p>same</p><p>same</p></body></html>'
  const frame = document.createElement('iframe'); document.body.append(frame)
  const doc = frame.contentDocument!
  doc.open(); doc.write(original); doc.close()
  const consumer = createDomAuthoring(doc.documentElement, { records: () => ({}) })
  const selected = consumer.describe(doc.querySelectorAll('p')[1]!.firstChild!)!
  consumer.dispose()
  const driver = new TextDriver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(original)),
    binding: { kind: 'file', path: 'sample.html', version: null, bindingVersion: 1 } }, driver,
    { async append() {}, async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> } })
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
  const context = (): HtmlPreviewEditContext => ({ lease: { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: session.read().revision,
    bindingVersion: 1, loadId: 'load', url: 'https://preview.invalid' }, tabId: 'tab', entryRealPath: 'sample.html',
    rootRealPath: '.', bindingPath: 'sample.html', snapshot: session.read() })
  const currentSource = () => { const model = session.read().model; if (model.kind !== 'text') throw new Error('text'); return model.source }
  const sourceEdit = async (command: Parameters<typeof service.editSource>[0]['command']) => {
    const revision = session.read().revision
    expect(await service.editSource({ type: 'html-preview.edit-source', operationId: `source-${revision}`, documentId: 'doc', epoch: 'epoch',
      baseRevision: revision, bindingVersion: 1, leaseId: 'lease', loadId: 'load', command }, context())).toMatchObject({ status: 'applied' })
  }
  const targetNode = () => flattenHtmlSourceNodes(inspectHtmlSource(currentSource()).roots)
    .find(node => node.attributes['data-cw-author-key'] === selected.authorKey)!
  try {
    await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load', revision: 0,
      targets: [{ handle: 'static', kind: 'text', domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 1 }],
        sectionOrder: null, rawText: 'same', attributeName: null, rect: { x: 0, y: 0, width: 20, height: 10 }, scriptCreated: false,
        bindingStatus: selected.bindingStatus, authoring: { authorKey: selected.authorKey, record: selected.record } }] }, context())
    expect(await service.edit({ type: 'html-preview.edit', operationId: 'geometry', documentId: 'doc', epoch: 'epoch', baseRevision: 0,
      bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: 'static', change: { kind: 'geometry', geometry: { translateX: 25, width: 180 } } }, context()))
      .toMatchObject({ status: 'applied' })
    expect(readHtmlAuthoringRecords(currentSource())[selected.authorKey].binding.path.at(-1)?.attributes)
      .toMatchObject({ 'data-cw-author-key': selected.authorKey })
    await sourceEdit({ type: 'text', target: targetNode().children[0].address!, text: 'source changed' })
    const currentRecord = readHtmlAuthoringRecords(currentSource())[selected.authorKey]
    await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load', revision: session.read().revision,
      targets: [{ handle: 'light-style', kind: 'text', domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 1 }],
        sectionOrder: null, rawText: 'source changed', attributeName: null, rect: { x: 0, y: 0, width: 20, height: 10 }, scriptCreated: false,
        authoring: { authorKey: selected.authorKey, record: currentRecord } }] }, context())
    expect(await service.edit({ type: 'html-preview.edit', operationId: 'light-style', documentId: 'doc', epoch: 'epoch', baseRevision: session.read().revision,
      bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: 'light-style', change: { kind: 'style', patch: { width: '140px' } } }, context()))
      .toMatchObject({ status: 'applied' })
    await sourceEdit({ type: 'style', target: targetNode().address!, patch: { 'line-height': '1.6' } })
    const body = flattenHtmlSourceNodes(inspectHtmlSource(currentSource()).roots).find(node => node.name === 'body')!
    await sourceEdit({ type: 'move', target: targetNode().address!, parent: body.address!, index: 0 })
    const records = readHtmlAuthoringRecords(currentSource())
    expect(records[selected.authorKey]).toMatchObject({ binding: { baseline: 'source changed' }, overrides: { geometry: { translateX: 25 } } })
    expect(records[selected.authorKey].overrides.geometry?.width).toBeUndefined()
    doc.open(); doc.write(currentSource()); doc.close()
    new Function('window', 'document', doc.getElementById(HTML_AUTHORING_CONSUMER_ID)!.textContent!)(doc.defaultView!, doc)
    expect([...doc.querySelectorAll('p')].map(node => node.textContent)).toEqual(['source changed', 'same'])
    expect(doc.querySelector('p')!.style.translate).toContain('25px')
    expect(doc.querySelector('p')!.style.width).toBe('140px')
    expect(doc.querySelectorAll('p')[1]!.style.translate).toBe('')
    ;(doc.defaultView as any).__cwHtmlAuthoringConsumer.dispose()
  } finally { frame.remove() }
})

it('applies the first static anchor ACK to the same live handle without rerunning the page', async () => {
  document.body.innerHTML = '<p>same</p><p>same</p>'
  const target = document.querySelectorAll('p')[1]!
  const action = vi.fn(); target.onclick = action
  const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
    value: () => ({ x: 0, y: 0, width: 20, height: 10 }) })
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: () => ({ offsetNode: target.firstChild, offset: 0 }) })
  const posted = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  const dispose = mountHtmlPreviewAgent(document)
  const message = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }))
  try {
    message({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
    message({ type: 'html-preview.edit-mode', loadId: 'load', requestId: 'edit', enabled: true })
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const report = posted.mock.calls.map(call => call[0]).find(item => item.event === 'targets')!.targets[0]
    const source = document.documentElement.outerHTML.replace(/<div[^>]*data-html-preview-edit-markers[^>]*>[\s\S]*?<\/div>/, '')
    const driver = new TextDriver()
    const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
      binding: { kind: 'file', path: 'sample.html', version: null, bindingVersion: 1 } }, driver,
      { async append() {}, async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> } })
    const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
    const context: HtmlPreviewEditContext = { lease: { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 0,
      bindingVersion: 1, loadId: 'load', url: 'https://preview.invalid' }, tabId: 'tab', entryRealPath: 'sample.html', rootRealPath: '.', bindingPath: 'sample.html', snapshot: session.read() }
    await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load', revision: 0, targets: [report] }, context)
    const result = await service.edit({ type: 'html-preview.edit', operationId: 'gesture', documentId: 'doc', epoch: 'epoch', baseRevision: 0,
      bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: report.handle, change: { kind: 'geometry', geometry: { translateX: 25 } } }, context)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') throw new Error('geometry')
    message({ type: 'html-preview.patch', loadId: 'load', ...result.patch, expected: report.rawText })
    message({ type: 'html-preview.authoring-records', loadId: 'load', records: result.patch.authoringRecords })
    expect(target.getAttribute('data-cw-author-key')).toBe(report.authoring.authorKey)
    expect(target.style.translate).toContain('25px')
    expect(document.querySelector('p')!.style.translate).toBe('')
    expect(session.read().undoDepth).toBe(1)
    message({ type: 'html-preview.authoring-records', loadId: 'load', records: {} })
    expect(target.style.translate).toBe('')
    message({ type: 'html-preview.edit-mode', loadId: 'load', requestId: 'finish', enabled: false })
    target.click()
    expect(action).toHaveBeenCalledOnce()
  } finally {
    dispose(); posted.mockRestore()
    if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect)
    else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    Reflect.deleteProperty(document, 'caretPositionFromPoint')
    Reflect.deleteProperty(window, '__cwHtmlAuthoringRecords')
    document.body.replaceChildren()
  }
})

it('keeps runtime classes through an unrelated source edit and a move into a runtime styled parent', async () => {
  const key = 'runtime-styled-target'
  const original = '<html><body><h1>Heading</h1><article id="dest" class="loading"></article><p id="b" class="loading" data-cw-author-key="runtime-styled-target">same</p><script id="program">document.getElementById("b").className="ready";document.getElementById("dest").className="ready"</script></body></html>'
  const record = { kind: 'text' as const, binding: { kind: 'dom' as const, path: [{ tag: 'body', index: 1 },
    { tag: 'p', index: 2, attributes: { id: 'b', class: 'ready', 'data-cw-author-key': key } }], textIndex: 0, baseline: 'same' }, overrides: { geometry: { translateX: 25 } } }
  const source = patchHtmlAuthoringRecords(original, { [key]: record })
  const driver = new TextDriver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
    binding: { kind: 'file', path: 'sample.html', version: null, bindingVersion: 1 } }, driver,
    { async append() {}, async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> } })
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
  const current = () => { const model = session.read().model; if (model.kind !== 'text') throw new Error('text'); return model.source }
  const apply = async (command: Parameters<typeof service.editSource>[0]['command']) => {
    const snapshot = session.read()
    await service.editSource({ type: 'html-preview.edit-source', operationId: `source-${snapshot.revision}`, documentId: 'doc', epoch: 'epoch',
      baseRevision: snapshot.revision, bindingVersion: 1, leaseId: 'lease', loadId: 'load', command }, {
      lease: { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: snapshot.revision, bindingVersion: 1, loadId: 'load', url: 'https://preview.invalid' },
      tabId: 'tab', entryRealPath: 'sample.html', rootRealPath: '.', bindingPath: 'sample.html', snapshot })
  }
  let nodes = flattenHtmlSourceNodes(inspectHtmlSource(current()).roots)
  await apply({ type: 'text', target: nodes.find(node => node.name === 'h1')!.children[0].address!, text: 'New heading' })
  expect(readHtmlAuthoringRecords(current())[key].binding.path).toEqual(record.binding.path)
  nodes = flattenHtmlSourceNodes(inspectHtmlSource(current()).roots)
  await apply({ type: 'move', target: nodes.find(node => node.attributes.id === 'b')!.address!, parent: nodes.find(node => node.attributes.id === 'dest')!.address!, index: 0 })
  const frame = document.createElement('iframe'); document.body.append(frame)
  const doc = frame.contentDocument!
  try {
    doc.open(); doc.write(current()); doc.close()
    new Function('document', doc.getElementById('program')!.textContent!)(doc)
    new Function('window', 'document', doc.getElementById(HTML_AUTHORING_CONSUMER_ID)!.textContent!)(doc.defaultView!, doc)
    expect(doc.querySelector('#dest p')!.className).toBe('ready')
    expect((doc.querySelector('#b') as HTMLElement).style.translate).toContain('25px')
    ;(doc.defaultView as any).__cwHtmlAuthoringConsumer.dispose()
  } finally { frame.remove() }
})

it('compiles one real HTML pointer stream through the iframe and parent matrices into one Session history', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const source = '<html><body><p id="title">Hello</p></body></html>'
  const driver = new TextDriver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
    binding: { kind: 'file', path: 'sample.html', version: null, bindingVersion: 1 } }, driver,
    { async append() {}, async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> } })
  const lease = { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 0, bindingVersion: 1, loadId: 'load', url: 'about:blank' }
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
  const context = () => ({ lease, tabId: 'tab', entryRealPath: 'sample.html', rootRealPath: '.', bindingPath: 'sample.html', snapshot: session.read() })
  const previous = window.desktopAPI
  const requests: string[] = []
  Reflect.set(window, 'desktopAPI', { workspaceFiles: async (request: Parameters<typeof service.edit>[0] | Parameters<typeof service.resolveTarget>[0]) => {
    requests.push(request.type)
    if (request.type === 'html-preview.resolve-target') return service.resolveTarget(request, context())
    return service.edit(request, context())
  } })
  const view = render(createElement(HtmlPreviewPane, { lease, committed: session.read(), tabId: 'tab', textDrafts: new HtmlTextDrafts(), onUndo() {}, onRedo() {} }))
  const iframe = view.getByTitle('HTML 预览') as HTMLIFrameElement
  Object.defineProperty(iframe, 'offsetWidth', { configurable: true, value: 400 })
  Object.defineProperty(iframe, 'offsetHeight', { configurable: true, value: 200 })
  iframe.getBoundingClientRect = () => ({ x: 100, y: 50, left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, toJSON() {} })
  const posted = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
  const report = { handle: 'title', kind: 'text', domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }],
    sectionOrder: null, rawText: 'Hello', attributeName: null, rect: { x: 20, y: 40, width: 200, height: 40 }, scriptCreated: false, bindingStatus: 'bound',
    authoring: { authorKey: 'title-key', record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0, attributes: { id: 'title' } }], textIndex: 0, baseline: 'Hello' }, overrides: {} } },
    geometry: { frame: { width: 100, height: 20, transform: [1, 0, 0, 1, 10, 20] }, parentToInstance: [2, 0, 0, 2, 0, 0], author: {}, boxInsets: { width: 0, height: 0 } } }
  try {
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow,
      data: { event: 'targets', protocol: 1, leaseId: 'lease', loadId: 'load', seq: 1, targets: [report] } })))
    const handle = await view.findByLabelText('移动 HTML 内部对象') as HTMLButtonElement
    handle.setPointerCapture = () => {}
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
      Object.defineProperty(event, 'pointerId', { value: 1 }); return event
    }
    fireEvent(handle, pointer('pointerdown', 120, 90))
    fireEvent(handle, pointer('pointermove', 140, 100))
    fireEvent(handle, pointer('pointermove', 160, 110))
    expect(session.read().undoDepth).toBe(0)
    fireEvent(handle, pointer('pointerup', 160, 110))
    await waitFor(() => expect(session.read().undoDepth).toBe(1))
    expect(requests.filter(type => type === 'html-preview.edit')).toHaveLength(1)
    const saved = session.read().model
    if (saved.kind !== 'text') throw new Error('text')
    expect(readHtmlAuthoringRecords(saved.source)['title-key'].overrides.geometry).toMatchObject({ translateX: 20, translateY: 10 })
    expect(posted.mock.calls.map(call => call[0]).filter(item => item.type === 'html-preview.authoring-preview')).toHaveLength(3)
  } finally { view.unmount(); posted.mockRestore(); Reflect.set(window, 'desktopAPI', previous); vi.unstubAllGlobals() }
})

it('keeps the other anchored object width when moving a repeated sibling then styling the moved object', async () => {
  const original = '<html><body><p data-cw-author-key="a">same</p><p data-cw-author-key="b">same</p></body></html>'
  const record = (key: string, index: number, width: number) => ({ kind: 'text' as const, binding: { kind: 'dom' as const,
    path: [{ tag: 'body', index: 1 }, { tag: 'p', index, attributes: { 'data-cw-author-key': key } }], textIndex: 0, baseline: 'same' }, overrides: { geometry: { width } } })
  const source = patchHtmlAuthoringRecords(original, { a: record('a', 0, 90), b: record('b', 1, 180) }), driver = new TextDriver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
    binding: { kind: 'file', path: 'sample.html', version: null, bindingVersion: 1 } }, driver,
    { async append() {}, async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> } })
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
  const current = () => { const model = session.read().model; if (model.kind !== 'text') throw new Error('text'); return model.source }
  const apply = async (command: Parameters<typeof service.editSource>[0]['command']) => {
    const snapshot = session.read()
    await service.editSource({ type: 'html-preview.edit-source', operationId: `source-${snapshot.revision}`, documentId: 'doc', epoch: 'epoch',
      baseRevision: snapshot.revision, bindingVersion: 1, leaseId: 'lease', loadId: 'load', command }, {
      lease: { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: snapshot.revision, bindingVersion: 1, loadId: 'load', url: 'about:blank' },
      tabId: 'tab', entryRealPath: 'sample.html', rootRealPath: '.', bindingPath: 'sample.html', snapshot })
  }
  let nodes = flattenHtmlSourceNodes(inspectHtmlSource(current()).roots)
  await apply({ type: 'move', target: nodes.find(node => node.attributes['data-cw-author-key'] === 'b')!.address!,
    parent: nodes.find(node => node.name === 'body')!.address!, index: 0 })
  nodes = flattenHtmlSourceNodes(inspectHtmlSource(current()).roots)
  await apply({ type: 'style', target: nodes.find(node => node.attributes['data-cw-author-key'] === 'b')!.address!, patch: { width: '140px' } })
  expect(readHtmlAuthoringRecords(current()).a.overrides.geometry?.width).toBe(90)
  expect(readHtmlAuthoringRecords(current()).b.overrides.geometry?.width).toBeUndefined()
})
