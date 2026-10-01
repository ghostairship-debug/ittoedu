import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { waitForHostWork } from '../../../shared/workbench/jobWait'
import type { ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import { CodexDelegationRunner, type CodexDelegationRequest, type DelegationEvent,
  type CodexDelegationResult } from './CodexDelegationRunner'
import { WindowsCodexSandboxBoundary } from './WindowsCodexSandboxBoundary'

export interface DelegationJobInput {
  runId: string
  jobId: string
  taskId: string
  goal: string
  /** Existing, explicitly approved copy beneath the service's copyRootBase. */
  copyRoot: string
  permission: ExecutionPermissionMode
  materials?: readonly string[]
  expectedArtifacts: readonly string[]
  timeoutMs?: number
  /** Ephemeral inbound MCP grant. The bearer and revoke function are never persisted. */
  mcp?: CodexDelegationRequest['mcp']
}
export type ManagedDelegationInput = Omit<DelegationJobInput, 'copyRoot' | 'materials' | 'mcp'> & {
  /** Frozen workspace root from the parent run; only these named regular files enter the managed copy. */
  workspaceRoot: string
  materials?: readonly string[]
}

export interface DelegationJobArtifact {
  name: string
  digest: string
  byteLength: number
}
export interface DelegationJobSnapshot {
  runId: string
  jobId: string
  requestDigest: string
  status: 'preparing' | 'running' | 'ready' | 'failed' | 'cancelled' | 'unknown' | 'unconfigured'
  terminal: boolean
  stopped: boolean
  createdAt: string
  updatedAt: string
  configuredModel: 'gpt-6-luna'
  configuredSpeed: 'priority'
  account?: 'ChatGPT'
  cliVersion?: string
  threadId?: string
  exitCode?: number | null
  artifacts: readonly DelegationJobArtifact[]
  summary?: string
  reason?: string
  /** The CLI does not report a monetary charge through this runner. */
  billedAmount: null
}
export interface DelegationJobLog { entries: readonly { cursor: number; time: number; kind: DelegationEvent['kind'] | 'system'; message: string }[]; nextCursor: number }
type Stored = DelegationJobSnapshot & { version: 1; copyRoot: string; expectedArtifacts: readonly string[];
  logs: DelegationJobLog['entries']; nextLogCursor: number }
type Active = { runId: string; controller: AbortController; work: Promise<void> }

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const terminal = (status: Stored['status']) => !['preparing', 'running'].includes(status)
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function artifactName(name: string): string {
  if (!name || name.length > 256 || path.isAbsolute(name) || /[\0\\<>:"|?*]/.test(name)
    || name.split('/').some(part => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ')
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))
    throw new Error('委派成果路径必须是工作副本内的普通相对路径')
  return name
}
export class DelegationJobError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'DelegationJobError' }
}

/** Durable parent-owned receipt. A ready artifact is still only a candidate until the parent reviews it. */
export class DelegationJobService {
  private readonly directory: string
  private readonly copyRootBase: string
  private readonly runner: Pick<CodexDelegationRunner, 'run'>
  private readonly now: () => Date
  private readonly active = new Map<string, Active>()
  private readonly tails = new Map<string, Promise<unknown>>()

  constructor(options: { directory: string; copyRootBase: string; runner?: Pick<CodexDelegationRunner, 'run'>; now?: () => Date }) {
    if (!path.isAbsolute(options.directory) || !path.isAbsolute(options.copyRootBase)) throw new Error('委派作业目录和副本授权根必须为绝对路径')
    this.directory = path.resolve(options.directory)
    this.copyRootBase = path.resolve(options.copyRootBase)
    this.runner = options.runner ?? new CodexDelegationRunner({ boundary: new WindowsCodexSandboxBoundary() })
    this.now = options.now ?? (() => new Date())
  }

