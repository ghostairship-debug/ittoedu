// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { estimateSerializedTokens, modelContextBudget } from '../../src/core/execution/modelContextBudget'
import { modelToolResult } from '../../src/core/tools/modelToolResult'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { HtmlActionService, type PublishedActionObservation } from '../../src/main/workbench/observation/HtmlActionService'
import type { HtmlActionFramePort, PublishedActionAutomationContext } from '../../src/main/workbench/observation/HtmlActionDesktopPort'
import type { HtmlPageState } from '../../src/main/workbench/observation/HtmlActionPageScript'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import { ViewObservationService } from '../../src/main/workbench/observation/ViewObservationService'
import { serializeModelPayload } from '../../src/main/workbench/providers/ModelProviderRouter'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const selection: ModelSelection = { model: 'local-observation-fixture', contextWindow: 50_000, connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
  accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused-local-fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'unsupported' },
} }
function complete(request: ModelRequest, name?: string, input?: unknown, content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = name ? [{ id: request.requestId, name, argumentsText: JSON.stringify(input) }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`,
    actualModel: selection.model, nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({
      id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText },
    })) } : {}) } }
}
type SourcePart = { role: string; text: string }

it('keeps bootstrap transport out of real observation tool messages, dispatched payloads and summary source packets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'observation-model-boundary-'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  let actions: HtmlActionService | undefined
  try {
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const project = createBlankCourseProjectV10('Observation boundary')
    const document = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'boundary.glx')
    const rootUrl = 'courseware-editor://app/observation.html'
    const bootstrapSource = 'courseware-editor://app/_observation/fixture/bootstrap/lab'
    const payloadMarker = 'BOOTSTRAP_TRANSPORT_BODY'
    const internalUrl = `${bootstrapSource}?html=${payloadMarker.repeat(15_000)}&variant=web`
    const publicUrl = 'https://example.test/article?html=public-source#section'
    let current: PublishedActionAutomationContext | undefined, clicks = 0, value = ''
    const rawStates: HtmlPageState[] = []
    const frames: HtmlActionFramePort = {
      async frameToken() { return 'root-realm' },
      async observe() {
        const state: HtmlPageState = { url: rootUrl, title: 'Lab', readyState: 'complete', pageIndex: 0, pageCount: 1,
          structure: [], diagnostics: [], elements: [
            { path: [0], fingerprint: 'button', frameToken: 'lab-realm', frameProcessId: 9,
              tag: 'button', role: '', label: 'Increment', text: 'Increment', editable: false, rect: { x: 1, y: 1, width: 80, height: 30 } },
            { path: [1], fingerprint: 'input', frameToken: 'lab-realm', frameProcessId: 9,
              tag: 'input', role: '', label: 'Answer', text: '', editable: true, value, rect: { x: 1, y: 40, width: 80, height: 30 } },
          ], observationScope: { kind: 'visible-preview-frames', frames: [
            { frameId: 12, url: internalUrl, status: 'observed', returnedElements: 2, matchedElements: 2, truncatedElements: 0 },
            { frameId: 13, url: publicUrl, status: 'observed', returnedElements: 0, matchedElements: 0, truncatedElements: 0 },
          ] } }
        rawStates.push(state)
        return state
      },
      async act(_context, root, input, isCurrent) {
        expect(root).toBe('root-realm')
        expect(isCurrent?.()).toBe(true)
        expect(input).toMatchObject({ frameToken: 'lab-realm', frameProcessId: 9 })
        if (input.type === 'click') { expect(input.fingerprint).toBe('button'); clicks++ }
        else { expect(input.fingerprint).toBe('input'); value = input.value }
        return { applied: true }
      },
      async navigate() { throw new Error('This fixture does not navigate') },
      async capture() { return { png, width: 1, height: 1 } },
      onDiagnostic(_context, _frame, receive) {
        receive({ level: 'warning', message: 'Lab warning', source: internalUrl, line: 1 })
        return () => {}
      },
    }
    const images = new ObservationImageStore()
    actions = new HtmlActionService({ images, frames,
      preview: { async automationContext() { throw new Error('No HTML preview') }, async automationContextForDocument() { throw new Error('No HTML preview') } },
      published: {
        async contextForTarget(input) {
          return current = { kind: 'published', runId: input.runId, identity: { ...input.identity, viewGeneration: 'published-fixture' },
            frameProcessId: 3, frameToken: 'root-realm', webContentsId: 1, url: rootUrl }
        },
        async currentContext(context) { expect(context).toBe(current); return context },
        async readState(context) { return { locationId: context.identity.locationId, stateId: null,
          structure: [`clicks:${clicks};value:${value}`], diagnostics: [] } },
      },
    })
    const observations = new ViewObservationService({ images, snapshot: id => host.internalAPI.read(id),
      async captureIsolated() { throw new Error('Interactive observation must use the action owner') },
      observeInteractive: input => actions!.observePublished(input.runId, { ...input, identity: { ...input.identity, projectId: input.projectId } }),
    })
    host.tools.configureHostServices({ observations: {
      observe: input => observations.observe(input),
      actionIdentity: runId => { try { return actions!.publishedIdentity(runId) } catch { return null } },
      click: input => actions!.clickPublished(input.runId, input),
      input: input => actions!.inputPublished(input.runId, input),
      readResource: input => observations.readResource(input),
      stopRun: async runId => { actions!.stopRun(runId); await observations.stopRun(runId) },
    } })

    const requests: ModelRequest[] = [], wires: string[] = [], summaryParts: SourcePart[] = [], usedHandles: string[] = []
    let turns = 0
    // Business prose creates real context pressure; transport bytes must never be used to trigger the summary.
    const businessNote = '业务说明：实验已完成，保留观察事实。'.repeat(2_200)
    const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
      requests.push(structuredClone(request))
      const wire = serializeModelPayload(request)
      wires.push(wire)
      expect(wire).not.toContain(payloadMarker)
      if (!request.tools?.length) {
        const packet = JSON.parse(String(request.messages[1]!.content)) as { sources: SourcePart[] }
        expect(estimateSerializedTokens(wire)).toBeLessThanOrEqual(modelContextBudget(request.selection).inputTokens)
        summaryParts.push(...packet.sources)
        yield complete(request, undefined, undefined, '实验已观察、点击并输入，保留原结论。')
        return
      }
      turns++
      if (turns === 1) {
        const refs = JSON.parse(String(request.messages[1]!.content).split('：')[1]) as { target: string }[]
        yield complete(request, 'view.observe', { target: refs[0]!.target })
      } else if (turns === 2 || turns === 3) {
        const message = request.messages.filter(item => item.role === 'tool').at(-1)!
        const observation = JSON.parse(String(message.content)).data as PublishedActionObservation
        const handle = observation.elements[turns === 2 ? 0 : 1]!.handle
        usedHandles.push(handle)
        expect(wire).toContain(publicUrl)
        expect(wire).toContain(handle)
        yield turns === 2 ? complete(request, 'view.click', { handle })
          : complete(request, 'view.input', { handle, value: '42' }, businessNote)
      } else yield complete(request, undefined, undefined, '已完成实际操作。')
    } }
    const runs = new ExecutionRunStore(path.join(directory, 'runs'))
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, runs, events,
      serializePayload: serializeModelPayload })
    const started = await engine.start({ conversationId: 'observation-boundary', taskId: 'observation-boundary',
      instruction: '观察实验，点击一次并输入42，然后说明结果。', selection,
      documents: [{ documentId: document.documentId, writable: [] }] })
    const final = await engine.wait(started.runId)
    expect(final.status, JSON.stringify(final.failure)).toBe('completed')
    expect(turns).toBe(4)
    expect(final.tools.map(tool => tool.call.name)).toEqual(['view.observe', 'view.click', 'view.input'])
    expect([clicks, value]).toEqual([1, '42'])
    const toolMessages = final.messages.filter(message => message.role === 'tool')
    expect(toolMessages).toHaveLength(3)
    for (const tool of final.tools) {
      const message = toolMessages.find(item => item.tool_call_id === tool.providerCallId)!
      const projected = JSON.parse(String(message.content)), expected = modelToolResult(tool.call.name, tool.result!)
      expect(projected.data.fullObservationSource).toMatchObject({ sourceId: `run:${final.runId}:tool:${encodeURIComponent(tool.callId)}` })
      const { fullObservationSource: _source, ...data } = projected.data
      expect({ ...projected, data }).toEqual(expected)
      expect(String(message.content)).not.toContain(payloadMarker)
      expect(String(message.content)).toContain(publicUrl)
      expect(JSON.parse(String(message.content)).data.observationScope.frames[0]).toMatchObject({
        frameId: 12, url: `${bootstrapSource}?variant=web`, status: 'observed',
      })
    }
    expect(toolMessages.map(message => String(message.content)).join('\n')).toContain(usedHandles[0]!)
    expect(rawStates).toHaveLength(3)
    expect(rawStates.every(state => state.observationScope!.frames[0]!.url === internalUrl)).toBe(true)
    const helpers = requests.filter(request => !request.tools?.length)
    expect(final.compacted?.summary).toContain('实验已观察')
    expect(helpers.length).toBeGreaterThan(1)
    const toolSummary = summaryParts.filter(part => part.role === 'tool').map(part => part.text).join('')
    expect(toolSummary).toContain(publicUrl)
    expect(toolSummary).toContain(usedHandles[0]!)
    expect(summaryParts.map(part => part.text).join('')).not.toContain(payloadMarker)
    expect(summaryParts.map(part => part.text).join('')).toContain('业务说明')
    expect(wires.every(wire => !wire.includes(payloadMarker))).toBe(true)
    expect((await host.internalAPI.read(document.documentId)).revision).toBe(0)
  } finally {
    actions?.dispose()
    await events.readTiming('observation-boundary', 'observation-boundary')
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
}, 20_000)
