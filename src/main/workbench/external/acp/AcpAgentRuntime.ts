import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AcpAgentId } from '../../../../shared/workbench/acp';
import { acpAgentDefinitions, acpLaunchInvocation, discoverAcpAgents, findAcpCommand } from './AcpAgentDiscovery';

type ExternalAgentId = Exclude<AcpAgentId, 'builtin'>;
const installations = new Map<string, Promise<void>>();

/** Only the requested official runtime is installed; native accounts and credentials stay in place. */
export class AcpAgentRuntime {
  constructor(private readonly options: { directory: string; cwd: string; env?: NodeJS.ProcessEnv }) {}

  install(agentId: ExternalAgentId): Promise<void> {
    const directory = path.join(this.options.directory, agentId);
    const pending = installations.get(directory);
    if (pending) return pending;
    const installation = this.installPackage(agentId, directory);
    installations.set(directory, installation);
    void installation.finally(() => { if (installations.get(directory) === installation) installations.delete(directory); }).catch(() => undefined);
    return installation;
  }

  private async installPackage(agentId: ExternalAgentId, directory: string): Promise<void> {
    const definition = acpAgentDefinitions.find(agent => agent.id === agentId);
    if (!definition) throw new Error('未知 Agent');
    const env = this.options.env ?? process.env;
    const discovery = await discoverAcpAgents({ cwd: this.options.cwd, runtimeDirectory: this.options.directory, env });
    if (discovery.launches.some(launch => launch.id === agentId)) return;
    const [node, npm] = await Promise.all([
      findAcpCommand('node', { cwd: this.options.cwd, env }), findAcpCommand('npm', { cwd: this.options.cwd, env }),
    ]);
    if (!node || !npm) throw new Error('安装 Agent 需要本机已有 Node.js 22 或更新版本及 npm；当前未找到可用入口，请安装 Node.js 后重试');
    await mkdir(directory, { recursive: true });
    const invocation = acpLaunchInvocation({ id: agentId, command: npm, args: ['install', '--prefix', directory,
      '--save-exact', '--omit=dev', '--engine-strict', '--no-audit', '--no-fund', `${definition.package}@${definition.version}`] });
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
    const childEnv = { ...env, [pathKey]: path.dirname(node) + path.delimiter + (env[pathKey] ?? '') };
    await new Promise<void>((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, { cwd: directory, env: childEnv,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let detail = '';
      const remember = (data: Buffer) => { detail = (detail + data.toString()).slice(-6000); };
      child.stdout.on('data', remember); child.stderr.on('data', remember);
      child.once('error', error => reject(new Error(`${definition.name} 安装未能启动：${error.message}`)));
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`${definition.name} 安装失败（${code ?? '未知退出码'}）：${detail.trim() || 'npm 未返回错误说明'}`)));
    });
    const installed = await discoverAcpAgents({ cwd: this.options.cwd, runtimeDirectory: this.options.directory, env });
    if (!installed.launches.some(launch => launch.id === agentId)) throw new Error(`${definition.name} 安装结束，但未找到 ACP 入口，请重试安装`);
  }
}
