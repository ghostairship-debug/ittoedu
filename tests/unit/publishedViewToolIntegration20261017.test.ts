import { testContainerInstance } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createTextComponentData } from '../../src/components/text/data'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import { ViewObservationService } from '../../src/main/workbench/observation/ViewObservationService'
import { observationModelMessage } from '../../src/main/workbench/execution/observationModelInput'
import { executionExitDecision, hasUnresolvedToolFailure } from '../../src/main/workbench/execution/executionOutcome'
import type { JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { ObservationResult, ObservationServicePort } from '../../src/shared/workbench/toolPorts'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'
import type { ToolResult } from '../../src/shared/workbench/tools'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(readOnly = false) {
  const driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(),
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const project = createBlankCourseProjectV10('公开页面操作')
  project.definitions.text = { id: 'text', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances.body = { id: 'body', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('作者正文'))) as JsonValue }
  testContainerInstance(project, 0).childIds = ['body']
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'view-actions.h5lesson')
  const images = new ObservationImageStore()
  cleanups.push(() => images.clearRun('run'))
  let identity: ObservationResult['identity'] | null = null
  let generation = 0
  let runtimeValue = '0'
  const capture = async (runId: string, target: ObservationResult['identity']): Promise<ObservationResult> => {
    generation++
    return { source: 'isolated-published', identity: { ...target, viewGeneration: 'worker-generation' },
      coverage: { width: 1, height: 1 }, structure: [`运行值：${runtimeValue}`], diagnostics: [],
      generation, image: await images.put(runId, png, 1, 1), elements: [
        { handle: `button-${generation}`, tag: 'button', role: 'button', label: '增加', text: '增加', editable: false,
          rect: { x: 0, y: 0, width: 1, height: 1 } },
        { handle: `input-${generation}`, tag: 'input', role: 'textbox', label: '雨量', text: '', editable: true, value: runtimeValue,
          rect: { x: 0, y: 0, width: 1, height: 1 } },
      ] }
  }
  const observeInteractive = vi.fn(async ({ runId, identity: target }: Parameters<NonNullable<ConstructorParameters<typeof ViewObservationService>[0]['observeInteractive']>>[0]) => {
    const result = await capture(runId, target)
    identity = result.identity
    return result
  })
  const service = new ViewObservationService({ snapshot: async id => registry.get(id).drain(), images,
    captureIsolated: async () => { throw new Error('interactive path must own capture') }, observeInteractive })
  const click = vi.fn(async (input: Parameters<NonNullable<ObservationServicePort['click']>>[0]) => {
    expect(input.handle).toBe(`button-${generation}`)
    runtimeValue = String(Number(runtimeValue) + 1)
    return capture(input.runId, identity!)
  })
  const input = vi.fn(async (input: Parameters<NonNullable<ObservationServicePort['input']>>[0]) => {
    expect(input.handle).toBe(`input-${generation}`)
    runtimeValue = input.value
    return capture(input.runId, identity!)
  })
  const readResource = vi.fn((input: Parameters<ObservationServicePort['readResource']>[0]) => service.readResource(input))
  const stopRun = vi.fn(async (runId: string) => { identity = null; await service.stopRun(runId) })
  const observations: ObservationServicePort = { observe: request => service.observe(request), actionIdentity: () => identity,
    click, input, readResource, stopRun }
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID(), { services: { observations } })
  await gateway.beginRun({ runId: 'run', actor: 'agent', documents: [{ documentId: session.documentId,
    writable: readOnly ? [] : [{ kind: 'document' }] }], ...(readOnly ? { fileAccess: { permission: 'read-only' as const } } : {}) })
  const target = await gateway.issueTarget('run', session.documentId, { kind: 'course-surface', surfaceId: componentSurfaces(project)[0].id })
  const execute = (name: string, input: unknown) => gateway.execute('run', crypto.randomUUID(), { name, input })
  const observe = () => execute('view.observe', { target })
  return { registry, session, gateway, target, execute, observe, click, input, readResource, stopRun, observeInteractive,
    runtimeValue: () => runtimeValue, setIdentity: (next: ObservationResult['identity']) => { identity = next } }
}

