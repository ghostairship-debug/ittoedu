/** Explicitly invoked real CLI probe against the resident MCP endpoint. No SDK client, credential file reads, model fallback or automatic paid retry. */
import { spawn } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DocumentHostService } from '../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../src/main/workbench/conversations/ConversationStore'
import { AgentFileService } from '../src/main/workbench/execution/AgentFileService'
import { ExecutionEventStore } from '../src/main/workbench/execution/ExecutionEventStore'
import { ExternalMcpService } from '../src/main/workbench/external/ExternalMcpService'
import { DEFAULT_EXTERNAL_MCP_SETTINGS, type ExternalMcpSettings } from '../src/shared/workbench/external'

type ClientName = 'codex' | 'opencode'
const TOOLS = ['file.open', 'file.patch', 'file.read', 'operation.recent']
async function main() {
const requested = process.argv.find(arg => arg.startsWith('--clients='))?.split('=')[1]?.split(',') ?? ['codex', 'opencode']
if (requested.some(client => client !== 'codex' && client !== 'opencode')) throw new Error('Only the authorized Luna CLI routes are supported')
const clients = requested as ClientName[]
const execute = process.argv.includes('--run')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const directory = path.resolve('output/g20/s12-cli', stamp)
const workspace = path.join(directory, 'space')
await mkdir(workspace, { recursive: true })
const toolsRoot = path.join(process.env.APPDATA!, 'npm/node_modules')
const binaries = { codex: { executable: process.execPath, prefix: [path.join(toolsRoot, '@openai/codex/bin/codex.js')] },
  opencode: { executable: path.join(toolsRoot, 'opencode-ai/bin/opencode.exe'), prefix: [] as string[] } }
const redactions = new Set<string>()
const redact = (value: string) => [...redactions].reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value)
  .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
async function launch(client: ClientName, args: string[], env: NodeJS.ProcessEnv = {}, timeoutMs = 30_000) {
  const { executable, prefix } = binaries[client], startedAt = Date.now()
  return await new Promise<{ exitCode: number | null; elapsedMs: number; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(executable, [...prefix, ...args], { cwd: directory, env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      else child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', value => { stdout += String(value) })
    child.stderr.on('data', value => { stderr += String(value) })
    child.on('error', cause => { clearTimeout(timer); reject(cause) })
    child.on('close', exitCode => { clearTimeout(timer); resolve({ exitCode, elapsedMs: Date.now() - startedAt, stdout: redact(stdout), stderr: redact(stderr), timedOut }) })
    child.stdin.end()
  })
}
async function verifyCodexConfig(configArgs: string[], env: NodeJS.ProcessEnv) {
  const configHome = path.join(directory, 'codex-config-check')
  await mkdir(configHome, { recursive: true })
  const child = spawn(binaries.codex.executable, [...binaries.codex.prefix, 'app-server', ...configArgs],
    { cwd: directory, env: { ...process.env, ...env, CODEX_HOME: configHome }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const config = await new Promise<Record<string, any>>((resolve, reject) => {
    let buffered = '', stderr = ''
    const timer = setTimeout(() => reject(new Error('Codex no-fee config/read timed out')), 15_000)
    const finish = (cause?: Error, value?: Record<string, any>) => { clearTimeout(timer); cause ? reject(cause) : resolve(value!) }
    child.once('error', cause => finish(cause))
    child.stderr.on('data', value => { stderr += String(value) })
    child.once('close', () => finish(new Error('Codex config process ended before read: ' + redact(stderr))))
    child.stdout.on('data', value => {
      buffered += String(value)
      const lines = buffered.split('\n'); buffered = lines.pop()!
      for (const line of lines) {
        let message: any; try { message = JSON.parse(line) } catch { continue }
        if (message.id === 1) {
          if (message.error) return finish(new Error(JSON.stringify(message.error)))
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'config/read', params: { includeLayers: false } }) + '\n')
        } else if (message.id === 2) {
          if (message.error) return finish(new Error(JSON.stringify(message.error)))
          finish(undefined, message.result.config)
        }
      }
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'g20-no-fee-config-check', version: '1' } } }) + '\n')
  }).finally(() => child.kill())
  const effective = config.mcp_servers?.guoling
  await writeFile(path.join(directory, 'codex-effective-mcp-config.json'), JSON.stringify(effective ?? {}, null, 2))
  if (effective?.default_tools_approval_mode !== 'approve' || JSON.stringify(effective.enabled_tools) !== JSON.stringify(TOOLS))
    throw new Error('Codex effective MCP preauthorization did not match the authorized tools; no model request started')
}
const versions = Object.fromEntries(await Promise.all(clients.map(async client => [client, (await launch(client, ['--version'])).stdout.trim()])))
const routes = { codex: { model: 'gpt-5.6-luna', provider: 'OpenAI', auth: 'ChatGPT OAuth', requestedServiceTier: 'fast', billing: 'existing ChatGPT account; plan/actual charge not inferred' },
  opencode: { model: 'openai/gpt-5.6-luna-fast', apiModel: 'gpt-5.6-luna', provider: 'OpenAI', auth: 'OAuth', requestedServiceTier: 'priority', billing: 'existing ChatGPT account; displayed zero API prices do not prove zero usage' } }
