/** Zero-model native ACP prerequisite. Never logs in, prompts, installs, or writes global config.
 * node scripts/experiments/prepare-acp-domain.mjs --settings <absolute input.json>
 * The host supplies cwd/outputDirectory/fixture/expectedDocumentId/mcpUrl/mcpName/
 * allowedToolNames/modelId/effort/prompt(s). On success this same file gains controller launch fields.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2), at = argv.indexOf('--settings');
if (at < 0 || !argv[at + 1]) throw new Error('--settings is required');
const settingsPath = path.resolve(argv[at + 1]), originalSettings = fs.readFileSync(settingsPath);
const cfg = JSON.parse(originalSettings.toString('utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const clean = value => String(value).replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
  .replace(/("(?:apiKey|api_key|authorization|accessToken|access_token|refreshToken|refresh_token|idToken|id_token|secret|password)"\s*:\s*")[^"]*/gi, '$1[redacted]');
if (cfg.modelId !== 'gpt-6.1-terra' || typeof cfg.effort !== 'string' || !cfg.effort) throw new Error('This experiment requires exact gpt-6.1-terra and an explicit effort');
if (!path.isAbsolute(cfg.cwd) || !path.isAbsolute(cfg.outputDirectory) || !path.isAbsolute(cfg.fixture?.file ?? '')
  || path.dirname(cfg.fixture.file) !== cfg.cwd) throw new Error('Absolute cwd/outputDirectory and an existing isolated fixture in cwd are required');
if (!cfg.expectedDocumentId || !cfg.mcpName || !Array.isArray(cfg.allowedToolNames) || !cfg.allowedToolNames.length
  || cfg.allowedToolNames.some(name => typeof name !== 'string' || !name)) throw new Error('Explicit document identity, MCP name and tool allowlist are required');
