// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import type { HtmlPreviewEditContext } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import type { HtmlPreviewRequest } from '../../src/shared/workbench/htmlPreview'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { HtmlPreviewPane } from '../../src/renderer/documentFiles/html/HtmlPreviewPane'
import { mountHtmlPreviewAgent } from '../../src/player/htmlPreview/htmlPreviewAgent'
import { HtmlPreviewController } from '../../src/renderer/documentFiles/html/htmlPreviewController'
import { HtmlLightEditOverlay } from '../../src/renderer/documentFiles/html/HtmlLightEditOverlay'

const roots: string[] = []
afterEach(async () => { cleanup(); vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

async function setup(source: string, entryName = 'lesson.html') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m23-html-edit-')); roots.push(root)
  const filename = path.join(root, entryName)
  await fs.writeFile(filename, source)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const snapshot = await host.open(filename)
  if (snapshot.binding.kind !== 'file') throw new Error('file binding')
  const lease = { leaseId: 'lease', loadId: 'load', documentId: snapshot.documentId, epoch: snapshot.epoch,
    revision: snapshot.revision, bindingVersion: snapshot.binding.bindingVersion, url: 'preview://test' }
  const context: HtmlPreviewEditContext = { lease, tabId: 'tab', snapshot, bindingPath: filename,
    rootRealPath: await fs.realpath(root), entryRealPath: await fs.realpath(filename) }
  const service = new HtmlSourceEditService({ readDocument: id => host.internalAPI.read(id),
    execute: operation => host.internalAPI.dispatch(operation), withFileAccess: work => host.fileCoordinator.withFileAccess(work) })
  return { root, filename, host, snapshot, lease, context, service }
}

it('commits only the located text in one human History entry and supports undo', async () => {
  const f = await setup('<html>\r\n<body><p>same</p><p>same</p><button>+1</button></body></html>\r\n')
  const report = { handle: 'target', kind: 'text' as const, domPath: [{ name: 'html', index: 0 },
    { name: 'body', index: 1 }, { name: 'p', index: 1 }], sectionOrder: null, rawText: 'same', attributeName: null,
    rect: { x: 0, y: 0, width: 40, height: 20 }, scriptCreated: false }
  const resolved = await f.service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load',
    revision: f.snapshot.revision, targets: [report] }, f.context)
  expect(resolved.targets[0]?.status).toBe('editable')
  const request: Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }> = {
    type: 'html-preview.edit', operationId: 'op-text', documentId: f.snapshot.documentId, epoch: f.snapshot.epoch,
    baseRevision: f.snapshot.revision, bindingVersion: f.lease.bindingVersion, leaseId: 'lease', loadId: 'load',
    target: 'target', change: { kind: 'text', value: '新 <文>' },
  }
  const result = await f.service.edit(request, f.context)
  expect(result).toMatchObject({ status: 'applied', patch: { handle: 'target', kind: 'text', value: '新 <文>' } })
  const after = await f.host.internalAPI.read(f.snapshot.documentId)
  expect(after.model).toMatchObject({ source: '<html>\r\n<body><p>same</p><p>新 &lt;文&gt;</p><button>+1</button></body></html>\r\n' })
  expect(after.undoDepth).toBe(f.snapshot.undoDepth + 1)
  const undo = await f.host.internalAPI.dispatch({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision,
    operationId: 'undo-text', actor: 'human', mutation: { type: 'undo' } })
  expect(undo.status).toBe('applied')
  expect((await f.host.internalAPI.read(after.documentId)).model).toMatchObject({ source: (f.snapshot.model as { source: string }).source })
})

