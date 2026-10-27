import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { HtmlActionService, type PublishedActionPreviewPort, type PublishedActionTarget } from '../../src/main/workbench/observation/HtmlActionService'
import { htmlActionModelMessage } from '../../src/main/workbench/observation/HtmlActionModelInput'
import { htmlActionScript, htmlCourseNavigateScript, sameHtmlPreviewDocumentUrl,
  type HtmlPageState } from '../../src/main/workbench/observation/HtmlActionPageScript'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import type { HtmlActionFramePort, PublishedActionAutomationContext } from '../../src/main/workbench/observation/HtmlActionDesktopPort'
import type { HtmlPreviewAutomationContext, HtmlPreviewService } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { HtmlPreviewService as RealHtmlPreviewService } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { PreviewNetworkPolicy } from '../../src/main/previewNetworkPolicy'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { modelToolResult } from '../../src/core/tools/modelToolResult'

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/vS8AAAAASUVORK5CYII=', 'base64'))

function fixture(options: { images?: ObservationImageStore; observationTimeoutMs?: number; published?: PublishedActionPreviewPort } = {}) {
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
  const service = new HtmlActionService({ preview, frames, images: options.images ?? new ObservationImageStore(),
    observationTimeoutMs: options.observationTimeoutMs, published: options.published })
  return { service, frames, setRevision: (next: number) => { revision = next },
    freshPreviewRevision: (next: number) => {
      revision = next
      activeContext = { ...context, lease: { ...lease, leaseId: `lease-${next}`, loadId: `load-${next}`, revision: next } }
      frameToken = `frame-${next}`
    },
    freshDocument: () => {
      revision = 0; frameToken = 'other-frame'
      activeContext = { ...context, bindingPath: 'D:\\lesson\\other.html', lease: { ...lease,
        documentId: 'other', epoch: 'other-epoch', revision: 0, leaseId: 'other-lease', loadId: 'other-load',
        url: 'courseware-preview://preview.app/file/other.html' } }
    },
    setFrame: (next: string) => { frameToken = next }, holdFrame: (wait: Promise<void>) => { frameWait = wait },
    failNextAction: () => { unknownAfterAction = true },
    clicks: () => clicks, stopped: () => stopped }
}

