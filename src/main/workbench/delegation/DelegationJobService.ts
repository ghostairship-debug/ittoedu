import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { waitForHostWork } from '../../../shared/workbench/jobWait'
import type { ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import { CodexDelegationRunner, type DelegationEvent, type DelegationExecutionResult } from './CodexDelegationRunner'
import { WindowsCodexSandboxBoundary } from './WindowsCodexSandboxBoundary'
import { LocalToolRunner, type PreparedLocalCommand } from './LocalToolRunner'
import type { ReadonlyTaskRunner } from './ReadonlyTaskRunner'
import type { NativeTaskRunner, NativeTaskRequest } from './NativeTaskRunner'
import type { LocalToolRunIntent, LocalToolRunPreview, ReadonlyDelegationIntent, NativeDelegationIntent, PreparedTaskSource } from '../../../shared/workbench/toolPorts'
import { documentDigest } from '../../../core/documents/documentDigest'
import { delegationArtifactClosure } from './delegationArtifactClosure'
import { taskTargetDeclaration } from '../../../shared/workbench/taskTargetContext'

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
}
export interface TaskSourcePreparation {
  /** Already frozen bytes remain supported for callers which own no asynchronous source work. */
  sources?: readonly PreparedTaskSource[]
  /** Invoked only after the existing job receipt and cancellation controller are registered. */
  prepareSources?(signal: AbortSignal): Promise<readonly PreparedTaskSource[]>
}
export type ManagedDelegationInput = Omit<DelegationJobInput, 'copyRoot' | 'materials'> & TaskSourcePreparation & {
  /** Frozen workspace root from the parent run; only these named regular files enter the managed copy. */
  workspaceRoot: string
  materials?: readonly string[]
  sourceVersion?: 'current' | 'disk'
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
  executionKind?: 'codex' | 'local' | 'readonly' | 'native'
  configuredModel?: string
  configuredSpeed?: string
  account?: string
  actualModel?: string
  connectionId?: string
  usage?: DelegationExecutionResult['usage']
  requestId?: string
  candidateComplete?: boolean
  childRunId?: string
  goal?: string
  target?: NativeDelegationIntent['target']
  targetContext?: unknown
  role?: string
  /** Explicit task continuation; the current run still owns this new job. */
  resumedFrom?: { runId: string; jobId: string; childRunId: string }
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
  logs: DelegationJobLog['entries']; nextLogCursor: number; nativeIntent?: NativeDelegationIntent }
type Active = { runId: string; kind: NonNullable<DelegationJobSnapshot['executionKind']>; controller: AbortController; work: Promise<void> }
type TaskIdentity = { runId: string; jobId: string; taskId: string }
type LocalPlan = TaskIdentity & { intentDigest: string; command: PreparedLocalCommand; sources: readonly PreparedTaskSource[];
  intent: LocalToolRunIntent; preview: LocalToolRunPreview; authorized: boolean }
