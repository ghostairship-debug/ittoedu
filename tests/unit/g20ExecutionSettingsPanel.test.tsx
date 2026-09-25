import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionSettingsPanel } from '../../src/renderer/workbench/ExecutionSettingsPanel'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'

afterEach(cleanup)
function setup() {
  let state: ExecutionSettingsView = { connections: [], secureStorageAvailable: true,
    profile: { revision: 0, updatedAt: '2026-09-23T00:00:00.000Z', roles: { conversation: null, vision: null, imageGenerate: null, imageEdit: null } } }
  const api: ExecutionSettingsAPI = {
    read: vi.fn(async () => structuredClone(state)),
    saveConnection: vi.fn(async input => {
      const { authKind, ...configuration } = input.connection
      const entry = { connection: { ...configuration, id: 'connection', revision: 1, auth: { kind: authKind, credentialRef: 'private-reference' },
        capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } as const }, hasCredential: Boolean(input.apiKey), revoked: false }
      state = { ...state, connections: [entry] }; return entry
    }),
    saveProfile: vi.fn(async input => { state.profile = { ...state.profile, revision: state.profile.revision + 1, roles: input.roles }; return structuredClone(state.profile) }),
    revokeConnection: vi.fn(async () => { state.connections[0]!.hasCredential = false; state.connections[0]!.revoked = true }),
    discoverModels: vi.fn(async () => ({ connectionId: 'connection', connectionRevision: 1, models: [{ id: 'available-model' }], capabilitiesVerified: false as const, source: 'live' as const, checkedAt: '2026-09-25T00:00:00.000Z' })),
    probeCapabilities: vi.fn(async (input: Parameters<ExecutionSettingsAPI['probeCapabilities']>[0]) => {
      const selected = state.profile.roles[input.role]!
      const record = { connectionId: selected.connectionId, connectionRevision: state.connections.find(entry => entry.connection.id === selected.connectionId)!.connection.revision,
        model: selected.model, parametersKey: JSON.stringify(selected.parameters ?? {}), facts: { [input.checks[0]]: { status: 'supported' as const, observedAt: 100, source: 'probe' as const, actualModel: 'actual-model' } },
        lastProbe: { observedAt: 100, checks: input.checks, requestCount: input.checks.length, outcomes: input.checks.map((capability: typeof input.checks[number]) => ({ capability, status: 'supported' as const,
          code: `probe-${capability}-observed`, message: '已观察', actualModel: 'actual-model' })) } }
      state = { ...state, capabilityRecords: [record] }; return record
    }),
    startOAuthLogin: vi.fn(async () => ({ loginId: 'login', status: 'pending' as const })),
    oauthLoginStatus: vi.fn(async () => ({ loginId: 'login', status: 'pending' as const })),
    cancelOAuthLogin: vi.fn(async () => undefined),
  }
  return { api, state }
}

