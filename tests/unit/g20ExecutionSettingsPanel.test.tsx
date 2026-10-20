import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionSettingsPanel } from '../../src/renderer/workbench/ExecutionSettingsPanel'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import type { ExecutionConnectionView, ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
import type { ModelCapabilityRecord, ProbedModelCapability } from '../../src/shared/workbench/modelCapabilities'
import { modelCapabilityIdentity } from '../../src/shared/workbench/modelCapabilities'

afterEach(cleanup)
const connected = (id: string, revision = 1): ExecutionConnectionView => ({
  connection: { id, revision, provider: id, protocol: 'openai-chat', baseURL: `https://${id}.invalid/v1`, accountId: `${id}-account`,
    auth: { kind: 'api-key', credentialRef: 'private-reference' }, billing: { kind: 'token-plan' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } },
  hasCredential: true, revoked: false,
})
const recorded = (connectionId: string, connectionRevision: number, model: string, capability: ProbedModelCapability,
  status: 'supported' | 'unknown', parametersKey = '{"protocol":"openai-chat","parameters":{}}'): ModelCapabilityRecord => ({
  connectionId, connectionRevision, model, parametersKey,
  facts: status === 'supported' ? { [capability]: { status, observedAt: 1, source: 'probe' } } : {},
  lastProbe: { observedAt: 1, checks: [capability], requestCount: 1,
    outcomes: [{ capability, status, code: status, message: status === 'supported' ? '已观察' : '暂未证实' }] },
})
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
    setModelFavorite: vi.fn(async () => []),
    knownModels: vi.fn(async () => []),
    revokeConnection: vi.fn(async () => { state.connections[0]!.hasCredential = false; state.connections[0]!.revoked = true }),
    discoverModels: vi.fn(async () => ({ connectionId: 'connection', connectionRevision: 1, models: [{ id: 'available-model' }], capabilitiesVerified: false as const, source: 'live' as const, checkedAt: '2026-09-25T00:00:00.000Z' })),
    probeCapabilities: vi.fn(async (input: Parameters<ExecutionSettingsAPI['probeCapabilities']>[0]) => {
      const selected = state.profile.roles[input.role]!
      const record = { ...modelCapabilityIdentity({ connection: state.connections.find(entry => entry.connection.id === selected.connectionId)!.connection,
        model: selected.model, parameters: selected.parameters, capabilityModel: selected.capabilityModel }), facts: { [input.checks[0]]: { status: 'supported' as const, observedAt: 100, source: 'probe' as const, actualModel: 'actual-model' } },
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

it('D1 exposes default child capacity and saves a bounded new-task setting independently of model drafts', async () => {
  const { api, state } = setup()
  state.connections = [connected('connection')]
  vi.mocked(api.saveProfile).mockImplementation(async input => {
    state.profile = { ...state.profile, revision: state.profile.revision + 1, roles: input.roles, nativeConcurrencyLimit: input.nativeConcurrencyLimit }
    return structuredClone(state.profile)
  })
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  const capacity = await screen.findByLabelText('子任务并发上限')
  await waitFor(() => expect(capacity).toBeEnabled())
  expect(capacity).toHaveValue(10)
  fireEvent.change(screen.getByLabelText('主力模型连接'), { target: { value: 'connection' } })
  fireEvent.change(capacity, { target: { value: '33' } })
  fireEvent.click(screen.getByRole('button', { name: '保存子任务设置' }))
  await screen.findByRole('alert')
  expect(api.saveProfile).not.toHaveBeenCalled()
  fireEvent.change(capacity, { target: { value: '16' } })
  fireEvent.click(screen.getByRole('button', { name: '保存子任务设置' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0,
    nativeConcurrencyLimit: 16, roles: { conversation: null, vision: null, imageGenerate: null, imageEdit: null } }))
  expect(screen.getByRole('status')).toHaveTextContent('新任务生效')
  expect(screen.getByLabelText('主力模型连接')).toHaveValue('connection')
})

it('R01 model routing converts output cap keys without deleting the selected cap or unrelated parameters', async () => {
  const { api, state } = setup(), entry = connected('relay')
  entry.connection.baseURL = 'https://api.teamorouter.com/v1'
  state.connections = [entry]
  state.profile.roles.conversation = { connectionId: 'relay', model: 'deepseek-flash', parameters: { max_tokens: 1200, reasoning_effort: 'high', temperature: 0.6 } }
  vi.mocked(api.discoverModels).mockResolvedValue({ connectionId: 'relay', connectionRevision: 1, models: [{ id: 'deepseek-flash' }, { id: 'gpt-6.1-sol' }, { id: 'claude-fixture' }], capabilitiesVerified: false, source: 'live', checkedAt: '2026-10-12T00:00:00.000Z' })
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await screen.findByRole('option', { name: /gpt-6.1-sol/ })
  fireEvent.change(screen.getByLabelText('主力模型'), { target: { value: 'gpt-6.1-sol' } })
  expect(JSON.parse((screen.getByLabelText('主力模型参数') as HTMLTextAreaElement).value)).toEqual({ max_output_tokens: 1200, temperature: 0.6 })
  fireEvent.change(screen.getByLabelText('主力模型'), { target: { value: 'claude-fixture' } })
  expect(JSON.parse((screen.getByLabelText('主力模型参数') as HTMLTextAreaElement).value)).toEqual({ max_tokens: 1200, temperature: 0.6 })
})

it('NI05 exposes optional compression in existing model settings and saves only an explicit selection', async () => {
  const { api, state } = setup()
  state.connections = [connected('connection')]
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  const region = await screen.findByRole('region', { name: '上下文压缩配置' })
  expect(within(region).getByText(/未配置时使用当前任务的主模型/)).toBeInTheDocument()
  fireEvent.change(within(region).getByLabelText('上下文压缩连接'), { target: { value: 'connection' } })
  await waitFor(() => expect(within(region).getByRole('option', { name: /available-model/ })).toBeInTheDocument())
  fireEvent.change(within(region).getByLabelText('上下文压缩模型'), { target: { value: 'available-model' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: null, vision: null, imageGenerate: null, imageEdit: null,
    compression: { connectionId: 'connection', model: 'available-model', parameters: {} },
  } }))
  expect(api.probeCapabilities).not.toHaveBeenCalled()
})

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
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('连接设置已保存'))
  expect(screen.getByLabelText('API Key')).toHaveValue('')
  expect(api.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'fixture-key', connection: expect.objectContaining({ billing: { kind: 'token-plan' } }) }))
  expect(api.discoverModels).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('主力模型连接'), { target: { value: 'connection' } })
  await waitFor(() => expect(within(screen.getByLabelText('主力模型')).getByRole('option', { name: /available-model/ })).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('主力模型'), { target: { value: 'available-model' } })
  fireEvent.change(screen.getByLabelText('主力模型参数'), { target: { value: '{"reasoning_effort":"high"}' } })
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
  const state = await api.read()
  const selection = (model: string) => ({ connectionId: connected.connection.id, model })
  vi.mocked(api.read).mockResolvedValue({ ...state, connections: [connected], profile: {
    ...state.profile, revision: 1, roles: { conversation: selection('gpt-6-sol'), vision: selection('gpt-6-sol'),
      compression: selection('gpt-6-luna'), imageGenerate: selection('gpt-image-2'), imageEdit: selection('gpt-image-2') },
  } })
  fireEvent.click(screen.getByRole('button', { name: '登录当前 ChatGPT 账号' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('等待浏览器'))
  expect(screen.getByRole('button', { name: '取消 ChatGPT 登录' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('视觉理解参数'), { target: { value: '{"temperature":0.7}' } })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('未配置的模型角色已按推荐设置'))
  expect(screen.getByLabelText('视觉理解参数')).toHaveValue('{"temperature":0.7}')
  expect(screen.getByLabelText('视觉理解连接')).toHaveValue('')
  expect(screen.getByLabelText('主力模型配置')).toHaveTextContent('gpt-6-sol')
  expect(screen.getByLabelText('上下文压缩配置')).toHaveTextContent('gpt-6-luna')
  expect(screen.getByLabelText('图片模型')).toHaveValue('gpt-image-2')
  expect(screen.getByLabelText('账号标识')).toHaveValue('actual-account')
  expect(screen.getByRole('button', { name: '退出 ChatGPT 连接' })).toBeEnabled()
  expect(screen.queryByLabelText('API Key')).toBeNull()
})

it('keeps login and surfaces the specific directory failure instead of a blank model list', async () => {
  const { api, state } = setup()
  const connection = { id: 'oauth-existing', revision: 1, provider: 'openai', protocol: 'chatgpt-responses' as const,
    baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'actual-account',
    auth: { kind: 'oauth' as const, credentialRef: 'private-reference' }, billing: { kind: 'subscription' as const },
    capabilities: { tools: 'unknown' as const, vision: 'unknown' as const, stream: 'unknown' as const, reasoning: 'unknown' as const } }
  state.connections = [{ connection, hasCredential: false, revoked: false }]
  render(<ExecutionSettingsPanel open entry="chatgpt-oauth" api={api} onClose={vi.fn()} />)
  const login = await screen.findByRole('button', { name: '登录 ChatGPT' })
  await waitFor(() => expect(login).toBeEnabled())
  const connected = { connection, hasCredential: true, revoked: false }
  vi.mocked(api.oauthLoginStatus).mockResolvedValue({ loginId: 'login', status: 'connected', connection: connected,
    modelDirectoryError: '模型目录请求返回 HTTP 403；未切换连接。' })
  vi.mocked(api.read).mockResolvedValue({ ...state, connections: [connected] })
  fireEvent.click(login)
  await screen.findByText(/ChatGPT 已登录。模型目录请求返回 HTTP 403/)
  expect(screen.getByRole('button', { name: '重新登录 ChatGPT' })).toBeEnabled()
  expect(api.saveProfile).not.toHaveBeenCalled()
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
  fireEvent.change(screen.getByLabelText('主力模型连接'), { target: { value: 'connection' } })
  fireEvent.change(screen.getByLabelText('主力模型'), { target: { value: 'model' } })
  fireEvent.change(screen.getByLabelText('主力模型参数'), { target: { value: '{broken' } })
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

it('shows main, compression and unified image choices first while connection details and Pixabay stay collapsed', async () => {
  const { api, state } = setup(); imageSettings(state)
  state.connections[0]!.hasCredential = true
  state.profile.roles = { conversation: { connectionId: 'oauth', model: 'gpt-6-sol' },
    compression: { connectionId: 'oauth', model: 'gpt-6-luna' }, vision: null,
    imageGenerate: { connectionId: 'oauth', model: 'gpt-image-2' }, imageEdit: { connectionId: 'oauth', model: 'gpt-image-2' } }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByLabelText('主力模型')).toHaveValue('gpt-6-sol'))
  const primary = screen.getByRole('group', { name: '默认模型配置' })
  const sections = within(primary).getAllByRole('region')
  expect(sections.map(section => section.getAttribute('aria-label'))).toEqual(['主力模型配置', '上下文压缩配置', '图片服务配置'])
  for (const section of sections) expect(section).toBeVisible()
  expect(within(primary).getByLabelText('上下文压缩模型')).toHaveValue('gpt-6-luna')
  expect(within(primary).getByLabelText('图片模型')).toHaveValue('gpt-image-2')
  expect(screen.getByRole('heading', { name: '模型与连接' })).toBeVisible()
  expect(screen.getByRole('button', { name: '重新登录 ChatGPT' })).toBeVisible()
  expect(screen.getByText(/已登录 ChatGPT：image-account · 订阅/)).toBeVisible()
  expect(screen.getByText('连接详情').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('可选：Pixabay 图库').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByLabelText('选择连接')).toHaveValue('oauth')
  expect(screen.queryByText('此连接尚未接通凭据。')).toBeNull()
  expect(api.saveConnection).not.toHaveBeenCalled()
  expect(api.saveProfile).not.toHaveBeenCalled()
  expect(api.probeCapabilities).not.toHaveBeenCalled()
})

it('retries a concrete model directory error without discarding saved or unsaved model choices', async () => {
  const { api, state } = setup()
  state.connections = [connected('connection')]
  state.profile.roles.conversation = { connectionId: 'connection', model: 'saved-model' }
  vi.mocked(api.discoverModels).mockRejectedValueOnce(new Error('模型目录返回 HTTP 403，请检查连接权限。'))
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  const main = await screen.findByRole('region', { name: '主力模型配置' })
  await within(main).findByText('模型目录返回 HTTP 403，请检查连接权限。')
  fireEvent.click(within(main).getByText('手动指定准确模型 ID'))
  fireEvent.change(within(main).getByLabelText('自定义主力模型'), { target: { value: 'manual-draft-model' } })
  fireEvent.click(within(main).getByRole('button', { name: '重试主力模型目录' }))
  await waitFor(() => expect(within(main).getByRole('option', { name: 'available-model' })).toBeInTheDocument())
  expect(within(main).getByLabelText('主力模型')).toHaveValue('manual-draft-model')
  expect(within(main).queryByText('模型目录返回 HTTP 403，请检查连接权限。')).toBeNull()
  expect(api.discoverModels).toHaveBeenCalledTimes(2)
  expect(api.saveProfile).not.toHaveBeenCalled()
  expect(state.profile.roles.conversation?.model).toBe('saved-model')
})

it('offers one-click ChatGPT login from default settings while editing an existing API connection', async () => {
  const { api, state } = setup(); imageSettings(state)
  state.profile.roles.conversation = { connectionId: 'text-api', model: 'text-model' }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  const login = await screen.findByRole('button', { name: '登录 ChatGPT' })
  await waitFor(() => expect(login).toBeEnabled())
  expect(screen.getByLabelText('选择连接')).toHaveValue('text-api')
  fireEvent.click(login)
  await waitFor(() => expect(api.startOAuthLogin).toHaveBeenCalledWith('oauth', 1))
  expect(api.saveConnection).not.toHaveBeenCalled()
  expect(api.saveProfile).not.toHaveBeenCalled()
  expect(screen.getByLabelText('选择连接')).toHaveValue('text-api')
})

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
  expect(within(screen.getByLabelText('主力模型连接')).getByRole('option', { name: /text-provider/ })).toBeInTheDocument()
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
  expect(screen.getByRole('region', { name: '图片服务配置' })).toBeVisible()
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
  await waitFor(() => expect(screen.getByRole('heading', { name: /^图片模型/ })).toHaveTextContent('生成与编辑分别配置'))
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
  expect(within(screen.getByLabelText('图片生成图片模型')).getByRole('option', { name: 'gpt-image-2' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('图片生成图片模型'), { target: { value: 'gpt-image-2' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: null, vision: { connectionId: 'api-b', model: 'beta', parameters: {} },
    imageGenerate: { connectionId: 'oauth', model: 'gpt-image-2', parameters: {} }, imageEdit: null,
  } }))
  expect(screen.getByLabelText('视觉理解配置')).toHaveTextContent('second · api-b-account · Token Plan')
})

