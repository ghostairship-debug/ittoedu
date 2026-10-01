import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error jsdom is a Vitest-only fixture and does not ship declarations here.
import { JSDOM } from 'jsdom'
import { HtmlActionService } from '../../src/main/workbench/observation/HtmlActionService'
import { htmlActionModelMessage } from '../../src/main/workbench/observation/HtmlActionModelInput'
import { htmlActionScript, sameHtmlPreviewDocumentUrl,
  type HtmlPageState } from '../../src/main/workbench/observation/HtmlActionPageScript'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import type { HtmlActionFramePort } from '../../src/main/workbench/observation/HtmlActionDesktopPort'
import type { HtmlPreviewAutomationContext, HtmlPreviewService } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { HtmlPreviewService as RealHtmlPreviewService } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { PreviewNetworkPolicy } from '../../src/main/previewNetworkPolicy'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/vS8AAAAASUVORK5CYII=', 'base64'))

function fixture() {
  let revision = 2, frameToken = 'frame-a', clicks = 0, inputValue = '', stopped = 0
  let unknownAfterAction = false
  let frameWait: Promise<void> = Promise.resolve()
  const lease = { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 2, bindingVersion: 1,
    loadId: 'load', url: 'courseware-preview://preview.app/file/demo.html' }
  const context: HtmlPreviewAutomationContext = { lease, tabId: 'tab', webContentsId: 7, bindingPath: 'D:\\lesson\\demo.html' }
  let activeContext = context
  const preview = { automationContext: async (leaseId: string, loadId: string, expected: number) => {
    if (leaseId !== activeContext.lease.leaseId || loadId !== activeContext.lease.loadId
      || expected !== revision || revision !== activeContext.lease.revision)
      throw new Error('HTML 源码版本已变化，请重新打开预览并观察')
    return activeContext
  }, automationContextForDocument: async (input: { documentId: string; epoch: string; revision: number }) => {
    if (input.documentId !== activeContext.lease.documentId || input.epoch !== activeContext.lease.epoch
      || input.revision !== revision)
      throw new Error('HTML 文档来源不匹配')
    return activeContext
  } } as HtmlPreviewService
  const frames: HtmlActionFramePort = {
    frameToken: async () => { await frameWait; return frameToken },
    observe: async () => ({ url: activeContext.lease.url, title: 'dynamic', readyState: 'complete', pageIndex: 0, pageCount: 1,
      structure: [`clicked ${clicks}; input ${inputValue}`], diagnostics: [], elements: [
        { path: [0], fingerprint: `button-${clicks}`, tag: 'button', role: '', label: '展开', text: '展开', editable: false,
          rect: { x: 1, y: 1, width: 80, height: 20 } },
        { path: [1], fingerprint: `input-${inputValue}`, tag: 'input', role: '', label: 'answer', text: '', editable: true,
          rect: { x: 1, y: 30, width: 80, height: 20 } },
      ] }) as HtmlPageState,
    act: async (_context, _token, input) => {
      if (input.type === 'click') {
        if (input.fingerprint !== `button-${clicks}`) return { applied: false, reason: 'stale-element' }
        clicks += 1
      } else {
        if (input.fingerprint !== `input-${inputValue}`) return { applied: false, reason: 'stale-element' }
        inputValue = input.value
      }
      if (unknownAfterAction) { unknownAfterAction = false; throw new Error('动作结果未知') }
      return { applied: true }
    },
    navigate: async () => {},
    capture: async () => ({ png: PNG, width: 1, height: 1 }),
    onDiagnostic: (_context, _token, receive) => { receive({ level: 'warning', message: 'page warning', source: lease.url, line: 1 });
      return () => { stopped += 1 } },
  }
  const service = new HtmlActionService({ preview, frames, images: new ObservationImageStore() })
  return { service, setRevision: (next: number) => { revision = next },
    freshPreviewRevision: (next: number) => {
      revision = next
      activeContext = { ...context, lease: { ...lease, leaseId: `lease-${next}`, loadId: `load-${next}`, revision: next } }
      frameToken = `frame-${next}`
    },
    setFrame: (next: string) => { frameToken = next }, holdFrame: (wait: Promise<void>) => { frameWait = wait },
    failNextAction: () => { unknownAfterAction = true },
    clicks: () => clicks, stopped: () => stopped }
}

