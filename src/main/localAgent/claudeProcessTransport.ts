import { workspaceIdentityKey } from '../../shared/workspaceIdentity'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { nativeProxyEnvironment } from './nativeProxy'
import type { z } from 'zod'
import { measureLocalAgentInput, type LocalAgentInputMetrics } from '../../shared/localAgentInputMetrics'
import {
  localAgentCapabilitiesSchema,
  localAgentProbeSchema,
  type LocalAgentCapabilities,
  type LocalAgentConfiguration,
  type LocalAgentProbe,
  type LocalAgentId,
} from '../../shared/localAgentContract'
import {
  aiInputDeliverySchema,
  aiQuestionSchema,
  type AiUserInput,
  type LocalAgentCliAdapterV2,
  type LocalAgentNativeEvent,
  type localAgentTurnInputSchema,
} from '../../shared/localAgentTaskContract'

export type AiQuestion = z.infer<typeof aiQuestionSchema>
import {
  captureAgent,
  launchAgent,
  resolveAgentExecutable,
  stopAgent,
  type AgentExecutable,
} from './process'
import type { GenerationRequest } from '../../shared/generationContract'

export const CLAUDE_CLI_ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--replay-user-messages',
  '--permission-prompt-tool', 'stdio',
]

export function parseClaudeModels(rawModels: any[]): LocalAgentCapabilities['models'] {
  const models = (Array.isArray(rawModels) ? rawModels : []).map(m => {
    const id = typeof m.value === 'string' && m.value ? m.value : 'default'
    const resolvedModel = typeof m.resolvedModel === 'string' && m.resolvedModel ? m.resolvedModel : null
    const label = typeof m.displayName === 'string' && m.displayName ? m.displayName : id
    const image = 'supported' as const
    const hasEffort = m.supportsEffort === true && Array.isArray(m.supportedEffortLevels) && m.supportedEffortLevels.length > 0
    const effort = hasEffort
      ? {
          kind: 'supported' as const,
          values: m.supportedEffortLevels.map(String),
          default: null,
        }
      : {
          kind: 'unsupported' as const,
        }
    return { id, resolvedModel, label, image, effort }
  })

  // Deduplicate model IDs while preserving order
  const seenIds = new Set<string>()
  const uniqueModels: typeof models = []
  for (const m of models) {
    if (!seenIds.has(m.id)) {
      seenIds.add(m.id)
      uniqueModels.push(m)
    }
  }

  return uniqueModels
}

export function buildClaudeCapabilities(cliVersion: string, rawModels: any[]): LocalAgentCapabilities {
  const models = parseClaudeModels(rawModels)
  return localAgentCapabilitiesSchema.parse({
    version: 1,
    adapter: 'claude',
    cliVersion: cliVersion || '2.1.0',
    models,
    current: {
      model: null,
      resolvedModel: null,
      effort: null,
    },
    input: {
      image: 'supported',
      readFile: 'supported',
      question: 'structured',
      correction: 'interrupt-resume',
      cancel: 'supported',
    },
  })
}

/** Standalone Claude capability discovery. Starts temporary process, performs initialize, returns capabilities. */
export async function discoverClaudeCapabilities(
  binary: AgentExecutable,
  cwd?: string,
): Promise<LocalAgentCapabilities> {
  const workDir = cwd ?? process.cwd()
  let version = '2.1.0'
  try {
    const info = await captureAgent(binary, ['--version'], workDir)
    const match = info.text.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
    if (match) version = match
  } catch {
    // Keep fallback version
  }

  const child = launchAgent(binary, [...CLAUDE_CLI_ARGS], workDir)
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const requestId = `init-${randomUUID()}`

  try {
    const responsePromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Claude initialization deadline exceeded'))
      }, 30_000)

      child.once('error', err => {
        clearTimeout(timer)
        reject(err)
      })

      child.once('close', code => {
        clearTimeout(timer)
        reject(new Error(`Claude process exited ${code} during initialization`))
      })

      lines.on('line', line => {
        try {
          const wire = JSON.parse(line)
          if (wire.type === 'control_response' && wire.response?.request_id === requestId) {
            clearTimeout(timer)
            if (wire.response.subtype === 'success') {
              resolve(wire.response.response)
            } else {
              reject(new Error(wire.response.error ?? 'Claude initialization failed'))
            }
          }
        } catch {
          // Ignore non-JSON or partial lines
        }
      })
    })

    const initMessage = {
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'initialize',
        hooks: {},
        sdkMcpServers: [],
        agents: [],
      },
    }
    child.stdin.write(JSON.stringify(initMessage) + '\n')

    const response = await responsePromise
    const rawModels = response?.models ?? []
    return buildClaudeCapabilities(version, rawModels)
  } finally {
    lines.close()
    await stopAgent(child)
  }
}

