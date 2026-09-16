import { workspaceIdentityKey } from '../../shared/workspaceIdentity'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { createInterface } from 'node:readline'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isTaskInputRead } from './nativeTaskFiles'
import { nativeProxyEnvironment } from './nativeProxy'
import type { z } from 'zod'
import { measureLocalAgentInput, type LocalAgentInputMetrics } from '../../shared/localAgentInputMetrics'
import type { GenerationRequest } from '../../shared/generationContract'
import {
  localAgentCapabilitiesSchema,
  localAgentConfigurationSchema,
  localAgentProbeSchema,
  type LocalAgentCapabilities,
  type LocalAgentConfiguration,
  type LocalAgentProbe,
} from '../../shared/localAgentContract'
import {
  type LocalAgentCliAdapterV2,
  type LocalAgentNativeEvent,
  type AiUserInput,
  aiInputDeliverySchema,
  type localAgentTurnInputSchema,
} from '../../shared/localAgentTaskContract'
import {
  launchAgent,
  stopAgent,
  captureAgent,
  resolveAgentExecutable,
  agentEnvironment,
  type AgentExecutable,
} from './process'

interface AcpConfigSelectOption {
  value: string
  name?: string
  description?: string
}

interface AcpConfigSelectGroup {
  group: string
  name?: string
  options: AcpConfigSelectOption[]
}

export interface AcpConfigOption {
  id?: string
  name?: string
  category?: string
  type?: string
  currentValue?: string
  options?: Array<AcpConfigSelectOption | AcpConfigSelectGroup>
}

function isSelectConfigOption(value: unknown): value is AcpConfigOption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const type = (value as AcpConfigOption).type
  // Older OpenCode responses omitted type. Unknown future controls are not selects.
  return type === undefined || type === 'select'
}

function readSelectOptions(option?: AcpConfigOption): Array<{ value: string; label: string }> {
  if (!isSelectConfigOption(option) || !Array.isArray(option.options)) return []
  const values: Array<{ value: string; label: string }> = []
  const add = (entry: AcpConfigSelectOption, group?: string) => {
    if (!entry || typeof entry.value !== 'string' || !entry.value.trim()) return
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.value
    values.push({ value: entry.value, label: (group ? `${group}/${name}` : name).slice(0, 300) })
  }
  // ACP v1 SessionConfigSelectOptions permits flat values or one level of groups.
  // Keep the native order and identity; group IDs are never selectable values.
  for (const entry of option.options) {
    if (!entry || typeof entry !== 'object') continue
    if ('group' in entry) {
      if (typeof entry.group !== 'string' || !Array.isArray(entry.options)) continue
      const group = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.group
      for (const value of entry.options) add(value, group)
    } else add(entry)
  }
  return values
}

export function buildOpenCodeCapabilities(cliVersion: string, modelOption?: AcpConfigOption, effortOption?: AcpConfigOption): LocalAgentCapabilities {
  const models: LocalAgentCapabilities['models'] = []
  const seen = new Set<string>()

  for (const opt of readSelectOptions(modelOption)) {
    if (!seen.has(opt.value)) {
      seen.add(opt.value)
      models.push({
        id: opt.value,
        resolvedModel: null,
        label: opt.label,
        image: 'unknown',
        effort: { kind: 'unknown' },
      })
    }
  }

  const currentValue = (isSelectConfigOption(modelOption) && typeof modelOption.currentValue === 'string' && modelOption.currentValue.trim()) || null

  if (currentValue && !seen.has(currentValue)) {
    seen.add(currentValue)
    models.unshift({
      id: currentValue,
      resolvedModel: null,
      label: currentValue,
      image: 'unknown',
      effort: { kind: 'unknown' },
    })
  }

  const currentModel = currentValue && seen.has(currentValue) ? currentValue : null
  const effortValues = [...new Set(readSelectOptions(effortOption).map(option => option.value))]
  const currentEffort = typeof effortOption?.currentValue === 'string' && effortValues.includes(effortOption.currentValue)
    ? effortOption.currentValue : null
  const current = models.find(model => model.id === currentModel)
  // ACP exposes effort for the currently selected model only. The directory
  // for another model is unknown until its own set_config_option response.
  if (current) current.effort = effortOption?.id && isSelectConfigOption(effortOption) && effortValues.length
    ? { kind: 'supported', values: effortValues, default: null }
    : { kind: 'unsupported' }

  return localAgentCapabilitiesSchema.parse({
    version: 1,
    adapter: 'opencode',
    cliVersion: cliVersion || '1.0.0',
    models,
    current: {
      model: currentModel,
      resolvedModel: null,
      effort: current?.effort.kind === 'supported' ? currentEffort : null,
    },
    input: {
      image: 'supported',
      readFile: 'supported',
      question: 'text',
      correction: 'interrupt-resume',
      cancel: 'supported',
    },
  })
}

export async function discoverOpenCodeCapabilities(
  binary: AgentExecutable | string,
  cwd?: string
): Promise<LocalAgentCapabilities> {
  const executable: AgentExecutable = typeof binary === 'string' ? { executable: binary, prefix: [] } : binary
  const workingDir = cwd ?? process.cwd()
  const adapter = new OpenCodeAcpAdapter(async () => executable)
  try {
    return (await adapter.open({ cwd: workingDir, externalSessionId: null })).capabilities
  } finally { await adapter.close() }
}