  private folder(jobId: string): string {
    if (typeof jobId !== 'string' || !jobId || jobId.length > 512) throw new DelegationJobError('invalid-job', '委派作业身份无效')
    return path.join(this.directory, digest(jobId))
  }
  private stateFile(jobId: string): string { return path.join(this.folder(jobId), 'state.json') }
  private serial<T>(jobId: string, action: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(jobId) ?? Promise.resolve()
    const work = prior.catch(() => undefined).then(action)
    const tail = work.catch(() => undefined)
    this.tails.set(jobId, tail)
    void tail.finally(() => { if (this.tails.get(jobId) === tail) this.tails.delete(jobId) })
    return work
  }
  private async save(job: Stored): Promise<void> {
    const filename = this.stateFile(job.jobId), temporary = `${filename}.${randomUUID()}.tmp`
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    try {
      const file = await fs.open(temporary, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(job)); await file.sync() } finally { await file.close() }
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  private async load(jobId: string): Promise<Stored | null> {
    let raw: string
    try { raw = await fs.readFile(this.stateFile(jobId), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    try {
      const job = JSON.parse(raw) as Stored
      if (job.version !== 1 || job.jobId !== jobId || !job.runId || !job.requestDigest || !path.isAbsolute(job.copyRoot)
        || !Array.isArray(job.expectedArtifacts) || !Array.isArray(job.artifacts) || !Array.isArray(job.logs)
        || !Number.isSafeInteger(job.nextLogCursor) || job.nextLogCursor < 0
        || !['preparing', 'running', 'ready', 'failed', 'cancelled', 'unknown', 'unconfigured'].includes(job.status)) throw new Error()
      return job
    } catch { throw new DelegationJobError('job-corrupt', '委派作业记录损坏，未重新启动外部执行器') }
  }
  private expose(job: Stored): DelegationJobSnapshot {
    const { version: _version, copyRoot: _copyRoot, expectedArtifacts: _expected,
      logs: _logs, nextLogCursor: _nextCursor, ...view } = job
    return structuredClone(view)
  }
  private async update(jobId: string, mutate: (job: Stored) => void): Promise<Stored> {
    return this.serial(jobId, async () => {
      const job = await this.load(jobId)
      if (!job) throw new DelegationJobError('unknown-job', '委派作业不存在')
      mutate(job); job.updatedAt = this.now().toISOString(); job.terminal = terminal(job.status)
      await this.save(job); return job
    })
  }
  private async scopedCopy(copyRoot: string): Promise<string> {
    if (!path.isAbsolute(copyRoot)) throw new DelegationJobError('copy-root', '委派工作副本必须使用绝对路径')
    await fs.mkdir(this.copyRootBase, { recursive: true })
    const base = await fs.realpath(this.copyRootBase)
    const copy = await fs.realpath(copyRoot)
    if (base === copy || !inside(base, copy) || !(await fs.stat(copy)).isDirectory())
      throw new DelegationJobError('copy-root', '委派工作副本不在已批准的副本授权根内')
    return copy
  }

  /** Creates an isolated, bounded copy without letting the model choose a host write root. */
  async startManaged(input: ManagedDelegationInput): Promise<DelegationJobSnapshot> {
    const materials = (input.materials ?? []).map(artifactName)
    if (new Set(materials).size !== materials.length)
      throw new DelegationJobError('invalid-materials', '委派资料过多或重名')
    if (!path.isAbsolute(input.workspaceRoot)) throw new DelegationJobError('workspace-root', '委派工作空间根无效')
    const workspaceRoot = await fs.realpath(input.workspaceRoot)
    if (!(await fs.stat(workspaceRoot)).isDirectory()) throw new DelegationJobError('workspace-root', '委派工作空间根不是文件夹')
    await fs.mkdir(this.copyRootBase, { recursive: true, mode: 0o700 })
    const base = await fs.realpath(this.copyRootBase)
    const copyRoot = path.join(base, digest(JSON.stringify([input.runId, input.jobId])))
    let created = false
    try { await fs.mkdir(copyRoot, { mode: 0o700 }); created = true }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    if (!created && !await this.load(input.jobId))
      throw new DelegationJobError('copy-unknown', '委派副本已存在但未见作业回执，未重复启动外部执行器')
    if (created) {
      try {
        let total = 0
        for (const name of materials) {
          const source = await fs.realpath(path.join(workspaceRoot, ...name.split('/')))
          if (!inside(workspaceRoot, source)) throw new DelegationJobError('material-outside', '委派资料超出冻结工作空间')
          const before = await fs.stat(source)
          if (!before.isFile() || before.size > 256 * 1024 * 1024 || total + before.size > 256 * 1024 * 1024)
            throw new DelegationJobError('material-invalid', '委派资料类型或总量超出范围')
          const bytes = await fs.readFile(source)
          const after = await fs.stat(source)
          if (bytes.byteLength !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
            throw new DelegationJobError('material-changed', '委派资料复制期间改变')
          const destination = path.join(copyRoot, ...name.split('/'))
          await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
          await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
          total += bytes.byteLength
        }
      } catch (error) {
        if (inside(base, copyRoot) && copyRoot !== base) await fs.rm(copyRoot, { recursive: true, force: true })
        throw error
      }
    }
    const { workspaceRoot: _workspaceRoot, ...rest } = input
    return this.start({ ...rest, materials, copyRoot })
  }

  async start(input: DelegationJobInput): Promise<DelegationJobSnapshot> {
    try { return await this.startOwned(input) }
    catch (error) { await input.mcp?.revoke().catch(() => undefined); throw error }
  }
  private async startOwned(input: DelegationJobInput): Promise<DelegationJobSnapshot> {
    if (!input.runId || !input.taskId?.trim() || !input.goal?.trim() || input.goal.length > 100_000
      || !['workspace', 'full', 'read-only'].includes(input.permission) || !Array.isArray(input.expectedArtifacts)
      || input.expectedArtifacts.length < 1)
      throw new DelegationJobError('invalid-input', '委派目标、权限或声明成果无效')
    const expectedArtifacts = input.expectedArtifacts.map(artifactName)
    if (new Set(expectedArtifacts).size !== expectedArtifacts.length) throw new DelegationJobError('invalid-input', '委派声明成果重名')
    const copyRoot = await this.scopedCopy(input.copyRoot)
    const requestDigest = digest(JSON.stringify({ runId: input.runId, taskId: input.taskId, goal: input.goal,
      copyRoot, permission: input.permission, materials: input.materials ?? [], expectedArtifacts,
      timeoutMs: input.timeoutMs ?? 15 * 60_000, mcpEndpoint: input.mcp?.endpoint ?? null }))
    return this.serial(input.jobId, async () => {
      const prior = await this.load(input.jobId)
      if (prior) {
        if (prior.runId !== input.runId || prior.requestDigest !== requestDigest)
          throw new DelegationJobError('job-conflict', '委派作业身份已绑定另一请求')
        await input.mcp?.revoke().catch(() => undefined)
        if (!this.active.has(input.jobId) && !terminal(prior.status)) {
          prior.status = 'unknown'; prior.terminal = true
          prior.reason = '外部执行器在上次宿主运行后失去受管进程身份；副本变化待核对，未自动重放。'
          prior.updatedAt = this.now().toISOString(); await this.save(prior)
        }
        return this.expose(prior)
      }
      const jobRoot = this.folder(input.jobId)
      try { await fs.access(jobRoot); throw new DelegationJobError('job-create-unknown', '委派作业目录存在但没有完整回执，未重复启动执行器') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const time = this.now().toISOString()
      const job: Stored = { version: 1, runId: input.runId, jobId: input.jobId, requestDigest,
        status: 'preparing', terminal: false, stopped: false, createdAt: time, updatedAt: time,
        configuredModel: 'gpt-6-luna', configuredSpeed: 'priority', billedAmount: null,
        copyRoot, expectedArtifacts, artifacts: [], logs: [], nextLogCursor: 0 }
      await this.save(job)
      const active: Active = { runId: input.runId, controller: new AbortController(), work: Promise.resolve() }
      this.active.set(input.jobId, active)
      active.work = this.execute(input.jobId, input, copyRoot, active).finally(() => {
        if (this.active.get(input.jobId) === active) this.active.delete(input.jobId)
      })
      void active.work.catch(() => undefined)
      return this.expose(job)
    })
  }

  private async snapshotArtifact(jobId: string, copyRoot: string, name: string): Promise<DelegationJobArtifact> {
    const source = await fs.realpath(path.join(copyRoot, ...name.split('/')))
    if (!inside(copyRoot, source)) throw new DelegationJobError('artifact-outside', '委派成果离开批准副本')
    const stat = await fs.stat(source)
    if (!stat.isFile() || !stat.size || stat.size > 256 * 1024 * 1024) throw new DelegationJobError('artifact-invalid', '委派成果为空、类型无效或过大')
    const bytes = await fs.readFile(source)
    if (bytes.byteLength !== stat.size) throw new DelegationJobError('artifact-changed', '委派成果读取期间发生变化')
    const output = path.join(this.folder(jobId), 'artifacts', digest(name))
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
    await fs.writeFile(output, bytes, { flag: 'wx', mode: 0o600 })
    return { name, digest: digest(bytes), byteLength: bytes.byteLength }
  }

  private async execute(jobId: string, input: DelegationJobInput, copyRoot: string, active: Active): Promise<void> {
    let result: CodexDelegationResult | undefined
    try {
      await this.update(jobId, job => { if (!job.stopped) job.status = 'running' })
      result = await this.runner.run({ taskId: input.taskId, goal: input.goal, copyRoot,
        permission: input.permission, materials: input.materials, expectedArtifacts: input.expectedArtifacts,
        timeoutMs: input.timeoutMs, mcp: input.mcp }, {
        signal: active.controller.signal,
        onEvent: event => { void this.update(jobId, job => {
          job.logs = [...job.logs, { cursor: ++job.nextLogCursor, time: Date.now(), kind: event.kind,
            message: event.detail.slice(0, 1000) }].slice(-200)
        }).catch(() => undefined) },
        verify: async ({ artifacts }) => ({ accepted: artifacts.length === input.expectedArtifacts.length
          && artifacts.every(artifact => artifact.bytes > 0 && artifact.bytes <= 256 * 1024 * 1024),
        detail: '声明成果已在批准副本内回读；等待父任务审阅和正式交付。' }),
      })
      const artifacts: DelegationJobArtifact[] = []
      if (result.status === 'verified' && !active.controller.signal.aborted) {
        for (const name of input.expectedArtifacts) {
          artifacts.push(await this.snapshotArtifact(jobId, copyRoot, name))
          if (artifacts.reduce((total, artifact) => total + artifact.byteLength, 0) > 256 * 1024 * 1024)
            throw new DelegationJobError('artifact-limit', '委派成果总量超过 256 MiB')
        }
      }
      await this.update(jobId, job => {
        job.account = result!.account; job.cliVersion = result!.cliVersion; job.threadId = result!.threadId
        job.exitCode = result!.exitCode; job.summary = result!.summary?.slice(0, 8000)
        job.reason = result!.reason.slice(0, 1000); job.artifacts = artifacts
        if (result!.diagnostic) job.logs = [...job.logs, { cursor: ++job.nextLogCursor,
          time: Date.now(), kind: 'system' as const, message: result!.diagnostic.slice(0, 2000) }].slice(-200)
        job.status = job.stopped || active.controller.signal.aborted
          ? result!.status === 'cancelled' ? 'cancelled' : 'unknown'
          : result!.status === 'verified' ? 'ready' : result!.status
      })
    } catch (error) {
      await this.update(jobId, job => {
        job.status = active.controller.signal.aborted ? 'unknown' : 'failed'
        job.reason = error instanceof Error ? error.message.slice(0, 1000) : '委派作业失败'
        job.logs = [...job.logs, { cursor: ++job.nextLogCursor, time: Date.now(), kind: 'system' as const, message: job.reason }].slice(-200)
      }).catch(() => undefined)
      if (!result) await input.mcp?.revoke().catch(() => undefined)
    }
  }

  async status(runId: string, jobId: string): Promise<DelegationJobSnapshot> {
    const job = await this.serial(jobId, async () => {
      const value = await this.load(jobId)
      if (!value) throw new DelegationJobError('unknown-job', '委派作业不存在')
      if (value.runId !== runId) throw new DelegationJobError('job-not-authorized', '委派作业不属于当前运行')
      if (!this.active.has(jobId) && !terminal(value.status)) {
        value.status = 'unknown'; value.terminal = true; value.updatedAt = this.now().toISOString()
        value.reason = '宿主重启后外部执行结果未知；未自动重试或应用副本变化。'
        await this.save(value)
      }
      return value
    })
    return this.expose(job)
  }
  async wait(runId: string, jobId: string, milliseconds: number, signal?: AbortSignal): Promise<DelegationJobSnapshot> {
    const current = await this.status(runId, jobId)
    if (current.terminal) return current
    await waitForHostWork(this.active.get(jobId)?.work, milliseconds, signal)
    return this.status(runId, jobId)
  }
  async logs(runId: string, jobId: string, after = 0, limit = 100): Promise<DelegationJobLog> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new DelegationJobError('invalid-page', '委派日志分页无效')
    await this.status(runId, jobId)
    const job = await this.load(jobId)
    if (!job) throw new DelegationJobError('unknown-job', '委派作业不存在')
    const entries = job.logs.filter(entry => entry.cursor > after).slice(0, limit)
    return { entries, nextCursor: entries.at(-1)?.cursor ?? after }
  }
  async cancel(runId: string, jobId: string): Promise<DelegationJobSnapshot> {
    const current = await this.status(runId, jobId)
    if (current.terminal) return current
    const active = this.active.get(jobId)
    await this.update(jobId, job => { job.stopped = true; job.status = 'unknown'; job.reason = '正在撤销委派；外部进程和副作用待核对。' })
    active?.controller.abort()
    await waitForHostWork(active?.work, 5000)
    return this.status(runId, jobId)
  }
  /** Called after the parent Gateway has revoked its canonical write authority. */
  async cancelRun(runId: string): Promise<void> {
    await Promise.allSettled([...this.active.entries()].filter(([, value]) => value.runId === runId)
      .map(([jobId]) => this.cancel(runId, jobId)))
  }
  async readArtifact(runId: string, jobId: string, name: string): Promise<{ artifact: DelegationJobArtifact; bytes: Uint8Array }> {
    const job = await this.status(runId, jobId), safe = artifactName(name)
    if (job.status !== 'ready' || job.stopped) throw new DelegationJobError('artifact-not-ready', '委派成果尚未完成或已停止')
    const artifact = job.artifacts.find(value => value.name === safe)
    if (!artifact) throw new DelegationJobError('unknown-artifact', '成果未在委派请求中声明')
    const bytes = await fs.readFile(path.join(this.folder(jobId), 'artifacts', digest(safe)))
    if (digest(bytes) !== artifact.digest || bytes.byteLength !== artifact.byteLength)
      throw new DelegationJobError('artifact-changed', '委派成果封存副本已变化，未交付')
    return { artifact, bytes }
  }
}
