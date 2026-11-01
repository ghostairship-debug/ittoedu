/** One paired short-edit experiment, not a new runner abstraction. No run without an earlier zero-model gate. */
import assert from 'node:assert/strict'
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fork, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { documentHost } from '../../src/main/workbench/documentHost'
import { installWorkbenchToolServices } from '../../src/main/workbench/workbenchToolServices'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { OAuthDesktopService } from '../../src/main/workbench/providers/OAuthDesktopService'
import { createElectronCredentialEncryption } from '../../src/main/workbench/providers/providerCredentials'
import { ChatGPTResponsesProvider } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { residentMcpFixture, callTool } from '../helpers/residentMcpFixture'
import { probeDirectoryConsumerCredentials, noteCredentialFailure } from './delegationDirectoryConsumer20261030.node'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

export const ALLOWED = ['file.open', 'tools.load', 'project.list', 'project.read', 'project.apply', 'file.save']
export const PROMPT = '请使用果铃正式领域工具打开当前工作空间中的 market.glx，并完成一个局部数据修改：找到“独立书摊”一行，把固定成本（fixed，当前为450）改为470。只改这一个单元格；所有其他文字、数值、表格行列身份、布局、Source、交互、资源保持原样。按当前工具schema读取、修改并正式保存GLX，核实保存回执后报告结果。只使用给定果铃领域工具；不使用shell、文件补丁、网络、其他Agent，不导出、不重构、不调用另一个模型。若当前值不是450或目标不唯一，明确阻断，不修改其他内容。'
type Config = { root: string; out: string; route: 'engine' | 'acp'; phase: 'zero' | 'live' | 'cold'; file: string; originalProfile: string; nodePath: string; initialHash: string; expectedSchemas?: Record<string, unknown> }
const json = (v: unknown) => JSON.stringify(v, (_k, x) => x instanceof Uint8Array ? [...x] : x, 2)
const hash = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex')
const write = (p: string, v: unknown) => fs.writeFile(p, json(v))
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
const cellText = (c: any) => c.content ? c.content.inlines.map((i: any) => i.type === 'text' ? i.text : i.accessibleText ?? '').join('') : c.text ?? ''
function target(model: any) {
  assert.equal(model.kind, 'course-v10')
  const matches: any[] = []
  for (const [id, instance] of Object.entries(model.project.instances) as [string, any][]) {
    const data = instance.data
    if (!Array.isArray(data?.rows) || !Array.isArray(data?.columns)) continue
    for (const row of data.rows) {
      if (!row.cells.some((cell: any) => cellText(cell).trim() === '独立书摊')) continue
      const columns = data.columns.filter((column: any) => {
        const header = data.rows.slice(0, 2).flatMap((r: any) => r.cells).filter((c: any) => c.columnId === column.id).map(cellText).join(' ')
        return /固定|\bfixed\b/i.test(header + ' ' + String(column.label ?? column.field ?? ''))
      })
      assert.equal(columns.length, 1, 'Fixed-cost column must have one explicit header; no index guessing')
      const cell = row.cells.find((c: any) => c.columnId === columns[0].id)
      assert(cell)
      matches.push({ instanceId: id, rowId: row.id, columnId: columns[0].id, cell })
    }
  }
  assert.equal(matches.length, 1, 'Exactly one 独立书摊 row must exist')
  return matches[0]
}
function verify(before: any, after: any) {
  const a = target(before), b = target(after)
  assert.equal(cellText(a.cell), '450'); assert.equal(cellText(b.cell), '470')
  assert.equal(b.instanceId, a.instanceId); assert.equal(b.rowId, a.rowId); assert.equal(b.columnId, a.columnId)
  const masked = (cell: any) => { const copy = structuredClone(cell)
    if (copy.content) { for (const node of copy.content.inlines) if (node.type === 'text') node.text = '__value__' }
    else if (typeof copy.text === 'string') copy.text = '__value__'
    return copy }
  assert.deepEqual(masked(b.cell), masked(a.cell), 'Cell formatting or rich-text structure changed')
  const expected = structuredClone(before)
  expected.project.revision = after.project.revision
  const row = expected.project.instances[a.instanceId].data.rows.find((r: any) => r.id === a.rowId)
  row.cells[row.cells.findIndex((c: any) => c.columnId === a.columnId)] = structuredClone(b.cell)
  assert.deepEqual(after, expected, 'A non-target field or resource changed')
  return { instanceId: a.instanceId, rowId: a.rowId, columnId: a.columnId, from: '450', to: '470' }
}
function fixtureEvent(request: ModelRequest, calls: any[] = []): Extract<ModelEvent, { type: 'response.completed' }> {
  const toolCalls = calls.map((c, i) => ({ id: `${request.requestId}-${i}`, name: c.name, argumentsText: JSON.stringify(c.input) }))
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId,
    actualModel: 'zero-model-fixture', finishReason: calls.length ? 'tool_calls' : 'stop', nativeResponse: {}, toolCalls,
    assistant: { role: 'assistant', content: '零模型目录准备', ...(calls.length ? { tool_calls: toolCalls.map(c => ({ id: c.id,
      type: 'function' as const, function: { name: c.name, arguments: c.argumentsText } })) } : {}) } }
}
const fakeSelection: ModelSelection = { model: 'zero-model-fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
  protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' } } }

async function account(config: Config) {
  const probe = await probeDirectoryConsumerCredentials({ out: config.out, originalProfile: config.originalProfile })
  assert.equal(probe.status, 'decryption-readable-token-validity-unprobed', 'Engine credential owner cannot decrypt in this context; no live pair is authorized by this preflight')
  const store = new ExecutionSettingsStore({ directory: path.join(config.originalProfile, 'workbench-v2/settings'), encryption: await createElectronCredentialEncryption() })
  const profile = (await store.read()).profile, current = await store.snapshot('conversation')
  assert.equal(current.connection.protocol, 'chatgpt-responses')
  const selection = await store.captureDelegationSelection({ connectionId: current.connection.id, model: 'gpt-6.1-terra', parameters: { reasoning: { effort: 'xhigh' } } }, current)
  // Resolver is not invoked during zero-model preparation.
  const oauth = new OAuthDesktopService({ store, openExternal: async () => { throw Error('No login flow in this experiment') } })
  const actual = new ChatGPTResponsesProvider({ credentialResolver: async c => {
    try { return await oauth.resolveCredential(c) }
    catch (error) { await noteCredentialFailure(config.out, error, 'e2-oauth-resolver'); throw error }
  } })
  await write(path.join(config.out, 'engine-route.json'), { model: selection.model, parameters: selection.parameters, protocol: selection.connection.protocol,
    connectionId: selection.connection.id, connectionRevision: selection.connection.revision, credentialCopy: false, profileWrite: false })
  return { selection, actual, unchanged: async () => assert.deepEqual((await store.read()).profile, profile) }
}

async function engineRoute(config: Config, host: ReturnType<typeof documentHost>, before: any) {
  const access = await account(config), events = new ExecutionEventStore({ directory: path.join(config.out, 'events') })
  const allowed = new Set(ALLOWED), schemas = new Map<string, any>(), providerFacts: any[] = []
  let zeroStep = 0, runId = '', taskStart = 0, timer: ReturnType<typeof setTimeout> | undefined, budgetStopped = false
  let engine!: ExecutionEngine
  const filtered = (input: any) => ({ ...input, tools: input.tools.filter((tool: any) => allowed.has(tool.name)).map((tool: any) => {
    if (config.expectedSchemas) assert.deepEqual(canonical(tool.inputSchema), config.expectedSchemas[tool.name], `Engine schema changed after zero-model gate: ${tool.name}`)
    return tool
  }) })
  const monitored = async function* (requestId: string, input: any, stream: AsyncIterable<ModelEvent>) {
    taskStart ||= Date.now()
    const fact: any = { requestId, enteredAt: Date.now(), tools: input.tools.map((t: any) => t.name) }; providerFacts.push(fact)
    for await (const event of stream) {
      fact.firstEventAt ??= Date.now()
      if (event.type === 'text.delta') fact.firstTextAt ??= Date.now()
      if (event.type === 'tool.delta') fact.firstToolAt ??= Date.now()
      if (event.type === 'response.completed') {
        fact.actualModel = event.actualModel; fact.usage = event.usage; fact.finishedAt = Date.now()
        for (const tool of event.toolCalls) assert(allowed.has(tool.name), `Out-of-scope tool ${tool.name}; no equivalent task claim`)
      }
      if (event.type === 'response.failed') fact.failure = { outcome: event.failure.outcome, code: event.failure.code, kind: event.failure.kind }
      yield event
    }
  }
  const withTiming = (requestId: string, options: any) => ({ ...options, onTiming: (timing: any) => {
    const fact = providerFacts.find(item => item.requestId === requestId)
    if (fact) fact.timing = { ...timing }
    options?.onTiming?.(timing)
  } })
  const provider: ModelProvider = config.phase === 'zero' ? { async *stream(request) {
    for (const tool of request.tools ?? []) if (allowed.has(tool.name)) schemas.set(tool.name, tool.inputSchema)
    const steps = [[{ name: 'file.open', input: { path: 'market.glx' } }], [{ name: 'tools.load', input: { families: ['content'] } }]]
    yield fixtureEvent(request, steps[zeroStep++] ?? [])
  } } : { retrySafety: access.actual.retrySafety,
    prepare(input, accounting) { const narrowed = filtered(input), prepared = access.actual.prepare(narrowed, accounting)
      return { serialized: prepared.serialized, tokens: prepared.tokens,
        stream: (requestId, options) => monitored(requestId, narrowed, prepared.stream(requestId, withTiming(requestId, options))) } },
    stream(request, options) { const narrowed = filtered(request), prepared = access.actual.prepare(narrowed)
      return monitored(request.requestId, narrowed, prepared.stream(request.requestId, withTiming(request.requestId, options))) },
  }
  engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: host.agentFiles,
    runs: new ExecutionRunStore(path.join(config.out, 'runs')), events, edits: new EditSessionService(host.registry, host.tools),
    subscribeDocumentEvents: listener => host.subscribeEvents(listener) })
  try {
    const routeStart = Date.now()
    if (config.phase === 'live') timer = setTimeout(() => { budgetStopped = true; if (runId) void engine.stop(runId) }, 240_000)
    const opened = await engine.start({ conversationId: `e2-${randomUUID()}`, taskId: randomUUID(), instruction: PROMPT,
      selection: config.phase === 'zero' ? fakeSelection : access.selection, permission: 'workspace', workspaceRoot: path.dirname(config.file), documents: [] },
      undefined, async r => { runId = r.runId })
    const ended: any = await engine.wait(opened.runId)
    await write(path.join(config.out, 'run.json'), ended); await write(path.join(config.out, 'provider-facts.json'), providerFacts)
    await access.unchanged()
    assert.equal(ended.status, 'completed', JSON.stringify(ended.failure)); assert(!budgetStopped, 'Four-minute test budget reached')
    if (config.phase === 'zero') {
      for (const name of ALLOWED) assert(schemas.has(name), `Engine does not disclose required tool ${name}`)
      assert.equal(hash(await fs.readFile(config.file)), config.initialHash)
      const facts = { status: 'ready-no-model', route: 'engine', providerCalls: 0, initialHash: config.initialHash,
        target: target(before), allowedTools: ALLOWED, schemas: canonical(Object.fromEntries(schemas)), promptSha256: hash(PROMPT) }
      await write(path.join(config.out, 'preflight.json'), facts); return facts
    }
    assert(ended.tools.some((t: any) => t.call.name === 'file.save' && t.result?.kind !== 'error'), 'Model did not use the shared formal save tool')
    assert(ended.requests.every((r: any) => r.actualModel === 'gpt-6.1-terra'), 'An actual model is missing or mismatched')
    return { status: 'route-finished', route: 'engine', routeStart, taskStart, taskEnd: Date.now(), runId,
      requestRecords: ended.requests.length, toolRecords: ended.tools.length, actualModelConfirmed: true, budgetStopped,
      providerEntries: providerFacts.length, actualNetworkRequests: providerFacts.filter(fact => Number.isFinite(fact.timing?.fetchStartedAt)).length,
      networkCountDefinition: 'Model Provider fetch invocation observed via timing.fetchStartedAt; not a billing or server-acceptance count; OAuth refresh is excluded.' }
  } finally { clearTimeout(timer); await engine.shutdown(); await events.flushPending() }
}

