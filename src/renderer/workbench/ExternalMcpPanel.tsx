import { useEffect, useRef, useState } from 'react'
import type { ConversationRecord } from '../../shared/workbench/conversations'
import type { ExecutionDocumentReference } from '../../shared/workbench/executionDesktop'
import type { ExternalGrantResult, ExternalGrantView, ExternalMcpAPI } from '../../shared/workbench/external'
import './ExternalMcpPanel.css'

export interface ExternalMcpPanelProps {
  open: boolean
  onClose(): void
  api: ExternalMcpAPI
  workspaceId: string
  conversation: ConversationRecord
  documents: ExecutionDocumentReference[]
  instruction: string
  documentNames?: Record<string, string>
  onConversationChange(conversation: ConversationRecord): void
}
const statuses: Record<ExternalGrantView['status'], string> = { active: '已授权', expired: '已过期', revoked: '已撤销', closed: '已关闭' }
export function ExternalMcpPanel({ open, onClose, api, workspaceId, conversation, documents, instruction, documentNames, onConversationChange }: ExternalMcpPanelProps) {
  const generation = useRef(0), panel = useRef<HTMLElement>(null)
  const [grants, setGrants] = useState<ExternalGrantView[]>([])
  const [created, setCreated] = useState<ExternalGrantResult | null>(null)
  const [sourceRunId, setSourceRunId] = useState(''), [remaining, setRemaining] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [client, setClient] = useState<'codex' | 'claude' | 'opencode'>('codex')
  const [lifetime, setLifetime] = useState(30)
  const owner = { workspaceId, conversationId: conversation.conversationId }
  useEffect(() => {
    const ticket = ++generation.current
    setCreated(null); setGrants([]); setBusy(false); setError(''); setNotice(''); setRemaining('')
    setSourceRunId(conversation.runIndex.builtinRunIds.at(-1) ?? '')
    if (!open) return
    const prior = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const refresh = () => { void api.list({ workspaceId, conversationId: conversation.conversationId }).then(result => {
      if (generation.current === ticket) setGrants(result)
    }).catch(cause => { if (generation.current === ticket) setError(cause instanceof Error ? cause.message : '无法读取外部授权') }) }
    refresh()
    const interval = window.setInterval(refresh, 5000)
    return () => { ++generation.current; window.clearInterval(interval); prior?.focus() }
  }, [open, api, workspaceId, conversation.conversationId])
  if (!open) return null
  const selected = created && grants.find(grant => grant.connectionId === created.connection.connectionId)
  const available = created && selected?.status === 'active' && selected.expiresAt > Date.now()
  const create = async () => {
    const ticket = generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api.grant({ ...owner, expectedRevision: conversation.revision, instruction,
        documents, lifetimeMs: lifetime * 60_000, ...(sourceRunId ? { sourceRunId } : {}), remainingWork: remaining })
      if (ticket !== generation.current) { await api.revoke({ ...owner, connectionId: result.connection.connectionId }); return }
      setCreated(result); onConversationChange(result.conversation)
      const next = await api.list(owner)
      if (ticket === generation.current) {
        setGrants(next)
        setNotice('授权已创建。将配置交给本机客户端后，先让它读取本次任务与目标。')
      }
    } catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : '外部授权未完成') }
    finally { if (ticket === generation.current) setBusy(false) }
  }
  const revoke = async (connectionId: string) => {
    const ticket = generation.current
    setBusy(true); setError('')
    try {
      await api.revoke({ ...owner, connectionId })
      const next = await api.list(owner)
      if (ticket === generation.current) { setGrants(next); if (created?.connection.connectionId === connectionId) setCreated(null); setNotice('授权已撤销，后续工具请求不能再修改文档。外部客户端自己的聊天不由果铃停止。') }
    } catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : '撤销未完成') }
    finally { if (ticket === generation.current) setBusy(false) }
  }
  return <div className="external-mcp-backdrop" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary') ?? [])]
      const next = event.shiftKey ? controls.at(-1) : controls[0]
      if (next && (document.activeElement === panel.current || document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1)))) { event.preventDefault(); next.focus() }
    }
  }}>
    <section className="external-mcp-panel" role="dialog" aria-modal="true" aria-label="外部客户端连接" tabIndex={-1} ref={panel}>
      <header><h2>交给外部客户端</h2><button type="button" onClick={onClose} aria-label="关闭外部连接面板">关闭</button></header>
      <p>授权仅适用于本机客户端和下面选中的文档，切换页面不会改变目标。果铃仍需保持打开。</p>
      <ul aria-label="本次授权范围">{documents.map((doc, index) => <li key={doc.documentId}>
        {documentNames?.[doc.documentId] ?? `文档 ${index + 1}`}：{doc.writable.length === 0 ? '只读' : doc.writable.map(scope => scope.kind === 'document' ? '整个文档可修改'
          : scope.kind === 'markdown-range' ? `正文第 ${scope.from + 1}–${scope.to} 字符可修改` : scope.kind === 'flow-block' ? '选中的讲义块可修改' : '选中的对象可修改').join('；')}
      </li>)}</ul>
      {!documents.length && <p>请先在会话中选择需要交接的文档。</p>}
      <label>任务来源<select value={sourceRunId} onChange={event => setSourceRunId(event.target.value)} disabled={busy}>
        <option value="">当前输入的新任务</option>
        {conversation.runIndex.builtinRunIds.map((id, index) => <option value={id} key={id}>继续会话中的第 {index + 1} 次任务</option>)}
      </select></label>
      <label>剩余任务或补充要求<textarea value={remaining} onChange={event => setRemaining(event.target.value)} rows={3} placeholder="外部接手后还需要完成什么" disabled={busy} /></label>
      <label>授权有效期<select value={lifetime} onChange={event => setLifetime(Number(event.target.value))} disabled={busy}>
        <option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>1 小时</option>
      </select></label>
      <button type="button" disabled={busy || !documents.length || !instruction.trim() && !sourceRunId} onClick={() => { void create() }}>结算当前任务并创建授权</button>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {available && <div className="external-mcp-config">
        <p>授权有效至 {new Date(created.connection.expiresAt).toLocaleTimeString()}。凭据仅在本次创建后显示。</p>
        <label>客户端<select value={client} onChange={event => setClient(event.target.value as typeof client)}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="opencode">OpenCode</option></select></label>
        <p>先在启动客户端的 PowerShell 中设置本次凭据：</p>
        <textarea aria-label="本次授权环境变量" readOnly rows={2} value={`$env:GUOLING_MCP_TOKEN='${created.connection.bearer}'`} onFocus={event => event.target.select()} />
        <p>{client === 'codex' ? '将以下内容合并到 Codex 的 config.toml。' : client === 'claude' ? '将以下内容合并到 .mcp.json，或用 --mcp-config 指定独立配置文件。' : '将以下内容合并到 opencode.json。'}</p>
        <textarea aria-label="客户端配置" readOnly rows={8} value={created.config[client]} onFocus={event => event.target.select()} />
        <details><summary>查看事实交接包（{created.handoff.committedFacts.length} 项已提交）</summary>
          <textarea aria-label="事实交接包" readOnly rows={8} value={JSON.stringify(created.handoff, null, 2)} />
        </details>
      </div>}
      {grants.length > 0 && <ul aria-label="已有外部授权">{grants.map((grant, index) => <li key={grant.connectionId}>
        连接 {index + 1} · {statuses[grant.status]} · {grant.documents.length} 个文档
        {grant.status === 'active' && <button type="button" onClick={() => { void revoke(grant.connectionId) }} disabled={busy}>撤销连接 {index + 1}</button>}
      </li>)}</ul>}
      <p className="external-mcp-limits">果铃只显示实际收到的工具调用与提交。外部聊天、用量和任务是否完成未知。云端客户端无法直接连接此本机地址；本连接不限制客户端自己的磁盘操作。</p>
    </section>
  </div>
}
