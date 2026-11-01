import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { act, fireEvent, render, cleanup, within } from '@testing-library/react';
import { AcpAgentSelector, AcpConfigurationPicker, AcpPermissionRequests, findAcpConfigurationControl } from '../../src/renderer/components/AcpAgentSelector';
import type { AcpHostSnapshot } from '../../src/shared/workbench/acp';

function snapshot(): AcpHostSnapshot {
  return { selectedAgentId: 'builtin', phase: 'idle', agents: [
    { id: 'codex', name: 'Codex', nativeInstalled: true, adapterInstalled: true, readiness: 'unverified', documentationUrl: 'https://github.com/agentclientprotocol/codex-acp', nativeLoginHint: 'codex login' },
    { id: 'claude', name: 'Claude Code', nativeInstalled: true, adapterInstalled: false, readiness: 'adapter_missing', documentationUrl: 'https://github.com/agentclientprotocol/claude-agent-acp', nativeLoginHint: 'claude auth login' },
    { id: 'opencode', name: 'OpenCode', nativeInstalled: false, adapterInstalled: false, readiness: 'missing', documentationUrl: 'https://opencode.ai/docs/acp/', nativeLoginHint: 'opencode auth login' },
  ], configuration: [], authenticationMethods: [], pendingPermissions: [], segments: [], nativeDiskAccess: false };
}
const noOp = async () => undefined;

function nativeSnapshot(): AcpHostSnapshot {
  const value = snapshot(); value.selectedAgentId = 'codex'; value.phase = 'ready'; value.agents[0].readiness = 'ready';
  value.configuration = [
    { id: 'native-model', category: 'model', name: 'Model', type: 'select', currentValue: 'exact-model', options: [{ value: 'exact-model', name: 'Exact model' }, { value: 'next-model', name: 'Next model' }] },
    { id: 'native-effort', category: 'thought_level', name: 'Reasoning effort', type: 'select', currentValue: 'deep', options: [{ value: 'deep', name: 'Deep' }, { value: 'quick', name: 'Quick' }] },
    { id: 'native-role', category: 'mode', name: 'Agent role', type: 'select', currentValue: 'orchestrator', options: [{ value: 'orchestrator', name: 'Orchestrator' }] },
  ];
  return value;
}

