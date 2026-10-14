import { useEffect, useState } from 'react'
import type { ExecutionSettingsView, ExecutionRoleSelection } from '../../shared/workbench/executionSettings'
import type { ExecutionSettingsAPI } from '../../shared/workbench/executionSettingsDesktop'
import { defaultSearchSettings, searchSettingsSchema, supportsOpenAISearch, type SearchSettings } from '../../shared/workbench/searchSettings'
import type { WebSearchResult } from '../../shared/workbench/webSearch'
import { ReplyLink } from './ExecutionReplyContent'
const modeLabels: Record<SearchSettings['mode'], string> = { auto: '自动', openai: 'OpenAI 内置搜索', deepseek: 'DeepSeek 官方搜索', independent: '独立搜索', off: '关闭' }
export function SearchSettingsSection({ settings, api, onSaved }: { settings: ExecutionSettingsView; api: ExecutionSettingsAPI; onSaved(value: ExecutionSettingsView): void }) {
  const [draft, setDraft] = useState<SearchSettings>(settings.profile.search ?? defaultSearchSettings())
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState(''), [result, setResult] = useState<WebSearchResult | null>(null)
  useEffect(() => { setDraft(settings.profile.search ?? defaultSearchSettings()) }, [settings.profile.revision])
  const connections = settings.connections.filter(item => !item.revoked)
  const openai = connections.filter(item => supportsOpenAISearch(item.connection))
  const deepseek = connections.filter(item => item.connection.provider === 'deepseek' && item.connection.auth.kind === 'api-key' && new URL(item.connection.baseURL).origin === 'https://api.deepseek.com')
  const pick = (kind: 'openai' | 'deepseek', id: string) => setDraft(current => ({ ...current, [kind]: id ? {
    connectionId: id, model: current[kind]?.connectionId === id ? current[kind]!.model : Object.values(settings.profile.roles).find(role => role?.connectionId === id)?.model ?? (kind === 'deepseek' ? 'deepseek-flash' : ''),
  } : null }))
  const modelField = (kind: 'openai' | 'deepseek', selection: ExecutionRoleSelection | null) => selection && <label style={{ display: 'grid', gap: 4 }}>搜索模型<input value={selection.model} onChange={event => setDraft(current => ({ ...current, [kind]: { ...selection, model: event.target.value } }))} /></label>
  const save = async () => {
    setBusy(true); setError('')
    try { const search = searchSettingsSchema.parse(draft); await api.saveProfile({ expectedRevision: settings.profile.revision, roles: settings.profile.roles, search }); onSaved(await api.read()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '搜索设置未保存') }
    finally { setBusy(false) }
  }
  const test = async () => {
    if (!api.testSearch) return
    setBusy(true); setError(''); setResult(null)
    try { setResult(await api.testSearch(query)) } catch (cause) { setError(cause instanceof Error ? cause.message : '搜索测试未完成') }
    finally { setBusy(false) }
  }
  return <fieldset disabled={busy} style={{ display: 'grid', gap: 8 }}><legend>联网搜索</legend>
    <label>搜索方式 <select value={draft.mode} onChange={event => setDraft(current => ({ ...current, mode: event.target.value as SearchSettings['mode'] }))}>{Object.entries(modeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {(draft.mode === 'auto' || draft.mode === 'openai') && <><label>OpenAI 搜索连接 <select value={draft.openai?.connectionId ?? ''} onChange={event => pick('openai', event.target.value)}><option value="">复用本次主模型的 OpenAI 连接</option>{openai.map(item => <option key={item.connection.id} value={item.connection.id}>{item.connection.accountId} · {item.connection.protocol}{!item.hasCredential ? ' · 未登录' : ''}</option>)}</select></label>{modelField('openai', draft.openai)}</>}
    {draft.mode === 'deepseek' && <><label>DeepSeek 官方连接 <select value={draft.deepseek?.connectionId ?? ''} onChange={event => pick('deepseek', event.target.value)}><option value="">使用已有官方连接</option>{deepseek.map(item => <option key={item.connection.id} value={item.connection.id}>{item.connection.accountId}{!item.hasCredential ? ' · 未接通' : ''}</option>)}</select></label>{modelField('deepseek', draft.deepseek)}</>}
    {(draft.mode === 'auto' || draft.mode === 'independent') && <><label>独立服务 <select value={draft.independent} onChange={event => setDraft(current => ({ ...current, independent: event.target.value as SearchSettings['independent'] }))}><option value="exa">Exa MCP · 免 Key 托管服务</option><option value="searxng">SearXNG · 已有实例</option></select></label>{draft.independent === 'searxng' && <label>实例地址 <input placeholder="https://或本机/局域网地址" value={draft.searxngURL} onChange={event => setDraft(current => ({ ...current, searxngURL: event.target.value }))} /></label>}</>}
    <small>自动优先复用已选 OpenAI，失败可转一次当前独立服务；不会自动使用 DeepSeek。Exa 免 Key、有限额，检索词会发送给该服务。外部 MCP 没有主模型时使用显式搜索选择或独立服务。</small>
    <button type="button" className="secondary-button" onClick={() => void save()}>保存搜索设置</button>
    {api.testSearch && <div style={{ display: 'flex', gap: 6 }}><input aria-label="搜索测试词" placeholder="输入检索词，测试已保存配置" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" onClick={() => void test()} disabled={!query.trim()}>测试搜索</button></div>}
    <small>保存后从下次运行生效。主动测试使用已保存的选择并复用已保存的主力模型；OpenAI/DeepSeek 的模型请求按供应商计费或订阅规则使用。</small>
    {error && <p role="alert">{error}</p>}
    {result && (result.status === 'results' ? <div><small>实际服务：{result.provider} · {result.results.length} 条结果</small>{result.results.map(hit => <div key={hit.url}><ReplyLink href={hit.url}>{hit.title}</ReplyLink></div>)}{result.diagnostics?.map((message, index) => <p key={index}>{message}</p>)}</div> : <p role="status">{result.reason}</p>)}
    {result?.attempts?.map((attempt, index) => <small key={index}>尝试 {index + 1}：{attempt.provider} · {attempt.outcome}{attempt.model ? ` · 实际模型 ${attempt.model}` : ''}{attempt.usage ? ` · 已报告输入 ${attempt.usage.inputTokens ?? '未知'} / 输出 ${attempt.usage.outputTokens ?? '未知'} token` : ''}{attempt.error ? ` · ${attempt.error.message}` : ''}</small>)}
  </fieldset>
}