class AsyncEventQueue implements AsyncIterable<LocalAgentNativeEvent> {
  private queue: LocalAgentNativeEvent[] = []
  private waitingResolvers: Array<() => void> = []
  private done = false
  private errorState?: Error

  push(event: LocalAgentNativeEvent): void {
    if (this.done) return
    this.queue.push(event)
    const resolver = this.waitingResolvers.shift()
    if (resolver) resolver()
  }

  close(): void {
    this.done = true
    while (this.waitingResolvers.length > 0) {
      this.waitingResolvers.shift()!()
    }
  }

  fail(err: Error): void {
    this.errorState = err
    this.done = true
    while (this.waitingResolvers.length > 0) {
      this.waitingResolvers.shift()!()
    }
  }

  isDone(): boolean {
    return this.done
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<LocalAgentNativeEvent> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!
      }
      if (this.errorState) {
        throw this.errorState
      }
      if (this.done) {
        return
      }
      await new Promise<void>(resolve => this.waitingResolvers.push(resolve))
    }
  }
}

export class ClaudeProcessTransportAdapter implements LocalAgentCliAdapterV2 {
  readonly id = 'claude' as const
  private child?: ChildProcessWithoutNullStreams
  public externalSessionId: string | null = null
  private expectedSessionId: string | null = null
  private identityFailure: Error | null = null
  private configurationConfirmed = false
  private capabilities?: LocalAgentCapabilities
  private cliVersion = '2.1.0'
  private currentTurn?: {
    input: z.infer<typeof localAgentTurnInputSchema>
    observationFiles: ReadonlyMap<string, string>
  }
  private get currentTurnContext() {
    return this.currentTurn ? this.currentTurn.input : null
  }
  private activeTurnId: string | null = null
  private eventQueue = new AsyncEventQueue()
  private controlResolvers = new Map<string, (resp: any) => void>()
  private pendingQuestions = new Map<string, {
    requestId: string
    question: AiQuestion
    answerKeys: ReadonlyMap<string, string>
    resolve: (answers: Record<string, string>) => void
  }>()
  private wasInterrupted = false
  private currentMessageId = ''
  private knownMessageIds = new Map<string, number[]>()
  private activeTools = new Map<string, string>()
  private askUserQuestionToolIds = new Set<string>()
  private stderr = ''
  private linesReader?: ReturnType<typeof createInterface>
  private isClosed = false

  constructor(
    private readonly resolve: (id: LocalAgentId) => Promise<AgentExecutable | null> = resolveAgentExecutable,
    private readonly generationRequest?: GenerationRequest,
  ) {}

  async probe(): Promise<LocalAgentProbe> {
    const result = (status: LocalAgentProbe['status'], message: string, version?: string) =>
      localAgentProbeSchema.parse({ adapter: 'claude', status, message, version })
    try {
      const binary = await this.resolve('claude')
      if (!binary) return result('missing', '请自行安装 CLI')
      const info = await captureAgent(binary, ['--version'], process.cwd())
      const version = info.text.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
      const major = Number(version?.split('.')[0])
      if (info.code !== 0 || !version || major !== 2) {
        return result('unsupported-version', 'CLI 版本不在当前协议范围内', version)
      }
      const auth = await captureAgent(binary, ['auth', 'status'], process.cwd())
      let authenticated = auth.code === 0
      try {
        authenticated = authenticated && JSON.parse(auth.text).loggedIn === true
      } catch {
        authenticated = false
      }
      return result(
        authenticated ? 'ready' : 'unauthenticated',
        authenticated ? 'CLI 可用' : '请在 CLI 中自行登录',
        version,
      )
    } catch {
      return result('launch', 'CLI 探测失败，请检查本地安装')
    }
  }

