import { promises as fs } from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { LocalToolRunIntent } from '../../../shared/workbench/toolPorts'
import { discoverNativeCodexExecutable, type DelegationEvent, type DelegationExecutionResult } from './CodexDelegationRunner'
import { WindowsCodexSandboxBoundary } from './WindowsCodexSandboxBoundary'

export interface PreparedLocalCommand {
  executable: string
  args: readonly string[]
  cwd: string
  sandboxExecutable: string
  stdin?: string
  timeoutMs?: number
}
export interface LocalToolRunOptions { signal?: AbortSignal; onEvent?(event: DelegationEvent): void }

/** Provider credentials are never inherited by local tools or their children. */
function localEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
  for (const name of ['Path', 'PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'CODEX_HOME'])
    if (process.env[name]) environment[name] = process.env[name]
  return environment
}

async function executablePath(command: string): Promise<string> {
  if (!command.trim() || command.includes('\0')) throw new Error('本地工具命令无效')
  const candidates = path.isAbsolute(command) ? [command] : /[/\\]/.test(command) ? []
    : (process.env.Path || process.env.PATH || '').split(path.delimiter).filter(Boolean)
      .flatMap(directory => [path.join(directory, command), ...(path.extname(command) ? [] : [path.join(directory, command + '.exe')])])
  for (const candidate of candidates) {
    try {
      const real = await fs.realpath(candidate)
      if ((await fs.stat(real)).isFile() && /\.exe$/i.test(real)) return real
    } catch { /* Inspect the next installed executable, never install or invoke a shell. */ }
  }
  throw new Error('未找到已安装的原生可执行工具；请使用真实 EXE 路径或 PATH 中的名称')
}

/** An exact approved command over a managed copy, using the existing native boundary and process-tree stop. */
export class LocalToolRunner {
  constructor(private readonly options: { boundary?: WindowsCodexSandboxBoundary; sandboxExecutable?: string } = {}) {}

  async prepare(cwd: string, intent: LocalToolRunIntent): Promise<PreparedLocalCommand> {
    if (process.platform !== 'win32') throw new Error('当前已接入的本地工具隔离边界仅支持 Windows')
    if (!path.isAbsolute(cwd)) throw new Error('本地工具工作目录必须由宿主准备')
    if (intent.args?.some(arg => typeof arg !== 'string' || arg.includes('\0'))
      || intent.timeoutMs !== undefined && (!Number.isSafeInteger(intent.timeoutMs) || intent.timeoutMs < 1))
      throw new Error('本地工具参数、输入或超时无效')
    const sandbox = this.options.sandboxExecutable ?? await discoverNativeCodexExecutable()
    if (!sandbox) throw new Error('未找到已有原生 Codex sandbox；未安装或启动模型')
    return { executable: await executablePath(intent.command), args: [...(intent.args ?? [])], cwd,
      sandboxExecutable: await fs.realpath(sandbox), ...(intent.stdin !== undefined ? { stdin: intent.stdin } : {}),
      ...(intent.timeoutMs !== undefined ? { timeoutMs: intent.timeoutMs } : {}) }
  }

  async run(taskId: string, command: PreparedLocalCommand, options: LocalToolRunOptions = {}): Promise<DelegationExecutionResult> {
    const result: DelegationExecutionResult = { taskId, status: 'unconfigured', artifacts: [], reason: '', externalChangesPossible: false }
    const boundary = this.options.boundary ?? new WindowsCodexSandboxBoundary()
    if (options.signal?.aborted) return { ...result, status: 'cancelled', reason: '本地工具在启动前已停止' }
    if (!await boundary.assertReady(command.cwd, 'workspace', command.sandboxExecutable))
      return { ...result, reason: '本地工具工作副本的受限执行边界尚不可用，未启动命令' }
    if (options.signal?.aborted) return { ...result, status: 'cancelled', reason: '本地工具在启动前已停止' }
    const child = boundary.launchToolRestricted({ copyRoot: command.cwd, sandboxExecutable: command.sandboxExecutable,
      executable: command.executable, args: command.args,
      options: { cwd: command.cwd, env: localEnvironment(), windowsHide: true, shell: false } })
    result.externalChangesPossible = true
    const emit = (event: DelegationEvent) => { try { options.onEvent?.(event) } catch { /* A view cannot control the process. */ } }
    emit({ kind: 'started', detail: `本地工具已启动：${path.basename(command.executable)}` })
    const stdout = new StringDecoder('utf8'), stderr = new StringDecoder('utf8')
    child.stdout.on('data', (chunk: Buffer) => { const detail = stdout.write(chunk); if (detail) emit({ kind: 'stdout', detail }) })
    child.stderr.on('data', (chunk: Buffer) => { const detail = stderr.write(chunk); if (detail) emit({ kind: 'stderr', detail }) })
    const exit = new Promise<{ code: number | null; error?: Error }>(resolve => {
      child.once('error', error => resolve({ code: null, error }))
      child.once('close', code => resolve({ code }))
    })
    let stopWork: Promise<boolean> | undefined, stopTimer: ReturnType<typeof setTimeout> | undefined, timedOut = false
    let stopped!: () => void
    const stoppedWait = new Promise<null>(resolve => { stopped = () => resolve(null) })
    const stop = () => {
      if (stopWork) return
      stopWork = boundary.stopRestricted(child).catch(() => false)
      stopTimer = setTimeout(stopped, 5000); stopTimer.unref()
    }
    options.signal?.addEventListener('abort', stop, { once: true })
    const timer = command.timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; stop() }, command.timeoutMs)
    try {
      if (options.signal?.aborted) stop()
      child.stdin.on('error', () => undefined)
      child.stdin.end(command.stdin ?? '')
      const exited = await Promise.race([exit, stoppedWait])
      const outTail = stdout.end(), errTail = stderr.end()
      if (outTail) emit({ kind: 'stdout', detail: outTail })
      if (errTail) emit({ kind: 'stderr', detail: errTail })
      result.exitCode = exited?.code
      if (stopWork) {
        const confirmed = await stopWork
        result.status = exited && confirmed ? 'cancelled' : 'unknown'
        result.reason = exited && confirmed ? timedOut ? '本地工具达到时长限制，进程树已停止' : '本地工具进程树已停止'
          : '已请求停止本地工具，但进程树退出尚未核实；未重放'
      } else if (!exited || exited.error || exited.code !== 0) {
        result.status = 'failed'; result.reason = exited?.error ? `本地工具启动失败：${exited.error.message}` : `本地工具退出码 ${exited?.code ?? '未知'}`
      } else {
        result.status = 'verified'; result.reason = '本地工具进程完成，退出码 0；成果仍由父任务决定是否正式应用'
      }
      emit({ kind: result.status === 'verified' ? 'finished' : 'error', detail: result.reason })
      return result
    } finally {
      if (timer) clearTimeout(timer)
      if (stopTimer) clearTimeout(stopTimer)
      options.signal?.removeEventListener('abort', stop)
    }
  }
}
