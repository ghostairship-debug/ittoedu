// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { HtmlActionService, type PublishedActionPreviewPort, type PublishedActionTarget } from '../../src/main/workbench/observation/HtmlActionService'
import type { HtmlActionFramePort, PublishedActionAutomationContext } from '../../src/main/workbench/observation/HtmlActionDesktopPort'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import type { ViewObservationSnapshot } from '../../src/shared/workbench/viewObservation'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))

function fixture() {
  const project = createBlankCourseProjectV10('View actions'); project.id = 'project'
  project.surfaces = ['first', 'second'].map(id => ({ id, kind: 'slide', title: id, childIds: [] }))
  const snapshot: ViewObservationSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 1,
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: 'view' },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  let current: PublishedActionAutomationContext | undefined, mounts = 0, clicks = 0, value = '', slider = '0', failAfterInput = false, lastFrame = ''
  let mismatch = false, inputs = 0
  const images = new ObservationImageStore()
  const target = (locationId = 'first'): PublishedActionTarget => ({ snapshot,
    identity: { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, projectId: project.id, locationId, stateId: null } })
  const published: PublishedActionPreviewPort = {
    async contextForTarget(input) {
      if (!current || current.identity.revision !== input.identity.revision) {
        mounts++
        current = { kind: 'published', runId: input.runId, identity: { ...input.identity, viewGeneration: `host-${mounts}` },
          frameProcessId: 3, frameToken: `root-${mounts}`, webContentsId: mounts, url: 'courseware-editor://app/observation.html' }
      } else current = { ...current, identity: { ...current.identity, locationId: input.identity.locationId } }
      return current
    },
    async currentContext(context) {
      if (!current || current.webContentsId !== context.webContentsId || context.identity.revision !== snapshot.revision) throw new Error('课件来源版本已改变')
      return context
    },
    async readState(context) { return { locationId: context.identity.locationId, stateId: null,
      structure: [`clicks:${clicks};value:${value};slider:${slider}`], diagnostics: [] } },
    releaseRun() { current = undefined },
  }
  const frames: HtmlActionFramePort = {
    async frameToken(context) { return 'frameToken' in context ? context.frameToken : 'html-root' },
    async observe() { return { url: 'courseware-editor://app/observation.html', title: 'Published', readyState: 'complete', pageIndex: 0, pageCount: 2,
      structure: [], diagnostics: [], elements: [
        { path: [0], fingerprint: 'button', tag: 'button', role: '', label: 'Increment', text: 'Increment', editable: false, rect: { x: 0, y: 0, width: 80, height: 30 } },
        { path: [1], fingerprint: 'input', tag: 'input', role: '', label: 'Answer', text: '', editable: true, value, rect: { x: 0, y: 40, width: 80, height: 30 } },
        { path: [2], fingerprint: 'range', frameToken: 'nested', frameProcessId: 9, tag: 'input', role: '', label: 'Power', text: '', editable: true, value: slider, rect: { x: 0, y: 80, width: 100, height: 20 } },
      ] } },
    async act(_context, _frame, input, isCurrent) {
      if (!isCurrent?.()) throw new Error('Stopped')
      if (input.type === 'click') clicks++
      else if (input.fingerprint === 'range') { inputs++; slider = mismatch ? '8' : input.value; lastFrame = input.frameToken ?? '' }
      else value = input.value
      if (failAfterInput) { failAfterInput = false; throw new Error('Lost action response') }
      if (mismatch && input.type === 'input') {
        mismatch = false
        return { applied: true, inputOutcome: { status: 'value-mismatch', requestedValue: input.value, actualValue: slider } }
      }
      return { applied: true }
    },
    async navigate() { throw new Error('Published navigation must use its player') },
    async capture() { return { png, width: 1, height: 1 } },
    onDiagnostic() { return () => {} },
  }
  const service = new HtmlActionService({ preview: { async automationContext() { throw new Error('No HTML context') },
    async automationContextForDocument() { throw new Error('No HTML context') } }, published, frames, images })
  return { service, published, frames, target, snapshot, images, mounts: () => mounts, clicks: () => clicks, inputs: () => inputs, lastFrame: () => lastFrame,
    failNextAction() { failAfterInput = true }, mismatchNextInput() { mismatch = true } }
}

