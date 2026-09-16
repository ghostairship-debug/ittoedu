import { workspaceIdentityKey } from '../../shared/workspaceIdentity'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { nativeProxyEnvironment } from './nativeProxy'
import { z } from 'zod'
import { generationShortCandidateSchema, type GenerationRequest } from '../../shared/generationContract'
import { GENERATION_CLOSE, GENERATION_OPEN, generationStagedCandidateMarker, generationStagedCandidateReferenceSchema, normalizeGenerationCandidateTransport } from '../../shared/generationResult'
import {
  localAgentCapabilitiesSchema,
  localAgentConfigurationSchema,
  localAgentProbeSchema,
  type LocalAgentCapabilities,
  type LocalAgentConfiguration,
  type LocalAgentId,
  type LocalAgentProbe,
} from '../../shared/localAgentContract'
import {
  aiInputDeliverySchema,
  aiQuestionSchema,
  localAgentTurnInputSchema,
  type AiUserInput,
  type AiTaskConfigurationRun,
  type LocalAgentCliAdapterV2,
  type LocalAgentNativeEvent,
} from '../../shared/localAgentTaskContract'
import { captureAgent, launchAgent, resolveAgentExecutable, stopAgent, type AgentExecutable } from './process'
import { measureLocalAgentInput, type LocalAgentInputMetrics } from '../../shared/localAgentInputMetrics'

type AiQuestion = z.infer<typeof aiQuestionSchema>

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
export function codexCandidateOutputSchema(_request: GenerationRequest): Record<string, unknown> {
  const schema = z.toJSONSchema(generationShortCandidateSchema, { io: 'output', reused: 'ref' }) as Record<string, any>
  delete schema.$schema
  schema.properties.requestId = { type: 'string' }
  const adaptToolInput = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(adaptToolInput); return }
    const definition = value as Record<string, any>
    if (definition.properties?.tool && definition.properties?.input && definition.properties?.destination) {
      definition.properties.input = { type: 'string', description: 'A complete JSON serialization of the selected authoring tool input.' }
    }
    Object.values(definition).forEach(adaptToolInput)
  }
  adaptToolInput(schema)
  normalizeOutputSchema(schema)
  pruneUnusedDefinitions(schema)
  return schema
}

/** Auto requests still use one strict final transport while allowing either prose or an edit. */
export function codexTurnOutputSchema(request: GenerationRequest): Record<string, unknown> {
  const candidate = codexCandidateOutputSchema(request) as Record<string, any>
  const { $defs, ...candidateValue } = candidate
  const fileReference = z.toJSONSchema(generationStagedCandidateReferenceSchema, { io: 'output' }) as Record<string, any>
  delete fileReference.$schema
  normalizeOutputSchema(fileReference)
  return {
    type: 'object',
    properties: {
      version: { type: 'integer', const: 1 },
      requestId: { type: 'string' },
      kind: { type: 'string', enum: request.expectedResult === 'candidate' ? ['edit'] : ['reply', 'edit'] },
      reply: request.expectedResult === 'candidate' ? { type: 'null' } : { anyOf: [{ type: 'string', maxLength: 500_000 }, { type: 'null' }] },
      candidate: { anyOf: [candidateValue, fileReference, ...(request.expectedResult === 'candidate' ? [] : [{ type: 'null' }])] },
    },
    required: ['version', 'requestId', 'kind', 'reply', 'candidate'],
    additionalProperties: false,
    ...($defs && Object.keys($defs).length ? { $defs } : {}),
  }
}

function candidateMessage(value: any): string {
  try { value = normalizeGenerationCandidateTransport(value) }
  catch { /* Keep the malformed projection for the shared structured repair diagnostic. */ }
  return `${GENERATION_OPEN}${JSON.stringify(value)}${GENERATION_CLOSE}`
}

/** Files may retain Codex's structured-output projection. Decode it exactly as
 * inline output, leaving malformed JSON to the host's candidate repair path. */
export function codexCandidateFileMessage(text: string): string {
  let value: unknown
  try { value = JSON.parse(text) } catch { return `${GENERATION_OPEN}${text}${GENERATION_CLOSE}` }
  return candidateMessage(value)
}

function decodeCodexStructuredResult(text: string, request: GenerationRequest): { kind: 'reply' | 'candidate'; text: string } {
  const value = JSON.parse(text)
  const candidate = (input: unknown): { kind: 'candidate'; text: string } => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || (input as Record<string, unknown>).requestId !== request.requestId) throw new Error('生成候选属于其他请求')
    if ('candidateFile' in input) {
      generationStagedCandidateReferenceSchema.parse(input)
      return { kind: 'candidate', text: generationStagedCandidateMarker(request.requestId) }
    }
    return { kind: 'candidate', text: candidateMessage(input) }
  }
  // Existing native sessions may finish an inline candidate using the earlier schema.
  if (request.expectedResult === 'candidate' && value?.version === 2) return candidate(value)
  const envelope = z.object({
    version: z.literal(1), requestId: z.string(), kind: z.enum(['reply', 'edit']),
    reply: z.string().max(500_000).nullable(), candidate: z.unknown().nullable(),
  }).strict().parse(value)
  if (envelope.requestId !== request.requestId) throw new Error('生成结果属于其他请求')
  if (envelope.kind === 'reply') {
    if (request.expectedResult === 'candidate') throw new Error('本轮要求修改候选')
    if (envelope.candidate !== null || envelope.reply === null || !envelope.reply.trim()) throw new Error('Codex reply envelope 不完整')
    return { kind: 'reply', text: envelope.reply }
  }
  if (envelope.reply !== null || envelope.candidate === null) throw new Error('Codex edit envelope 不完整')
  return candidate(envelope.candidate)
}

export function decodeCodexStructuredOutput(text: string, request: GenerationRequest): string {
  return decodeCodexStructuredResult(text, request).text
}

const codexUsageFields = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens', 'cacheWriteInputTokens', 'totalTokens'] as const
type CodexUsageBreakdown = Record<typeof codexUsageFields[number], number | null>

function codexUsageBreakdown(value: unknown): CodexUsageBreakdown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  return Object.fromEntries(codexUsageFields.map(key => [key,
    typeof input[key] === 'number' && Number.isSafeInteger(input[key]) && input[key] >= 0 ? input[key] : null,
  ])) as CodexUsageBreakdown
}

interface CodexAgentMessage {
  phase: string | null
  text: string
  displayed: string
  completed: boolean
}

function publicMessagePhase(phase: string | null): 'body' | 'public-summary' | 'plan' | 'progress' | 'final' {
  return phase === 'summary' || phase === 'public_summary' ? 'public-summary' : phase === 'plan' ? 'plan'
    : phase === 'commentary' ? 'progress' : phase === 'final_answer' ? 'final' : 'body'
}

/** Only the transport envelope is machine data; ordinary JSON/code remains readable. */
function structuredMessage(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    (item.version === 1 && (item.kind === 'reply' || item.kind === 'edit' || typeof item.candidateId === 'string'))
    || (item.version === 2 && Array.isArray(item.steps) && typeof item.summary === 'string')
  )
}

