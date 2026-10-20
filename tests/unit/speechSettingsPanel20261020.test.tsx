import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SpeechSettingsSection } from '../../src/renderer/workbench/SpeechSettingsSection'
import type { ExecutionConnectionView, ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'

afterEach(cleanup)
const connection = (id: string): ExecutionConnectionView => ({ connection: { id, revision: 1, provider: id, protocol: 'openai-chat',
  baseURL: `https://${id}.invalid/v1`, accountId: `${id}-account`, auth: { kind: 'api-key', credentialRef: 'private-reference' }, billing: { kind: 'metered' },
  capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } }, hasCredential: true, revoked: false })
function fixture() {
  const text = connection('text'), image = connection('images'), oauth = connection('oauth'), anthropic = connection('anthropic'), revoked = connection('revoked')
  image.connection.imageProtocol = 'openai-images'; oauth.connection.auth.kind = 'oauth'
  anthropic.connection.protocol = 'anthropic-messages'; revoked.revoked = true
  let state: ExecutionSettingsView = { secureStorageAvailable: true, connections: [text, image, oauth, anthropic, revoked],
    profile: { revision: 1, updatedAt: '2026-10-20T00:00:00Z', nativeConcurrencyLimit: 7,
      roles: { conversation: { connectionId: 'text', model: 'text-model' }, vision: null,
        imageGenerate: { connectionId: 'images', model: 'image-model' }, imageEdit: null } } }
  const api = { read: vi.fn(async () => structuredClone(state)), saveProfile: vi.fn(async (input: Parameters<ExecutionSettingsAPI['saveProfile']>[0]) => {
    state = { ...state, profile: { ...state.profile, revision: state.profile.revision + 1, roles: input.roles,
      ...(input.speech !== undefined ? { speech: input.speech } : {}) } }
    return structuredClone(state.profile)
  }) } satisfies Pick<ExecutionSettingsAPI, 'read' | 'saveProfile'>
  return { state, api, onSaved: vi.fn() }
}

it('starts without a supplier preset and saves explicit model, voice, format and optional capabilities without a generation request', async () => {
  const f = fixture()
  render(<SpeechSettingsSection settings={f.state} api={f.api} onSaved={f.onSaved} />)
  const region = screen.getByRole('region', { name: '语音 API（OpenAI兼容）' })
  expect(within(region).getByLabelText('启用语音 API')).not.toBeChecked()
  expect(within(region).getByLabelText('语音 API 连接')).toHaveValue('')
  expect(within(region).getByLabelText('语音模型')).toHaveValue('')
  expect(within(region).getByLabelText('语音声音')).toHaveValue('')
  expect(within(region).getByLabelText('支持表演指令')).not.toBeChecked()
  expect(within(region).getByLabelText('支持语速')).not.toBeChecked()
  const picker = within(region).getByLabelText('语音 API 连接')
  expect(within(picker).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['', 'text', 'images'])
  fireEvent.click(within(region).getByLabelText('启用语音 API'))
  fireEvent.change(picker, { target: { value: 'images' } })
  fireEvent.click(within(region).getByRole('button', { name: '保存语音设置' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('填写模型、声音')
  expect(f.api.saveProfile).not.toHaveBeenCalled()
  fireEvent.change(within(region).getByLabelText('语音模型'), { target: { value: 'provider-speech-v1' } })
  fireEvent.change(within(region).getByLabelText('语音声音'), { target: { value: 'provider-voice-37' } })
  fireEvent.change(within(region).getByLabelText('语音文件格式'), { target: { value: 'wav' } })
  fireEvent.click(within(region).getByLabelText('支持表演指令'))
  fireEvent.click(within(region).getByLabelText('支持语速'))
  fireEvent.click(within(region).getByRole('button', { name: '保存语音设置' }))
  await waitFor(() => expect(f.api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 1, roles: f.state.profile.roles,
    speech: { connectionId: 'images', model: 'provider-speech-v1', voice: 'provider-voice-37', format: 'wav',
      supportsInstructions: true, supportsSpeed: true } }))
  expect(await screen.findByRole('status')).toHaveTextContent('尚未发起语音生成')
  expect(f.onSaved).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ nativeConcurrencyLimit: 7 }) }))
})

it('can disable the saved route with locked storage and keeps other settings in the save request', async () => {
  const f = fixture()
  f.state.secureStorageAvailable = false
  f.state.profile.speech = { connectionId: 'text', model: 'provider-speech-v1', voice: 'provider-voice-37', format: 'mp3' }
  render(<SpeechSettingsSection settings={f.state} api={f.api} onSaved={f.onSaved} />)
  fireEvent.click(screen.getByLabelText('启用语音 API'))
  fireEvent.click(screen.getByRole('button', { name: '保存语音设置' }))
  await waitFor(() => expect(f.api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 1, roles: f.state.profile.roles, speech: null }))
  expect(await screen.findByRole('status')).toHaveTextContent('已关闭')
})

it('does not overwrite an unsaved speech draft when another independent profile setting is saved', () => {
  const f = fixture(), renderSection = (settings: ExecutionSettingsView) => <SpeechSettingsSection settings={settings} api={f.api} onSaved={f.onSaved} />
  const view = render(renderSection(f.state))
  fireEvent.click(screen.getByLabelText('启用语音 API'))
  fireEvent.change(screen.getByLabelText('语音模型'), { target: { value: 'provider-speech-draft' } })
  view.rerender(renderSection({ ...f.state, profile: { ...f.state.profile, revision: 2, nativeConcurrencyLimit: 10 } }))
  expect(screen.getByLabelText('启用语音 API')).toBeChecked()
  expect(screen.getByLabelText('语音模型')).toHaveValue('provider-speech-draft')
})