it('prepares selected bytes, rejects symlink assets, and removes responsive srcset in one source commit', async () => {
  const f = await setup('<html><body><picture><source srcset="old.webp"><img src="old.png" srcset="other.png" alt="图"></picture></body></html>')
  const report = { handle: 'image', kind: 'image' as const, domPath: [{ name: 'html', index: 0 },
    { name: 'body', index: 1 }, { name: 'picture', index: 0 }, { name: 'img', index: 1 }], sectionOrder: null,
    rawText: 'old.png', attributeName: 'src', rect: { x: 0, y: 0, width: 40, height: 20 }, scriptCreated: false }
  await f.service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load',
    revision: f.snapshot.revision, targets: [report] }, f.context)
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])
  const request: Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }> = {
    type: 'html-preview.edit', operationId: 'op-image', documentId: f.snapshot.documentId, epoch: f.snapshot.epoch,
    baseRevision: f.snapshot.revision, bindingVersion: f.lease.bindingVersion, leaseId: 'lease', loadId: 'load',
    target: 'image', change: { kind: 'image', name: 'selected.png', mimeType: 'image/png', bytes },
  }
  expect(await f.service.edit(request, f.context)).toMatchObject({ status: 'applied', patch: { value: 'lesson.assets/image-op-image.png' } })
  const after = await f.host.internalAPI.read(f.snapshot.documentId)
  expect(after.model).toMatchObject({ source: '<html><body><picture><source><img src="lesson.assets/image-op-image.png" alt="图"></picture></body></html>' })
  expect(await fs.readFile(path.join(f.root, 'lesson.assets', 'image-op-image.png'))).toEqual(Buffer.from(bytes))

  const other = await setup('<html><body><img src="old.png"></body></html>')
  await fs.symlink(f.root, path.join(other.root, 'lesson.assets'), 'dir')
  const otherReport = { ...report, domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'img', index: 0 }] }
  await other.service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load',
    revision: other.snapshot.revision, targets: [otherReport] }, other.context)
  const denied = await other.service.edit({ ...request, documentId: other.snapshot.documentId, epoch: other.snapshot.epoch,
    baseRevision: other.snapshot.revision, bindingVersion: other.lease.bindingVersion }, other.context)
  expect(denied).toMatchObject({ status: 'rejected' })
  expect((await other.host.internalAPI.read(other.snapshot.documentId)).revision).toBe(other.snapshot.revision)

  const conflict = await setup('<html><body><img src="old.png"></body></html>')
  const rejected = new HtmlSourceEditService({ readDocument: id => conflict.host.internalAPI.read(id),
    execute: async operation => ({ status: 'conflict', documentId: operation.documentId, operationId: operation.operationId,
      code: 'fixture-conflict', message: 'fixture conflict', applied: false }),
    withFileAccess: work => conflict.host.fileCoordinator.withFileAccess(work) })
  await rejected.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load',
    revision: conflict.snapshot.revision, targets: [otherReport] }, conflict.context)
  expect(await rejected.edit({ ...request, operationId: 'op-conflict', documentId: conflict.snapshot.documentId,
    epoch: conflict.snapshot.epoch, baseRevision: conflict.snapshot.revision,
    bindingVersion: conflict.lease.bindingVersion }, conflict.context)).toMatchObject({ status: 'rejected', reason: 'conflict' })
  await expect(fs.stat(path.join(conflict.root, 'lesson.assets', 'image-op-conflict.png'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('encodes reserved characters in the asset URL while keeping the real filename', async () => {
  const f = await setup('<html><body><img src="old.png"></body></html>', 'lesson#1.html')
  const report = { handle: 'image', kind: 'image' as const,
    domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'img', index: 0 }],
    sectionOrder: null, rawText: 'old.png', attributeName: 'src', rect: { x: 0, y: 0, width: 40, height: 20 }, scriptCreated: false }
  await f.service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load',
    revision: f.snapshot.revision, targets: [report] }, f.context)
  const result = await f.service.edit({ type: 'html-preview.edit', operationId: 'image-1', documentId: f.snapshot.documentId,
    epoch: f.snapshot.epoch, baseRevision: f.snapshot.revision, bindingVersion: f.lease.bindingVersion,
    leaseId: 'lease', loadId: 'load', target: 'image',
    change: { kind: 'image', name: 'photo.png', mimeType: 'image/png', bytes: Uint8Array.from([137,80,78,71,13,10,26,10,0]) } }, f.context)
  expect(result).toMatchObject({ status: 'applied', patch: { value: 'lesson%231.assets/image-image-1.png' } })
  expect((await f.host.internalAPI.read(f.snapshot.documentId)).model).toMatchObject({ source: expect.stringContaining('src="lesson%231.assets/image-image-1.png"') })
  expect(await fs.readFile(path.join(f.root, 'lesson#1.assets', 'image-image-1.png'))).toBeTruthy()
})

