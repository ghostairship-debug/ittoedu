import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { LocalAgentId } from '../../shared/localAgentContract'

export interface AgentExecutable { executable: string; prefix: string[] }
const packages = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code', opencode: 'opencode-ai' }
export function agentEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'userprofile', 'homedrive', 'homepath', 'home', 'appdata', 'localappdata', 'temp', 'tmp', 'lang', 'lc_all', 'https_proxy', 'http_proxy', 'no_proxy'])
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())))
}
async function file(filename: string): Promise<boolean> { return fs.stat(filename).then(s => s.isFile(), () => false) }
/** Resolve native binaries or the fixed npm package bin. Never execute a cmd/ps1 shim. */
export async function resolveAgentExecutable(id: LocalAgentId): Promise<AgentExecutable | null> {
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(p => path.isAbsolute(p))
  if (process.env.APPDATA) directories.push(path.join(process.env.APPDATA, 'npm'))
  if (process.env.USERPROFILE) directories.push(path.join(process.env.USERPROFILE, '.local', 'bin'))
  for (const dir of new Set(directories)) {
    const native = path.join(dir, process.platform === 'win32' ? `${id}.exe` : id)
    if (await file(native)) return { executable: await fs.realpath(native), prefix: [] }
    const root = path.join(dir, 'node_modules', packages[id])
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[id]
      if (typeof bin !== 'string') continue
      const target = await fs.realpath(path.resolve(root, bin))
      const relative = path.relative(await fs.realpath(root), target)
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue
      if (target.endsWith('.exe')) return { executable: target, prefix: [] }
      if (!target.endsWith('.js')) continue
      for (const nodeDir of directories) {
        const node = path.join(nodeDir, process.platform === 'win32' ? 'node.exe' : 'node')
        if (await file(node)) return { executable: await fs.realpath(node), prefix: [target] }
      }
    } catch { /* Missing or incomplete installations are not executable. */ }
  }
  return null
}
export function launchAgent(binary: AgentExecutable, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  if (!path.isAbsolute(binary.executable) || /\.(cmd|bat|ps1)$/i.test(binary.executable)) throw new Error('CLI executable must be a resolved native program')
  return spawn(binary.executable, [...binary.prefix, ...args], {
    cwd, env: agentEnvironment(), shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
  })
}
export async function stopAgent(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    const system = process.env.SystemRoot ?? 'C:\\Windows'
    await new Promise<void>((resolve, reject) => {
      const kill = spawn(path.join(system, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' })
      kill.once('error', reject)
      kill.once('close', code => code === 0 || child.exitCode !== null ? resolve() : reject(new Error('Could not stop CLI process tree')))
    })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  }
}
export async function captureAgent(binary: AgentExecutable, args: string[], cwd: string): Promise<{ code: number | null; text: string }> {
  const child = launchAgent(binary, args, cwd)
  child.stdin.end()
  let text = ''
  let exceeded = false
  const timer = setTimeout(() => { exceeded = true; void stopAgent(child).catch(() => child.kill()) }, 10000)
  return new Promise((resolve, reject) => {
    const accept = (data: Buffer) => {
      if (exceeded) return
      text += data.toString('utf8')
      if (text.length > 64000) { exceeded = true; void stopAgent(child).catch(() => child.kill()) }
    }
    child.stdout.on('data', accept); child.stderr.on('data', accept)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); exceeded ? reject(new Error('CLI probe timed out or exceeded output limit')) : resolve({ code, text }) })
  })
}