it('accepts an accurate manual model ID when the chosen directory fails', async () => {
  const { api, state } = setup()
  state.connections = [{ connection: { id: 'custom', revision: 1, provider: 'custom', protocol: 'openai-chat',
    baseURL: 'https://custom.invalid/v1', accountId: 'account', auth: { kind: 'api-key', credentialRef: 'private-reference' },
    billing: { kind: 'metered' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } },
    hasCredential: true, revoked: false }]
  vi.mocked(api.discoverModels).mockRejectedValue(new Error('directory unavailable'))
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await screen.findByLabelText('主力模型连接')
  fireEvent.change(screen.getByLabelText('主力模型连接'), { target: { value: 'custom' } })
  await screen.findByText(/directory unavailable/)
  fireEvent.click(screen.getByText('手动指定准确模型 ID'))
  fireEvent.change(screen.getByLabelText('自定义主力模型'), { target: { value: 'vendor-model-id' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: { connectionId: 'custom', model: 'vendor-model-id', parameters: {} },
    vision: null, imageGenerate: null, imageEdit: null,
  } }))
})

it('allows a catalog model without favorites or capability probes and preserves advanced saved roles', async () => {
  const { api, state } = setup()
  state.connections = [connected('connection')]
  const vision = { connectionId: 'connection', model: 'manual-vision', parameters: { detail: 'high' } }
  state.profile.roles.vision = vision
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('主力模型连接'), { target: { value: 'connection' } })
  await waitFor(() => expect(within(screen.getByLabelText('主力模型')).getByRole('option', { name: 'available-model' })).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('主力模型'), { target: { value: 'available-model' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ roles: expect.objectContaining({ conversation: { connectionId: 'connection', model: 'available-model', parameters: {} }, vision }) })))
  expect(api.probeCapabilities).not.toHaveBeenCalled()
  expect(api.setModelFavorite).not.toHaveBeenCalled()
})

