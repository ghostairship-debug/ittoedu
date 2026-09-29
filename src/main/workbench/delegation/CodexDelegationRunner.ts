import { execFile, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { isInsideRoot, type ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'

/** One external loop over an approved copy. The parent job owns persistence and any document commit. */
export interface CodexDelegationRequest {
  taskId: string
  goal: string
  copyRoot: string
  executablePath?: string
  permission: ExecutionPermissionMode
  /** Relative paths inside copyRoot. These are read back, not automatically committed. */
  materials?: readonly string[]
  expectedArtifacts: readonly string[]
  /** A short-lived grant from ExternalMcpService; never placed on the command line or in a result. */
  mcp?: { endpoint: string; bearer: string; revoke(): Promise<void> }
  timeoutMs?: number
}

export interface DelegationArtifact {
  path: string
  bytes: number
}

export interface DelegationEvent {
  kind: 'started' | 'activity' | 'message' | 'finished' | 'error'
  detail: string
}

export interface DelegationVerification {
  accepted: boolean
  detail: string
}

export interface CodexDelegationResult {
  taskId: string
  status: 'unconfigured' | 'verified' | 'failed' | 'cancelled' | 'unknown'
  /** Model and speed requested from the installed CLI, not an assertion about provider billing. */
  configuredModel: 'gpt-6-luna'
  configuredSpeed: 'priority'
  cliVersion?: string
  account?: 'ChatGPT'
  threadId?: string
  exitCode?: number | null
  artifacts: DelegationArtifact[]
  summary?: string
  verification?: DelegationVerification
  reason: string
  /** Bounded local diagnostic only; never part of an agent prompt or success claim. */
  diagnostic?: string
  /** External disk effects need FileService review; no document transaction is performed here. */
  externalChangesPossible: boolean
}

export interface CodexDelegationRunOptions {
  signal?: AbortSignal
  onEvent?(event: DelegationEvent): void
  /** Must inspect the actual result. Exit zero and a model claim never count as acceptance. */
  verify(input: { copyRoot: string; artifacts: readonly DelegationArtifact[]; summary: string }): Promise<DelegationVerification>
  /** A backend can only certify cancellation after its process tree and access have ended. */
  confirmStopped?(): Promise<boolean>
}

/** The selected backend must sandbox model-generated tools within the checked copy. */
export interface CodexDelegationBoundaryPort {
  assertReady(copyRoot: string, permission: 'read-only' | 'workspace', executable: string): Promise<boolean>
  launchRestricted(input: { copyRoot: string; permission: 'read-only' | 'workspace'; executable: string;
    args: readonly string[]; options: SpawnOptionsWithoutStdio }): ChildProcessWithoutNullStreams
  /** True only after this launch and its descendants were terminated, or had already exited. */
  stopRestricted(child: ChildProcessWithoutNullStreams): Promise<boolean>
}

export interface CodexDelegationRunnerOptions {
  boundary?: CodexDelegationBoundaryPort
  /** Defaults to local, non-generating CLI inspection. Injectable for process fixtures. */
  inspectCli?: (executable: string) => Promise<CodexCliInspection>
}

export interface CodexCliInspection {
  ready: boolean
  reason: string
  version?: string
  account?: 'ChatGPT'
}

const MAX_EVENT_BYTES = 512 * 1024
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024
const STOP_WAIT_MS = 5000
const REVOKE_WAIT_MS = 5000
const MODEL = 'gpt-6-luna' as const
const SPEED = 'priority' as const
const execFileAsync = promisify(execFile)

const base = (taskId: string): CodexDelegationResult => ({
  taskId, status: 'unconfigured', configuredModel: MODEL, configuredSpeed: SPEED,
  artifacts: [], reason: '', externalChangesPossible: false,
})

function validRelative(root: string, raw: string): string {
  if (!raw || path.isAbsolute(raw) || raw.includes('\0')) throw new Error('材料或成果路径必须在工作副本内')
  const target = path.resolve(root, raw)
  if (target === root || !isInsideRoot(root, target)) throw new Error('材料或成果路径超出工作副本')
  return target
}

async function readableInside(root: string, raw: string): Promise<string> {
  const resolved = validRelative(root, raw)
  const actual = await fs.realpath(resolved)
  if (!isInsideRoot(root, actual) || !(await fs.stat(actual)).isFile()) throw new Error('材料或成果不在授权工作副本内')
  return actual
}

function childEnvironment(bearer?: string): NodeJS.ProcessEnv {
  const keys = process.platform === 'win32'
    ? ['Path', 'PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']
    : ['PATH', 'HOME', 'TMPDIR', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']
  const environment: NodeJS.ProcessEnv = {}
  for (const key of keys) if (process.env[key]) environment[key] = process.env[key]
  if (bearer) environment.GUOLING_MCP_TOKEN = bearer
  return environment
}

export async function discoverNativeCodexExecutable(): Promise<string | null> {
  const searchPath = process.env.Path || process.env.PATH || ''
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex'
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name)
    try { if ((await fs.stat(candidate)).isFile()) return await fs.realpath(candidate) }
    catch { /* Try the next PATH entry. */ }
  }
  return null
}

/** No model call: inspect CLI options, existing login and the local model capability catalog. */
export async function inspectCodexCli(executable: string): Promise<CodexCliInspection> {
  try {
    const command = (args: string[]) => execFileAsync(executable, args, { env: childEnvironment(), windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 })
    const versionOutput = await command(['--version'])
    const version = (versionOutput.stdout || versionOutput.stderr).trim()
    const helpOutput = await command(['exec', '--help'])
    const help = helpOutput.stdout + helpOutput.stderr
    if (!['--json', '--ephemeral', '--ignore-user-config', '--sandbox', '--model'].every(flag => help.includes(flag))) {
      return { ready: false, reason: '已安装的 Codex CLI 缺少委派所需的正式无头参数', version }
    }
    const loginOutput = await command(['login', 'status'])
    const login = loginOutput.stdout + loginOutput.stderr
    if (!login.includes('Logged in using ChatGPT')) return { ready: false, reason: 'Codex CLI 当前不是已授权的 ChatGPT 登录路由', version }
    const catalog = JSON.parse(await fs.readFile(path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'models_cache.json'), 'utf8')) as {
      models?: { slug?: string; service_tiers?: { id?: string }[] }[]
    }
    const model = catalog.models?.find(item => item.slug === MODEL)
    if (!model?.service_tiers?.some(tier => tier.id === SPEED)) return { ready: false,
      reason: '本地模型目录未确认 Luna Fast；没有替换模型或速度档位', version, account: 'ChatGPT' }
    return { ready: true, reason: '本地 CLI、ChatGPT 登录和 Luna Fast 目录已确认；实际请求路由待真实委派回执', version, account: 'ChatGPT' }
  } catch (cause) {
    return { ready: false, reason: `Codex CLI 无费用预检失败：${cause instanceof Error ? cause.message : String(cause)}` }
  }
}

