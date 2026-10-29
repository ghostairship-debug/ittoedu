/** Isolated ACP domain experiment. No inference unless --run is supplied.
 * node --import tsx scripts/experiments/acp-domain-controller.mjs --settings <absolute.json> [--run]
 * Uses the already authorized native session config; never logs in, changes defaults, or reads tokens.
 * Required settings follow the selected-object experiment: command/args/cwd/outputDirectory,
 * env.CODEX_CONFIG, unsetEnv, preflightEvidence, configSha256, modelId/effort, mcpName/mcpUrl,
 * allowedToolNames, sessionMcpServers: [], fixture:{file,initialHash}, prompt or prompts[].
 * Optional expectDiskChange:boolean defaults to true; false requires the archive to remain unchanged per turn.
 * Optional resumeBetweenPrompts exercises native recovery; turnBudgetMs is only this experiment's budget.
 * Optional recovery:{sessionId,configOptions?} restores an explicit native session in this new process.
 * Before a recovery run, the host must read current workbench state/receipts and grant a fresh domain run.
 * Host IPC {type:'guoling-acp-cancel',requestId,reason?} requests cancellation without replaying a prompt.
 * Explicit allowTransportFaultInjection:true permits one guoling-acp-test-disconnect IPC during a live prompt.
 */
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { AcpAgentSession, createStdioAcpTransport } from '../../src/main/workbench/external/acp/AcpAgentSession.ts';

const argv = process.argv.slice(2), index = argv.indexOf('--settings');
if (index < 0 || !argv[index + 1]) throw new Error('--settings is required');
const settingsPath = path.resolve(argv[index + 1]);
const cfg = JSON.parse(await readFile(settingsPath, 'utf8'));
if (cfg.expectDiskChange !== undefined && typeof cfg.expectDiskChange !== 'boolean') throw new Error('expectDiskChange must be a boolean when supplied');
if (cfg.allowTransportFaultInjection !== undefined && typeof cfg.allowTransportFaultInjection !== 'boolean') throw new Error('allowTransportFaultInjection must be a boolean when supplied');
const expectDiskChange = cfg.expectDiskChange ?? true;
const run = argv.includes('--run'), sha256 = value => createHash('sha256').update(value).digest('hex');
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
if (!path.isAbsolute(cfg.cwd) || !path.isAbsolute(cfg.outputDirectory) || !cfg.command || !Array.isArray(cfg.args)) throw new Error('Absolute cwd/outputDirectory and explicit command/args are required');
if (cfg.modelId !== 'gpt-6.1-terra' || !cfg.effort) throw new Error('This authorized experiment requires exact gpt-6.1-terra and an explicit effort');
if (run && (typeof process.send !== 'function' || !process.connected)) throw new Error('--run requires the experiment host IPC domain-revoke callback; preflight remains available');
if (!Array.isArray(cfg.allowedToolNames) || !cfg.allowedToolNames.length || !Array.isArray(cfg.sessionMcpServers) || cfg.sessionMcpServers.length) throw new Error('Explicit MCP allowlist and empty sessionMcpServers are required');
const endpoint = new URL(cfg.mcpUrl);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('An explicit loopback MCP endpoint is required');
const native = JSON.parse(cfg.env?.CODEX_CONFIG ?? 'null');
const proof = JSON.parse(await readFile(cfg.preflightEvidence, 'utf8'));
if (proof.status !== 'ready-no-model' || proof.accountType !== 'chatgpt' || proof.provider !== 'openai'
  || proof.requestedModel !== cfg.modelId || proof.effort !== cfg.effort
  || proof.configSha256 !== sha256(cfg.env.CODEX_CONFIG) || proof.configSha256 !== cfg.configSha256) throw new Error('Current native authorization/config proof does not match this exact experiment');
const mcp = native?.mcp_servers?.[cfg.mcpName];
if (native.model_provider !== 'openai' || native.forced_login_method !== 'chatgpt' || native.model !== cfg.modelId
  || native.model_reasoning_effort !== cfg.effort || native.sandbox_mode !== 'read-only' || native.approval_policy !== 'on-request'
  || native.web_search !== 'disabled' || native.features?.multi_agent !== false || native.features?.mcp_tool_list_changed !== true) throw new Error('Native route or scoped experiment settings changed');
