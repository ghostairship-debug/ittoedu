import type { ExecutionSettingsView } from '../../shared/workbench/executionSettings'
import type { SpeechSelectionSnapshot } from '../../shared/workbench/speechSettings'
import type { MediaConnectionCapability } from './media/MediaCapabilityService'

/** Capture the explicitly configured speech role, independently of conversation/images. */
export function freezeSpeechSelection(view: ExecutionSettingsView): SpeechSelectionSnapshot {
  const selected = view.profile.speech
  if (!selected) return { unavailableReason: '未配置语音 API；本机语音可独立使用。' }
  const entry = view.connections.find(value => value.connection.id === selected.connectionId)
  if (!entry || entry.revoked || !entry.hasCredential)
    return { unavailableReason: '所选语音 API 连接没有可用凭据或已撤销。' }
  const connection = entry.connection
  if (connection.auth.kind !== 'api-key' || !['openai-chat', 'openai-responses'].includes(connection.protocol))
    return { unavailableReason: '语音 API 需要 OpenAI 兼容 Speech 接口的 API Key 连接；当前登录方式未接入该接口。' }
  return { selection: structuredClone(selected), connection: structuredClone(connection) }
}

export function speechConnectionCapability(snapshot: SpeechSelectionSnapshot): MediaConnectionCapability | undefined {
  const selected = snapshot.selection, connection = snapshot.connection
  if (!selected || !connection || snapshot.unavailableReason) return
  return { kind: 'speech', route: 'remote', connectionId: connection.id, connectionRevision: connection.revision,
    model: selected.model, verified: true, billing: connection.billing.kind,
    speech: { voices: [selected.voice], defaultVoice: selected.voice, formats: ['mp3', 'wav'], defaultFormat: selected.format,
      instructions: selected.supportsInstructions === true,
      ...(selected.supportsSpeed === true ? { speed: { min: 0.25, max: 4, default: 1 } } : {}) } }
}
