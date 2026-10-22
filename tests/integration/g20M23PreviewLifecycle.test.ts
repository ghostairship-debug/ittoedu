import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { PreviewNetworkPolicy } from '../../src/main/previewNetworkPolicy'
import { HtmlPreviewService } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import * as compiledProjection from '../../src/main/workbench/htmlPreview/compiledHtmlPreviewAssets'
import * as sourceParser from '../../src/shared/html/htmlSourceParser'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

async function fixture(withAgent = false, withIdentity = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'g20-preview-life-'))
  directories.push(root)
  const folder = path.join(root, 'lesson')
  await mkdir(folder)
  const filename = path.join(folder, 'lesson.html')
  await writeFile(filename, '<p>saved</p>')
  await writeFile(path.join(folder, 'photo.png'), 'image bytes')
  const agentBundlePath = path.join(root, 'html-preview-agent.iife.js')
  if (withAgent) await writeFile(agentBundlePath, 'globalThis.previewAgentLoaded = true')
  const snapshot: DocumentSnapshot = {
    documentId: 'document', epoch: 'epoch', revision: 2,
    binding: { kind: 'file', path: filename, version: null, bindingVersion: 1 },
    model: { kind: 'text', source: '<p>unsaved</p><img src="photo.png"><img src="https://media.example/a.png">', resources: { assets: {}, components: {} } },
    dirty: true, saving: false, recoverable: true, undoDepth: 1, redoDepth: 0,
  }
  const owner = { processId: 4, frameToken: 'frame', documentToken: 'document-token' }
  const policy = new PreviewNetworkPolicy()
  policy.activateDocument(owner)
  let activeOwner: typeof owner | null = owner
  let activeFrame: { webContentsId: number; processId: number; frameToken: string } | null = {
    webContentsId: 7, processId: owner.processId, frameToken: owner.frameToken,
  }
  const entries = new Set<string>()
  let reads = 0
  let readBarrier: (() => Promise<void>) | undefined
  const service = new HtmlPreviewService({
    readDocument: async () => {
      reads++
      const value = withIdentity ? structuredClone(snapshot) : snapshot
      await readBarrier?.()
      return value
    },
    ...(withIdentity ? { readDocumentIdentity: async () => ({ documentId: snapshot.documentId, epoch: snapshot.epoch,
      revision: snapshot.revision, binding: structuredClone(snapshot.binding), kind: snapshot.model.kind }) } : {}),
    networkOwner: () => activeOwner,
    currentMainFrame: () => activeFrame,
    networkPolicy: policy,
    ...(withAgent ? { agentBundlePath } : {}),
    registerFrameEntry: (url) => { entries.add(url); return () => { entries.delete(url) } },
  })
  const open = (tabId: string) => service.open({ type: 'html-preview.open', documentId: 'document', epoch: 'epoch', expectedBindingVersion: 1, tabId })
  return { root, filename, snapshot, owner, policy, service, entries, open, reads: () => reads,
    setReadBarrier: (next?: () => Promise<void>) => { readBarrier = next },
    setOwner: (next: typeof owner | null) => { activeOwner = next },
    setFrame: (next: typeof activeFrame) => { activeFrame = next },
  }
}

