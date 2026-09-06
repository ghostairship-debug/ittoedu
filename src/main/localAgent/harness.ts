import { randomUUID } from 'node:crypto'
import { localAgentEventSchema, localAgentFailureSchema, localAgentHostResultSchema, type LocalAgentHostResult, type LocalAgentCliAdapterV1, type LocalAgentId, type LocalAgentRecord } from '../../shared/localAgentContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../shared/workspaceIdentity'
import { LocalAgentAdapter } from './adapter'
import { decodeAgentEvent, type AgentEventData } from './protocol'
import { LocalAgentRepository } from './repository'
import { generationRequestSchema, MAX_GENERATION_PROMPT_BYTES, type GenerationRequest } from '../../shared/generationContract'
import { GENERATION_OPEN, GENERATION_CLOSE, parseGenerationText } from '../../shared/generationResult'
import { CandidateStaging } from './candidateStaging'
import { createGenerationProfile } from './profile'

interface ActiveRun { record: LocalAgentRecord; adapter: LocalAgentCliAdapterV1; done: Promise<void> }
export class LocalAgentHarness {
  private readonly active = new Map<string, ActiveRun>()
  private pendingLaunches = 0
  private readonly launches = new Set<Promise<void>>()
  private readonly launching = new Set<string>()
  private closing = false
  private readonly storageFailures = new Map<string, { workspace: string; record: LocalAgentRecord }>()
  get running(): boolean { return this.active.size > 0 || this.pendingLaunches > 0 }
  constructor(readonly repository: LocalAgentRepository, private readonly factory: (id: LocalAgentId) => LocalAgentCliAdapterV1 = id => new LocalAgentAdapter(id)) {}
  probe(id: LocalAgentId) { return this.factory(id).probe() }
  async list(workspace: WorkspaceIdentityV1) {
    const result = await this.repository.list(workspace)
    const owner = workspaceIdentityKey(workspace)
    for (const [id, failed] of this.storageFailures) if (failed.workspace === owner) {
      result.records = result.records.filter(record => record.id !== id)
      result.records.push(failed.record)
      result.damaged.push(`会话 ${id} 未能写入本地存储；当前结果仅保留在本次应用进程中`)
    }
    for (const record of result.records) {
      if (record.status === 'running' && !this.active.has(record.id) && !this.launching.has(record.id)) {
        this.append(record, { kind: 'failed', failure: 'interrupted', payload: { message: '应用已中断，可恢复已有外部会话' } })
        await this.repository.write(record)
      }
      if (record.generationRequestId && record.status !== 'running' && !this.active.has(record.id)) {
        try {
          await new CandidateStaging(this.repository.stagingPath(workspace, record.workingDirectoryId ?? record.id)).remove(record.generationRequestId)
          if (record.cleanupIssue) { delete record.cleanupIssue; await this.repository.write(record) }
        } catch { result.damaged.push(`会话 ${record.id} 的候选暂存清理失败，可重试删除`) }
      }
    }
    return result
  }
  async start(workspace: WorkspaceIdentityV1, adapter: LocalAgentId, prompt: string): Promise<string> {
    const record: LocalAgentRecord = { version: 1, id: randomUUID(), workspace, adapter, status: 'running', events: [] }
    await this.launch(record, prompt)
    return record.id
  }
  async resume(workspace: WorkspaceIdentityV1, id: string, prompt: string): Promise<string> {
    if (this.active.has(id)) throw new Error('会话正在运行')
    const prior = (await this.list(workspace)).records.find(record => record.id === id)
    if (!prior?.externalSessionId) throw new Error('会话不存在或没有可恢复的外部身份')
    // A new local run has its own irreversible terminal state; external conversation stays the same.
    const record: LocalAgentRecord = { ...prior, id: randomUUID(), workingDirectoryId: prior.workingDirectoryId ?? prior.id, status: 'running', events: [] }
    delete record.generationRequestId
    delete record.generationRequest
    delete record.hostResult
    delete record.cleanupIssue
    await this.launch(record, prompt, prior.externalSessionId)
    return record.id
  }
  async generate(workspace: WorkspaceIdentityV1, adapter: LocalAgentId, raw: GenerationRequest, resumeSessionId?: string): Promise<string> {
    const request = generationRequestSchema.parse(raw)
    if (workspaceIdentityKey(workspace) !== workspaceIdentityKey(request.workspace)) throw new Error('生成请求不属于当前工程位置')
    const records = (await this.list(workspace)).records
    if (records.some(record => record.generationRequestId === request.requestId)) throw new Error('每轮生成必须使用新的请求身份')
    const prior = resumeSessionId ? records.find(record => record.id === resumeSessionId) : undefined
    if (resumeSessionId && (!prior?.externalSessionId || prior.adapter !== adapter || this.active.has(resumeSessionId))) throw new Error('生成会话不可恢复或 adapter 不一致')
    const record: LocalAgentRecord = { version: 1, id: randomUUID(), workspace, adapter, status: 'running', events: [],
      generationRequestId: request.requestId, generationRequest: request, ...(prior ? { workingDirectoryId: prior.workingDirectoryId ?? prior.id } : {}) }
    const prompt = [
      '你是课件创作助手。根据下面本轮请求的最小快照完成任务；CLI 自己规划。不要读取或修改真实课件工程、Store 或其他会话。',
      '本轮结果通道为结构化文本；不要写结果文件。普通讨论可以直接回答文字。需要修改课件时只输出一个候选块：',
      `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request.requestId, candidateId: randomUUID(), summary: '变更摘要', steps: [{ id: 's1', tool: 'native.content', carrier: 'native', destination: request.destinations[0], input: { operation: 'insert', template: { nativeType: 'text', text: '请按实际任务编写内容' } } }] })}${GENERATION_CLOSE}`,
      '上例只说明 envelope 格式；必须根据实际任务、destination 类型和 context.tools 的 JSON Schema 选择输入。create 用于插入，update 用于修改。不得直接照抄示例文字或给 update 目标发 insert。JSON Schema $defs/$ref 是同一工具中的定义引用。',
      '步骤仅使用提供的正式工具输入；不得输出整个工程或通用 JSON patch。Native 之外的载体要带 lowerCarrierReason。前序创建对象可以用 destination={kind:"created-item",stepId:"s1",index:0} 引用。候选由软件预览、校验并一次应用，CLI 工具调用不等于工程已提交。',
      'input 中需要前序新建素材或组件包的 ID 时，使用 {"$result":{"stepId":"前序步骤ID","kind":"asset-id 或 package-id 或 item-id 或 location-id","index":0}} 对象替代该字段值，宿主会从真实回执替换后再校验工具输入。禁止猜测新 ID。新页内插入内容可用 destination={kind:"created-scope",stepId:"创建页步骤ID",parent:{kind:"owner"},insertion:{kind:"append"}}，Flow 正文的 parent 为 {kind:"flow-body",parentBlockId:null}。',
      JSON.stringify(createGenerationProfile(adapter, request)),
      JSON.stringify(request),
    ].join('\n')
    if (Buffer.byteLength(prompt) > MAX_GENERATION_PROMPT_BYTES) throw new Error('请求上下文超过 CLI 发送预算，请缩小引用范围')
    await this.launch(record, prompt, prior?.externalSessionId, request)
    return record.id
  }
  async candidate(workspace: WorkspaceIdentityV1, id: string) {
    const record = (await this.list(workspace)).records.find(value => value.id === id)
    if (!record?.generationRequestId) throw new Error('当前工程没有此生成请求')
    if (record.status !== 'completed' || this.active.has(id)) throw new Error('生成运行尚未成功结束')
    const text = record.events.filter(event => event.kind === 'text').map(event => {
      const payload = event.payload
      return payload !== null && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.text === 'string' ? payload.text : ''
    }).join('\n')
    return parseGenerationText(text, record.generationRequestId)
  }
  async hostResult(workspace: WorkspaceIdentityV1, id: string, raw: LocalAgentHostResult) {
    const result = localAgentHostResultSchema.parse(raw)
    const record = (await this.list(workspace)).records.find(value => value.id === id)
    if (!record || record.status === 'running' || record.generationRequestId !== result.requestId) throw new Error('宿主结果不属于已结束的当前请求')
    record.hostResult = result
    await this.repository.write(record)
  }
  private append(record: LocalAgentRecord, input: AgentEventData): void {
    if (record.status !== 'running') return
    if (input.externalSessionId) {
      if (record.externalSessionId && record.externalSessionId !== input.externalSessionId) throw new Error('protocol')
      record.externalSessionId = input.externalSessionId
    }
    const event = localAgentEventSchema.parse({ ...input, version: 1, adapter: record.adapter, sessionId: record.id,
      externalSessionId: record.externalSessionId, sequence: record.events.length + 1, time: Date.now() })
    record.events.push(event)
    if (event.kind === 'completed' || event.kind === 'failed' || event.kind === 'cancelled') record.status = event.kind
  }
  private launch(record: LocalAgentRecord, prompt: string, externalId?: string, request?: GenerationRequest): Promise<void> {
    if (this.closing) return Promise.reject(new Error('会话服务正在关闭'))
    this.launching.add(record.id)
    const pending = this.prepareLaunch(record, prompt, externalId, request)
    this.launches.add(pending)
    return pending.finally(() => { this.launches.delete(pending); this.launching.delete(record.id) })
  }
  private async prepareLaunch(record: LocalAgentRecord, prompt: string, externalId?: string, request?: GenerationRequest): Promise<void> {
    if (this.active.size + this.pendingLaunches >= 3) throw new Error('最多同时运行三个 CLI 会话')
    this.pendingLaunches++
    let cwd: string | undefined
    try {
      const adapter = this.factory(record.adapter)
      cwd = await this.repository.staging(record.workspace, record.workingDirectoryId ?? record.id)
      if (request) await new CandidateStaging(cwd).create(request)
      await this.repository.write(record)
      const run: ActiveRun = { record, adapter, done: Promise.resolve() }
      this.active.set(record.id, run)
      run.done = this.consume(run, prompt, cwd, externalId)
    } catch (error) {
      if (request && cwd) await new CandidateStaging(cwd).remove(request.requestId)
      throw error
    } finally { this.pendingLaunches-- }
  }
  private async consume(run: ActiveRun, prompt: string, cwd: string, externalId?: string): Promise<void> {
    const { record, adapter } = run
    const tools = new Set<string>()
    let completed = false
    let lastFlush = Date.now()
    try {
      const stream = externalId ? adapter.resume(externalId, prompt, cwd) : adapter.start(prompt, cwd)
      for await (const wire of stream) {
        if (record.status !== 'running') break
        if (record.events.length >= 19990) throw new Error('output-limit')
        for (const data of decodeAgentEvent(record.adapter, wire)) {
          if (data.kind === 'completed') { if (completed) throw new Error('protocol'); completed = true; continue }
          if (completed) throw new Error('protocol')
          if (data.kind === 'tool-call' || data.kind === 'tool-result') {
            const id = (data.payload as { id: string }).id
            if (data.kind === 'tool-call') { if (tools.has(id)) throw new Error('protocol'); tools.add(id) }
            else { if (!tools.delete(id)) throw new Error('protocol') }
          }
          this.append(record, data)
        }
        if (record.events.length % 32 === 0 || Date.now() - lastFlush >= 250 || record.status !== 'running') {
          await this.repository.write(record); lastFlush = Date.now()
        }
        if (record.status !== 'running') break
      }
      if (record.status === 'running') {
        if (tools.size || !completed || !record.externalSessionId) throw new Error('protocol')
        this.append(record, { kind: 'completed', payload: {} })
      }
    } catch (error) {
      const category = localAgentFailureSchema.safeParse(error instanceof Error ? error.message : '')
      this.append(record, { kind: 'failed', failure: category.success ? category.data : 'protocol', payload: {
        message: 'CLI 运行未完成，请检查安装、认证或事件协议', detail: error instanceof Error ? error.message.slice(0, 1000) : 'unknown',
      } })
    } finally {
      try { await adapter.cancel() } catch { /* Terminal failure stays observable even if the child already exited. */ }
      if (record.generationRequestId) {
        try { await new CandidateStaging(cwd).remove(record.generationRequestId) }
        catch { record.cleanupIssue = '候选暂存清理失败，可重试删除' }
      }
      try { await this.repository.write(record) } catch {
        this.storageFailures.set(record.id, { workspace: workspaceIdentityKey(record.workspace), record: structuredClone(record) })
      }
      this.active.delete(record.id)
    }
  }
  async cancel(workspace: WorkspaceIdentityV1, id: string): Promise<void> {
    const run = this.active.get(id)
    if (!run || workspaceIdentityKey(run.record.workspace) !== workspaceIdentityKey(workspace)) throw new Error('当前工程没有此运行会话')
    this.append(run.record, { kind: 'cancelled', payload: {} })
    await run.adapter.cancel()
    await run.done
  }
  async delete(workspace: WorkspaceIdentityV1, id?: string): Promise<void> {
    for (const run of this.active.values()) if (workspaceIdentityKey(run.record.workspace) === workspaceIdentityKey(workspace) && (!id || run.record.id === id)) await this.cancel(workspace, run.record.id)
    await this.repository.delete(workspace, id)
    for (const [failedId, failed] of this.storageFailures) if (failed.workspace === workspaceIdentityKey(workspace) && (!id || id === failedId)) this.storageFailures.delete(failedId)
  }
  async close(): Promise<void> {
    this.closing = true
    await Promise.allSettled([...this.launches])
    await Promise.all([...this.active.values()].map(run => this.cancel(run.record.workspace, run.record.id)))
  }
}