export class OpenCodeAcpAdapter implements LocalAgentCliAdapterV2 {
  readonly id = 'opencode' as const
  private child?: ChildProcessWithoutNullStreams
  private cwd = ''
  private candidateRoot?: string
  private sessionId: string | null = null
  private capabilities?: LocalAgentCapabilities
  private cliVersion = '1.0.0'
  private nextRequestId = 0
  private readonly pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private readonly eventQueue: LocalAgentNativeEvent[] = []
  private readonly toolNames = new Map<string, string>()
  private eventWaiters: Array<() => void> = []
  private turnCompleted = false
  private currentTurnInput?: z.infer<typeof localAgentTurnInputSchema>
  private readonly pendingPermissions = new Map<string, { id: number | string; turnId: string; options: Map<string, string> }>()
  private readonly terminals = new Map<string, {
    child: ChildProcessWithoutNullStreams; output: string; truncated: boolean; limit: number;
    exitStatus?: { exitCode: number | null; signal: string | null }; exited: Promise<{ exitCode: number | null; signal: string | null }>;
  }>()
  private closed = false
  private activePromptRequestId: number | null = null
  private totalBytes = 0
  private textBytes = 0
  private loadingSessionId: string | null = null
  private linesReader?: ReturnType<typeof createInterface>
  private modelConfigId: string | null = null
  private modelOption?: AcpConfigOption
  private effortOption?: AcpConfigOption
  private configurationFailure?: Error
  private lifecycle = 0
  private closing?: Promise<void>
  private cancelling?: Promise<void>
  private cancelRequested = false
  private turnEndedPromise: Promise<void> = Promise.resolve()
  private resolveTurnEnded?: () => void
  private stderr = ''

  constructor(
    private readonly resolve: typeof resolveAgentExecutable = resolveAgentExecutable,
    _generationRequest?: GenerationRequest,
    private readonly timeouts: { rpcTimeoutMs?: number; cancelTimeoutMs?: number } = {},
  ) {}

  getExternalSessionId(): string | null { return this.sessionId }

  private readConfiguration(configOptions: unknown, fallbackModel?: AcpConfigOption, fallbackEffort?: AcpConfigOption): LocalAgentCapabilities {
    const options = Array.isArray(configOptions) ? configOptions.filter(isSelectConfigOption) : []
    this.modelOption = options.find(option => option && (option.id === this.modelConfigId || option.id === 'model' || option.category === 'model')) ?? fallbackModel
    this.effortOption = options.find(option => option && (option.id === 'effort' || option.category === 'thought_level')) ?? fallbackEffort
    this.modelConfigId = typeof this.modelOption?.id === 'string' ? this.modelOption.id : null
    this.capabilities = buildOpenCodeCapabilities(this.cliVersion, this.modelOption, this.effortOption)
    return this.capabilities
  }

  async probe(): Promise<LocalAgentProbe> {
    const result = (status: LocalAgentProbe['status'], message: string, version?: string) =>
      localAgentProbeSchema.parse({ adapter: 'opencode', status, message, version })
    try {
      const binary = await this.resolve('opencode')
      if (!binary) return result('missing', '请自行安装 CLI')
      const info = await captureAgent(binary, ['--version'], process.cwd())
      const version = info.text.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
      const major = Number(version?.split('.')[0])
      if (info.code !== 0 || !version || major !== 1) {
        return result('unsupported-version', 'CLI 版本不在当前协议范围内', version)
      }
      return result('unknown-auth', '已安装；认证状态在运行时由 CLI 报告', version)
    } catch {
      return result('launch', 'CLI 探测失败，请检查本地安装')
    }
  }