function observation(result: ToolResult): ObservationResult {
  expect(result.kind).toBe('read')
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as ObservationResult
}

describe('published view actions through the public document gateway', () => {
  it('advertises actions, observes the canonical page, forwards each PNG, and leaves the author model unchanged', async () => {
    const f = await fixture()
    const catalog = await f.gateway.describeRun('run')
    expect(catalog.map(tool => tool.name)).toEqual(expect.arrayContaining(['view.observe', 'view.click', 'view.input']))
    expect(catalog.find(tool => tool.name === 'view.input')?.schema).toMatchObject({ type: 'object',
      required: ['handle', 'value'], additionalProperties: false })
    const before = structuredClone(f.session.read())
    const seen = observation(await f.observe())
    expect(seen.identity).toMatchObject({ documentId: before.documentId, epoch: before.epoch,
      revision: before.revision, locationId: f.observeInteractive.mock.calls[0][0].identity.locationId,
      viewGeneration: 'worker-generation' })
    const clicked = await f.execute('view.click', { handle: seen.elements![0].handle })
    const afterClick = observation(clicked)
    expect(afterClick.structure).toEqual(['运行值：1'])
    const entered = await f.execute('view.input', { handle: afterClick.elements![1].handle, value: '35' })
    expect(observation(entered).elements![1].value).toBe('35')
    expect(f.runtimeValue()).toBe('35')
    expect(f.click).toHaveBeenCalledTimes(1)
    expect(f.input).toHaveBeenCalledTimes(1)
    expect(f.click.mock.calls[0][0]).toMatchObject({ runId: 'run', operationId: expect.any(String) })
    for (const [name, result] of [['view.click', clicked], ['view.input', entered]] as const) {
      const data = observation(result)
      expect(result).toMatchObject({ images: [{ source: 'observation', resourceId: data.image.resourceId, mimeType: 'image/png' }] })
      const prepared = await f.gateway.prepareResultImages('run', result)
      expect(prepared).toHaveLength(1)
      expect(prepared[0]).toMatchObject({ mimeType: 'image/png', source: `observation:run:${data.image.resourceId}` })
      expect(prepared[0].bytes).toEqual(png)
      expect(f.readResource).toHaveBeenLastCalledWith({ runId: 'run', resourceId: data.image.resourceId })
      const message = observationModelMessage({ toolCallId: `call-${name}`, toolName: name,
        target: f.target, observation: data, bytes: prepared[0].bytes })
      expect(message).toMatchObject({ role: 'user', content: [
        { type: 'text', text: expect.stringContaining(`工具 ${name} 的真实画面`) },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(png).toString('base64')}` } },
      ] })
    }
    const after = f.session.read()
    expect(after.model).toEqual(before.model)
    expect({ revision: after.revision, dirty: after.dirty, undoDepth: after.undoDepth, redoDepth: after.redoDepth })
      .toEqual({ revision: before.revision, dirty: before.dirty, undoDepth: before.undoDepth, redoDepth: before.redoDepth })
  })

  it('refuses actions before an observation without invoking the runtime', async () => {
    const f = await fixture()
    expect(await f.execute('view.click', { handle: 'guessed-button' })).toMatchObject({ kind: 'error', code: 'observation-required' })
    expect(await f.execute('view.input', { handle: 'guessed-input', value: '35' })).toMatchObject({ kind: 'error', code: 'observation-required' })
    expect(f.click).not.toHaveBeenCalled()
    expect(f.input).not.toHaveBeenCalled()
  })

  it('checks the Registry revision before dispatching an observed action', async () => {
    const f = await fixture(), seen = observation(await f.observe()), snapshot = f.session.read()
    if (snapshot.model.kind !== 'course-v10') throw new Error('fixture')
    expect(await f.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      actor: 'human', operationId: crypto.randomUUID(), mutation: { type: 'command', command: captureComponentOperation(snapshot.model.project,
        [{ type: 'data.set', instanceId: 'body', path: ['content'], value: { inlines: [{ type: 'text', text: '人工改字' }] } }]) } }))
      .toMatchObject({ status: 'applied' })
    expect(await f.execute('view.click', { handle: seen.elements![0].handle })).toMatchObject({ kind: 'error', code: 'observation-stale' })
    expect(f.click).not.toHaveBeenCalled()
  })

  it('checks the frozen document grant even if a runtime supplies another document identity', async () => {
    const f = await fixture(), seen = observation(await f.observe())
    const other = await f.registry.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'other.h5lesson')
    f.setIdentity({ ...seen.identity, documentId: other.documentId, epoch: other.read().epoch })
    expect(await f.execute('view.click', { handle: seen.elements![0].handle })).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(f.click).not.toHaveBeenCalled()
  })

  it('allows observation but refuses both runtime actions in a readonly task', async () => {
    const f = await fixture(true), seen = observation(await f.observe())
    expect(await f.execute('view.click', { handle: seen.elements![0].handle })).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(await f.execute('view.input', { handle: seen.elements![1].handle, value: '35' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(f.click).not.toHaveBeenCalled()
    expect(f.input).not.toHaveBeenCalled()
  })

  it('does not accept a worker capture of another canonical page', async () => {
    const f = await fixture()
    f.observeInteractive.mockImplementationOnce(async ({ runId, identity }) => ({ source: 'isolated-published',
      identity: { ...identity, locationId: 'wrong-page', viewGeneration: 'worker-generation' },
      coverage: { width: 1, height: 1 }, structure: [], diagnostics: [],
      image: { resourceId: `unused-${runId}`, mimeType: 'image/png', width: 1, height: 1, byteLength: png.byteLength } }))
    expect(await f.observe()).toMatchObject({ kind: 'error', code: 'observation-failed', message: expect.stringContaining('请求目标不符') })
    expect(f.click).not.toHaveBeenCalled()
  })

  it('stops the observation session and rejects later public actions', async () => {
    const f = await fixture(), seen = observation(await f.observe())
    await f.gateway.stop('run')
    expect(f.stopRun).toHaveBeenCalledOnce()
    expect(await f.execute('view.click', { handle: seen.elements![0].handle })).toMatchObject({ kind: 'error', code: 'run-stopped' })
    expect(f.click).not.toHaveBeenCalled()
  })
})

const tool = (name: string, result: ToolResult, index: number): ExecutionToolRecord => ({ callId: `call-${index}`,
  providerCallId: `provider-${index}`, requestId: 'request', call: { name, input: { handle: 'observed-control' } }, state: 'returned', result })
const run = (...tools: ExecutionToolRecord[]): ExecutionRunRecord => ({ schemaVersion: 1, runId: 'run', version: 1,
  status: 'running', createdAt: 1, updatedAt: 1, input: { conversationId: 'conversation', taskId: 'task', instruction: '操作当前页',
    selection: {} as ExecutionRunRecord['input']['selection'], documents: [] }, messages: [], initialMessageCount: 0, requests: [], tools })
const pixels = (locationId: string): ToolResult => ({ kind: 'read', data: {
  identity: { documentId: 'course', locationId }, image: { resourceId: `pixels-${locationId}` },
} })

it('keeps a required action image failure unfinished and never settles an unknown action with a later screenshot', () => {
  const failed = { ...tool('view.input', pixels('one'), 0), observationFailure: { message: 'PNG unreadable' } }
  expect(hasUnresolvedToolFailure(run(failed))).toBe(true)
  expect(executionExitDecision(run(failed))).toMatchObject({ status: 'continue' })
  expect(hasUnresolvedToolFailure(run(failed, tool('view.observe', pixels('two'), 1)))).toBe(true)
  expect(hasUnresolvedToolFailure(run(failed, tool('view.observe', pixels('one'), 1)))).toBe(false)
  const unknown = tool('view.click', { kind: 'error', code: 'html-action-outcome-unknown', message: '运行结果未知，不应重放' }, 2)
  expect(hasUnresolvedToolFailure(run(unknown, tool('view.observe', pixels('one'), 3)))).toBe(true)
  expect(executionExitDecision(run(unknown, tool('view.observe', pixels('one'), 3)))).toMatchObject({ status: 'continue' })
})