it('saves a write-only key, clears it, edits role parameters and revokes without claiming verified capability', async () => {
  const { api } = setup()
  const close = vi.fn()
  render(<ExecutionSettingsPanel open api={api} onClose={close} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '保存连接' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('供应商标识'), { target: { value: 'my-provider' } })
  fireEvent.change(screen.getByLabelText('账号标识'), { target: { value: 'my-account' } })
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'https://fixture.invalid/v1' } })
  fireEvent.change(screen.getByLabelText('计费来源'), { target: { value: 'token-plan' } })
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'fixture-key' } })
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('模型能力尚未验证'))
  expect(screen.getByLabelText('API Key')).toHaveValue('')
  expect(api.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'fixture-key', connection: expect.objectContaining({ billing: { kind: 'token-plan' } }) }))
  expect(api.discoverModels).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('对话与规划连接'), { target: { value: 'connection' } })
  await waitFor(() => expect(within(screen.getByLabelText('对话与规划模型')).getByRole('option', { name: /available-model/ })).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('对话与规划模型'), { target: { value: 'available-model' } })
  fireEvent.change(screen.getByLabelText('对话与规划参数'), { target: { value: '{"reasoning_effort":"high"}' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: { connectionId: 'connection', model: 'available-model', parameters: { reasoning_effort: 'high' } }, vision: null, imageGenerate: null, imageEdit: null,
  } }))
  await waitFor(() => expect(screen.getByRole('button', { name: '读取模型目录' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '读取模型目录' }))
  await screen.findByText('available-model')
  expect(api.discoverModels).toHaveBeenCalledWith('connection', 1)
  fireEvent.click(screen.getByRole('button', { name: '撤销凭据' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('全部历史凭据'))
  expect(screen.getByRole('button', { name: '读取模型目录' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '关闭模型连接设置' }))
  expect(close).toHaveBeenCalledOnce()
})

it('runs one explicit probe for the saved vision role and shows the exact billing path', async () => {
  const { api, state } = setup()
  const connection = { id: 'vision-connection', revision: 1, provider: 'vision-provider', protocol: 'openai-chat' as const, baseURL: 'https://fixture.invalid/v1',
    accountId: 'vision-account', auth: { kind: 'api-key' as const, credentialRef: 'private-reference' }, billing: { kind: 'token-plan' as const },
    capabilities: { tools: 'unknown' as const, vision: 'unknown' as const, stream: 'unknown' as const, reasoning: 'unknown' as const } }
  state.connections = [{ connection, hasCredential: true, revoked: false },
    { connection: { ...connection, id: 'other-connection', accountId: 'other-account' }, hasCredential: true, revoked: false }]
  state.profile = { revision: 1, updatedAt: state.profile.updatedAt, roles: { conversation: null,
    vision: { connectionId: connection.id, model: 'vision-model', parameters: { detail: 'high' } }, imageGenerate: null, imageEdit: null } }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  const region = await screen.findByRole('region', { name: '视觉理解配置' })
  const button = within(region).getByRole('button', { name: '验证视觉理解视觉能力' })
  expect(within(region).getByText(/发起 1 次小请求/)).toBeInTheDocument()
  fireEvent.click(button)
  await waitFor(() => expect(api.probeCapabilities).toHaveBeenCalledWith({ role: 'vision', expectedProfileRevision: 1, checks: ['vision'] }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('视觉能力已验证'))
  expect(screen.getByRole('status')).toHaveTextContent('vision-provider / vision-model')
  expect(screen.getByRole('status')).toHaveTextContent('Token Plan')
  expect(within(region).getByText('视觉能力已按当前连接版本、模型和参数验证。')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('视觉理解模型'), { target: { value: 'available-model' } })
  expect(within(region).getByText(/此未保存选择未验证/)).toBeInTheDocument()
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(api.probeCapabilities).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText('视觉理解模型'), { target: { value: 'vision-model' } })
  expect(within(region).getByText('视觉能力已按当前连接版本、模型和参数验证。')).toBeInTheDocument()
  expect(button).toBeEnabled()
  fireEvent.change(screen.getByLabelText('视觉理解参数'), { target: { value: '{"detail":"low"}' } })
  expect(within(region).getByText(/此未保存选择未验证/)).toBeInTheDocument()
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('视觉理解参数'), { target: { value: '{ "detail": "high" }' } })
  expect(within(region).getByText('视觉能力已按当前连接版本、模型和参数验证。')).toBeInTheDocument()
  expect(button).toBeEnabled()
  fireEvent.change(screen.getByLabelText('视觉理解连接'), { target: { value: 'other-connection' } })
  expect(within(region).getByText(/此未保存选择未验证/)).toBeInTheDocument()
  expect(button).toBeDisabled()
  expect(api.probeCapabilities).toHaveBeenCalledTimes(1)
})

it('shows OAuth pending then authenticated but unverified, and exposes logout without a secret field', async () => {
  const { api } = setup()
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '保存连接' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('认证方式'), { target: { value: 'oauth' } })
  expect(screen.getByLabelText('API 地址')).toHaveValue('https://chatgpt.com/backend-api/codex')
  expect(screen.getByLabelText('账号标识')).toHaveValue('登录后自动识别')
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '登录当前 ChatGPT 账号' })).toBeEnabled())
  const saved = (await api.read()).connections[0]!
  const connected = { ...saved, connection: { ...saved.connection, revision: 2, accountId: 'actual-account' }, hasCredential: true }
  vi.mocked(api.oauthLoginStatus).mockResolvedValue({ loginId: 'login', status: 'connected', connection: connected })
  const state = await api.read(); vi.mocked(api.read).mockResolvedValue({ ...state, connections: [connected] })
  fireEvent.click(screen.getByRole('button', { name: '登录当前 ChatGPT 账号' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('等待浏览器'))
  expect(screen.getByRole('button', { name: '取消 ChatGPT 登录' })).toBeEnabled()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('模型与图片能力尚未验证'))
  expect(screen.getByLabelText('账号标识')).toHaveValue('actual-account')
  expect(screen.getByRole('button', { name: '退出 ChatGPT 连接' })).toBeEnabled()
  expect(screen.queryByLabelText('API Key')).toBeNull()
})