if (!mcp || mcp.enabled !== true || mcp.url !== cfg.mcpUrl || mcp.default_tools_approval_mode !== 'approve'
  || !sameSet(mcp.enabled_tools, cfg.allowedToolNames) || !sameSet(proof.selectedMcp?.enabled_tools, cfg.allowedToolNames)
  || Object.entries(native.mcp_servers).some(([name, value]) => name !== cfg.mcpName && value.enabled !== false)) throw new Error('Native MCP configuration does not preserve the approved scope');
const prompts = cfg.prompts ?? (cfg.prompt ? [cfg.prompt] : []);
if (run && cfg.allowTransportFaultInjection === true && (prompts.length !== 1 || cfg.resumeBetweenPrompts)) throw new Error('Transport fault injection requires one explicit prompt and no automatic reconnect');
if (cfg.recovery !== undefined && (!cfg.recovery || typeof cfg.recovery.sessionId !== 'string' || !cfg.recovery.sessionId.trim()
  || cfg.recovery.configOptions !== undefined && !Array.isArray(cfg.recovery.configOptions))) throw new Error('Recovery requires an explicit native sessionId and optional configOptions');
if (run && (!prompts.length || prompts.some(prompt => typeof prompt !== 'string' || !prompt.trim())
  || !cfg.fixture?.file || path.dirname(cfg.fixture.file) !== cfg.cwd || !cfg.fixture.initialHash)) throw new Error('A run requires explicit prompts and an exact isolated fixture');
if (cfg.fixture?.file && sha256(await readFile(cfg.fixture.file)) !== cfg.fixture.initialHash) throw new Error('Fixture changed before preflight');