function eventFromJson(value: unknown): { event?: DelegationEvent; terminal?: 'success' | 'failed'; summary?: string; threadId?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const row = value as Record<string, unknown>
  if (row.type === 'thread.started') return { threadId: typeof row.thread_id === 'string' ? row.thread_id : undefined,
    event: { kind: 'started', detail: '外部执行器已启动' } }
  if (row.type === 'turn.started') return { event: { kind: 'activity', detail: '外部执行器正在处理' } }
  if (row.type === 'item.completed') {
    const item = row.item && typeof row.item === 'object' && !Array.isArray(row.item) ? row.item as Record<string, unknown> : {}
    if (item.type === 'agent_message' && typeof item.text === 'string') return { summary: item.text.slice(0, 8000),
      event: { kind: 'message', detail: item.text.slice(0, 500) } }
    if (typeof item.type === 'string') return { event: { kind: 'activity', detail: `完成 ${item.type.slice(0, 60)}` } }
  }
  if (row.type === 'turn.completed') return { terminal: 'success', event: { kind: 'finished', detail: '外部执行器回合结束' } }
  if (row.type === 'turn.failed') return { terminal: 'failed', event: { kind: 'error', detail: '外部执行器回合失败' } }
  if (row.type === 'error') return { event: { kind: 'error', detail: '外部执行器报告错误' } }
  return {}
}