it('selects an existing unconnected OAuth account on the direct login entry and preserves model roles', async () => {
  const { api, state } = setup()
  state.connections = [{ connection: { id: 'oauth-existing', revision: 3, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
    accountId: 'existing-account', auth: { kind: 'oauth', credentialRef: 'private-reference' }, billing: { kind: 'subscription' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, hasCredential: false, revoked: false }]
  render(<ExecutionSettingsPanel open entry="chatgpt-oauth" api={api} onClose={vi.fn()} />)
  const login = await screen.findByRole('button', { name: '登录 ChatGPT' })
  await waitFor(() => expect(login).toBeEnabled())
  expect(screen.queryByLabelText('供应商标识')).toBeNull()
  fireEvent.click(login)
  await waitFor(() => expect(api.startOAuthLogin).toHaveBeenCalledWith('oauth-existing', 3))
  expect(api.saveConnection).not.toHaveBeenCalled()
  expect(api.saveProfile).not.toHaveBeenCalled()
})

it('creates the OAuth connection and starts browser login with one click without assigning any model role', async () => {
  const { api } = setup()
  render(<ExecutionSettingsPanel open entry="chatgpt-oauth" api={api} onClose={vi.fn()} />)
  const login = await screen.findByRole('button', { name: '登录 ChatGPT' })
  await waitFor(() => expect(login).toBeEnabled())
  expect(screen.queryByRole('button', { name: '保存连接' })).toBeNull()
  fireEvent.click(login)
  await waitFor(() => expect(api.saveConnection).toHaveBeenCalledWith({ connection: {
    provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
    imageProtocol: null, accountId: 'pending-login', authKind: 'oauth', billing: { kind: 'subscription' },
  } }))
  await waitFor(() => expect(api.startOAuthLogin).toHaveBeenCalledWith('connection', 1))
  expect(api.saveProfile).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('等待浏览器')
})

it('shows missing/OAuth credentials honestly and does not dispatch malformed role parameters', async () => {
  const { api } = setup()
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '保存连接' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('供应商标识'), { target: { value: 'provider' } })
  fireEvent.change(screen.getByLabelText('账号标识'), { target: { value: 'account' } })
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'https://fixture.invalid/v1' } })
  fireEvent.change(screen.getByLabelText('认证方式'), { target: { value: 'oauth' } })
  expect(screen.queryByLabelText('API Key')).toBeNull()
  expect(screen.getByText(/尚未完成正式登录/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('尚未接通凭据'))
  expect(api.saveConnection).toHaveBeenCalledWith(expect.not.objectContaining({ apiKey: expect.anything() }))
  expect(screen.getByRole('button', { name: '读取模型目录' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('对话与规划连接'), { target: { value: 'connection' } })
  fireEvent.change(screen.getByLabelText('对话与规划模型'), { target: { value: 'model' } })
  fireEvent.change(screen.getByLabelText('对话与规划参数'), { target: { value: '{broken' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('JSON 对象'))
  expect(api.saveProfile).not.toHaveBeenCalled()
})

function imageSettings(state: ExecutionSettingsView) {
  const shared = { revision: 1, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } as const, billing: { kind: 'subscription' } as const }
  state.connections = [
    { connection: { ...shared, id: 'oauth', provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'image-account', auth: { kind: 'oauth', credentialRef: 'private-reference' } }, hasCredential: false, revoked: false },
    { connection: { ...shared, id: 'text-api', provider: 'text-provider', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'text-account', auth: { kind: 'api-key', credentialRef: 'private-reference' } }, hasCredential: true, revoked: false },
  ]
}

it('uses one direct Images model for both OAuth roles and rejects silently ignored role parameters', async () => {
  const { api, state } = setup(); imageSettings(state)
  state.profile.roles.imageGenerate = { connectionId: 'oauth', model: 'chosen-image-generator', parameters: { executorModel: 'chosen-responses-generator', output: { quality: 'high', format: 'png' }, custom: [1, true] } }
  state.profile.roles.imageEdit = { connectionId: 'oauth', model: 'chosen-image-editor', parameters: { executorModel: 'chosen-responses-editor', output: { background: 'transparent' } } }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByLabelText('图片生成图片模型')).toHaveValue('chosen-image-generator'))
  expect(screen.getByLabelText('图片编辑图片模型')).toHaveValue('chosen-image-editor')
  expect(screen.queryByLabelText('图片生成执行模型')).toBeNull()
  expect(JSON.parse((screen.getByLabelText('图片生成参数') as HTMLTextAreaElement).value)).toEqual({ executorModel: 'chosen-responses-generator', output: { quality: 'high', format: 'png' }, custom: [1, true] })
  const region = within(screen.getByRole('region', { name: '图片生成配置' }))
  expect(region.getByText(/此连接尚未接通凭据/)).toHaveTextContent('此设置页没有图片生成能力的独立验证记录')
  expect(within(screen.getByLabelText('图片生成连接')).queryByRole('option', { name: /text-provider/ })).toBeNull()
  expect(within(screen.getByLabelText('对话与规划连接')).getByRole('option', { name: /text-provider/ })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('图片生成图片模型'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('需要选择图片模型'))
  expect(api.saveProfile).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('图片生成图片模型'), { target: { value: 'chosen-image-generator' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('不支持角色级模型参数'))
  expect(api.saveProfile).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('图片生成参数'), { target: { value: '{}' } })
  fireEvent.change(screen.getByLabelText('图片编辑参数'), { target: { value: '{}' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: null, vision: null,
    imageGenerate: { connectionId: 'oauth', model: 'chosen-image-generator', parameters: {} },
    imageEdit: { connectionId: 'oauth', model: 'chosen-image-editor', parameters: {} },
  } }))
  expect(api.startOAuthLogin).not.toHaveBeenCalled()
  expect(api.discoverModels).not.toHaveBeenCalled()
})