describe('M23 preview lease lifecycle', () => {
  it('reuses an entry projection while rechecking external resource dependencies', async () => {
    const state = await fixture(false, true)
    const data = { format: 'compiled-course-v1', course: { assets: { hero: { url: 'data:image/png;base64,aW1hZ2U=' } } } }
    state.snapshot.model = { kind: 'text', source: `<link rel="stylesheet" href="style.css"><script id="course-data" type="application/json">${JSON.stringify(data)}</script>`,
      resources: { assets: {}, components: {} } }
    await writeFile(path.join(state.root, 'lesson', 'style.css'), 'body{background:url(https://media.example/first.png)}')
    const lease = await state.open('projected-entry')
    const project = vi.spyOn(compiledProjection, 'projectCompiledHtmlPreviewAssets')
    try {
      const first = await (await state.service.handleProtocolRequest(new Request(lease.url))).text()
      expect(await (await state.service.handleProtocolRequest(new Request(lease.url))).text()).toBe(first)
      await state.service.handleProtocolRequest(new Request(lease.url, { method: 'HEAD' }))
      expect(project).toHaveBeenCalledTimes(1)
      await writeFile(path.join(state.root, 'lesson', 'style.css'), 'body{background:url(https://new.example/second.png)}')
      const updated = await state.service.handleProtocolRequest(new Request(lease.url))
      expect(updated.headers.get('Content-Security-Policy')).toContain('https://new.example')
      expect(state.policy.allowsRequest('https://media.example/first.png')).toBe(false)
      expect(project).toHaveBeenCalledTimes(2)
    } finally { project.mockRestore(); state.service.dispose() }
  })

  it('releases source handles and parsed locators when their lease exits', async () => {
    const state = await fixture(false, true)
    state.snapshot.model = { kind: 'text', source: '<html><body><p>unsaved</p></body></html>',
      resources: { assets: {}, components: {} } }
    const execute = vi.fn(async () => { throw new Error('released handles cannot execute edits') })
    const source = new HtmlSourceEditService({ readDocument: async () => state.snapshot, execute, withFileAccess: work => work() })
    const released = vi.spyOn(source, 'releaseLease')
    state.service.setEditPort(source)
    const lease = await state.open('source-handles')
    const parsed = vi.spyOn(sourceParser, 'parseHtmlSourceDocument')
    const report = { handle: 'paragraph', kind: 'text' as const,
      domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }],
      sectionOrder: null, rawText: 'unsaved', attributeName: null, rect: { x: 0, y: 0, width: 100, height: 20 }, scriptCreated: false }
    const request = { type: 'html-preview.resolve-target' as const, leaseId: lease.leaseId, loadId: lease.loadId,
      revision: state.snapshot.revision, targets: [report] }
    try {
      expect((await state.service.resolveTarget(request)).targets[0]?.status).toBe('editable')
      expect((await state.service.resolveTarget(request)).targets[0]?.status).toBe('editable')
      expect(parsed).toHaveBeenCalledTimes(1)
      await state.service.release({ type: 'html-preview.release', tabId: 'source-handles', leaseId: lease.leaseId })
      expect(released).toHaveBeenCalledWith(lease.leaseId, lease.loadId)
      const outcome = await source.edit({ type: 'html-preview.edit', operationId: 'late-edit', documentId: lease.documentId,
        epoch: lease.epoch, baseRevision: state.snapshot.revision, bindingVersion: lease.bindingVersion,
        leaseId: lease.leaseId, loadId: lease.loadId, target: report.handle, change: { kind: 'text', value: 'late' } }, {
        lease, tabId: 'source-handles', rootRealPath: path.dirname(state.filename), entryRealPath: state.filename,
        bindingPath: state.filename, snapshot: state.snapshot })
      expect(outcome).toEqual({ status: 'rejected', reason: 'not-editable' })
      expect(execute).not.toHaveBeenCalled()
    } finally { released.mockRestore(); parsed.mockRestore(); state.service.dispose() }
  })

  it('shares one new-revision snapshot read across concurrent resource requests', async () => {
    const state = await fixture(false, true)
    const lease = await state.open('tab-a'), reads = state.reads()
    state.snapshot.revision++
    let resume!: () => void
    const barrier = new Promise<void>(resolve => { resume = resolve })
    state.setReadBarrier(() => barrier)
    const requests = Array.from({ length: 8 }, () => state.service.handleProtocolRequest(new Request(new URL('photo.png', lease.url))))
    await vi.waitFor(() => { expect(state.reads()).toBe(reads + 1) })
    resume()
    expect((await Promise.all(requests)).map(response => response.status)).toEqual(Array(8).fill(200))
    expect(state.reads()).toBe(reads + 1)
  })

  it('starts a fresh shared read when another revision arrives during the previous read', async () => {
    const state = await fixture(false, true)
    const lease = await state.open('tab-a'), reads = state.reads()
    state.snapshot.revision++
    let resume!: () => void
    const barrier = new Promise<void>(resolve => { resume = resolve })
    state.setReadBarrier(() => barrier)
    const first = state.service.handleProtocolRequest(new Request(new URL('photo.png', lease.url)))
    await vi.waitFor(() => { expect(state.reads()).toBe(reads + 1) })
    state.snapshot.revision++
    state.setReadBarrier()
    expect((await state.service.handleProtocolRequest(new Request(new URL('photo.png', lease.url)))).status).toBe(200)
    expect(state.reads()).toBe(reads + 2)
    resume()
    expect((await first).status).toBe(200)
    await state.service.handleProtocolRequest(new Request(new URL('photo.png', lease.url)))
    expect(state.reads()).toBe(reads + 2)
  })

  it('does not revive a released lease when its shared snapshot read completes', async () => {
    const state = await fixture(false, true)
    const lease = await state.open('tab-a'), reads = state.reads()
    state.snapshot.revision++
    let resume!: () => void
    const barrier = new Promise<void>(resolve => { resume = resolve })
    state.setReadBarrier(() => barrier)
    const request = state.service.handleProtocolRequest(new Request(new URL('photo.png', lease.url)))
    await vi.waitFor(() => { expect(state.reads()).toBe(reads + 1) })
    await state.service.release({ type: 'html-preview.release', tabId: 'tab-a', leaseId: lease.leaseId })
    resume()
    expect((await request).status).toBe(404)
    expect(state.entries.has(lease.url)).toBe(false)
    expect((await state.service.handleProtocolRequest(new Request(lease.url))).status).toBe(404)
  })

  it('serves embedded passive assets from the live lease without repeatedly copying the document', async () => {
    const state = await fixture(false, true)
    const data = { format: 'compiled-course-v1', course: { assets: { hero: { url: 'data:image/png;base64,aW1hZ2U=' } } } }
    const source = `<script id="course-data" type="application/json">${JSON.stringify(data)}</script>`
    state.snapshot.model = { kind: 'text', source, resources: { assets: {}, components: {} } }
    const lease = await state.open('assets')
    const reads = state.reads()
    const html = await (await state.service.handleProtocolRequest(new Request(lease.url))).text()
    const projected = JSON.parse(/<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]!)
    const url = projected.course.assets.hero.url
    const asset = await state.service.handleProtocolRequest(new Request(url))
    expect(asset.headers.get('content-type')).toBe('image/png')
    expect(await asset.text()).toBe('image')
    expect(await (await state.service.handleProtocolRequest(new Request(url, { method: 'HEAD' }))).text()).toBe('')
    expect(state.reads()).toBe(reads)
    expect(state.snapshot.model.source).toBe(source)
    state.snapshot.revision++
    await state.service.handleProtocolRequest(new Request(lease.url))
    expect(state.reads()).toBe(reads + 1)
    await state.service.release({ type: 'html-preview.release', tabId: 'assets', leaseId: lease.leaseId })
    expect((await state.service.handleProtocolRequest(new Request(url))).status).toBe(404)
  })

  it('serves the canonical unsaved source and sibling files with GET/HEAD, then revokes the token', async () => {
    const { service, policy, entries, open } = await fixture()
    const lease = await open('tab-1')
    expect(lease.url).toMatch(/^courseware-preview:\/\/[a-f0-9]{32}\.[a-f0-9]{32}\.app\/[a-f0-9]{64}\/file\/lesson\.html$/)
    expect(lease.url).not.toContain('g20-preview-life')
    expect(entries.has(lease.url)).toBe(true)
    expect(policy.allowsRequest('https://media.example/a.png')).toBe(true)
    const entry = await service.handleProtocolRequest(new Request(lease.url))
    expect(entry.status).toBe(200)
    expect(await entry.text()).toContain('unsaved')
    expect(await service.handleProtocolRequest(new Request(lease.url, { method: 'HEAD' })).then(response => response.text())).toBe('')
    const resource = await service.handleProtocolRequest(new Request(new URL('photo.png', lease.url)))
    expect(resource.status).toBe(200)
    expect(await resource.text()).toBe('image bytes')
    expect((await service.handleProtocolRequest(new Request(lease.url, { method: 'POST' }))).status).toBe(405)
    expect(await service.release({ type: 'html-preview.release', leaseId: lease.leaseId, tabId: 'tab-1' })).toEqual({ released: true })
    expect(entries.has(lease.url)).toBe(false)
    expect(policy.allowsRequest('https://media.example/a.png')).toBe(false)
    expect((await service.handleProtocolRequest(new Request(lease.url))).status).toBe(404)
  })

  it('separates tabs and replaces only the matching tab lease', async () => {
    const { service, open } = await fixture()
    const a = await open('tab-a')
    const b = await open('tab-b')
    expect(new URL(a.url).host).not.toBe(new URL(b.url).host)
    expect((await service.handleProtocolRequest(new Request(a.url))).status).toBe(200)
    expect((await service.handleProtocolRequest(new Request(b.url))).status).toBe(200)
    const replacement = await open('tab-a')
    expect((await service.handleProtocolRequest(new Request(a.url))).status).toBe(404)
    expect((await service.handleProtocolRequest(new Request(replacement.url))).status).toBe(200)
    expect((await service.handleProtocolRequest(new Request(b.url))).status).toBe(200)
    expect(await service.release({ type: 'html-preview.release', leaseId: b.leaseId, tabId: 'wrong-tab' })).toEqual({ released: false })
    service.releaseTab('tab-b')
    expect((await service.handleProtocolRequest(new Request(b.url))).status).toBe(404)
  })

  it('serves only the fixed bundled agent path under an active token', async () => {
    const { service, open } = await fixture(true)
    const lease = await open('tab-a')
    expect(await (await service.handleProtocolRequest(new Request(lease.url))).text()).toContain('/_agent/html-preview-agent.iife.js')
    const scriptUrl = lease.url.replace('/file/lesson.html', '/_agent/html-preview-agent.iife.js')
    const script = await service.handleProtocolRequest(new Request(scriptUrl))
    expect(script.headers.get('Content-Type')).toContain('text/javascript')
    expect(await script.text()).toContain('previewAgentLoaded')
    expect((await service.handleProtocolRequest(new Request(scriptUrl.replace('html-preview-agent.iife.js', 'other.js')))).status).toBe(404)
    service.releaseTab('tab-a')
    expect((await service.handleProtocolRequest(new Request(scriptUrl))).status).toBe(404)
  })

  it('runs the preview agent after doctype but before authored scripts', async () => {
    const state = await fixture(true)
    state.snapshot.model = { kind: 'text', source: '<!doctype html><html><head><script>window.authored = true</script></head><body></body></html>',
      resources: { assets: {}, components: {} } }
    const lease = await state.open('tab-a')
    const html = await (await state.service.handleProtocolRequest(new Request(lease.url))).text()
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html.indexOf('html-preview-agent.iife.js')).toBeGreaterThan('<!doctype html>'.length - 1)
    expect(html.indexOf('html-preview-agent.iife.js')).toBeLessThan(html.indexOf('window.authored'))
  })

  it('serves versioned local CSS and normalizes its classified media without writing the source', async () => {
    const state = await fixture()
    const source = '<link rel="stylesheet" href="style.css?v=1"><img src="//images.example/a.png" srcset="//images.example/a.png 1x, //images.example/b.png 2x">'
    state.snapshot.model = { kind: 'text', source, resources: { assets: {}, components: {} } }
    await writeFile(path.join(state.root, 'lesson', 'style.css'), 'body{background:url(//images.example/bg.png)}')
    const lease = await state.open('tab-a')
    const html = await (await state.service.handleProtocolRequest(new Request(lease.url))).text()
    expect(html).toContain('src="https://images.example/a.png"')
    expect(html).toContain('https://images.example/b.png 2x')
    const cssUrl = new URL('style.css?v=1', lease.url)
    const css = await state.service.handleProtocolRequest(new Request(cssUrl))
    expect(css.status).toBe(200)
    expect(await css.text()).toContain('url(https://images.example/bg.png)')
    expect((await state.service.handleProtocolRequest(new Request(`${lease.url}?v=1`))).status).toBe(404)
    expect((state.snapshot.model as { source: string }).source).toBe(source)
    expect(state.policy.allowsRequest('https://images.example/bg.png')).toBe(true)
  })

  it('replaces remote media grants when a canonical HTML edit changes the entry', async () => {
    const state = await fixture()
    const lease = await state.open('tab-a')
    expect(state.policy.allowsRequest('https://media.example/a.png')).toBe(true)
    state.snapshot.revision += 1
    state.snapshot.model = { kind: 'text', source: '<img src="https://new.example/image.png">', resources: { assets: {}, components: {} } }
    const response = await state.service.handleProtocolRequest(new Request(lease.url))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain('https://new.example')
    expect(state.policy.allowsRequest('https://new.example/image.png')).toBe(true)
    expect(state.policy.allowsRequest('https://media.example/a.png')).toBe(false)
  })

  it('invalidates on Save As binding, close, and main-frame navigation', async () => {
    const state = await fixture()
    const first = await state.open('tab-a')
    state.snapshot.revision++
    state.snapshot.model = { kind: 'text', source: '<p>new draft</p>', resources: { assets: {}, components: {} } }
    state.service.releaseChangedBinding(state.snapshot)
    expect((await state.service.handleProtocolRequest(new Request(first.url))).status).toBe(200)
    state.snapshot.binding = { kind: 'file', path: path.join(state.root, 'other.html'), version: null, bindingVersion: 2 }
    state.service.releaseChangedBinding(state.snapshot)
    expect((await state.service.handleProtocolRequest(new Request(first.url))).status).toBe(404)
    state.snapshot.binding = { kind: 'file', path: state.filename, version: null, bindingVersion: 1 }
    const second = await state.open('tab-a')
    state.service.releaseDocument('document')
    expect((await state.service.handleProtocolRequest(new Request(second.url))).status).toBe(404)
    const third = await state.open('tab-a')
    state.setFrame({ webContentsId: 7, processId: 5, frameToken: 'new-frame' })
    expect((await state.service.handleProtocolRequest(new Request(third.url))).status).toBe(404)
    state.setFrame({ webContentsId: 7, processId: 4, frameToken: 'frame' })
    state.setOwner(null)
    await expect(state.open('tab-a')).rejects.toThrow('not active')
  })

  it('keeps image bytes compact while replaying the same lease receipt and rejecting different bytes', async () => {
    const state = await fixture(), lease = await state.open('image-receipt')
    const edit = vi.fn(async () => {
      state.snapshot.revision += 1
      return { status: 'applied' as const, revision: state.snapshot.revision, savedRevision: null, dirty: true as const,
        patch: { handle: 'image', kind: 'image' as const, value: 'new-image' } }
    })
    state.service.setEditPort({ resolveTarget: async () => ({ revision: state.snapshot.revision, targets: [] }), edit,
      editSource: async () => ({ status: 'unchanged', revision: state.snapshot.revision }) })
    const bytes = new Uint8Array(8 * 1024 * 1024); bytes.fill(23)
    const changedBytes = new Uint8Array(bytes); changedBytes[changedBytes.length - 1] = 24
    const request = { type: 'html-preview.edit' as const, operationId: 'image-operation', documentId: 'document', epoch: 'epoch',
      baseRevision: 2, bindingVersion: 1, leaseId: lease.leaseId, loadId: lease.loadId, target: 'image',
      change: { kind: 'image' as const, name: 'picked.png', mimeType: 'image/png', bytes } }
    const arrays = vi.spyOn(Array, 'from')
    try {
      const first = await state.service.edit(request)
      expect(first.status).toBe('applied')
      expect(await state.service.edit(request)).toEqual(first)
      expect(await state.service.edit({ ...request, change: { ...request.change, bytes: changedBytes } }))
        .toEqual({ status: 'rejected', reason: 'conflict' })
      expect(edit).toHaveBeenCalledTimes(1)
      expect(arrays.mock.calls.some(([value]) => value === bytes || value === changedBytes)).toBe(false)
      expect(bytes.byteLength).toBe(8 * 1024 * 1024)
    } finally { arrays.mockRestore(); state.service.dispose() }
  })

  it('returns the committed edit ACK for the same operation after the source revision advances', async () => {
    const state = await fixture()
    const lease = await state.open('tab-a')
    let commits = 0
    state.service.setEditPort({
      resolveTarget: async () => ({ revision: state.snapshot.revision, targets: [] }),
      edit: async request => {
        commits += 1
        state.snapshot.revision += 1
        return { status: 'applied', revision: state.snapshot.revision, savedRevision: null, dirty: true,
          patch: { handle: request.target, kind: 'text', value: 'new' } }
      },
      editSource: async () => {
        commits += 1
        state.snapshot.revision += 1
        return { status: 'applied', revision: state.snapshot.revision, savedRevision: null, dirty: true, reload: true }
      },
    })
    const request = { type: 'html-preview.edit' as const, operationId: 'human-op', documentId: 'document', epoch: 'epoch',
      baseRevision: 2, bindingVersion: 1, leaseId: lease.leaseId, loadId: lease.loadId, target: 'text-1',
      change: { kind: 'text' as const, value: 'new' } }
    const first = await state.service.edit(request)
    expect(first.status).toBe('applied')
    expect(await state.service.edit(request)).toEqual(first)
    expect(commits).toBe(1)
    expect(await state.service.edit({ ...request, change: { kind: 'text', value: 'different' } })).toEqual({ status: 'rejected', reason: 'conflict' })
    expect(commits).toBe(1)
    const sourceRequest = { ...request, type: 'html-preview.edit-source' as const, operationId: 'source-op',
      baseRevision: state.snapshot.revision, command: { type: 'style' as const,
        target: { kind: 'element' as const, from: 0, to: 10 }, patch: { gap: '16px' } } }
    const sourceFirst = await state.service.editSource(sourceRequest)
    expect(sourceFirst.status).toBe('applied')
    expect(await state.service.editSource(sourceRequest)).toEqual(sourceFirst)
    expect(commits).toBe(2)
    expect(await state.service.editSource({ ...sourceRequest, command: { ...sourceRequest.command, patch: { gap: '24px' } } }))
      .toEqual({ status: 'rejected', reason: 'conflict' })
    expect(commits).toBe(2)
  })
})