it('shares one action owner for persistent Published click, fill, nested slider, reobserve and page navigation', async () => {
  const f = fixture(), before = structuredClone(f.snapshot)
  const first = await f.service.observePublished('run', f.target())
  const clicked = await f.service.clickPublished('run', { operationId: 'click', handle: first.elements[0]!.handle })
  expect(clicked.structure).toEqual(['clicks:1;value:;slider:0'])
  expect(await f.service.clickPublished('run', { operationId: 'click', handle: first.elements[0]!.handle })).toBe(clicked)
  expect(f.clicks()).toBe(1)
  expect(() => f.service.inputPublished('run', { operationId: 'stale', handle: first.elements[1]!.handle, value: 'old' })).toThrow('已过期')
  const filled = await f.service.inputPublished('run', { operationId: 'fill', handle: clicked.elements[1]!.handle, value: 'correct' })
  const range = await f.service.inputPublished('run', { operationId: 'slide', handle: filled.elements[2]!.handle, value: '7' })
  expect(range.structure).toEqual(['clicks:1;value:correct;slider:7'])
  expect(f.lastFrame()).toBe('nested')
  expect(JSON.stringify(range.elements)).not.toMatch(/frameToken|frameProcessId|fingerprint|"path"/)
  const second = await f.service.observePublished('run', f.target('second'))
  const returned = await f.service.observePublished('run', f.target())
  expect(second.identity.locationId).toBe('second')
  expect(returned.structure).toEqual(range.structure)
  expect(returned.identity.viewGeneration).toBe(first.identity.viewGeneration)
  expect(f.mounts()).toBe(1)
  expect((await f.service.readResource('run', returned.image.resourceId)).bytes).toEqual(png)
  expect(f.snapshot).toEqual(before)
  f.service.stopRun('run')
  expect(() => f.service.clickPublished('run', { operationId: 'stopped', handle: returned.elements[0]!.handle })).toThrow('停止')
  await expect(f.service.observePublished('run', f.target())).rejects.toThrow('停止')
})

it('rejects a changed canonical revision before input and does not replay a spent action in a new runtime', async () => {
  const f = fixture(), first = await f.service.observePublished('run', f.target())
  await f.service.clickPublished('run', { operationId: 'spent', handle: first.elements[0]!.handle })
  const observed = await f.service.observePublished('run', f.target())
  f.snapshot.revision++
  await expect(f.service.clickPublished('run', { operationId: 'old-revision', handle: observed.elements[0]!.handle })).rejects.toThrow('版本已改变')
  expect(f.clicks()).toBe(1)
  const fresh = await f.service.observePublished('run', f.target())
  expect(f.mounts()).toBe(2)
  expect(fresh.identity.viewGeneration).not.toBe(first.identity.viewGeneration)
  expect((await f.service.readResource('run', first.image.resourceId)).bytes).toEqual(png)
  expect(() => f.service.clickPublished('run', { operationId: 'retired-handle', handle: first.elements[0]!.handle })).toThrow('已过期')
  expect(() => f.service.clickPublished('run', { operationId: 'spent', handle: fresh.elements[0]!.handle })).toThrow('不能重发')
  f.service.stopRun('run')
})

it('keeps visible runtime feedback alongside the Published page names, including the last captured text segment', async () => {
  const f = fixture(), observe = f.frames.observe
  const visible = Array.from({ length: 40 }, (_, index) => `可见说明 ${index}`)
  visible.push('实际结果：42，继续按钮可用')
  f.frames.observe = async (...args) => ({ ...await observe(...args), structure: visible })
  try {
    const observation = await f.service.observePublished('run', f.target())
    expect(observation.structure).toEqual(['clicks:0;value:;slider:0', ...visible])
    expect(observation.generation).toBe(1)
    expect(observation.elements.map(element => element.label)).toContain('Increment')
  } finally { f.service.stopRun('run') }
})