it('retains unsupported stored image selections visibly, refuses saving them and never supplies default model IDs', async () => {
  const { api, state } = setup(); imageSettings(state)
  state.profile.roles.imageGenerate = { connectionId: 'text-api', model: 'previous-image-id', parameters: { executorModel: 'previous-executor-id' } }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByLabelText('图片生成图片模型')).toHaveValue('previous-image-id'))
  expect(within(screen.getByLabelText('图片生成连接')).getByRole('option', { name: /当前图片路径不支持/ })).toBeDisabled()
  expect(screen.getByLabelText('图片编辑图片模型')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('需要已显式启用 OpenAI Images API'))
  expect(api.saveProfile).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('图片生成连接'), { target: { value: 'oauth' } })
  fireEvent.change(screen.getByLabelText('图片生成图片模型'), { target: { value: 'gpt-image-2' } })
  fireEvent.change(screen.getByLabelText('图片生成参数'), { target: { value: '{"executorModel":"ambiguous-second-value"}' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('不支持角色级模型参数'))
  expect(api.saveProfile).not.toHaveBeenCalled()
})

it('lets a signed-in user point-select one image service without touching conversation or vision', async () => {
  const { api, state } = setup(); imageSettings(state)
  state.connections[0]!.hasCredential = true
  state.profile.roles.conversation = { connectionId: 'text-api', model: 'text-model', parameters: { reasoning_effort: 'high' } }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  const imageService = screen.getByText(/^可选：图片服务/).closest('details')!
  expect(imageService).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText(/^可选：图片服务/))
  expect(imageService).toHaveAttribute('open')
  const account = await screen.findByLabelText('图片账号')
  expect(within(account).getByRole('option', { name: /image-account.*订阅/ })).toBeInTheDocument()
  fireEvent.change(account, { target: { value: 'oauth' } })
  fireEvent.change(screen.getByLabelText('图片模型'), { target: { value: 'gpt-image-2' } })
  expect(screen.getByText(/请求路径：openai · image-account · 订阅/)).toBeInTheDocument()
  expect(api.saveProfile).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存图片服务' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: { connectionId: 'text-api', model: 'text-model', parameters: { reasoning_effort: 'high' } },
    vision: null,
    imageGenerate: { connectionId: 'oauth', model: 'gpt-image-2', parameters: {} },
    imageEdit: { connectionId: 'oauth', model: 'gpt-image-2', parameters: {} },
  } }))
  expect(screen.getByRole('status')).toHaveTextContent('实际图片能力与费用仍需请求结果确认')
})