it('keeps advanced vision collapsed and leaves existing roles unchanged when merely opening settings', async () => {
  const { api, state } = setup()
  state.connections = [connected('connection')]
  state.profile.roles.vision = { connectionId: 'connection', model: 'manual-vision' }
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await screen.findByLabelText('主力模型连接')
  const advanced = screen.getByText('高级：视觉理解').closest('details')
  expect(advanced).not.toHaveAttribute('open')
  expect(screen.queryByRole('region', { name: '已验证角色预设' })).toBeNull()
  expect(api.saveProfile).not.toHaveBeenCalled()
  expect(api.probeCapabilities).not.toHaveBeenCalled()
})

it('saves a capability reference and native effort without JSON while preserving the actual model and other roles', async () => {
  const { api, state } = setup()
  const route = connected('router')
  route.connection.baseURL = 'https://api.teamorouter.com/v1'
  route.connection.billing.kind = 'metered'
  state.connections = [route]
  const vision = { connectionId: 'router', model: 'vision-original', parameters: { detail: 'high' } }
  state.profile.roles = { conversation: { connectionId: 'router', model: 'private-alias', capabilityModel: 'anthropic/claude-haiku-4-5', parameters: { temperature: 0.4, thinking: { type: 'enabled', budget_tokens: 12000 } } }, vision, imageGenerate: null, imageEdit: null }
  vi.mocked(api.knownModels).mockResolvedValue([{ id: 'claude-haiku-4-5', provider: 'anthropic', reasoning: { kind: 'budget' } },
    { id: 'claude-opus-4-6', provider: 'anthropic', reasoning: { kind: 'effort', efforts: ['low', 'high', 'max'] } }])
  render(<ExecutionSettingsPanel open api={api} onClose={vi.fn()} />)
  await screen.findByLabelText('主力模型参考型号')
  await waitFor(() => expect(screen.getByLabelText('思考 token 数')).toHaveValue(12000))
  fireEvent.change(screen.getByLabelText('主力模型参考型号'), { target: { value: 'anthropic/claude-opus-4-6' } })
  const controls = screen.getByRole('group', { name: '主力模型思考设置' })
  fireEvent.click(within(controls).getByRole('button', { name: '高' }))
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ expectedRevision: 0, roles: {
    conversation: { connectionId: 'router', model: 'private-alias', capabilityModel: 'anthropic/claude-opus-4-6', parameters: { temperature: 0.4, thinking: { type: 'adaptive' }, output_config: { effort: 'high' } } },
    vision, imageGenerate: null, imageEdit: null,
  } }))
  expect(api.probeCapabilities).not.toHaveBeenCalled()
})