it('keeps an unknown action receipt while a new observation proves the current runtime state', async () => {
  const f = fixture(), first = await f.service.observePublished('run', f.target())
  f.failNextAction()
  const input = { operationId: 'unknown', handle: first.elements[0]!.handle }
  await expect(f.service.clickPublished('run', input)).rejects.toMatchObject({ code: 'view-action-outcome-unknown' })
  await expect(f.service.clickPublished('run', input)).rejects.toMatchObject({ code: 'view-action-outcome-unknown' })
  const current = await f.service.observePublished('run', f.target())
  expect(current.structure).toEqual(['clicks:1;value:;slider:0'])
  expect(f.clicks()).toBe(1)
  f.service.stopRun('run')
})

it('keeps a measured input mismatch terminal and spends its operation without blocking a fresh action', async () => {
  const f = fixture(), first = await f.service.observePublished('run', f.target())
  f.mismatchNextInput()
  const input = { operationId: 'measured-mismatch', handle: first.elements[2]!.handle, value: '40' }
  await expect(f.service.inputPublished('run', input)).rejects.toMatchObject({ code: 'view-input-value-mismatch',
    message: expect.stringContaining('当前值：8') })
  await expect(f.service.inputPublished('run', input)).rejects.toMatchObject({ code: 'view-input-value-mismatch' })
  expect(f.inputs()).toBe(1)
  const current = await f.service.observePublished('run', f.target())
  expect(current.elements[2]!.value).toBe('8')
  const clicked = await f.service.clickPublished('run', { operationId: 'different-action', handle: current.elements[0]!.handle })
  expect(clicked.structure).toEqual(['clicks:1;value:;slider:8'])
  f.service.stopRun('run')
})

