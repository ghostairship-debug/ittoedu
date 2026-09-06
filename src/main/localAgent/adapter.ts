import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { localAgentProbeSchema, type LocalAgentCliAdapterV1, type LocalAgentId, type LocalAgentProbe } from '../../shared/localAgentContract'
import { captureAgent, launchAgent, resolveAgentExecutable, stopAgent, type AgentExecutable } from './process'

export function agentArguments(id: LocalAgentId, prompt: string, externalId?: string): string[] {
  if (id === 'codex') return ['exec', '-c', 'sandbox_mode="read-only"', '-c', 'suppress_unstable_features_warning=true', ...(externalId ? ['resume', externalId] : ['--color', 'never']), '--json', '--skip-git-repo-check', '-']
  if (id === 'claude') return ['-p', '--output-format', 'stream-json', '--verbose', ...(externalId ? ['--resume', externalId] : [])]
  return ['run', '--format', 'json', '--model', 'opencode/big-pickle', ...(externalId ? ['--session', externalId] : [])]
}
export class LocalAgentAdapter implements LocalAgentCliAdapterV1 {
  private child?: ChildProcessWithoutNullStreams
  private cancelled = false
  constructor(readonly id: LocalAgentId, private readonly resolve = resolveAgentExecutable) {}
  async probe(): Promise<LocalAgentProbe> {
    const result = (status: LocalAgentProbe['status'], message: string, version?: string) => localAgentProbeSchema.parse({ adapter: this.id, status, message, version })
    try {
      const binary = await this.resolve(this.id)
      if (!binary) return result('missing', '请自行安装 CLI')
      const info = await captureAgent(binary, ['--version'], process.cwd())
      const version = info.text.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
      const major = Number(version?.split('.')[0]); const minor = Number(version?.split('.')[1])
      if (info.code !== 0 || !version || (this.id === 'codex' ? major !== 0 || minor < 153 : this.id === 'claude' ? major !== 2 : major !== 1)) return result('unsupported-version', 'CLI 版本不在当前协议范围内', version)
      if (this.id === 'opencode') return result('unknown-auth', '已安装；认证状态在运行时由 CLI 报告', version)
      const auth = await captureAgent(binary, this.id === 'codex' ? ['login', 'status'] : ['auth', 'status'], process.cwd())
      let authenticated = auth.code === 0
      if (this.id === 'claude') authenticated = authenticated && JSON.parse(auth.text).loggedIn === true
      return result(authenticated ? 'ready' : 'unauthenticated', authenticated ? 'CLI 可用' : '请在 CLI 中自行登录', version)
    } catch { return result('launch', 'CLI 探测失败，请检查本地安装') }
  }
  start(prompt: string, cwd: string): AsyncIterable<unknown> { return this.run(prompt, cwd) }
  resume(externalId: string, prompt: string, cwd: string): AsyncIterable<unknown> { return this.run(prompt, cwd, externalId) }
  private async *run(prompt: string, cwd: string, externalId?: string): AsyncGenerator<unknown> {
    if (this.child) throw new Error('Adapter already running')
    this.cancelled = false
    const binary: AgentExecutable | null = await this.resolve(this.id)
    if (this.cancelled) return
    if (!binary) throw new Error('missing')
    let child: ChildProcessWithoutNullStreams
    try { child = this.child = launchAgent(binary, agentArguments(this.id, prompt, externalId), cwd) }
    catch { throw new Error('launch') }
    let stderr = ''
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString('utf8')).slice(-4000) })
    const closed = new Promise<{ code: number | null; error?: Error }>(resolve => {
      child.once('error', error => resolve({ code: null, error }))
      child.once('close', code => resolve({ code }))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
    const decoder = new StringDecoder('utf8')
    let buffer = ''; let total = 0
    try {
      for await (const chunk of child.stdout) {
        if (this.cancelled) break
        total += chunk.length
        if (total > 8 * 1024 * 1024) throw new Error('output-limit')
        buffer += decoder.write(chunk)
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1)
          if (line.length > 1024 * 1024) throw new Error('output-limit')
          if (line) { try { yield JSON.parse(line) } catch { throw new Error('protocol') } }
        }
        if (buffer.length > 1024 * 1024) throw new Error('output-limit')
      }
      buffer += decoder.end()
      if (!this.cancelled && buffer.trim()) { try { yield JSON.parse(buffer) } catch { throw new Error('protocol') } }
      const exit = await closed
      if (!this.cancelled && exit.error) throw new Error('launch')
      if (!this.cancelled && (exit.error || exit.code !== 0)) throw new Error(/unauth|not logged|authentication|api.key/i.test(stderr) ? 'unauthenticated' : 'crash')
    } finally { await stopAgent(child); this.child = undefined }
  }
  async cancel(): Promise<void> { this.cancelled = true; if (this.child) await stopAgent(this.child) }
}
