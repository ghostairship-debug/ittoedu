/**
 * One isolated, real-domain Pi 1.4.0 arm. No model request without --run.
 * node scripts/experiments/pi-domain-controller.mjs --settings <absolute.json> [--run]
 * Uses the already-authorized TeamoRouter deepseek-flash route only. The API key
 * remains in this process's existing environment and is never written to disk.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPiDomainSession, domainReply, providerRequestFacts } from './pi-domain-session.mjs';

const args = process.argv.slice(2), settingsAt = args.indexOf('--settings');
if (settingsAt < 0 || !args[settingsAt + 1]) throw Error('--settings is required');
const settingsPath = path.resolve(args[settingsAt + 1]);
const cfg = JSON.parse(await readFile(settingsPath, 'utf8'));
const run = args.includes('--run');
const route = { provider: 'guoling-teamorouter', model: 'deepseek-flash',
  baseUrl: 'https://api.teamorouter.com/v1', apiKeyEnv: 'TEAMOROUTER_API_KEY' };
// Confirmed in the product's DocumentDeliveryTools and actual ToolCatalog.
const saveToolName = 'file.save';
for (const name of ['piPackageRoot', 'mcpSdkRoot', 'cwd', 'outputDirectory'])
  if (!cfg[name] || !path.isAbsolute(cfg[name])) throw Error(`Absolute ${name} is required`);
if (!cfg.fixture?.file || !path.isAbsolute(cfg.fixture.file) || !/^[a-f0-9]{64}$/.test(cfg.fixture.initialHash ?? ''))
  throw Error('Exact isolated fixture path and initial SHA256 are required');
if (!cfg.expectedDocumentId || !Array.isArray(cfg.allowedToolNames) || !cfg.allowedToolNames.length || !cfg.prompt)
  throw Error('Expected foreground document, exact tools, and prompt are required');
if (!cfg.allowedToolNames.includes(saveToolName))
  throw Error('The actual domain file.save tool must be explicitly selected');
if (!cfg.allowedToolNames.includes('operation.read'))
  throw Error('operation.read is required to recover an uncertain dispatch by its original host ticket');
const endpoint = new URL(cfg.mcpUrl);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1'
  || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('Only local domain MCP is supported');
if (cfg.model && cfg.model !== route.model || cfg.baseUrl && cfg.baseUrl !== route.baseUrl)
  throw Error('This arm only uses the previously authorized deepseek-flash route');
const key = process.env[route.apiKeyEnv];
if (!key) throw Error(`${route.apiKeyEnv} is not configured in this process; no model request was sent`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha256(await readFile(cfg.fixture.file)) !== cfg.fixture.initialHash) throw Error('Fixture differs from the expected initial disk archive');

await mkdir(cfg.outputDirectory, { recursive: true });
const attemptDirectory = path.join(cfg.outputDirectory, `${run ? 'run' : 'preflight'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(attemptDirectory, { recursive: false });
const eventsFile = path.join(attemptDirectory, 'events.jsonl'), summaryFile = path.join(attemptDirectory, 'summary.json');
const started = performance.now();
let logTail = Promise.resolve(), logError, adapter, client, transport, interrupted, activePhase;
const report = { startedAt: new Date().toISOString(), run, route, credentialPresent: true,
  fixture: cfg.fixture, expectedDocumentId: cfg.expectedDocumentId, saveToolName, modelSendAttempted: false,
  actualProviderRequests: [], phases: [], nativeSessions: [], error: null };
function clean(value, name = '') {
  if (/^(apiKey|api_key|authorization|accessToken|refreshToken|idToken|access_token|refresh_token|id_token|secret|password|credentials?)$/i.test(name)) return '[redacted]';
  if (typeof value === 'string') return value.replaceAll(key, '[redacted]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]');
  if (Array.isArray(value)) return value.map(item => clean(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, clean(item, field)]));
  return value;
}
function log(kind, data) {
  const row = { at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), kind, data: clean(data) };
  logTail = logTail.then(() => appendFile(eventsFile, JSON.stringify(row) + '\n')).catch(error => { logError ??= error; });
}
const domainData = result => {
  domainReply(result);
  const value = result.structuredContent?.result ?? JSON.parse(result.content.find(item => item.type === 'text')?.text ?? 'null');
  return value?.kind === 'read' ? value.data : value;
};
async function bootstrap() {
  const stateResult = await client.callTool({ name: 'workbench.state', arguments: {} });
  log('domain.bootstrap.state', stateResult);
  let state = domainData(stateResult);
  if (!state?.activeDocument && state?.data?.activeDocument) state = state.data;
  if (state?.activeDocument?.documentId !== cfg.expectedDocumentId)
    throw Error('The foreground document differs from the explicitly selected fixture');
  if (cfg.requireSelection !== false && !state.selection?.targets?.length)
    throw Error('The real host selection is missing');
  const catalog = await client.listTools();
  const missing = cfg.allowedToolNames.filter(name => !catalog.tools.some(tool => tool.name === name));
  if (missing.length) {
    if (!catalog.tools.some(tool => tool.name === 'tools.load'))
      throw Error('The actual domain catalog is missing required tools: ' + missing.join(', '));
    const loaded = await client.callTool({ name: 'tools.load', arguments: { names: missing } });
    log('domain.bootstrap.tools', loaded);
    domainReply(loaded);
  }
  const context = { activeDocument: state.activeDocument, selection: state.selection };
  if (cfg.readSelection !== false && state.selection?.targets?.[0] && cfg.allowedToolNames.includes('read')) {
    const read = await client.callTool({ name: 'read', arguments: { target: state.selection.targets[0].target } });
    log('domain.bootstrap.read', read);
    context.currentSelection = domainData(read);
  }
  return context;
}
let revokePromise;
async function revokeDomain() {
  // A signal can arrive while connect() is still initializing. Do not cache a
  // no-op: finally must revoke any session that is created after that signal.
  if (!transport?.sessionId) return;
  if (!revokePromise) revokePromise = (async () => {
    const domainSessionId = transport.sessionId;
    log('domain.revoke.start', { domainSessionId });
    await transport.terminateSession();
    // The existing ResidentMcpServer DELETE calls ExternalMcpService.terminate.
    // terminate marks its session stopped and Gateway.stop marks run.stopped
    // before its first await. The ACK establishes revocation, not completion of
    // every pending resource cleanup. No grant is recreated by this adapter.
    log('domain.revoke.ack', { domainSessionId });
    report.domainTerminationAcknowledged = true;
  })();
  return revokePromise;
}
function recordReceipt(receipt) {
  log('domain.receipt', receipt);
  if (activePhase) activePhase.calls.push({ tool: receipt.tool, toolCallId: receipt.toolCallId,
    ticket: receipt.result.structuredContent?.ticket ?? receipt.ticket, isError: receipt.result.isError === true,
    receipt: receipt.result.structuredContent ?? null });
}
function recordTransportFailure(diagnostic) {
  log('domain.transport-failure', diagnostic);
  if (activePhase) (activePhase.unknownDispatches ??= []).push(diagnostic);
}
function recordEvent(event) {
  // Final native messages already live in Pi's JSONL. This trace is observability
  // only and is never converted back into provider messages.
  if (event.type === 'message_update') return;
  log('pi.event', event);
}
const onSignal = signal => {
  interrupted = Error(`Interrupted by ${signal}`);
  void (adapter ? adapter.stop() : revokeDomain()).catch(error => log('stop.error', String(error)));
};
const onInt = () => onSignal('SIGINT'), onTerm = () => onSignal('SIGTERM');
process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
try {
  const packageInfo = JSON.parse(await readFile(path.join(cfg.piPackageRoot, 'package.json'), 'utf8'));
  if (packageInfo.name !== '@earendil-works/pi-coding-agent' || packageInfo.version !== '1.4.0')
    throw Error('This arm requires the already inspected Pi 1.4.0 SDK');
  const pi = await import(pathToFileURL(path.join(cfg.piPackageRoot, 'dist/index.js')).href);
  const { Client } = await import(pathToFileURL(path.join(cfg.mcpSdkRoot, 'dist/esm/client/index.js')).href);
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(path.join(cfg.mcpSdkRoot, 'dist/esm/client/streamableHttp.js')).href);
  transport = new StreamableHTTPClientTransport(endpoint);
  client = new Client({ name: 'guoling-pi-domain-vertical', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  report.domainSessionId = transport.sessionId;
  if (interrupted) throw interrupted;
  const context = await bootstrap();
  const agentDir = path.join(attemptDirectory, 'pi'), sessionDir = path.join(agentDir, 'sessions');
  await mkdir(sessionDir, { recursive: true });
  const runtime = await pi.ModelRuntime.create({ authPath: path.join(agentDir, 'unused-auth.json'),
    modelsPath: null, modelsStorePath: path.join(agentDir, 'models-store.json'),
    allowModelNetwork: false, refreshOnCreate: false });
  // These are this experiment's conservative context/output limits, not a claim
  // about the provider's maximum capacity or pricing. Money cost is unmeasured.
  const maxTokens = Math.min(Math.max(cfg.maxTokens ?? 8192, 512), 8192);
  // Pi 1.4 requires cost metadata and reads cost.tiers while finalizing a real
  // response. These zeros are SDK compatibility placeholders, not provider
  // prices or evidence of a free request. Native calculated money is not measured.
  const sdkCostPlaceholder = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  runtime.registerProvider(route.provider, { baseUrl: route.baseUrl, api: 'openai-completions',
    models: [{ id: route.model, name: route.model, reasoning: false, input: ['text'],
      cost: sdkCostPlaceholder, contextWindow: 32768, maxTokens }] });
  await runtime.setRuntimeApiKey(route.provider, key);
  const model = runtime.getModel(route.provider, route.model);
  if (!model || runtime.isUsingOAuth(route.provider)) throw Error('The exact API-key model route was not configured');
  const settings = pi.SettingsManager.inMemory({ cacheWarming: 'off', compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 1, baseDelayMs: 1000, maxAgentDelayMs: 5000,
      provider: { maxRetries: 0, timeoutMs: 120000, maxRetryDelayMs: 5000 } },
    enableAnalytics: false, enableInstallTelemetry: false, packages: [], extensions: [], skills: [], prompts: [] });
  report.nativeSettings = { compaction: settings.getCompactionSettings(model), retry: settings.getRetrySettings(),
    providerRetry: settings.getProviderRetrySettings(), cacheWarming: settings.getCacheWarmingMode(),
    experimentContextLimit: 32768, experimentOutputLimit: maxTokens, moneyCost: 'unmeasured',
    sdkCostMetadata: { kind: 'required-compatibility-placeholder', rates: sdkCostPlaceholder,
      representsProviderPrices: false, nativeCalculatedMoneyIsMeasured: false } };
  const makeResources = async () => {
    const loader = new pi.DefaultResourceLoader({ cwd: cfg.cwd, agentDir, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: '你是果铃内的文档编辑助手。按用户要求判断内容和编辑方案，调用提供的果铃领域工具完成正式修改与保存。目标句柄、版本、授权、保存和操作结果以工具回执为准。未知结果先查询原操作，不猜测成功、不盲目重放。只修改本轮指定的对象与范围，保留其他内容和人工改动。',
      extensionFactories: [api => {
        api.on('before_provider_request', event => {
          const facts = { ...providerRequestFacts(event.payload), phase: activePhase?.label ?? null };
          report.actualProviderRequests.push(facts);
          log('provider.request', facts);
          // No return value and no mutation: Pi owns the complete payload.
        });
      }] });
    await loader.reload();
    if (loader.getExtensions().errors.length) throw Error('Pi extension setup failed: ' + JSON.stringify(loader.getExtensions().errors));
    return loader;
  };
  const openSession = async sessionFile => createPiDomainSession({ pi, client, revokeDomain,
    modelRuntime: runtime, model, resourceLoader: await makeResources(), settingsManager: settings,
    cwd: cfg.cwd, agentDir, sessionDir, sessionFile, thinkingLevel: 'off',
    allowedToolNames: cfg.allowedToolNames, onEvent: recordEvent, onReceipt: recordReceipt,
    onTransportFailure: recordTransportFailure });
  adapter = await openSession();
  report.tools = adapter.tools;
  report.state = 'ready-no-model';
  report.preflightMs = Math.round(performance.now() - started);
  if (run) {
    if (interrupted || logError) throw interrupted ?? logError;
    if (sha256(await readFile(cfg.fixture.file)) !== cfg.fixture.initialHash) throw Error('Fixture changed during preflight');
    await writeFile(path.join(cfg.outputDirectory, 'model-send-attempted.json'), JSON.stringify({
      at: new Date().toISOString(), settingsPath, summaryFile, route }, null, 2), { flag: 'wx' });
    report.modelSendAttempted = true;
    const prompts = [{ label: cfg.label ?? 'domain-edit', text: cfg.prompt, context },
      ...(cfg.followupPrompt ? [{ label: 'native-reopen-followup', text: cfg.followupPrompt }] : [])];
    let previousHash = cfg.fixture.initialHash;
    for (let index = 0; index < prompts.length; index++) {
      const prompt = prompts[index];
      if (index) {
        const nativeSessionId = adapter.manager.getSessionId();
        const nativeSessionFile = await adapter.releaseForReopen();
        if (!nativeSessionFile) throw Error('Pi did not create its native persistent session');
        adapter = await openSession(nativeSessionFile);
        if (adapter.manager.getSessionId() !== nativeSessionId) throw Error('Native Pi session identity changed on reopen');
        const restoredToolResults = adapter.session.messages.filter(message => message.role === 'toolResult').length;
        report.reopen = { nativeSessionId, nativeSessionFile,
          restoredMessageCount: adapter.session.messages.length, restoredToolResults };
        if (!restoredToolResults) throw Error('The reopened native Pi session did not retain its real domain tool receipts');
        prompt.context = await bootstrap();
      }
      const phase = { label: prompt.label, calls: [], startedMs: Math.round(performance.now() - started) };
      activePhase = phase; report.phases.push(phase);
      let timer, deadlineError;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          deadlineError = Error('Domain task deadline exceeded; domain stopped before Pi abort');
          void adapter.stop().then(() => reject(deadlineError),
            error => reject(new AggregateError([error], 'Domain task deadline and stop failed')));
        }, Math.min(cfg.timeoutMs ?? 180000, 180000));
      });
      try {
        const result = await Promise.race([adapter.prompt(`${prompt.text}\n\n宿主本轮读取的授权上下文：\n${JSON.stringify(prompt.context)}`), deadline]);
        if (deadlineError) { await adapter.stop(); throw deadlineError; }
        Object.assign(phase, result, { elapsedMs: Math.round(performance.now() - started - phase.startedMs) });
      } finally { clearTimeout(timer); }
      if (interrupted || logError) throw interrupted ?? logError;
      if (!phase.nativeSessionFile) throw Error('No native session file after the real turn');
      report.nativeSessions.push({ nativeSessionId: phase.nativeSessionId, nativeSessionFile: phase.nativeSessionFile });
      const archive = await readFile(cfg.fixture.file), currentHash = sha256(archive);
      phase.diskCheckpoint = { sha256: currentHash, bytes: archive.length, changed: currentHash !== previousHash };
      phase.successfulSaveCalls = phase.calls.filter(call => call.tool === saveToolName && !call.isError).length;
      await writeFile(path.join(attemptDirectory, `${index + 1}.after${path.extname(cfg.fixture.file) || '.bin'}`), archive, { flag: 'wx' });
      if (!phase.diskCheckpoint.changed || !phase.successfulSaveCalls)
        throw Error('Native turn ended without a successful domain save call and changed disk archive');
      previousHash = currentHash;
    }
    const observed = report.actualProviderRequests;
    if (!observed.length || !observed.some(request => report.tools.every(tool => request.tools.some(actual =>
      actual.name === tool.piName && actual.schemaSha256 === tool.schemaSha256))))
      throw Error('Actual model-request evidence does not include the selected tool schemas');
    if (observed.some(request => request.model !== route.model || request.tools.some(tool => !report.tools.some(expected =>
      expected.piName === tool.name && expected.schemaSha256 === tool.schemaSha256))))
      throw Error('Actual model request changed the selected model or tool boundary');
    if (cfg.followupPrompt && !observed.find(request => request.phase === 'native-reopen-followup')?.toolResultCount)
      throw Error('The first resumed model request has no native domain-tool history');
    report.state = 'real-domain-turn-complete-pending-independent-verification';
  }
} catch (error) {
  report.error = { name: error?.name, message: clean(String(error?.message ?? error)) };
  process.exitCode = 1;
} finally {
  try { if (adapter) await adapter.close(); else await revokeDomain(); }
  catch (error) { report.cleanupError = clean(String(error)); process.exitCode = 1; }
  try { await client?.close(); } catch (error) { report.transportCloseError = clean(String(error)); process.exitCode = 1; }
  process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  await logTail;
  if (logError) { report.logError = clean(String(logError)); process.exitCode = 1; }
  report.endedAt = new Date().toISOString(); report.totalMs = Math.round(performance.now() - started);
  report.warning = 'A native turn, tool receipt, or changed archive is not complete document acceptance. Verify exact content, unchanged other objects, manual edits, dirty=false, real Source behavior, and an independent cold reopen. The product default engine is unchanged.';
  await writeFile(summaryFile, JSON.stringify(clean(report), null, 2));
  process.stdout.write(JSON.stringify({ summaryFile, eventsFile, state: report.state,
    modelSendAttempted: report.modelSendAttempted, providerRequests: report.actualProviderRequests.length,
    error: report.error, cleanupError: report.cleanupError }) + '\n');
}