describe('M28 HTML action sessions', () => {
  it('a timed-out identity wait cannot block or publish over the next observation', async () => {
    const f = fixture({ observationTimeoutMs: 80 })
    await f.service.beginDocumentRun('identity-timeout', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    let release!: () => void
    f.holdFrame(new Promise<void>(resolve => { release = resolve }))
    try {
      await expect(f.service.observe('identity-timeout')).rejects.toMatchObject({
        code: 'observation-timeout', observationStage: 'identity',
      })
      f.holdFrame(Promise.resolve())
      const current = await f.service.observe('identity-timeout')
      expect(current.generation).toBe(1)
      release(); await Promise.resolve(); await Promise.resolve()
      await f.service.click('identity-timeout', { operationId: 'fresh-handle', handle: current.elements[0]!.handle })
      expect(f.clicks()).toBe(1)
    } finally { release(); f.service.stopRun('identity-timeout') }
  })

  it('cancels only the current Published observation signal and allows a fresh observation in the same run', async () => {
    const identity = { documentId: 'doc', epoch: 'epoch', revision: 2, projectId: 'project',
      locationId: 'page', stateId: null, viewGeneration: 'worker' }
    const context: PublishedActionAutomationContext = { kind: 'published', runId: 'single-observation', identity,
      webContentsId: 7, frameProcessId: 1, frameToken: 'frame-a', url: 'courseware-preview://preview.app/file/demo.html' }
    const published: PublishedActionPreviewPort = { contextForTarget: async () => context, currentContext: async () => context,
      readState: async () => ({ locationId: 'page', stateId: null, structure: [], diagnostics: [] }) }
    const f = fixture({ published }), controller = new AbortController()
    let started!: () => void, aborted = false
    const entered = new Promise<void>(resolve => { started = resolve })
    f.frames.observeAndCapture = async (_context, _token, signal) => {
      signal!.addEventListener('abort', () => { aborted = true }, { once: true })
      started()
      return new Promise(() => {})
    }
    const target = { identity, snapshot: {} as PublishedActionTarget['snapshot'], signal: controller.signal }
    const pending = f.service.observePublished('single-observation', target)
    const stopped = expect(pending).rejects.toThrow()
    try {
      await entered; controller.abort(); await stopped
      expect(aborted).toBe(true)
      f.frames.observeAndCapture = async (context, token, signal) => ({
        state: await f.frames.observe(context, token, signal), capture: await f.frames.capture(context, token, signal),
      })
      const next = await f.service.observePublished('single-observation', { ...target, signal: undefined })
      expect(next.generation).toBe(1)
      expect(next.identity).toMatchObject(identity)
    } finally { f.service.stopRun('single-observation') }
  })

  it('bounds follow-up observation, aborts its transport and preserves an applied click without replay', async () => {
    const f = fixture({ observationTimeoutMs: 60 }), observe = f.frames.observe
    await f.service.beginDocumentRun('deadline', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const first = await f.service.observe('deadline')
    let aborted = false
    f.frames.observe = async (_context, _token, signal) => {
      signal!.addEventListener('abort', () => { aborted = true }, { once: true })
      return new Promise(() => {})
    }
    const input = { operationId: 'once-only', handle: first.elements[0]!.handle }
    const expected = { code: 'html-action-observation-failed', actionReceipt: {
      application: 'applied', dispatch: 'dispatched', goal: 'unverified', observation: 'failed',
    } }
    try {
      await expect(f.service.click('deadline', input)).rejects.toMatchObject(expected)
      expect(aborted).toBe(true)
      await expect(f.service.click('deadline', input)).rejects.toMatchObject(expected)
      expect(f.clicks()).toBe(1)
      f.frames.observe = observe
      const next = await f.service.observe('deadline')
      expect(next.generation).toBe(first.generation + 1)
      expect(next.structure).toContain('clicked 1; input ')
    } finally { f.service.stopRun('deadline') }
  })

  it('discards a late image from an expired attempt without clearing the newer same-revision result', async () => {
    const images = new ObservationImageStore(), put = images.put.bind(images)
    let release!: () => void, entered!: () => void, lateId = '', hold = true
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    images.put = async (...args) => {
      const image = await put(...args)
      if (hold) { hold = false; lateId = image.resourceId; entered(); await pending }
      return image
    }
    const f = fixture({ images, observationTimeoutMs: 80 })
    await f.service.beginDocumentRun('late-image', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const first = f.service.observe('late-image')
    const rejected = expect(first).rejects.toMatchObject({ code: 'observation-timeout', observationStage: 'image-store' })
    try {
      await waiting; await rejected
      const second = await f.service.observe('late-image')
      expect(second.generation).toBe(1)
      release()
      // Resolving put runs the attempt-scoped discard before this next turn.
      await new Promise(resolve => setTimeout(resolve, 0))
      await expect(images.read('late-image', lateId)).rejects.toThrow('不存在')
      expect((await f.service.readResource('late-image', second.image.resourceId)).bytes).toEqual(PNG)
      await f.service.click('late-image', { operationId: 'current-handle', handle: second.elements[0]!.handle })
      expect(f.clicks()).toBe(1)
    } finally { release(); f.service.stopRun('late-image') }
  })

  it('preserves an applied ACK when the follow-up observation fails and never dispatches it again', async () => {
    const f = fixture(), observe = f.frames.observe
    await f.service.beginDocumentRun('ack', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const first = await f.service.observe('ack')
    f.frames.observe = async () => { throw new Error('capture unavailable') }
    const input = { operationId: 'applied-click', handle: first.elements[0]!.handle }
    const expected = { code: 'html-action-observation-failed', actionReceipt: {
      operationId: 'applied-click', dispatch: 'dispatched', application: 'applied', goal: 'unverified', observation: 'failed',
    } }
    await expect(f.service.click('ack', input)).rejects.toMatchObject(expected)
    await expect(f.service.click('ack', input)).rejects.toMatchObject(expected)
    expect(f.clicks()).toBe(1)
    f.frames.observe = observe
    expect((await f.service.observe('ack')).structure).toContain('clicked 1; input ')
    f.service.stopRun('ack')
  })

  it('preserves a completed navigation when its follow-up observation fails', async () => {
    const f = fixture()
    await f.service.beginDocumentRun('nav', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    let navigations = 0
    f.frames.navigate = async () => { navigations++ }
    f.frames.observe = async () => { throw new Error('capture unavailable') }
    const expected = {
      code: 'html-action-observation-failed', actionReceipt: {
        operationId: 'nav-op', dispatch: 'dispatched', application: 'applied', goal: 'unverified', observation: 'failed',
      },
    }
    await expect(f.service.navigate('nav', 1, 'nav-op')).rejects.toMatchObject(expected)
    await expect(f.service.navigate('nav', 1, 'nav-op')).rejects.toMatchObject(expected)
    expect(navigations).toBe(1)
    f.service.stopRun('nav')
  })

  it('reports a measured input mismatch without calling it unknown or replaying the trusted input', async () => {
    const f = fixture(), act = f.frames.act
    let inputs = 0
    f.frames.act = async (...args) => {
      const input = args[2]
      if (input.type !== 'input') return act(...args)
      inputs++
      await act(args[0], args[1], { ...input, value: '8' }, args[3])
      return { applied: true, inputOutcome: { status: 'value-mismatch', requestedValue: input.value, actualValue: '8' } }
    }
    await f.service.beginDocumentRun('run', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const first = await f.service.observe('run')
    const input = { operationId: 'mismatch', handle: first.elements[1]!.handle, value: '40' }
    await expect(f.service.input('run', input)).rejects.toMatchObject({ code: 'html-input-value-mismatch', actionReceipt: {
      operationId: 'mismatch', dispatch: 'dispatched', application: 'applied', goal: 'mismatch', observation: 'not_requested',
    } })
    await expect(f.service.input('run', input)).rejects.toMatchObject({ code: 'html-input-value-mismatch' })
    expect(inputs).toBe(1)
    const current = await f.service.observe('run')
    expect(current.structure).toContain('clicked 0; input 8')
    await f.service.click('run', { operationId: 'new-click', handle: current.elements[0]!.handle })
    expect(f.clicks()).toBe(1)
    f.service.stopRun('run')
  })

  it('reports frame sources without bootstrap HTML through observe, click and input while keeping current handles', async () => {
    const f = fixture(), observe = f.frames.observe
    const payload = 'BOOTSTRAP_TRANSPORT_BODY'.repeat(15_000)
    const source = 'courseware-editor://app/_observation/worker/bootstrap/lab'
    const internalUrl = `${source}?html=${payload}&variant=web`
    const externalUrl = 'https://example.test/article?html=public-source#section'
    let raw: HtmlPageState | undefined
    f.frames.observe = async (...args) => {
      const state = await observe(...args)
      raw = { ...state, observationScope: { kind: 'visible-preview-frames', frames: [
        ...(['observed', 'not-visible', 'unavailable'] as const).map((status, index) => ({
          frameId: index + 1, url: internalUrl, status, returnedElements: 0, matchedElements: 0, truncatedElements: 0,
        })), { frameId: 4, url: externalUrl, status: 'observed', returnedElements: 0, matchedElements: 0, truncatedElements: 0 },
      ] } }
      return raw
    }
    const onDiagnostic = f.frames.onDiagnostic
    f.frames.onDiagnostic = (context, token, receive) => onDiagnostic(context, token, diagnostic =>
      receive({ ...diagnostic, source: internalUrl }))
    await f.service.beginDocumentRun('report', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    try {
      const first = await f.service.observe('report')
      const clicked = await f.service.click('report', { operationId: 'click', handle: first.elements[0]!.handle })
      const filled = await f.service.input('report', { operationId: 'input', handle: clicked.elements[1]!.handle, value: '42' })
      for (const [name, observation] of [['view.observe', first], ['view.click', clicked], ['view.input', filled]] as const) {
        const message = modelToolResult(name, { kind: 'read', data: observation })
        expect(JSON.stringify(message).includes('BOOTSTRAP_TRANSPORT_BODY')).toBe(false)
        expect(observation.observationScope!.frames.slice(0, 3).map(frame => frame.url))
          .toEqual(Array(3).fill(`${source}?variant=web`))
        expect(observation.observationScope!.frames[3]!.url).toBe(externalUrl)
        expect(observation.errors[0]!.source).toBe(`${source}?variant=web`)
      }
      expect(filled.structure).toContain('clicked 1; input 42')
      expect(raw!.observationScope!.frames[0]!.url).toBe(internalUrl)
      expect(JSON.stringify(await f.service.errors('report')).includes('BOOTSTRAP_TRANSPORT_BODY')).toBe(false)
    } finally { f.service.stopRun('report') }
  })

  it('observes a newly authorized current HTML document without reusing old handles or an unknown action', async () => {
    const f = fixture(), firstDoc = { documentId: 'doc', epoch: 'epoch', revision: 2 }
    const first = await f.service.executeDocumentAction('switch-doc', firstDoc, { name: 'html.observe', input: {} })
    if (!('elements' in first)) throw new Error('Expected observation')
    f.failNextAction()
    await expect(f.service.click('switch-doc', { operationId: 'spent', handle: first.elements[0]!.handle })).rejects.toThrow('结果未知')
    f.freshDocument()
    const otherDoc = { documentId: 'other', epoch: 'other-epoch', revision: 0 }
    await expect(f.service.executeDocumentAction('switch-doc', otherDoc, { name: 'html.click', input: { handle: first.elements[0]!.handle }, operationId: 'no-observe' })).rejects.toThrow('目标已变化')
    const second = await f.service.executeDocumentAction('switch-doc', otherDoc, { name: 'html.observe', input: {} })
    if (!('elements' in second)) throw new Error('Expected observation')
    expect(second.identity.documentId).toBe('other')
    expect(() => f.service.click('switch-doc', { operationId: 'old-handle', handle: first.elements[0]!.handle })).toThrow('句柄已过期')
    expect(() => f.service.click('switch-doc', { operationId: 'spent', handle: second.elements[0]!.handle })).toThrow('不能重发')
    await expect(f.service.readResource('switch-doc', first.image.resourceId)).rejects.toThrow('不存在')
    expect(f.clicks()).toBe(1)
    f.service.stopRun('switch-doc')
    await expect(f.service.executeDocumentAction('switch-doc', otherDoc, { name: 'html.observe', input: {} })).rejects.toThrow('已停止')
  })
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
    expect((await f.service.readResource('run', old.image.resourceId)).bytes).toEqual(PNG)
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

  it('reads and navigates the exported player through its existing navigation owner', async () => {
    const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', { runScripts: 'outside-only' })
    const scenes = [{ id: 'cover' }, { id: 'content' }, { id: 'appendix' }]
    let locationId = scenes[0].id
    const destinations: string[] = []
    const player = { navigation: { read: () => ({ locationId, scenes }) },
      go: async (id: string) => { destinations.push(id); locationId = id; return true } }
    Object.assign(dom.window, { coursePlayer: player, coursePlayerReady: Promise.resolve(player) })
    const before = dom.window.eval(htmlActionScript({ type: 'observe' })) as HtmlPageState
    expect([before.pageIndex, before.pageCount]).toEqual([0, 3])
    expect(await dom.window.eval(htmlCourseNavigateScript(2))).toBe(true)
    const after = dom.window.eval(htmlActionScript({ type: 'observe' })) as HtmlPageState
    expect([after.pageIndex, after.pageCount]).toEqual([2, 3])
    expect(destinations).toEqual(['appendix'])
    player.go = async () => false
    await expect(dom.window.eval(htmlCourseNavigateScript(1))).rejects.toThrow('未接受页面导航')
    expect(locationId).toBe('appendix')
    dom.window.close()
  })

  it('leaves ordinary HTML paging and child-frame markup with the existing preview owner', async () => {
    const dom = new JSDOM('<!doctype html><html><body><main><section style="display:none">first</section><section>second<iframe></iframe></section></main></body></html>', { runScripts: 'outside-only' })
    expect(await dom.window.eval(htmlCourseNavigateScript(0))).toBe(false)
    const state = dom.window.eval(htmlActionScript({ type: 'observe' })) as HtmlPageState
    expect([state.pageIndex, state.pageCount]).toEqual([1, 2])
    expect(dom.window.document.querySelector('section')?.style.display).toBe('none')
    dom.window.close()
  })

  it('keeps child-frame handles after 120 parent elements and reports the observed frame scope', async () => {
    const f = fixture(), observe = f.frames.observe
    f.frames.observe = async (...args) => {
      const state = await observe(...args)
      const child = { ...state.elements[0]!, frameToken: 'nested-frame', label: 'Nested control' }
      return { ...state, elements: [...Array.from({ length: 120 }, (_, index) => ({ ...state.elements[0]!, label: `Parent ${index}` })), child],
        observationScope: { kind: 'visible-preview-frames', frames: [{ frameId: 1, url: state.url,
          status: 'observed', matchedElements: 120, returnedElements: 120, truncatedElements: 0 },
          { frameId: 2, url: 'about:srcdoc', status: 'observed', matchedElements: 1, returnedElements: 1, truncatedElements: 0 }] } }
    }
    await f.service.beginDocumentRun('scope', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const result = await f.service.observe('scope')
    expect(result.elements).toHaveLength(121)
    expect(result.elements.at(-1)?.label).toBe('Nested control')
    expect(result.observationScope?.frames).toHaveLength(2)
  })

  it('prepares an SVG group through its hit child without synthetic interaction and keeps input, disabled and covering checks', () => {
    const dom = new JSDOM('<!doctype html><html><body><svg><g tabindex="0" role="button" aria-label="接线柱 电池 ＋"><circle cx="25" cy="25" r="20"></circle></g></svg><button disabled>禁用</button><div id="cover">遮挡</div></body></html>',
      { url: 'https://local.test/', runScripts: 'outside-only' })
    const { window } = dom
    for (const element of window.document.querySelectorAll('*')) {
      Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ x: 1, y: 1, left: 1, top: 1, right: 81, bottom: 21, width: 80, height: 20 }) })
    }
    const group = window.document.querySelector('g')!
    let clicks = 0
    group.addEventListener('click', () => { clicks += 1 })
    let hit: Element | null = window.document.querySelector('circle')
    Object.defineProperty(window.document, 'elementFromPoint', { value: () => hit })
    const evaluate = <T>(input: Parameters<typeof htmlActionScript>[0]) => window.eval(htmlActionScript(input)) as T
    const observed = evaluate<HtmlPageState>({ type: 'observe' })
    const target = observed.elements.find(element => element.tag === 'g')!
    expect(target).toMatchObject({ role: 'button', label: '接线柱 电池 ＋', editable: false })
    expect(evaluate({ type: 'click', path: target.path, fingerprint: target.fingerprint })).toMatchObject({ applied: true })
    expect(clicks).toBe(0)
    expect(evaluate({ type: 'input', path: target.path, fingerprint: target.fingerprint, value: '改写' }))
      .toMatchObject({ applied: false, reason: 'not-clickable' })
    group.setAttribute('aria-disabled', 'true')
    expect(evaluate({ type: 'click', path: target.path, fingerprint: target.fingerprint }))
      .toMatchObject({ applied: false, reason: 'not-clickable' })
    group.removeAttribute('aria-disabled')
    hit = window.document.querySelector('#cover')
    expect(evaluate({ type: 'click', path: target.path, fingerprint: target.fingerprint }))
      .toMatchObject({ applied: false, reason: 'covered-element' })
    const disabled = observed.elements.find(element => element.tag === 'button')!
    hit = window.document.querySelector('button')
    expect(evaluate({ type: 'click', path: disabled.path, fingerprint: disabled.fingerprint }))
      .toMatchObject({ applied: false, reason: 'not-clickable' })
    expect(clicks).toBe(0)
    dom.window.close()
  })

  it('prepares current DOM targets without synthetic interaction and rejects a replaced node', () => {
    expect(sameHtmlPreviewDocumentUrl('https://local.test/demo.html#step-2', 'https://local.test/demo.html')).toBe(true)
    expect(sameHtmlPreviewDocumentUrl('https://local.test/other.html', 'https://local.test/demo.html')).toBe(false)
    const dom = new JSDOM('<!doctype html><html><body><button id="more">展开</button><input aria-label="回答"><p id="result">初始</p></body></html>',
      { url: 'https://local.test/', runScripts: 'outside-only' })
    const { window } = dom
    for (const element of window.document.querySelectorAll('*')) {
      Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ x: 1, y: 1, left: 1, top: 1, right: 81, bottom: 21, width: 80, height: 20 }) })
    }
    window.document.querySelector('button')!.addEventListener('click', () => {
      window.document.querySelector('#result')!.textContent = '已展开'
    })
    window.document.querySelector('input')!.addEventListener('input', () => {
      window.document.querySelector('#result')!.textContent = (window.document.querySelector('input') as HTMLInputElement).value
    })
    const evaluate = <T>(input: Parameters<typeof htmlActionScript>[0]) => window.eval(htmlActionScript(input)) as T
    let hit: Element | null = window.document.querySelector('button')
    Object.defineProperty(window.document, 'elementFromPoint', { value: () => hit })
    const first = evaluate<HtmlPageState>({ type: 'observe' })
    const button = first.elements.find(item => item.tag === 'button')!
    expect(evaluate<{ applied: boolean }>({ type: 'click', path: button.path, fingerprint: button.fingerprint }).applied).toBe(true)
    expect(evaluate<HtmlPageState>({ type: 'observe' }).structure.join('\n')).toContain('初始')
    const input = evaluate<HtmlPageState>({ type: 'observe' }).elements.find(item => item.tag === 'input')!
    hit = window.document.querySelector('input')
    expect(evaluate<{ applied: boolean }>({ type: 'input', path: input.path, fingerprint: input.fingerprint, value: '光合作用' }).applied).toBe(true)
    expect((hit as HTMLInputElement).value).toBe('')
    const prepared = evaluate<{ applied: boolean; identityFingerprint: string }>({ type: 'input', path: input.path, fingerprint: input.fingerprint, value: '光合作用' })
    ;(hit as HTMLInputElement).value = 'focus 自己改值'
    ;(hit as HTMLInputElement).focus()
    expect(evaluate<{ applied: boolean }>({ type: 'input', path: input.path, fingerprint: input.fingerprint, value: '光合作用',
      expectedIdentity: prepared.identityFingerprint, requireFocus: true }).applied).toBe(true)
    ;(hit as HTMLInputElement).blur()
    expect(evaluate<{ applied: boolean; reason: string }>({ type: 'input', path: input.path, fingerprint: input.fingerprint, value: '光合作用',
      expectedIdentity: prepared.identityFingerprint, requireFocus: true })).toMatchObject({ applied: false, reason: 'input-focus-changed' })
    expect(evaluate<HtmlPageState>({ type: 'observe' }).structure.join('\n')).toContain('初始')
    window.document.querySelector('button')!.replaceWith(window.document.createElement('button'))
    expect(evaluate<{ applied: boolean }>({ type: 'click', path: button.path, fingerprint: button.fingerprint }).applied).toBe(false)
    dom.window.close()
  })
})


