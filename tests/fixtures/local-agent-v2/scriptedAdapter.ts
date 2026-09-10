import type { LocalAgentId, LocalAgentProbe } from '../../../src/shared/localAgentContract'
import { localAgentCapabilitiesSchema, type LocalAgentCliAdapterV2, type LocalAgentNativeEvent } from '../../../src/shared/localAgentTaskContract'
import { createAgentEventDecoder } from './historicalWireDecoder'

/** A test-only V2 source for historical/fault wire scenarios. It launches no
 * process and cannot be selected by a production factory. Native protocol tests
 * exercise the three actual V2 transports separately. */
export function createScriptedAgentV2Fixture(id: LocalAgentId, script: {
  turn(text: string, context: { cwd: string; externalSessionId: string | null; candidateRoot?: string }): AsyncIterable<unknown>
  close?(): Promise<void>
  probe?(): Promise<LocalAgentProbe>
}): LocalAgentCliAdapterV2 {
  let cwd = ''
  let externalSessionId: string | null = null
  let candidateRoot: string | undefined
  let identity: Parameters<LocalAgentCliAdapterV2['startTurn']>[0] | undefined
  let stream: AsyncIterable<unknown> | undefined
  const capabilities = () => localAgentCapabilitiesSchema.parse({ version: 1, adapter: id, cliVersion: 'fixture-only', models: [],
    current: { model: null, resolvedModel: null, effort: null },
    input: { image: 'unknown', readFile: 'unknown', question: 'unknown', correction: 'unknown', cancel: 'supported' } })
  return {
    id,
    probe: script.probe ?? (async () => ({ adapter: id, status: 'ready', message: 'test-only V2 fixture' })),
    getExternalSessionId: () => externalSessionId,
    async open(input) { cwd = input.cwd; externalSessionId = input.externalSessionId; candidateRoot = input.candidateRoot; return { externalSessionId, capabilities: capabilities() } },
    async configure() { return capabilities() },
    async startTurn(input) {
      identity = input
      stream = script.turn(input.text, { cwd, externalSessionId, candidateRoot })
      return { nativeTurnId: input.runId }
    },
    async input(input) { return { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, inputId: input.inputId,
      turnId: input.turnId, status: 'rejected', reason: 'Scripted history fixture has no interactive native request' } },
    async *events(): AsyncIterable<LocalAgentNativeEvent> {
      if (!identity || !stream) return
      const decode = createAgentEventDecoder(id)
      const base = { taskId: identity.taskId, epoch: identity.epoch, workspace: identity.workspace, runId: identity.runId, nativeTurnId: identity.runId }
      for await (const wire of stream) for (const event of decode(wire)) {
        if (event.externalSessionId) externalSessionId = event.externalSessionId
        const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {}
        if (event.kind === 'session') continue
        if (event.kind === 'text') yield { ...base, kind: 'text', itemId: typeof payload.messageId === 'string' ? payload.messageId : identity.runId,
          phase: 'body', operation: payload.delta === true ? 'append' : 'replace', text: typeof payload.text === 'string' ? payload.text : '' }
        else if (event.kind === 'tool-call' || event.kind === 'tool-result') yield { ...base, kind: 'tool',
          itemId: typeof payload.id === 'string' ? payload.id : identity.runId,
          name: typeof payload.name === 'string' && payload.name ? payload.name : 'fixture-tool',
          status: event.kind === 'tool-call' ? 'running' : 'completed', detail: payload }
        else if (event.kind === 'usage') yield { ...base, kind: 'usage',
          inputTokens: typeof payload.input_tokens === 'number' ? payload.input_tokens : null,
          outputTokens: typeof payload.output_tokens === 'number' ? payload.output_tokens : null,
          cachedInputTokens: typeof payload.cached_input_tokens === 'number' ? payload.cached_input_tokens : null }
        else if (event.kind === 'completed' || event.kind === 'cancelled') yield { ...base, kind: 'turn-ended', status: event.kind, failure: null }
        else if (event.kind === 'failed') yield { ...base, kind: 'turn-ended', status: 'failed',
          failure: { category: event.failure === 'output-limit' ? 'limit' : event.failure === 'storage' ? 'storage'
            : event.failure === 'rate-limited' ? 'service' : 'protocol', message: typeof payload.message === 'string' ? payload.message : 'Historical fixture failed' } }
      }
    },
    close: script.close ?? (async () => {}),
  }
}