describe('ACP Agent selector', () => {
  it('uses the current Agent name as the switching title', () => {
    const state = snapshot();
    const view = render(<AcpAgentSelector snapshot={state} onSelect={noOp} onInstall={noOp} />);
    try {
      const trigger = view.getByRole('button', { name: '选择 Agent' });
      assert.equal(trigger.textContent, '果铃AI');
      for (const [agentId, name] of [['codex', 'Codex'], ['claude', 'Claude Code'], ['opencode', 'OpenCode'], ['builtin', '果铃AI']] as const) {
        view.rerender(<AcpAgentSelector snapshot={{ ...state, selectedAgentId: agentId }} onSelect={noOp} onInstall={noOp} />);
        assert.equal(trigger.textContent, name);
        assert.equal(trigger.getAttribute('title'), `当前：${name}；点击切换 Agent`);
      }
    } finally { cleanup(); }
  });

  it('opens a compact portal list and routes installed choices and installation separately', async () => {
    const selected: string[] = [], installed: string[] = [];
    const view = render(<AcpAgentSelector snapshot={snapshot()} onSelect={async id => { selected.push(id); }} onInstall={async id => { installed.push(id); }} />);
    try {
      const trigger = view.getByRole('button', { name: '选择 Agent' });
      assert.equal(view.queryByRole('combobox'), null);
      assert.equal(view.queryByRole('menu'), null);
      fireEvent.click(trigger);
      const menu = view.getByRole('menu', { name: 'Agent 列表' });
      assert.equal(view.container.contains(menu), false);
      assert.equal(within(menu).getByRole('menuitemradio', { name: /果铃内置/ }).getAttribute('aria-checked'), 'true');
      assert.ok(within(menu).getByText('Codex'));
      assert.ok(within(menu).getByText('待安装'));
      assert.ok(within(menu).getByRole('menuitem', { name: '安装 OpenCode' }));
      assert.equal(within(menu).queryByText('重新检测安装'), null);
      assert.equal(within(menu).queryByText('新建原生会话'), null);
      await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: '安装 Claude Code' })); });
      assert.deepEqual(installed, ['claude']); assert.deepEqual(selected, []);
      assert.equal(view.queryByRole('menu'), null);
      fireEvent.click(trigger);
      await act(async () => { fireEvent.click(view.getByRole('menuitemradio', { name: /Codex/ })); });
      assert.deepEqual(selected, ['codex']);
      assert.equal(view.queryByRole('menu'), null);
    } finally { cleanup(); }
  });

  it('connects a managed adapter even when its bundled native CLI is not on PATH', async () => {
    const state = snapshot(); state.agents[0].nativeInstalled = false;
    const selected: string[] = [];
    const view = render(<AcpAgentSelector snapshot={state} onSelect={async id => { selected.push(id); }} onInstall={noOp} />);
    try {
      fireEvent.click(view.getByRole('button', { name: '选择 Agent' }));
      assert.equal(view.queryByRole('menuitem', { name: '安装 Codex' }), null);
      await act(async () => { fireEvent.click(view.getByRole('menuitemradio', { name: /Codex/ })); });
      assert.deepEqual(selected, ['codex']);
    } finally { cleanup(); }
  });

  it('prevents duplicate installation and lets Escape and outside clicks close the menu', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    let installs = 0;
    const view = render(<AcpAgentSelector snapshot={snapshot()} onSelect={noOp} onInstall={async () => { installs++; await pending; }} />);
    try {
      const trigger = view.getByRole('button', { name: '选择 Agent' });
      fireEvent.click(trigger);
      const install = view.getByRole('menuitem', { name: '安装 Claude Code' });
      act(() => { fireEvent.click(install); fireEvent.click(install); });
      assert.equal(installs, 1);
      assert.equal((install as HTMLButtonElement).disabled, true);
      assert.ok(view.getByText('正在安装'));
      await act(async () => { finish(); await pending; });
      fireEvent.click(trigger);
      fireEvent.keyDown(document, { key: 'Escape' });
      assert.equal(view.queryByRole('menu'), null); assert.equal(document.activeElement, trigger);
      fireEvent.click(trigger);
      fireEvent.pointerDown(document.body);
      assert.equal(view.queryByRole('menu'), null);
    } finally { finish(); cleanup(); }
  });

  it('keeps Agent-advertised authentication on the selected installed Agent', async () => {
    const state = snapshot(); state.selectedAgentId = 'codex'; state.phase = 'error'; state.agents[0].readiness = 'authentication_required';
    state.authenticationMethods = [{ id: 'native-auth', name: '使用原生账号登录' }];
    const methods: string[] = [];
    const view = render(<AcpAgentSelector snapshot={state} onSelect={noOp} onInstall={noOp} onAuthenticate={async id => { methods.push(id); }} />);
    try {
      fireEvent.click(view.getByRole('button', { name: '选择 Agent' }));
      assert.ok(view.getByText('当前使用 · 需要登录'));
      assert.equal(view.getAllByRole('menuitem', { name: '使用原生账号登录' }).length, 1);
      await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: '使用原生账号登录' })); });
      assert.deepEqual(methods, ['native-auth']);
    } finally { cleanup(); }
  });

  it('keeps native model and effort in separate menus and sends their exact native IDs', async () => {
    const state = nativeSnapshot(), configured: Array<Record<string, string | boolean>> = [];
    const configure = async (values: Record<string, string | boolean>) => { configured.push(values); };
    const view = render(<><AcpConfigurationPicker snapshot={state} kind="model" onConfigure={configure} /><AcpConfigurationPicker snapshot={state} kind="effort" onConfigure={configure} /></>);
    try {
      fireEvent.click(view.getByRole('button', { name: '切换模型' }));
      const models = view.getByRole('menu', { name: '模型' });
      assert.ok(within(models).getByRole('menuitemradio', { name: 'Next model' }));
      assert.equal(within(models).queryByText('Deep'), null);
      assert.equal(within(models).queryByText('Orchestrator'), null);
      await act(async () => { fireEvent.click(within(models).getByRole('menuitemradio', { name: 'Next model' })); });
      fireEvent.click(view.getByRole('button', { name: '切换思考强度' }));
      const efforts = view.getByRole('menu', { name: '思考强度' });
      assert.equal(within(efforts).queryByText('Exact model'), null);
      await act(async () => { fireEvent.click(within(efforts).getByRole('menuitemradio', { name: 'Quick' })); });
      assert.deepEqual(configured, [{ 'native-model': 'next-model' }, { 'native-effort': 'quick' }]);
      assert.equal(findAcpConfigurationControl(state, 'mode')?.name, 'Agent role');
      view.rerender(<><AcpConfigurationPicker snapshot={{ ...state, configuration: [] }} kind="model" onConfigure={configure} /><AcpConfigurationPicker snapshot={{ ...state, configuration: [] }} kind="effort" onConfigure={configure} /></>);
      assert.equal(view.queryByRole('button'), null);
    } finally { cleanup(); }
  });

  it('shows native permission requests without opening an Agent menu and waits for a choice', async () => {
    const state = nativeSnapshot();
    state.pendingPermissions = [{ id: 'request-1', title: 'Write a local file', options: [{ optionId: 'allow-1', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny-1', name: 'Reject', kind: 'reject_once' }] }];
    const permissions: string[] = [];
    const view = render(<><AcpAgentSelector snapshot={state} onSelect={noOp} onInstall={noOp} /><AcpPermissionRequests snapshot={state}
      onPermission={async (id, choice) => { permissions.push(`${id}:${choice}`); }} /></>);
    try {
      assert.equal(view.queryByRole('menu'), null);
      assert.ok(view.getByRole('group', { name: 'Write a local file' }));
      assert.deepEqual(permissions, []);
      await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Reject' })); });
      assert.deepEqual(permissions, ['request-1:deny-1']);
      assert.equal(view.queryByRole('menu'), null);
    } finally { cleanup(); }
  });
});
