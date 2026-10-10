import { useEffect, useRef, useState } from 'react'
import { executionPermissionModes, permissionDescriptions, permissionLabels, type ExecutionPermissionMode } from '../../shared/workbench/executionPermission'
import { externalClientConfigs, type ExternalCloseAction, type ExternalMcpAPI, type ExternalMcpSettings, type ExternalMcpStatus } from '../../shared/workbench/external'
import './ExternalMcpPanel.css'

export interface ExternalMcpPanelProps {
  open: boolean
  onClose(): void
  api: ExternalMcpAPI
}
type Client = 'claude' | 'codex' | 'opencode' | 'gemini'
const states: Record<ExternalMcpStatus['state'], string> = { running: '运行中', disabled: '已关闭', 'port-in-use': '端口被占用', failed: '未能启动' }
const closeActions: Record<ExternalCloseAction, string> = { ask: '每次询问', tray: '隐藏到系统托盘', quit: '退出果铃' }
const clients: Record<Client, { label: string; hint: string }> = {
  claude: { label: 'Claude Code', hint: '在终端执行一次；果铃中的服务需已主动开启。' },
  codex: { label: 'Codex', hint: '合并到 Codex 的 config.toml（通常为 ~/.codex/config.toml）。无需令牌。' },
  opencode: { label: 'OpenCode', hint: '合并到 opencode.json。无需令牌。' },
  gemini: { label: 'Gemini CLI', hint: '合并到 Gemini CLI 的 settings.json（通常为 ~/.gemini/settings.json）。无需令牌。' },
}
const time = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false })
const copy = (text: string) => navigator.clipboard.writeText(text)

