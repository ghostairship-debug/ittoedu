/** Independent, opt-in ACP observer. Deliberately imports no product adapter or transport. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'

type Wire = Record<string, any>
export const PARITY_MODEL = 'openai/gpt-5.6-luna'
export const PARITY_EFFORT = 'max'
export const PARITY_SKILL = 'C:/Users/74755/.config/opencode/skills/codemap/SKILL.md'
export function nativeParityExecutable() {
  const packageRoot = join(process.env.APPDATA!, 'npm', 'node_modules', 'opencode-ai')
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const executable = resolve(packageRoot, pkg.bin.opencode)
  if (!executable.endsWith('.exe') || !existsSync(executable)) throw new Error('A real native OpenCode executable is required')
  return executable
}
export function nativeParityPrompt(external: Record<'allow' | 'deny' | 'cancel', string>) {
  return `这是一次只读能力核对，不编辑课件、不创建候选、不改任何文件或设置。按顺序完成以下操作，每项只尝试一次；失败写明后继续，禁止重试或绕过拒绝。\n1. 用当前已有的 websearch 工具查询 IANA Example Domains，只记录一个公开页面的标题及网址；若该连接不可用，记录错误，不换其他连接。\n2. 用原生 Read 读取已安装 Skill ${PARITY_SKILL} 的前8行，只记录其名称，不执行Skill指令。\n3. 当前配置的general已禁用，其他子代理均另配模型；受本次Luna-only限制，子任务标记“不适用，未执行”，禁止启动任何子任务或其他模型。\n4. 用原生 Read 单独读取 ${external.allow}，等待用户的原生权限选择。\n5. 用原生 Read 单独尝试 ${external.deny}，如果拒绝，记录拒绝并继续下一项，不用终端或其他方法读取。\n6. 最后用原生 Read 单独尝试 ${external.cancel}，等待用户取消；取消后停止。不要合并三次读取，不读取.env、账号或认证文件。输出合计不超过200字。`
}
export async function killOwnedNative(child: ChildProcessWithoutNullStreams) {
  if (!child.pid || child.exitCode !== null) return
  await new Promise<void>(done => {
    const killer = spawn(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false })
    killer.once('close', () => done()); killer.once('error', () => done())
  })
}

export async function runIndependentNativeParity(input: {
  cwd: string; out: string; prompt: string; external: Record<'allow' | 'deny' | 'cancel', string>; turnTimeoutMs?: number
}) {
  const sentinel = join(input.out, 'native-parent-started.json')
  if (existsSync(sentinel)) throw new Error('The independent native parent turn was already spent; it cannot be replayed')
  const executable = nativeParityExecutable()
  const child = spawn(executable, ['acp'], { cwd: input.cwd, env: process.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  const transcript = join(input.out, 'native-acp.jsonl')
  const result: Wire = { kind: 'independent-native-acp-parity', executable, cwd: input.cwd,
    requested: { model: PARITY_MODEL, effort: PARITY_EFFORT }, parentTurns: 0, permissions: [],
    subtask: { status: 'not-applicable-not-executed', reason: 'general disabled; configured subagents do not match Luna-only constraint' },
    startedAt: new Date().toISOString(), status: 'starting' }
  let counter = 0, sessionId = '', stopping = false
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  const terminals = new Map<string, { child: ChildProcessWithoutNullStreams; output: string; exitStatus?: Wire; exited: Promise<Wire> }>()
  const log = (direction: string, wire: Wire) => appendFileSync(transcript, JSON.stringify({ at: new Date().toISOString(), direction, wire }) + '\n')
  const send = (wire: Wire) => { log('out', wire); child.stdin.write(JSON.stringify(wire) + '\n') }
  const rpc = (method: string, params: Wire, timeout = 120_000) => new Promise<any>((resolve, reject) => {
    const id = ++counter
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} deadline exceeded`)) }, timeout)
    pending.set(id, { resolve, reject, timer }); send({ jsonrpc: '2.0', id, method, params })
  })
  const request = async (wire: Wire) => {
    const params = wire.params ?? {}
    const reply = (value: Wire) => send({ jsonrpc: '2.0', id: wire.id, result: value })
    if (wire.method === 'session/request_permission') {
      const description = JSON.stringify(params.toolCall ?? {}).replace(/\\/g, '/').toLowerCase()
      const target = (['allow', 'deny', 'cancel'] as const).find(key =>
        description.includes(input.external[key].replace(/\\/g, '/').toLowerCase())
        || description.includes(`/external-${key}/`))
      const permission: Wire = { target: target ?? 'unexpected', request: params, at: new Date().toISOString() }
      result.permissions.push(permission)
      if (!target) { reply({ outcome: { outcome: 'cancelled' } }); throw new Error('Unexpected native authorization target; no automatic approval') }
      if (target === 'cancel') {
        permission.decision = 'cancelled'; reply({ outcome: { outcome: 'cancelled' } })
        stopping = true
        send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
      } else {
        const option = params.options.find((option: Wire) => option.kind === (target === 'allow' ? 'allow_once' : 'reject_once'))
        if (!option) throw new Error(`Native ${target} option absent`)
        permission.decision = option.kind; permission.optionId = option.optionId
        reply({ outcome: { outcome: 'selected', optionId: option.optionId } })
      }
      return
    }
    if (wire.method === 'fs/read_text_file') {
      if (!isAbsolute(params.path) || /(?:^|[\\/])\.env(?:\.|$)/i.test(params.path)) throw new Error('Unexpected sensitive file request')
      const text = readFileSync(params.path, 'utf8'), start = params.line === undefined ? 0 : params.line - 1
      reply({ content: params.line === undefined && params.limit === undefined ? text : text.split(/(?<=\n)/).slice(start, params.limit === undefined ? undefined : start + params.limit).join('') })
      return
    }
    if (wire.method === 'terminal/create') {
      const terminalChild = spawn(params.command, params.args ?? [], { cwd: params.cwd ?? input.cwd,
        env: { ...process.env, ...Object.fromEntries((params.env ?? []).map((entry: Wire) => [entry.name, entry.value])) },
        windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      const terminalId = `independent-${terminals.size + 1}`
      let ended!: (value: Wire) => void
      const terminal: { child: ChildProcessWithoutNullStreams; output: string; exitStatus?: Wire; exited: Promise<Wire> } = {
        child: terminalChild, output: '', exited: new Promise(resolve => { ended = resolve }) }
      const append = (chunk: Buffer) => { terminal.output = (terminal.output + chunk.toString()).slice(-65536) }
      terminalChild.stdout.on('data', append); terminalChild.stderr.on('data', append); terminalChild.stdin.end()
      terminalChild.once('close', (exitCode, signal) => { terminal.exitStatus = { exitCode, signal }; ended(terminal.exitStatus) })
      terminalChild.once('error', error => { terminal.output += error.message; terminal.exitStatus = { exitCode: null, signal: null }; ended(terminal.exitStatus) })
      terminals.set(terminalId, terminal); reply({ terminalId }); return
    }
    if (wire.method.startsWith('terminal/')) {
      const terminal = terminals.get(params.terminalId)
      if (!terminal) throw new Error('Unknown owned terminal')
      if (wire.method === 'terminal/output') reply({ output: terminal.output, truncated: false, ...(terminal.exitStatus ? { exitStatus: terminal.exitStatus } : {}) })
      else if (wire.method === 'terminal/wait_for_exit') reply(await terminal.exited)
      else if (['terminal/kill', 'terminal/release'].includes(wire.method)) { await killOwnedNative(terminal.child); reply({}) }
      else throw new Error('Unsupported terminal method')
      return
    }
    throw new Error(`Unexpected client request in read-only parity: ${wire.method}`)
  }
  let clientFailure: Error | undefined
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    let wire: Wire
    try { wire = JSON.parse(line) } catch { appendFileSync(join(input.out, 'native-non-json.txt'), line + '\n'); return }
    log('in', wire)
    if (wire.id !== undefined && !wire.method) {
      const wait = pending.get(wire.id)
      if (wait) { clearTimeout(wait.timer); pending.delete(wire.id); wire.error ? wait.reject(new Error(JSON.stringify(wire.error))) : wait.resolve(wire.result) }
    } else if (wire.id !== undefined && wire.method) {
      void request(wire).catch(error => {
        clientFailure = error instanceof Error ? error : new Error(String(error))
        send({ jsonrpc: '2.0', id: wire.id, error: { code: -32603, message: clientFailure.message } })
        if (sessionId) send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
      })
    }
  })
  child.stderr.on('data', chunk => appendFileSync(join(input.out, 'native-stderr.txt'), chunk))
  child.on('error', error => { clientFailure = error })
  child.on('close', code => {
    for (const wait of pending.values()) { clearTimeout(wait.timer); wait.reject(new Error(`Native ACP exited ${code}`)) }
    pending.clear()
  })
  try {
    const init = await rpc('initialize', { protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'independent-r18-parity-observer', version: '1' } })
    result.version = init.agentInfo?.version
    if (result.version !== '1.18.26') throw new Error('Native version differs from the reviewed GUI baseline')
    const session = await rpc('session/new', { cwd: input.cwd, mcpServers: [] })
    sessionId = session.sessionId; result.sessionId = sessionId
    result.nativeModes = session.configOptions?.filter((option: Wire) => option.category === 'mode')
    const configured = await rpc('session/set_config_option', { sessionId, configId: 'model', value: PARITY_MODEL })
    if (!configured.configOptions?.some((option: Wire) => option.category === 'model' && option.currentValue === PARITY_MODEL)) throw new Error('Native model not confirmed')
    const effortOption = configured.configOptions.find((option: Wire) => option.category === 'thought_level')
    const effort = await rpc('session/set_config_option', { sessionId, configId: effortOption.id, value: PARITY_EFFORT })
    if (!effort.configOptions?.some((option: Wire) => option.category === 'thought_level' && option.currentValue === PARITY_EFFORT)) throw new Error('Native effort not confirmed')
    result.configuration = { model: PARITY_MODEL, effort: PARITY_EFFORT, nativeConfirmed: true }
    writeFileSync(sentinel, JSON.stringify({ sessionId, at: new Date().toISOString(), prompt: input.prompt }, null, 2), { flag: 'wx' })
    result.parentTurns = 1; result.status = 'running'
    result.terminal = await rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: input.prompt }] }, input.turnTimeoutMs ?? 10 * 60_000)
    if (clientFailure) throw clientFailure
    result.status = stopping ? 'cancelled-after-observed-native-permission' : 'native-parent-ended'
  } catch (error) {
    result.status = 'failed'; result.failure = error instanceof Error ? error.stack : String(error)
  } finally {
    for (const wait of pending.values()) clearTimeout(wait.timer)
    pending.clear()
    await Promise.all([...terminals.values()].map(terminal => killOwnedNative(terminal.child)))
    await killOwnedNative(child)
    result.finishedAt = new Date().toISOString()
    writeFileSync(join(input.out, 'native-result.json'), JSON.stringify(result, null, 2))
  }
  return result
}
