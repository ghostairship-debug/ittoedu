import { useEffect, useState } from 'react'
import type { LocalAgentCapabilities, LocalAgentConfiguration, LocalAgentId } from '../../../shared/localAgentContract'

export function NativeAgentConfiguration({ adapter, configurationSequence }: { adapter: LocalAgentId; configurationSequence: number }) {
  const [capabilities, setCapabilities] = useState<LocalAgentCapabilities | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    void window.desktopAPI?.localAgent({ operation: 'capabilities', adapter }).then(result => {
      if (live) setCapabilities(result.capabilities ?? null)
    }).catch(reason => { if (live) { setCapabilities(null); setError(reason instanceof Error ? reason.message : String(reason)) } })
    return () => { live = false }
  }, [adapter, configurationSequence])
  async function configure(configuration: LocalAgentConfiguration) {
    setSaving(true); setError('')
    try {
      const result = await window.desktopAPI!.localAgent({ operation: 'configure', adapter, configuration })
      if (!result.capabilities) throw new Error('未取得原生配置状态')
      setCapabilities(result.capabilities)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  const selected = capabilities?.requestedConfiguration ?? capabilities?.current
  const model = capabilities?.models.find(item => item.id === selected?.model)
  return <section aria-label="CLI 模型配置" className="native-agent-configuration">
    <div className="chat-controls">
      <label>模型<select aria-label="模型" value={selected?.model ?? ''} disabled={saving || !capabilities?.models.length}
        onChange={event => {
          const next = capabilities!.models.find(item => item.id === event.target.value)
          if (next) void configure({ model: next.id, effort: next.effort.kind === 'supported' ? next.effort.default : null })
        }}>
        <option value="" disabled>原生默认（尚未确认）</option>
        {capabilities?.models.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>
      <label>强度<select aria-label="强度" value={selected?.effort ?? ''} disabled={saving || model?.effort.kind !== 'supported'}
        onChange={event => { if (model) void configure({ model: model.id, effort: event.target.value || null }) }}>
        <option value="">默认</option>{model?.effort.kind === 'supported' && model.effort.values.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
    </div>
    <small role="status">{capabilities?.requestedConfiguration ? '所选配置将在下次发送或继续时应用；当前任务保持原配置。'
      : capabilities?.current.model ? '已生效：' + (capabilities.current.resolvedModel ?? capabilities.current.model) + (capabilities.current.effort ? ' · ' + capabilities.current.effort : '')
        : '等待原生 CLI 确认当前模型。'}</small>
    {error && <p role="alert">{error}</p>}
  </section>
}

