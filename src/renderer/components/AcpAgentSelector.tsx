import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, Check, ChevronDown, Download, LoaderCircle } from 'lucide-react';
import type { AcpAgentId, AcpConfigurationControl, AcpHostSnapshot } from '../../shared/workbench/acp';
import './AcpAgentSelector.css';

export interface AcpAgentSelectorProps {
  snapshot: AcpHostSnapshot;
  onSelect(agentId: AcpAgentId): Promise<unknown>;
  onInstall(agentId: Exclude<AcpAgentId, 'builtin'>): Promise<unknown>;
  onAuthenticate?(methodId: string): Promise<unknown>;
}

const readinessLabel: Record<AcpHostSnapshot['agents'][number]['readiness'] | 'installing', string> = {
  missing: '未安装', adapter_missing: '待安装', unverified: '已安装', installing: '正在安装', connecting: '正在连接',
  authentication_required: '需要登录', ready: '就绪', error: '连接未就绪',
};

/** Menus live outside the clipped workspace and keep their own viewport scroll area. */
function useAcpMenu(placement: 'above' | 'below', preferredWidth: number, align: 'start' | 'end' = 'end') {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ left: 8, top: 8, width: preferredWidth, maxHeight: 320 });
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) anchor.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(preferredWidth, Math.max(0, window.innerWidth - 16));
      const availableAbove = Math.max(0, rect.top - 14), availableBelow = Math.max(0, window.innerHeight - rect.bottom - 14);
      const above = placement === 'above' ? availableAbove >= 160 || availableAbove > availableBelow : availableBelow < 160 && availableAbove > availableBelow;
      setPosition({ left: Math.max(8, Math.min(align === 'start' ? rect.left : rect.right - width, window.innerWidth - width - 8)),
        ...(above ? { bottom: Math.max(8, window.innerHeight - rect.top + 6) } : { top: Math.min(rect.bottom + 6, window.innerHeight - 8) }),
        width, maxHeight: Math.min(360, above ? availableAbove : availableBelow) });
    };
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !menu.current?.contains(target)) close();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      if (!menu.current?.contains(document.activeElement) && document.activeElement !== anchor.current) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % buttons.length : current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    update();
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', keys);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', keys);
      window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true);
    };
  }, [open, placement, preferredWidth, align]);
  return { open, setOpen, position, anchor, menu, id, close };
}