const report: Record<string, unknown> = { timestamp: new Date().toISOString(), versions, routes, execute,
  layer: 'real CLI consuming the source production resident ExternalMcpService; not a packaged-app REL-T12 acceptance', clients: {}, limitations: [] }
await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ directory, versions, execute }))

const host = new DocumentHostService(path.join(directory, 'documents'))
const conversations = new ConversationStore({ directory: path.join(directory, 'conversations') })
const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
let settings: ExternalMcpSettings = { ...DEFAULT_EXTERNAL_MCP_SETTINGS, enabled: true, port: 0 }
const service = new ExternalMcpService({ conversations, registry: host.registry, gateway: host.tools, files: new AgentFileService(host),
  settings: { read: async () => settings, update: async patch => (settings = { ...settings, ...patch }) },
  workspaceRoot: root => realpath(root), uiState: async () => ({ workspaceId: 'cli-probe' }), appendEvent: input => events.append(input),
  confirm: async () => false })
const source = 'KEEP_ORIGINAL\nCODEX_SLOT\nOPENCODE_SLOT\n'
try {
  await writeFile(path.join(workspace, 'external-cli.md'), source)
  await conversations.registerWorkspace({ workspaceId: 'cli-probe', rootPath: await realpath(workspace), managed: false, authorization: 'user-selected' })
  const status = await service.start()
  if (status.state !== 'running') throw new Error(status.message ?? 'resident MCP service did not start')
  const endpoint = status.endpoint, env = {}
  for (const client of clients) {
    const marker = client === 'codex' ? 'CODEX_SLOT' : 'OPENCODE_SLOT', replacement = `${client.toUpperCase()}_LUNA_OK`
    const prompt = `这是一次已授权的果铃 MCP 协议验收。只使用已连接的 guoling MCP 工具，禁止执行 shell、直接读写本地文件、网络搜索、子代理或换模型。\n` +
      `按顺序：1. 用 file.open 打开 external-cli.md；2. 用 file.patch 把 ${marker} 改成 ${replacement}（oldText 精确为 ${marker}），只改这一处；` +
      `3. 用 operation.recent 核对刚才的修改结果；4. 用 file.read 读取 external-cli.md，确认 KEEP_ORIGINAL 和另一处文字保留。不需要也不要填写 ticket，果铃会自动编号。\n` +
      `必须真实调用工具，不能只输出计划。任一步错误只报告原错误并停止，不重试、不绕过权限。最后仅报告实际结果。`
    let args: string[], childEnv: NodeJS.ProcessEnv = env
    if (client === 'codex') {
      const mcpConfig = ['-c', `mcp_servers.guoling.url=${JSON.stringify(endpoint)}`,
        '-c', `mcp_servers.guoling.enabled_tools=${JSON.stringify(TOOLS)}`, '-c', 'mcp_servers.guoling.default_tools_approval_mode="approve"']
      await verifyCodexConfig(mcpConfig, env)
      args = ['exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--ephemeral', '--json', '--color', 'never',
        '--model', 'gpt-5.6-luna', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-c', 'model_reasoning_effort="medium"',
        '-c', 'service_tier="fast"', '-c', 'features.fast_mode=true', '-c', 'features.multi_agent=false',
        ...mcpConfig, prompt]
    } else {
      const configPath = path.join(directory, 'opencode.json')
      await writeFile(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'openai/gpt-5.6-luna-fast', small_model: 'openai/gpt-5.6-luna-fast',
        default_agent: 'g20-probe', share: 'disabled', agent: { 'g20-probe': { mode: 'primary', model: 'openai/gpt-5.6-luna-fast',
          prompt: 'Only use the connected guoling MCP tools for the explicitly authorized protocol probe. Do not delegate or use filesystem/shell tools.',
          tools: { bash: false, shell: false, write: false, edit: false, apply_patch: false, task: false, webfetch: false, websearch: false, skill: false, read: false, glob: false, grep: false } },
          general: { disable: true }, explore: { disable: true } },
        mcp: { guoling: { type: 'remote', url: endpoint, enabled: true } } }, null, 2))
      childEnv = { ...env, OPENCODE_CONFIG: configPath }
      const discovery = await launch(client, ['mcp', 'list', '--pure'], childEnv)
      await writeFile(path.join(directory, `${client}-discovery.json`), JSON.stringify(discovery, null, 2))
      if (discovery.exitCode !== 0 || !/connected/i.test(discovery.stdout)) throw new Error('OpenCode native MCP discovery failed; no model request started')
      args = ['run', '--pure', '--model', 'openai/gpt-5.6-luna-fast', '--agent', 'g20-probe', '--variant', 'medium', '--format', 'json', prompt]
    }
    if (!execute) { (report.clients as Record<string, unknown>)[client] = { status: 'configured-not-run', modelRequest: false }; continue }
    console.log(JSON.stringify({ starting: client, model: routes[client].model }))
    const before = new Set((await service.status()).sessions.map(session => session.sessionId))
    const result = await launch(client, args, childEnv, 180_000)
    await writeFile(path.join(directory, `${client}-stdout.jsonl`), result.stdout)
    await writeFile(path.join(directory, `${client}-stderr.log`), result.stderr)
    const current = host.registry.list().find(item => item.binding.kind === 'file' && item.binding.path.endsWith('external-cli.md'))
    const sessions = (await service.status()).sessions.filter(session => !before.has(session.sessionId))
    const source = current?.model.kind === 'markdown' ? current.model.source : null
    const passed = result.exitCode === 0 && !result.timedOut && !!source?.includes(replacement) && !source.includes(marker) && source.includes('KEEP_ORIGINAL')
    if (!passed) process.exitCode = 1 // A successful CLI exit alone is not successful product evidence.
    ;(report.clients as Record<string, unknown>)[client] = { status: passed ? 'canonical-edit-observed' : 'failed-or-incomplete',
      exitCode: result.exitCode, elapsedMs: result.elapsedMs, timedOut: result.timedOut, sessions,
      documentId: current?.documentId ?? null, revision: current?.revision ?? null, undoDepth: current?.undoDepth ?? null, source,
      note: 'Raw client trace must additionally confirm the tool sequence; the edit alone is not complete S12 acceptance.' }
    await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ client, status: passed ? 'canonical-edit-observed' : 'failed-or-incomplete', exitCode: result.exitCode, elapsedMs: result.elapsedMs }))
    for (const session of sessions) await service.stopSession(session.sessionId)
  }
  const final = host.registry.list().find(item => item.binding.kind === 'file' && item.binding.path.endsWith('external-cli.md'))
  report.final = final ? { documentId: final.documentId, revision: final.revision, undoDepth: final.undoDepth,
    source: final.model.kind === 'markdown' ? final.model.source : null, registryCount: host.registry.list().length } : null
} catch (cause) {
  report.error = cause instanceof Error ? cause.message : String(cause)
  process.exitCode = 1
} finally {
  await service.close()
  await writeFile(path.join(directory, 'report.json'), redact(JSON.stringify(report, null, 2)))
  console.log(JSON.stringify({ report: path.join(directory, 'report.json'), error: report.error ?? null }))
}
}
void main().catch(cause => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