async function bounded<T>(promise: Promise<T>, waitMs: number, signal?: AbortSignal): Promise<
  { kind: 'returned'; value: T } | { kind: 'failed'; error: unknown } | { kind: 'expired' } | { kind: 'stopped' }> {
  if (signal?.aborted) return { kind: 'stopped' }
  let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined
  const expiry = new Promise<{ kind: 'expired' }>(resolve => {
    timer = setTimeout(() => resolve({ kind: 'expired' }), waitMs); timer.unref()
  })
  const stop = new Promise<{ kind: 'stopped' }>(resolve => {
    if (signal) { onAbort = () => resolve({ kind: 'stopped' }); signal.addEventListener('abort', onAbort, { once: true }) }
  })
  try {
    return await Promise.race([promise.then(value => ({ kind: 'returned' as const, value }), error => ({ kind: 'failed' as const, error })), expiry, stop])
  } finally { if (timer) clearTimeout(timer); if (signal && onAbort) signal.removeEventListener('abort', onAbort) }
}

/** CLI JSONL is only an activity source. No ANSI scraping, private transcript import or direct document writer. */
export class CodexDelegationRunner {
  constructor(private readonly options: CodexDelegationRunnerOptions = {}) {}

  async run(request: CodexDelegationRequest, options: CodexDelegationRunOptions): Promise<CodexDelegationResult> {
    let revocation: Promise<void> | undefined
    const scoped = request.mcp ? { ...request, mcp: { ...request.mcp,
      revoke: () => revocation ??= request.mcp!.revoke() } } : request
    let result: CodexDelegationResult
    try { result = await this.execute(scoped, options) }
    catch (cause) {
      result = { ...base(request.taskId), status: 'unknown', externalChangesPossible: true,
        reason: `委派状态无法确定：${cause instanceof Error ? cause.message : String(cause)}` }
    }
    if (scoped.mcp) {
      const revoked = await bounded(scoped.mcp.revoke(), REVOKE_WAIT_MS)
      if (revoked.kind !== 'returned') {
        result.status = 'unknown'
        result.reason = '委派文档授权未能确认撤销；请先核实外部写入状态'
      }
    }
    return result
  }

  private async execute(request: CodexDelegationRequest, options: CodexDelegationRunOptions): Promise<CodexDelegationResult> {
    const result = base(request.taskId)
    if (!request.taskId.trim() || !request.goal.trim() || request.goal.length > 100_000) {
      result.reason = '委派目标或任务身份无效'; return result
    }
    if (request.permission === 'ask') { result.reason = '修改前询问权限尚无外部执行器确认通道'; return result }
    if (request.permission !== 'read-only' && request.permission !== 'workspace' && request.permission !== 'full') {
      result.reason = '委派权限无效'; return result
    }
    if (options.signal?.aborted) { result.status = 'cancelled'; result.reason = '委派在启动前已停止'; return result }
    if (!Number.isSafeInteger(request.timeoutMs ?? 15 * 60_000) || (request.timeoutMs ?? 15 * 60_000) < 1000
      || (request.timeoutMs ?? 15 * 60_000) > 2 * 60 * 60_000) {
      result.reason = '委派时限无效'; return result
    }
    let root: string, executable: string, materials: string[]
    try {
      const binary = request.executablePath ?? await discoverNativeCodexExecutable()
      if (!binary) throw new Error('未找到原生 Codex 执行器')
      if (!path.isAbsolute(request.copyRoot) || !path.isAbsolute(binary)) throw new Error('执行器和工作副本必须使用绝对路径')
      root = await fs.realpath(request.copyRoot)
      if (!(await fs.stat(root)).isDirectory()) throw new Error('工作副本不是文件夹')
      executable = await fs.realpath(binary)
      if (!(await fs.stat(executable)).isFile()) throw new Error('执行器不是文件')
      materials = await Promise.all((request.materials ?? []).map(name => readableInside(root, name)))
      for (const name of request.expectedArtifacts) validRelative(root, name)
      if (request.mcp) {
        const endpoint = new URL(request.mcp.endpoint)
        if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/mcp'
          || !request.mcp.bearer) throw new Error('外部文档授权端点无效')
      }
    } catch (cause) { result.reason = cause instanceof Error ? cause.message : '委派输入无效'; return result }
    const scope = request.permission === 'read-only' ? 'read-only' : 'workspace'
    let boundaryReady = false
    try { boundaryReady = !!this.options.boundary && await this.options.boundary.assertReady(root, scope, executable) }
    catch { /* A failed boundary preflight cannot authorize a launch. */ }
    if (!boundaryReady) {
      result.reason = '工作副本的受限执行边界尚未验证'; return result
    }
    const inspection = await (this.options.inspectCli ?? inspectCodexCli)(executable)
    result.cliVersion = inspection.version
    result.account = inspection.account
    if (!inspection.ready) { result.reason = inspection.reason; return result }
    if (options.signal?.aborted) { result.status = 'cancelled'; result.reason = '委派在启动前已停止'; return result }

