import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AcpAgentHost } from '../../src/main/workbench/external/acp/AcpAgentHost';
import { createStdioAcpTransport, type AcpTransport } from '../../src/main/workbench/external/acp/AcpAgentSession';
import { acpLaunchInvocation, type AcpAgentLaunch } from '../../src/main/workbench/external/acp/AcpAgentDiscovery';
import { emptyAcpHandoff } from '../../src/main/workbench/external/acp/AcpHandoff';
import type { AcpAgentId, AcpSessionSegment } from '../../src/shared/workbench/acp';

/**
 * Isolated, no-model native ACP protocol probe. Never imports or opens the user's document.
 * Example (root chooses an already-installed exact adapter after read-only discovery):
 *   npx tsx scripts/experiments/acp-native-protocol-probe-20261101.ts --agent codex --command C:\\installed\\codex-acp.cmd --output output/acp-probe-unique
 * OpenCode uses its existing `acp` subcommand by default. Repeat --arg to supply an exact existing entry's args.
 * This script never installs, authenticates, changes global CLI settings, copies credentials, or sends session/prompt.
 * It reuses the native process's existing authentication environment; an auth failure is recorded, not bypassed.
 */

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const externalIds = ['codex', 'claude', 'opencode'] as const;
type ExternalAgentId = Exclude<AcpAgentId, 'builtin'>;

function argumentsOf(values: string[]) {
  let agentId: ExternalAgentId | undefined, command: string | undefined, output: string | undefined;
  const args: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const flag = values[index], value = values[++index];
    if (!value || !['--agent', '--command', '--output', '--arg'].includes(flag)) throw new Error('Use --agent, --command, optional --output and repeatable --arg only');
    if (flag === '--agent') {
      if (!(externalIds as readonly string[]).includes(value)) throw new Error('Choose an already-installed codex, claude or opencode adapter');
      agentId = value as ExternalAgentId;
    } else if (flag === '--command') command = value;
    else if (flag === '--output') output = value;
    else args.push(value);
  }
  if (!agentId || !command || !path.isAbsolute(command)) throw new Error('An explicit --agent and absolute existing --command are required');
  return { agentId, command, output: output && path.resolve(output), args: args.length ? args : agentId === 'opencode' ? ['acp'] : [] };
}

