import { randomUUID } from 'node:crypto'
import { localAgentEventSchema, localAgentFailureSchema, type LocalAgentCliAdapterV1, type LocalAgentId, type LocalAgentRecord } from '../../shared/localAgentContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../shared/workspaceIdentity'
import { LocalAgentAdapter } from './adapter'
import { decodeAgentEvent, type AgentEventData } from './protocol'
import { LocalAgentRepository } from './repository'

interface ActiveRun { record: LocalAgentRecord; adapter: LocalAgentCliAdapterV1; done: Promise<void> }
export class LocalAgentHarness {
  private readonly active = new Map<string, ActiveRun>()
  private pendingLaunches = 0
  private readonly launches = new Set<Promise<void>>()
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
      if (record.status === 'running' && !this.active.has(record.id)) {
        this.append(record, { kind: 'failed', failure: 'interrupted', payload: { message: '应用已中断，可恢复已有外部会话' } })
        await this.repository.write(record)
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
    await this.launch(record, prompt, prior.externalSessionId)
    return record.id
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
  private launch(record: LocalAgentRecord, prompt: string, externalId?: string): Promise<void> {
    if (this.closing) return Promise.reject(new Error('会话服务正在关闭'))
    const pending = this.prepareLaunch(record, prompt, externalId)
    this.launches.add(pending)
    return pending.finally(() => { this.launches.delete(pending) })
  }
  private async prepareLaunch(record: LocalAgentRecord, prompt: string, externalId?: string): Promise<void> {
    if (this.active.size + this.pendingLaunches >= 3) throw new Error('最多同时运行三个 CLI 会话')
    this.pendingLaunches++
    try {
      const adapter = this.factory(record.adapter)
      const cwd = await this.repository.staging(record.workspace, record.workingDirectoryId ?? record.id)
      await this.repository.write(record)
      const run: ActiveRun = { record, adapter, done: Promise.resolve() }
      this.active.set(record.id, run)
      run.done = this.consume(run, prompt, cwd, externalId)
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
      this.append(record, { kind: 'failed', failure: category.success ? category.data : 'protocol', payload: { message: 'CLI 运行未完成，请检查安装、认证或事件协议' } })
    } finally {
      try { await adapter.cancel() } catch { /* Terminal failure stays observable even if the child already exited. */ }
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