it('offers a connected TeamoRouter image route with metered billing without changing OAuth login choices', async () => {
  const { api, state } = setup(); imageSettings(state)
  state.connections[0]!.hasCredential = true
  state.connections.push({ connection: { id: 'teamo-images', revision: 1, provider: 'teamorouter', protocol: 'openai-chat',
    imageProtocol: 'openai-images', baseURL: 'https://api.teamorouter.com/v1', accountId: 'teamo-account',
    auth: { kind: 'api-key', credentialRef: 'teamo-private-reference' }, billing: { kind: 'metered' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, hasCredential: true, revoked: false })
  state.profile.roles.conversation = { connectionId: 'text-api', model: 'text-model' }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await screen.findByLabelText('图片账号')
  const account = screen.getByLabelText('图片账号')
  expect(within(account).getByRole('option', { name: /teamorouter.*teamo-account.*按量付费/ })).toBeInTheDocument()
  fireEvent.change(account, { target: { value: 'teamo-images' } })
  fireEvent.change(screen.getByLabelText('自定义图片模型 ID'), { target: { value: 'gpt-image-2' } })
  expect(screen.getByText(/请求路径：teamorouter · teamo-account · 按量付费/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存图片服务' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: { connectionId: 'text-api', model: 'text-model' }, vision: null,
    imageGenerate: { connectionId: 'teamo-images', model: 'gpt-image-2', parameters: {} },
    imageEdit: { connectionId: 'teamo-images', model: 'gpt-image-2', parameters: {} },
  } }))
  expect(api.startOAuthLogin).not.toHaveBeenCalled()
})

it('explicitly enables Images API for a custom HTTPS root and shows the exact request destination', async () => {
  const { api } = setup()
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '保存连接' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('供应商标识'), { target: { value: 'other-provider' } })
  fireEvent.change(screen.getByLabelText('账号标识'), { target: { value: 'custom-account' } })
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'https://images.example.test/tenant/openai' } })
  fireEvent.change(screen.getByLabelText('计费来源'), { target: { value: 'prepaid' } })
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'fixture-key' } })
  fireEvent.click(screen.getByLabelText('启用 OpenAI Images API'))
  expect(screen.getByText(/https:\/\/images.example.test\/tenant\/openai\/images\/generations/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }))
  await waitFor(() => expect(api.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ connection: expect.objectContaining({
    provider: 'other-provider', baseURL: 'https://images.example.test/tenant/openai', imageProtocol: 'openai-images',
    billing: { kind: 'prepaid' },
  }) })))
})

