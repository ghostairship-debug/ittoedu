import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { generationCandidateSchema, type GenerationRequest } from '../../shared/generationContract'
import { GENERATION_CLOSE, GENERATION_OPEN } from '../../shared/generationResult'

function normalizeOutputSchema(value: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(normalizeOutputSchema); return }
  const record = value as Record<string, unknown>
  delete record.format
  if (Array.isArray(record.oneOf)) {
    record.anyOf = record.oneOf
    delete record.oneOf
  }
  Object.values(record).forEach(normalizeOutputSchema)
}

function pruneUnusedDefinitions(schema: Record<string, any>): void {
  const definitions = schema.$defs ?? {}
  const used = new Set<string>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const record = value as Record<string, unknown>
    if (typeof record.$ref === 'string' && record.$ref.startsWith('#/$defs/')) {
      const name = record.$ref.slice('#/$defs/'.length)
      if (!used.has(name)) { used.add(name); visit(definitions[name]) }
    }
    for (const [key, nested] of Object.entries(record)) if (key !== '$defs') visit(nested)
  }
  visit(schema)
  schema.$defs = Object.fromEntries(Object.entries(definitions).filter(([name]) => used.has(name)))
}

/** Native app-server structured output constrains the candidate before the text channel sees it. */
export function codexCandidateOutputSchema(request: GenerationRequest): Record<string, unknown> {
  const schema = z.toJSONSchema(generationCandidateSchema, { io: 'output', reused: 'ref' }) as Record<string, any>
  delete schema.$schema
  schema.properties.requestId = { type: 'string', const: request.requestId }
  for (const definition of Object.values(schema.$defs ?? {}) as Array<Record<string, any>>) {
    if (definition.properties?.carrier && definition.properties?.lowerCarrierReason) {
      definition.properties.lowerCarrierReason = { anyOf: [definition.properties.lowerCarrierReason, { type: 'null' }] }
      definition.properties.input = { type: 'string', description: 'A complete JSON serialization of the selected authoring tool input.' }
      definition.required = Array.from(new Set([...(definition.required ?? []), 'lowerCarrierReason']))
    }
  }
  normalizeOutputSchema(schema)
  pruneUnusedDefinitions(schema)
  return schema
}

/** Auto requests still use one strict final transport while allowing either prose or an edit. */
export function codexTurnOutputSchema(request: GenerationRequest): Record<string, unknown> {
  const candidate = codexCandidateOutputSchema(request) as Record<string, any>
  if (request.expectedResult === 'candidate') return candidate
  const { $defs, ...candidateValue } = candidate
  return {
    type: 'object',
    properties: {
      version: { type: 'integer', const: 1 },
      requestId: { type: 'string', const: request.requestId },
      kind: { type: 'string', enum: ['reply', 'edit'] },
      reply: { anyOf: [{ type: 'string', maxLength: 500_000 }, { type: 'null' }] },
      candidate: { anyOf: [candidateValue, { type: 'null' }] },
    },
    required: ['version', 'requestId', 'kind', 'reply', 'candidate'],
    additionalProperties: false,
    ...($defs && Object.keys($defs).length ? { $defs } : {}),
  }
}

function candidateMessage(value: any): string {
  if (Array.isArray(value?.steps)) for (const step of value.steps) {
    if (step && typeof step === 'object' && step.lowerCarrierReason === null) delete step.lowerCarrierReason
    if (step && typeof step === 'object' && typeof step.input === 'string') {
      try { step.input = JSON.parse(step.input) }
      catch { /* Preserve malformed tool input for the host's bounded candidate-format repair. */ }
    }
  }
  return `${GENERATION_OPEN}${JSON.stringify(value)}${GENERATION_CLOSE}`
}

export function decodeCodexStructuredOutput(text: string, request: GenerationRequest): string {
  const value = JSON.parse(text)
  if (request.expectedResult === 'candidate') return candidateMessage(value)
  const envelope = z.object({
    version: z.literal(1), requestId: z.string(), kind: z.enum(['reply', 'edit']),
    reply: z.string().max(500_000).nullable(), candidate: z.unknown().nullable(),
  }).strict().parse(value)
  if (envelope.requestId !== request.requestId) throw new Error('生成结果属于其他请求')
  if (envelope.kind === 'reply') {
    if (envelope.candidate !== null || envelope.reply === null || !envelope.reply.trim()) throw new Error('Codex reply envelope 不完整')
    return envelope.reply
  }
  if (envelope.reply !== null || envelope.candidate === null) throw new Error('Codex edit envelope 不完整')
  return candidateMessage(envelope.candidate)
}

