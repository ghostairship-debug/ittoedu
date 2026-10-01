import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ComputeArtifact, ComputeJobInput, ComputeJobLogs, ComputeJobSnapshot } from '../../../shared/workbench/compute'
import { waitForHostWork } from '../../../shared/workbench/jobWait'
import { PodmanComputeBackend, type ComputeProcess } from './PodmanComputeBackend'

type StoredJob = ComputeJobSnapshot & { version: 1; containerName: string; logs: ComputeJobLogs['entries'] }
type Active = { runId: string; work: Promise<void>; process?: ComputeProcess; starting: boolean; cancelled: boolean }
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const forbidden = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i
function safeName(name: string): string {
  if (typeof name !== 'string' || name.length < 1 || name.length > 256 || name.includes('\\') || name.includes(':') || name.includes('\0')) throw new Error('作业文件名无效')
  const parts = name.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ') || forbidden.test(part))) throw new Error('作业文件名无效')
  return parts.join('/')
}
function mime(name: string): string {
  switch (path.extname(name).toLowerCase()) {
    case '.json': return 'application/json'
    case '.csv': return 'text/csv'
    case '.txt': return 'text/plain'
    case '.html': return 'text/html'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    default: return 'application/octet-stream'
  }
}
export class ComputeJobError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ComputeJobError' }
}