const selection: ModelSelection = { model: 'fixture', connection: { id: 'local', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'local', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'unknown' } } }
function complete(request: ModelRequest, name?: string, input?: unknown): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = name ? [{ id: `call-${request.requestId}`, name, argumentsText: JSON.stringify(input) }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`,
    actualModel: 'fixture', nativeResponse: {}, finishReason: name ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: name ? '' : '已核对当前值并结束验证', ...(name ? { tool_calls: calls.map(call => ({
      id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}

it.each(['measured-mismatch', 'unknown'] as const)('uses the frame result to decide whether the engine may dispatch a new action (%s)', async outcome => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'view-input-outcome-')), f = fixture()
  try {
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const session = await host.internalAPI.create(f.snapshot.model, 'view.glx')
    Object.assign(f.snapshot, session)
    host.tools.configureHostServices({ observations: {
      observe: ({ runId }) => f.service.observePublished(runId, f.target()),
      actionIdentity: runId => f.service.publishedIdentity(runId),
      click: ({ runId, ...input }) => f.service.clickPublished(runId, input),
      input: ({ runId, ...input }) => f.service.inputPublished(runId, input),
      readResource: ({ runId, resourceId }) => f.service.readResource(runId, resourceId),
      stopRun: runId => f.service.stopRun(runId),
    } })
    let round = 0
    const provider: ModelProvider = { async *stream(request) {
      const refs = JSON.parse(String(request.messages[1]!.content).split('：')[1]!) as { target: string }[]
      const seen = () => JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content)) as {
        data: { elements: { handle: string; value?: string }[] } }
      switch (++round) {
        case 1: yield complete(request, 'view.observe', { target: refs[0]!.target }); break
        case 2:
          if (outcome === 'measured-mismatch') f.mismatchNextInput()
          else f.failNextAction()
          yield complete(request, 'view.input', { handle: seen().data.elements[2]!.handle, value: '40' }); break
        case 3: yield complete(request, 'view.observe', { target: refs[0]!.target }); break
        case 4: yield complete(request, 'view.click', { handle: seen().data.elements[0]!.handle }); break
        default: yield complete(request)
      }
    } }
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
      runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
    const started = await engine.start({ conversationId: 'conversation', taskId: 'task', instruction: '输入40；重新观察实际值，再记录当前设置', selection,
      documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const final = await engine.wait(started.runId)
    expect(final.tools[1]!.result).toMatchObject({ kind: 'error', code: outcome === 'measured-mismatch' ? 'view-input-value-mismatch' : 'view-action-outcome-unknown' })
    expect(final.tools[2]!.result).toMatchObject({ kind: 'read' })
    expect(f.inputs()).toBe(1)
    expect(f.clicks()).toBe(outcome === 'measured-mismatch' ? 1 : 0)
    expect(final.tools[3]!.result).toMatchObject(outcome === 'measured-mismatch' ? { kind: 'read' } : { kind: 'error', code: 'unresolved-prior-tool' })
    expect(final.status).toBe(outcome === 'measured-mismatch' ? 'completed' : 'partial')
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
})


it('stops pending browser transport for Published with the same unknown-action contract', async () => {
  const f = fixture(), first = await f.service.observePublished('pending', f.target())
  let entered!: () => void
  const captured = new Promise<void>(resolve => { entered = resolve })
  f.frames.capture = () => { entered(); return new Promise(() => {}) }
  const pending = f.service.clickPublished('pending', { operationId: 'once', handle: first.elements[0]!.handle })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'view-action-outcome-unknown' })
  await captured
  f.service.stopRun('pending')
  await rejected
  expect(f.clicks()).toBe(1)
  await expect(f.service.observePublished('pending', f.target())).rejects.toThrow('停止')
}, 1500)


it('passes run Stop to an in-flight Published host before context registration', async () => {
  const f = fixture()
  let began!: () => void, release!: () => void, captured: AbortSignal | undefined, closed = 0
  const beginning = new Promise<void>(resolve => { began = resolve })
  const acquire = f.published.contextForTarget.bind(f.published)
  f.published.contextForTarget = async input => {
    captured = input.signal
    captured?.addEventListener('abort', () => { closed++ }, { once: true })
    began()
    await new Promise<void>(resolve => { release = resolve })
    return acquire(input)
  }
  const pending = f.service.observePublished('preparing', f.target())
  const rejected = expect(pending).rejects.toThrow('停止')
  await beginning
  f.service.stopRun('preparing')
  await rejected
  expect(captured?.aborted).toBe(true)
  expect(closed).toBe(1)
  release()
  await Promise.resolve()
}, 1500)

it.each(['before-delivery', 'after-delivery'] as const)('retires a context resolving at the Stop boundary (%s)', async timing => {
  const f = fixture()
  let owned = false, release!: () => void, entered!: () => void
  const beginning = new Promise<void>(resolve => { entered = resolve })
  const acquire = f.published.contextForTarget.bind(f.published)
  f.published.contextForTarget = async input => {
    await new Promise<void>(resolve => { release = resolve; entered() })
    const context = await acquire(input)
    owned = true
    return context
  }
  const clear = f.published.releaseRun!.bind(f.published)
  f.published.releaseRun = id => { owned = false; clear(id) }
  f.published.releaseContext = () => { owned = false }
  const pending = f.service.observePublished('boundary', f.target())
  const rejected = expect(pending).rejects.toThrow('停止')
  await beginning
  if (timing === 'before-delivery') {
    f.service.stopRun('boundary'); release()
  } else {
    release()
    queueMicrotask(() => f.service.stopRun('boundary'))
  }
  await rejected
  // Drain the bounded Promise pipeline without imposing a production deadline.
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(owned).toBe(false)
  expect(() => f.service.publishedIdentity('boundary')).toThrow('停止')
}, 1500)
