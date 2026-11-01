import { spawn } from 'node:child_process'
import path from 'node:path'

/** Keep account/provider secrets out of tools. Native Python runs as the current user. */
export function pythonEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of ['Path', 'PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE',
    'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'LANG', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR'])
    if (process.env[name]) env[name] = process.env[name]
  return { ...env, ...extra }
}

export async function runPythonProcess(executable: string, args: readonly string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number; log?(line: string): void
  onStop?(confirmed: boolean): void
} = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  options.signal?.throwIfAborted()
  const child = spawn(executable, [...args], { cwd: options.cwd, env: options.env ?? pythonEnvironment(),
    shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', failure: Error | undefined
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk; options.log?.(chunk) })
  child.stderr.on('data', (chunk: string) => { stderr += chunk; options.log?.(chunk) })
  let didClose = false
  const closed = new Promise<number | null>(resolve => {
    child.once('error', error => { failure = error })
    child.once('close', code => { didClose = true; resolve(code) })
  })
  let stopping: Promise<void> | undefined
  const stop = () => stopping ??= (async () => {
    let confirmed = false
    try {
      if (didClose || !child.pid) { confirmed = true; return }
      if (child.exitCode !== null || child.signalCode !== null) return
      if (process.platform === 'win32') {
        const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false })
        confirmed = await new Promise<boolean>(resolve => { killer.once('error', () => resolve(false)); killer.once('close', code => resolve(code === 0)) })
      } else { try { process.kill(-child.pid, 'SIGKILL'); confirmed = true } catch { /* Stop was not confirmed. */ } }
    } finally {
      // A descendant can retain these pipes after the parent exits. Stopping
      // releases our readers without waiting for that descendant to send EOF.
      options.onStop?.(confirmed)
      child.stdout.destroy(); child.stderr.destroy()
    }
  })()
  const abort = () => { void stop() }
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = options.timeoutMs ? setTimeout(() => {
    failure = new Error('Python 进程执行超时'); failure.name = 'TimeoutError'
    abort()
  }, options.timeoutMs) : undefined
  try {
    if (options.signal?.aborted) abort()
    const code = await closed
    if (stopping) await stopping
    options.signal?.throwIfAborted()
    if (failure) throw failure
    return { code, stdout, stderr }
  } finally {
    if (timer) clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