it('keeps TeamoRouter API keys out of the ChatGPT login account picker', async () => {
  const { api, state } = setup(); imageSettings(state)
  state.connections.push({ connection: { id: 'teamo-images', revision: 1, provider: 'teamorouter', protocol: 'openai-chat',
    baseURL: 'https://api.teamorouter.com/v1', accountId: 'teamo-account',
    auth: { kind: 'api-key', credentialRef: 'teamo-private-reference' }, billing: { kind: 'metered' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, hasCredential: true, revoked: false })
  render(<ExecutionSettingsPanel open entry="chatgpt-oauth" api={api} onClose={vi.fn()} />)
  const login = await screen.findByRole('button', { name: '登录 ChatGPT' })
  expect(screen.queryByLabelText('ChatGPT 账号')).toBeNull()
  fireEvent.click(login)
  await waitFor(() => expect(api.startOAuthLogin).toHaveBeenCalledWith('oauth', 1))
})

it('retains different existing image routes until explicit unification', async () => {
  const { api, state } = setup(); imageSettings(state)
  state.connections[0]!.hasCredential = true
  state.profile.roles.imageGenerate = { connectionId: 'oauth', model: 'existing-generate', parameters: {} }
  state.profile.roles.imageEdit = { connectionId: 'oauth', model: 'existing-edit', parameters: {} }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/^可选：图片服务/)).toHaveTextContent('生成与编辑分别配置'))
  fireEvent.click(screen.getByText(/^可选：图片服务/))
  const account = await screen.findByLabelText('图片账号')
  expect(screen.getByText(/分别使用不同配置/)).toBeInTheDocument()
  fireEvent.change(account, { target: { value: 'oauth' } })
  fireEvent.change(screen.getByLabelText('图片模型'), { target: { value: 'gpt-image-2' } })
  expect(screen.getByRole('button', { name: '保存图片服务' })).toBeDisabled()
  expect(api.saveProfile).not.toHaveBeenCalled()
  fireEvent.click(screen.getByLabelText(/确认将图片生成和编辑统一/))
  fireEvent.click(screen.getByRole('button', { name: '保存图片服务' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledOnce())
})

it('point-selects catalog models per role and clears the model when the billing connection changes', async () => {
  const { api, state } = setup()
  const connection = (id: string, provider: string, billing: 'metered' | 'token-plan' | 'subscription') => ({
    connection: { id, revision: 1, provider, protocol: provider === 'openai' ? 'chatgpt-responses' as const : 'openai-chat' as const,
      baseURL: provider === 'openai' ? 'https://chatgpt.com/backend-api/codex' : `https://${provider}.invalid/v1`,
      accountId: `${id}-account`, auth: { kind: provider === 'openai' ? 'oauth' as const : 'api-key' as const, credentialRef: 'private-reference' },
      billing: { kind: billing }, capabilities: { tools: 'unknown' as const, vision: 'unknown' as const, stream: 'unknown' as const, reasoning: 'unknown' as const } },
    hasCredential: true, revoked: false,
  })
  state.connections = [connection('api-a', 'first', 'metered'), connection('api-b', 'second', 'token-plan'), connection('oauth', 'openai', 'subscription')]
  vi.mocked(api.discoverModels).mockImplementation(async id => ({ connectionId: id, connectionRevision: 1,
    models: [{ id: id === 'api-a' ? 'alpha' : id === 'api-b' ? 'beta' : 'gpt-6-luna' }],
    capabilitiesVerified: false, source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' }))
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await screen.findByLabelText('视觉理解连接')
  fireEvent.change(screen.getByLabelText('视觉理解连接'), { target: { value: 'api-a' } })
  await waitFor(() => expect(within(screen.getByLabelText('视觉理解模型')).getByRole('option', { name: /alpha/ })).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('视觉理解模型'), { target: { value: 'alpha' } })
  expect(screen.getByLabelText('视觉理解模型')).toHaveValue('alpha')
  fireEvent.change(screen.getByLabelText('视觉理解连接'), { target: { value: 'api-b' } })
  expect(screen.getByLabelText('视觉理解模型')).toHaveValue('')
  await waitFor(() => expect(within(screen.getByLabelText('视觉理解模型')).getByRole('option', { name: /beta/ })).toBeInTheDocument())
  expect(within(screen.getByLabelText('视觉理解模型')).queryByRole('option', { name: /alpha/ })).toBeNull()
  fireEvent.change(screen.getByLabelText('视觉理解模型'), { target: { value: 'beta' } })
  fireEvent.change(screen.getByLabelText('图片生成连接'), { target: { value: 'oauth' } })
  expect(within(screen.getByLabelText('图片生成图片模型')).getByRole('option', { name: /gpt-image-2.*项目候选/ })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('图片生成图片模型'), { target: { value: 'gpt-image-2' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: null, vision: { connectionId: 'api-b', model: 'beta', parameters: {} },
    imageGenerate: { connectionId: 'oauth', model: 'gpt-image-2', parameters: {} }, imageEdit: null,
  } }))
  expect(screen.getByLabelText('视觉理解配置')).toHaveTextContent('second · api-b-account · Token Plan')
})

it('shows a manual model ID only as an explicit fallback when the chosen directory fails', async () => {
  const { api, state } = setup()
  state.connections = [{ connection: { id: 'custom', revision: 1, provider: 'custom', protocol: 'openai-chat',
    baseURL: 'https://custom.invalid/v1', accountId: 'account', auth: { kind: 'api-key', credentialRef: 'private-reference' },
    billing: { kind: 'metered' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } },
    hasCredential: true, revoked: false }]
  vi.mocked(api.discoverModels).mockRejectedValue(new Error('directory unavailable'))
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await screen.findByLabelText('对话与规划连接')
  fireEvent.change(screen.getByLabelText('对话与规划连接'), { target: { value: 'custom' } })
  await screen.findByText(/目录暂不可用，模型能力仍未验证/)
  fireEvent.click(screen.getByText('目录不可用或无候选时手动指定模型 ID'))
  fireEvent.change(screen.getByLabelText('自定义对话与规划模型'), { target: { value: 'vendor-model-id' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: { connectionId: 'custom', model: 'vendor-model-id', parameters: {} },
    vision: null, imageGenerate: null, imageEdit: null,
  } }))
})