  async open(input: Parameters<LocalAgentCliAdapterV2['open']>[0]): Promise<{ externalSessionId: string | null; capabilities: LocalAgentCapabilities }> {
    this.externalSessionId = null
    this.expectedSessionId = input.externalSessionId
    this.identityFailure = null
    this.configurationConfirmed = false
    this.eventQueue = new AsyncEventQueue()
    this.isClosed = false
    this.wasInterrupted = false
    this.stderr = ''

    const binary = await this.resolve('claude')
    if (!binary) throw new Error('missing')

    try {
      const info = await captureAgent(binary, ['--version'], input.cwd)
      const match = info.text.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
      if (match) this.cliVersion = match
    } catch {
      // Keep default cliVersion
    }

    const args = [
      ...CLAUDE_CLI_ARGS,
      ...(input.externalSessionId ? ['--resume', input.externalSessionId] : []),
    ]

    try {
      const environment = await nativeProxyEnvironment('claude')
      if (this.isClosed) throw new Error('Claude session was closed before launch')
      this.child = launchAgent(binary, args, input.cwd, input.candidateRoot, environment)
    } catch {
      throw new Error('launch')
    }

    this.child.stderr.on('data', chunk => {
      this.stderr = (this.stderr + chunk.toString('utf8')).slice(-4000)
    })

    this.child.once('error', err => {
      if (this.isClosed) return
      this.rejectControls(err.message)
      this.eventQueue.fail(err)
    })

    this.child.once('close', code => {
      if (this.isClosed) return
      this.pendingQuestions.clear()
      const isAuth = /unauth|not logged|authentication|api.key|401/i.test(this.stderr)
      // Initialize can still be pending when authentication fails. Preserve the
      // same actionable reason as an active turn without exposing raw stderr.
      this.rejectControls(isAuth ? 'CLI 认证失效，请重新登录' : `Claude process exited ${code}`)
      if (!this.eventQueue.isDone()) {
        if (this.wasInterrupted) {
          this.eventQueue.push({
            ...this.baseIdentity(),
            kind: 'turn-ended',
            status: 'cancelled',
            failure: null,
          })
          this.eventQueue.close()
        } else {
          this.eventQueue.push({
            ...this.baseIdentity(),
            kind: 'turn-ended',
            status: 'failed',
            failure: {
              category: isAuth ? 'capability' : 'transport',
              message: isAuth ? 'CLI 认证失效，请重新登录' : `Claude 进程异常退出 (code: ${code})`,
            },
          })
          this.eventQueue.close()
        }
      }
    })

    this.linesReader = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.linesReader.on('line', line => {
      this.handleStdoutLine(line)
    })

    try {
      const initResponse = await this.requestControl({
        subtype: 'initialize',
        hooks: {},
        sdkMcpServers: [],
        agents: [],
      })
      if (this.identityFailure) throw this.identityFailure
      this.capabilities = buildClaudeCapabilities(this.cliVersion, initResponse?.models ?? [])
    } catch (error) {
      await this.close()
      throw error
    }

    return {
      externalSessionId: this.externalSessionId,
      capabilities: this.capabilities,
    }
  }

  getExternalSessionId(): string | null {
    return this.externalSessionId
  }

  async configure(config: LocalAgentConfiguration): Promise<LocalAgentCapabilities> {
    if (!this.capabilities) {
      throw new Error('Claude process has not been initialized')
    }
    if (this.identityFailure) throw this.identityFailure
    if (this.currentTurn && !this.eventQueue.isDone()) throw new Error('Claude configuration requires a turn boundary')
    const targetModel = this.capabilities.models.find(m => m.id === config.model)
    if (!targetModel) {
      throw new Error(`模型 ${config.model} 不在 Claude 原生目录中`)
    }
    let effort = config.effort
    if (targetModel.effort.kind !== 'supported') {
      effort = null
    } else if (effort !== null && !targetModel.effort.values.includes(effort)) {
      effort = targetModel.effort.default ?? null
    }
    // A catalog entry is not evidence of a selected model. Both changes must be
    // acknowledged by the native process before this configuration is confirmed.
    await this.requestControl({ subtype: 'set_model', model: targetModel.id })
    this.configurationConfirmed = false
    this.capabilities = localAgentCapabilitiesSchema.parse({
      ...this.capabilities,
      current: { model: targetModel.id, resolvedModel: targetModel.resolvedModel ?? null, effort: null },
    })
    await this.requestControl({ subtype: 'apply_flag_settings', settings: { effortLevel: effort } })
    this.capabilities = localAgentCapabilitiesSchema.parse({
      ...this.capabilities,
      current: {
        model: targetModel.id,
        resolvedModel: targetModel.resolvedModel ?? null,
        effort,
      },
    })
    this.configurationConfirmed = true
    return this.capabilities
  }

