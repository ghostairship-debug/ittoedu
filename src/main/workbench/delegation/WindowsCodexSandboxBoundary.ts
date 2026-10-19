import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { CodexDelegationBoundaryPort } from './CodexDelegationRunner'

const execFileAsync = promisify(execFile)
const profile = (permission: 'read-only' | 'workspace') => permission === 'read-only' ? ':read-only' : ':workspace'
const probeCode = 'try { require("node:fs").writeFileSync(process.argv[1], "probe", {flag:"wx"}); process.stdout.write("written") } catch (error) { process.stdout.write(error.code || "failed") }'

function probeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
  for (const name of ['Path', 'PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'CODEX_HOME'])
    if (process.env[name]) environment[name] = process.env[name]
  return environment
}

/** Checks the native sandbox and launches Codex with its generated tools sandboxed. */
export class WindowsCodexSandboxBoundary implements CodexDelegationBoundaryPort {
  private readonly verified = new Map<string, { identity: string; signal?: AbortSignal; dispose(): void }>()
  constructor(private readonly options: { nodeExecutable?: string; taskkillExecutable?: string } = {}) {}

  private key(copyRoot: string, permission: 'read-only' | 'workspace', executable: string): string {
    return JSON.stringify([copyRoot, permission, executable])
  }

  private identity(copyRoot: string, executable: string): string {
    const root = statSync(copyRoot), binary = statSync(executable)
    if (!root.isDirectory() || !binary.isFile()) throw new Error('受限执行根或可执行文件已变化')
    const configuration = (filename: string) => {
      try { return createHash('sha256').update(readFileSync(filename)).digest('hex') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    }
    const codexHome = path.resolve(process.env.CODEX_HOME || path.join(homedir(), '.codex'))
    return JSON.stringify({ root: [root.dev, root.ino, root.birthtimeMs],
      binary: [binary.dev, binary.ino, binary.birthtimeMs, binary.size, binary.mtimeMs],
      codexHome, configuration: configuration(path.join(codexHome, 'config.toml')),
      workspaceConfiguration: configuration(path.join(copyRoot, '.codex', 'config.toml')),
      nodeExecutable: this.options.nodeExecutable ?? process.execPath })
  }

  private clear(key: string): void {
    this.verified.get(key)?.dispose(); this.verified.delete(key)
  }

  private consume(copyRoot: string, permission: 'read-only' | 'workspace', executable: string, signal?: AbortSignal): void {
    const root = realpathSync(copyRoot), binary = realpathSync(executable), key = this.key(root, permission, binary)
    const verified = this.verified.get(key)
    this.clear(key)
    signal?.throwIfAborted()
    if (!verified || verified.signal !== signal || verified.signal?.aborted || verified.identity !== this.identity(root, binary))
      throw new Error('受限执行边界未对这份工作副本、配置与启动完成当次探针')
  }

  private async probe(executable: string, copyRoot: string, permission: 'read-only' | 'workspace', target: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const result = await execFileAsync(executable, ['sandbox', '-P', profile(permission), '-C', copyRoot, '--',
      this.options.nodeExecutable ?? process.execPath, '-e', probeCode, target],
    { windowsHide: true, env: probeEnvironment(), timeout: 10_000, maxBuffer: 64 * 1024, signal })
    return result.stdout.trim()
  }

  /** A fresh no-model probe checks inside and outside writes for this exact copy and CLI. */
  async assertReady(copyRoot: string, permission: 'read-only' | 'workspace', executable: string, options: { signal?: AbortSignal } = {}): Promise<boolean> {
    if (options.signal?.aborted || process.platform !== 'win32' || !path.isAbsolute(copyRoot) || !path.isAbsolute(executable)) return false
    let root: string, binary: string
    try {
      root = await fs.realpath(copyRoot); binary = await fs.realpath(executable)
      if (!(await fs.stat(root)).isDirectory() || !(await fs.stat(binary)).isFile()) return false
    } catch { return false }
    const key = this.key(root, permission, binary)
    this.clear(key)
    const inside = path.join(root, `.guoling-boundary-${randomUUID()}.tmp`)
    let outsideDir: string | undefined
    try {
      options.signal?.throwIfAborted()
      const identity = this.identity(root, binary)
      outsideDir = await fs.mkdtemp(path.join(path.dirname(root), '.guoling-boundary-'))
      const outside = path.join(outsideDir, 'probe.tmp')
      const insideResult = await this.probe(binary, root, permission, inside, options.signal)
      const outsideResult = await this.probe(binary, root, permission, outside, options.signal)
      options.signal?.throwIfAborted()
      const ready = (permission === 'workspace' ? insideResult === 'written' : ['EPERM', 'EACCES'].includes(insideResult))
        && ['EPERM', 'EACCES'].includes(outsideResult)
        && identity === this.identity(root, binary)
      if (ready) {
        const invalidate = () => { if (this.verified.get(key) === entry) this.clear(key) }
        const entry = { identity, signal: options.signal, dispose: () => options.signal?.removeEventListener('abort', invalidate) }
        this.verified.set(key, entry)
        options.signal?.addEventListener('abort', invalidate, { once: true })
        if (options.signal?.aborted) invalidate()
      }
      return ready && !options.signal?.aborted
    } catch { return false }
    finally {
      await fs.rm(inside, { force: true }).catch(() => undefined)
      if (outsideDir) {
        await fs.rm(path.join(outsideDir, 'probe.tmp'), { force: true }).catch(() => undefined)
        await fs.rmdir(outsideDir).catch(() => undefined)
      }
    }
  }

  launchRestricted(input: { copyRoot: string; permission: 'read-only' | 'workspace'; executable: string;
    args: readonly string[]; options: Parameters<CodexDelegationBoundaryPort['launchRestricted']>[0]['options']; signal?: AbortSignal }): ChildProcessWithoutNullStreams {
    this.consume(input.copyRoot, input.permission, input.executable, input.signal)
    if (input.options.cwd !== input.copyRoot || input.options.shell)
      throw new Error('受限执行边界未对这份工作副本完成当次探针')
    const expected = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
      '-m', 'gpt-6-luna', '-s', input.permission === 'read-only' ? 'read-only' : 'workspace-write',
      '-c', 'approval_policy="never"', '-c', 'service_tier="priority"', '-C', input.copyRoot]
    if (input.args.slice(0, expected.length).some((arg, index) => arg !== expected[index]))
      throw new Error('委派命令未固定 Luna Fast、权限与工作副本')
    const tail = input.args.slice(expected.length)
    if (tail.length !== 1 || tail[0] !== '-') throw new Error('委派命令包含未授权的 CLI 参数')
    // The trusted CLI needs access to its own login and app-server state. Its model-generated
    // commands use the verified Windows sandbox via `exec -s`; wrapping the whole CLI would
    // also deny trusted CODEX_HOME writes and prevent the model turn from starting.
    return spawn(input.executable, [...input.args], { ...input.options, stdio: 'pipe' })
  }

  /** No model invocation. The caller separately owns the human's exact command approval. */
  launchToolRestricted(input: { copyRoot: string; sandboxExecutable: string; executable: string; args: readonly string[];
    options: Parameters<CodexDelegationBoundaryPort['launchRestricted']>[0]['options']; signal?: AbortSignal }): ChildProcessWithoutNullStreams {
    this.consume(input.copyRoot, 'workspace', input.sandboxExecutable, input.signal)
    if (input.options.cwd !== input.copyRoot
      || !path.isAbsolute(input.executable) || input.options.shell)
      throw new Error('本地工具的受限执行边界尚未对批准工作副本验证')
    return spawn(input.sandboxExecutable, ['sandbox', '-P', profile('workspace'), '-C', input.copyRoot, '--',
      input.executable, ...input.args], { ...input.options, stdio: 'pipe' })
  }

  async stopRestricted(child: ChildProcessWithoutNullStreams): Promise<boolean> {
    if (child.exitCode !== null) return true
    if (!child.pid) return false
    const taskkill = this.options.taskkillExecutable
      ?? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
    try {
      await execFileAsync(taskkill, ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000, maxBuffer: 16 * 1024 })
      return true
    } catch { return false }
  }
}
