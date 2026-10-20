import { useEffect, useState } from 'react'
import type { ExecutionSettingsView } from '../../shared/workbench/executionSettings'
import type { ExecutionSettingsAPI } from '../../shared/workbench/executionSettingsDesktop'
import { speechGenerationSelectionSchema, type SpeechGenerationSelection } from '../../shared/workbench/speechSettings'

const blankSelection = (): SpeechGenerationSelection => ({ connectionId: '', model: '', voice: '', format: 'mp3',
  supportsInstructions: false, supportsSpeed: false })
const field = { display: 'grid', gap: 5, minWidth: 0 } as const

export function SpeechSettingsSection({ settings, api, onSaved, disabled = false }: {
  settings: ExecutionSettingsView
  api: Pick<ExecutionSettingsAPI, 'read' | 'saveProfile'>
  onSaved(value: ExecutionSettingsView): void
  disabled?: boolean
}) {
  const saved = settings.profile.speech
  const [enabled, setEnabled] = useState(Boolean(saved))
  const [draft, setDraft] = useState<SpeechGenerationSelection>(() => saved ?? blankSelection())
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  useEffect(() => {
    setEnabled(Boolean(saved)); setDraft(saved ?? blankSelection())
  }, [saved?.connectionId, saved?.model, saved?.voice, saved?.format, saved?.supportsInstructions, saved?.supportsSpeed])
  const connections = settings.connections.filter(item => !item.revoked && item.connection.auth.kind === 'api-key'
    && item.connection.protocol !== 'anthropic-messages')
  const selected = connections.find(item => item.connection.id === draft.connectionId)
  const save = async () => {
    setBusy(true); setError(''); setStatus('')
    try {
      let speech: SpeechGenerationSelection | null = null
      if (enabled) {
        const parsed = speechGenerationSelectionSchema.safeParse(draft)
        if (!parsed.success || !selected) throw new Error('请选择语音 API 连接，并填写模型、声音和文件格式。')
        speech = parsed.data
      }
      await api.saveProfile({ expectedRevision: settings.profile.revision, roles: settings.profile.roles, speech })
      onSaved(await api.read())
      setStatus(speech ? '语音 API 配置已保存，下次任务生效；尚未发起语音生成。' : '语音 API 已关闭，下次任务生效。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '语音配置未保存') }
    finally { setBusy(false) }
  }
  return <section aria-label="语音 API（OpenAI兼容）" style={{ borderTop: '1px solid var(--border-color, #d0d5dd)', paddingTop: 12 }}>
    <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>语音 API（OpenAI兼容）</h3>
    <fieldset disabled={busy || disabled} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
      <label><input aria-label="启用语音 API" type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setStatus('') }} /> 启用语音 API</label>
      <small>默认未启用。请独立选择语音连接；模型角色和图片服务的选择不会启用此服务。</small>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 10 }}>
        <label style={field}>语音 API 连接<select aria-label="语音 API 连接" value={draft.connectionId} disabled={!enabled}
          onChange={event => setDraft(current => ({ ...current, connectionId: event.target.value }))}>
          <option value="">未选择</option>
          {draft.connectionId && !selected && <option value={draft.connectionId} disabled>已保存连接不可用，请重新选择或关闭</option>}
          {connections.map(item => <option key={item.connection.id} value={item.connection.id}>
            {item.connection.provider} · {item.connection.accountId}{item.hasCredential ? '' : '（未接通 API Key）'}
          </option>)}
        </select></label>
        <label style={field}>语音模型<input aria-label="语音模型" value={draft.model} disabled={!enabled} placeholder="供应商的 Speech 模型 ID"
          onChange={event => setDraft(current => ({ ...current, model: event.target.value }))} /></label>
        <label style={field}>语音声音<input aria-label="语音声音" value={draft.voice} disabled={!enabled} placeholder="供应商的声音 ID"
          onChange={event => setDraft(current => ({ ...current, voice: event.target.value }))} /></label>
        <label style={field}>语音文件格式<select aria-label="语音文件格式" value={draft.format} disabled={!enabled}
          onChange={event => setDraft(current => ({ ...current, format: event.target.value as SpeechGenerationSelection['format'] }))}>
          <option value="mp3">MP3</option><option value="wav">WAV</option>
        </select></label>
      </div>
      <label><input aria-label="支持表演指令" type="checkbox" disabled={!enabled} checked={draft.supportsInstructions ?? false}
        onChange={event => setDraft(current => ({ ...current, supportsInstructions: event.target.checked }))} /> 所选服务支持表演指令</label>
      <label><input aria-label="支持语速" type="checkbox" disabled={!enabled} checked={draft.supportsSpeed ?? false}
        onChange={event => setDraft(current => ({ ...current, supportsSpeed: event.target.checked }))} /> 所选服务支持语速</label>
      <small>仅支持 OpenAI 兼容 Speech API 合同。请按所选服务填写模型和声音 ID，并明确其支持的选项；其他供应商的原生语音接口尚未接入。</small>
      <small>保存配置不发起请求，也不验证生成能力；实际生成按所选 API 连接计费。</small>
      {enabled && selected && <small>所选 API：{selected.connection.baseURL} · {selected.connection.accountId} · {selected.connection.billing.kind}。
        {!selected.hasCredential ? '尚未接通 API Key，生成时会提示缺少凭据。' : '凭据由既有安全存储管理。'}</small>}
      <button type="button" className="secondary-button" onClick={() => void save()} style={{ justifySelf: 'start' }}>保存语音设置</button>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </fieldset>
  </section>
}
