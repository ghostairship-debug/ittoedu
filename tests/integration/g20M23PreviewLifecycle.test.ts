import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { PreviewNetworkPolicy } from '../../src/main/previewNetworkPolicy'
import { HtmlPreviewService } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

async function fixture(withAgent = false) {
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
  const service = new HtmlPreviewService({
    readDocument: async () => snapshot,
    networkOwner: () => activeOwner,
    currentMainFrame: () => activeFrame,
    networkPolicy: policy,
    ...(withAgent ? { agentBundlePath } : {}),
    registerFrameEntry: (url) => { entries.add(url); return () => { entries.delete(url) } },
  })
  const open = (tabId: string) => service.open({ type: 'html-preview.open', documentId: 'document', epoch: 'epoch', expectedBindingVersion: 1, tabId })
  return { root, filename, snapshot, owner, policy, service, entries, open,
    setOwner: (next: typeof owner | null) => { activeOwner = next },
    setFrame: (next: typeof activeFrame) => { activeFrame = next },
  }
}

describe('M23 preview lease lifecycle', () => {
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
  })
})
