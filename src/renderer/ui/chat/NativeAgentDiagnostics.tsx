import { useCallback, useEffect, useRef, useState } from 'react'
import { readableChatError } from './readableChatStatus'
import type { LocalAgentId, LocalAgentProbe } from '../../../shared/localAgentContract'
import { NativeAgentHelp } from './NativeAgentHelp'

interface NativeAgentDiagnosticsProps {
  adapter: LocalAgentId
}

type ProbeState = 'loading' | 'refreshing' | 'ready' | 'error'

const cliNames: Record<LocalAgentId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode',
}

const probeLabels: Record<LocalAgentProbe['status'], string> = {
  ready: '已就绪',
  missing: '未安装',
  unauthenticated: '未认证',
  'unknown-auth': '认证状态未知',
  'unsupported-version': '版本不受支持',
  launch: '探测失败',
}

const probeGuidance: Record<LocalAgentProbe['status'], string> = {
  ready: '已通过 CLI 版本和可用性探测，可以继续读取模型配置。',
  missing: '没有发现 CLI。请按下方官方安装说明安装后刷新。',
  unauthenticated: 'CLI 已安装，但认证检查未通过。请在 CLI 自己完成登录；应用不会读取或保存凭据。',
  'unknown-auth': 'CLI 已安装且版本受支持，但该 CLI 没有提供可验证的认证状态。此状态不等同于已认证；实际可用性由原生 CLI 在运行时报告。',
  'unsupported-version': '已发现 CLI，但版本不在当前协议范围内。请按下方官方文档更新后刷新。',
  launch: '无法完成 CLI 探测。请检查本机安装后重试。',
}

const officialGuidance: Record<LocalAgentId, { installUrl: string; loginUrl: string; install: string; login: string }> = {
  codex: {
    installUrl: 'https://developers.openai.com/codex/cli/',
    loginUrl: 'https://developers.openai.com/codex/auth/',
    install: '按 OpenAI 官方 CLI 安装页安装 Codex CLI。',
    login: '安装后在终端运行 `codex login`，按官方流程完成登录。',
  },
  claude: {
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    loginUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    install: '按 Anthropic 官方 Claude Code 安装页安装 Claude CLI。',
    login: '启动 `claude`，按官方登录提示完成认证。',
  },
  opencode: {
    installUrl: 'https://opencode.ai/docs/',
    loginUrl: 'https://opencode.ai/docs/providers/',
    install: '按 OpenCode 官方文档安装 OpenCode CLI。',
    login: '安装后按官方 Providers 文档运行 `opencode auth login` 完成认证。',
  },
}

function probeStatusText(state: ProbeState, probe: LocalAgentProbe | null): string {
  if (state === 'loading') return '正在检查 CLI…'
  if (state === 'refreshing') return '正在刷新 CLI 诊断…'
  if (state === 'error') return probe ? '诊断失败，当前显示上次结果。' : '诊断失败，请刷新重试。'
  return probe ? `${probeLabels[probe.status]}。${probe.version ? `版本 ${probe.version}。` : ''}` : '等待 CLI 诊断。'
}

export function NativeAgentDiagnostics({ adapter }: NativeAgentDiagnosticsProps) {
  const [probe, setProbe] = useState<LocalAgentProbe | null>(null)
  const [state, setState] = useState<ProbeState>('loading')
  const [error, setError] = useState('')
  const requestEpoch = useRef(0)
  const cliName = cliNames[adapter]
  const guidance = officialGuidance[adapter]

  const loadProbe = useCallback(async (refresh = false) => {
    const epoch = ++requestEpoch.current
    setState(refresh ? 'refreshing' : 'loading')
    setError('')
    try {
      if (!window.desktopAPI) throw new Error('当前环境无法连接原生 CLI。')
      const result = await window.desktopAPI.localAgent({ operation: 'probe', adapter })
      if (!result.probe) throw new Error('未取得 CLI 诊断结果。')
      if (epoch !== requestEpoch.current) return
      setProbe(result.probe)
      setState('ready')
    } catch (reason) {
      if (epoch !== requestEpoch.current) return
      setError(readableChatError(reason))
      setState('error')
    }
  }, [adapter])

  useEffect(() => {
    setProbe(null)
    void loadProbe()
    return () => { requestEpoch.current++ }
  }, [loadProbe])

  const busy = state === 'loading' || state === 'refreshing'
  const status = probe ? probeLabels[probe.status] : null
  return <section aria-label={`${cliName} CLI 诊断`} aria-busy={busy}>
    <div className="chat-controls">
      <strong>CLI 诊断</strong>
      <button type="button" aria-label={`刷新 ${cliName} CLI 诊断`} disabled={busy} onClick={() => void loadProbe(true)}>
        {state === 'refreshing' ? '刷新中…' : '刷新诊断'}
      </button>
    </div>
    {/* 可见状态行不是 live region：它与下方状态段落在同一次提交里从无到有挂载，
        两者都是 polite 会重复播报同一个状态词。这里显式 aria-live="off" 只保留可见文本。 */}
    <p aria-live="off">{cliName}：{probeStatusText(state, probe)}</p>
    {probe && <>
      <p role="status" aria-live="polite">状态：{status}。{probeGuidance[probe.status]}</p>
      <p>版本：{probe.version ?? '未返回版本'}</p>
    </>}
    {error && <p role="alert">{error}</p>}
    <details>
      <summary>官方安装与登录说明</summary>
      <p>{guidance.install} <a href={guidance.installUrl} target="_blank" rel="noreferrer">打开官方安装文档</a></p>
      <p>{guidance.login} <a href={guidance.loginUrl} target="_blank" rel="noreferrer">打开官方登录文档</a></p>
      <p>安装和登录由 CLI 自己管理，完成后请回到这里刷新诊断。</p>
    </details>
    <p role="note">若已安装但仍未发现，请重启应用；自定义安装目录需加入系统 PATH 后再试。</p>
    <NativeAgentHelp />
  </section>
}