await mkdir(cfg.outputDirectory, { recursive: true });
const base = path.join(cfg.outputDirectory, `${run ? 'run' : 'preflight'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const eventsFile = `${base}.jsonl`, summaryFile = `${base}.json`, started = performance.now();
const report = { startedAt: new Date().toISOString(), run, modelId: cfg.modelId, effort: cfg.effort,
  preflightEvidence: cfg.preflightEvidence, modelSendAttempted: false, domainTerminationAcknowledged: false, phases: [], diskCheckpoints: [], error: null,
  recoveryRequested: !!cfg.recovery, automaticReplay: false, expectDiskChange };
let session, transport, faultInjection, interrupted, logFailure, revokePromise, stopPromise, logTail = Promise.resolve();
function revokeDomain(reason) {
  if (!run) return Promise.resolve();
  if (revokePromise) return revokePromise;
  const requestId = randomUUID();
  report.domainRevocation = { requestId, reason, status: 'pending' };
  if (typeof process.send !== 'function' || !process.connected) {
    const error = new Error('Experiment host IPC is unavailable; domain revocation was not acknowledged');
    report.domainRevocation.status = 'failed'; report.domainRevocation.error = error.message;
    return revokePromise = Promise.reject(error);
  }
  revokePromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); process.off('message', onMessage); process.off('disconnect', onDisconnect);
      if (error) { report.domainRevocation.status = 'failed'; report.domainRevocation.error = error.message; reject(error); }
      else { report.domainRevocation.status = 'acknowledged'; report.domainTerminationAcknowledged = true; resolve(); }
    };
    const onMessage = message => {
      if (message?.type !== 'guoling-acp-domain-revoke-result' || message.requestId !== requestId) return;
      finish(message.ok === true ? undefined : new Error(String(message.error ?? 'Experiment host could not revoke domain writes')));
    };
    const onDisconnect = () => finish(new Error('Experiment host IPC disconnected before domain revocation was acknowledged'));
    const timer = setTimeout(() => finish(new Error('Experiment host did not acknowledge domain revocation')), cfg.revokeTimeoutMs ?? 5000);
    process.on('message', onMessage); process.once('disconnect', onDisconnect);
    try {
      process.send({ type: 'guoling-acp-domain-revoke', requestId, reason, sessionId: session?.snapshot.sessionId }, error => { if (error) finish(error); });
    } catch (error) { finish(error); }
  });
  return revokePromise;
}
const clean = (value, key = '') => {
  if (/^(accessToken|refreshToken|idToken|access_token|refresh_token|id_token|secret|password|authorization|apiKey|api_key|credential|credentials|headers|env|CODEX_CONFIG)$/i.test(key)) return '[redacted]';
  if (typeof value === 'string') return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]');
  if (Array.isArray(value)) return value.map(item => clean(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, clean(item, name)]));
  return value;
};
const log = (kind, data) => {
  logTail = logTail.then(() => appendFile(eventsFile, JSON.stringify({ at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), kind, data: clean(data) }) + '\n'))
    .catch(error => { logFailure ??= error; void session?.cancel().catch(() => undefined); });
};
const notifyHost = message => {
  if (!run || !process.connected) return;
  try { process.send(message, error => { if (error) log('host.notification_failed', { error: error.message }); }); }
  catch (error) { log('host.notification_failed', { error: String(error?.message ?? error) }); }
};
const permissionPolicy = request => {
  const raw = request.toolCall.rawInput;
  // ACP adapters may classify MCP calls as execute; the structured domain scope decides permission.
  const allowed = raw && typeof raw === 'object'
    && raw.command === undefined && raw.cmd === undefined
    && (raw.server ?? raw.serverName) === cfg.mcpName
    && cfg.allowedToolNames.includes(raw.tool ?? raw.toolName);
  const option = request.options.find(item => item.kind === (allowed ? 'allow_once' : 'reject_once'));
  log('permission.decision', { allowed: !!allowed, optionId: option?.optionId, tool: raw?.tool ?? raw?.toolName });
  return option?.optionId;
};
async function connect(recovery) {
  const env = { ...process.env, ...(cfg.env ?? {}) };
  for (const name of cfg.unsetEnv ?? []) delete env[name];
  transport = createStdioAcpTransport({ command: cfg.command, args: cfg.args, cwd: cfg.cwd, env, onStderr: text => log('stderr', { text }) });
  session = new AcpAgentSession({ transport, permissionPolicy,
    onBeforeCancel: run ? ({ reason }) => revokeDomain(reason) : undefined, beforeCancelTimeoutMs: cfg.revokeTimeoutMs ?? 5000,
    onSessionUpdate: event => log('session.update', event), promptIdleTimeoutMs: cfg.idleTimeoutMs });
  const initialized = await session.initialize();
  if (proof.adapterVersion && initialized.agentInfo?.version !== proof.adapterVersion) throw new Error('The adapter version changed since native preflight');
  report.agentInfo = initialized.agentInfo;
  const input = { cwd: cfg.cwd, mcpServers: [] };
  const opened = recovery ? await session.restore({ ...input, sessionId: recovery.sessionId, configOptions: recovery.configOptions }) : await session.open(input);
  await session.configure({ modelId: cfg.modelId, effort: cfg.effort });
  report.sessionId = session.snapshot.sessionId;
  report.phases.push({ name: recovery ? 'recovery' : 'preflight', elapsedMs: Math.round(performance.now() - started),
    recoveryMethod: opened.recoveryMethod, modelId: session.snapshot.modelId, effort: session.snapshot.effort, ok: true });
  if (!report.sessionMetadataFile) {
    const sessionMetadataFile = `${base}.session.json`;
    const configOptions = session.configuration.filter(option => option.category === 'model' || option.id === 'model'
      || option.category === 'thought_level' || /reasoning.*effort|^thought_level$/.test(option.id));
    await writeFile(sessionMetadataFile, JSON.stringify(clean({ schemaVersion: 1, recordedAt: new Date().toISOString(),
      recovery: { sessionId: report.sessionId, configOptions }, modelId: cfg.modelId, effort: cfg.effort, sourceSummary: summaryFile,
      requirement: 'Native history only. Read current workbench state and domain receipts, obtain a fresh domain grant, then supply an explicit continuation prompt; never replay an interrupted write.' }), null, 2), { flag: 'wx' });
    report.sessionMetadataFile = sessionMetadataFile;
  }
  notifyHost({ type: 'guoling-acp-session-ready', sessionId: report.sessionId, sessionMetadataFile: report.sessionMetadataFile,
    recoveryMethod: opened.recoveryMethod, modelId: session.snapshot.modelId, effort: session.snapshot.effort });
}
const onSignal = (signal, requestId) => {
  interrupted ??= Object.assign(new Error(`Interrupted by ${signal}`), { code: 'experiment_cancelled' });
  report.cancellation ??= { reason: signal, requestId, requestedAt: new Date().toISOString(), phaseAtRequest: session?.snapshot.phase,
    appliedEffects: 'unknown; inspect current workbench state and original domain receipts before recovery' };
  return stopPromise ??= (async () => {
    if (session?.snapshot.phase === 'prompting') await session.cancel();
    else { try { await revokeDomain(signal); } finally { await session?.close(); } }
  })().catch(error => { report.stopError = String(error?.message ?? error); throw error; });
};
const onInt = () => { void onSignal('SIGINT').catch(() => undefined); };
const onTerm = () => { void onSignal('SIGTERM').catch(() => undefined); };
const onHostDisconnect = () => { void onSignal('host-disconnect').catch(() => undefined); };
const onHostMessage = message => {
  if (message?.type === 'guoling-acp-test-disconnect') {
    const requestId = message.requestId, snapshot = session?.snapshot;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) return;
    if (cfg.allowTransportFaultInjection !== true || snapshot?.phase !== 'prompting' || !snapshot.pendingRequests || snapshot.cancelling || !transport || report.transportFault) {
      notifyHost({ type: 'guoling-acp-test-disconnect-result', requestId, accepted: false,
        reason: 'Transport fault injection is disabled, the prompt is inactive, or the single attempt was used' }); return;
    }
    report.transportFault = { requestId, method: 'owned-transport.close', requestedAt: new Date().toISOString(),
      sessionId: snapshot.sessionId, phaseAtRequest: snapshot.phase, pendingRequestsAtRequest: snapshot.pendingRequests };
    log('host.test_disconnect', report.transportFault);
    notifyHost({ type: 'guoling-acp-test-disconnect-result', requestId, accepted: true, method: report.transportFault.method });
    // Close the actual owned stdio transport. Preserve its real outcome; accepted is not a connection_failure verdict.
    faultInjection = transport.close().then(() => { report.transportFault.closedAt = new Date().toISOString(); }, error => {
      report.transportFault.error = { message: String(error?.message ?? error), code: error?.code };
    });
    return;
  }
  if (message?.type !== 'guoling-acp-cancel' || typeof message.requestId !== 'string' || !message.requestId) return;
  log('host.cancel', { requestId: message.requestId, reason: message.reason });
  void onSignal('host-cancel', message.requestId).then(() => notifyHost({ type: 'guoling-acp-cancel-result', requestId: message.requestId,
    ok: true, sessionId: report.sessionId, domainTerminationAcknowledged: report.domainTerminationAcknowledged, automaticReplay: false }),
  error => notifyHost({ type: 'guoling-acp-cancel-result', requestId: message.requestId, ok: false, error: String(error?.message ?? error) }));
};
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
if (run) { process.once('disconnect', onHostDisconnect); process.on('message', onHostMessage); }
try {
  if (run && !process.connected) throw new Error('Experiment host IPC disconnected before preflight');
  await connect(cfg.recovery);
  if (run) {
    if (interrupted || logFailure) throw interrupted ?? logFailure;
    if (sha256(await readFile(cfg.fixture.file)) !== cfg.fixture.initialHash) throw new Error('Fixture changed during preflight');
    await writeFile(path.join(cfg.outputDirectory, 'model-send-attempted.json'), JSON.stringify({ at: new Date().toISOString(), settingsPath, summaryFile, sessionId: report.sessionId }), { flag: 'wx' });
    report.modelSendAttempted = true;
    let previousHash = cfg.fixture.initialHash;
    for (const [number, text] of prompts.entries()) {
      if (interrupted || logFailure) throw interrupted ?? logFailure;
      const turnStarted = performance.now();
      const timer = cfg.turnBudgetMs ? setTimeout(() => { void onSignal('experiment-budget').catch(() => undefined); }, cfg.turnBudgetMs) : undefined;
      let result;
      try {
        const pending = session.prompt([{ type: 'text', text }]);
        notifyHost({ type: 'guoling-acp-turn-started', sessionId: report.sessionId, turn: number + 1 });
        result = await pending;
      } finally { clearTimeout(timer); }
      report.phases.push({ name: `prompt-${number + 1}`, elapsedMs: Math.round(performance.now() - turnStarted), result });
      const observedModels = (result._meta?.quota?.model_usage ?? []).map(item => item.model);
      if (observedModels.some(model => model !== cfg.modelId)) throw new Error('Returned model usage does not match the authorized model');
      if (logFailure) throw logFailure;
      if (interrupted || result.stopReason === 'cancelled') {
        report.cancelled = true;
        report.cancellation ??= { reason: 'agent-cancelled', appliedEffects: 'unknown; inspect current workbench state and original domain receipts before recovery' };
        break;
      }
      if (result.stopReason !== 'end_turn') throw new Error(`Turn stopped with ${result.stopReason}; no automatic retry`);
      const bytes = await readFile(cfg.fixture.file), hash = sha256(bytes), snapshotFile = `${base}.prompt-${number + 1}.glx`;
      await writeFile(snapshotFile, bytes, { flag: 'wx' });
      report.diskCheckpoints.push({ file: snapshotFile, sha256: hash, changed: hash !== previousHash, observedModels, forensicCopyOfDisk: true });
      if ((hash !== previousHash) !== expectDiskChange) throw new Error(expectDiskChange
        ? 'Disk archive unchanged; no automatic retry'
        : 'Disk archive changed during an expected read-only run; no automatic retry');
      previousHash = hash;
      if (cfg.resumeBetweenPrompts && number + 1 < prompts.length) {
        const recovery = { sessionId: session.snapshot.sessionId, configOptions: session.configuration };
        await session.close(); await connect(recovery);
      }
    }
  }
} catch (error) {
  if (interrupted && (error === interrupted || ['cancel_race', 'closed'].includes(error?.code))) {
    report.cancelled = true;
    report.cancellation.turnError = { message: String(error?.message ?? error), code: error?.code };
  } else { report.error = { message: String(error?.message ?? error), code: error?.code }; process.exitCode = 1; }
  report.domainRunMustBeStoppedByRoot = report.modelSendAttempted;
} finally {
  await faultInjection;
  try { await stopPromise; } catch { /* The recorded stop error remains a failure even if cleanup succeeds. */ }
  try { await revokeDomain(interrupted || report.cancelled ? 'cancelled' : report.error ? 'failure' : 'complete'); }
  catch (error) { report.domainStopError = String(error?.message ?? error); process.exitCode = 1; }
  try { await session?.close(); } catch (error) { report.cleanupError = String(error?.message ?? error); process.exitCode = 1; }
  report.cleanup = session?.snapshot;
  process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  process.off('disconnect', onHostDisconnect); process.off('message', onHostMessage);
  await logTail;
  if (logFailure) { report.logError = String(logFailure); process.exitCode = 1; }
  report.endedAt = new Date().toISOString(); report.totalMs = Math.round(performance.now() - started);
  report.state = report.error || report.stopError || report.cleanupError || report.domainStopError || report.logError || report.transportFault?.error ? 'failed'
    : interrupted || report.cancelled ? 'cancelled' : run ? 'turns-finished' : 'preflight-ready';
  if (report.state === 'failed') process.exitCode = 1;
  report.domainRunMustBeStoppedByRoot = report.modelSendAttempted && !report.domainTerminationAcknowledged;
  report.warning = 'ACP completion and a matching disk-change expectation do not establish document acceptance. Cancelled turns may already have applied tools. Before recovery, inspect current workbench state and original receipts and obtain a fresh domain grant; never replay interrupted writes. Verify preserved human content, save/cold reopen and editability independently.';
  await writeFile(summaryFile, JSON.stringify(clean(report), null, 2));
  process.stdout.write(JSON.stringify({ summaryFile, eventsFile, sessionMetadataFile: report.sessionMetadataFile, state: report.state,
    error: report.error, cancellation: report.cancellation, transportFault: report.transportFault, modelSendAttempted: report.modelSendAttempted, cleanup: report.cleanup }) + '\n');
}