const endpoint = new URL(cfg.mcpUrl);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('An explicit loopback MCP endpoint is required');
const fixtureHash = hash(fs.readFileSync(cfg.fixture.file));
if (cfg.fixture.initialHash && cfg.fixture.initialHash !== fixtureHash) throw new Error('Fixture differs from the host snapshot; no overwrite was attempted');
fs.mkdirSync(cfg.outputDirectory, { recursive: true });
if (fs.existsSync(path.join(cfg.outputDirectory, 'model-send-attempted.json'))) throw new Error('This experiment already attempted a model turn; use a new isolated run directory');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeRoot = path.join(repo, 'output/architecture-round3-research-20261027/harness/acp-native/node_modules');
const native = path.join(nativeRoot, '@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const adapter = path.join(nativeRoot, '@agentclientprotocol/codex-acp/dist/index.js');
for (const file of [native, adapter]) if (!fs.existsSync(file)) throw new Error('Already installed pinned dependency missing: ' + file);
const nativeVersion = JSON.parse(fs.readFileSync(path.join(nativeRoot, '@openai/codex/package.json'), 'utf8')).version;
const adapterVersion = JSON.parse(fs.readFileSync(path.join(nativeRoot, '@agentclientprotocol/codex-acp/package.json'), 'utf8')).version;
if (nativeVersion !== '0.164.0' || adapterVersion !== '2.3.0') throw new Error('Expected installed native 0.164.0 and adapter 2.3.0; no installation was attempted');

const disabledServers = [...new Set(['taptap-maker', 'maker-lua-lsp', 'openaiDeveloperDocs', 'node_repl', 'phaser-game-agent', ...(cfg.disabledMcp ?? [])])]
  .filter(name => name !== cfg.mcpName);
const config = { model_provider: 'openai', forced_login_method: 'chatgpt', model: cfg.modelId, model_reasoning_effort: cfg.effort,
  sandbox_mode: 'read-only', approval_policy: 'on-request', web_search: 'disabled', features: { multi_agent: false, mcp_tool_list_changed: true },
  mcp_servers: Object.fromEntries([...disabledServers.map(name => [name, { enabled: false }]),
    [cfg.mcpName, { enabled: true, url: cfg.mcpUrl, enabled_tools: cfg.allowedToolNames, default_tools_approval_mode: 'approve' }]]) };
const configJson = JSON.stringify(config), configSha256 = hash(configJson);
const flat = (value, prefix = '') => Object.entries(value).flatMap(([key, item]) => item && typeof item === 'object' && !Array.isArray(item)
  ? flat(item, prefix + key + '.') : [[prefix + key, item]]);
const args = ['app-server', ...flat(config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])];
const unsetEnv = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'DEFAULT_AUTH_REQUEST', 'MODEL_PROVIDER', 'CODEX_CONFIG'];
const env = { ...process.env }; for (const name of unsetEnv) delete env[name];
const child = spawn(native, args, { cwd: cfg.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const lines = createInterface({ input: child.stdout }), pending = new Map();
let nextId = 1, closed = false, failure, interrupted, exitInfo, stderrBytes = 0;
const started = Date.now(), evidence = path.join(cfg.outputDirectory, `native-preflight-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
let report = { at: new Date().toISOString(), status: 'started', modelCalls: 0, nativeVersion, adapterVersion,
  file: cfg.fixture.file, fixtureHash, expectedDocumentId: cfg.expectedDocumentId, configSha256 };
function fail(error) { failure ??= error; for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); }
child.stderr.on('data', data => { stderrBytes += data.length; });
child.stdin.on('error', fail);
child.on('error', error => { closed = true; fail(error); });
child.on('close', (code, signal) => { closed = true; exitInfo = { code, signal }; fail(new Error('Native preflight process closed')); });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { fail(new Error('Native preflight stdout contained a non-JSON frame')); return; }
  if (message.method) {
    if (message.id !== undefined) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Zero-model preflight does not execute agent callbacks' } }) + '\n');
    return;
  }
  const entry = pending.get(message.id); if (!entry) return;
  pending.delete(message.id); clearTimeout(entry.timer);
  if (message.error) entry.reject(new Error(clean(message.error.message ?? 'Native RPC failed'))); else entry.resolve(message.result);
});
function rpc(method, params = {}) {
  if (!['initialize', 'config/read', 'account/read', 'model/list'].includes(method)) throw new Error('This preflight cannot send model or task methods');
  if (closed || failure || interrupted) return Promise.reject(interrupted ?? failure ?? new Error('Native preflight is closed'));
  return new Promise((resolve, reject) => {
    const id = nextId++, timer = setTimeout(() => fail(new Error(`${method} timed out`)), 15000);
    pending.set(id, { resolve, reject, timer });
    try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }
    catch (error) { fail(error); }
  });
}
function waitClosed(milliseconds) {
  if (closed) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); child.off('close', done); resolve(); };
    const timer = setTimeout(done, milliseconds); child.once('close', done);
  });
}
async function cleanup() {
  fail(new Error('Native preflight cleanup'));
  if (!closed) { child.stdin.end(); await waitClosed(1500); }
  if (!closed && child.pid) {
    if (process.platform === 'win32') await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const done = () => { clearTimeout(timer); resolve(); }, timer = setTimeout(done, 3000);
      killer.once('error', done); killer.once('close', done);
    });
    else child.kill('SIGTERM');
    await waitClosed(1500);
  }
  lines.close();
  if (!closed) throw new Error('Owned native preflight process did not exit');
  return { ownedPid: child.pid, closed, pendingRequests: pending.size, exit: exitInfo, stderrBytes };
}
const onSignal = signal => { interrupted = new Error('Interrupted by ' + signal); fail(interrupted); };
const onInt = () => onSignal('SIGINT'), onTerm = () => onSignal('SIGTERM');
process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
let updatedSettings;
try {
  const initialized = await rpc('initialize', { clientInfo: { name: 'guoling-acp-domain-preflight', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
  const results = await Promise.allSettled([rpc('config/read', { includeLayers: false, cwd: cfg.cwd }), rpc('account/read', { refreshToken: false })]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const effective = results[0].value.config, account = results[1].value.account, selectedMcp = effective.mcp_servers?.[cfg.mcpName];
  if (account?.type !== 'chatgpt') throw new Error('No native ChatGPT account is available; no login was attempted');
  if (effective.model_provider !== 'openai' || effective.forced_login_method !== 'chatgpt' || effective.model !== cfg.modelId || effective.model_reasoning_effort !== cfg.effort) throw new Error('Effective native model/auth route does not match the request');
  if (effective.features?.multi_agent !== false || effective.features?.mcp_tool_list_changed !== true || effective.sandbox_mode !== 'read-only'
    || effective.approval_policy !== 'on-request' || effective.web_search !== 'disabled') throw new Error('Effective native scope or features do not match');
  const others = Object.entries(effective.mcp_servers ?? {}).filter(([name, value]) => name !== cfg.mcpName && value.enabled !== false).map(([name]) => name);
  if (others.length) throw new Error('Additional MCP servers remain enabled: ' + others.join(',') + '; add their names to input.disabledMcp for this process only');
  if (!selectedMcp || selectedMcp.url !== cfg.mcpUrl || selectedMcp.enabled !== true || selectedMcp.default_tools_approval_mode !== 'approve'
    || !sameSet(selectedMcp.enabled_tools, cfg.allowedToolNames)) throw new Error('Effective domain MCP endpoint or tool allowlist does not match');
  const providerUrl = effective.model_providers?.openai?.base_url;
  if (providerUrl) {
    const url = new URL(providerUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !['chatgpt.com', 'api.openai.com'].includes(url.hostname)) throw new Error('Native OpenAI provider is redirected to an unexpected endpoint');
  }
  let model, cursor;
  const cursors = new Set();
  do {
    const models = await rpc('model/list', { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) });
    model = models.data?.find(item => (item.model ?? item.id) === cfg.modelId);
    cursor = models.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error('Native model/list repeated its pagination cursor');
    if (cursor) cursors.add(cursor);
  } while (!model && cursor);
  if (!model?.supportedReasoningEfforts?.some(item => item.reasoningEffort === cfg.effort)) throw new Error('The exact native model and effort are not advertised for the current account');
  if (interrupted) throw interrupted;
  if (hash(fs.readFileSync(cfg.fixture.file)) !== fixtureHash) throw new Error('Fixture changed during preflight');
  report = { ...report, status: 'ready-no-model', accountType: account.type, provider: 'openai', requestedModel: cfg.modelId, effort: cfg.effort,
    advertisedModel: { id: model.id, model: model.model, supportedReasoningEfforts: model.supportedReasoningEfforts },
    selectedMcp: { enabled: selectedMcp.enabled, url: selectedMcp.url, enabled_tools: selectedMcp.enabled_tools, default_tools_approval_mode: selectedMcp.default_tools_approval_mode },
    disabledMcp: disabledServers, mcpToolListChanged: true, sandbox: 'read-only', nativeUserAgent: initialized.userAgent };
  updatedSettings = { ...cfg, command: process.execPath, args: [adapter], mcpTransport: 'native-session-config', sessionMcpServers: [],
    env: { CODEX_PATH: native, CODEX_CONFIG: configJson, MODEL_PROVIDER: 'openai' },
    unsetEnv: unsetEnv.filter(name => !['MODEL_PROVIDER', 'CODEX_CONFIG'].includes(name)), preflightEvidence: evidence, configSha256,
    fixture: { ...cfg.fixture, initialHash: fixtureHash } };
} catch (error) { report.status = 'failed-no-model'; report.error = clean(error); process.exitCode = 1; }
finally {
  try { report.cleanup = await cleanup(); } catch (error) { report.status = 'failed-no-model'; report.cleanupError = clean(error); process.exitCode = 1; }
  process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  report.elapsedMs = Date.now() - started;
  if (updatedSettings && report.status === 'ready-no-model' && hash(fs.readFileSync(settingsPath)) !== hash(originalSettings)) {
    report.status = 'failed-no-model'; report.error = 'Input settings changed during preflight; updates were not applied'; process.exitCode = 1;
  }
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2));
  if (updatedSettings && report.status === 'ready-no-model') fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2));
  process.stdout.write(JSON.stringify({ status: report.status, settings: settingsPath, preflightEvidence: evidence,
    accountType: report.accountType, model: report.requestedModel, modelCalls: 0, error: report.error ?? report.cleanupError }) + '\n');
}