/** Status and configuration of the resident local MCP endpoint for external AI clients. */
export function ExternalMcpPanel({ open, onClose, api }: ExternalMcpPanelProps) {
  const panel = useRef<HTMLElement>(null)
  const [status, setStatus] = useState<ExternalMcpStatus | null>(null)
  const [port, setPort] = useState('')
  const [client, setClient] = useState<Client>('claude')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => {
    if (!open) return
    let live = true
    setError(''); setNotice('')
    const prior = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const refresh = (first = false) => { void api.status().then(value => {
      if (!live) return
      setStatus(value)
      if (first) setPort(String(value.settings.port))
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : '无法读取外部连接状态') }) }
    refresh(true)
    const interval = window.setInterval(refresh, 2000)
    return () => { live = false; window.clearInterval(interval); prior?.focus() }
  }, [open, api])
  if (!open) return null
  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true); setError(''); setNotice('')
    try { await action(); if (done) setNotice(done) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成') }
    finally { setBusy(false) }
  }
  const configure = (patch: Partial<ExternalMcpSettings>, done?: string) => run(async () => setStatus(await api.configure(patch)), done)
  const applyPort = () => {
    const value = Number(port)
    if (!Number.isInteger(value) || value < 1024 || value > 65535) { setError('端口需为 1024–65535 之间的整数'); return }
    void configure({ port: value }, `端口已改为 ${value}；已配置的客户端需同步改用新地址。`)
  }
  const configs = status ? externalClientConfigs(status.endpoint) : null
  const active = status?.sessions.filter(session => !session.stopped) ?? []
  return <div className="external-mcp-backdrop" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
  }}>
    <section className="external-mcp-panel" role="dialog" aria-modal="true" aria-label="外部 AI 连接" tabIndex={-1} ref={panel}>
      <header><h2>外部 AI 连接</h2><button type="button" onClick={onClose} aria-label="关闭外部连接设置">关闭</button></header>
      <p>Claude Code、Codex、OpenCode、Gemini CLI 等本机客户端可通过下面的固定地址连接正在运行的果铃，默认关闭；你主动开启后无需令牌，配置一次即可长期使用。果铃需由你启动；关闭窗口时可隐藏到系统托盘继续服务。</p>
      {!status ? <p role="status">正在读取状态…</p> : <>
        <div className="external-mcp-row" aria-label="服务状态">
          <span className={`external-mcp-state external-mcp-state--${status.state}`}>{states[status.state]}</span>
          <label className="external-mcp-inline"><input type="checkbox" checked={status.settings.enabled} disabled={busy}
            onChange={event => { void configure({ enabled: event.target.checked }) }} />启用外部连接服务</label>
        </div>
        {status.message && <p role="alert">{status.message}</p>}
        <label>地址<span className="external-mcp-copyable"><input readOnly value={status.endpoint} aria-label="连接地址" />
          <button type="button" onClick={() => { void copy(status.endpoint).then(() => setNotice('已复制地址')) }}>复制</button></span></label>
        <label>端口<span className="external-mcp-copyable"><input inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} aria-label="端口" disabled={busy} />
          <button type="button" onClick={applyPort} disabled={busy || port === String(status.settings.port)}>应用端口</button></span></label>
        <label>新连接默认权限<select aria-label="新连接默认权限" value={status.settings.permission} disabled={busy}
          onChange={event => { void configure({ permission: event.target.value as ExecutionPermissionMode }, '新连接使用此默认档位；当前连接可在下方直接调整。') }}>
          {executionPermissionModes.map(mode => <option key={mode} value={mode}>{permissionLabels[mode]}</option>)}
        </select><small>{permissionDescriptions[status.settings.permission]}。与内置 AI 共用权限规则，由果铃主进程执行；需要询问时果铃会弹出确认。</small></label>
        <label>点击窗口关闭按钮时<select aria-label="点击窗口关闭按钮时" value={status.settings.closeAction} disabled={busy}
          onChange={event => { void configure({ closeAction: event.target.value as ExternalCloseAction }) }}>
          {(Object.keys(closeActions) as ExternalCloseAction[]).map(action => <option key={action} value={action}>{closeActions[action]}</option>)}
        </select></label>
        <div className="external-mcp-field"><span>外部会话（{active.length} 个连接中）</span>
          {status.sessions.length ? <ul aria-label="外部会话">{status.sessions.map(session => <li key={session.sessionId}>
            <span>{session.clientName} · {session.workspaceName} · {permissionLabels[session.permission]} · {session.lastCallAt ? `最近调用 ${time(session.lastCallAt)}` : `连接于 ${time(session.connectedAt)}`}
              {session.pendingCalls > 0 && ` · 正在处理 ${session.pendingCalls} 个调用`}{session.stopped && ' · 已停止'}</span>
            {!session.stopped && <label>连接权限<select aria-label={`${session.clientName} 连接权限`} value={session.permission} disabled={busy}
              onChange={event => { const permission = event.target.value as ExecutionPermissionMode; void run(async () => setStatus(await api.configureSession(session.sessionId, permission)),
                `${session.clientName} 后续调用已使用${permissionLabels[permission]}；原调用按原授权收拢。`) }}>
              {executionPermissionModes.map(mode => <option key={mode} value={mode}>{permissionLabels[mode]}</option>)}
            </select></label>}
            {!session.stopped && <button type="button" disabled={busy} onClick={() => { void run(async () => setStatus(await api.stopSession(session.sessionId)),
              `已停止 ${session.clientName} 的会话；它的后续调用会被拒绝，客户端可重新连接。`) }}>停止</button>}
          </li>)}</ul> : <p>暂无外部会话。</p>}
        </div>
        {configs && <div className="external-mcp-config">
          <label>客户端<select aria-label="客户端" value={client} onChange={event => setClient(event.target.value as Client)}>
            {(Object.keys(clients) as Client[]).map(key => <option key={key} value={key}>{clients[key].label}</option>)}
          </select></label>
          <p>{clients[client].hint}</p>
          <textarea aria-label="客户端配置" readOnly rows={client === 'claude' ? 3 : 8} value={configs[client]} onFocus={event => event.target.select()} />
          <button type="button" onClick={() => { void copy(configs[client]).then(() => setNotice(`已复制 ${clients[client].label} 配置`)) }}>复制配置</button>
        </div>}
      </>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <p className="external-mcp-limits">只监听本机 127.0.0.1，拒绝网页来源的请求；果铃只显示实际收到的工具调用与提交，外部客户端自己的对话、用量和磁盘操作不由果铃管理。云端客户端无法连接此本机地址。</p>
    </section>
  </div>
}
