import { useEffect, useState } from 'react'
import type { PixabaySettingsAPI, PixabaySettingsView } from '../../shared/workbench/pixabaySettingsDesktop'

export function PixabaySettingsSection({ api = window.desktopAPI?.pixabaySettings }: { api?: PixabaySettingsAPI }) {
  const [settings, setSettings] = useState<PixabaySettingsView>()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!api) return
    let active = true
    void api.read().then(value => { if (active) setSettings(value) })
      .catch(() => { if (active) setMessage('无法读取 Pixabay 设置，请重新打开设置页。') })
    return () => { active = false }
  }, [api])
  if (!api) return null
  const save = async (value: string | null) => {
    setBusy(true); setMessage('')
    try {
      const next = await api.saveKey(value)
      setSettings(next); setKey('')
      setMessage(value === null ? '已移除自有 key。' : 'Pixabay 自有 key 已安全保存，联网能力尚未验证。')
    } catch { setMessage('Pixabay 设置未能保存，原配置已保留。请检查 key 和系统安全存储。') }
    finally { setBusy(false) }
  }
  return <section aria-label="Pixabay 图库" style={{ display: 'grid', gap: 8 }}>
    <h3 style={{ margin: 0 }}>Pixabay 图库</h3>
    <p style={{ margin: 0 }}>默认使用果铃提供的 key；也可选填自有 key。没有可用 key 时自动跳过 Pixabay，继续检索其他图库。</p>
    {settings && <small>{settings.hasUserKey ? '当前使用自有 key。' : settings.hasDefaultKey ? '当前使用果铃默认 key。' : '当前没有可用 key，搜索将跳过 Pixabay。'}
      {!settings.secureStorageAvailable && ' 系统安全凭据存储不可用，暂不能保存或读取自有 key。'}</small>}
    <label style={{ display: 'grid', gap: 5 }}>Pixabay 自有 API key（可选）
      <input type="password" aria-label="Pixabay 自有 API key" autoComplete="off" value={key}
        onChange={event => setKey(event.target.value)} placeholder={settings?.hasUserKey ? '已保存；留空保留现有 key' : '留空使用默认 key'} disabled={busy} />
    </label>
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" className="secondary-button" disabled={busy || !settings?.secureStorageAvailable || !key.trim()}
        onClick={() => void save(key)}>保存 Pixabay key</button>
      <button type="button" className="secondary-button" disabled={busy || !settings?.hasUserKey}
        onClick={() => void save(null)}>移除自有 key，使用默认</button>
    </div>
    {message && <small aria-live="polite">{message}</small>}
  </section>
}