/** Durable, scratch-only compute owner. Canonical file delivery stays with A1/FileService. */
export class ComputeJobService {
  private readonly directory: string
  private readonly active = new Map<string, Active>()
  private capacity: Promise<void> = Promise.resolve()
  private readonly cancellations = new Map<string, Promise<ComputeJobSnapshot>>()
  private readonly tails = new Map<string, Promise<unknown>>()
  constructor(options: { directory: string; backend: PodmanComputeBackend; now?: () => Date }) {
    this.directory = path.resolve(options.directory); this.backend = options.backend; this.now = options.now ?? (() => new Date())
  }
  private readonly backend: PodmanComputeBackend
  private readonly now: () => Date
  private folder(jobId: string) {
    if (typeof jobId !== 'string' || !jobId || jobId.length > 512) throw new ComputeJobError('invalid-job', '计算作业身份无效')
    return path.join(this.directory, digest(jobId))
  }
  private stateFile(jobId: string) { return path.join(this.folder(jobId), 'state.json') }
  private serial<T>(jobId: string, action: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(jobId) ?? Promise.resolve()
    const current = prior.catch(() => undefined).then(action)
    const tail = current.catch(() => undefined)
    this.tails.set(jobId, tail)
    void tail.finally(() => { if (this.tails.get(jobId) === tail) this.tails.delete(jobId) })
    return current
  }
  private async save(job: StoredJob): Promise<void> {
    const filename = this.stateFile(job.jobId), temporary = `${filename}.${randomUUID()}.tmp`
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    try {
      const handle = await fs.open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(job)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  private async load(jobId: string): Promise<StoredJob | null> {
    let source: string
    try { source = await fs.readFile(this.stateFile(jobId), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    try {
      const job = JSON.parse(source) as StoredJob
      if (job.version !== 1 || job.jobId !== jobId || !job.runId || !job.requestDigest
        || job.containerName !== `guoling-compute-${digest(jobId).slice(0, 32)}` || !Array.isArray(job.logs)
        || !Array.isArray(job.outputNames) || !Array.isArray(job.artifacts)) throw new Error()
      return job
    } catch { throw new ComputeJobError('job-corrupt', '计算作业记录损坏，未重新执行') }
  }
  private expose(job: StoredJob): ComputeJobSnapshot {
    const { version: _version, containerName: _containerName, logs: _logs, ...snapshot } = job
    return structuredClone(snapshot)
  }
  private async update(jobId: string, mutate: (job: StoredJob) => void): Promise<StoredJob> {
    return this.serial(jobId, async () => {
      const job = await this.load(jobId)
      if (!job) throw new ComputeJobError('unknown-job', '计算作业不存在')
      mutate(job); job.updatedAt = this.now().toISOString(); await this.save(job); return job
    })
  }
  private async recoverInterrupted(job: StoredJob): Promise<void> {
    const observed = await this.backend.inspectContainer(job.containerName)
    const stopped = observed === 'running' ? await this.backend.stopContainer(job.containerName) : false
    job.status = 'unknown'
    job.reason = observed === 'running'
      ? stopped ? '恢复时发现容器仍运行，已停止；此前输出未知，未自动交付或重放。' : '恢复时发现容器仍运行，但停止未获确认；输出未知，未自动交付或重放。'
      : observed === 'unknown' ? '恢复时无法确认容器状态；输出未知，未自动交付或重放。'
        : '执行进程已中断，先前输出未知；未自动交付或重放。'
    job.updatedAt = this.now().toISOString()
    await this.save(job)
  }
  private request(input: ComputeJobInput) {
    if (!input.runId || !input.jobId || input.language !== 'python' || typeof input.code !== 'string' && !input.program)
      throw new ComputeJobError('invalid-input', '计算任务缺少运行身份、Python 源码或程序')
    if (input.code && input.code.length > 1024 * 1024) throw new ComputeJobError('input-limit', '计算源码超过上限')
    const inputs = (input.inputs ?? []).map(file => ({ name: safeName(file.name), bytes: Uint8Array.from(file.bytes) }))
    const outputNames = (input.outputNames ?? []).map(safeName)
    if (new Set(inputs.map(file => file.name)).size !== inputs.length
      || new Set(outputNames).size !== outputNames.length || inputs.some(file => file.name === '__main__.py')
      || inputs.reduce((total, file) => total + file.bytes.byteLength, 0) > 256 * 1024 * 1024)
      throw new ComputeJobError('input-limit', '计算输入或输出声明超过上限或重名')
    const timeoutMs = input.timeoutMs ?? 5 * 60_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60 * 60_000) throw new ComputeJobError('invalid-timeout', '计算时限无效')
    const program = input.program ?? 'python3', argv = input.argv ?? (input.code !== undefined ? ['/job/input/__main__.py'] : [])
    const requestDigest = digest(JSON.stringify({ runId: input.runId, language: input.language, code: input.code,
      program, argv, inputs: inputs.map(file => ({ name: file.name, digest: digest(file.bytes) })), outputNames, timeoutMs }))
    return { inputs, outputNames, timeoutMs, program, argv, requestDigest }
  }
  async start(input: ComputeJobInput): Promise<ComputeJobSnapshot> {
    const frozen = this.request(input)
    return this.serial(input.jobId, async () => {
      const prior = await this.load(input.jobId)
      if (prior) {
        if (prior.runId !== input.runId || prior.requestDigest !== frozen.requestDigest) throw new ComputeJobError('job-conflict', '计算作业身份已绑定其他请求')
        if (!this.active.has(input.jobId) && (prior.status === 'preparing' || prior.status === 'running')) {
          await this.recoverInterrupted(prior)
        }
        return this.expose(prior)
      }
      const available = await this.backend.availability()
      if (!available.available) throw new ComputeJobError('backend-unavailable', available.reason ?? '受限执行后端未配置')
      const root = this.folder(input.jobId)
      try { await fs.access(root); throw new ComputeJobError('job-create-unknown', '作业目录已存在但没有完整回执，未重复执行；请使用新的作业身份。') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await fs.mkdir(path.join(root, 'input'), { recursive: true, mode: 0o700 })
      await fs.mkdir(path.join(root, 'work'), { recursive: true, mode: 0o700 })
      await fs.mkdir(path.join(root, 'output'), { recursive: true, mode: 0o700 })
      for (const file of frozen.inputs) {
        const filename = path.join(root, 'input', ...file.name.split('/'))
        await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
        await fs.writeFile(filename, file.bytes, { flag: 'wx', mode: 0o600 })
      }
      if (input.code !== undefined) await fs.writeFile(path.join(root, 'input', '__main__.py'), input.code, { flag: 'wx', mode: 0o600 })
      const now = this.now().toISOString()
      const containerName = `guoling-compute-${digest(input.jobId).slice(0, 32)}`
      const job: StoredJob = { version: 1, containerName, jobId: input.jobId, runId: input.runId, requestDigest: frozen.requestDigest,
        status: 'preparing', createdAt: now, updatedAt: now, stopped: false, outputNames: frozen.outputNames, artifacts: [], logs: [] }
      await this.save(job)
      const active: Active = { runId: input.runId, work: Promise.resolve(), starting: false, cancelled: false }
      this.active.set(input.jobId, active)
      active.work = this.execute(input.jobId, root, frozen, containerName, active).finally(() => { if (this.active.get(input.jobId) === active) this.active.delete(input.jobId) })
      void active.work.catch(() => undefined)
      return this.expose(job)
    })
  }
  private async artifact(root: string, name: string): Promise<ComputeArtifact> {
    const outputRoot = path.join(root, 'output')
    let current = outputRoot
    for (const segment of name.split('/')) {
      current = path.join(current, segment)
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new ComputeJobError('output-symlink', '计算输出包含链接，未登记为成果')
    }
    const stat = await fs.stat(current)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 256 * 1024 * 1024) throw new ComputeJobError('output-invalid', '计算输出缺失、为空或超过上限')
    const bytes = await fs.readFile(current)
    if (name.endsWith('.json')) { try { JSON.parse(bytes.toString('utf8')) } catch { throw new ComputeJobError('output-invalid', 'JSON 计算结果无法解析') } }
    if (name.endsWith('.png') && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ComputeJobError('output-invalid', 'PNG 计算结果签名无效')
    return { name, digest: digest(bytes), byteLength: bytes.byteLength, mimeType: mime(name) }
  }
  private async execute(jobId: string, root: string, frozen: ReturnType<ComputeJobService['request']>, containerName: string, active: Active): Promise<void> {
    let processStarted = false, processFinished = false
    let artifacts: ComputeArtifact[] = []
    let release!: () => void
    const previous = this.capacity
    this.capacity = new Promise<void>(resolve => { release = resolve })
    await previous.catch(() => undefined)
    try {
      if (active.cancelled) return
      active.starting = true
      const process = await this.backend.start({ directory: root, program: frozen.program, argv: frozen.argv, timeoutMs: frozen.timeoutMs, containerName })
      processStarted = true
      active.process = process; active.starting = false
      if (active.cancelled) await process.cancel()
      else await this.update(jobId, job => { if (!job.stopped) job.status = 'running' })
      const outcome = await process.done
      processFinished = true
      // Process facts survive even when an output is missing or malformed.
      await this.update(jobId, job => {
        job.logs = [...job.logs, ...this.logLines('stdout', outcome.stdout), ...this.logLines('stderr', outcome.stderr)].slice(-200)
        if (outcome.truncated) job.logs = [...job.logs, ...this.logLines('system', '日志已截断')].slice(-200)
        job.exitCode = outcome.exitCode
      })
      if (outcome.exitCode === 0) for (const name of frozen.outputNames) {
        artifacts.push(await this.artifact(root, name))
        if (artifacts.reduce((total, entry) => total + entry.byteLength, 0) > 256 * 1024 * 1024)
          throw new ComputeJobError('output-limit', '计算成果总量超过 256 MiB，未登记为可交付成果')
      }
      await this.update(jobId, job => {
        job.artifacts = artifacts
        if (job.stopped || active.cancelled || outcome.cancelled)
          job.status = outcome.cancelled && !artifacts.length ? 'cancelled' : 'unapplied'
        else if (outcome.timedOut) { job.status = 'failed'; job.reason = '计算达到运行时限，容器已停止。' }
        else if (outcome.exitCode === 0) job.status = 'ready'
        else { job.status = 'failed'; job.reason = `计算进程退出码 ${outcome.exitCode ?? 'unknown'}` }
      })
    } catch (error) {
      await this.update(jobId, job => {
        job.status = processStarted && !processFinished ? 'unknown' : 'failed'
        job.reason = error instanceof Error ? error.message.slice(0, 1000) : '计算后端失败'
        job.artifacts = artifacts
        job.logs = [...job.logs, ...this.logLines('system', job.reason)].slice(-200)
      }).catch(() => undefined)
    } finally { release() }
  }
  private logLines(stream: 'stdout' | 'stderr' | 'system', source: string): ComputeJobLogs['entries'] {
    const now = Date.now()
    return source.split(/\r?\n/).filter(Boolean).slice(0, 100).map((line, index) => ({ cursor: index + 1, time: now, stream, message: line.slice(0, 2000) }))
  }
  async status(runId: string, jobId: string): Promise<ComputeJobSnapshot> {
    const job = await this.serial(jobId, async () => {
      const value = await this.load(jobId)
      if (!value) throw new ComputeJobError('unknown-job', '计算作业不存在')
      if (value.runId !== runId) throw new ComputeJobError('job-not-authorized', '计算作业不属于当前运行')
      if (!this.active.has(jobId) && (value.status === 'preparing' || value.status === 'running')) {
        await this.recoverInterrupted(value)
      }
      return value
    })
    return this.expose(job)
  }
  async wait(runId: string, jobId: string, milliseconds: number, signal?: AbortSignal): Promise<ComputeJobSnapshot> {
    const current = await this.status(runId, jobId)
    if (current.status !== 'preparing' && current.status !== 'running') return current
    await waitForHostWork(this.active.get(jobId)?.work, milliseconds, signal)
    return this.status(runId, jobId)
  }
  async logs(runId: string, jobId: string, after = 0, limit = 100): Promise<ComputeJobLogs> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ComputeJobError('invalid-page', '作业日志分页无效')
    const job = await this.load(jobId)
    if (!job) throw new ComputeJobError('unknown-job', '计算作业不存在')
    if (job.runId !== runId) throw new ComputeJobError('job-not-authorized', '计算作业不属于当前运行')
    return { entries: job.logs.slice(after, after + limit).map((entry, index) => ({ ...entry, cursor: after + index + 1 })), nextCursor: Math.min(job.logs.length, after + limit) }
  }
  async cancel(runId: string, jobId: string): Promise<ComputeJobSnapshot> {
    const key = `${runId}\u0000${jobId}`
    const existing = this.cancellations.get(key)
    if (existing) return existing
    const work = this.cancelOnce(runId, jobId)
    this.cancellations.set(key, work)
    try { return await work }
    finally { if (this.cancellations.get(key) === work) this.cancellations.delete(key) }
  }
  private async cancelOnce(runId: string, jobId: string): Promise<ComputeJobSnapshot> {
    const current = await this.status(runId, jobId)
    if (current.status !== 'preparing' && current.status !== 'running') return current
    const active = this.active.get(jobId)
    if (active) active.cancelled = true
    const stopped = active?.process ? await active.process.cancel() : !active?.starting
    const job = await this.update(jobId, value => {
      value.stopped = true
      if (value.status === 'preparing' || value.status === 'running') {
        value.status = stopped ? 'cancelled' : 'unknown'
        value.reason = stopped ? '计算已停止，未向正式文件交付成果。' : '停止请求后的外部进程状态未知；不会自动重放或交付。'
      }
    })
    return this.expose(job)
  }
  /** Called after the run's write authority has been revoked by the Gateway. */
  async cancelRun(runId: string): Promise<void> {
    await Promise.allSettled([...this.active.entries()].filter(([, active]) => active.runId === runId)
      .map(([jobId]) => this.cancel(runId, jobId)))
  }
  async readArtifact(runId: string, jobId: string, name: string): Promise<{ artifact: ComputeArtifact; bytes: Uint8Array }> {
    const job = await this.status(runId, jobId), safe = safeName(name)
    if (job.status !== 'ready' || job.stopped) throw new ComputeJobError('artifact-not-ready', '计算成果未准备好或已撤销')
    const artifact = job.artifacts.find(value => value.name === safe)
    if (!artifact) throw new ComputeJobError('unknown-artifact', '计算成果不在声明输出中')
    const fresh = await this.artifact(this.folder(jobId), safe)
    if (fresh.digest !== artifact.digest || fresh.byteLength !== artifact.byteLength) throw new ComputeJobError('artifact-changed', '计算成果已变化，未交付到用户文件')
    return { artifact, bytes: await fs.readFile(path.join(this.folder(jobId), 'output', ...safe.split('/'))) }
  }
}