    const args = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '-m', MODEL, '-s',
      scope === 'read-only' ? 'read-only' : 'workspace-write', '-c', 'approval_policy="never"',
      '-c', `service_tier="${SPEED}"`, '-C', root]
    if (request.mcp) args.push('-c', `mcp_servers.guoling.url=${JSON.stringify(request.mcp.endpoint)}`,
      '-c', 'mcp_servers.guoling.bearer_token_env_var="GUOLING_MCP_TOKEN"')
    args.push('-')
    const prompt = [request.goal.trim(), '', `Task: ${request.taskId}`, `Approved copy: ${root}`,
      'Only work inside this approved copy. Report changed files and checks. A claim of completion does not apply Guoling document edits.',
      ...(materials.length ? ['', 'Available materials:', ...materials.map(item => `- ${path.relative(root, item)}`)] : []),
      ...(request.expectedArtifacts.length ? ['', 'Expected artifacts:', ...request.expectedArtifacts.map(item => `- ${item}`)] : []),
    ].join('\n')

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.options.boundary!.launchRestricted({ copyRoot: root, permission: scope, executable,
        args, options: { cwd: root, env: childEnvironment(request.mcp?.bearer), windowsHide: true, shell: false } })
    } catch (cause) { result.reason = `执行器启动失败：${cause instanceof Error ? cause.message : String(cause)}`; return result }
    result.externalChangesPossible = true
    let terminal: 'success' | 'failed' | undefined, summary = '', threadId: string | undefined
    let outputBytes = 0, protocolError = false, buffer = '', diagnostic = ''
    const redact = (value: string) => request.mcp?.bearer ? value.replaceAll(request.mcp.bearer, '[redacted]') : value
    const notify = (event: DelegationEvent) => { try { options.onEvent?.({ ...event, detail: redact(event.detail) }) } catch { /* UI failure cannot alter the process result. */ } }
    let stopping = false, stopBarrier: Promise<void> | undefined, stopConfirmed = false
    let releaseStopWait!: () => void
    const stopWait = new Promise<null>(resolve => { releaseStopWait = () => resolve(null) })
    const stop = () => {
      if (stopping) return
      stopping = true
      setTimeout(releaseStopWait, STOP_WAIT_MS).unref()
      stopBarrier = Promise.allSettled([request.mcp?.revoke() ?? Promise.resolve(),
        this.options.boundary!.stopRestricted(child).then(confirmed => { stopConfirmed = confirmed })]).then(() => undefined)
    }
    const receive = (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_OUTPUT_BYTES) { protocolError = true; stop(); return }
      buffer += chunk.toString('utf8')
      for (;;) {
        const index = buffer.indexOf('\n')
        if (index < 0) break
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1)
        if (!line) continue
        if (Buffer.byteLength(line) > MAX_EVENT_BYTES) { protocolError = true; stop(); return }
        try {
          const parsed = eventFromJson(JSON.parse(line))
          if (parsed.terminal) terminal = parsed.terminal
          if (parsed.summary) summary = redact(parsed.summary)
          if (parsed.threadId) threadId = parsed.threadId
          if (parsed.event) notify(parsed.event)
        } catch { protocolError = true; stop(); return }
      }
      if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) { protocolError = true; stop() }
    }
    child.stdout.on('data', receive)
    child.stderr.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      diagnostic = (diagnostic + chunk.toString('utf8')).slice(-4000)
      if (outputBytes > MAX_OUTPUT_BYTES) { protocolError = true; stop() }
    })
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>(resolve => {
      child.once('error', error => resolve({ code: null, signal: null, error }))
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    options.signal?.addEventListener('abort', stop, { once: true })
    const timeout = setTimeout(stop, request.timeoutMs ?? 15 * 60_000)
    timeout.unref()
    try { child.stdin.end(prompt) } catch { stop() }
    const exited = await Promise.race([exit, stopWait])
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', stop)
    if (stopBarrier) await bounded(stopBarrier, REVOKE_WAIT_MS)
    result.threadId = threadId
    result.exitCode = exited?.code
    result.summary = summary || undefined
    result.diagnostic = diagnostic ? redact(diagnostic.replace(/\u001b\[[0-9;]*m/g, '')).slice(-2000) : undefined
    if (stopping || options.signal?.aborted) {
      const proved = !!exited && stopConfirmed && (!options.confirmStopped || await options.confirmStopped().catch(() => false))
      result.status = proved ? 'cancelled' : 'unknown'
      result.reason = proved ? '委派已停止；已发生的外部磁盘修改仍需检查' : '已撤销文档授权并请求停止，外部进程或副作用尚未完全核实'
      return result
    }
    if (request.mcp) {
      const revoked = await bounded(request.mcp.revoke(), REVOKE_WAIT_MS)
      if (revoked.kind !== 'returned') {
        result.status = 'unknown'; result.reason = '外部执行器已退出，但文档写入授权未能确认撤销'; return result
      }
    }
    if (!exited) { result.status = 'unknown'; result.reason = '外部进程退出状态未知'; return result }
    if (exited.error || protocolError || exited.code !== 0 || terminal !== 'success') {
      result.status = protocolError ? 'unknown' : 'failed'
      result.reason = exited.error ? `执行器异常退出：${exited.error.message}` : protocolError ? '结构化事件不完整，外部副作用待核查'
        : terminal === 'failed' ? '外部执行器报告失败' : exited.code !== 0 ? `执行器退出码 ${exited.code}` : '执行器缺少成功终态事件'
      return result
    }
    const checked = await bounded((async () => {
      const artifacts = await Promise.all(request.expectedArtifacts.map(async name => {
        const actual = await readableInside(root, name)
        return { path: actual, bytes: (await fs.stat(actual)).size }
      }))
      const verification = await options.verify({ copyRoot: root, artifacts, summary })
      return { artifacts, verification }
    })(), request.timeoutMs ?? 15 * 60_000, options.signal)
    if (options.signal?.aborted || checked.kind === 'stopped' || checked.kind === 'expired') {
      result.status = 'unknown'; result.reason = '成果核验未在任务期限内完成，未自动接受迟到结果'
    } else if (checked.kind === 'failed') {
      result.status = 'failed'
      result.reason = `成果回读或核验失败：${checked.error instanceof Error ? checked.error.message : String(checked.error)}`
    } else {
      result.artifacts = checked.value.artifacts
      result.verification = checked.value.verification
      result.status = checked.value.verification.accepted ? 'verified' : 'failed'
      result.reason = checked.value.verification.detail
    }
    return result
  }
}