it('replaces an img with no src by inserting one attribute and can undo to the original placeholder', async () => {
  const f = await setup('<html><body><img alt="待补图片" width="90"></body></html>')
  const report = { handle: 'empty-image', kind: 'image' as const,
    domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'img', index: 0 }],
    sectionOrder: null, rawText: '', attributeName: 'src', rect: { x: 0, y: 0, width: 90, height: 80 }, scriptCreated: false }
  // Browser inserts an empty head; the locator maps this rendered path back to the source.
  const resolved = await f.service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load',
    revision: f.snapshot.revision, targets: [report] }, f.context)
  expect(resolved.targets[0]).toMatchObject({ status: 'editable', locator: { valueSpan: null, expectedRaw: '' } })
  const result = await f.service.edit({ type: 'html-preview.edit', operationId: 'no-src-image', documentId: f.snapshot.documentId,
    epoch: f.snapshot.epoch, baseRevision: f.snapshot.revision, bindingVersion: f.lease.bindingVersion,
    leaseId: 'lease', loadId: 'load', target: 'empty-image',
    change: { kind: 'image', name: 'photo.svg', mimeType: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>') } }, f.context)
  expect(result).toMatchObject({ status: 'applied', patch: { kind: 'image', value: 'lesson.assets/image-no-src-image.svg' } })
  const after = await f.host.internalAPI.read(f.snapshot.documentId)
  expect(after.model).toMatchObject({ source: '<html><body><img alt="待补图片" width="90" src="lesson.assets/image-no-src-image.svg"></body></html>' })
  expect((await f.host.internalAPI.dispatch({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision,
    operationId: 'no-src-undo', actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
  expect((await f.host.internalAPI.read(after.documentId)).model).toMatchObject({ source: '<html><body><img alt="待补图片" width="90"></body></html>' })
  expect(await fs.readFile(path.join(f.root, 'lesson.assets', 'image-no-src-image.svg'))).toBeTruthy()
})

it('restores responsive image attributes on hot undo and only selects in explicit edit mode', () => {
  document.body.innerHTML = '<picture><source srcset="hero.webp" sizes="90vw"><img src="old.png" srcset="old2.png" sizes="80vw"></picture>'
  const image = document.querySelector('img')!
  image.getBoundingClientRect = () => ({ x: 5, y: 5, left: 5, top: 5, width: 100, height: 80, right: 105, bottom: 85, toJSON: () => ({}) })
  const posted: unknown[] = []
  vi.spyOn(window.parent, 'postMessage').mockImplementation(message => { posted.push(message) })
  const dispose = mountHtmlPreviewAgent(document)
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }))
  command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
  fireEvent.click(image)
  expect(posted.some(value => (value as { event?: string }).event === 'targets')).toBe(false)
  command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: true })
  fireEvent.click(image)
  const target = posted.find(value => (value as { event?: string }).event === 'targets') as { targets: Array<{ handle: string }> }
  expect(target?.targets).toHaveLength(1)
  command({ type: 'html-preview.patch', loadId: 'load', handle: target.targets[0]!.handle, kind: 'image', value: 'new.png', expected: 'old.png' })
  expect(image.getAttribute('srcset')).toBeNull()
  expect(document.querySelector('source')?.getAttribute('srcset')).toBeNull()
  command({ type: 'html-preview.patch', loadId: 'load', handle: target.targets[0]!.handle, kind: 'image', value: 'old.png', expected: 'new.png' })
  expect(image.getAttribute('srcset')).toBe('old2.png')
  expect(image.getAttribute('sizes')).toBe('80vw')
  expect(document.querySelector('source')?.getAttribute('srcset')).toBe('hero.webp')
  expect(document.querySelector('source')?.getAttribute('sizes')).toBe('90vw')
  image.setAttribute('srcset', 'script-other.png')
  command({ type: 'html-preview.patch', loadId: 'load', handle: target.targets[0]!.handle, kind: 'image', value: 'new.png', expected: 'old.png' })
  expect(image.getAttribute('src')).toBe('old.png')
  expect(image.getAttribute('srcset')).toBe('script-other.png')
  image.setAttribute('srcset', 'old2.png')
  image.setAttribute('src', 'script.png')
  command({ type: 'html-preview.patch', loadId: 'load', handle: target.targets[0]!.handle, kind: 'image', value: 'new.png', expected: 'old.png' })
  expect(image.getAttribute('src')).toBe('script.png')
  expect(posted.find(value => (value as { event?: string }).event === 'html-preview.patch-result'))
    .toMatchObject({ ok: false, handle: target.targets[0]!.handle })
  dispose()
})