describe('M28 HTML action sessions', () => {
  it('selects only the exact current document preview and revokes source changes', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'g20-html-actions-'))
    try {
      const file = path.join(folder, 'demo.html')
      await writeFile(file, '<button>go</button>')
      const snapshot: DocumentSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 2,
        binding: { kind: 'file', path: file, version: null, bindingVersion: 1 },
        model: { kind: 'text', source: '<button>go</button>', resources: { assets: {}, components: {} } },
        dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
      const owner = { processId: 4, frameToken: 'main', documentToken: 'owner' }
      const policy = new PreviewNetworkPolicy()
      policy.activateDocument(owner)
      const preview = new RealHtmlPreviewService({ readDocument: async () => snapshot,
        networkOwner: () => owner, currentMainFrame: () => ({ webContentsId: 7, processId: 4, frameToken: 'main' }),
        networkPolicy: policy, registerFrameEntry: () => () => {} })
      await preview.open({ type: 'html-preview.open', documentId: 'doc', epoch: 'epoch',
        expectedBindingVersion: 1, tabId: 'a' })
      await preview.open({ type: 'html-preview.open', documentId: 'doc', epoch: 'epoch',
        expectedBindingVersion: 1, tabId: 'b' })
      await expect(preview.automationContextForDocument({ documentId: 'doc', epoch: 'epoch', revision: 2 }))
        .rejects.toThrow('多个预览')
      expect((await preview.automationContextForDocument({ documentId: 'doc', epoch: 'epoch', revision: 2,
        tabId: 'a' })).tabId).toBe('a')
      snapshot.revision = 3
      await expect(preview.automationContextForDocument({ documentId: 'doc', epoch: 'epoch', revision: 2,
        tabId: 'a' })).rejects.toThrow('源码版本已变化')
      preview.dispose()
    } finally { await rm(folder, { recursive: true, force: true }) }
  })

  it('observes current state after click/input, requires new handles, retains action receipts and revokes on Stop', async () => {
    const f = fixture()
    await f.service.beginDocumentRun('run', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const first = await f.service.observe('run')
    expect(first.source).toBe('live-html-preview')
    expect(first.errors[0]?.message).toBe('page warning')
    expect((await f.service.readResource('run', first.image.resourceId)).bytes).toEqual(PNG)
    const message = htmlActionModelMessage({ toolCallId: 'call-1', target: '当前 HTML', observation: first,
      bytes: (await f.service.readResource('run', first.image.resourceId)).bytes })
    expect(message.role).toBe('user')
    const parts = message.content
    expect(Array.isArray(parts) && parts[1] !== null && typeof parts[1] === 'object'
      && !Array.isArray(parts[1]) && 'type' in parts[1] && parts[1].type).toBe('image_url')
    const clicked = await f.service.click('run', { operationId: 'op-1', handle: first.elements[0]!.handle })
    expect(clicked.structure[0]).toContain('clicked 1')
    const afterClick = htmlActionModelMessage({ toolCallId: 'call-2', target: '当前 HTML', toolName: 'html.click',
      observation: clicked, bytes: (await f.service.readResource('run', clicked.image.resourceId)).bytes })
    expect(JSON.stringify(afterClick.content)).toContain('工具 html.click 后的真实画面')
    expect(f.clicks()).toBe(1)
    expect(await f.service.click('run', { operationId: 'op-1', handle: first.elements[0]!.handle })).toBe(clicked)
    expect(f.clicks()).toBe(1)
    expect(() => f.service.click('run', { operationId: 'op-2', handle: first.elements[0]!.handle }))
      .toThrow('句柄已过期')
    const typed = await f.service.input('run', { operationId: 'op-3', handle: clicked.elements[1]!.handle, value: '新的回答' })
    expect(typed.structure[0]).toContain('新的回答')
    f.service.stopRun('run')
    expect(f.stopped()).toBe(1)
    await expect(f.service.readResource('run', typed.image.resourceId)).rejects.toThrow('已停止')
    await expect(f.service.observe('run')).rejects.toThrow('已停止')
  })

  it('rejects source revisions and frame reloads rather than attributing an old screenshot to a new page', async () => {
    const f = fixture()
    await f.service.beginRun('run', { leaseId: 'lease', loadId: 'load', revision: 2 })
    const observed = await f.service.observe('run')
    f.setRevision(3)
    await expect(f.service.click('run', { operationId: 'op', handle: observed.elements[0]!.handle }))
      .rejects.toThrow('源码版本已变化')
    f.setRevision(2)
    f.setFrame('frame-b')
    await expect(f.service.observe('run')).rejects.toThrow('已切换')
  })

  it('revokes an in-flight begin before it can register a session', async () => {
    const f = fixture()
    let release!: () => void
    f.holdFrame(new Promise<void>(resolve => { release = resolve }))
    const starting = f.service.beginRun('run', { leaseId: 'lease', loadId: 'load', revision: 2 })
    f.service.stopRun('run')
    release()
    await expect(starting).rejects.toThrow('已停止')
    await expect(f.service.beginRun('run', { leaseId: 'lease', loadId: 'load', revision: 2 }))
      .rejects.toThrow('已停止')
  })

  it('explicitly rebinds a new canonical revision, drops old handles and never replays an unknown old action', async () => {
    const f = fixture()
    await f.service.beginDocumentRun('run', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const old = await f.service.observe('run')
    f.failNextAction()
    await expect(f.service.click('run', { operationId: 'unknown-click', handle: old.elements[0]!.handle }))
      .rejects.toThrow('结果未知')
    expect(f.clicks()).toBe(1)
    f.freshPreviewRevision(3)
    await expect(f.service.observe('run')).rejects.toThrow('源码版本已变化')
    const freshIdentity = await f.service.restartDocumentRun('run', { documentId: 'doc', epoch: 'epoch', revision: 3 })
    expect(freshIdentity.revision).toBe(3)
    await expect(f.service.readResource('run', old.image.resourceId)).rejects.toThrow('不存在')
    const fresh = await f.service.observe('run')
    expect(fresh.identity.revision).toBe(3)
    expect(fresh.elements[0]!.handle).not.toBe(old.elements[0]!.handle)
    expect(() => f.service.click('run', { operationId: 'new-click', handle: old.elements[0]!.handle }))
      .toThrow('句柄已过期')
    expect(() => f.service.click('run', { operationId: 'unknown-click', handle: fresh.elements[0]!.handle }))
      .toThrow('不能重发')
    expect(f.clicks()).toBe(1)
    const clicked = await f.service.click('run', { operationId: 'fresh-click', handle: fresh.elements[0]!.handle })
    expect(clicked.identity.revision).toBe(3)
    expect(f.clicks()).toBe(2)
    f.service.stopRun('run')
    await expect(f.service.restartDocumentRun('run', { documentId: 'doc', epoch: 'epoch', revision: 4 }))
      .rejects.toThrow('已停止')
  })

  it('uses the real page DOM for dynamic clicks and input, and rejects a replaced node', () => {
    expect(sameHtmlPreviewDocumentUrl('https://local.test/demo.html#step-2', 'https://local.test/demo.html')).toBe(true)
    expect(sameHtmlPreviewDocumentUrl('https://local.test/other.html', 'https://local.test/demo.html')).toBe(false)
    const dom = new JSDOM('<!doctype html><html><body><button id="more">展开</button><input aria-label="回答"><p id="result">初始</p></body></html>',
      { url: 'https://local.test/', runScripts: 'outside-only' })
    const { window } = dom
    for (const element of window.document.querySelectorAll('*')) {
      Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ x: 1, y: 1, width: 80, height: 20 }) })
    }
    window.document.querySelector('button')!.addEventListener('click', () => {
      window.document.querySelector('#result')!.textContent = '已展开'
    })
    window.document.querySelector('input')!.addEventListener('input', () => {
      window.document.querySelector('#result')!.textContent = (window.document.querySelector('input') as HTMLInputElement).value
    })
    const evaluate = <T>(input: Parameters<typeof htmlActionScript>[0]) => window.eval(htmlActionScript(input)) as T
    const first = evaluate<HtmlPageState>({ type: 'observe' })
    const button = first.elements.find(item => item.tag === 'button')!
    expect(evaluate<{ applied: boolean }>({ type: 'click', path: button.path, fingerprint: button.fingerprint }).applied).toBe(true)
    expect(evaluate<HtmlPageState>({ type: 'observe' }).structure[0]).toContain('已展开')
    const input = evaluate<HtmlPageState>({ type: 'observe' }).elements.find(item => item.tag === 'input')!
    expect(evaluate<{ applied: boolean }>({ type: 'input', path: input.path, fingerprint: input.fingerprint, value: '光合作用' }).applied).toBe(true)
    expect(evaluate<HtmlPageState>({ type: 'observe' }).structure[0]).toContain('光合作用')
    window.document.querySelector('button')!.replaceWith(window.document.createElement('button'))
    expect(evaluate<{ applied: boolean }>({ type: 'click', path: button.path, fingerprint: button.fingerprint }).applied).toBe(false)
    dom.window.close()
  })
})