async function main() {
  const selected = argumentsOf(process.argv.slice(2));
  if (!(await stat(selected.command)).isFile()) throw new Error('The selected adapter is not an existing executable file');
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'guoling-acp-protocol-'));
  const output = selected.output ?? path.join(cwd, 'evidence');
  await mkdir(output, { recursive: true });
  const runId = randomUUID(), reportPath = path.join(output, `protocol-${runId}.json`), indexPath = path.join(output, `segments-${runId}.json`);
  await writeFile(indexPath, '[]\n', { flag: 'wx' });
  const launch: AcpAgentLaunch = { id: selected.agentId, command: selected.command, args: selected.args };
  const protocol: Array<JsonObject> = [], lifecycle: string[] = [], stages: Array<JsonObject> = [];
  const report: JsonObject = { version: 1, kind: 'acp-native-no-model-protocol-probe', startedAt: new Date().toISOString(),
    agentId: selected.agentId, command: selected.command, args: selected.args, cwd, reportPath, indexPath,
    protocol, lifecycle, stages, promptRequestsSent: 0, promptRequestsBlocked: 0,
    isolation: { nativeWorkingDirectory: 'new-temporary-directory', globalConfigurationChangedByHarness: false, credentialsCopied: false,
      nativeAuthentication: 'existing-native-environment', osSandboxClaimed: false, domainMcpServers: 0 },
    notExercised: ['model inference', 'formal document or file tools', 'MCP HTTP/stdio domain connection', 'active-turn cancellation',
      'pending domain commit settlement', 'late native disk writes', 'Electron UI or its durable event-store integration'] };
  let host: AcpAgentHost | undefined, stage = 'create-host';
  const readSegments = async () => JSON.parse(await readFile(indexPath, 'utf8')) as AcpSessionSegment[];
  const recordSegment = async (segment: AcpSessionSegment) => {
    const values = await readSegments(), index = values.findIndex(value => value.id === segment.id);
    if (index < 0) values.push(segment); else values[index] = segment;
    await writeFile(indexPath, JSON.stringify(values, null, 2) + '\n');
  };
  const createHost = () => new AcpAgentHost({ cwd, readSegments, onSegment: recordSegment,
    beforeSwitch: async () => { lifecycle.push('builtin-owner-idle'); },
    discover: async () => ({ launches: [launch], agents: [{ id: selected.agentId, name: selected.agentId,
      nativeInstalled: false, adapterInstalled: true, readiness: 'unverified', documentationUrl: '', nativeLoginHint: '',
      detail: 'Explicit existing adapter selected by the probe operator; native installation is not inferred from its path' }] }),
    createBinding: async () => ({ cwd, mcpServers: [], handoff: emptyAcpHandoff(),
      activate: async () => { throw new Error('This protocol-only probe must not activate a domain task'); },
      revoke: async reason => { lifecycle.push(`revoke:${reason}`); }, settle: async () => { lifecycle.push('settle'); },
      dispose: async () => { lifecycle.push('dispose-binding'); } }),
    sessionOptions: { requestTimeoutMs: 20000, authenticationTimeoutMs: 20000, cancellationTimeoutMs: 3000 },
    createTransport: (entry, workingDirectory) => {
      const entryLog: JsonObject = { cwd: workingDirectory, methodsSent: {}, methodsReceived: {}, framesReceived: 0, responses: [], stderrBytes: 0, closeRequested: false };
      protocol.push(entryLog);
      const methodsSent = entryLog.methodsSent as Record<string, number>, methodsReceived = entryLog.methodsReceived as Record<string, number>;
      const methods = new Map<string | number, string>();
      const transport = createStdioAcpTransport({ ...acpLaunchInvocation(entry), cwd: workingDirectory,
        onStderr: text => { entryLog.stderrBytes = Number(entryLog.stderrBytes) + Buffer.byteLength(text); } });
      transport.onMessage(message => {
        // Protocol metadata only: a response with an unmatched ID must not look like silent stdout.
        entryLog.framesReceived = Number(entryLog.framesReceived) + 1;
        const responses = entryLog.responses as JsonObject[];
        if (!message.method && responses.length < 12) responses.push({
          idType: typeof message.id, matchedMethod: message.id === undefined ? null : methods.get(message.id) ?? null,
          hasResult: 'result' in message, hasError: 'error' in message,
          errorCode: typeof object(message.error).code === 'number' ? object(message.error).code : undefined,
        });
        if (message.method) methodsReceived[message.method] = (methodsReceived[message.method] ?? 0) + 1;
        if (message.id === undefined || methods.get(message.id) !== 'initialize' || !message.result) return;
        const result = object(message.result), capabilities = object(result.agentCapabilities), sessions = object(capabilities.sessionCapabilities), info = object(result.agentInfo);
        entryLog.initialize = { protocolVersion: result.protocolVersion, agentInfo: { name: string(info.name), version: string(info.version), title: string(info.title) },
          mcpCapabilities: { http: object(capabilities.mcpCapabilities).http === true, sse: object(capabilities.mcpCapabilities).sse === true },
          recovery: { load: capabilities.loadSession === true, resume: !!sessions.resume && typeof sessions.resume === 'object' },
          authMethods: (Array.isArray(result.authMethods) ? result.authMethods : []).map(value => ({ id: string(object(value).id), name: string(object(value).name), type: string(object(value).type) })) };
      });
      const guarded: AcpTransport = {
        send(message) {
          if (message.method === 'session/prompt') { report.promptRequestsBlocked = Number(report.promptRequestsBlocked) + 1; throw new Error('Model prompts are not authorized in this protocol-only probe'); }
          if (message.method) methodsSent[message.method] = (methodsSent[message.method] ?? 0) + 1;
          if (message.id !== undefined && message.method) methods.set(message.id, message.method);
          transport.send(message);
        },
        onMessage: listener => transport.onMessage(listener), onClose: listener => transport.onClose(listener),
        close: async () => { entryLog.closeRequested = true; await transport.close(); entryLog.closed = true; },
      };
      return guarded;
    },
  });
  try {
    host = createHost();
    stage = 'connect-existing-adapter';
    await host.selectAgent(selected.agentId);
    const first = host.snapshot;
    stages.push({ stage, status: 'passed', nativeSessionId: first.segment?.nativeSessionId, configuration: first.configuration });

    stage = 'confirm-existing-model-and-effort-values';
    const supported = first.configuration.filter(option => option.type === 'select' && option.options.some(value => value.value === option.currentValue)
      && (option.category === 'model' || option.id === 'model' || option.category === 'thought_level' || /reasoning.*effort|^thought_level$/.test(option.id)))
      .sort((left, right) => Number(right.category === 'model' || right.id === 'model') - Number(left.category === 'model' || left.id === 'model'));
    const choices = Object.fromEntries(supported.map(option => [option.id, option.currentValue]));
    if (supported.length) await host.configure(choices);
    stages.push({ stage, status: supported.length ? 'passed' : 'not-advertised', exactSameValues: choices,
      confirmedChoices: host.snapshot.segment?.configurationChoices });

    stage = 'switch-to-builtin-and-close-native-process';
    await host.selectAgent('builtin'); await host.dispose();
    stages.push({ stage, status: 'passed', selectedAgentId: host.snapshot.selectedAgentId });

    stage = 'new-host-native-recovery';
    host = createHost();
    const initialDefault = host.snapshot.selectedAgentId;
    await host.selectAgent(selected.agentId);
    const recovered = host.snapshot, methods = protocol.at(-1)?.methodsSent as Record<string, number>;
    const recoveryMethod = methods['session/resume'] ? 'session/resume' : methods['session/load'] ? 'session/load' : undefined;
    stages.push({ stage, status: recoveryMethod ? 'passed' : 'unsupported-new-native-segment', initialDefault, recoveryMethod,
      originalNativeSessionId: first.segment?.nativeSessionId, nativeSessionId: recovered.segment?.nativeSessionId,
      sameNativeSession: recovered.segment?.nativeSessionId === first.segment?.nativeSessionId, configuration: recovered.configuration,
      confirmedChoices: recovered.segment?.configurationChoices });
    if (recoveryMethod && recovered.segment?.nativeSessionId !== first.segment?.nativeSessionId) throw new Error('Native recovery changed the session identity');

    stage = 'idle-cancel-and-process-cleanup';
    await host.cancel();
    stages.push({ stage, status: 'passed', activeTurnCancellationExercised: false });
    report.outcome = 'protocol-probe-completed';
  } catch (error) {
    const value = object(error);
    report.outcome = 'failed';
    // Raw native errors/stderr can contain login URLs or authentication output. Keep codes and the failed stage only.
    report.failure = { stage, name: error instanceof Error ? error.name : 'unknown', code: string(value.code), rpcCode: object(value.rpcError).code,
      note: 'Native authentication and raw stderr were not copied into this evidence. No model prompt was sent.' };
    process.exitCode = 1;
  } finally {
    try { await host?.dispose(); }
    catch { report.cleanupFailure = { stage: 'owned-process-cleanup' }; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); report.segments = await readSegments();
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ outcome: report.outcome, reportPath, cwd, promptsSent: report.promptRequestsSent, promptsBlocked: report.promptRequestsBlocked }));
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : 'ACP protocol probe setup failed'); process.exitCode = 1; });
