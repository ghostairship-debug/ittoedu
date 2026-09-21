import { useCallback, useEffect, useRef, useState } from 'react'
import { readableChatError } from './readableChatStatus'
import { NativeAgentDiagnostics } from './NativeAgentDiagnostics'
import type { LocalAgentCapabilities, LocalAgentConfiguration, LocalAgentId } from '../../../shared/localAgentContract'

interface NativeAgentConfigurationProps {
  adapter: LocalAgentId
  configurationSequence: number
  projectId?: string
  projectPath?: string
  onSavingChange?(saving: boolean): void
  taskConfiguration?: LocalAgentCapabilities['current']
}
type DirectoryState = 'loading' | 'refreshing' | 'ready' | 'empty' | 'error'
const message = readableChatError

export function NativeAgentConfiguration(props: NativeAgentConfigurationProps) {
  // A different CLI or workspace owns different configuration and request state.
  return <NativeAgentConfigurationControls key={JSON.stringify([props.adapter, props.projectId, props.projectPath])} {...props} />
}

function NativeAgentConfigurationControls({ adapter, configurationSequence, projectId, projectPath, onSavingChange, taskConfiguration }: NativeAgentConfigurationProps) {
  const [capabilities, setCapabilities] = useState<LocalAgentCapabilities | null>(null)
  const [directoryState, setDirectoryState] = useState<DirectoryState>('loading')
  const [directoryError, setDirectoryError] = useState('')
  const [configurationError, setConfigurationError] = useState('')
  const [saving, setSaving] = useState(false)
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const requestEpoch = useRef(0)
  const configurationEpoch = useRef(0)
  const configurationPending = useRef(false)
  const readAfterConfiguration = useRef(false)
  const loadDirectory = useCallback(async (refresh = false) => {
    const epoch = ++requestEpoch.current
    setDirectoryState(refresh ? 'refreshing' : 'loading')
    setDirectoryError('')
    if (refresh) setConfigurationError('')
    try {
      if (!window.desktopAPI) throw new Error('当前环境无法连接原生 CLI。')
      const result = await window.desktopAPI.localAgent({ operation: 'capabilities', adapter,
        ...(projectId !== undefined && projectPath !== undefined ? { projectId, projectPath } : {}),
        ...(refresh ? { refresh: true } : {}) })
      if (!result.capabilities) throw new Error('未取得原生模型目录。')
      if (epoch !== requestEpoch.current) return
      setCapabilities(result.capabilities)
      setDirectoryState(result.capabilities.models.length ? 'ready' : 'empty')
    } catch (reason) {
      if (epoch !== requestEpoch.current) return
      setDirectoryError(reason instanceof Error && /超时|timeout/i.test(reason.message) ? '原生目录查询超时，请刷新重试。' : message(reason))
      setDirectoryState('error')
    }
  }, [adapter, projectId, projectPath])
  useEffect(() => {
    if (configurationPending.current) {
      readAfterConfiguration.current = true
      return
    }
    void loadDirectory()
    return () => { requestEpoch.current++ }
  }, [loadDirectory, configurationSequence])
  useEffect(() => () => {
    requestEpoch.current++
    configurationEpoch.current++
    onSavingChange?.(false)
  }, [onSavingChange])

  async function configure(configuration: LocalAgentConfiguration) {
    if (configurationPending.current) return
    const epoch = ++configurationEpoch.current
    configurationPending.current = true
    onSavingChange?.(true)
    setSaving(true)
    setConfigurationError('')
    try {
      if (!window.desktopAPI) throw new Error('当前环境无法连接原生 CLI。')
      const result = await window.desktopAPI.localAgent({ operation: 'configure', adapter, configuration,
        ...(projectId !== undefined && projectPath !== undefined ? { projectId, projectPath } : {}) })
      if (!result.capabilities) throw new Error('未取得原生配置状态')
      if (epoch !== configurationEpoch.current) return
      setCapabilities(result.capabilities)
    } catch (reason) {
      if (epoch === configurationEpoch.current) setConfigurationError(message(reason))
    } finally {
      if (epoch === configurationEpoch.current) {
        configurationPending.current = false
        onSavingChange?.(false)
        setSaving(false)
        if (readAfterConfiguration.current) {
          readAfterConfiguration.current = false
          void loadDirectory()
        }
      }
    }
  }
  const selected = capabilities?.selectedConfiguration ?? capabilities?.requestedConfiguration ?? capabilities?.current
  const model = capabilities?.models.find(item => item.id === selected?.model)
  const tierLabel = (tier: string | null | undefined) => tier === undefined ? '' : tier === null || tier === 'default' ? ' · 标准速度' : ` · ${capabilities?.models.flatMap(item => item.serviceTiers ?? []).find(item => item.id === tier)?.name ?? tier}`
  const loading = directoryState === 'loading' || directoryState === 'refreshing'
  const controlsDisabled = saving || directoryState !== 'ready'
  const current = capabilities?.current
  const pending = capabilities?.requestedConfiguration
  const directoryStatus = directoryState === 'loading' ? '正在读取原生模型目录…'
    : directoryState === 'refreshing' ? '正在刷新原生模型目录…'
      : directoryState === 'empty' ? '原生 CLI 返回的模型目录为空。请检查 CLI 配置后刷新。'
        : directoryState === 'error' ? capabilities
          ? '模型目录读取失败，当前显示上次读取的目录，暂不可选择。'
          : '模型目录读取失败，请刷新重试。'
          : `已读取 ${capabilities?.models.length ?? 0} 个原生模型。`
  return <section aria-label="CLI 模型配置" aria-busy={loading || saving} className="native-agent-configuration">
    <details onToggle={event => setConfigurationOpen(event.currentTarget.open)}><summary>{selected?.model ? `${selected.model}${selected.effort ? ` · ${selected.effort}` : ' · 默认'}${tierLabel(selected.serviceTier)}` : '模型与强度'} · 配置{pending ? '（待应用）' : ''}</summary>
    <div className="chat-controls">
      <label>模型<select aria-label="模型" value={model ? selected?.model ?? '' : ''} disabled={controlsDisabled}
        onChange={event => {
          const next = capabilities?.models.find(item => item.id === event.target.value)
          if (next) void configure({ model: next.id, effort: next.effort.kind === 'supported' ? next.effort.default : null,
            ...(adapter === 'codex' && selected?.serviceTier !== undefined ? { serviceTier: selected.serviceTier && next.serviceTiers?.some(tier => tier.id === selected.serviceTier) ? selected.serviceTier : 'default' } : {}) })
        }}>
        <option value="" disabled>{selected?.model && !model ? '所选模型已不在目录中' : '原生默认（尚未确认）'}</option>
        {capabilities?.models.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>
      <label>强度<select aria-label="强度" value={selected?.effort ?? ''} disabled={controlsDisabled || model?.effort.kind !== 'supported'}
        onChange={event => { if (model) void configure({ model: model.id, effort: event.target.value || null,
          ...(selected?.serviceTier !== undefined ? { serviceTier: selected.serviceTier } : {}) }) }}>
        <option value="">默认</option>{model?.effort.kind === 'supported' && model.effort.values.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      {adapter === 'codex' && <label>速度<select aria-label="速度" value={selected?.serviceTier === undefined ? 'inherit' : selected.serviceTier ?? 'inherit'}
        disabled={controlsDisabled || !model?.serviceTiers}
        onChange={event => { if (model) void configure({ model: model.id, effort: selected?.effort ?? null,
          ...(event.target.value !== 'inherit' ? { serviceTier: event.target.value } : {}) }) }}>
        <option value="inherit">沿用原生设置</option><option value="default">标准速度</option>
        {model?.serviceTiers?.filter(tier => tier.id !== 'default').map(tier => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
      </select></label>}
      <button type="button" disabled={loading || saving} onClick={() => void loadDirectory(true)}>
        {directoryState === 'refreshing' ? '刷新中…' : '刷新模型目录'}
      </button>
    </div>
    {adapter === 'codex' && <p>快速模式会增加用量消耗，具体费用取决于模型和登录方式；不会改变模型或思考强度。{!model?.serviceTiers?.length && '当前原生目录未提供可选速度，请刷新目录或更新 CLI。'}</p>}
    <small role="status">{directoryStatus}</small>
    {capabilities && <div>
      <small role="status">{current?.model
        ? (directoryState !== 'ready' ? '上次读取：' : capabilities.currentSource === 'native-config' ? '新任务原生默认：' : '最近原生确认：') + (current.resolvedModel ?? current.model) + (current.effort ? ' · ' + current.effort : '') + tierLabel(current.serviceTier)
        : '等待原生 CLI 确认当前模型。'}</small>
      {pending && <p role="status">待应用：{pending.model}{pending.effort ? ' · ' + pending.effort : ' · 使用原生强度'}{tierLabel(pending.serviceTier)}。
        所选配置将在下次发送或继续时应用；当前任务保持原配置。</p>}
    </div>}
    {taskConfiguration?.model && <p role="status">当前任务原生确认：{taskConfiguration.resolvedModel ?? taskConfiguration.model}{taskConfiguration.effort ? ' · ' + taskConfiguration.effort : ''}{tierLabel(taskConfiguration.serviceTier)}</p>}
    {directoryError && <p role="alert">{directoryError}</p>}
    {configurationError && <p role="alert">{configurationError}</p>}
    {configurationOpen && <NativeAgentDiagnostics adapter={adapter} />}
    </details>
  </section>
}
