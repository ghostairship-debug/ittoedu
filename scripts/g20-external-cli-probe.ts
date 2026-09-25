/** Explicitly invoked real CLI probe. No SDK client, credential file reads, model fallback or automatic paid retry. */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DocumentHostService } from '../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../src/main/workbench/conversations/ConversationStore'
import { ExecutionEngine } from '../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../src/main/workbench/execution/ExecutionEventStore'
import { ExternalMcpService } from '../src/main/workbench/external/ExternalMcpService'
import type { ExternalGrantResult } from '../src/shared/workbench/external'

type ClientName = 'codex' | 'opencode'
async function main() {
const requested = process.argv.find(arg => arg.startsWith('--clients='))?.split('=')[1]?.split(',') ?? ['codex', 'opencode']
if (requested.some(client => client !== 'codex' && client !== 'opencode')) throw new Error('Only the authorized Luna CLI routes are supported')
const clients = requested as ClientName[]
const execute = process.argv.includes('--run')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const directory = path.resolve('output/g20/s12-cli', stamp)
await mkdir(directory, { recursive: true })
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
async function openCodeResourceSession(env: NodeJS.ProcessEnv) {
  const child = spawn(binaries.opencode.executable, ['serve', '--pure', '--hostname', '127.0.0.1', '--port', '0'],
    { cwd: directory, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', closed = false
  child.stdout.on('data', value => { stdout += String(value) })
  child.stderr.on('data', value => { stderr += String(value) })
  child.on('close', () => { closed = true })
  const stop = async () => {
    if (!closed && child.pid) {
      if (process.platform === 'win32') await new Promise<void>(resolve => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.once('close', () => resolve())
      })
      else child.kill('SIGTERM')
    }
    await writeFile(path.join(directory, 'opencode-server.log'), redact(stdout + '\n' + stderr))
  }
  try {
    const deadline = Date.now() + 20_000
    let endpoint = ''
    while (Date.now() < deadline && !closed) {
      endpoint = (stdout + stderr).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? ''
      if (endpoint) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!endpoint) throw new Error('OpenCode server did not announce a loopback endpoint')
    const post = async (route: string, body: unknown) => {
      const response = await fetch(endpoint + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`OpenCode ${route}: HTTP ${response.status}: ${await response.text()}`)
      return await response.json() as Record<string, any>
    }
    const session = await post('/session', { title: 'Guoling S12 native resource attachment', agent: 'g20-probe',
      model: { providerID: 'openai', id: 'gpt-5.6-luna-fast', variant: 'medium' } })
    if (typeof session.id !== 'string') throw new Error('OpenCode did not create a real session')
    // This invokes OpenCode's own MCP readResource, with no model request (noReply).
    // The harness never reads the resource through a substitute MCP client.
    const resource = await post(`/session/${session.id}/message`, { noReply: true, agent: 'g20-probe',
      model: { providerID: 'openai', modelID: 'gpt-5.6-luna-fast' }, variant: 'medium',
      parts: [{ type: 'file', mime: 'application/json', filename: 'guoling-task-context', url: 'guoling://task/context',
        source: { type: 'resource', clientName: 'guoling', uri: 'guoling://task/context',
          text: { value: 'guoling-task-context', start: 0, end: 20 } } }] })
    await writeFile(path.join(directory, 'opencode-native-resource.json'), redact(JSON.stringify(resource, null, 2)))
    const parts = Array.isArray(resource.parts) ? resource.parts : []
    if (!parts.some((part: any) => part.type === 'text' && typeof part.text === 'string' && part.text.includes('operationTickets')))
      throw new Error('OpenCode native MCP resource attachment did not return the task context; no model request started')
    return { endpoint, sessionId: session.id as string, stop }
  } catch (cause) { await stop(); throw cause }
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
  if (effective?.default_tools_approval_mode !== 'approve' || !Array.isArray(effective.enabled_tools) || effective.enabled_tools.length !== 3)
    throw new Error('Codex effective MCP preauthorization did not match the three authorized tools; no model request started')
}
const versions = Object.fromEntries(await Promise.all(clients.map(async client => [client, (await launch(client, ['--version'])).stdout.trim()])))
const routes = { codex: { model: 'gpt-5.6-luna', provider: 'OpenAI', auth: 'ChatGPT OAuth', requestedServiceTier: 'fast', billing: 'existing ChatGPT account; plan/actual charge not inferred' },
  opencode: { model: 'openai/gpt-5.6-luna-fast', apiModel: 'gpt-5.6-luna', provider: 'OpenAI', auth: 'OAuth', requestedServiceTier: 'priority', billing: 'existing ChatGPT account; displayed zero API prices do not prove zero usage' } }
const report: Record<string, unknown> = { timestamp: new Date().toISOString(), versions, routes, execute,
  layer: 'real CLI consuming source production ExternalMcpService; not a packaged-app REL-T12 acceptance', clients: {}, limitations: [] }
await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ directory, versions, execute }))