it('reports a nested section under its actual page section after a text double click', () => {
  document.body.innerHTML = '<section id="page"><section><p>内层文字</p></section></section>'
  const text = document.querySelector('p')!.firstChild as Text
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true,
    value: () => ({ offsetNode: text, offset: 0 }) })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
    value: () => ({ x: 5, y: 5, left: 5, top: 5, width: 80, height: 20, right: 85, bottom: 25, toJSON: () => ({}) }) })
  const posted: unknown[] = []
  vi.spyOn(window.parent, 'postMessage').mockImplementation(message => { posted.push(message) })
  const dispose = mountHtmlPreviewAgent(document)
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }))
  command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
  fireEvent.doubleClick(document.querySelector('p')!)
  expect(posted.some(value => (value as { event?: string }).event === 'targets')).toBe(false)
  command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: true })
  fireEvent.doubleClick(document.querySelector('p')!)
  expect(posted.find(value => (value as { event?: string }).event === 'targets'))
    .toMatchObject({ targets: [{ kind: 'text', sectionOrder: 0, rawText: '内层文字' }] })
  dispose()
})

it('marks script replacements as dynamic even when the replacement has identical text', () => {
  document.body.innerHTML = '<p>same</p>'
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true,
    value: () => ({ offsetNode: document.querySelector('p')!.firstChild, offset: 0 }) })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
    value: () => ({ x: 5, y: 5, left: 5, top: 5, width: 80, height: 20, right: 85, bottom: 25, toJSON: () => ({}) }) })
  const posted: unknown[] = []
  vi.spyOn(window.parent, 'postMessage').mockImplementation(message => { posted.push(message) })
  const dispose = mountHtmlPreviewAgent(document)
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }))
  command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
  command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: true })
  document.querySelector('p')!.textContent = 'same'
  fireEvent.doubleClick(document.querySelector('p')!)
  expect(posted.find(value => (value as { event?: string }).event === 'targets'))
    .toMatchObject({ targets: [{ rawText: 'same', scriptCreated: true }] })
  dispose()
})

