import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
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
  private readonly verified = new Map<string, number>()
  constructor(private readonly options: { nodeExecutable?: string; taskkillExecutable?: string } = {}) {}

  private key(copyRoot: string, permission: 'read-only' | 'workspace', executable: string): string {
    return JSON.stringify([copyRoot, permission, executable])
  }

  private async probe(executable: string, copyRoot: string, permission: 'read-only' | 'workspace', target: string): Promise<string> {
    const result = await execFileAsync(executable, ['sandbox', '-P', profile(permission), '-C', copyRoot, '--',
      this.options.nodeExecutable ?? process.execPath, '-e', probeCode, target],
    { windowsHide: true, env: probeEnvironment(), timeout: 10_000, maxBuffer: 64 * 1024 })
    return result.stdout.trim()
  }

  /** A fresh no-model probe checks inside and outside writes for this exact copy and CLI. */
  async assertReady(copyRoot: string, permission: 'read-only' | 'workspace', executable: string): Promise<boolean> {
    if (process.platform !== 'win32' || !path.isAbsolute(copyRoot) || !path.isAbsolute(executable)) return false
    let root: string, binary: string
    try {
      root = await fs.realpath(copyRoot); binary = await fs.realpath(executable)
      if (!(await fs.stat(root)).isDirectory() || !(await fs.stat(binary)).isFile()) return false
    } catch { return false }
    const inside = path.join(root, `.guoling-boundary-${randomUUID()}.tmp`)
    let outsideDir: string | undefined
    try {
      outsideDir = await fs.mkdtemp(path.join(path.dirname(root), '.guoling-boundary-'))
      const outside = path.join(outsideDir, 'probe.tmp')
      const insideResult = await this.probe(binary, root, permission, inside)
      const outsideResult = await this.probe(binary, root, permission, outside)
      const ready = (permission === 'workspace' ? insideResult === 'written' : ['EPERM', 'EACCES'].includes(insideResult))
        && ['EPERM', 'EACCES'].includes(outsideResult)
      if (ready) this.verified.set(this.key(root, permission, binary), Date.now())
      return ready
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
    args: readonly string[]; options: Parameters<CodexDelegationBoundaryPort['launchRestricted']>[0]['options'] }): ChildProcessWithoutNullStreams {
    const verified = this.verified.get(this.key(input.copyRoot, input.permission, input.executable))
    if (!verified || Date.now() - verified > 60_000 || input.options.cwd !== input.copyRoot)
      throw new Error('受限执行边界未对这份工作副本完成当次探针')
    const expected = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
      '-m', 'gpt-6-luna', '-s', input.permission === 'read-only' ? 'read-only' : 'workspace-write',
      '-c', 'approval_policy="never"', '-c', 'service_tier="priority"', '-C', input.copyRoot]
    if (input.args.slice(0, expected.length).some((arg, index) => arg !== expected[index]))
      throw new Error('委派命令未固定 Luna Fast、权限与工作副本')
    const tail = input.args.slice(expected.length)
    if (tail.length !== 1 || tail[0] !== '-') throw new Error('委派命令包含未授权的 CLI 参数')
    this.verified.delete(this.key(input.copyRoot, input.permission, input.executable))
    // The trusted CLI needs access to its own login and app-server state. Its model-generated
    // commands use the verified Windows sandbox via `exec -s`; wrapping the whole CLI would
    // also deny trusted CODEX_HOME writes and prevent the model turn from starting.
    return spawn(input.executable, [...input.args], { ...input.options, stdio: 'pipe' })
  }

  async stopRestricted(child: ChildProcessWithoutNullStreams): Promise<boolean> {
    if (child.exitCode !== null) return false
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