const host = new DocumentHostService(path.join(directory, 'documents'))
const conversations = new ConversationStore({ directory: path.join(directory, 'conversations') })
const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, events, runs: new ExecutionRunStore(path.join(directory, 'runs')),
  provider: { async *stream() { throw new Error('This probe must not start a built-in model request') } } })
const service = new ExternalMcpService({ registry: host.registry, gateway: host.tools, conversations, engine, appendEvent: input => events.append(input) })
const grants = new Map<ClientName, ExternalGrantResult>()
const source = 'KEEP_ORIGINAL\nCODEX_SLOT\nOPENCODE_SLOT\n'
try {
  await conversations.registerWorkspace({ workspaceId: 'cli-probe', rootPath: directory, managed: true, authorization: 'managed' })
  let conversation = await conversations.createConversation({ workspaceId: 'cli-probe', title: '两种真实客户端使用同一文档' })
  const owner = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }
  const document = await host.internalAPI.create({ kind: 'markdown', source, resources: { assets: {}, components: {} } }, 'external-cli.md')
  for (const client of clients) {
    const marker = client === 'codex' ? 'CODEX_SLOT' : 'OPENCODE_SLOT', from = source.indexOf(marker)
    const granted = await service.grant({ ...owner, expectedRevision: conversation.revision,
      instruction: `只把 ${marker} 改成 ${client.toUpperCase()}_LUNA_OK，保留其余全部内容。`,
      documents: [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable: [{ kind: 'markdown-range', from, to: from + marker.length }] }], lifetimeMs: 15 * 60_000 })
    conversation = granted.conversation; grants.set(client, granted); redactions.add(granted.connection.bearer)
  }
  for (const client of clients) {
    const granted = grants.get(client)!, env = { GUOLING_MCP_TOKEN: granted.connection.bearer }
    const prompt = `这是一次已授权的果铃 MCP 协议验收。只使用已连接的 guoling MCP 和客户端内置 MCP 资源读取能力，禁止执行 shell、读写本地文件、网络搜索、子代理或换模型。\n` +
      `先发现并读取资源 guoling://task/context（可通过客户端的 MCP 资源读取工具）。它提供本次 target 与 operationTickets。\n` +
      `按顺序：1. 用 read 读取 documents[0].writable[0].target，外层 ticket 使用 operationTickets[0]；2. 用 text.replace 把这个精确目标正文改为 ${client.toUpperCase()}_LUNA_OK，arguments 只放 target/content，外层 ticket 必须使用不同的 operationTickets[1]；3. 用 operationTickets[1]、name=text.replace、完全相同的 arguments 调用 operation.lookup 查询刚才的正式回执，不能重做修改；4. 用 read 读取 documents[0].target，ticket 使用 operationTickets[2]，确认 KEEP_ORIGINAL 和另一处文字保留。每个新调用使用不同票据，唯独 lookup 复用它查询的写入票据。\n` +
      `必须真实调用工具，不能只输出计划。任一步错误只报告原错误并停止，不重试、不绕过权限。最后仅报告实际 operationId、revision 与观察结果。`
    let args: string[], childEnv: NodeJS.ProcessEnv = env
    let openCodeServer: Awaited<ReturnType<typeof openCodeResourceSession>> | undefined
    if (client === 'codex') {
      const mcpConfig = ['-c', `mcp_servers.guoling.url=${JSON.stringify(granted.connection.endpoint)}`, '-c', 'mcp_servers.guoling.bearer_token_env_var="GUOLING_MCP_TOKEN"',
        '-c', 'mcp_servers.guoling.enabled_tools=["read","text.replace","operation.lookup"]', '-c', 'mcp_servers.guoling.default_tools_approval_mode="approve"']
      await verifyCodexConfig(mcpConfig, env)
      args = ['exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--ephemeral', '--json', '--color', 'never',
        '--model', 'gpt-5.6-luna', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-c', 'model_reasoning_effort="medium"',
        '-c', 'service_tier="fast"', '-c', 'features.fast_mode=true', '-c', 'features.multi_agent=false',
        ...mcpConfig, prompt]
    } else {
      const configPath = path.join(directory, 'opencode.json')
      await writeFile(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'openai/gpt-5.6-luna-fast', small_model: 'openai/gpt-5.6-luna-fast',
        default_agent: 'g20-probe', share: 'disabled', agent: { 'g20-probe': { mode: 'primary', model: 'openai/gpt-5.6-luna-fast',
          prompt: 'Only use the connected guoling MCP and MCP resource tools for the explicitly authorized protocol probe. Do not delegate or use filesystem/shell tools.',
          tools: { bash: false, shell: false, write: false, edit: false, apply_patch: false, task: false, webfetch: false, websearch: false, skill: false, read: false, glob: false, grep: false } },
          general: { disable: true }, explore: { disable: true } },
        mcp: { guoling: { type: 'remote', url: granted.connection.endpoint, oauth: false, enabled: true, headers: { Authorization: 'Bearer {env:GUOLING_MCP_TOKEN}' } } } }, null, 2))
      childEnv = { ...env, OPENCODE_CONFIG: configPath }
      const discovery = await launch(client, ['mcp', 'list', '--pure'], childEnv)
      await writeFile(path.join(directory, `${client}-discovery.json`), JSON.stringify(discovery, null, 2))
      if (discovery.exitCode !== 0 || !/connected/i.test(discovery.stdout)) throw new Error('OpenCode native MCP discovery failed; no model request started')
      openCodeServer = await openCodeResourceSession(childEnv)
      args = ['run', '--pure', '--attach', openCodeServer.endpoint, '--session', openCodeServer.sessionId,
        '--model', 'openai/gpt-5.6-luna-fast', '--agent', 'g20-probe', '--variant', 'medium', '--format', 'json',
        '本会话的上一条原生 MCP 资源附件已实际读取 guoling://task/context。直接使用附件里的真实 target 与 operationTickets；URI 本身不是 target。\n' + prompt.replace('先发现并读取资源 guoling://task/context（可通过客户端的 MCP 资源读取工具）。它提供本次 target 与 operationTickets。\n', '')]
    }
    if (!execute) { await openCodeServer?.stop(); (report.clients as Record<string, unknown>)[client] = { status: 'configured-not-run', modelRequest: false, nativeResource: !!openCodeServer }; continue }
    console.log(JSON.stringify({ starting: client, model: routes[client].model }))
    const result = await launch(client, args, childEnv, 180_000).finally(() => openCodeServer?.stop())
    await writeFile(path.join(directory, `${client}-stdout.jsonl`), result.stdout)
    await writeFile(path.join(directory, `${client}-stderr.log`), result.stderr)
    const current = host.registry.get(document.documentId).read()
    const timeline = await events.snapshot(owner.conversationId)
    const commits = timeline.items.filter(item => item.runId === granted.connection.runId && item.type === 'document.commit')
    const passed = result.exitCode === 0 && !result.timedOut && current.model.kind === 'markdown' && current.model.source.includes(`${client.toUpperCase()}_LUNA_OK`) && commits.length === 1
    if (!passed) process.exitCode = 1 // A successful CLI exit alone is not successful product evidence.
    ;(report.clients as Record<string, unknown>)[client] = { status: passed ? 'canonical-edit-observed' : 'failed-or-incomplete',
      exitCode: result.exitCode, elapsedMs: result.elapsedMs, timedOut: result.timedOut, connectionId: granted.connection.connectionId,
      runId: granted.connection.runId, documentId: current.documentId, epoch: current.epoch, revision: current.revision, undoDepth: current.undoDepth,
      commits: commits.map(item => item.data), source: current.model.kind === 'markdown' ? current.model.source : null,
      note: 'Raw client trace must additionally confirm discovery/resource read/lookup; edit alone is not complete S12 acceptance.' }
    await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ client, status: passed ? 'canonical-edit-observed' : 'failed-or-incomplete', exitCode: result.exitCode, commits: commits.length, elapsedMs: result.elapsedMs }))
    await service.revoke({ ...owner, connectionId: granted.connection.connectionId })
    if (client === 'opencode') {
      const revoked = await launch(client, ['mcp', 'list', '--pure'], childEnv)
      await writeFile(path.join(directory, 'opencode-after-revoke.json'), JSON.stringify(revoked, null, 2))
    }
  }
  const final = host.registry.get(document.documentId).read()
  report.final = { documentId: final.documentId, revision: final.revision, undoDepth: final.undoDepth, source: final.model.kind === 'markdown' ? final.model.source : null,
    registryCount: host.registry.list().length, grants: await service.list(owner) }
} catch (cause) {
  report.error = cause instanceof Error ? cause.message : String(cause)
  process.exitCode = 1
} finally {
  await service.close()
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: path.join(directory, 'report.json'), error: report.error ?? null }))
}
}
void main().catch(cause => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