it('offers the existing source AI card for a no-src image placeholder and a dynamic text target', () => {
  const committed = { documentId: 'doc', epoch: 'epoch', revision: 1,
    model: { kind: 'text', source: '<html><body><img alt="图"><p>计数 1</p></body></html>', resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: '/lesson.html', version: 'v1', bindingVersion: 1 } } as DocumentSnapshot
  const image = { report: { handle: 'image', kind: 'image' as const, domPath: [], sectionOrder: null, rawText: '', attributeName: 'src',
    rect: { x: 1, y: 1, width: 40, height: 30 }, scriptCreated: false },
  resolved: { handle: 'image', status: 'editable' as const, locator: { documentId: 'doc', epoch: 'epoch', revision: 1,
    bindingVersion: 1, targetKind: 'image' as const, elementSpan: { start: 12, end: 25 }, valueSpan: null,
    attributeName: 'src', expectedRaw: '' } } }
  const props = { committed, position: { left: 4, top: 4 }, onText: vi.fn(), onImage: vi.fn(), onClose: vi.fn() }
  const mounted = render(createElement(HtmlLightEditOverlay, { ...props, target: image }))
  expect(screen.getByRole('button', { name: '选择图片' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'AI 修改' })).toBeTruthy()
  mounted.rerender(createElement(HtmlLightEditOverlay, { ...props, target: { report: { ...image.report,
    handle: 'dynamic', kind: 'text', rawText: '计数 1', attributeName: null, scriptCreated: true },
    resolved: { handle: 'dynamic', status: 'not-editable', reason: 'script-created' } } }))
  expect(screen.getByText('不能直接修改这个位置，可用 AI 修改 HTML 源码。')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'AI 修改' })).toBeTruthy()
  mounted.unmount()
})

it('keeps the same frame and script state when canonical change arrives before the edit ACK', async () => {
  const original = '<html><body><p>old</p></body></html>'
  const updated = '<html><body><p>new</p></body></html>'
  const snapshot = (revision: number, source: string): DocumentSnapshot => ({ documentId: 'doc', epoch: 'epoch', revision,
    model: { kind: 'text', source, resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: '/lesson.html', version: 'v1', bindingVersion: 1 },
    dirty: true, saving: false, recoverable: true, undoDepth: revision - 1, redoDepth: 0 })
  const lease = { leaseId: 'lease', loadId: 'load', documentId: 'doc', epoch: 'epoch', revision: 1,
    bindingVersion: 1, url: 'courseware-preview://app/token/file/lesson.html' }
  let settle!: (value: object) => void
  const pending = new Promise<object>(resolve => { settle = resolve })
  const workspaceFiles = vi.fn(async (request: { type: string }) => request.type === 'html-preview.resolve-target'
    ? { revision: 1, targets: [{ handle: 'text', status: 'editable', locator: { documentId: 'doc', epoch: 'epoch', revision: 1,
      bindingVersion: 1, targetKind: 'text', elementSpan: { start: 12, end: 22 }, valueSpan: { start: 15, end: 18 },
      attributeName: null, expectedRaw: 'old' } }] }
    : request.type === 'html-preview.edit' ? pending : { released: true })
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { workspaceFiles } })
  const props = { lease, committed: snapshot(1, original), tabId: 'tab', onUndo: vi.fn(), onRedo: vi.fn(), active: true }
  const mounted = render(createElement(HtmlPreviewPane, props))
  const frame = screen.getByTitle('HTML 预览') as HTMLIFrameElement
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  const frameWindow = frame.contentWindow!
  Reflect.set(frameWindow, 'testCounter', 7)
  fireEvent.click(screen.getByRole('button', { name: '编辑预览' }))
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frameWindow, data: { event: 'key', protocol: 1,
    leaseId: 'lease', loadId: 'load', seq: 1, intent: 'undo' } })) })
  expect(props.onUndo).not.toHaveBeenCalled()
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frameWindow, data: { event: 'targets', protocol: 1,
    leaseId: 'lease', loadId: 'load', seq: 2, targets: [{ handle: 'text', kind: 'text',
      domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }], sectionOrder: null,
      rawText: 'old', attributeName: null, rect: { x: 5, y: 5, width: 40, height: 20 }, scriptCreated: false }] } })) })
  const input = await screen.findByRole('textbox', { name: 'HTML 文字' })
  fireEvent.change(input, { target: { value: 'new' } })
  expect((input as HTMLTextAreaElement).value).toBe('new')
  fireEvent.click(screen.getByRole('button', { name: '应用' }))
  await waitFor(() => expect(workspaceFiles).toHaveBeenCalledWith(expect.objectContaining({ type: 'html-preview.edit' })))
  mounted.rerender(createElement(HtmlPreviewPane, { ...props, committed: snapshot(2, updated) }))
  expect(screen.getByTitle('HTML 预览')).toBe(frame)
  expect(Reflect.get(frameWindow, 'testCounter')).toBe(7)
  expect(screen.queryByText('源码已从其他编辑入口变化。')).toBeNull()
  settle({ status: 'applied', revision: 2, savedRevision: null, dirty: true,
    patch: { handle: 'text', kind: 'text', value: 'new' } })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑 HTML 文字' })).toBeNull())
  expect(screen.getByTitle('HTML 预览')).toBe(frame)
  expect(Reflect.get(frameWindow, 'testCounter')).toBe(7)
  mounted.unmount()
})

