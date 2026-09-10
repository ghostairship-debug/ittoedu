import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalAgentCapabilities, LocalAgentConfiguration, LocalAgentId } from '../../../shared/localAgentContract'

interface NativeAgentConfigurationProps {
  adapter: LocalAgentId
  configurationSequence: number
  projectId?: string
  projectPath?: string
}
type DirectoryState = 'loading' | 'refreshing' | 'ready' | 'empty' | 'error'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function NativeAgentConfiguration(props: NativeAgentConfigurationProps) {
  // A different CLI or workspace owns different configuration and request state.
  return <NativeAgentConfigurationControls key={JSON.stringify([props.adapter, props.projectId, props.projectPath])} {...props} />
}

function NativeAgentConfigurationControls({ adapter, configurationSequence, projectId, projectPath }: NativeAgentConfigurationProps) {
  const [capabilities, setCapabilities] = useState<LocalAgentCapabilities | null>(null)
  const [directoryState, setDirectoryState] = useState<DirectoryState>('loading')
  const [directoryError, setDirectoryError] = useState('')
  const [configurationError, setConfigurationError] = useState('')
  const [saving, setSaving] = useState(false)
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
      setDirectoryError(message(reason))
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
  }, [])

  async function configure(configuration: LocalAgentConfiguration) {
    if (configurationPending.current) return
    const epoch = ++configurationEpoch.current
    configurationPending.current = true
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
        setSaving(false)
        if (readAfterConfiguration.current) {
          readAfterConfiguration.current = false
          void loadDirectory()
        }
      }
    }
  }
  const selected = capabilities?.requestedConfiguration ?? capabilities?.current
  const model = capabilities?.models.find(item => item.id === selected?.model)
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
    <div className="chat-controls">
      <label>模型<select aria-label="模型" value={model ? selected?.model ?? '' : ''} disabled={controlsDisabled}
        onChange={event => {
          const next = capabilities?.models.find(item => item.id === event.target.value)
          if (next) void configure({ model: next.id, effort: next.effort.kind === 'supported' ? next.effort.default : null })
        }}>
        <option value="" disabled>{selected?.model && !model ? '所选模型已不在目录中' : '原生默认（尚未确认）'}</option>
        {capabilities?.models.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>
      <label>强度<select aria-label="强度" value={selected?.effort ?? ''} disabled={controlsDisabled || model?.effort.kind !== 'supported'}
        onChange={event => { if (model) void configure({ model: model.id, effort: event.target.value || null }) }}>
        <option value="">默认</option>{model?.effort.kind === 'supported' && model.effort.values.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button type="button" disabled={loading || saving} onClick={() => void loadDirectory(true)}>
        {directoryState === 'refreshing' ? '刷新中…' : '刷新模型目录'}
      </button>
    </div>
    <small role="status">{directoryStatus}</small>
    {capabilities && <div>
      <small role="status">{current?.model
        ? (directoryState === 'ready' ? '已生效：' : '上次确认：') + (current.resolvedModel ?? current.model) + (current.effort ? ' · ' + current.effort : '')
        : '等待原生 CLI 确认当前模型。'}</small>
      {pending && <p role="status">待应用：{pending.model}{pending.effort ? ' · ' + pending.effort : ' · 使用原生强度'}。
        所选配置将在下次发送或继续时应用；当前任务保持原配置。</p>}
    </div>}
    {directoryError && <p role="alert">{directoryError}</p>}
    {configurationError && <p role="alert">{configurationError}</p>}
  </section>
}
