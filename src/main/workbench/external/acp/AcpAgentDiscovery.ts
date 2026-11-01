import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { AcpAgentChoice, AcpAgentId } from '../../../../shared/workbench/acp';

export interface AcpAgentLaunch {
  id: Exclude<AcpAgentId, 'builtin'>;
  command: string;
  args: string[];
}

export const acpAgentDefinitions = [
  { id: 'codex', name: 'Codex', native: 'codex', adapter: 'codex-acp', package: '@agentclientprotocol/codex-acp', version: '2.5.0', args: [], documentationUrl: 'https://github.com/agentclientprotocol/codex-acp', nativeLoginHint: 'codex login' },
  { id: 'claude', name: 'Claude Code', native: 'claude', adapter: 'claude-agent-acp', package: '@agentclientprotocol/claude-agent-acp', version: '0.99.1', args: [], documentationUrl: 'https://github.com/agentclientprotocol/claude-agent-acp', nativeLoginHint: 'claude auth login' },
  { id: 'opencode', name: 'OpenCode', native: 'opencode', adapter: 'opencode', package: 'opencode-ai', version: '1.19.5', args: ['acp'], documentationUrl: 'https://opencode.ai/docs/acp/', nativeLoginHint: 'opencode auth login' },
] as const;

interface CommandDiscoveryOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (filePath: string) => Promise<boolean>;
  extraDirectories?: string[];
}

/** Resolve existing local commands without invoking a shell or Electron's executable as Node. */
export async function findAcpCommand(command: string, options: CommandDiscoveryOptions): Promise<string | undefined> {
  const env = options.env ?? process.env, platform = options.platform ?? process.platform;
  const filePath = platform === 'win32' ? path.win32 : path.posix;
  const exists = options.exists ?? (async candidate => {
    try { await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return (await stat(candidate)).isFile(); } catch { return false; }
  });
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const roots = [...pathValue.split(platform === 'win32' ? ';' : ':'), filePath.join(options.cwd, 'node_modules', '.bin'), ...options.extraDirectories ?? []]
    .map(value => value.replace(/^"|"$/g, '')).filter(value => filePath.isAbsolute(value));
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const root of roots) for (const extension of extensions) {
    const candidate = filePath.join(root, command + extension.toLowerCase());
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

/** Read-only discovery: never executes, installs, authenticates, or invokes a model. */
export async function discoverAcpAgents(options: CommandDiscoveryOptions & {
  runtimeDirectory?: string;
}): Promise<{ agents: AcpAgentChoice[]; launches: AcpAgentLaunch[] }> {
  const filePath = (options.platform ?? process.platform) === 'win32' ? path.win32 : path.posix;
  const agents: AcpAgentChoice[] = [], launches: AcpAgentLaunch[] = [];
  for (const definition of acpAgentDefinitions) {
    const [native, adapter] = await Promise.all([findAcpCommand(definition.native, options), findAcpCommand(definition.adapter, {
      ...options, extraDirectories: options.runtimeDirectory ? [filePath.join(options.runtimeDirectory, definition.id, 'node_modules', '.bin')] : [],
    })]);
    agents.push({ id: definition.id, name: definition.name, nativeInstalled: !!native, adapterInstalled: !!adapter,
      readiness: adapter ? 'unverified' : native ? 'adapter_missing' : 'missing',
      detail: adapter ? '已发现 ACP 入口，连接后确认认证和能力'
        : `${native ? `已安装 ${definition.name} CLI，` : ''}尚未发现 ${definition.id === 'opencode' ? 'OpenCode' : `ACP 适配器 ${definition.adapter}`}（${definition.package}），点击安装后自动连接`,
      documentationUrl: definition.documentationUrl, nativeLoginHint: definition.nativeLoginHint });
    if (adapter) launches.push({ id: definition.id, command: adapter, args: [...definition.args] });
  }
  return { agents, launches };
}

/** npm's Windows .cmd shims need cmd.exe. Only discovered fixed commands/arguments may enter it. */
export function acpLaunchInvocation(launch: AcpAgentLaunch, platform: NodeJS.Platform = process.platform): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(launch.command)) return { command: launch.command, args: [...launch.args] };
  const tokens = [launch.command, ...launch.args];
  if (tokens.some(token => /["%!?&|<>^\r\n]/.test(token))) throw new Error('ACP 入口路径含不支持的命令字符，请使用不含这些字符的安装路径');
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', `"${tokens.map(token => `"${token}"`).join(' ')}"`], windowsVerbatimArguments: true };
}