/** The header opens a compact list; installation and connection remain owned by the host. */
export function AcpAgentSelector({ snapshot, onSelect, onInstall, onAuthenticate }: AcpAgentSelectorProps) {
  const popup = useAcpMenu('above', 264, 'start');
  const [busyAgentId, setBusyAgentId] = useState<AcpAgentId | null>(null);
  const inFlight = useRef(false);
  const [localError, setLocalError] = useState<string>();
  const selected = snapshot.agents.find(agent => agent.id === snapshot.selectedAgentId);
  const agentName = snapshot.selectedAgentId === 'builtin' ? '果铃AI'
    : selected?.name ?? ({ codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' }[snapshot.selectedAgentId]);
  const changing = busyAgentId !== null || ['switching', 'authenticating', 'installing'].includes(snapshot.phase);
  const invoke = async (agentId: AcpAgentId, action: () => Promise<unknown>) => {
    if (inFlight.current || changing) return;
    inFlight.current = true;
    setBusyAgentId(agentId); setLocalError(undefined);
    try { await action(); popup.close(true); }
    catch (error) { setLocalError(error instanceof Error ? error.message : String(error)); }
    finally { inFlight.current = false; setBusyAgentId(null); }
  };
  return <div className="acp-agent-selector">
    <button ref={popup.anchor} type="button" className="acp-agent-selector__trigger"
      aria-label="选择 Agent" title={`当前：${agentName}；点击切换 Agent`} aria-haspopup="menu"
      aria-expanded={popup.open} aria-controls={popup.open ? popup.id : undefined} onClick={() => popup.setOpen(value => !value)}>
      <span>{agentName}</span><ArrowLeftRight size={14} aria-hidden="true" />
    </button>
    {popup.open && createPortal(<div ref={popup.menu} id={popup.id} className="acp-menu acp-agent-menu" role="menu" aria-label="Agent 列表" style={popup.position}>
      <div className="acp-menu__heading">Agent</div>
      <button type="button" role="menuitemradio" aria-checked={snapshot.selectedAgentId === 'builtin'} className="acp-agent-menu__choice" disabled={changing}
        onClick={() => { void invoke('builtin', () => onSelect('builtin')); }}>
        <span><strong>果铃内置</strong><small>{snapshot.selectedAgentId === 'builtin' ? '当前使用' : '可使用'}</small></span>
        {snapshot.selectedAgentId === 'builtin' && <Check size={15} aria-hidden="true" />}
      </button>
      {snapshot.agents.map(agent => {
        const active = snapshot.selectedAgentId === agent.id;
        const needsInstall = !agent.adapterInstalled;
        const installing = String(agent.readiness) === 'installing' || busyAgentId === agent.id && needsInstall;
        const status = installing ? '正在安装' : active && snapshot.phase === 'prompting' ? '处理中' : readinessLabel[agent.readiness];
        const authenticating = active && (agent.readiness === 'authentication_required' || snapshot.phase === 'authenticating');
        return <div key={agent.id} className="acp-agent-menu__entry">
          {needsInstall ? <div className="acp-agent-menu__install-row">
            <span><strong>{agent.name}</strong><small>{status}</small></span>
            <button type="button" role="menuitem" aria-label={`安装 ${agent.name}`} className="acp-agent-menu__install" disabled={changing}
              onClick={() => { void invoke(agent.id, () => onInstall(agent.id)); }}>
              {installing ? <LoaderCircle size={13} className="acp-menu__spinner" /> : <Download size={13} />} {installing ? '安装中' : '安装'}
            </button>
          </div> : <button type="button" role="menuitemradio" aria-checked={active} className="acp-agent-menu__choice" disabled={changing}
            onClick={() => { void invoke(agent.id, () => onSelect(agent.id)); }}>
            <span><strong>{agent.name}</strong><small>{active ? `当前使用 · ${status}` : status}</small></span>
            {busyAgentId === agent.id || active && ['connecting', 'installing'].includes(agent.readiness) ? <LoaderCircle size={15} className="acp-menu__spinner" /> : active && <Check size={15} aria-hidden="true" />}
          </button>}
          {authenticating && onAuthenticate && snapshot.authenticationMethods.map(method => <button type="button" role="menuitem" key={method.id}
            className="acp-agent-menu__login" disabled={changing} title={method.description}
            onClick={() => { void invoke(agent.id, () => onAuthenticate(method.id)); }}>{method.name}</button>)}
        </div>;
      })}
      {(localError || snapshot.error) && <p role="alert" className="acp-menu__error">{localError || snapshot.error}</p>}
    </div>, document.body)}
  </div>;
}

export type AcpConfigurationKind = 'model' | 'effort' | 'mode';

/** Match native identities only; labels never manufacture a model, effort, or permission choice. */
export function findAcpConfigurationControl(snapshot: AcpHostSnapshot, kind: AcpConfigurationKind): AcpConfigurationControl | undefined {
  return snapshot.configuration.find(option => kind === 'model' ? option.category === 'model' || /^(model|model_id)$/.test(option.id)
    : kind === 'effort' ? option.category === 'thought_level' || option.category === 'reasoning_effort' || /^(effort|thought_level|reasoning_effort)$/.test(option.id)
      : option.category === 'mode' || /^(mode|session_mode)$/.test(option.id));
}

export interface AcpConfigurationPickerProps {
  snapshot: AcpHostSnapshot;
  kind: 'model' | 'effort';
  onConfigure(values: Record<string, string | boolean>): Promise<unknown>;
}

/** Each composer control has its own native option list. */
export function AcpConfigurationPicker({ snapshot, kind, onConfigure }: AcpConfigurationPickerProps) {
  const popup = useAcpMenu('above', kind === 'model' ? 264 : 208);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  const option = findAcpConfigurationControl(snapshot, kind);
  if (!option || snapshot.selectedAgentId === 'builtin') return null;
  const label = kind === 'model' ? '模型' : '思考强度';
  const choices: Array<{ value: string | boolean; name: string; description?: string; group?: string }> = option.type === 'select'
    ? option.options : [{ value: true, name: '开启' }, { value: false, name: '关闭' }];
  const current = choices.find(choice => choice.value === option.currentValue)?.name ?? String(option.currentValue);
  const choose = async (value: string | boolean) => {
    if (inFlight.current || snapshot.phase !== 'ready') return;
    inFlight.current = true;
    setBusy(true); setError(undefined);
    try { await onConfigure({ [option.id]: value }); popup.close(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className={`acp-configuration-picker acp-configuration-picker--${kind}`}>
    <button ref={popup.anchor} type="button" className="acp-configuration-picker__trigger" aria-label={`切换${label}`} title={`${option.name}：${current}`}
      aria-haspopup="menu" aria-expanded={popup.open} aria-controls={popup.open ? popup.id : undefined} disabled={busy || snapshot.phase !== 'ready'}
      onClick={() => popup.setOpen(value => !value)}><span>{current}</span><ChevronDown size={12} aria-hidden="true" /></button>
    {popup.open && createPortal(<div ref={popup.menu} id={popup.id} role="menu" aria-label={label} className="acp-menu acp-configuration-menu" style={popup.position}>
      <div className="acp-menu__heading">{option.name}</div>
      {choices.map(choice => <button key={String(choice.value)} type="button" role="menuitemradio" aria-checked={choice.value === option.currentValue}
        disabled={busy || snapshot.phase !== 'ready'} title={choice.description} onClick={() => { void choose(choice.value); }}>
        <span>{choice.group ? <small>{choice.group} / </small> : null}{choice.name}</span>
        {choice.value === option.currentValue && <Check size={14} aria-hidden="true" />}
      </button>)}
      {error && <p role="alert" className="acp-menu__error">{error}</p>}
    </div>, document.body)}
  </div>;
}

export interface AcpPermissionRequestsProps {
  snapshot: AcpHostSnapshot;
  onPermission(id: string, optionId: string): Promise<unknown>;
}

/** Pending native decisions stay visible without opening the header's Agent list. */
export function AcpPermissionRequests({ snapshot, onPermission }: AcpPermissionRequestsProps) {
  const [busyId, setBusyId] = useState<string>();
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  if (!snapshot.pendingPermissions.length) return null;
  const decide = async (id: string, optionId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(id); setError(undefined);
    try { await onPermission(id, optionId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setBusyId(undefined); }
  };
  return <div className="acp-permission-requests" aria-label="Agent 权限请求">
    {snapshot.pendingPermissions.map(permission => <section key={permission.id} className="acp-permission-request" role="group" aria-label={permission.title}>
      <strong>{permission.title}</strong>
      <div>{permission.options.map(option => <button key={option.optionId} type="button" className="secondary-button" disabled={Boolean(busyId)}
        onClick={() => { void decide(permission.id, option.optionId); }}>{option.name}</button>)}</div>
    </section>)}
    {error && <p role="alert" className="acp-menu__error">{error}</p>}
  </div>;
}
