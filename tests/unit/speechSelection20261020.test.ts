// @vitest-environment node
import { expect, it } from 'vitest'
import { freezeSpeechSelection, speechConnectionCapability } from '../../src/main/workbench/speechSelection'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'

function settings(): ExecutionSettingsView {
  return { secureStorageAvailable: true, profile: { revision: 1, updatedAt: '',
    roles: { conversation: null, vision: null, imageGenerate: null, imageEdit: null } },
  connections: [{ hasCredential: true, revoked: false, connection: { id: 'speech', revision: 3,
    provider: 'openai', protocol: 'openai-chat', baseURL: 'https://speech.invalid/v1', accountId: 'fixture',
    auth: { kind: 'api-key', credentialRef: 'opaque-ref' }, billing: { kind: 'metered' },
    capabilities: { stream: 'unknown', vision: 'unknown', reasoning: 'unknown', tools: 'unknown' } } }] }
}

it('enables only an explicitly selected speech route and freezes its complete connection revision', () => {
  const view = settings()
  view.profile.roles.conversation = { connectionId: 'speech', model: 'gpt-4o-mini-tts' }
  expect(speechConnectionCapability(freezeSpeechSelection(view))).toBeUndefined()
  view.profile.speech = { connectionId: 'speech', model: 'custom/voice-model', voice: 'narrator-42', format: 'mp3',
    supportsInstructions: true, supportsSpeed: true }
  const frozen = freezeSpeechSelection(view)
  view.connections[0]!.connection.revision = 4
  view.profile.speech.voice = 'alloy'
  expect(speechConnectionCapability(frozen)).toMatchObject({ connectionRevision: 3,
    model: 'custom/voice-model', speech: { voices: ['narrator-42'], defaultVoice: 'narrator-42', defaultFormat: 'mp3',
      instructions: true, speed: { min: 0.25, max: 4, default: 1 } } })
  const unspecified = settings()
  unspecified.profile.speech = { connectionId: 'speech', model: 'custom/basic-model', voice: 'basic', format: 'wav' }
  expect(speechConnectionCapability(freezeSpeechSelection(unspecified))?.speech).toMatchObject({ instructions: false })
  expect(speechConnectionCapability(freezeSpeechSelection(unspecified))?.speech?.speed).toBeUndefined()
})

it('reports unavailable credentials and unsupported authentication without borrowing another role', () => {
  const view = settings()
  view.profile.speech = { connectionId: 'speech', model: 'gpt-4o-mini-tts', voice: 'coral', format: 'wav' }
  view.connections[0]!.hasCredential = false
  expect(freezeSpeechSelection(view).unavailableReason).toContain('没有可用凭据')
  view.connections[0]!.hasCredential = true
  view.connections[0]!.connection.auth.kind = 'oauth'
  expect(freezeSpeechSelection(view).unavailableReason).toContain('当前登录方式未接入')
})