/** Parses Codex model/list items and userAgent into valid LocalAgentCapabilities. */
export function parseCodexCapabilities(
  modelsData: any[],
  cliVersion: string,
  preferredConfig?: LocalAgentConfiguration | null
): LocalAgentCapabilities {
  const seen = new Set<string>()
  const models: LocalAgentCapabilities['models'] = []

  for (const item of modelsData ?? []) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.id || item.model || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    const resolvedModel = typeof item.model === 'string' && item.model.trim() ? item.model.trim() : id
    const label = typeof item.displayName === 'string' && item.displayName.trim() ? item.displayName.trim() : id
    const image = Array.isArray(item.inputModalities) && item.inputModalities.includes('image')
      ? 'supported' as const
      : 'unsupported' as const

    const rawEfforts = Array.isArray(item.supportedReasoningEfforts)
      ? item.supportedReasoningEfforts
          .map((e: any) => (typeof e === 'string' ? e : e?.reasoningEffort))
          .filter((v: any): v is string => typeof v === 'string' && Boolean(v.trim()))
      : []
    const values: string[] = Array.from(new Set<string>(rawEfforts))
    let effort: LocalAgentCapabilities['models'][number]['effort']
    if (values.length > 0) {
      const def = typeof item.defaultReasoningEffort === 'string' && values.includes(item.defaultReasoningEffort)
        ? item.defaultReasoningEffort
        : null
      effort = { kind: 'supported', values: values as [string, ...string[]], default: def }
    } else {
      effort = { kind: 'unsupported' }
    }

    const serviceTiers = Array.isArray(item.serviceTiers) ? item.serviceTiers.filter((tier: any) =>
      tier && typeof tier.id === 'string' && tier.id && typeof tier.name === 'string' && tier.name && typeof tier.description === 'string') : undefined
    models.push({ id, resolvedModel, label, image, effort, ...(serviceTiers ? { serviceTiers } : {}) })
  }

  // Catalog defaults describe recommendations, never the effective configuration.
  const currentModel = preferredConfig && models.find(m => m.id === preferredConfig.model || m.resolvedModel === preferredConfig.model)
  const currentEffort = currentModel?.effort.kind === 'supported' && preferredConfig?.effort
    && currentModel.effort.values.includes(preferredConfig.effort) ? preferredConfig.effort : null

  return localAgentCapabilitiesSchema.parse({
    version: 1,
    adapter: 'codex',
    cliVersion: cliVersion || '0.153.4',
    models,
    current: {
      model: currentModel?.id ?? null,
      resolvedModel: currentModel?.resolvedModel ?? null,
      effort: currentEffort,
      ...(preferredConfig?.serviceTier !== undefined ? { serviceTier: preferredConfig.serviceTier } : {}),
    },
    ...(preferredConfig ? { currentSource: 'native-config' as const } : {}),
    input: {
      image: 'supported',
      readFile: 'supported',
      question: 'structured',
      correction: 'active-turn',
      cancel: 'supported',
    },
  })
}

/** Discovers Codex capabilities by running app-server --stdio and querying model/list. */
export async function discoverCodexCapabilities(
  binary?: AgentExecutable | string | null,
  cwd: string = process.cwd()
): Promise<LocalAgentCapabilities> {
  let executable: AgentExecutable | null
  if (typeof binary === 'string') {
    executable = { executable: binary, prefix: [] }
  } else if (binary) {
    executable = binary
  } else {
    executable = await resolveAgentExecutable('codex')
  }
  if (!executable) {
    throw new Error('Codex CLI executable not found')
  }

  const child = launchAgent(executable, ['app-server', '--stdio'], cwd)
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  let nextId = 0
  const pending = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>()

  const send = (method: string, params?: unknown) => {
    const id = ++nextId
    const promise = new Promise<any>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
    child.stdin.write(JSON.stringify(params !== undefined ? { id, method, params } : { id, method }) + '\n')
    return promise
  }

  const sendNotification = (method: string) => {
    child.stdin.write(JSON.stringify({ method }) + '\n')
  }

  const readPromise = (async () => {
    for await (const line of lines) {
      if (!line.trim()) continue
      try {
        const wire = JSON.parse(line)
        if (wire.id !== undefined && !wire.method) {
          const handler = pending.get(wire.id)
          if (handler) {
            pending.delete(wire.id)
            if (wire.error) {
              handler.reject(new Error(typeof wire.error === 'object' ? wire.error.message || JSON.stringify(wire.error) : String(wire.error)))
            } else {
              handler.resolve(wire.result)
            }
          }
        }
      } catch {}
    }
  })()

  try {
    const initPromise = send('initialize', {
      clientInfo: { name: 'courseware_editor', version: '1.8' },
      capabilities: { experimentalApi: true },
    })
    const initResult = await Promise.race([
      initPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Codex app-server initialize timeout')), 10000)),
    ])
    const versionMatch = String(initResult?.userAgent ?? '').match(/\b(\d+\.\d+\.\d+)\b/)
    const cliVersion = versionMatch ? versionMatch[1]! : '0.153.4'

    sendNotification('initialized')

    const listPromise = send('model/list', { limit: 100, includeHidden: false })
    const listResult = await Promise.race([
      listPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Codex app-server model/list timeout')), 10000)),
    ])

    const effective = await Promise.race([
      send('config/read', { cwd, includeLayers: false }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Codex config/read timeout')), 10000)),
    ]) as any
    return parseCodexCapabilities(listResult?.data ?? [], cliVersion, typeof effective?.config?.model === 'string'
      ? { model: effective.config.model, effort: typeof effective.config.model_reasoning_effort === 'string' ? effective.config.model_reasoning_effort : null,
        ...(Object.hasOwn(effective.config, 'service_tier') ? { serviceTier: effective.config.service_tier } : {}) }
      : undefined)
  } finally {
    lines.close()
    try { child.stdin.end() } catch {}
    await stopAgent(child)
    await readPromise.catch(() => {})
  }
}

class AsyncQueue<T> {
  private queue: T[] = []
  private resolvers: Array<(result: IteratorResult<T>) => void> = []
  private closed = false
  private error: Error | null = null

  push(value: T): void {
    if (this.closed) return
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ value, done: false })
    } else {
      this.queue.push(value)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!
      resolver({ value: undefined as any, done: true })
    }
  }

  fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    this.error = error
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!
      resolver({ value: undefined as any, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) {
          const value = this.queue.shift()!
          return Promise.resolve({ value, done: false })
        }
        if (this.error) {
          return Promise.reject(this.error)
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve)
        })
      },
    }
  }
}

interface TurnContext {
  taskId: string
  epoch: number
  workspace: LocalAgentNativeEvent['workspace']
  runId: string
  observationId: string
}