type LocalPreparation = TaskIdentity & { intentDigest: string; preview: Promise<LocalToolRunPreview>; start(): void }
type TaskPreparation = (signal: AbortSignal) => Promise<string>
type TaskExecution = (active: Active, onEvent: (event: DelegationEvent) => void, copyRoot: string) => Promise<DelegationExecutionResult>

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const terminal = (status: Stored['status']) => !['preparing', 'running'].includes(status)
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function artifactName(name: string): string {
  if (!name || path.isAbsolute(name) || /[\0\\<>:"|?*]/.test(name)
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
  private readonly localPlans = new Map<string, LocalPlan>()
  private readonly localPreparations = new Map<string, LocalPreparation>()
  private readonly stoppedRuns = new Set<string>()
  private readonly userResumePreparations = new Map<string, { text: string; work: Promise<DelegationJobSnapshot> }>()
  private readonly localRunner: LocalToolRunner
  private readonly readonlyRunner?: ReadonlyTaskRunner
  private readonly nativeRunner?: Pick<NativeTaskRunner, 'run' | 'message' | 'available'> & Partial<Pick<NativeTaskRunner, 'related' | 'userMessage'>>
  private readonly maxConcurrentNativePerRun: number

  constructor(options: { directory: string; copyRootBase: string; runner?: Pick<CodexDelegationRunner, 'run'>;
    localRunner?: LocalToolRunner; readonlyRunner?: ReadonlyTaskRunner;
    nativeRunner?: Pick<NativeTaskRunner, 'run' | 'message' | 'available'> & Partial<Pick<NativeTaskRunner, 'related' | 'userMessage'>>; now?: () => Date;
    maxConcurrentNativePerRun?: number }) {
    if (!path.isAbsolute(options.directory) || !path.isAbsolute(options.copyRootBase)) throw new Error('委派作业目录和副本授权根必须为绝对路径')
    this.directory = path.resolve(options.directory)
    this.copyRootBase = path.resolve(options.copyRootBase)
    this.runner = options.runner ?? new CodexDelegationRunner({ boundary: new WindowsCodexSandboxBoundary() })
    this.now = options.now ?? (() => new Date())
    this.localRunner = options.localRunner ?? new LocalToolRunner()
    this.readonlyRunner = options.readonlyRunner
    this.nativeRunner = options.nativeRunner
    const limit = options.maxConcurrentNativePerRun ?? 2
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error('原生子任务并发上限必须为 1–32 的整数')
    this.maxConcurrentNativePerRun = limit
  }

  private folder(jobId: string): string {
    if (typeof jobId !== 'string' || !jobId) throw new DelegationJobError('invalid-job', '委派作业身份无效')
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
      logs: _logs, nextLogCursor: _nextCursor, nativeIntent: _intent, ...view } = job
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

  private assertRunning(runId: string): void {
    if (this.stoppedRuns.has(runId)) throw new DelegationJobError('run-stopped', '父任务已停止')
  }
  private plannedCopy(input: TaskIdentity, cwd?: string): string {
    const root = path.join(this.copyRootBase, digest(JSON.stringify([input.runId, input.jobId])))
    return !cwd || cwd === '.' ? root : path.join(root, ...artifactName(cwd.replaceAll('\\', '/')).split('/'))
  }
  private frozenSources(sources: readonly PreparedTaskSource[]): readonly PreparedTaskSource[] {
    const result = sources.map(({ bytes, ...source }) => ({ ...structuredClone(source), name: artifactName(source.name), bytes: new Uint8Array(bytes) }))
    if (new Set(result.map(source => source.name)).size !== result.length) throw new DelegationJobError('invalid-materials', '任务输入文件重名')
    return result
  }
  private sourcePreparation(input: TaskSourcePreparation): (signal: AbortSignal) => Promise<readonly PreparedTaskSource[]> {
    if (input.sources !== undefined && input.prepareSources)
      throw new DelegationJobError('invalid-materials', '任务来源只能由一份冻结输入或一个准备回调提供')
    // Preserve the original eager API's ownership: caller mutation after start is harmless.
    const frozen = input.sources === undefined ? undefined : this.frozenSources(input.sources)
    const prepare = input.prepareSources
    return async signal => {
      signal.throwIfAborted()
      if (frozen || !prepare) return frozen ?? []
      let rejectCancellation!: (reason: unknown) => void
      const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject })
      const aborted = () => rejectCancellation(signal.reason)
      signal.addEventListener('abort', aborted, { once: true })
      try {
        signal.throwIfAborted()
        // Freezing is read-only. A source adapter which settles late cannot keep a
        // stopped job alive or hand its late bytes to an executor.
        const sources = await Promise.race([prepare(signal), cancellation])
        signal.throwIfAborted()
        return this.frozenSources(sources)
      } finally { signal.removeEventListener('abort', aborted) }
    }
  }
  private async createTaskCopy(copyRoot: string, sources: readonly PreparedTaskSource[], materialize: boolean,
    signal: AbortSignal, taskRoot = copyRoot): Promise<string> {
    signal.throwIfAborted()
    await fs.mkdir(this.copyRootBase, { recursive: true, mode: 0o700 })
    signal.throwIfAborted()
    // Refuse orphaned copies instead of replaying a command whose earlier outcome is unknown.
    try { await fs.mkdir(taskRoot, { recursive: false, mode: 0o700 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new DelegationJobError('copy-unknown', '任务副本已存在但无匹配回执；未重新执行'); throw error }
    await this.scopedCopy(taskRoot)
    signal.throwIfAborted()
    if (copyRoot !== taskRoot) await fs.mkdir(copyRoot, { recursive: true, mode: 0o700 })
    const actual = await this.scopedCopy(copyRoot)
    if (materialize) for (const source of sources) {
      signal.throwIfAborted()
      const destination = path.join(actual, ...source.name.split('/'))
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
      signal.throwIfAborted()
      await fs.writeFile(destination, source.bytes, { flag: 'wx', mode: 0o600, signal })
    }
    signal.throwIfAborted()
    return actual
  }
  /** Preview contains the actual resolved command and frozen inputs; it grants no execution. */
  async prepareLocal(input: TaskIdentity & TaskSourcePreparation & { intent: LocalToolRunIntent }): Promise<LocalToolRunPreview> {
    this.assertRunning(input.runId)
    input = { ...input, intent: structuredClone(input.intent) }
    const intentDigest = documentDigest(input.intent), prior = this.localPreparations.get(input.jobId)
    if (prior) {
      if (prior.runId !== input.runId || prior.taskId !== input.taskId || prior.intentDigest !== intentDigest)
        throw new DelegationJobError('job-conflict', '本地命令身份已绑定另一请求')
      return structuredClone(await prior.preview)
    }
    const prepareSources = this.sourcePreparation(input), cwd = this.plannedCopy(input, input.intent.cwd)
    const outputs = (input.intent.outputs ?? []).map(artifactName)
    if (new Set(outputs).size !== outputs.length) throw new DelegationJobError('invalid-input', '声明成果重名')
    let resolvePreview!: (preview: LocalToolRunPreview) => void, rejectPreview!: (reason: unknown) => void, start!: () => void
    const preview = new Promise<LocalToolRunPreview>((resolve, reject) => { resolvePreview = resolve; rejectPreview = reject })
    const approved = new Promise<void>(resolve => { start = resolve })
    // A repeated preview shares preparation, including its failure/cancellation; it never refreezes inputs.
    this.localPreparations.set(input.jobId, { runId: input.runId, jobId: input.jobId, taskId: input.taskId, intentDigest, preview, start })
    void preview.catch(() => undefined)
    const task: DelegationJobInput = { ...input, goal: `运行 ${input.intent.command}`, copyRoot: cwd,
      permission: 'workspace', expectedArtifacts: outputs }
    try {
      const snapshot = await this.startExecution(task, documentDigest({ runId: input.runId, taskId: input.taskId, intent: input.intent }), 'local', async signal => {
        try {
          const sources = await prepareSources(signal)
          const command = await this.localRunner.prepare(cwd, input.intent)
          signal.throwIfAborted()
          const view: LocalToolRunPreview = { executable: command.executable, args: command.args, cwd,
            stdinByteLength: Buffer.byteLength(command.stdin ?? ''), sources: sources.map(({ source, name, version, bytes }) =>
              ({ source, name, version, byteLength: bytes.byteLength })), outputs }
          this.localPlans.set(input.jobId, { ...input, intentDigest, command, sources, preview: view, authorized: false })
          resolvePreview(view)
          // Preparing a preview is not approval. The same registered job waits for startLocal.
          const aborted = () => rejectApproval(signal.reason)
          let rejectApproval!: (reason: unknown) => void
          const cancellation = new Promise<never>((_resolve, reject) => { rejectApproval = reject })
          signal.addEventListener('abort', aborted, { once: true })
          try {
            signal.throwIfAborted()
            await Promise.race([approved, cancellation])
          } finally { signal.removeEventListener('abort', aborted) }
          signal.throwIfAborted()
          return this.createTaskCopy(cwd, sources, true, signal, this.plannedCopy(input))
        } catch (error) { rejectPreview(error); throw error }
      }, (active, onEvent, copyRoot) => this.localRunner.run(input.taskId,
        { ...this.localPlans.get(input.jobId)!.command, cwd: copyRoot }, { signal: active.controller.signal, onEvent }))
      if (!this.active.has(input.jobId)) rejectPreview(new DelegationJobError('command-not-prepared',
        snapshot.reason ?? '本地命令已有终态或上次准备已中断；保留回执，未重新准备'))
      else void this.active.get(input.jobId)!.work.then(() => rejectPreview(new DelegationJobError('command-not-prepared',
        '本地命令准备已结束或停止；未重新准备')), rejectPreview)
      return structuredClone(await preview)
    } catch (error) { rejectPreview(error); throw error }
  }
  authorizeLocal(input: TaskIdentity & { intent: LocalToolRunIntent }): void {
    this.assertRunning(input.runId)
    const plan = this.localPlans.get(input.jobId)
    if (!plan || plan.runId !== input.runId || plan.intentDigest !== documentDigest(input.intent))
      throw new DelegationJobError('command-not-prepared', '只有已预览的同一实际命令可以获准执行')
    plan.authorized = true
  }
  async startLocal(input: TaskIdentity & { intent: LocalToolRunIntent }): Promise<DelegationJobSnapshot> {
    this.assertRunning(input.runId)
    const plan = this.localPlans.get(input.jobId)
    if (!plan || plan.runId !== input.runId || plan.intentDigest !== documentDigest(input.intent) || !plan.authorized)
      throw new DelegationJobError('command-not-approved', '已准备的本地命令尚未获得宿主确认的执行授权')
    const current = await this.status(input.runId, input.jobId)
    this.assertRunning(input.runId)
    if (!current.terminal) this.localPreparations.get(input.jobId)!.start()
    return current
  }
  async startReadonly(input: TaskIdentity & TaskSourcePreparation & { intent: ReadonlyDelegationIntent }): Promise<DelegationJobSnapshot> {
    this.assertRunning(input.runId)
    if (!this.readonlyRunner) throw new DelegationJobError('unconfigured', '只读子任务尚未连接父任务模型')
    input = { ...input, intent: structuredClone(input.intent) }
    const prepareSources = this.sourcePreparation(input), copyRoot = this.plannedCopy(input)
    let sources: readonly PreparedTaskSource[] = []
    let reportName = 'report.md'
    const task: DelegationJobInput = { ...input, goal: input.intent.goal, copyRoot, permission: 'read-only', expectedArtifacts: ['report.md'] }
    const requestDigest = documentDigest({ runId: input.runId, taskId: input.taskId, intent: input.intent })
    return this.startExecution(task, requestDigest, 'readonly', async signal => {
      sources = await prepareSources(signal)
      const sourceNames = sources.map(source => source.name.toLowerCase())
      for (let index = 2; sourceNames.some(name => name === reportName || name.startsWith(`${reportName}/`)); index++) reportName = `report-${index}.md`
      task.expectedArtifacts = [reportName]
      return this.createTaskCopy(copyRoot, sources, true, signal)
    },
      (active, onEvent, actual) => this.readonlyRunner!.run({ ...input, copyRoot: actual, reportName, sources }, { signal: active.controller.signal, onEvent }))
  }

  nativeAvailable(): boolean { return this.nativeRunner?.available() ?? false }

  async startNative(input: TaskIdentity & TaskSourcePreparation & { permission: 'workspace' | 'full'; intent: NativeDelegationIntent }): Promise<DelegationJobSnapshot> {
    return this.nativeTask(input)
  }

  /** The current host has resolved an allowed source owner; this creates a new job, never revives an old grant. */
  async resumeNative(input: TaskIdentity & TaskSourcePreparation & { sourceRunId: string; sourceJobId: string;
    permission: 'workspace' | 'full'; intent: NativeDelegationIntent }): Promise<DelegationJobSnapshot> {
    if (!input.sourceRunId || !input.sourceJobId || input.sourceJobId === input.jobId)
      throw new DelegationJobError('invalid-resume', '子任务续接来源身份无效')
    return this.nativeTask(input, { runId: input.sourceRunId, jobId: input.sourceJobId })
  }

  private async nativeTask(input: TaskIdentity & TaskSourcePreparation & { permission: 'workspace' | 'full'; intent: NativeDelegationIntent },
    from?: { runId: string; jobId: string }, userInitiatedResume = false,
    childPrepared?: () => void): Promise<DelegationJobSnapshot> {
    if (!userInitiatedResume) this.assertRunning(input.runId)
    if (!['workspace', 'full'].includes(input.permission)) throw new DelegationJobError('native-not-authorized', '原生子任务没有获准的候选写入范围')
    if (!this.nativeRunner) throw new DelegationJobError('unconfigured', '原生子任务尚未接入现有执行引擎')
    input = { ...input, intent: structuredClone(input.intent) }
    const prepareSources = this.sourcePreparation(input)
    let sources: readonly PreparedTaskSource[] = []
    const copyRoot = this.plannedCopy(input)
    const task = this.taskInput({ runId: input.runId, jobId: input.jobId, taskId: input.taskId, goal: input.intent.goal,
      permission: input.permission, copyRoot, expectedArtifacts: input.intent.outputs })
    const requestDigest = documentDigest({ ...task, intent: input.intent, from })
    let resumeRunId: string | undefined
    return this.startExecution(task, requestDigest, 'native', async signal => {
      signal.throwIfAborted()
      sources = await prepareSources(signal)
      const targetSource = sources.find(source => source.source.startsWith('task-target:'))
      const targetContext = targetSource ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(targetSource.bytes)) as unknown : undefined
      await this.update(input.jobId, job => { job.nativeIntent = input.intent; job.goal = input.intent.goal;
        job.target = taskTargetDeclaration(targetContext) ?? input.intent.target; job.role = input.intent.role; job.targetContext = targetContext })
      signal.throwIfAborted()
      if (!from) return this.createTaskCopy(copyRoot, sources, true, signal)
      const previous = await this.serial(from.jobId, () => this.load(from.jobId))
      signal.throwIfAborted()
      if (!previous || previous.runId !== from.runId || previous.executionKind !== 'native' || !previous.childRunId)
        throw new DelegationJobError('resume-not-authorized', '原生子任务来源或真实运行身份无法核实')
      if (this.active.has(from.jobId) || !terminal(previous.status))
        throw new DelegationJobError('resume-running', '原子任务尚未结束；请先等待或停止后再续接')
      const original = await this.scopedCopy(previous.copyRoot)
      signal.throwIfAborted()
      const actual = await this.createTaskCopy(copyRoot, [], false, signal)
      await this.copyNativeWorkspace(original, actual, signal)
      for (const source of sources) {
        signal.throwIfAborted()
        const destination = path.join(actual, ...source.name.split('/'))
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
        if (!inside(actual, await fs.realpath(path.dirname(destination)))) throw new DelegationJobError('material-outside', '续接输入超出当前候选空间')
        signal.throwIfAborted()
        await fs.writeFile(destination, source.bytes, { mode: 0o600, signal })
      }
      resumeRunId = previous.childRunId
      await this.update(input.jobId, job => { job.resumedFrom = { ...from, childRunId: previous.childRunId! };
        if (!targetSource) job.targetContext = previous.targetContext })
      signal.throwIfAborted()
      return actual
    }, (active, onEvent, actual) => {
      const request: NativeTaskRequest = { ...input, sources, copyRoot: actual, resumeRunId, userInitiatedResume }
      return this.nativeRunner!.run(request, { signal: active.controller.signal, onEvent,
        onPrepared: async record => { await this.update(input.jobId, job => { job.childRunId = record.runId }); childPrepared?.() } })
    }, userInitiatedResume)
  }

  /** Only a quiescent child's own files are copied. No links, shared writers or provider replay. */
  private async copyNativeWorkspace(sourceRoot: string, destinationRoot: string, signal: AbortSignal): Promise<void> {
    const same = (before: import('node:fs').Stats, after: import('node:fs').Stats) => before.dev === after.dev
      && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs
    const copy = async (relative: string): Promise<void> => {
      signal.throwIfAborted()
      const source = path.join(sourceRoot, relative), destination = path.join(destinationRoot, relative)
      const before = await fs.lstat(source)
      if (before.isSymbolicLink() || !inside(sourceRoot, await fs.realpath(source)))
        throw new DelegationJobError('resume-source-invalid', '原子任务候选含链接或越界文件；未扩大当前任务权限')
      if (before.isDirectory()) {
        const entries = (await fs.readdir(source)).sort()
        if (relative) await fs.mkdir(destination, { mode: 0o700 })
        for (const name of entries) { artifactName(name); await copy(path.join(relative, name)) }
      } else if (before.isFile()) {
        const bytes = await fs.readFile(source, { signal })
        if (bytes.byteLength !== before.size) throw new DelegationJobError('resume-source-changed', '原子任务文件在复制期间改变')
        signal.throwIfAborted()
        await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600, signal })
      } else throw new DelegationJobError('resume-source-invalid', '原子任务候选不是普通文件或目录')
      const after = await fs.lstat(source)
      if (!same(before, after)) throw new DelegationJobError('resume-source-changed', '原子任务文件在复制期间改变')
      signal.throwIfAborted()
    }
    await copy('')
  }

  /** Address one existing job in the same host-owned collaboration tree, without broadcasting. */
  async message(runId: string, jobId: string, submissionId: string, text: string): Promise<{
    status: 'accepted'; job: string; submissionId: string; senderRunId: string; targetRunId: string }> {
    this.assertRunning(runId)
    if (!submissionId || !text.trim()) throw new DelegationJobError('message-invalid', '协作消息身份或正文无效')
    if (!this.nativeRunner) throw new DelegationJobError('unconfigured', '原生子任务执行引擎未接入')
    const job = await this.serial(jobId, () => this.load(jobId))
    this.assertRunning(runId)
    if (!job || job.executionKind !== 'native' || !job.childRunId || job.stopped)
      throw new DelegationJobError('message-unavailable', '该原生子任务尚未就绪或已停止，不能投递新消息')
    const targetRunId = runId === job.runId ? job.childRunId : runId === job.childRunId ? job.runId
      : await this.nativeRunner.related?.(runId, job.runId) ? job.childRunId : undefined
    if (!targetRunId) throw new DelegationJobError('job-not-authorized', '协作消息不属于当前运行的协作任务树')
    this.assertRunning(job.runId)
    await this.nativeRunner.message(targetRunId, `delegation:${jobId}:${runId}:${submissionId}`, { senderRunId: runId, text })
    return { status: 'accepted', job: jobId, submissionId, senderRunId: runId, targetRunId }
  }

  /** Read the existing durable jobs; no second child registry is maintained. */
  async listNative(runIds: readonly string[]): Promise<DelegationJobSnapshot[]> {
    const owners = new Set(runIds), result: DelegationJobSnapshot[] = []
    let folders: string[]
    try { folders = await fs.readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    for (const folder of folders) {
      let stored: Stored
      try { stored = JSON.parse(await fs.readFile(path.join(this.directory, folder, 'state.json'), 'utf8')) as Stored }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      if (owners.has(stored.runId) && stored.executionKind === 'native') result.push(await this.status(stored.runId, stored.jobId))
    }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** The target preparation remains owned by its existing job, including before child execution begins. */
  async targetContextForRun(runId: string): Promise<unknown | null> {
    let folders: string[]
    try { folders = await fs.readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    for (const folder of folders) {
      let stored: Stored
      try { stored = JSON.parse(await fs.readFile(path.join(this.directory, folder, 'state.json'), 'utf8')) as Stored }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      if (stored.executionKind === 'native' && stored.childRunId === runId)
        return structuredClone(stored.targetContext ?? null)
    }
    return null
  }

  async messageFromUser(runId: string, jobId: string, submissionId: string, text: string): Promise<DelegationJobSnapshot> {
    if (!submissionId || !text.trim()) throw new DelegationJobError('message-invalid', '补充消息身份或正文无效')
    const job = await this.status(runId, jobId)
    if (job.executionKind !== 'native' || !job.childRunId || job.stopped || job.terminal)
      throw new DelegationJobError('message-unavailable', '子任务尚未开始或已经结束；终态任务请续接')
    if (!this.nativeRunner?.userMessage) throw new DelegationJobError('unconfigured', '子任务用户补充尚未接入')
    await this.nativeRunner.userMessage(job.childRunId, `delegation-user:${jobId}:${submissionId}`, text)
    return this.status(runId, jobId)
  }

  /** A real user continues this child's candidate and history, without a parent document writer. */
  async resumeFromUser(input: { runId: string; jobId: string; submissionId: string; text: string;
    permission: 'workspace' | 'full' }): Promise<DelegationJobSnapshot> {
    if (!input.submissionId || !input.text.trim()) throw new DelegationJobError('message-invalid', '续接消息身份或正文无效')
    const previous = await this.serial(input.jobId, () => this.load(input.jobId))
    if (!previous || previous.runId !== input.runId || previous.executionKind !== 'native')
      throw new DelegationJobError('job-not-authorized', '原生子任务来源无法核实')
    if (!previous.terminal || this.active.has(input.jobId)) throw new DelegationJobError('resume-running', '子任务仍在执行，请先等待或停止')
    const original = previous.nativeIntent ?? { goal: previous.goal ?? '继续原子任务', outputs: [...previous.expectedArtifacts] }
    const intent = { ...original, goal: `${original.goal}\n\n用户续接要求：${input.text}` }
    const jobId = `delegate-user-${documentDigest([input.runId, input.jobId, input.submissionId])}`
    const prior = this.userResumePreparations.get(jobId)
    if (prior) {
      if (prior.text !== input.text) throw new DelegationJobError('job-conflict', '同一续接编号已用于其他内容')
      return prior.work
    }
    const work = (async () => {
      let prepared!: () => void
      const preparation = new Promise<void>(resolve => { prepared = resolve })
      const opened = await this.nativeTask({ runId: input.runId, jobId, taskId: `user-resume:${input.submissionId}`,
        permission: input.permission, intent }, { runId: input.runId, jobId: input.jobId }, true, prepared)
      if (!opened.childRunId && !opened.terminal) {
        // Return a real child identity or a preparation failure. Do not wait for the model loop or poll the owner.
        await Promise.race([preparation, this.active.get(jobId)?.work ?? Promise.resolve()])
      }
      return this.status(input.runId, jobId)
    })()
    this.userResumePreparations.set(jobId, { text: input.text, work })
    try { return await work }
    finally { if (this.userResumePreparations.get(jobId)?.work === work) this.userResumePreparations.delete(jobId) }
  }

  /** Creates an isolated copy without letting the model choose a host write root. */
  async startManaged(input: ManagedDelegationInput): Promise<DelegationJobSnapshot> {
    const hasPreparedSources = input.sources !== undefined || input.prepareSources !== undefined
    const prepareSources = this.sourcePreparation(input)
    input = structuredClone({ ...input, sources: undefined, prepareSources: undefined })
    const materials = hasPreparedSources ? [...(input.materials ?? [])] : (input.materials ?? []).map(artifactName)
    if (new Set(materials).size !== materials.length)
      throw new DelegationJobError('invalid-materials', '委派资料重名')
    if (!path.isAbsolute(input.workspaceRoot)) throw new DelegationJobError('workspace-root', '委派工作空间根无效')
    const copyRoot = this.plannedCopy(input)
    const task = this.taskInput({ runId: input.runId, jobId: input.jobId, taskId: input.taskId, goal: input.goal,
      copyRoot, permission: input.permission, materials, expectedArtifacts: input.expectedArtifacts })
    const requestDigest = documentDigest({ ...task, workspaceRoot: path.resolve(input.workspaceRoot), sourceVersion: input.sourceVersion ?? 'current' })
    return this.startExecution(task, requestDigest, 'codex', async signal => {
      signal.throwIfAborted()
      if (hasPreparedSources) {
        const sources = await prepareSources(signal)
        task.materials = sources.map(source => source.name)
        return this.createTaskCopy(copyRoot, sources, true, signal)
      }
      const workspaceRoot = await fs.realpath(input.workspaceRoot)
      signal.throwIfAborted()
      if (!(await fs.stat(workspaceRoot)).isDirectory()) throw new DelegationJobError('workspace-root', '委派工作空间根不是文件夹')
      const actual = await this.createTaskCopy(copyRoot, [], false, signal)
      for (const name of materials) {
        signal.throwIfAborted()
        const source = await fs.realpath(path.join(workspaceRoot, ...name.split('/')))
        if (!inside(workspaceRoot, source)) throw new DelegationJobError('material-outside', '委派资料超出冻结工作空间')
        const before = await fs.stat(source)
        if (!before.isFile()) throw new DelegationJobError('material-invalid', '委派资料须为普通文件')
        const bytes = await fs.readFile(source, { signal })
        const after = await fs.stat(source)
        signal.throwIfAborted()
        if (bytes.byteLength !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
          throw new DelegationJobError('material-changed', '委派资料复制期间改变')
        const destination = path.join(actual, ...name.split('/'))
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
        signal.throwIfAborted()
        await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600, signal })
      }
      signal.throwIfAborted()
      return actual
    }, (active, onEvent, actual) => this.executeCodex(task, actual, active, onEvent))
  }

  private taskInput(input: DelegationJobInput): DelegationJobInput {
    if (!input.runId || !input.taskId?.trim() || !input.goal?.trim()
      || !['workspace', 'full', 'read-only'].includes(input.permission) || !Array.isArray(input.expectedArtifacts)
      || input.expectedArtifacts.length < 1)
      throw new DelegationJobError('invalid-input', '委派目标、权限或声明成果无效')
    const expectedArtifacts = input.expectedArtifacts.map(artifactName)
    if (new Set(expectedArtifacts).size !== expectedArtifacts.length) throw new DelegationJobError('invalid-input', '委派声明成果重名')
    if (!path.isAbsolute(input.copyRoot)) throw new DelegationJobError('copy-root', '委派工作副本必须使用绝对路径')
    const copyRoot = path.resolve(input.copyRoot)
    if (copyRoot === this.copyRootBase || !inside(this.copyRootBase, copyRoot))
      throw new DelegationJobError('copy-root', '委派工作副本不在已批准的副本授权根内')
    return { ...structuredClone(input), copyRoot, expectedArtifacts }
  }

  async start(input: DelegationJobInput): Promise<DelegationJobSnapshot> {
    input = this.taskInput(input)
    const requestDigest = digest(JSON.stringify({ runId: input.runId, taskId: input.taskId, goal: input.goal,
      copyRoot: input.copyRoot, permission: input.permission, materials: input.materials ?? [], expectedArtifacts: input.expectedArtifacts }))
    return this.startExecution(input, requestDigest, 'codex', async signal => {
      signal.throwIfAborted()
      const copyRoot = await this.scopedCopy(input.copyRoot)
      signal.throwIfAborted()
      return copyRoot
    }, (active, onEvent, copyRoot) => this.executeCodex(input, copyRoot, active, onEvent))
  }

  private executeCodex(input: DelegationJobInput, copyRoot: string, active: Active, onEvent: (event: DelegationEvent) => void) {
    return this.runner.run({ taskId: input.taskId, goal: input.goal, copyRoot, permission: input.permission,
        materials: input.materials, expectedArtifacts: input.expectedArtifacts }, {
        signal: active.controller.signal, onEvent,
        verify: async ({ artifacts }) => ({ accepted: artifacts.length === input.expectedArtifacts.length
          && artifacts.every(artifact => artifact.bytes > 0), detail: '声明成果已在批准副本内回读；等待父任务审阅和正式交付。' }),
      })
  }

  private async startExecution(input: DelegationJobInput, requestDigest: string, executionKind: NonNullable<DelegationJobSnapshot['executionKind']>,
    prepare: TaskPreparation, execute: TaskExecution, userInitiatedResume = false): Promise<DelegationJobSnapshot> {
    return this.serial(input.jobId, async () => {
      if (!userInitiatedResume) this.assertRunning(input.runId)
      const prior = await this.load(input.jobId)
      if (prior) {
        if (prior.runId !== input.runId || prior.requestDigest !== requestDigest)
          throw new DelegationJobError('job-conflict', '委派作业身份已绑定另一请求')
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
      // A native child occupies its parent's slot from preparation through settlement.
      // Check capacity after all awaited reads, next to registration: unrelated job IDs
      // cannot race through this admission boundary, and identical retries reuse receipts.
      if (executionKind === 'native') {
        const running = [...this.active.entries()].filter(([, value]) =>
          value.runId === input.runId && value.kind === 'native').map(([jobId]) => jobId)
        if (running.length >= this.maxConcurrentNativePerRun)
          throw new DelegationJobError('native-concurrency-limit',
            `自主子任务已达到当前父任务的并发上限 ${this.maxConcurrentNativePerRun}；请先等待或取消现有作业（${running.join('、')}），不要重复派工。`)
      }
      // Nothing asynchronous separates admission checks from registration.
      // cancelRun closes admission and aborts every registered controller before
      // waiting for persistence, so a Stop during save cannot launch late work.
      if (!userInitiatedResume) this.assertRunning(input.runId)
      const time = this.now().toISOString()
      const job: Stored = { version: 1, runId: input.runId, jobId: input.jobId, requestDigest,
        status: 'preparing', terminal: false, stopped: false, goal: input.goal, createdAt: time, updatedAt: time,
        executionKind, ...(executionKind === 'codex' ? { configuredModel: 'gpt-6-luna', configuredSpeed: 'priority' } : {}), billedAmount: null,
        copyRoot: input.copyRoot, expectedArtifacts: input.expectedArtifacts, artifacts: [], logs: [], nextLogCursor: 0 }
      const active: Active = { runId: input.runId, kind: executionKind, controller: new AbortController(), work: Promise.resolve() }
      this.active.set(input.jobId, active)
      const persisted = this.save(job)
      active.work = persisted.then(() => this.execute(input.jobId, input, active, prepare, execute)).finally(() => {
        if (this.active.get(input.jobId) === active) this.active.delete(input.jobId)
      })
      void active.work.catch(() => undefined)
      await persisted
      return this.expose(job)
    })
  }

  private async snapshotArtifact(jobId: string, copyRoot: string, name: string, allowEmpty = false): Promise<DelegationJobArtifact> {
    const source = await fs.realpath(path.join(copyRoot, ...name.split('/')))
    if (!inside(copyRoot, source)) throw new DelegationJobError('artifact-outside', '委派成果离开批准副本')
    const stat = await fs.stat(source)
    if (!stat.isFile() || !stat.size && !allowEmpty) throw new DelegationJobError('artifact-invalid', '委派成果为空或类型无效')
    const bytes = await fs.readFile(source)
    if (bytes.byteLength !== stat.size) throw new DelegationJobError('artifact-changed', '委派成果读取期间发生变化')
    const output = path.join(this.folder(jobId), 'artifacts', digest(name))
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
    await fs.writeFile(output, bytes, { flag: 'wx', mode: 0o600 })
    return { name, digest: digest(bytes), byteLength: bytes.byteLength }
  }

  private async execute(jobId: string, input: DelegationJobInput, active: Active, prepare: TaskPreparation, execute: TaskExecution): Promise<void> {
    let result: DelegationExecutionResult | undefined
    let executionStarted = false
    try {
      active.controller.signal.throwIfAborted()
      const copyRoot = await prepare(active.controller.signal)
      active.controller.signal.throwIfAborted()
      await this.update(jobId, job => { job.copyRoot = copyRoot; job.expectedArtifacts = input.expectedArtifacts; if (!job.stopped) job.status = 'running' })
      active.controller.signal.throwIfAborted()
      executionStarted = true
      result = await execute(active, event => { void this.update(jobId, job => {
          job.logs = [...job.logs, { cursor: ++job.nextLogCursor, time: Date.now(), kind: event.kind,
            message: event.detail }]
        }).catch(() => undefined)
      }, copyRoot)
      const artifacts: DelegationJobArtifact[] = []
      const artifactDiagnostics: string[] = []
      if (result.status === 'verified' && !active.controller.signal.aborted) {
        const closure = await delegationArtifactClosure(copyRoot, input.expectedArtifacts, active.controller.signal)
        artifactDiagnostics.push(...closure.diagnostics)
        for (const name of closure.names) {
          if (active.controller.signal.aborted) break
          try { artifacts.push(await this.snapshotArtifact(jobId, copyRoot, name, !input.expectedArtifacts.includes(name))) }
          catch (error) {
            if (input.expectedArtifacts.includes(name)) throw error
            artifactDiagnostics.push(`${name}：成果依赖未能封存（${error instanceof Error ? error.message : String(error)}）；原入口及其他可用文件已保留`)
          }
        }
      }
      await this.update(jobId, job => {
        job.account = result!.account; job.cliVersion = result!.cliVersion; job.threadId = result!.threadId
        if (result!.configuredModel) job.configuredModel = result!.configuredModel
        if (result!.configuredSpeed) job.configuredSpeed = result!.configuredSpeed
        job.actualModel = result!.actualModel; job.connectionId = result!.connectionId; job.usage = result!.usage
        job.requestId = result!.requestId; job.candidateComplete = result!.candidateComplete; job.childRunId = result!.childRunId
        job.exitCode = result!.exitCode; job.summary = result!.summary?.slice(0, 8000)
        job.reason = result!.reason.slice(0, 1000); job.artifacts = artifacts
        if (result!.reason.length > 1000) job.logs = [...job.logs, { cursor: ++job.nextLogCursor,
          time: Date.now(), kind: 'system' as const, message: result!.reason }]
        if (result!.diagnostic) job.logs = [...job.logs, { cursor: ++job.nextLogCursor,
          time: Date.now(), kind: 'system' as const, message: result!.diagnostic }]
        for (const message of artifactDiagnostics) job.logs = [...job.logs, { cursor: ++job.nextLogCursor,
          time: Date.now(), kind: 'system' as const, message }]
        job.stopped ||= active.controller.signal.aborted
        job.status = job.stopped
          ? result!.status === 'cancelled' || result!.status === 'verified' ? 'cancelled' : 'unknown'
          : result!.status === 'verified' ? 'ready' : result!.status
        if (job.stopped && result!.status === 'verified') job.reason = '作业已停止；执行已结束，迟到候选未采用'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '委派作业失败'
      await this.update(jobId, job => {
        job.stopped ||= active.controller.signal.aborted
        job.status = active.controller.signal.aborted
          ? !executionStarted || result?.status === 'verified' || result?.status === 'cancelled' ? 'cancelled' : 'unknown'
          : 'failed'
        job.reason = message.slice(0, 1000)
        job.logs = [...job.logs, { cursor: ++job.nextLogCursor, time: Date.now(), kind: 'system' as const, message }]
      }).catch(() => undefined)
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
  /** Desktop has observed the child Engine's terminal state; await only this job's remaining candidate sealing. */
  async settleNativeChild(runId: string, jobId: string): Promise<DelegationJobSnapshot> {
    const job = await this.status(runId, jobId)
    if (job.executionKind !== 'native') throw new DelegationJobError('invalid-job', '只有原生子任务拥有子运行封存阶段')
    await this.active.get(jobId)?.work
    return this.status(runId, jobId)
  }
  async logs(runId: string, jobId: string, after = 0, limit = 100): Promise<DelegationJobLog> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1)
      throw new DelegationJobError('invalid-page', '委派日志分页无效：after 须为非负安全整数，limit 须为正安全整数；用 nextCursor 继续读取。')
    await this.status(runId, jobId)
    const job = await this.load(jobId)
    if (!job) throw new DelegationJobError('unknown-job', '委派作业不存在')
    const entries = job.logs.filter(entry => entry.cursor > after).slice(0, Math.min(limit, 100))
    return { entries, nextCursor: entries.at(-1)?.cursor ?? after }
  }
  async cancel(runId: string, jobId: string): Promise<DelegationJobSnapshot> {
    const active = this.active.get(jobId)
    if (active && active.runId !== runId) throw new DelegationJobError('job-not-authorized', '委派作业不属于当前运行')
    // Revoke preparation immediately; disk receipts can be awaited afterwards.
    active?.controller.abort()
    const current = await this.status(runId, jobId)
    if (current.terminal) return current
    await this.update(jobId, job => {
      job.stopped = true
      if (!terminal(job.status)) { job.status = 'unknown'; job.reason = '正在撤销委派；外部进程和副作用待核对。' }
    })
    await waitForHostWork(active?.work, 5000)
    return this.status(runId, jobId)
  }
  /** Called after the parent Gateway has revoked its canonical write authority. */
  async cancelRun(runId: string): Promise<void> {
    this.stoppedRuns.add(runId)
    for (const [jobId, plan] of this.localPlans) if (plan.runId === runId) this.localPlans.delete(jobId)
    for (const [jobId, preparation] of this.localPreparations) if (preparation.runId === runId) this.localPreparations.delete(jobId)
    const active = [...this.active.entries()].filter(([, value]) => value.runId === runId)
    for (const [, value] of active) value.controller.abort()
    await Promise.allSettled(active
      .map(([jobId]) => this.cancel(runId, jobId)))
  }
  async readArtifact(runId: string, jobId: string, name: string): Promise<{
    artifact: DelegationJobArtifact; bytes: Uint8Array; candidateComplete?: boolean; childRunId?: string }> {
    const job = await this.status(runId, jobId), safe = artifactName(name)
    if (job.status !== 'ready' || job.stopped) throw new DelegationJobError('artifact-not-ready', '委派成果尚未完成或已停止')
    const artifact = job.artifacts.find(value => value.name === safe)
    if (!artifact) throw new DelegationJobError('unknown-artifact', '成果未在作业封存清单中')
    const bytes = await fs.readFile(path.join(this.folder(jobId), 'artifacts', digest(safe)))
    if (digest(bytes) !== artifact.digest || bytes.byteLength !== artifact.byteLength)
      throw new DelegationJobError('artifact-changed', '委派成果封存副本已变化，未交付')
    return { artifact, bytes, ...(job.candidateComplete !== undefined ? { candidateComplete: job.candidateComplete } : {}),
      ...(job.childRunId ? { childRunId: job.childRunId } : {}) }
  }
}