async function command(config: Config, args: string[], filename: string, ipc?: (child: ReturnType<typeof fork>) => void) {
  const child = ipc ? fork(args[0], args.slice(1), { execPath: config.nodePath, execArgv: ['--import', 'tsx'], cwd: config.root,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }) : spawn(config.nodePath, args, { cwd: config.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', b => { void fs.appendFile(filename, b) }); child.stderr?.on('data', b => { void fs.appendFile(filename, b) })
  if (ipc) ipc(child as ReturnType<typeof fork>)
  return await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
}
async function acpRoute(config: Config, host: ReturnType<typeof documentHost>, documentId: string, before: any) {
  const fixture = await residentMcpFixture({ host, directory: path.join(config.out, 'mcp'), workspaceRoot: path.dirname(config.file), settings: { permission: 'workspace' },
    confirm: () => false, appendEvent: event => fs.appendFile(path.join(config.out, 'domain-events.jsonl'), JSON.stringify({ observedAt: Date.now(), event }) + '\n') })
  try {
    // No active-document head start: both real routes receive the same file.open instruction.
    fixture.ui.state = { workspaceId: 'space' }
    const probe = await fixture.connect('e2-zero-probe')
    for (const [name, args] of [['file.open', { path: 'market.glx' }], ['tools.load', { families: ['content'] }]] as const) {
      const receipt = await callTool(probe, name, args); assert(!receipt.isError && receipt.structuredContent.result.kind !== 'error', `MCP zero-model ${name} failed`)
    }
    const all: any[] = []; let cursor: string | undefined
    do { const list = await probe.listTools(cursor ? { cursor } : {}); all.push(...list.tools); cursor = list.nextCursor } while (cursor)
    const schemas = Object.fromEntries(ALLOWED.map(name => { const tool = all.find(t => t.name === name); assert(tool, `MCP lacks ${name}`); return [name, tool.inputSchema] }))
    if (config.expectedSchemas) assert.deepEqual(canonical(schemas), config.expectedSchemas, 'MCP schemas changed after zero-model gate')
    await probe.close()
    for (const session of (await fixture.service.status()).sessions) if (session.clientName === 'e2-zero-probe') await fixture.service.stopSession(session.sessionId)
    const settings = path.join(config.out, 'settings.json'), native = path.join(config.out, 'native')
    await write(settings, { cwd: path.dirname(config.file), outputDirectory: native, fixture: { file: config.file, initialHash: config.initialHash },
      expectedDocumentId: documentId, mcpUrl: `http://127.0.0.1:${fixture.service.server.listeningPort}/mcp`, mcpName: 'guoling',
      allowedToolNames: ALLOWED, modelId: 'gpt-6.1-terra', effort: 'xhigh', expectDiskChange: true, turnBudgetMs: 240000, prompt: PROMPT })
    const pre = await command(config, ['scripts/experiments/prepare-acp-domain.mjs', '--settings', settings], path.join(config.out, 'prepare.log'))
    assert.equal(pre, 0, 'Existing native zero-model route preflight failed; no substitute route')
    const controller = path.join(config.root, 'scripts/experiments/acp-domain-controller.mjs')
    if (config.phase === 'zero') {
      const code = await command(config, ['--import', 'tsx', controller, '--settings', settings], path.join(config.out, 'controller-preflight.log'))
      assert.equal(code, 0, 'ACP initialize/open/configure preflight failed; no model sent')
      assert.equal(hash(await fs.readFile(config.file)), config.initialHash)
      const facts = { status: 'ready-no-model', route: 'acp', providerCalls: 0, initialHash: config.initialHash,
        target: target(before), allowedTools: ALLOWED, schemas: canonical(schemas), promptSha256: hash(PROMPT) }
      await write(path.join(config.out, 'preflight.json'), facts); return facts
    }
    let taskStart = 0, routeBudgetStopped = false
    const routeStart = Date.now()
    const code = await command(config, [controller, '--settings', settings, '--run'], path.join(config.out, 'controller.log'), child => {
      const timer = setTimeout(() => { routeBudgetStopped = true
        child.send({ type: 'guoling-acp-cancel', requestId: randomUUID(), reason: 'e2-four-minute-route-budget' })
      }, 240_000)
      child.once('exit', () => clearTimeout(timer)); child.once('error', () => clearTimeout(timer))
      child.on('message', async (message: any) => {
        if (message?.type === 'guoling-acp-turn-started') taskStart ||= Date.now()
        if (message?.type !== 'guoling-acp-domain-revoke') return
        try { for (const session of (await fixture.service.status()).sessions) await fixture.service.stopSession(session.sessionId)
          child.send({ type: 'guoling-acp-domain-revoke-result', requestId: message.requestId, ok: true }) }
        catch (error) { child.send({ type: 'guoling-acp-domain-revoke-result', requestId: message.requestId, ok: false, error: String(error) }) }
      })
    })
    assert.equal(code, 0, 'ACP turn failed or was stopped; inspect receipts, never rerun automatically')
    assert(!routeBudgetStopped, 'Four-minute ACP route budget reached')
    const summaries = (await fs.readdir(native)).filter(name => /^run-.*\.json$/.test(name) && !name.endsWith('.session.json'))
    assert.equal(summaries.length, 1)
    const summary = JSON.parse(await fs.readFile(path.join(native, summaries[0]), 'utf8'))
    assert.equal(summary.state, 'turns-finished'); assert(summary.domainTerminationAcknowledged)
    const observedModels = summary.diskCheckpoints.flatMap((item: any) => item.observedModels ?? [])
    assert(!observedModels.some((name: string) => name !== 'gpt-6.1-terra'))
    return { status: 'route-finished', route: 'acp', routeStart, taskStart, taskEnd: Date.now(), nativeSummary: path.join(native, summaries[0]),
      actualModelConfirmed: observedModels.length > 0, requestRecords: null, requestVisibility: 'ACP does not expose complete provider request records',
      modelIdentityQualification: observedModels.length ? 'observed' : 'configured-and-advertised-only' }
  } finally { await fixture.close() }
}

async function execute(config: Config) {
  const relativeProfile = path.relative(config.out, app.getPath('userData'))
  assert(relativeProfile !== '..' && !relativeProfile.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeProfile),
    'E2 domain services must use their isolated attempt profile')
  const host = documentHost(), isCold = config.phase === 'cold'
  if (!isCold) installWorkbenchToolServices({ getMainWindow: () => null, getRendererEntryUrl: () => pathToFileURL(path.join(config.root, 'dist-renderer/index.html')).href, headless: true })
  const opened = await host.open(config.file)
  if (isCold) {
    const baseline = JSON.parse(await fs.readFile(path.join(config.out, 'baseline-model.json'), 'utf8'))
    const producer = JSON.parse(await fs.readFile(path.join(config.out, 'producer-result.json'), 'utf8'))
    assert.equal(opened.dirty, false)
    const targetFact = verify(baseline, JSON.parse(json(opened.model)))
    assert.equal(hash(await fs.readFile(config.file)), producer.savedSha256)
    const qualifiedMs = Date.now() - producer.routeStart
    const result = { ...producer, status: !producer.actualModelConfirmed ? 'domain-verified-model-unconfirmed'
        : qualifiedMs <= 240000 ? 'qualified' : 'qualified-after-deadline', target: targetFact,
      qualifiedMs, fromProviderEntryOrAcpPromptMs: producer.taskStart ? Date.now() - producer.taskStart : null,
      intermediateTimingBasis: producer.route === 'engine' ? 'Provider generator entry before credential resolution and fetch' : 'ACP prompt-start notification; provider transmission unobserved',
      qualifiedWithinBudget: qualifiedMs <= 240000, comparisonEligible: producer.actualModelConfirmed && qualifiedMs <= 240000,
      independentColdOpen: true, completedAt: new Date().toISOString() }
    await write(path.join(config.out, 'result.json'), result); return result
  }
  const baseline = JSON.parse(json(opened.model)), original = target(baseline)
  assert.equal(cellText(original.cell), '450', 'Frozen fixture is not the specified untouched target; no preparation rewrite')
  assert.equal(hash(await fs.readFile(config.file)), config.initialHash)
  await write(path.join(config.out, 'baseline-model.json'), baseline)
  const result = config.route === 'engine' ? await engineRoute(config, host, baseline) : await acpRoute(config, host, opened.documentId, baseline)
  if (config.phase === 'zero') return result
  // Do not save for the agent: the route itself must have delivered a valid disk file.
  const snapshot = await host.internalAPI.read(opened.documentId)
  assert.equal(snapshot.dirty, false, 'Route left an unsaved draft')
  const targetFact = verify(baseline, JSON.parse(json(snapshot.model)))
  const savedSha256 = hash(await fs.readFile(config.file)); assert.notEqual(savedSha256, config.initialHash)
  const produced = { ...result, status: 'producer-verified-awaiting-cold', initialHash: config.initialHash, savedSha256,
    target: targetFact, promptSha256: hash(PROMPT), allowedTools: ALLOWED, zeroModelAuditSetupExcludedFromRouteClock: true,
    inference: 'Composite product-route comparison; backend protocol, hidden instructions and queue are not controlled.' }
  await write(path.join(config.out, 'producer-result.json'), produced); return produced
}

export async function installE2ShortEdit(config: Config) {
  await app.whenReady(); app.on('window-all-closed', () => undefined)
  ;(globalThis as any).__e2ShortEdit = async () => { try { return await execute(config) }
    catch (error) { await write(path.join(config.out, 'failure.json'), { phase: config.phase, route: config.route,
      error: String(error), stack: error instanceof Error ? error.stack : null, at: new Date().toISOString() }); throw error } }
}
export { probeDirectoryConsumerCredentials }