  async startTurn(
    turnInput: z.infer<typeof localAgentTurnInputSchema>,
    observationFiles: ReadonlyMap<string, string>,
  ): Promise<{ nativeTurnId: string | null; inputMetrics: LocalAgentInputMetrics }> {
    if (!this.child || this.isClosed || this.child.exitCode !== null) throw new Error('Claude process is not running')
    if (this.identityFailure) throw this.identityFailure
    if (this.currentTurn && !this.eventQueue.isDone()) throw new Error('Claude turn is already running')
    this.pendingQuestions.clear()
    this.currentMessageId = ''
    this.knownMessageIds.clear()
    this.currentTurn = { input: turnInput, observationFiles }
    this.activeTurnId = turnInput.runId
    this.wasInterrupted = false
    this.eventQueue = new AsyncEventQueue()
    if (this.configurationConfirmed && this.capabilities) {
      this.eventQueue.push({ ...this.baseIdentity(), kind: 'configuration', capabilities: this.capabilities })
    }

    const content: Array<Record<string, any>> = [
      { type: 'text', text: turnInput.text },
    ]

    for (const fileId of turnInput.imageFileIds) {
      const filePath = observationFiles.get(fileId)
      if (filePath) {
        try {
          const bytes = await fs.readFile(filePath)
          const base64 = bytes.toString('base64')
          const ext = path.extname(filePath).toLowerCase()
          const media_type = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.webp' ? 'image/webp'
            : ext === '.gif' ? 'image/gif'
            : 'image/png'
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type,
              data: base64,
            },
          })
        } catch {
          // Ignore unreadable image file
        }
      }
    }

    const message = {
      type: 'user',
      uuid: randomUUID(),
      session_id: '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content,
      },
    }

    // STDIN IS KEPT OPEN! Do NOT call stdin.end()
    const inputMetrics = measureLocalAgentInput({
      boundary: 'native-user-message', prompt: turnInput.text, transport: message,
      technicalTransport: { ...message, message: { ...message.message, content: content.filter(item => item.type !== 'image') } },
    })
    this.send(message)
    return { nativeTurnId: this.activeTurnId, inputMetrics }
  }

  async input(userInput: AiUserInput): Promise<z.infer<typeof aiInputDeliverySchema>> {
    if (
      !this.currentTurnContext ||
      userInput.taskId !== this.currentTurnContext.taskId ||
      userInput.epoch !== this.currentTurnContext.epoch ||
      workspaceIdentityKey(userInput.workspace) !== workspaceIdentityKey(this.currentTurnContext.workspace) ||
      (userInput.turnId !== null && userInput.turnId !== this.activeTurnId) ||
      this.eventQueue.isDone()
    ) {
      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: 'rejected',
        turnId: userInput.turnId ?? this.activeTurnId ?? null,
        reason: '任务或 Epoch 不匹配，工作区/回合不匹配，或回合已经结束',
      })
    }

    if (userInput.kind === 'correct' || userInput.kind === 'supplement') {
      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: 'queued',
        turnId: userInput.turnId ?? this.activeTurnId ?? null,
        reason: userInput.kind === 'correct' ? '正在中断当前回合，将在同一原生会话立即处理新的引导'
          : '已排队，将在当前回合结束后作为下一回合消息处理',
      })
    }

    if (userInput.kind === 'answer') {
      const pending = this.pendingQuestions.get(userInput.questionId)
      if (!pending) {
        return aiInputDeliverySchema.parse({
          taskId: userInput.taskId,
          epoch: userInput.epoch,
          workspace: userInput.workspace,
          inputId: userInput.inputId,
          status: 'rejected',
          turnId: userInput.turnId ?? this.activeTurnId ?? null,
          reason: '未找到匹配的提问或已超时',
        })
      }
      const answers = new Map(userInput.answers.map(answer => [answer.id, answer.values]))
      const valid = answers.size === userInput.answers.length && answers.size === pending.question.questions.length &&
        pending.question.questions.every(question => {
          const values = answers.get(question.id)
          return values && values.length > 0 && (question.multiple || values.length === 1) &&
            (pending.question.purpose !== 'permission' || values.every(value => question.options.includes(value)))
        })
      if (!valid) return aiInputDeliverySchema.parse({
        taskId: userInput.taskId, epoch: userInput.epoch, workspace: userInput.workspace, inputId: userInput.inputId,
        status: 'rejected', turnId: this.activeTurnId, reason: '回答与当前原生问题或授权选项不匹配',
      })
      const answersDict: Record<string, string> = {}
      for (const ans of userInput.answers) {
        answersDict[pending.answerKeys.get(ans.id)!] = ans.values.join(', ')
      }
      this.pendingQuestions.delete(userInput.questionId)
      pending.resolve(answersDict)

      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: 'accepted',
        turnId: userInput.turnId ?? this.activeTurnId ?? null,
        reason: null,
      })
    }

    if (userInput.kind === 'stop') {
      await this.interrupt()
      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: 'accepted',
        turnId: userInput.turnId ?? this.activeTurnId ?? null,
        reason: null,
      })
    }

    const fallback = userInput as any
    return aiInputDeliverySchema.parse({
      taskId: fallback.taskId,
      epoch: fallback.epoch,
      workspace: fallback.workspace,
      inputId: fallback.inputId,
      status: 'rejected',
      turnId: fallback.turnId ?? this.activeTurnId ?? null,
      reason: '不支持的输入类型',
    })
  }

  events(): AsyncIterable<LocalAgentNativeEvent> {
    return this.eventQueue
  }

  cancel(): Promise<void> {
    return this.interrupt()
  }

  async interruptTurn(): Promise<void> {
    const queue = this.eventQueue
    await this.interrupt()
    const deadline = Date.now() + 1500
    while (!queue.isDone() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    if (!queue.isDone()) { await this.close(); throw new Error('Claude 未确认回合中断；已停止传输，新的引导仍待处理') }
  }

  async interrupt(): Promise<void> {
    this.wasInterrupted = true
    for (const pending of this.pendingQuestions.values()) {
      this.send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: pending.requestId,
          response: {
            behavior: 'deny',
            message: 'Interrupted by user',
          },
        },
      })
    }
    this.pendingQuestions.clear()
    const requestId = `interrupt-${randomUUID()}`
    this.send({
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'interrupt',
      },
    })
  }

  async close(): Promise<void> {
    if (this.isClosed) return
    this.isClosed = true
    this.rejectControls('Claude process closed')
    this.pendingQuestions.clear()
    this.currentTurn = undefined
    this.activeTurnId = null
    if (this.linesReader) {
      this.linesReader.close()
      this.linesReader = undefined
    }
    if (this.child) {
      try {
        this.child.stdin.end()
      } catch {}
      await stopAgent(this.child)
      this.child = undefined
    }
    this.eventQueue.close()
  }

  private send(value: Record<string, any>): void {
    if (!this.child || this.isClosed) return
    this.child.stdin.write(JSON.stringify(value) + '\n')
  }

  private requestControl(request: Record<string, any>): Promise<any> {
    if (!this.child || this.isClosed || this.child.exitCode !== null) return Promise.reject(new Error('Claude process is not running'))
    const requestId = `${request.subtype}-${randomUUID()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.controlResolvers.delete(requestId)
        reject(new Error(`Claude ${request.subtype} deadline exceeded`))
      }, 30_000)
      this.controlResolvers.set(requestId, response => {
        clearTimeout(timer)
        if (response.subtype === 'success') resolve(response.response)
        else reject(new Error(response.error ?? `Claude ${request.subtype} failed`))
      })
      this.send({ type: 'control_request', request_id: requestId, request })
    })
  }

  private rejectControls(message: string): void {
    for (const resolve of this.controlResolvers.values()) resolve({ subtype: 'error', error: message })
    this.controlResolvers.clear()
  }

  private confirmSessionId(sessionId: string): boolean {
    const expected = this.expectedSessionId ?? this.externalSessionId
    if (expected !== null && sessionId !== expected) {
      this.identityFailure = new Error('Claude 原生会话身份与请求恢复的会话不匹配')
      this.rejectControls(this.identityFailure.message)
      this.eventQueue.push({ ...this.baseIdentity(), kind: 'turn-ended', status: 'failed', failure: {
        category: 'protocol', message: this.identityFailure.message,
      } })
      this.eventQueue.close()
      return false
    }
    this.externalSessionId = sessionId
    return true
  }

  private confirmNativeModel(model: string): void {
    if (!this.capabilities) return
    const selected = this.capabilities.models.find(entry => entry.id === this.capabilities!.current.model)
    const matching = selected && (selected.id === model || selected.resolvedModel === model)
      ? selected : this.capabilities.models.find(entry => entry.id === model || entry.resolvedModel === model)
    this.capabilities = localAgentCapabilitiesSchema.parse({
      ...this.capabilities,
      current: {
        model: matching?.id ?? null,
        resolvedModel: matching?.resolvedModel ?? model,
        effort: matching?.id === selected?.id ? this.capabilities.current.effort : null,
      },
    })
    this.eventQueue.push({ ...this.baseIdentity(), kind: 'configuration', capabilities: this.capabilities })
  }

  private baseIdentity() {
    const input = this.currentTurn?.input
    return {
      taskId: input?.taskId ?? randomUUID(),
      epoch: input?.epoch ?? 0,
      workspace: input?.workspace ?? { version: 1 as const, projectId: 'lesson', normalizedPath: 'c:/' },
      runId: input?.runId ?? randomUUID(),
      nativeTurnId: this.activeTurnId,
    }
  }

  private handleStdoutLine(line: string): void {
    if (Buffer.byteLength(line) > 32 * 1024 * 1024) {
      this.eventQueue.fail(new Error(`output-limit: Claude message ${Buffer.byteLength(line)} bytes exceeds 32 MiB`))
      return
    }

    let wire: any
    try {
      wire = JSON.parse(line)
    } catch {
      return
    }

    if (this.identityFailure) return
    // The native session can first arrive on an init, replay, stream or result
    // message. A requested resume ID stays unconfirmed until that echo arrives.
    if (typeof wire.session_id === 'string' && wire.session_id && !this.confirmSessionId(wire.session_id)) return

    if (wire.type === 'control_response' && wire.response?.request_id) {
      const resolver = this.controlResolvers.get(wire.response.request_id)
      if (resolver) {
        this.controlResolvers.delete(wire.response.request_id)
        resolver(wire.response)
        return
      }
    }

    if (wire.type === 'control_request') {
      const request = wire.request
      if (request?.subtype === 'can_use_tool') {
        if (typeof wire.request_id !== 'string' || !wire.request_id || wire.request_id.length > 200) {
          this.eventQueue.fail(new Error('Claude tool permission request has no valid identity'))
          return
        }
        if (!this.currentTurn || this.eventQueue.isDone()) {
          this.send({ type: 'control_response', response: {
            subtype: 'success', request_id: wire.request_id,
            response: { behavior: 'deny', message: 'The requested turn is no longer active' },
          } })
          return
        }
        if (request.tool_name === 'AskUserQuestion') {
          const questionId = wire.request_id ?? `q-${randomUUID()}`
          const rawQuestions = Array.isArray(request.input?.questions) ? request.input.questions : []
          const questions: AiQuestion['questions'] = (rawQuestions.length > 0 ? rawQuestions : [{ question: 'Please answer', options: ['Yes', 'No'] }])
            .slice(0, 20)
            .map((q: any, idx: number) => {
              const id = `question-${idx + 1}`
              const title = (typeof q.question === 'string' && q.question ? q.question : (typeof q.header === 'string' && q.header ? q.header : `Question ${idx + 1}`)).slice(0, 1000)
              const rawOpts = Array.isArray(q.options) ? q.options : []
              let options = rawOpts.slice(0, 20).map((opt: any) =>
                (typeof opt === 'string' ? opt : (typeof opt?.label === 'string' ? opt.label : String(opt))).slice(0, 1000)
              )
              if (options.length === 0) options = ['Yes', 'No']
              const multiple = Boolean(q.multiSelect)
              return { id, title, options, multiple }
            })

          const aiQuestion: AiQuestion = {
            taskId: this.currentTurn?.input.taskId ?? randomUUID(),
            epoch: this.currentTurn?.input.epoch ?? 0,
            workspace: this.currentTurn?.input.workspace ?? { version: 1, projectId: 'lesson', normalizedPath: 'c:/' },
            questionId,
            turnId: this.activeTurnId ?? randomUUID(),
            purpose: 'clarification',
            questions,
          }

          this.pendingQuestions.set(questionId, {
            requestId: wire.request_id,
            question: aiQuestion,
            answerKeys: new Map(questions.map((question, index) => [question.id, rawQuestions[index]?.question ?? question.title])),
            resolve: answersDict => {
              this.send({
                type: 'control_response',
                response: {
                  subtype: 'success',
                  request_id: wire.request_id,
                  response: {
                    behavior: 'allow',
                    updatedInput: {
                      ...request.input,
                      answers: answersDict,
                    },
                  },
                },
              })
            },
          })

          this.eventQueue.push({
            ...this.baseIdentity(),
            kind: 'question',
            question: aiQuestion,
          })
          return
        }

        // Claude applies its own configured tool rules before asking the host.
        // Forward an actual permission prompt; observation scope is not an OS
        // permission policy, and the adapter must never silently authorize it.
        const questionId = wire.request_id
        const allow = '允许这次操作'
        const deny = '拒绝这次操作'
        const { taskId, epoch, workspace } = this.baseIdentity()
        const permissionQuestion = aiQuestionSchema.parse({
          taskId, epoch, workspace,
          questionId,
          turnId: this.activeTurnId!,
          purpose: 'permission',
          questions: [{
            id: 'permission',
            title: `Claude 请求使用 ${request.tool_name}: ${JSON.stringify(request.input ?? {})}`.slice(0, 1000),
            options: [allow, deny],
            multiple: false,
          }],
        })
        this.pendingQuestions.set(questionId, {
          requestId: wire.request_id,
          question: permissionQuestion,
          answerKeys: new Map([['permission', 'permission']]),
          resolve: answers => this.send({
            type: 'control_response', response: {
              subtype: 'success', request_id: wire.request_id,
              response: answers.permission === allow
                ? { behavior: 'allow', updatedInput: request.input }
                : { behavior: 'deny', message: '用户拒绝了这次工具操作' },
            },
          }),
        })
        this.eventQueue.push({
          ...this.baseIdentity(), kind: 'question', question: permissionQuestion,
        })
        return
      }
    }

    if (wire.type === 'control_cancel_request' && typeof wire.request_id === 'string') {
      this.pendingQuestions.delete(wire.request_id)
      return
    }

    if (wire.type === 'stream_event') {
      const event = wire.event
      if (!event) return
      if (event.type === 'message_start' && event.message?.id) {
        this.currentMessageId = event.message.id
      }
      if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
        const indices = this.knownMessageIds.get(this.currentMessageId) ?? []
        const index = event.index ?? 0
        if (!indices.includes(index)) indices.push(index)
        this.knownMessageIds.set(this.currentMessageId, indices)
        if (typeof event.content_block.text === 'string' && event.content_block.text) this.eventQueue.push({
          ...this.baseIdentity(), kind: 'text', itemId: this.currentMessageId ? `${this.currentMessageId}:${index}` : `text-${index}`,
          phase: 'body', operation: 'append', text: event.content_block.text,
        })
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const text = typeof event.delta.text === 'string' ? event.delta.text : ''
        const itemId = this.currentMessageId ? `${this.currentMessageId}:${event.index ?? 0}` : `text-${event.index ?? 0}`
        this.eventQueue.push({
          ...this.baseIdentity(),
          kind: 'text',
          itemId,
          phase: 'body',
          operation: 'append',
          text,
        })
      }
      return
    }

    if (wire.type === 'assistant' && wire.message?.content) {
      const blocks = Array.isArray(wire.message.content) ? wire.message.content : []
      const streamedTextIndices = this.knownMessageIds.get(wire.message.id) ?? []
      let textIndex = 0
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i]
        if (block.type === 'text' && typeof block.text === 'string') {
          // Native final content can omit non-text blocks, so its array position
          // need not equal the stream index. Preserve the native text block identity.
          const blockIndex = streamedTextIndices[textIndex++] ?? i
          const itemId = wire.message.id ? `${wire.message.id}:${blockIndex}` : `text-${blockIndex}`
          this.eventQueue.push({
            ...this.baseIdentity(),
            kind: 'text',
            itemId,
            phase: wire.message.stop_reason === 'end_turn' ? 'final' : blocks.some((part: { type?: string }) => part.type === 'tool_use') ? 'progress' : 'body',
            operation: 'replace',
            text: block.text,
          })
        } else if (block.type === 'tool_use') {
          if (block.name === 'AskUserQuestion') {
            this.askUserQuestionToolIds.add(block.id)
          } else {
            this.activeTools.set(block.id, block.name || 'tool')
            this.eventQueue.push({
              ...this.baseIdentity(),
              kind: 'tool',
              itemId: block.id,
              name: block.name || 'tool',
              status: 'running',
              detail: block.input ?? {},
            })
          }
        }
      }
      return
    }

    if (wire.type === 'user' && wire.message?.content) {
      const blocks = Array.isArray(wire.message.content) ? wire.message.content : []
      for (const block of blocks) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          if (this.askUserQuestionToolIds.has(block.tool_use_id)) {
            this.askUserQuestionToolIds.delete(block.tool_use_id)
          } else {
            const name = this.activeTools.get(block.tool_use_id) ?? 'tool'
            this.activeTools.delete(block.tool_use_id)
            this.eventQueue.push({
              ...this.baseIdentity(),
              kind: 'tool',
              itemId: block.tool_use_id,
              name,
              status: block.is_error ? 'failed' : 'completed',
              detail: { content: block.content },
            })
          }
        }
      }
      return
    }

    if (wire.type === 'result') {
      this.pendingQuestions.clear()
      let inTokens = typeof wire.usage?.input_tokens === 'number' ? wire.usage.input_tokens : null
      let outTokens = typeof wire.usage?.output_tokens === 'number' ? wire.usage.output_tokens : null
      let cachedTokens = ((wire.usage?.cache_creation_input_tokens ?? 0) + (wire.usage?.cache_read_input_tokens ?? 0)) || null

      if (wire.modelUsage && typeof wire.modelUsage === 'object') {
        let mIn = 0, mOut = 0, mCached = 0, hasModel = false
        for (const m of Object.values(wire.modelUsage) as any[]) {
          if (m && typeof m === 'object') {
            hasModel = true
            mIn += Number(m.inputTokens ?? 0)
            mOut += Number(m.outputTokens ?? 0)
            mCached += Number(m.cacheCreationInputTokens ?? 0) + Number(m.cacheReadInputTokens ?? 0)
          }
        }
        if (hasModel && (inTokens === null || inTokens === 0)) {
          inTokens = mIn
          outTokens = mOut
          cachedTokens = mCached || null
        }
      }

      if (inTokens !== null || outTokens !== null || cachedTokens !== null) {
        this.eventQueue.push({
          ...this.baseIdentity(),
          kind: 'usage',
          inputTokens: inTokens,
          outputTokens: outTokens,
          cachedInputTokens: cachedTokens,
        })
      }

      if (this.wasInterrupted && (wire.terminal_reason === 'aborted_streaming' || wire.is_error)) {
        this.wasInterrupted = false
        this.eventQueue.push({
          ...this.baseIdentity(),
          kind: 'turn-ended',
          status: 'cancelled',
          failure: null,
        })
      } else if (wire.is_error || wire.terminal_reason === 'aborted_streaming') {
        const isAborted = wire.terminal_reason === 'aborted_streaming'
        const errMsg = typeof wire.result === 'string' && wire.result
          ? wire.result
          : Array.isArray(wire.errors) && wire.errors.length
            ? wire.errors.join('; ')
            : isAborted
              ? 'Claude stream aborted unexpectedly'
              : 'Claude execution error'
        const isLimit = /rate.limit|429/i.test(errMsg)
        const isAuth = /unauth|not logged|authentication|api.key|401/i.test(errMsg)
        this.eventQueue.push({
          ...this.baseIdentity(),
          kind: 'turn-ended',
          status: 'failed',
          failure: {
            category: isLimit ? 'service' : isAuth ? 'capability' : isAborted ? 'transport' : 'protocol',
            message: errMsg.slice(0, 4000),
          },
        })
      } else {
        this.wasInterrupted = false
        this.eventQueue.push({
          ...this.baseIdentity(),
          kind: 'turn-ended',
          status: this.externalSessionId ? 'completed' : 'failed',
          failure: this.externalSessionId ? null : {
            category: 'protocol', message: 'Claude 未返回原生会话身份，无法保存可恢复会话',
          },
        })
      }
      this.eventQueue.close()
      return
    }

    if (wire.type === 'system') {
      if (wire.subtype === 'init' && typeof wire.model === 'string' && wire.model) this.confirmNativeModel(wire.model)
      if (wire.subtype === 'thinking_tokens' && typeof wire.thinking_tokens === 'number') {
        this.eventQueue.push({
          ...this.baseIdentity(),
          kind: 'usage',
          inputTokens: null,
          outputTokens: wire.thinking_tokens,
          cachedInputTokens: null,
        })
      }
      return
    }

    if (wire.type === 'command_lifecycle') {
      return
    }
  }
}
