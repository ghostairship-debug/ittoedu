import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { acpLaunchInvocation, discoverAcpAgents } from '../../src/main/workbench/external/acp/AcpAgentDiscovery';

describe('ACP installation discovery', () => {
  it('distinguishes native installation, adapter installation and actual session readiness', async () => {
    const files = new Set(['/bin/codex', '/bin/opencode']);
    const result = await discoverAcpAgents({ cwd: '/work', env: { PATH: '/bin' }, platform: 'linux', exists: async file => files.has(file) });
    assert.equal(result.agents.find(agent => agent.id === 'codex')?.readiness, 'adapter_missing');
    assert.match(result.agents.find(agent => agent.id === 'codex')?.detail ?? '', /@agentclientprotocol\/codex-acp/);
    assert.equal(result.agents.find(agent => agent.id === 'opencode')?.readiness, 'unverified');
    assert.equal(result.agents.find(agent => agent.id === 'claude')?.readiness, 'missing');
    assert.match(result.agents.find(agent => agent.id === 'claude')?.detail ?? '', /@agentclientprotocol\/claude-agent-acp/);
    assert.deepEqual(result.launches, [{ id: 'opencode', command: '/bin/opencode', args: ['acp'] }]);
    assert.equal(result.agents.some(agent => agent.readiness === 'ready'), false);
  });

  it('discovers Windows npm shims without launching them or changing the user environment', async () => {
    const env = { Path: 'C:\\Users\\Me\\AppData\\Roaming\\npm', PATHEXT: '.EXE;.CMD' };
    const result = await discoverAcpAgents({ cwd: 'D:\\work', env, platform: 'win32', exists: async file => file === 'C:\\Users\\Me\\AppData\\Roaming\\npm\\codex-acp.cmd' });
    assert.equal(result.agents[0].adapterInstalled, true);
    assert.equal(result.agents[0].nativeInstalled, false);
    assert.equal(result.agents[0].readiness, 'unverified');
    assert.deepEqual(env, { Path: 'C:\\Users\\Me\\AppData\\Roaming\\npm', PATHEXT: '.EXE;.CMD' });
    const invocation = acpLaunchInvocation(result.launches[0], 'win32');
    assert.equal(invocation.command, 'cmd.exe');
    assert.equal(invocation.windowsVerbatimArguments, true);
    assert.match(invocation.args[3], /^""C:/);
  });

  it('does not accept shell syntax in a Windows adapter launch', () => {
    assert.throws(() => acpLaunchInvocation({ id: 'codex', command: 'C:\\bin\\bad&x.cmd', args: [] }, 'win32'), /命令字符/);
    assert.throws(() => acpLaunchInvocation({ id: 'codex', command: 'C:\\bin\\codex-acp.cmd', args: ['%SECRET%'] }, 'win32'), /命令字符/);
  });

  it('finds current-user runtimes outside the workspace while preferring existing PATH adapters', async () => {
    const runtime = '/users/me/app/acp/codex/node_modules/.bin/codex-acp';
    const files = new Set([runtime]);
    const options = { cwd: '/unrelated-workspace', runtimeDirectory: '/users/me/app/acp', env: { PATH: '/bin' },
      platform: 'linux' as const, exists: async (file: string) => files.has(file) };
    assert.equal((await discoverAcpAgents(options)).launches[0].command, runtime);
    files.add('/bin/codex-acp');
    assert.equal((await discoverAcpAgents(options)).launches[0].command, '/bin/codex-acp');
  });
});