/** Codex's native stdio session API supplies message deltas that `exec --json` omits. */
export async function* codexAppServer(child: ChildProcessWithoutNullStreams, cwd: string, prompt: string,
  externalId?: string, request?: GenerationRequest): AsyncGenerator<unknown> {
  let id = 0
  const send = (method: string, params: unknown) => {
    const requestId = ++id
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n')
    return requestId
  }
  let waiting = send('initialize', { clientInfo: { name: 'courseware_editor', version: '1.8' } })
  let phase: 'initialize' | 'thread' | 'turn' = 'initialize'
  let threadId = ''
  let total = 0
  const candidateItems = new Set<string>()
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      total += Buffer.byteLength(line)
      if (total > 8 * 1024 * 1024 || Buffer.byteLength(line) > 1024 * 1024) throw new Error('output-limit')
      const wire = JSON.parse(line)
      if (wire.method && wire.id !== undefined) {
        const approval = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(wire.method)
        child.stdin.write(JSON.stringify({ id: wire.id, ...(approval ? { result: { decision: 'decline' } } : { error: { code: -32601, message: 'Client capability not available' } }) }) + '\n')
        continue
      }
      if (wire.id === waiting) {
        if (wire.error) { yield { type: 'error', error: wire.error }; return }
        if (phase === 'initialize') {
          child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
          waiting = send(externalId ? 'thread/resume' : 'thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never', ...(externalId ? { threadId: externalId } : {}) })
          phase = 'thread'
        } else if (phase === 'thread') {
          threadId = wire.result?.thread?.id
          if (!threadId || (externalId && threadId !== externalId)) throw new Error('protocol')
          yield { type: 'thread.started', thread_id: threadId }
          waiting = send('turn/start', { threadId, input: [{ type: 'text', text: prompt }],
            ...(request ? { effort: 'low', outputSchema: codexTurnOutputSchema(request) } : {}) })
          phase = 'turn'
        }
        continue
      }
      if (phase !== 'turn' || wire.params?.threadId !== threadId) continue
      if (wire.method === 'error') {
        if (wire.params.willRetry) yield { type: 'retry', message: wire.params.error?.message ?? '正在重新连接 CLI 服务', detail: wire.params.error?.additionalDetails ?? '' }
        else { yield { type: 'turn.failed', error: wire.params.error }; return }
      }
      if (wire.method === 'item/agentMessage/delta') {
        if (!candidateItems.has(wire.params.itemId)) yield { type: 'agent_message_delta', itemId: wire.params.itemId, delta: wire.params.delta }
      }
      if (wire.method === 'item/started' || wire.method === 'item/completed') {
        const item = wire.params.item
        const types: Record<string, string> = { agentMessage: 'agent_message', commandExecution: 'command_execution', fileChange: 'file_change', mcpToolCall: 'mcp_tool_call', webSearch: 'web_search', collabAgentToolCall: 'collab_tool_call' }
        if (request && item?.type === 'agentMessage' && item.phase === 'final_answer') {
          candidateItems.add(item.id)
          if (wire.method === 'item/completed') yield { type: 'item.completed', item: {
            ...item, type: 'agent_message', text: decodeCodexStructuredOutput(item.text, request),
          } }
        } else if (types[item?.type]) yield { type: wire.method === 'item/started' ? 'item.started' : 'item.completed', item: { ...item, type: types[item.type] } }
      }
      if (wire.method === 'thread/tokenUsage/updated') yield { type: 'usage', usage: wire.params.tokenUsage }
      if (wire.method === 'turn/completed') {
        yield wire.params.turn.status === 'completed' ? { type: 'turn.completed', usage: {} } : { type: 'turn.failed', error: wire.params.turn.error ?? { message: `Codex 本轮状态：${wire.params.turn.status}` } }
        return
      }
    }
    throw new Error('interrupted')
  } finally { lines.close() }
}