describe('stops pending browser transport without replaying actions', () => {
  it('settles an opening frame wait before the frame returns and never attaches late', async () => {
    const f = fixture()
    let release!: () => void
    f.holdFrame(new Promise<void>(resolve => { release = resolve }))
    const starting = f.service.beginDocumentRun('opening', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const rejected = expect(starting).rejects.toThrow('已停止')
    f.service.stopRun('opening')
    await rejected
    release()
    await expect(f.service.observe('opening')).rejects.toThrow('已停止')
  }, 1500)

  it('settles a capture that never acknowledges Stop without publishing stale handles', async () => {
    const f = fixture()
    await f.service.beginDocumentRun('capture', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    let entered!: () => void
    const captureStarted = new Promise<void>(resolve => { entered = resolve })
    f.frames.capture = () => { entered(); return new Promise(() => {}) }
    const observed = f.service.observe('capture')
    const rejected = expect(observed).rejects.toThrow('已停止')
    await captureStarted
    f.service.stopRun('capture')
    await rejected
    await expect(f.service.observe('capture')).rejects.toThrow('已停止')
  }, 1500)

  it('keeps the unknown receipt when an issued click never acknowledges Stop', async () => {
    const f = fixture()
    await f.service.beginDocumentRun('issued', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const first = await f.service.observe('issued')
    let entered!: () => void, release!: () => void
    const issued = new Promise<void>(resolve => { entered = resolve })
    const act = f.frames.act
    f.frames.act = async (...args) => { const result = await act(...args); entered(); await new Promise<void>(resolve => { release = resolve }); return result }
    const input = { operationId: 'one-click', handle: first.elements[0]!.handle }
    const pending = f.service.click('issued', input)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'html-action-outcome-unknown', actionReceipt: {
      operationId: 'one-click', dispatch: 'dispatched', application: 'unknown', goal: 'unverified', observation: 'not_requested',
    } })
    await issued
    expect(f.clicks()).toBe(1)
    f.service.stopRun('issued')
    await rejected
    expect(() => f.service.click('issued', input)).toThrow('已停止')
    release()
    await Promise.resolve()
    expect(f.clicks()).toBe(1)
  }, 1500)
})