it('does not downgrade revision or hot patch after a newer canonical change precedes an older ACK', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const posted = vi.spyOn(frame.contentWindow!, 'postMessage')
  let settle!: (value: object) => void
  const pending = new Promise<object>(resolve => { settle = resolve })
  const workspaceFiles = vi.fn(async (request: { type: string; revision?: number }) => request.type === 'html-preview.resolve-target'
    ? { revision: request.revision, targets: [{ handle: 'target', status: 'editable', locator: { documentId: 'doc', epoch: 'epoch',
      revision: request.revision, bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: 10 },
      valueSpan: { start: 1, end: 4 }, attributeName: null, expectedRaw: 'old' } }] }
    : pending)
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { workspaceFiles } })
  const lease = { leaseId: 'lease', loadId: 'load', documentId: 'doc', epoch: 'epoch', revision: 1,
    bindingVersion: 1, url: 'courseware-preview://app/token/file/lesson.html' }
  const onTarget = vi.fn(), onApplied = vi.fn(), onEditSettled = vi.fn()
  const controller = new HtmlPreviewController(frame, lease, { onTarget, onApplied, onEditSettled, onPatchMismatch: vi.fn(),
    onEditing: vi.fn(), onPage: vi.fn(), onReady: vi.fn() })
  const report = { handle: 'target', kind: 'text', domPath: [{ name: 'html', index: 0 }], sectionOrder: null,
    rawText: 'old', attributeName: null, rect: { x: 0, y: 0, width: 10, height: 10 }, scriptCreated: false }
  const send = (seq: number) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
    data: { event: 'targets', protocol: 1, leaseId: 'lease', loadId: 'load', seq, targets: [report] } }))
  send(1)
  await waitFor(() => expect(onTarget).toHaveBeenCalledWith(expect.objectContaining({ report }), undefined))
  const edit = controller.editText('new')
  const newer = { documentId: 'doc', epoch: 'epoch', revision: 3,
    model: { kind: 'text', source: 'later', resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: '/lesson.html', version: 'v1', bindingVersion: 1 } } as DocumentSnapshot
  controller.updateCommitted(newer)
  settle({ status: 'applied', revision: 2, savedRevision: null, dirty: true,
    patch: { handle: 'target', kind: 'text', value: 'new' } })
  expect((await edit).status).toBe('applied')
  expect(onApplied).not.toHaveBeenCalled()
  expect(posted).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'html-preview.patch' }), '*')
  send(2)
  await waitFor(() => expect(workspaceFiles).toHaveBeenCalledWith(expect.objectContaining({ type: 'html-preview.resolve-target', revision: 3 })))
  controller.dispose()
  frame.remove()
})