  async open(input: { cwd: string; externalSessionId: string | null; candidateRoot?: string }): Promise<{ externalSessionId: string; capabilities: LocalAgentCapabilities }> {
    if (this.child) await this.close()
    if (this.closing) await this.closing
    this.closing = undefined
    this.cancelling = undefined
    const lifecycle = ++this.lifecycle
    this.closed = false
    this.cancelRequested = false
    this.currentTurnInput = undefined
    this.activePromptRequestId = null
    this.sessionId = null
    this.modelConfigId = null
    this.modelOption = undefined
    this.effortOption = undefined
    this.capabilities = undefined
    this.configurationFailure = undefined
    this.eventQueue.length = 0
    this.toolNames.clear()
    this.totalBytes = 0; this.textBytes = 0
    this.loadingSessionId = null
    this.stderr = ''
    const binary = await this.resolve('opencode')
    if (lifecycle !== this.lifecycle || this.closed) throw new Error('interrupted')
    if (!binary) throw new Error('missing')
    this.cwd = input.cwd
    this.candidateRoot = input.candidateRoot

    try {
      const proxy = await nativeProxyEnvironment('opencode')
      if (lifecycle !== this.lifecycle || this.closed) throw new Error('interrupted')
      this.child = launchAgent(binary, ['acp'], this.cwd, this.candidateRoot, proxy)
    } catch {
      throw new Error('launch')
    }

    this.startReadingStdout(this.child)

    try {
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: 'courseware-editor', version: '1.8' },
      })

      if (initResult?.protocolVersion !== 1) throw new Error('unsupported-version')
      if (input.externalSessionId && !initResult?.agentCapabilities?.loadSession) throw new Error('unsupported-version')
      this.cliVersion = initResult?.agentInfo?.version ?? '1.0.0'

      let sessionResult: any
      if (input.externalSessionId) {
        this.loadingSessionId = input.externalSessionId
        try {
          sessionResult = await this.sendRequest('session/load', {
            sessionId: input.externalSessionId,
            cwd: this.cwd,
            mcpServers: [],
          })
        } finally { this.loadingSessionId = null }
        if (sessionResult?.sessionId && sessionResult.sessionId !== input.externalSessionId) throw new Error('protocol: OpenCode resumed another session')
        // ACP load returns configOptions, without requiring sessionId. Its
        // successful response to this exact request confirms the requested ID.
        this.sessionId = input.externalSessionId
      } else {
        sessionResult = await this.sendRequest('session/new', {
          cwd: this.cwd,
          mcpServers: [],
        })
        if (typeof sessionResult?.sessionId !== 'string' || !sessionResult.sessionId) throw new Error('protocol')
        this.sessionId = sessionResult.sessionId
      }

      if (!this.sessionId) throw new Error('protocol')
      this.readConfiguration(sessionResult?.configOptions)

      return {
        externalSessionId: this.sessionId,
        capabilities: this.capabilities!,
      }
    } catch (error) {
      await this.shutdown(error instanceof Error ? error : new Error(String(error))).catch(() => {})
      throw error
    }
  }

  async configure(input: LocalAgentConfiguration): Promise<LocalAgentCapabilities> {
    if (!this.sessionId || !this.child || this.closed) throw new Error('Session not active')
    if (this.currentTurnInput && !this.turnCompleted) throw new Error('OpenCode configuration requires a turn boundary')
    const config = localAgentConfigurationSchema.parse(input)

    try {
      if (this.capabilities) {
        const exists = this.capabilities.models.some(m => m.id === config.model)
        if (!exists) {
          throw new Error(`模型 ${config.model} 不在 OpenCode 原生目录中`)
        }
      }
      if (!this.modelConfigId) throw new Error('OpenCode 未暴露原生模型配置入口')
      const previousModel = this.modelOption
      const result = await this.sendRequest('session/set_config_option', {
        sessionId: this.sessionId,
        configId: this.modelConfigId,
        value: config.model,
      })

      const configOptions = Array.isArray(result?.configOptions) ? result.configOptions.filter(isSelectConfigOption) : []
      const modelOption = configOptions.find((opt: AcpConfigOption) => opt.id === this.modelConfigId || opt.id === 'model' || opt.category === 'model')
      const actualValue = modelOption?.currentValue ?? result?.currentValue ?? result?.value
      if (actualValue !== config.model) {
        throw new Error(`配置 OpenCode 模型失败：预期 ${config.model}，实际返回 ${String(actualValue)}`)
      }

      this.readConfiguration(configOptions, modelOption ?? {
        id: previousModel?.id,
        category: 'model',
        currentValue: config.model,
        options: previousModel?.options ?? [{ value: config.model }],
      })
      if (config.effort !== null) {
        const model = this.capabilities!.models.find(value => value.id === config.model)
        const effortOption = this.effortOption
        if (!effortOption?.id || model?.effort.kind !== 'supported') throw new Error('OpenCode 当前模型的原生配置未暴露强度选项')
        if (!model.effort.values.includes(config.effort)) throw new Error(`强度 ${config.effort} 不在 OpenCode 当前模型的原生目录中`)
        const effortResult = await this.sendRequest('session/set_config_option', {
          sessionId: this.sessionId, configId: effortOption.id, value: config.effort,
        })
        const effortOptions: AcpConfigOption[] = Array.isArray(effortResult?.configOptions) ? effortResult.configOptions.filter(isSelectConfigOption) : []
        const confirmedEffort = effortOptions.find(option => option.id === effortOption.id || option.category === 'thought_level')
        const actualEffort = confirmedEffort?.currentValue ?? effortResult?.currentValue ?? effortResult?.value
        this.readConfiguration(effortOptions, this.modelOption,
          confirmedEffort ?? { ...effortOption, currentValue: typeof actualEffort === 'string' ? actualEffort : undefined })
        if (this.capabilities!.current.model !== config.model || actualEffort !== config.effort || this.capabilities!.current.effort !== config.effort) {
          throw new Error(`配置 OpenCode 强度失败：预期 ${config.model}/${config.effort}，实际返回 ${this.capabilities!.current.model}/${String(actualEffort)}`)
        }
      }
      this.configurationFailure = undefined
      return this.capabilities!
    } catch (error) {
      this.configurationFailure = error instanceof Error ? error : new Error(String(error))
      throw error
    }
  }

  async startTurn(
    turnInput: z.infer<typeof localAgentTurnInputSchema>,
    observationFiles: ReadonlyMap<string, string>
  ): Promise<{ nativeTurnId: string | null; inputMetrics: LocalAgentInputMetrics }> {
    if (!this.sessionId || !this.child || this.closed) throw new Error('Session not active')
    if (this.configurationFailure) throw this.configurationFailure
    if (this.currentTurnInput && !this.turnCompleted) throw new Error('OpenCode turn is already running')

    this.currentTurnInput = turnInput
    this.totalBytes = 0; this.textBytes = 0
    this.turnCompleted = false
    this.turnEndedPromise = new Promise(resolve => { this.resolveTurnEnded = resolve })
    this.cancelling = undefined
    this.cancelRequested = false
    this.eventQueue.length = 0
    this.toolNames.clear()
    this.pendingPermissions.clear()

    const promptContent: Array<{ type: string; text?: string; mimeType?: string; data?: string }> = [
      { type: 'text', text: turnInput.text },
    ]

    for (const imageId of turnInput.imageFileIds) {
      const filePath = observationFiles.get(imageId)
      if (!filePath) throw new Error(`OpenCode 图片不在当前观察中：${imageId}`)
      try {
        const data = await fs.readFile(filePath)
        const ext = path.extname(filePath).toLowerCase()
        const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp'
          : ext === '.gif' ? 'image/gif'
          : 'image/png'
        promptContent.push({ type: 'image', mimeType, data: data.toString('base64') })
      } catch { throw new Error(`OpenCode 无法读取当前观察图片：${imageId}`) }
    }

    if (this.closed) throw new Error('interrupted')
    const reqId = ++this.nextRequestId
    this.activePromptRequestId = reqId
    if (this.capabilities) this.pushEvent({ kind: 'configuration', capabilities: this.capabilities })
    const params = {
      sessionId: this.sessionId,
      prompt: promptContent,
    }
    const inputMetrics = measureLocalAgentInput({
      boundary: 'native-turn-params', prompt: turnInput.text, transport: params,
      technicalTransport: { ...params, prompt: promptContent.filter(item => item.type !== 'image') },
    })
    this.send('session/prompt', params, reqId)

    return { nativeTurnId: String(reqId), inputMetrics }
  }

  async input(userInput: AiUserInput): Promise<z.infer<typeof aiInputDeliverySchema>> {
    if (!this.currentTurnInput || userInput.taskId !== this.currentTurnInput.taskId || userInput.epoch !== this.currentTurnInput.epoch
      || workspaceIdentityKey(userInput.workspace) !== workspaceIdentityKey(this.currentTurnInput.workspace)) {
      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: 'rejected',
        turnId: userInput.turnId ?? null,
        reason: '任务或 Epoch 不匹配',
      })
    }

    if (!this.sessionId || !this.child || this.closed) {
      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: 'rejected',
        turnId: userInput.turnId ?? null,
        reason: 'OpenCode 会话未激活',
      })
    }

    if (userInput.kind === 'stop') {
      await this.cancel()
      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: 'accepted',
        turnId: userInput.turnId ?? null,
        reason: null,
      })
    }

    if (userInput.kind === 'answer') {
      const pending = this.pendingPermissions.get(userInput.questionId)
      const selected = userInput.answers.find(answer => answer.id === userInput.questionId)?.values
      const optionId = selected?.length === 1 ? pending?.options.get(selected[0]!) : undefined
      const valid = pending && !this.turnCompleted && (!userInput.turnId || userInput.turnId === pending.turnId) && optionId
      if (valid) {
        this.pendingPermissions.delete(userInput.questionId)
        this.sendResult(pending.id, { outcome: { outcome: 'selected', optionId } })
      }
      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: valid ? 'accepted' : 'rejected',
        turnId: userInput.turnId ?? (this.activePromptRequestId === null ? null : String(this.activePromptRequestId)),
        reason: valid ? null : '未找到当前回合的原生授权请求或选项无效',
        questionId: userInput.questionId,
      })
    }

    if (userInput.kind === 'correct' || userInput.kind === 'supplement') {
      return aiInputDeliverySchema.parse({
        taskId: userInput.taskId,
        epoch: userInput.epoch,
        workspace: userInput.workspace,
        inputId: userInput.inputId,
        status: userInput.turnId && userInput.turnId !== String(this.activePromptRequestId) ? 'rejected' : 'queued',
        turnId: userInput.turnId ?? (this.activePromptRequestId === null ? null : String(this.activePromptRequestId)),
        reason: userInput.turnId && userInput.turnId !== String(this.activePromptRequestId) ? '指定的回合已不是当前活动回合'
          : userInput.kind === 'correct' ? '正在中断当前回合，将在同一原生会话立即处理新的引导' : '已排队，将在当前回合结束后处理补充',
      })
    }

    const fallback = userInput as any
    return aiInputDeliverySchema.parse({
      taskId: fallback.taskId,
      epoch: fallback.epoch,
      workspace: fallback.workspace,
      inputId: fallback.inputId,
      status: 'rejected',
      turnId: fallback.turnId ?? null,
      reason: '不支持的输入类型',
    })
  }

  async cancel(): Promise<void> {
    if (this.cancelling) return this.cancelling
    this.cancelRequested = true
    this.cancelling = this.cancelCurrentTurn()
    return this.cancelling
  }

  async interruptTurn(): Promise<void> {
    await this.cancel()
    if (this.closed) throw new Error('OpenCode 未确认回合中断；已停止传输，新的引导仍待处理')
  }

  private async cancelCurrentTurn(): Promise<void> {
    this.cancelPendingPermissions()
    await this.releaseTerminals()
    if (!this.currentTurnInput || !this.activePromptRequestId || !this.sessionId || this.closed) return this.close()
    if (this.turnCompleted) return
    this.sendNotification('session/cancel', { sessionId: this.sessionId })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const ended = await Promise.race([this.turnEndedPromise.then(() => true), new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(false), this.timeouts.cancelTimeoutMs ?? 1500)
      })])
      if (!ended) await this.close()
    } finally { clearTimeout(timer) }
  }

  async *events(): AsyncIterable<LocalAgentNativeEvent> {
    while (true) {
      if (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!
        yield event
        if (event.kind === 'turn-ended') {
          return
        }
        continue
      }
      if (this.closed || this.turnCompleted) {
        return
      }
      await new Promise<void>(resolve => {
        this.eventWaiters.push(resolve)
      })
    }
  }

  async close(): Promise<void> {
    ++this.lifecycle
    this.cancelRequested = true
    return this.shutdown(new Error('OpenCode session closed'))
  }

  private shutdown(error: Error, category: 'transport' | 'service' | 'protocol' | 'limit' | 'capability' | 'storage' = 'transport'): Promise<void> {
    this.cancelPendingPermissions()
    this.closed = true
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingRequests.clear()
    this.toolNames.clear()
    if (this.currentTurnInput && !this.turnCompleted) this.pushEvent({ kind: 'turn-ended',
      status: this.cancelRequested ? 'cancelled' : 'failed',
      failure: this.cancelRequested ? null : { category, message: error.message.slice(0, 4000) } })
    this.activePromptRequestId = null
    this.resolveTurnEnded?.()
    const waiters = this.eventWaiters
    this.eventWaiters = []
    for (const waiter of waiters) waiter()
    if (this.closing) return this.closing
    if (this.linesReader) {
      try { this.linesReader.close() } catch { /* ignore */ }
      this.linesReader = undefined
    }
    const child = this.child
    this.child = undefined
    this.closing = Promise.all([child ? stopAgent(child) : Promise.resolve(), this.releaseTerminals()]).then(() => {})
    return this.closing
  }

  private sendRequest(method: string, params: unknown): Promise<any> {
    if (!this.child || this.closed) throw new Error('Child process not running')
    const id = ++this.nextRequestId
    // Opening or loading a native workspace may initialize its configured tools
    // and providers. It shares the startup budget, rather than the short budget
    // for an already-open session's configuration RPC.
    const startup = method === 'initialize' || method === 'session/new' || method === 'session/load'
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void this.shutdown(new Error(`OpenCode ${method} timeout`)).catch(() => {}) }, this.timeouts.rpcTimeoutMs ?? (startup ? 30000 : 10000))
      this.pendingRequests.set(id, { resolve, reject, timer })
      try { this.child!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') }
      catch (error) { void this.shutdown(error instanceof Error ? error : new Error(String(error))).catch(() => {}) }
    })
  }

  private send(method: string, params: unknown, id: number): void {
    if (!this.child) return
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.child) return
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  private sendResult(id: number | string, result: unknown): void {
    if (!this.child) return
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
  }

  private sendError(id: number | string, code: number, message: string): void {
    if (!this.child) return
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
  }

  private pushEvent(payload: any): void {
    if (!this.currentTurnInput || this.turnCompleted) return
    const event: LocalAgentNativeEvent = {
      taskId: this.currentTurnInput.taskId,
      epoch: this.currentTurnInput.epoch,
      workspace: this.currentTurnInput.workspace,
      runId: this.currentTurnInput.runId,
      nativeTurnId: this.activePromptRequestId ? String(this.activePromptRequestId) : this.currentTurnInput.runId,
      ...payload,
    }
    this.eventQueue.push(event)
    if (event.kind === 'turn-ended') {
      this.turnCompleted = true
      this.cancelPendingPermissions()
      this.resolveTurnEnded?.()
    }
    const waiters = this.eventWaiters
    this.eventWaiters = []
    for (const waiter of waiters) waiter()
  }

  private handleFatalError(category: 'transport' | 'service' | 'protocol' | 'limit' | 'capability' | 'storage', message: string): void {
    void this.shutdown(new Error(message), category).catch(() => {})
  }

  private cancelPendingPermissions(): void {
    for (const pending of this.pendingPermissions.values()) this.sendResult(pending.id, { outcome: { outcome: 'cancelled' } })
    this.pendingPermissions.clear()
  }

  private async releaseTerminals(): Promise<void> {
    const terminals = [...this.terminals.values()]
    this.terminals.clear()
    await Promise.all(terminals.map(terminal => stopAgent(terminal.child)))
  }

  private async handleClientRequest(wire: any): Promise<void> {
    const child = this.child
    const params = wire.params
    const active = () => !this.closed && !this.cancelRequested && this.child === child && params?.sessionId === this.sessionId
    const reply = (result: unknown) => { if (active()) this.sendResult(wire.id, result) }
    const fail = (code: number, message: string) => { if (this.child === child && !this.closed) this.sendError(wire.id, code, message) }
    if (!active() || !this.currentTurnInput || this.turnCompleted) {
      fail(-32602, 'Request does not belong to the active OpenCode session and turn')
      return
    }
    try {
      if (wire.method === 'session/request_permission') {
        const once = (Array.isArray(params.options) ? params.options : []).find((option: any) => option.kind === 'allow_once' && typeof option.optionId === 'string')
        if (once && await isTaskInputRead(params.toolCall ?? {}, this.candidateRoot)) {
          // Only this native read request is fulfilled; no Always allow policy is installed.
          reply({ outcome: { outcome: 'selected', optionId: once.optionId } })
          return
        }
        const options = new Map<string, string>()
        for (const option of Array.isArray(params.options) ? params.options : []) {
          if (typeof option?.optionId !== 'string' || !option.optionId || !['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(option.kind)) continue
          const label = String(option.name || option.optionId).slice(0, 1000)
          options.set(options.has(label) ? `${label.slice(0, 800)} (${option.optionId})` : label, option.optionId)
        }
        if (!options.size || options.size > 20) throw new Error('No supported native permission options')
        const questionId = `opencode-permission-${wire.id}`
        const turnId = String(this.activePromptRequestId)
        this.pendingPermissions.set(questionId, { id: wire.id, turnId, options })
        const tool = params.toolCall ?? {}
        const detail = [tool.title, tool.rawInput ? JSON.stringify(tool.rawInput) : null,
          ...(Array.isArray(tool.locations) ? tool.locations.map((location: any) => location.path) : [])].filter(Boolean).join('\n')
        this.pushEvent({ kind: 'question', question: {
          taskId: this.currentTurnInput.taskId, epoch: this.currentTurnInput.epoch, workspace: this.currentTurnInput.workspace,
          questionId, turnId, purpose: 'permission', questions: [{ id: questionId,
            title: (detail || 'OpenCode 请求执行此操作').slice(0, 1000), options: [...options.keys()], multiple: false }],
        } })
        return
      }
      if (wire.method === 'fs/read_text_file') {
        if (typeof params.path !== 'string' || !path.isAbsolute(params.path)) throw new Error('File path must be absolute')
        if (params.line !== undefined && (!Number.isInteger(params.line) || params.line < 1)) throw new Error('line must be a positive integer')
        if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1)) throw new Error('limit must be a positive integer')
        const stat = await fs.stat(params.path)
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('File is not a readable text file or exceeds limit')
        const content = await fs.readFile(params.path, 'utf8')
        const start = params.line === undefined ? 0 : params.line - 1
        const lines = params.line !== undefined || params.limit !== undefined ? content.match(/[^\n]*\n|[^\n]+$/g) ?? [] : null
        reply({ content: lines ? lines.slice(start, params.limit === undefined ? undefined : start + params.limit).join('') : content })
        return
      }
      if (wire.method === 'fs/write_text_file') {
        if (typeof params.path !== 'string' || !path.isAbsolute(params.path) || typeof params.content !== 'string') throw new Error('File path and text content are required')
        if (Buffer.byteLength(params.content) > 8 * 1024 * 1024) throw new Error('Text file exceeds output limit')
        // ACP exposes the native tool's operation after OpenCode has applied its
        // own permissions. Host candidate ingestion has a separate root check.
        if (!active() || this.turnCompleted || this.cancelRequested) throw new Error('Turn has ended')
        await fs.mkdir(path.dirname(params.path), { recursive: true })
        if (!active() || this.turnCompleted || this.cancelRequested) throw new Error('Turn has ended')
        await fs.writeFile(params.path, params.content, 'utf8')
        reply({})
        return
      }
      if (wire.method === 'terminal/create') {
        if (typeof params.command !== 'string' || !params.command || params.command.includes('\0')) throw new Error('Terminal command is required')
        if (params.args !== undefined && (!Array.isArray(params.args) || params.args.some((arg: unknown) => typeof arg !== 'string'))) throw new Error('Terminal args must be strings')
        if (params.cwd !== undefined && (typeof params.cwd !== 'string' || !path.isAbsolute(params.cwd))) throw new Error('Terminal cwd must be absolute')
        if (params.outputByteLimit !== undefined && (!Number.isInteger(params.outputByteLimit) || params.outputByteLimit < 1)) throw new Error('Terminal output limit must be positive')
        const environment = agentEnvironment(process.env, this.candidateRoot)
        for (const entry of params.env ?? []) {
          if (typeof entry?.name !== 'string' || !entry.name || entry.name.includes('=') || typeof entry.value !== 'string') throw new Error('Invalid terminal environment')
          if (process.platform === 'win32' && entry.name.toLowerCase() === 'courseware_candidate_root') {
            for (const key of Object.keys(environment)) if (key.toLowerCase() === 'courseware_candidate_root') delete environment[key]
          }
          environment[entry.name] = entry.value
        }
        const terminalId = randomUUID()
        const terminalChild = spawn(params.command, params.args ?? [], { cwd: params.cwd ?? this.cwd, env: environment,
          shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
        let resolveExit!: (status: { exitCode: number | null; signal: string | null }) => void
        const terminal: (typeof this.terminals extends Map<string, infer T> ? T : never) = {
          child: terminalChild, output: '', truncated: false, limit: Math.min(params.outputByteLimit ?? 1024 * 1024, 8 * 1024 * 1024),
          exited: new Promise(resolve => { resolveExit = resolve }),
        }
        const append = (value: string) => {
          const bytes = Buffer.from(terminal.output + value, 'utf8')
          let start = Math.max(0, bytes.byteLength - terminal.limit)
          terminal.truncated ||= start > 0
          while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++
          terminal.output = bytes.subarray(start).toString('utf8')
        }
        const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8')
        terminalChild.stdout.on('data', (chunk: Buffer) => append(outDecoder.write(chunk)))
        terminalChild.stderr.on('data', (chunk: Buffer) => append(errDecoder.write(chunk)))
        terminalChild.once('error', error => {
          append(error.message)
          terminal.exitStatus = { exitCode: null, signal: null }
          resolveExit(terminal.exitStatus)
        })
        terminalChild.once('close', (exitCode, signal) => {
          append(outDecoder.end() + errDecoder.end())
          terminal.exitStatus = { exitCode, signal }
          resolveExit(terminal.exitStatus)
        })
        terminalChild.stdin.on('error', () => {})
        terminalChild.stdin.end()
        this.terminals.set(terminalId, terminal)
        reply({ terminalId })
        return
      }
      if (typeof wire.method === 'string' && wire.method.startsWith('terminal/')) {
        const terminal = this.terminals.get(params.terminalId)
        if (!terminal) throw new Error('Terminal does not belong to the current session or was released')
        if (wire.method === 'terminal/output') reply({ output: terminal.output, truncated: terminal.truncated, ...(terminal.exitStatus ? { exitStatus: terminal.exitStatus } : {}) })
        else if (wire.method === 'terminal/wait_for_exit') reply(await terminal.exited)
        else if (wire.method === 'terminal/kill' || wire.method === 'terminal/release') {
          await stopAgent(terminal.child)
          if (wire.method === 'terminal/release') this.terminals.delete(params.terminalId)
          reply({})
        } else fail(-32601, 'Unknown ACP terminal method')
        return
      }
      fail(-32601, 'Client capability not available')
    } catch (error) {
      fail(-32602, error instanceof Error ? error.message.slice(0, 1000) : 'Native client request failed')
    }
  }

  private startReadingStdout(child: ChildProcessWithoutNullStreams): void {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.linesReader = lines
    child.stderr.on('data', (data: Buffer) => {
      if (this.child === child) this.stderr = (this.stderr + data.toString('utf8')).slice(-4000)
    })
    child.stdin.on('error', error => {
      if (this.child === child) this.handleFatalError('transport', error.message)
    })

    child.once('error', error => {
      if (this.child === child) this.handleFatalError('transport', error.message)
    })
    child.once('close', code => {
      if (this.child === child) this.handleFatalError('transport', this.stderr.trim() || `OpenCode 进程异常退出 (code: ${code})`)
    })

    ;(async () => {
      try {
        for await (const line of lines) {
          if (this.closed || this.child !== child) break
          const lineBytes = Buffer.byteLength(line)
          if (lineBytes > 32 * 1024 * 1024) throw new Error(`output-limit: OpenCode message ${lineBytes} bytes exceeds 32 MiB`)
          const trimmed = line.trim()
          if (!trimmed) continue
          let wire: any
          try {
            wire = JSON.parse(trimmed)
          } catch {
            this.handleFatalError('protocol', 'Malformed JSON-RPC message')
            continue
          }
          // ACP replays the native history while loading. It is already owned
          // by that session, not new model output; do not enqueue or charge it
          // against the next turn. RPC requests/responses and other traffic
          // retain the aggregate limit, and every replay line retains its cap.
          if (this.loadingSessionId && wire?.method === 'session/update'
            && !Object.prototype.hasOwnProperty.call(wire, 'id')
            && wire.params?.sessionId === this.loadingSessionId) continue
          this.totalBytes += lineBytes
          // Tool snapshots, patches and resource metadata are protocol traffic,
          // not visible model text. Do not terminate a valid native tool loop at
          // the old 1 MiB frame / 8 MiB mixed-traffic limit.
          const update = wire?.params?.update
          if (update?.sessionUpdate === 'agent_message_chunk' || update?.sessionUpdate === 'agent_thought_chunk') this.textBytes += Buffer.byteLength(update.content?.text ?? '')
          if (this.textBytes > 8 * 1024 * 1024) throw new Error(`output-limit: OpenCode text ${this.textBytes} bytes exceeds 8 MiB`)
          if (this.totalBytes > 128 * 1024 * 1024) throw new Error(`output-limit: OpenCode turn traffic ${this.totalBytes} bytes exceeds 128 MiB`)
          // Terminal waits and filesystem IO must not block cancellation or RPC responses.
          void this.handleWireMessage(wire).catch(error => this.handleFatalError('protocol', error instanceof Error ? error.message : String(error)))
        }
      } catch (err: any) {
        if (!this.closed && this.child === child) {
          const category = err.message.startsWith('output-limit') ? 'limit' : 'protocol'
          this.handleFatalError(category, err.message)
        }
      }
    })()
  }

  private toolName(itemId: string, update: { kind?: unknown; title?: unknown }): string {
    const existing = this.toolNames.get(itemId)
    if (existing) return existing
    // ACP updates may replace the title with an entire file path and omit kind.
    // Keep a stable bounded label; the complete native title remains in detail.
    const name = (typeof update.kind === 'string' && update.kind.trim())
      || (typeof update.title === 'string' && update.title.trim()) || 'tool'
    const bounded = name.slice(0, 200)
    this.toolNames.set(itemId, bounded)
    return bounded
  }

  private async handleWireMessage(wire: any): Promise<void> {
    if (wire.method === 'session/update') {
      if (wire.params?.sessionId === this.sessionId && wire.params?.update) {
        const update = wire.params.update
        const updateType = update.sessionUpdate
        if (updateType === 'config_option_update') {
          this.readConfiguration(update.configOptions)
          this.pushEvent({ kind: 'configuration', capabilities: this.capabilities })
        } else if (updateType === 'agent_message_chunk' && update.content?.type === 'text') {
          const text = typeof update.content.text === 'string' ? update.content.text : ''
          const itemId = typeof update.messageId === 'string' ? update.messageId : 'acp-message'
          this.pushEvent({
            kind: 'text',
            itemId,
            phase: 'body',
            operation: 'append',
            text,
          })
        } else if (updateType === 'tool_call') {
          const itemId = typeof update.toolCallId === 'string' ? update.toolCallId : 'tool'
          const name = this.toolName(itemId, update)
          this.pushEvent({
            kind: 'tool',
            itemId,
            name,
            status: 'running',
            detail: update,
          })
        } else if (updateType === 'tool_call_update') {
          const itemId = typeof update.toolCallId === 'string' ? update.toolCallId : 'tool'
          const name = this.toolName(itemId, update)
          const status = update.status === 'completed' ? 'completed'
            : update.status === 'failed' ? 'failed'
            : update.status === 'in_progress' ? 'running'
            : null
          if (status && status !== 'running') {
            this.pushEvent({
              kind: 'tool',
              itemId,
              name,
              status,
              detail: update,
            })
            this.toolNames.delete(itemId)
          }
        } else if (updateType === 'usage_update' && update.usage) {
          this.pushEvent({
            kind: 'usage',
            inputTokens: typeof update.usage.inputTokens === 'number' ? update.usage.inputTokens : null,
            outputTokens: typeof update.usage.outputTokens === 'number' ? update.usage.outputTokens : null,
            cachedInputTokens: typeof update.usage.cachedReadTokens === 'number' ? update.usage.cachedReadTokens : null,
          })
        } else if (updateType === 'plan') {
          const planText = typeof update.text === 'string' ? update.text : Array.isArray(update.entries)
            ? update.entries.flatMap((entry: { content?: unknown; status?: unknown }) => typeof entry.content === 'string'
              ? [`${entry.status === 'completed' ? '已完成' : entry.status === 'in_progress' ? '正在进行' : '待处理'}：${entry.content}`] : []).join('\n') : ''
          if (!planText) return
          this.pushEvent({
            kind: 'text',
            itemId: typeof update.messageId === 'string' ? update.messageId : 'acp-plan',
            phase: 'plan',
            operation: 'replace',
            text: planText,
          })
        }
      }
      return
    }

    if (wire.method && wire.id !== undefined) {
      await this.handleClientRequest(wire)
      return
    }
    if (wire.id !== undefined) {
      const pending = this.pendingRequests.get(wire.id)
      if (pending) {
        this.pendingRequests.delete(wire.id)
        clearTimeout(pending.timer)
        if (wire.error) {
          pending.reject(new Error(wire.error.message || 'JSON-RPC error'))
        } else {
          pending.resolve(wire.result)
        }
      }

      if (wire.id === this.activePromptRequestId) {
        if (this.cancelRequested) {
          this.pushEvent({ kind: 'turn-ended', status: 'cancelled', failure: null })
        } else if (wire.error) {
          this.pushEvent({
            kind: 'turn-ended',
            status: 'failed',
            failure: { category: 'service', message: wire.error.message || 'Prompt failed' },
          })
        } else {
          if (wire.result?.usage) {
            const usage = wire.result.usage
            this.pushEvent({
              kind: 'usage',
              inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : null,
              outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : null,
              cachedInputTokens: typeof usage.cachedReadTokens === 'number' ? usage.cachedReadTokens : null,
            })
          }
          const stopReason = wire.result?.stopReason
          if (stopReason === 'end_turn' || stopReason === 'stop' || stopReason === 'complete') {
            this.pushEvent({
              kind: 'turn-ended',
              status: 'completed',
              failure: null,
            })
          } else if (stopReason === 'cancelled') {
            this.pushEvent({
              kind: 'turn-ended',
              status: 'cancelled',
              failure: null,
            })
          } else {
            this.pushEvent({
              kind: 'turn-ended',
              status: 'failed',
              failure: { category: 'protocol', message: `CLI 本轮未完成：${String(stopReason)}` },
            })
          }
        }
        this.activePromptRequestId = null
      }
    }
  }
}