/** Native Codex App Server V2 adapter implementing LocalAgentCliAdapterV2. */
export class CodexAppServerAdapter implements LocalAgentCliAdapterV2 {
  readonly id = 'codex' as const
  private child?: ChildProcessWithoutNullStreams
  private linesClose?: () => void
  private threadId: string | null = null
  private activeTurnId: string | null = null
  private nextRpcId = 0
  private pendingRpc = new Map<number, { resolve: (res: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private pendingQuestions = new Map<string, { id: number | string; params: any; decisions?: Map<string, unknown>; permission?: boolean; elicitation?: { mode: 'form' | 'url'; schema?: Record<string, any> } }>()
  private activeConfiguration: LocalAgentConfiguration | null = null
  private capabilities: LocalAgentCapabilities | null = null
  private capabilitiesCwd: string | null = null
  private cliVersion = '0.153.4'
  private currentTurnContext: TurnContext | null = null
  private eventQueue = new AsyncQueue<LocalAgentNativeEvent>()
  private startedTools = new Set<string>()
  private agentMessages = new Map<string, CodexAgentMessage>()
  private pendingFinalMessage: { itemId: string; text: string; phase: string | null } | null = null
  private seenUsageSnapshots = new Set<string>()
  private turnStartedReceived = false
  private turnStartedPromise: Promise<void> = Promise.resolve()
  private resolveTurnStarted?: () => void
  private turnEndedEmitted = false
  private turnEndedPromise: Promise<void> = Promise.resolve()
  private resolveTurnEnded?: () => void
  private turnConfigurationEvent: LocalAgentNativeEvent | null = null
  private turnRequestedConfiguration: LocalAgentConfiguration | null = null
  private resolveTurnConfiguration?: () => void
  private drainingEvents = false
  private isCancelled = false
  private isClosed = false
  private lifecycle = 0
  private closing?: Promise<void>
  private cancelling?: Promise<void>
  private readonly rpcTimeoutMs: number
  private readonly cancelTimeoutMs: number
  private readonly terminalCheckMs: number
  private terminalCheckTimer?: ReturnType<typeof setTimeout>
  private terminalCheckPending = false
  private stderr = ''
  private readonly resolve: (id: LocalAgentId) => Promise<AgentExecutable | null>
  private readonly generationRequest?: GenerationRequest

  constructor(
    resolverOrOptions?: ((id: LocalAgentId) => Promise<AgentExecutable | null>) | {
      resolve?: (id: LocalAgentId) => Promise<AgentExecutable | null>
      generationRequest?: GenerationRequest
      rpcTimeoutMs?: number
      cancelTimeoutMs?: number
      terminalCheckMs?: number
    },
    generationRequest?: GenerationRequest
  ) {
    this.rpcTimeoutMs = typeof resolverOrOptions === 'object' ? resolverOrOptions.rpcTimeoutMs ?? 10000 : 10000
    this.cancelTimeoutMs = typeof resolverOrOptions === 'object' ? resolverOrOptions.cancelTimeoutMs ?? 1500 : 1500
    this.terminalCheckMs = typeof resolverOrOptions === 'object' ? resolverOrOptions.terminalCheckMs ?? 30000 : 30000
    if (typeof resolverOrOptions === 'function') {
      this.resolve = resolverOrOptions
      this.generationRequest = generationRequest
    } else if (resolverOrOptions) {
      this.resolve = resolverOrOptions.resolve ?? resolveAgentExecutable
      this.generationRequest = resolverOrOptions.generationRequest ?? generationRequest
    } else {
      this.resolve = resolveAgentExecutable
      this.generationRequest = generationRequest
    }
  }

  getExternalSessionId(): string | null { return this.threadId }

  async probe(): Promise<LocalAgentProbe> {
    const result = (status: LocalAgentProbe['status'], message: string, version?: string) =>
      localAgentProbeSchema.parse({ adapter: 'codex', status, message, version })
    try {
      const binary = await this.resolve('codex')
      if (!binary) return result('missing', '请自行安装 CLI')
      const info = await captureAgent(binary, ['--version'], process.cwd())
      const version = info.text.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
      const major = Number(version?.split('.')[0])
      const minor = Number(version?.split('.')[1])
      if (info.code !== 0 || !version || major !== 0 || minor < 153) {
        return result('unsupported-version', 'CLI 版本不在当前协议范围内', version)
      }
      const auth = await captureAgent(binary, ['login', 'status'], process.cwd())
      const authenticated = auth.code === 0
      return result(authenticated ? 'ready' : 'unauthenticated', authenticated ? 'CLI 可用' : '请在 CLI 中自行登录', version)
    } catch {
      return result('launch', 'CLI 探测失败，请检查本地安装')
    }
  }

  async discoverCapabilities(input?: { cwd: string }): Promise<LocalAgentCapabilities> {
    const cwd = path.resolve(input?.cwd ?? this.capabilitiesCwd ?? process.cwd())
    if (this.capabilities && this.capabilitiesCwd === cwd) return this.capabilities
    const binary = await this.resolve('codex')
    if (!binary) throw new Error('missing')
    this.capabilities = await discoverCodexCapabilities(binary, cwd)
    this.capabilitiesCwd = cwd
    return this.capabilities
  }

  private candidateRoot?: string

  async open(input: { cwd: string; externalSessionId: string | null; configuration?: LocalAgentConfiguration; candidateRoot?: string }): Promise<{ externalSessionId: string; capabilities: LocalAgentCapabilities }> {
    let externalSessionId = input.externalSessionId
    let configuration = input.configuration
    if (this.child && !this.isClosed) {
      if (this.threadId && (!input.externalSessionId || this.threadId === input.externalSessionId)) {
        if (this.candidateRoot === input.candidateRoot) {
          if (input.configuration) await this.configure(input.configuration)
          return { externalSessionId: this.threadId, capabilities: this.capabilities! }
        }
        // An environment is fixed at process launch. Keep this live thread's
        // normal null/same-ID reopen semantics when replacing only its anchor.
        externalSessionId ??= this.threadId
        configuration ??= this.activeConfiguration ?? undefined
      }
      await this.close()
    }

    if (this.closing) await this.closing
    this.closing = undefined
    this.cancelling = undefined
    const lifecycle = ++this.lifecycle
    this.isClosed = false
    this.isCancelled = false
    this.threadId = null
    this.activeTurnId = null
    this.currentTurnContext = null
    this.activeConfiguration = null
    this.eventQueue = new AsyncQueue<LocalAgentNativeEvent>()
    this.stderr = ''
    const binary = await this.resolve('codex')
    if (lifecycle !== this.lifecycle || this.isClosed) throw new Error('interrupted')
    if (!binary) throw new Error('missing')

    let child: ChildProcessWithoutNullStreams
    try {
      const proxy = await nativeProxyEnvironment('codex')
      if (lifecycle !== this.lifecycle || this.isClosed) throw new Error('interrupted')
      child = this.child = launchAgent(binary, ['app-server', '--stdio'], input.cwd, input.candidateRoot, proxy)
      this.candidateRoot = input.candidateRoot
    } catch {
      throw new Error('launch')
    }

    child.stderr.on('data', (data: Buffer) => {
      if (this.child !== child) return
      this.stderr = (this.stderr + data.toString('utf8')).slice(-4000)
    })

    child.once('error', (err) => {
      if (this.child === child) void this.shutdown(err).catch(() => {})
    })
    child.stdin.on('error', err => {
      if (this.child === child) void this.shutdown(err).catch(() => {})
    })

    child.once('close', (code) => {
      if (this.child !== child) return
      const isAuth = /unauth|not logged|authentication|api.key/i.test(this.stderr)
      void this.shutdown(new Error(this.stderr.trim() || `Codex 进程意外退出 (exit ${code})`), isAuth ? 'capability' : 'transport').catch(() => {})
    })

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.linesClose = () => lines.close()
    this.startLineReader(lines)

    try {
      const initResult = await this.sendRpc('initialize', {
        clientInfo: { name: 'courseware_editor', version: '1.8' },
        capabilities: { experimentalApi: true },
      })
      const versionMatch = String(initResult?.userAgent ?? '').match(/\b(\d+\.\d+\.\d+)\b/)
      this.cliVersion = versionMatch ? versionMatch[1]! : '0.153.4'

      this.sendNotification('initialized')

      const listResult = await this.sendRpc('model/list', { limit: 100, includeHidden: false })
      this.capabilities = parseCodexCapabilities(listResult?.data ?? [], this.cliVersion)
      this.capabilitiesCwd = path.resolve(input.cwd)
      const requested = configuration ? (await this.configure(configuration)).requestedConfiguration ?? null : null
      const modelOverride = requested ? { model: requested.model,
        ...(requested.serviceTier !== undefined ? { serviceTier: requested.serviceTier } : {}) } : {}

      let threadResult: any
      if (externalSessionId) {
        threadResult = await this.sendRpc('thread/resume', {
          cwd: input.cwd,
          threadId: externalSessionId,
          // Native history remains in the resumed thread. The editor already
          // owns its display record and does not consume replayed thread turns.
          excludeTurns: true,
          ...modelOverride,
        })
      } else {
        threadResult = await this.sendRpc('thread/start', { cwd: input.cwd, ...modelOverride })
      }

      const confirmedId = threadResult?.thread?.id
      if (typeof confirmedId !== 'string' || !confirmedId || (externalSessionId && confirmedId !== externalSessionId)) {
        throw new Error('protocol: Codex did not confirm the requested thread identity')
      }
      this.threadId = confirmedId
      const actualModel = threadResult?.model ?? threadResult?.thread?.model
      const selected = requested && this.capabilities.models.find(model => model.id === requested.model)
      if (selected && actualModel != null && actualModel !== selected.id && actualModel !== selected.resolvedModel) {
        throw new Error('Codex 创建会话返回的模型与请求不一致，未确认所选配置')
      }
      // Thread creation confirms only returned fields. A requested effort may
      // first take effect in turn/start and remains pending until native settings.
      this.confirmConfiguration(threadResult)
      return { externalSessionId: this.threadId, capabilities: this.capabilities! }
    } catch (error) {
      await this.shutdown(error instanceof Error ? error : new Error(String(error))).catch(() => {})
      throw error
    }
  }

  async configure(input: LocalAgentConfiguration): Promise<LocalAgentCapabilities> {
    const config = localAgentConfigurationSchema.parse(input)
    const capabilities = this.capabilities ?? await this.discoverCapabilities()
    const target = capabilities.models.find(m => m.id === config.model)
    if (!target) {
      throw new Error(`模型 ${config.model} 不在 Codex 原生目录中`)
    }
    let effort = config.effort
    if (target.effort.kind !== 'supported') {
      effort = null
    } else if (effort !== null && !target.effort.values.includes(effort)) {
      throw new Error('所选强度不在当前原生模型目录中，请重新选择')
    }
    if (config.serviceTier != null && config.serviceTier !== 'default' && !target.serviceTiers?.some(tier => tier.id === config.serviceTier)) {
      throw new Error('所选速度不在 Codex 原生模型目录中，请刷新目录')
    }
    this.activeConfiguration = { ...config, effort }
    this.capabilities = localAgentCapabilitiesSchema.parse({
      ...capabilities,
      requestedConfiguration: this.activeConfiguration,
    })
    return this.capabilities
  }

  async startTurn(
    input: z.infer<typeof localAgentTurnInputSchema>,
    observationFiles: ReadonlyMap<string, string>
  ): Promise<{ nativeTurnId: string | null; inputMetrics: LocalAgentInputMetrics; configuration: Pick<AiTaskConfigurationRun, 'sent' | 'confirmed'> }> {
    if (!this.child || !this.threadId || this.isClosed) {
      throw new Error('Codex adapter session is not open')
    }
    if (this.currentTurnContext && !this.turnEndedEmitted) throw new Error('Codex turn is already running')
    const turnInput = localAgentTurnInputSchema.parse(input)
    this.currentTurnContext = {
      taskId: turnInput.taskId,
      epoch: turnInput.epoch,
      workspace: turnInput.workspace,
      runId: turnInput.runId,
      observationId: turnInput.observationId,
    }
    this.activeTurnId = null
    this.turnStartedReceived = false
    this.turnStartedPromise = new Promise<void>((resolve) => {
      this.resolveTurnStarted = resolve
    })
    this.turnEndedEmitted = false
    this.turnEndedPromise = new Promise(resolve => { this.resolveTurnEnded = resolve })
    this.turnConfigurationEvent = null
    this.drainingEvents = false
    const configurationReady = new Promise<void>(resolve => { this.resolveTurnConfiguration = resolve })
    this.cancelling = undefined
    this.isCancelled = false
    this.eventQueue = new AsyncQueue<LocalAgentNativeEvent>()
    this.startedTools.clear()
    this.agentMessages.clear()
    this.pendingFinalMessage = null
    this.seenUsageSnapshots.clear()
    this.pendingQuestions.clear()

    const content: Array<{ type: 'text'; text: string } | { type: 'localImage'; path: string }> = [
      { type: 'text', text: turnInput.text },
    ]
    for (const fileId of turnInput.imageFileIds) {
      const filePath = observationFiles.get(fileId)
      if (filePath) {
        content.push({ type: 'localImage', path: path.resolve(filePath) })
      }
    }

    const params: Record<string, any> = {
      threadId: this.threadId,
      input: content,
    }
    const requestedConfiguration = this.activeConfiguration
    this.turnRequestedConfiguration = requestedConfiguration
    // Resend explicit choices even when they match the native thread settings.
    // Unchanged settings need not emit a change notification, and a brand-new
    // rollout may not be readable yet; the confirmed thread value still applies.
    const confirmedConfiguration = this.capabilities!.current
    const inheritsConfiguration = requestedConfiguration !== null
      && confirmedConfiguration.model === requestedConfiguration.model
      && (requestedConfiguration.effort === null || confirmedConfiguration.effort === requestedConfiguration.effort)
      && (requestedConfiguration.serviceTier === undefined || confirmedConfiguration.serviceTier === requestedConfiguration.serviceTier)
    if (requestedConfiguration) {
      params.model = requestedConfiguration.model
      if (requestedConfiguration.effort !== null) params.effort = requestedConfiguration.effort
      if (requestedConfiguration.serviceTier !== undefined) params.serviceTier = requestedConfiguration.serviceTier
    }
    if (this.generationRequest) {
      params.outputSchema = codexTurnOutputSchema(this.generationRequest)
    }
    const inputMetrics = measureLocalAgentInput({
      boundary: 'native-turn-params', prompt: turnInput.text, transport: params,
      technicalTransport: { ...params, input: content.filter(item => item.type !== 'localImage') },
      outputSchema: params.outputSchema,
    })

    try {
      const turnResult = await this.sendRpc('turn/start', params)
      const turnId = turnResult?.turn?.id
      if (typeof turnId !== 'string' || !turnId) throw new Error('protocol: turn/start did not return turn.id')
      if (!this.turnEndedEmitted) this.activeTurnId = turnId

      if (requestedConfiguration) {
        if (!this.turnConfigurationEvent && inheritsConfiguration) {
          this.confirmConfiguration({ model: confirmedConfiguration.resolvedModel ?? confirmedConfiguration.model,
            reasoningEffort: confirmedConfiguration.effort, serviceTier: confirmedConfiguration.serviceTier }, requestedConfiguration)
          this.turnConfigurationEvent = { ...this.baseEventIdentity(), nativeTurnId: turnId, kind: 'configuration', capabilities: this.capabilities! }
        }
        // The settings notification is the native effective configuration. An
        // immediate thread/read can legitimately contain null metadata while
        // the new turn is starting, so null is pending rather than a mismatch.
        if (!this.turnConfigurationEvent) {
          const result = await this.sendRpc('thread/read', { threadId: this.threadId, includeTurns: false }).catch(error => {
            // A new rollout can still be empty after turn/start has succeeded.
            // Do not abort that live turn or dispatch it again: its settings
            // notification remains the authoritative configuration confirmation.
            if (error instanceof Error && /failed to read session metadata[\s\S]*rollout[\s\S]*is empty/.test(error.message)) return null
            throw error
          })
          if (result && result.thread?.id !== this.threadId) throw new Error('protocol: configuration belongs to another Codex thread')
          const selected = this.capabilities!.models.find(model => model.id === requestedConfiguration.model)
          if (!this.turnConfigurationEvent && [selected?.id, selected?.resolvedModel].filter(Boolean).includes(result?.thread?.model)
            && (requestedConfiguration.effort === null || result.thread.reasoningEffort === requestedConfiguration.effort)
            && (requestedConfiguration.serviceTier === undefined || result.thread.serviceTier === requestedConfiguration.serviceTier)) {
            this.confirmConfiguration(result, requestedConfiguration)
            this.turnConfigurationEvent = { ...this.baseEventIdentity(), nativeTurnId: turnId, kind: 'configuration', capabilities: this.capabilities! }
          }
          if (!this.turnConfigurationEvent) await this.waitFor(Promise.race([configurationReady, this.turnEndedPromise]), this.rpcTimeoutMs)
          if (!this.turnConfigurationEvent) throw new Error('未取得 Codex 本回合实际模型/强度，所选配置未确认')
        }
      }
      if (this.turnConfigurationEvent) this.turnConfigurationEvent = { ...this.turnConfigurationEvent, nativeTurnId: turnId }
      this.scheduleTerminalCheck()

      return { nativeTurnId: turnId, inputMetrics, configuration: {
        sent: { ...(params.model ? { model: params.model } : {}), ...(params.effort ? { effort: params.effort } : {}),
          ...(params.serviceTier !== undefined ? { serviceTier: params.serviceTier } : {}) },
        confirmed: this.capabilities!.current,
      } }
    } catch (error) {
      await this.shutdown(error instanceof Error ? error : new Error(String(error)), 'protocol').catch(() => {})
      throw error
    }
  }

  async input(input: AiUserInput): Promise<z.infer<typeof aiInputDeliverySchema>> {
    const delivery = (status: 'accepted' | 'rejected' | 'queued' | 'consumed', reason: string | null = null, turnId = this.activeTurnId) =>
      aiInputDeliverySchema.parse({
        taskId: input.taskId,
        epoch: input.epoch,
        workspace: input.workspace,
        inputId: input.inputId,
        status,
        turnId: input.turnId ?? turnId ?? null,
        reason,
        ...(input.kind === 'answer' ? { questionId: input.questionId } : {}),
      })

    if (!this.currentTurnContext || input.taskId !== this.currentTurnContext.taskId || input.epoch !== this.currentTurnContext.epoch
      || workspaceIdentityKey(input.workspace) !== workspaceIdentityKey(this.currentTurnContext.workspace)) {
      return delivery('rejected', '任务或 Epoch 不匹配', input.turnId ?? null)
    }

    if (input.kind === 'answer') {
      const pending = this.pendingQuestions.get(input.questionId)

      if (!pending) return delivery('rejected', '未找到匹配的提问或已超时')
      if (this.isClosed || this.turnEndedEmitted || (input.turnId && input.turnId !== pending.params?.turnId)) return delivery('rejected', '提问已不属于当前活动回合')

      const answers: Record<string, { answers: string[] }> = {}
      for (const item of input.answers) {
        answers[item.id] = { answers: item.values }
      }
      if (pending.elicitation) {
        const action = input.answers.find(answer => answer.id === input.questionId)?.values[0]
        if (!['提交', '拒绝', '取消'].includes(action ?? '')) return delivery('rejected', '请选择提交、拒绝或取消')
        let content: Record<string, unknown> | null = null
        if (action === '提交' && pending.elicitation.mode === 'form') {
          content = {}
          try {
            for (const [key, field] of Object.entries(pending.elicitation.schema?.properties ?? {}) as Array<[string, any]>) {
              const values = input.answers.find(answer => answer.id === key)?.values
              if (!values?.length) continue
              content[key] = field.type === 'string' ? values[0] : field.type === 'array' && field.items?.type === 'string'
                ? values : JSON.parse(values[0]!)
            }
            content = z.fromJSONSchema(pending.elicitation.schema as any).parse(content) as Record<string, unknown>
          } catch { return delivery('rejected', '填写内容不符合原生工具请求的格式，请修改后重试') }
        }
        this.sendRpcResponse(pending.id, { action: action === '提交' ? 'accept' : action === '拒绝' ? 'decline' : 'cancel', content })
      } else if (pending.decisions) {
        const selected = input.answers.find(answer => answer.id === input.questionId)?.values
        if (!selected || selected.length !== 1 || !pending.decisions.has(selected[0]!)) return delivery('rejected', '请选择原生请求提供的一个授权选项')
        this.sendRpcResponse(pending.id, pending.decisions.get(selected[0]!))
      } else this.sendRpcResponse(pending.id, { answers })

      for (const [key, val] of Array.from(this.pendingQuestions.entries())) {
        if (val.id === pending.id) this.pendingQuestions.delete(key)
      }

      const result = delivery('accepted')
      if (this.currentTurnContext) {
        this.eventQueue.push({ ...this.baseEventIdentity(), kind: 'input-delivery', delivery: result })
      }
      return result
    }

    if (input.kind === 'correct' || input.kind === 'supplement') {
      if (!this.activeTurnId || !this.threadId) return delivery('rejected', '当前没有正在进行的回合可供中途纠正')
      if (input.turnId && input.turnId !== this.activeTurnId) {
        return delivery('rejected', '指定的 turnId 与当前活动回合不匹配')
      }
      try {
        await this.sendRpc('turn/steer', {
          threadId: this.threadId,
          expectedTurnId: this.activeTurnId,
          input: [{ type: 'text', text: input.text }],
        })
        const result = delivery('accepted')
        if (this.currentTurnContext) {
          this.eventQueue.push({ ...this.baseEventIdentity(), kind: 'input-delivery', delivery: result })
        }
        return result
      } catch (err) {
        return delivery('rejected', err instanceof Error ? err.message : '中途转向失败')
      }
    }

    if (input.kind === 'stop') {
      await this.cancel()
      const result = delivery('accepted')
      if (this.currentTurnContext) {
        this.eventQueue.push({ ...this.baseEventIdentity(), kind: 'input-delivery', delivery: result })
      }
      return result
    }

    return delivery('rejected', '不支持的输入类型')
  }

  async *events(): AsyncIterable<LocalAgentNativeEvent> {
    this.drainingEvents = true
    if (this.turnConfigurationEvent) {
      const event = this.turnConfigurationEvent
      this.turnConfigurationEvent = null
      yield event
    }
    yield* this.eventQueue
  }

  async cancel(): Promise<void> {
    if (this.cancelling) return this.cancelling
    this.isCancelled = true
    this.cancelling = this.cancelCurrentTurn()
    return this.cancelling
  }

  private async cancelCurrentTurn(): Promise<void> {
    this.cancelPendingQuestions()
    if (!this.currentTurnContext || !this.activeTurnId || !this.threadId || this.isClosed) {
      await this.close()
      return
    }
    if (!this.turnEndedEmitted) {
      const turnId = this.activeTurnId
      if (!this.turnStartedReceived) {
        await this.waitFor(this.turnStartedPromise, this.cancelTimeoutMs)
      }
      if (this.turnEndedEmitted || this.isClosed) return
      try {
        await this.sendRpc('turn/interrupt', { threadId: this.threadId, turnId }, this.cancelTimeoutMs)
        if (await this.waitFor(this.turnEndedPromise, this.cancelTimeoutMs)) return
      } catch { /* An unresponsive or exited transport is closed below. */ }
      await this.close()
    }
  }

  async close(): Promise<void> {
    ++this.lifecycle
    this.isCancelled = true
    return this.shutdown(new Error('Codex session closed'))
  }

  private shutdown(error: Error, category: 'transport' | 'protocol' | 'limit' | 'capability' = 'transport'): Promise<void> {
    this.clearTerminalCheck()
    this.cancelPendingQuestions()
    this.isClosed = true
    for (const pending of this.pendingRpc.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingRpc.clear()
    this.pendingQuestions.clear()
    this.resolveTurnStarted?.()
    this.resolveTurnEnded?.()
    if (this.currentTurnContext && !this.turnEndedEmitted) {
      this.turnEndedEmitted = true
      this.eventQueue.push({ ...this.baseEventIdentity(), kind: 'turn-ended',
        status: this.isCancelled ? 'cancelled' : 'failed',
        failure: this.isCancelled ? null : { category, message: error.message.slice(0, 4000) } })
    }
    this.activeTurnId = null
    this.eventQueue.close()
    if (this.closing) return this.closing
    if (this.linesClose) {
      try { this.linesClose() } catch {}
      this.linesClose = undefined
    }
    const child = this.child
    this.child = undefined
    if (child) { try { child.stdin.end() } catch {} }
    this.closing = child ? stopAgent(child) : Promise.resolve()
    return this.closing
  }

  private async waitFor(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([promise.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) })])
    } finally { clearTimeout(timer) }
  }

  private confirmConfiguration(result: any, expected?: LocalAgentConfiguration): void {
    const capabilities = this.capabilities!
    const actualModel = result?.model ?? result?.thread?.model
    const model = capabilities.models.find(value => value.id === actualModel || value.resolvedModel === actualModel)
    const actualEffort = result?.reasoningEffort ?? result?.thread?.reasoningEffort ?? null
    const actualTier = Object.hasOwn(result ?? {}, 'serviceTier') ? result.serviceTier : result?.thread?.serviceTier
    if (expected) {
      const requestedModel = capabilities.models.find(value => value.id === expected.model)!
      if (!model || (actualModel !== requestedModel.id && actualModel !== requestedModel.resolvedModel)
        || (expected.effort !== null && actualEffort !== expected.effort)
        || (expected.serviceTier !== undefined && actualTier !== expected.serviceTier)) {
        throw new Error('Codex 原生返回的模型/强度与请求不一致，未确认所选配置')
      }
    }
    this.capabilities = localAgentCapabilitiesSchema.parse({ ...capabilities,
      currentSource: 'native-session',
      current: { model: model?.id ?? null, resolvedModel: model ? model.resolvedModel ?? actualModel : null,
        effort: model?.effort.kind === 'supported' && model.effort.values.includes(actualEffort) ? actualEffort : null,
        ...(actualTier !== undefined ? { serviceTier: actualTier } : {}) },
      ...(expected ? { requestedConfiguration: null } : {}),
    })
  }

  private baseEventIdentity() {
    if (!this.currentTurnContext) throw new Error('Turn context not established')
    return {
      taskId: this.currentTurnContext.taskId,
      epoch: this.currentTurnContext.epoch,
      workspace: this.currentTurnContext.workspace,
      runId: this.currentTurnContext.runId,
      nativeTurnId: this.activeTurnId,
    }
  }

  private publishAgentMessage(itemId: string, message: CodexAgentMessage): void {
    if (this.isCancelled) return
    let text = message.text
    if (this.generationRequest) {
      if (message.phase === 'final_answer') return
      const trimmed = text.trimStart()
      if (!trimmed || GENERATION_OPEN.startsWith(trimmed) || trimmed.startsWith(GENERATION_OPEN)) return
      if (trimmed.startsWith('{')) {
        let value: unknown
        try { value = JSON.parse(trimmed) }
        catch {
          // A JSON prefix is ambiguous until completed. Never expose an incomplete envelope.
          if (!message.completed || /"(?:requestId|candidateId)"\s*:|"kind"\s*:\s*"(?:reply|edit)"/.test(trimmed)) return
        }
        if (structuredMessage(value)) {
          if (message.phase === null && !message.completed) return
          if (value.kind !== 'reply') return
          try { text = decodeCodexStructuredOutput(trimmed, { ...this.generationRequest, expectedResult: 'auto' }) }
          catch { return } // Intermediate, stale, or incomplete transport cannot become an outcome.
        }
      }
    }
    if (!message.completed && text === message.displayed) return
    const append = !message.completed && text.startsWith(message.displayed)
    this.eventQueue.push({
      ...this.baseEventIdentity(), kind: 'text', itemId,
      phase: publicMessagePhase(message.phase), operation: append ? 'append' : 'replace',
      text: append ? text.slice(message.displayed.length) : text,
    })
    message.displayed = text
  }

  private publishFinalMessage(): void {
    const message = this.pendingFinalMessage
    this.pendingFinalMessage = null
    if (!message || !this.generationRequest || this.isCancelled) return
    const result = decodeCodexStructuredResult(message.text, this.generationRequest)
    this.eventQueue.push({
      ...this.baseEventIdentity(), kind: 'text', itemId: message.itemId,
      phase: result.kind === 'candidate' ? 'candidate' : publicMessagePhase(message.phase),
      operation: 'replace', text: result.text,
    })
  }

  private sendRpc(method: string, params: unknown, timeoutMs = this.rpcTimeoutMs): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child || this.isClosed) {
        return reject(new Error('Process not running'))
      }
      const id = ++this.nextRpcId
      const timer = setTimeout(() => { void this.shutdown(new Error(`Codex ${method} timeout`)).catch(() => {}) }, timeoutMs)
      this.pendingRpc.set(id, { resolve, reject: error => reject(new Error(`Codex ${method}: ${error.message}`)), timer })
      try { this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n') }
      catch (error) { void this.shutdown(error instanceof Error ? error : new Error(String(error))).catch(() => {}) }
    })
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.child || this.isClosed) return
    this.child.stdin.write(JSON.stringify(params !== undefined ? { method, params } : { method }) + '\n')
  }

  private sendRpcResponse(id: number | string, result: unknown): void {
    if (!this.child || this.isClosed) return
    this.child.stdin.write(JSON.stringify({ id, result }) + '\n')
  }

  private cancelPendingQuestions(): void {
    const seen = new Set<number | string>()
    for (const pending of this.pendingQuestions.values()) {
      if (seen.has(pending.id)) continue
      seen.add(pending.id)
      this.sendRpcResponse(pending.id, pending.elicitation ? { action: 'cancel', content: null } : pending.permission ? { permissions: {}, scope: 'turn' } : pending.decisions ? { decision: 'cancel' } : { answers: {} })
    }
    this.pendingQuestions.clear()
  }

  private startLineReader(lines: ReturnType<typeof createInterface>): void {
    const child = this.child
    void (async () => {
      try {
        for await (const line of lines) {
          if (this.isClosed || this.child !== child) break
          // Native image tools return base64 in a single event. Bound individual
          // frames, not cumulative traffic over a long-lived native session.
          if (Buffer.byteLength(line) > 32 * 1024 * 1024) {
            void this.shutdown(new Error('output-limit: Codex message exceeds 32 MiB'), 'limit').catch(() => {})
            return
          }
          if (!line.trim()) continue
          let wire: any
          try {
            wire = JSON.parse(line)
          } catch {
            continue
          }
          // Keep the native saved file reference in the display trace, without
          // persisting another copy of the generated image in every tool event.
          const item = wire.params?.item
          if ((item?.type === 'imageGeneration' || item?.kind === 'image_gen.generation')
            && typeof item.result === 'string' && typeof item.savedPath === 'string' && item.savedPath) {
            const { result, ...metadata } = item
            wire.params.item = { ...metadata, imageBase64Bytes: Buffer.byteLength(result) }
          }
          this.handleWireMessage(wire)
        }
      } catch (err: any) {
        if (this.child === child) void this.shutdown(err instanceof Error ? err : new Error(String(err)), 'protocol').catch(() => {})
      }
    })()
  }

  private clearTerminalCheck(): void {
    if (this.terminalCheckTimer) clearTimeout(this.terminalCheckTimer)
    this.terminalCheckTimer = undefined
  }

  private scheduleTerminalCheck(delay = this.terminalCheckMs): void {
    this.clearTerminalCheck()
    if (this.isClosed || this.turnEndedEmitted || !this.activeTurnId) return
    this.terminalCheckTimer = setTimeout(() => { void this.reconcileTerminalTurn() }, delay)
    this.terminalCheckTimer.unref?.()
  }

  /** Recover a dropped terminal notification from native state, never from silence itself. */
  private async reconcileTerminalTurn(): Promise<void> {
    if (this.terminalCheckPending) { this.scheduleTerminalCheck(); return }
    const context = this.currentTurnContext, threadId = this.threadId, turnId = this.activeTurnId
    const lifecycle = this.lifecycle
    if (!context || !threadId || !turnId || this.isClosed || this.turnEndedEmitted) return
    this.terminalCheckPending = true
    try {
      // Current Codex exposes paginated turn summaries. Do not hydrate a long
      // thread or read its rollout file (which is not the app-server protocol).
      const result = await this.sendRpc('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary' })
      if (context !== this.currentTurnContext || lifecycle !== this.lifecycle || turnId !== this.activeTurnId
        || this.isClosed || this.turnEndedEmitted) return
      const turn = result?.data?.find((entry: any) => entry.id === turnId)
      if (turn && ['completed', 'interrupted', 'failed'].includes(turn.status)) {
        this.handleWireMessage({ method: 'turn/completed', params: { threadId, turn } })
      }
    } catch {
      // A read failure is not evidence that the native turn ended. Keep the
      // active turn and retry only after another bounded quiet period.
    } finally {
      this.terminalCheckPending = false
      if (context === this.currentTurnContext && lifecycle === this.lifecycle) this.scheduleTerminalCheck()
    }
  }

  private handleWireMessage(wire: any): void {
    // 1. Response to client RPC request
    if (wire.id !== undefined && !wire.method) {
      const pending = this.pendingRpc.get(wire.id)
      if (pending) {
        this.pendingRpc.delete(wire.id)
        clearTimeout(pending.timer)
        if (wire.error) {
          pending.reject(new Error(typeof wire.error === 'object' ? wire.error.message || JSON.stringify(wire.error) : String(wire.error)))
        } else {
          pending.resolve(wire.result)
        }
      }
      return
    }

    // 2. Incoming RPC request from server
    if (wire.id !== undefined && wire.method) {
      const params = wire.params
      if (!this.currentTurnContext || this.isCancelled || this.turnEndedEmitted || params?.threadId !== this.threadId
        || (params?.turnId && this.activeTurnId && params.turnId !== this.activeTurnId)) {
        this.child?.stdin.write(JSON.stringify({ id: wire.id, error: { code: -32602, message: 'Request does not belong to the active turn' } }) + '\n')
        return
      }
      const isApproval = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(wire.method)
      const isPermission = wire.method === 'item/permissions/requestApproval'
      if (wire.method === 'mcpServer/elicitation/request') {
        const mode = params.mode === 'url' ? 'url' : params.mode === 'form' ? 'form' : null
        const properties = Object.entries(params.requestedSchema?.properties ?? {}) as Array<[string, any]>
        if (!mode || (mode === 'form' && (params.requestedSchema?.type !== 'object' || properties.length > 19 || properties.some(([key]) => !key || key.length > 200)))) {
          this.child?.stdin.write(JSON.stringify({ id: wire.id, error: { code: -32602, message: 'Native elicitation form is not representable by this client' } }) + '\n')
          return
        }
        const questionId = `codex-elicitation-${wire.id}`
        const base = this.baseEventIdentity()
        const turnId = params.turnId ?? base.nativeTurnId ?? 'turn'
        const questions: AiQuestion['questions'] = [{ id: questionId,
          title: [params.serverName, params.message, params.url].filter(Boolean).join('\n').slice(0, 1000) || '原生工具请求补充信息',
          options: ['提交', '拒绝', '取消'], multiple: false }]
        if (mode === 'form') for (const [key, field] of properties) {
          const enumerated = field.enum ?? (field.type === 'array' ? field.items?.enum : undefined)
          const options = field.type === 'boolean' ? ['true', 'false'] : Array.isArray(enumerated) && enumerated.length <= 20 ? enumerated.map(String) : []
          questions.push({ id: key, title: [field.title || key, field.description,
            field.type && field.type !== 'string' ? `格式：${field.type}` : null].filter(Boolean).join(' · ').slice(0, 1000),
            options, multiple: field.type === 'array' && field.items?.type === 'string' })
        }
        this.pendingQuestions.set(questionId, { id: wire.id, params: { ...params, turnId }, elicitation: { mode, schema: params.requestedSchema } })
        this.eventQueue.push({ ...base, nativeTurnId: turnId, kind: 'question', question: {
          taskId: base.taskId, epoch: base.epoch, workspace: base.workspace, questionId, turnId, purpose: 'permission', questions,
        } })
        return
      }
      if (isApproval || isPermission) {
        const questionId = `codex-permission-${wire.id}`
        const decisions = new Map<string, unknown>()
        if (isPermission) {
          decisions.set('允许本次请求', { permissions: params.permissions ?? {}, scope: 'turn' })
          decisions.set('拒绝本次请求', { permissions: {}, scope: 'turn' })
        } else {
          const allowed = Array.isArray(params.availableDecisions) ? params.availableDecisions : ['accept', 'acceptForSession', 'decline', 'cancel']
          for (const [label, decision] of [['允许一次', 'accept'], ['允许本会话', 'acceptForSession'], ['拒绝', 'decline'], ['取消', 'cancel']]) {
            if (allowed.includes(decision)) decisions.set(label!, { decision })
          }
        }
        if (!decisions.size) {
          this.child?.stdin.write(JSON.stringify({ id: wire.id, error: { code: -32602, message: 'No supported native permission decision' } }) + '\n')
          return
        }
        const base = this.baseEventIdentity()
        const turnId = params.turnId ?? base.nativeTurnId ?? 'turn'
        this.pendingQuestions.set(questionId, { id: wire.id, params: { ...params, turnId }, decisions, permission: isPermission })
        const description = [params.reason, params.networkApprovalContext ? `网络访问：${params.networkApprovalContext.protocol ?? ''} ${params.networkApprovalContext.host ?? ''}` : params.command,
          params.grantRoot, isPermission ? JSON.stringify(params.permissions ?? {}) : null].filter(Boolean).join('\n')
        this.eventQueue.push({ ...base, nativeTurnId: turnId, kind: 'question', question: {
          taskId: base.taskId, epoch: base.epoch, workspace: base.workspace, questionId, turnId, purpose: 'permission',
          questions: [{ id: questionId, title: (description || 'Codex 请求执行此操作').slice(0, 1000), options: [...decisions.keys()], multiple: false }],
        } })
        return
      }
      if (wire.method === 'item/tool/requestUserInput') {
        const { id, params } = wire
        const questionId = params?.itemId || params?.questions?.[0]?.id || 'question'
        this.pendingQuestions.set(questionId, { id, params })
        if (params?.itemId) this.pendingQuestions.set(params.itemId, { id, params })
        for (const q of params?.questions ?? []) {
          if (q?.id) this.pendingQuestions.set(q.id, { id, params })
        }

        if (this.currentTurnContext) {
          const base = this.baseEventIdentity()
          const questions: AiQuestion['questions'] = (params?.questions ?? []).map((q: any) => ({
            id: q.id ?? 'question',
            title: q.question || q.header || q.id || '',
            options: (q.options ?? []).map((opt: any) => (typeof opt === 'string' ? opt : opt.label ?? opt.description ?? '')),
            multiple: Boolean(q.multiple),
          }))
          const turnId: string = (params?.turnId as string | undefined) ?? base.nativeTurnId ?? 'turn'
          this.eventQueue.push({
            ...base,
            kind: 'question',
            question: {
              taskId: base.taskId,
              epoch: base.epoch,
              workspace: base.workspace,
              questionId,
              turnId,
              questions,
            },
          })
        }
        return
      }

      this.child?.stdin.write(
        JSON.stringify({
          id: wire.id,
          error: { code: -32601, message: 'Client capability not available' },
        }) + '\n'
      )
      return
    }

    // 3. Notifications from server
    if (wire.method === 'thread/status/changed') {
      if (wire.params?.threadId !== this.threadId || !this.currentTurnContext || this.turnEndedEmitted) return
      if (wire.params.status?.type === 'idle' || wire.params.status?.type === 'systemError') this.scheduleTerminalCheck(0)
      else this.scheduleTerminalCheck()
      return
    }
    if (wire.method === 'thread/settings/updated') {
      if (!this.currentTurnContext || this.turnEndedEmitted || wire.params?.threadId !== this.threadId) return
      const settings = wire.params.threadSettings
      this.confirmConfiguration({ model: settings?.model, reasoningEffort: settings?.effort,
        ...(settings?.serviceTier !== undefined ? { serviceTier: settings.serviceTier } : {}) }, this.turnRequestedConfiguration ?? undefined)
      const event: LocalAgentNativeEvent = { ...this.baseEventIdentity(), kind: 'configuration', capabilities: this.capabilities! }
      if (this.drainingEvents) this.eventQueue.push(event)
      else this.turnConfigurationEvent = event
      this.resolveTurnConfiguration?.()
      return
    }
    if (wire.method === 'serverRequest/resolved' && wire.params?.threadId === this.threadId) {
      for (const [key, pending] of this.pendingQuestions) if (pending.id === wire.params.requestId) this.pendingQuestions.delete(key)
      return
    }
    if (wire.method === 'turn/started') {
      if (!this.currentTurnContext || this.turnEndedEmitted || wire.params?.threadId !== this.threadId) return
      const turnId = wire.params?.turn?.id
      if (turnId) {
        this.activeTurnId = turnId
      }
      this.turnStartedReceived = true
      this.resolveTurnStarted?.()
      return
    }

    if (!this.currentTurnContext || this.turnEndedEmitted) return
    if (wire.params?.threadId && wire.params.threadId !== this.threadId) return
    const eventTurnId = wire.params?.turnId ?? wire.params?.turn?.id
    if (eventTurnId && this.activeTurnId && eventTurnId !== this.activeTurnId) return
    const base = this.baseEventIdentity()
    this.scheduleTerminalCheck()

    // Only the explicitly public summary channel is displayed, never raw reasoning deltas.
    if (wire.method === 'item/reasoning/summaryTextDelta') {
      if (typeof wire.params?.itemId === 'string' && typeof wire.params?.delta === 'string' && !this.isCancelled) {
        this.eventQueue.push({ ...base, kind: 'text', itemId: `${wire.params.itemId}:summary:${wire.params.summaryIndex ?? 0}`,
          phase: 'public-summary', operation: 'append', text: wire.params.delta })
      }
      return
    }
    if (wire.method === 'item/agentMessage/delta') {
      const itemId = wire.params?.itemId
      const delta = wire.params?.delta
      if (itemId && typeof delta === 'string' && !this.isCancelled) {
        const message = this.agentMessages.get(itemId) ?? { phase: null, text: '', displayed: '', completed: false }
        if (message.completed) return
        message.text += delta
        this.agentMessages.set(itemId, message)
        this.publishAgentMessage(itemId, message)
      }
      return
    }

    if (wire.method === 'item/started') {
      const item = wire.params?.item
      if (!item) return
      if (['userMessage', 'reasoning', 'thought', 'redacted_thinking'].includes(item.type)) return
      if (item.type === 'agentMessage') {
        const message = this.agentMessages.get(item.id) ?? { phase: null, text: '', displayed: '', completed: false }
        if (typeof item.phase === 'string') message.phase = item.phase
        this.agentMessages.set(item.id, message)
        return
      }

      const itemId = item.id
      const name = item.tool || item.type || 'tool'
      this.startedTools.add(itemId)
      this.eventQueue.push({
        ...base,
        kind: 'tool',
        itemId,
        name,
        status: 'running',
        detail: item,
      })
      return
    }

    if (wire.method === 'item/completed') {
      const item = wire.params?.item
      if (!item) return
      if (item.type === 'reasoning' && Array.isArray(item.summary) && !this.isCancelled) {
        item.summary.forEach((part: unknown, index: number) => {
          if (typeof part === 'string') this.eventQueue.push({ ...base, kind: 'text', itemId: `${item.id}:summary:${index}`,
            phase: 'public-summary', operation: 'replace', text: part })
        })
      }
      if (['userMessage', 'reasoning', 'thought', 'redacted_thinking'].includes(item.type)) return

      if (item.type === 'agentMessage') {
        if (this.isCancelled) return
        const message = this.agentMessages.get(item.id) ?? { phase: null, text: '', displayed: '', completed: false }
        if (message.completed) return
        if (typeof item.phase === 'string') message.phase = item.phase
        if (typeof item.text === 'string') message.text = item.text
        message.completed = true
        this.agentMessages.set(item.id, message)
        if (this.generationRequest && message.phase === 'final_answer') {
          this.pendingFinalMessage = { itemId: item.id, text: message.text, phase: message.phase }
        } else this.publishAgentMessage(item.id, message)
        return
      }

      const itemId = item.id
      const name = item.tool || item.type || 'tool'
      if (!this.startedTools.has(itemId)) {
        this.startedTools.add(itemId)
        this.eventQueue.push({
          ...base,
          kind: 'tool',
          itemId,
          name,
          status: 'running',
          detail: item,
        })
      }
      this.startedTools.delete(itemId)
      this.eventQueue.push({
        ...base,
        kind: 'tool',
        itemId,
        name,
        status: item.error ? 'failed' : 'completed',
        detail: item,
      })
      return
    }

    if (wire.method === 'thread/tokenUsage/updated') {
      const usage = wire.params?.tokenUsage
      if (usage && typeof usage === 'object') {
        const last = codexUsageBreakdown(usage.last)
        const total = codexUsageBreakdown(usage.total)
        // Cumulative native totals identify duplicate snapshots; a turn ID or last-only value does not.
        const snapshot = total && codexUsageFields.some(key => total[key] !== null) ? JSON.stringify(total) : null
        if (snapshot && this.seenUsageSnapshots.has(snapshot)) return
        if (snapshot) this.seenUsageSnapshots.add(snapshot)
        this.eventQueue.push({
          ...base,
          kind: 'usage',
          inputTokens: last?.inputTokens ?? null,
          outputTokens: last?.outputTokens ?? null,
          cachedInputTokens: last?.cachedInputTokens ?? null,
          tokenUsage: { version: 1, source: 'codex-app-server', last, total },
        })
      }
      return
    }

    if (wire.method === 'turn/completed') {
      this.clearTerminalCheck()
      const turn = wire.params?.turn
      // Some native versions supply the final public snapshot only on turn/completed.
      if (!this.isCancelled && Array.isArray(turn?.items)) {
        for (const item of turn.items) if (item.type === 'agentMessage' || item.type === 'reasoning') {
          if (item.type === 'agentMessage' && this.agentMessages.get(item.id)?.completed) continue
          this.handleWireMessage({ method: 'item/completed', params: { threadId: this.threadId, turnId: turn.id, item } })
        }
      }
      const status = this.isCancelled || turn?.status === 'interrupted' ? 'cancelled' : turn?.status === 'completed' ? 'completed' : 'failed'
      let failure: { category: 'transport' | 'service' | 'protocol' | 'limit' | 'capability' | 'storage'; message: string } | null = null
      if (status === 'failed') {
        const errMsg = turn?.error?.message ?? `Codex 回合失败: ${turn?.status}`
        const category = /429|rate.limit|quota/i.test(errMsg) ? 'service'
          : /output-limit/i.test(errMsg) ? 'limit'
          : /unauth|not logged|token refresh/i.test(errMsg) ? 'capability'
          : /connection|network|timeout|econnrefused/i.test(errMsg) ? 'transport'
          : 'protocol'
        failure = { category, message: errMsg }
      }
      if (status === 'completed') this.publishFinalMessage()
      else this.pendingFinalMessage = null
      this.turnEndedEmitted = true
      this.resolveTurnEnded?.()
      this.resolveTurnStarted?.()
      this.activeTurnId = null
      this.eventQueue.push({
        ...base,
        kind: 'turn-ended',
        status,
        failure,
      })
      this.eventQueue.close()
      return
    }

    if (wire.method === 'error') {
      if (!wire.params?.willRetry) {
        this.clearTerminalCheck()
        const errMsg = wire.params?.error?.message ?? 'Codex error'
        this.turnEndedEmitted = true
        this.resolveTurnEnded?.()
        this.resolveTurnStarted?.()
        this.activeTurnId = null
        this.eventQueue.push({
          ...base,
          kind: 'turn-ended',
          status: 'failed',
          failure: { category: 'transport', message: errMsg },
        })
        this.eventQueue.close()
      }
    }
  }
}
