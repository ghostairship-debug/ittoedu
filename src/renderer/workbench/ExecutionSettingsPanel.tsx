import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { ExecutionConnectionView, ExecutionProfile, ExecutionRole, ExecutionRoleSelection, ExecutionSettingsView } from '../../shared/workbench/executionSettings'
import { executionRoles } from '../../shared/workbench/executionSettings'
import { executionSettingsConnectionSchema, executionSettingsRolesSchema, type DiscoveredModels, type DiscoveredReasoningEffort, type ExecutionSettingsAPI, type SaveExecutionConnectionDesktop } from '../../shared/workbench/executionSettingsDesktop'
import { findModelKnowledgeReference, type ModelKnowledgeEntry } from '../../shared/workbench/modelKnowledge'
import type { ModelJsonObject } from '../../shared/workbench/modelProvider'
import { resolveModelProtocol } from '../../shared/workbench/modelRouting'
import { normalizeModelOutputParameters } from '../../shared/workbench/modelOutputParameters'
import { readModelReasoningEffort, resolveModelReasoning, withModelReasoning, withoutManagedModelReasoning, type ResolvedModelReasoning } from '../../shared/workbench/modelReasoning'
import { ModelThinkingBudgetControl } from './ModelThinkingBudgetControl'
import { ModelReferencePicker } from './ModelReferencePicker'
import { SearchSettingsSection } from './SearchSettingsSection'
import { PixabaySettingsSection } from './PixabaySettingsSection'
import { modelCapabilityIdentity, modelCapabilityRecord, modelCapabilitySelection, type ProbedModelCapability } from '../../shared/workbench/modelCapabilities'
import { CHATGPT_IMAGE_MODEL_PREFERENCES, DEFAULT_CHATGPT_IMAGE_MODEL, openAIImagesEndpoint, supportsChatGPTOAuthImages, supportsOpenAIImages } from '../../shared/workbench/images'

export interface ExecutionSettingsPanelProps {
  open: boolean
  entry?: 'default' | 'chatgpt-oauth'
  onClose(): void
  api?: ExecutionSettingsAPI
  onSaved?(settings: ExecutionSettingsView): void
}
type ConnectionDraft = SaveExecutionConnectionDesktop['connection']
type RoleDraft = { connectionId: string; model: string; parameters: string; capabilityModel: string }
const knowledgeKey = (entry: ModelKnowledgeEntry) => entry.provider ? `${entry.provider}/${entry.id}` : entry.id
const effortLabels: Record<DiscoveredReasoningEffort, string> = { none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' }
const blankConnection = (): ConnectionDraft => ({ provider: '', protocol: 'openai-chat', imageProtocol: null, baseURL: '', accountId: '', authKind: 'api-key', billing: { kind: 'unknown' } })
const oauthConnection = (): ConnectionDraft => ({ provider: 'openai', protocol: 'chatgpt-responses', imageProtocol: null, baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'pending-login', authKind: 'oauth', billing: { kind: 'subscription' } })
const connectionPresets: { label: string; connection: ConnectionDraft }[] = [
  { label: 'TeamoRouter API', connection: { provider: 'teamorouter', protocol: 'openai-chat', imageProtocol: null, baseURL: 'https://api.teamorouter.com/v1', accountId: '默认账号', authKind: 'api-key', billing: { kind: 'metered' } } },
  { label: 'DeepSeek API', connection: { provider: 'deepseek', protocol: 'openai-chat', imageProtocol: null, baseURL: 'https://api.deepseek.com/v1', accountId: '默认账号', authKind: 'api-key', billing: { kind: 'metered' } } },
  { label: 'ChatGPT 登录', connection: oauthConnection() },
]
const roleLabels: Record<ExecutionRole, string> = { conversation: '主力模型', vision: '视觉理解', imageGenerate: '图片生成', imageEdit: '图片编辑', compression: '上下文压缩' }
const isImageRole = (role: ExecutionRole) => role === 'imageGenerate' || role === 'imageEdit'
const isOAuthImageConnection = (entry: ExecutionConnectionView) => supportsChatGPTOAuthImages(entry.connection)
const isApiImageConnection = (entry: ExecutionConnectionView) => supportsOpenAIImages(entry.connection)
const isImageConnection = (entry: ExecutionConnectionView) => isOAuthImageConnection(entry) || isApiImageConnection(entry)
const catalogKey = (entry: ExecutionConnectionView) => `${entry.connection.id}:${entry.connection.revision}`
const imageCatalogModel = (id: string) => /^gpt-image(?:-|$)/i.test(id)
const oauthImageProjectCandidates = new Set<string>(CHATGPT_IMAGE_MODEL_PREFERENCES)
const isOAuthImageProjectCandidate = (entry: ExecutionConnectionView | undefined, model: string) =>
  Boolean(entry && isOAuthImageConnection(entry) && oauthImageProjectCandidates.has(model))
const billingLabels: Record<ExecutionConnectionView['connection']['billing']['kind'], string> = {
  metered: '按量付费', 'token-plan': 'Token Plan', subscription: '订阅', prepaid: '预付费', unknown: '未知计费来源',
}
const roleDrafts = (profile?: ExecutionProfile): Record<ExecutionRole, RoleDraft> => Object.fromEntries(executionRoles.map(role => {
  const selection = profile?.roles[role]
  const parameters = { ...selection?.parameters }
  return [role, { connectionId: selection?.connectionId ?? '', model: selection?.model ?? '',
    parameters: JSON.stringify(parameters, null, 2), capabilityModel: selection?.capabilityModel ?? '' }]
})) as Record<ExecutionRole, RoleDraft>
const matchesSavedRole = (draft: RoleDraft, saved: NonNullable<ExecutionProfile['roles'][ExecutionRole]>, connection: ExecutionConnectionView): boolean => {
  if (draft.connectionId !== saved.connectionId || draft.model !== saved.model || draft.capabilityModel !== (saved.capabilityModel ?? '')) return false
  try {
    const parameters: unknown = JSON.parse(draft.parameters)
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return false
    const identity = { connection: connection.connection, model: saved.model, capabilityModel: saved.capabilityModel }
    return modelCapabilityIdentity({ ...identity, parameters: parameters as NonNullable<typeof saved.parameters> }).parametersKey
      === modelCapabilityIdentity({ ...identity, parameters: saved.parameters }).parametersKey
  } catch { return false }
}
type PresetRole = 'conversation' | 'vision'
const presetCapabilities = { conversation: 'tools', vision: 'vision' } as const
function verifiedRoleCandidates(settings: ExecutionSettingsView, entry: ExecutionConnectionView, role: PresetRole): ExecutionRoleSelection[] {
  if (!entry.hasCredential || entry.revoked) return []
  const candidates: ExecutionRoleSelection[] = []
  for (const record of settings.capabilityRecords ?? []) {
    if (record.connectionId !== entry.connection.id || record.connectionRevision !== entry.connection.revision
      || record.facts[presetCapabilities[role]]?.status !== 'supported') continue
    const selection = modelCapabilitySelection(record, entry.connection)
    if (selection) candidates.push({ connectionId: entry.connection.id, ...selection })
  }
  return candidates
}
const field: CSSProperties = { display: 'grid', gap: 5, minWidth: 0 }
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(250px,100%),1fr))', gap: 12 }

/** Only edits next-task settings. Saving a connection never claims that a model has been verified. */
export function ExecutionSettingsPanel({ open, entry = 'default', onClose, api: suppliedAPI, onSaved }: ExecutionSettingsPanelProps) {
  const api = suppliedAPI ?? window.desktopAPI?.executionSettings
  const dialog = useRef<HTMLElement>(null), generation = useRef(0)
  const [settings, setSettings] = useState<ExecutionSettingsView | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [connection, setConnection] = useState<ConnectionDraft>(blankConnection)
  const [apiKey, setApiKey] = useState('')
  const [roles, setRoles] = useState(roleDrafts)
  const [profileRevision, setProfileRevision] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [catalogs, setCatalogs] = useState<Record<string, DiscoveredModels>>({})
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({})
  const [modelKnowledge, setModelKnowledge] = useState<ModelKnowledgeEntry[]>([])
  const [knowledgeError, setKnowledgeError] = useState('')
  const catalogRequested = useRef(new Set<string>())
  const [imageConnectionId, setImageConnectionId] = useState('')
  const [imageModel, setImageModel] = useState('')
  const [confirmImageUnification, setConfirmImageUnification] = useState(false)
  const [loginId, setLoginId] = useState('')
  const loginRef = useRef('')
  const liveDrafts = useRef({ roles, profile: settings?.profile, imageConnectionId, imageModel })
  liveDrafts.current = { roles, profile: settings?.profile, imageConnectionId, imageModel }
  const selected = settings?.connections.find(entry => entry.connection.id === selectedId)
  const hasConnectionChanges = Boolean(selected && (apiKey || selected.connection.provider !== connection.provider
    || selected.connection.baseURL !== connection.baseURL || selected.connection.accountId !== connection.accountId
    || (selected.connection.imageProtocol ?? null) !== connection.imageProtocol
    || selected.connection.protocol !== connection.protocol || selected.connection.auth.kind !== connection.authKind || selected.connection.billing.kind !== connection.billing.kind))
  const choose = (entry?: ExecutionConnectionView) => {
    setSelectedId(entry?.connection.id ?? ''); setApiKey(''); setModels([]); setStatus(''); setError('')
    if (!entry) { setConnection(blankConnection()); return }
    const { provider, protocol, imageProtocol, baseURL, accountId, auth, billing } = entry.connection
    setConnection({ provider, protocol, imageProtocol: imageProtocol ?? null, baseURL, accountId, authKind: auth.kind, billing: { ...billing } })
  }
  useEffect(() => {
    const ticket = ++generation.current
    setApiKey(''); setError(''); setStatus(''); setModels([]); setCatalogs({}); setCatalogErrors({}); catalogRequested.current.clear()
    setImageConnectionId(''); setImageModel(''); setConfirmImageUnification(false)
    if (!open) return
    const priorFocus = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    setSettings(null); setSelectedId(''); setConnection(entry === 'chatgpt-oauth' ? oauthConnection() : blankConnection()); setRoles(roleDrafts())
    if (!api) { setError('当前环境没有模型连接设置服务。'); return }
    setKnowledgeError('')
    void api.knownModels().then(entries => {
      if (generation.current === ticket) setModelKnowledge([...new Map(entries.map(entry => [knowledgeKey(entry), entry])).values()])
    }).catch(() => { if (generation.current === ticket) setKnowledgeError('型号资料暂不可读取；已存参考型号仍保留。') })
    setBusy(true)
    void api.read().then(value => {
      if (generation.current !== ticket) return
      setSettings(value); setRoles(roleDrafts(value.profile)); setProfileRevision(value.profile.revision)
      const generate = value.profile.roles.imageGenerate, edit = value.profile.roles.imageEdit
      if (generate && edit && generate.connectionId === edit.connectionId && generate.model === edit.model) {
        setImageConnectionId(generate.connectionId); setImageModel(generate.model)
      }
      if (entry === 'chatgpt-oauth') {
        const existing = value.connections.find(item => isOAuthImageConnection(item) && !item.revoked && !item.hasCredential)
          ?? value.connections.find(item => isOAuthImageConnection(item) && !item.revoked)
        if (existing) choose(existing)
      } else {
        const existing = value.connections.find(item => item.connection.id === value.profile.roles.conversation?.connectionId && !item.revoked)
          ?? value.connections.find(item => item.hasCredential && !item.revoked)
          ?? value.connections.find(item => !item.revoked)
        if (existing) choose(existing)
      }
    }).catch(() => { if (generation.current === ticket) setError('连接设置暂不可读取，原配置未改变。') })
      .finally(() => { if (generation.current === ticket) setBusy(false) })
    return () => { ++generation.current; if (loginRef.current) void api.cancelOAuthLogin(loginRef.current).catch(() => undefined); loginRef.current = ''; setLoginId(''); priorFocus?.focus() }
  }, [open, api, entry])
  useEffect(() => {
    if (!open || !api || !loginId) return
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const result = await api.oauthLoginStatus(loginId)
        if (!active) return
        if (result.status === 'pending') { timer = setTimeout(() => { void poll() }, 1000); return }
        if (result.status === 'connected') {
          const value = await api.read(); if (!active) return
          const local = liveDrafts.current, baseline = roleDrafts(local.profile), recommended = roleDrafts(value.profile)
          for (const role of executionRoles) if (JSON.stringify(local.roles[role]) !== JSON.stringify(baseline[role]))
            recommended[role] = local.roles[role]
          setSettings(value); setRoles(recommended); setProfileRevision(value.profile.revision)
          const image = value.profile.roles.imageGenerate, previousImage = local.profile?.roles.imageGenerate
          if (image && local.imageConnectionId === (previousImage?.connectionId ?? '') && local.imageModel === (previousImage?.model ?? '')) {
            setImageConnectionId(image.connectionId); setImageModel(image.model)
          }
          onSaved?.(value); choose(result.connection)
          if (result.modelDirectoryError) setError(`ChatGPT 已登录。${result.modelDirectoryError}`)
          setStatus(result.modelDirectoryError ? '账号已登录，模型目录读取失败，可重试目录。'
            : 'ChatGPT 已登录，未配置的模型角色已按推荐设置；已有配置保留。图片默认使用 GPT Image，实际权限以执行结果为准。')
        } else if (result.status === 'failed') setError(result.message)
        else setStatus('已取消登录，原连接配置已保留。')
        loginRef.current = ''; setLoginId('')
      } catch { if (active) { loginRef.current = ''; setLoginId(''); setError('无法读取登录结果，请刷新连接设置确认状态。') } }
    }
    timer = setTimeout(() => { void poll() }, 500)
    return () => { active = false; clearTimeout(timer) }
  }, [open, api, loginId])
  useEffect(() => {
    if (!open || !api || !settings) return
    const ticket = generation.current
    const ids = new Set([...executionRoles.map(role => roles[role].connectionId), imageConnectionId].filter(Boolean))
    for (const id of ids) {
      const entry = settings.connections.find(item => item.connection.id === id)
      if (!entry?.hasCredential || entry.revoked) continue
      const key = catalogKey(entry)
      if (catalogs[key] || catalogRequested.current.has(key)) continue
      catalogRequested.current.add(key)
      void api.discoverModels(entry.connection.id, entry.connection.revision).then(result => {
        if (generation.current !== ticket) return
        setCatalogs(value => ({ ...value, [key]: result }))
        setCatalogErrors(value => { const next = { ...value }; delete next[key]; return next })
      }).catch(failure => {
        if (generation.current === ticket) setCatalogErrors(value => ({ ...value, [key]: failure instanceof Error ? failure.message : '模型目录暂不可用，请重试。' }))
      })
    }
  }, [open, api, settings, roles.conversation.connectionId, roles.vision.connectionId,
    roles.imageGenerate.connectionId, roles.imageEdit.connectionId, roles.compression.connectionId, imageConnectionId, catalogs])
  if (!open) return null

  const close = () => { if (!busy) { setApiKey(''); onClose() } }
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key !== 'Tab') return
    const available = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])]
    const first = available[0], last = available.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const perform = async (work: () => Promise<void>) => {
    if (!api || busy) return
    const ticket = generation.current
    setBusy(true); setError(''); setStatus('')
    try { await work() }
    catch (failure) { if (ticket === generation.current) setError(failure instanceof Error ? failure.message : '设置未保存，请检查后重试。') }
    finally { if (ticket === generation.current) setBusy(false) }
  }
  const refresh = async () => {
    const value = await api!.read()
    setSettings(value); onSaved?.(value)
    return value
  }
  const saveConnection = () => perform(async () => {
    const input = executionSettingsConnectionSchema.safeParse({ ...(selected ? { id: selectedId, expectedRevision: selected.connection.revision } : {}),
      connection, ...(apiKey ? { apiKey } : {}) })
    if (!input.success) throw new Error('请填写供应商、完整 API 地址和账号标识；API Key 不能包含换行。')
    const saved = await api!.saveConnection(input.data)
    setApiKey('')
    await refresh(); choose(saved)
    setStatus(saved.hasCredential ? '连接设置已保存。' : '连接设置已保存，尚未接通凭据。')
  })
  const saveRoles = () => perform(async () => {
    const selections = Object.fromEntries(executionRoles.filter(role => role !== 'compression'
      || Boolean(roles.compression.connectionId || settings?.profile.roles.compression)).map(role => {
      const draft = roles[role]
      if (!draft.connectionId) return [role, null]
      let parameters: Record<string, unknown>
      try {
        const value: unknown = JSON.parse(draft.parameters)
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
        parameters = value as Record<string, unknown>
      } catch { throw new Error(`${roleLabels[role]}参数必须是 JSON 对象。`) }
      if (isImageRole(role)) {
        const entry = settings?.connections.find(item => item.connection.id === draft.connectionId)
        if (!entry || !isImageConnection(entry)) throw new Error(`${roleLabels[role]}需要已显式启用 OpenAI Images API 或 ChatGPT OAuth 的连接。`)
        if (!draft.model.trim()) throw new Error(`${roleLabels[role]}需要选择图片模型。`)
        if (Object.keys(parameters).length) throw new Error(`${roleLabels[role]}当前不支持角色级模型参数；请清空为 {} 后保存。图片输出参数由每次图片请求单独指定，不会静默忽略。`)
      }
      return [role, { connectionId: draft.connectionId, model: draft.model, parameters,
        ...(draft.capabilityModel ? { capabilityModel: draft.capabilityModel } : {}) }]
    }))
    let parsed: ReturnType<typeof executionSettingsRolesSchema.parse>
    try { parsed = executionSettingsRolesSchema.parse(selections) }
    catch { throw new Error('已选择连接的角色必须选择模型；参数必须是 JSON 对象。') }
    const saved = await api!.saveProfile({ roles: parsed, expectedRevision: profileRevision })
    setProfileRevision(saved.revision); setRoles(roleDrafts(saved)); await refresh()
    setStatus('模型角色已保存，将用于下次任务。正在进行的任务保持原配置。')
  })
  const readCatalog = async (target: ExecutionConnectionView, showList = false) => {
    const result = await api!.discoverModels(target.connection.id, target.connection.revision)
    setCatalogs(value => ({ ...value, [catalogKey(target)]: result }))
    setCatalogErrors(value => { const next = { ...value }; delete next[catalogKey(target)]; return next })
    catalogRequested.current.add(catalogKey(target))
    if (showList) setModels(result.models.map(model => model.id))
    setStatus(`已读取 ${result.models.length} 个模型名称；工具、视觉和图片能力仍需实际验证。`)
  }
  const discover = () => perform(async () => { if (selected) await readCatalog(selected, true) })
  const retryCatalog = (target: ExecutionConnectionView) => perform(() => readCatalog(target))
  const saveImageService = () => perform(async () => {
    if (!settings) return
    const selectedImage = settings.connections.find(item => item.connection.id === imageConnectionId)
    if (!selectedImage || !isImageConnection(selectedImage) || !selectedImage.hasCredential || selectedImage.revoked)
      throw new Error('请先选择已接通并启用图片协议的 API 或 ChatGPT 连接。')
    if (!imageModel) throw new Error('请点选图片模型。')
    const current = settings.profile.roles
    const differentImageRoles = Boolean(current.imageGenerate && current.imageEdit
      && (current.imageGenerate.connectionId !== current.imageEdit.connectionId || current.imageGenerate.model !== current.imageEdit.model))
    if (differentImageRoles && !confirmImageUnification)
      throw new Error('现有图片生成与编辑使用不同服务；请明确确认统一后再保存。')
    for (const role of ['imageGenerate', 'imageEdit'] as const) {
      if (current[role] && Object.keys(current[role].parameters ?? {}).length)
        throw new Error('现有图片角色含高级参数；请先在高级设置中处理，避免覆盖已有配置。')
    }
    const imageRole = { connectionId: imageConnectionId, model: imageModel, parameters: {} }
    const saved = await api!.saveProfile({ expectedRevision: settings.profile.revision,
      roles: { ...current, imageGenerate: imageRole, imageEdit: imageRole } })
    setProfileRevision(saved.revision); setRoles(roleDrafts(saved)); setConfirmImageUnification(false); await refresh()
    setStatus(`图片生成和编辑已选择 ${selectedImage.connection.provider} · ${selectedImage.connection.accountId} / ${imageModel}（${billingLabels[selectedImage.connection.billing.kind]}）。下次任务生效；实际图片能力与费用仍需请求结果确认。`)
  })
  const probe = (role: 'conversation' | 'vision', capability: ProbedModelCapability) => perform(async () => {
    const saved = settings?.profile.roles[role]
    const entry = settings?.connections.find(item => item.connection.id === saved?.connectionId)
    if (!saved || !entry?.hasCredential || entry.revoked) throw new Error(`请先保存并接通${roleLabels[role]}角色的连接与模型。`)
    const result = await api!.probeCapabilities({ role, expectedProfileRevision: settings!.profile.revision, checks: [capability] })
    await refresh()
    const outcome = result.lastProbe?.outcomes.find(value => value.capability === capability)
    const label = capability === 'vision' ? '视觉' : '工具'
    setStatus(outcome?.status === 'supported'
      ? `${label}能力已验证；本次向 ${entry.connection.provider} / ${saved.model} 发起 ${(result.lastProbe?.requestCount ?? 0)} 次小请求，计费来源：${billingLabels[entry.connection.billing.kind]}。`
      : `${label}能力仍为未知：${outcome?.message ?? '没有完整探针结果'} 本次发起 ${(result.lastProbe?.requestCount ?? 0)} 次小请求，计费来源：${billingLabels[entry.connection.billing.kind]}。`)
  })
  const revoke = () => perform(async () => {
    if (!selected) return
    await api!.revokeConnection(selectedId); setApiKey(''); setModels([]); await refresh()
    setStatus('已撤销该连接的全部历史凭据，后续请求不可再使用。已发出的请求及费用不受此操作保证。')
  })
  const startLogin = (createIfMissing = false) => perform(async () => {
    if (hasConnectionChanges) throw new Error('请先保存当前 ChatGPT 连接，再登录。')
    let target = selected
    if (createIfMissing && (!target || !isOAuthImageConnection(target)))
      target = settings?.connections.find(item => isOAuthImageConnection(item) && !item.revoked)
    if (!target && createIfMissing) {
      const input = executionSettingsConnectionSchema.parse({ connection: oauthConnection() })
      target = await api!.saveConnection(input)
      await refresh(); choose(target)
    }
    if (!target || !isOAuthImageConnection(target) || target.revoked) throw new Error('请先选择有效的 ChatGPT 连接。')
    const result = await api!.startOAuthLogin(target.connection.id, target.connection.revision)
    if (result.status === 'pending') { loginRef.current = result.loginId; setLoginId(result.loginId); setStatus('等待浏览器完成 ChatGPT 登录。请使用当前账号登录，回调后会自动更新。') }
    else if (result.status === 'connected') { await refresh(); choose(result.connection); setStatus('ChatGPT 账号已登录。') }
    else if (result.status === 'failed') throw new Error(result.message)
  })
  const cancelLogin = async () => {
    const current = loginRef.current
    if (!current || !api) return
    try {
      await api.cancelOAuthLogin(current)
      const result = await api.oauthLoginStatus(current)
      if (result.status === 'connected') { await refresh(); choose(result.connection); setStatus('登录已完成，可在下方查看模型目录和配置。') }
      else setStatus('已取消登录，原连接配置已保留。')
      loginRef.current = ''; setLoginId('')
    }
    catch { setError('取消登录尚未完成，请重试。') }
  }
  const patchRole = (role: ExecutionRole, patch: Partial<RoleDraft>) => setRoles(value => ({ ...value, [role]: { ...value[role], ...patch } }))
  const chooseRoleEffort = (role: ExecutionRole, effort: DiscoveredReasoningEffort | undefined, resolved: ResolvedModelReasoning) => {
    try {
      const current: unknown = JSON.parse(roles[role].parameters)
      if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error()
      patchRole(role, { parameters: JSON.stringify(withModelReasoning(current as ModelJsonObject, effort, resolved), null, 2) })
      setError('')
    } catch { setError('当前高级参数不是有效 JSON 对象；原参数保留，修正后可设置思考。') }
  }
  const chooseRoleReference = (role: ExecutionRole, capabilityModel: string) => {
    try {
      const current: unknown = JSON.parse(roles[role].parameters)
      if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error()
      patchRole(role, { capabilityModel, parameters: clearManagedParameters(roles[role].parameters, { ...roles[role], capabilityModel }) })
    } catch { patchRole(role, { capabilityModel }) }
  }
  const chooseRoleConnection = (role: ExecutionRole, connectionId: string) => {
    setRoles(value => ({ ...value, [role]: { ...value[role], connectionId,
      model: value[role].connectionId === connectionId ? value[role].model : '',
      capabilityModel: value[role].connectionId === connectionId ? value[role].capabilityModel : '',
      parameters: value[role].connectionId === connectionId ? value[role].parameters : clearManagedParameters(value[role].parameters, { connectionId, model: '', capabilityModel: '' }) } }))
  }
  const clearManagedParameters = (value: string, target: Pick<RoleDraft, 'connectionId' | 'model' | 'capabilityModel'>) => {
    try {
      const current = JSON.parse(value)
      if (!current || typeof current !== 'object' || Array.isArray(current)) return value
      const parameters = withoutManagedModelReasoning(current)
      const connection = settings?.connections.find(entry => entry.connection.id === target.connectionId)?.connection
      return JSON.stringify(connection ? normalizeModelOutputParameters(resolveModelProtocol(connection, target.capabilityModel || target.model), parameters) : parameters, null, 2)
    } catch { return value }
  }
  const chooseRoleModel = (role: ExecutionRole, model: string) => patchRole(role, { model, capabilityModel: '',
    parameters: clearManagedParameters(roles[role].parameters, { ...roles[role], model, capabilityModel: '' }) })
  const imageConnections = settings?.connections.filter(item => isImageConnection(item) && !item.revoked) ?? []
  const oauthImageConnections = imageConnections.filter(isOAuthImageConnection)
  const loginConnection = selected && isOAuthImageConnection(selected) ? selected : oauthImageConnections[0]
  const loggedInAccounts = oauthImageConnections.filter(item => item.hasCredential)
  const chosenImageConnection = imageConnections.find(item => item.connection.id === imageConnectionId)
  const savedImageModels = [settings?.profile.roles.imageGenerate, settings?.profile.roles.imageEdit]
    .filter((role): role is NonNullable<typeof role> => Boolean(role && role.connectionId === imageConnectionId)).map(role => role.model)
  const imageCatalog = chosenImageConnection && catalogs[catalogKey(chosenImageConnection)]
  const imageCatalogError = chosenImageConnection && catalogErrors[catalogKey(chosenImageConnection)]
  const imageChoices = [...new Set([...savedImageModels,
    ...(chosenImageConnection && isOAuthImageConnection(chosenImageConnection) ? [...oauthImageProjectCandidates] : []),
    ...(imageCatalog?.models.map(model => model.id).filter(model => chosenImageConnection && isApiImageConnection(chosenImageConnection)
      ? true : imageCatalogModel(model)) ?? [])])]
  const imageRolesDiffer = Boolean(settings?.profile.roles.imageGenerate && settings.profile.roles.imageEdit
    && (settings.profile.roles.imageGenerate.connectionId !== settings.profile.roles.imageEdit.connectionId
      || settings.profile.roles.imageGenerate.model !== settings.profile.roles.imageEdit.model))
  const preset = selected && settings ? {
    conversation: verifiedRoleCandidates(settings, selected, 'conversation'),
    vision: verifiedRoleCandidates(settings, selected, 'vision'),
  } : null
  const presetFillable = (['conversation', 'vision'] as const).filter(role => preset?.[role].length === 1
    && !roles[role].connectionId && !roles[role].model && !settings?.profile.roles[role])
  const applyVerifiedPreset = () => {
    if (!preset || !presetFillable.length) return
    setRoles(current => {
      const next = { ...current }
      for (const role of presetFillable) {
        const selection = preset[role][0]!
        if (current[role].connectionId || current[role].model) continue
        next[role] = { connectionId: selection.connectionId, model: selection.model,
          parameters: JSON.stringify(selection.parameters ?? {}, null, 2), capabilityModel: selection.capabilityModel ?? '' }
      }
      return next
    })
    setStatus('已将当前连接的已验证能力填入未配置角色的草稿。检查后点击“保存模型角色”；已有角色和高级设置保持原值。')
  }
  const renderRole = (role: ExecutionRole) => {
    const imageRole = isImageRole(role)
    const chosen = settings?.connections.find(entry => entry.connection.id === roles[role].connectionId)
    const available = settings?.connections.filter(entry => !imageRole || isImageConnection(entry)) ?? []
    const unsupported = imageRole && roles[role].connectionId && (!chosen || !isImageConnection(chosen))
    const probeCapability = role === 'conversation' ? 'tools' : role === 'vision' ? 'vision' : null
    const savedSelection = settings?.profile.roles[role]
    const savedConnection = settings?.connections.find(entry => entry.connection.id === savedSelection?.connectionId)
    const currentMatchesSaved = Boolean(savedSelection && savedConnection && matchesSavedRole(roles[role], savedSelection, savedConnection))
    const capability = savedSelection && savedConnection ? modelCapabilityRecord(settings?.capabilityRecords ?? [], {
      connection: savedConnection.connection, model: savedSelection.model, ...(savedSelection.parameters ? { parameters: savedSelection.parameters } : {}),
    }) : undefined
     const capabilityOutcome = probeCapability ? capability?.lastProbe?.outcomes.find(value => value.capability === probeCapability) : undefined
     const capabilityFact = probeCapability ? capability?.facts[probeCapability] : undefined
     const catalog = chosen && catalogs[catalogKey(chosen)]
     const choices = catalog?.models.filter(model => !imageRole || (chosen && isApiImageConnection(chosen)
       ? true : imageCatalogModel(model.id))) ?? []
     const savedModel = savedSelection?.connectionId === roles[role].connectionId ? savedSelection.model : ''
     const extraModels = [...new Set([savedModel, roles[role].model])]
       .filter(model => model && !choices.some(item => item.id === model) && !(imageRole && isOAuthImageProjectCandidate(chosen, model)))
     const catalogError = chosen && catalogErrors[catalogKey(chosen)]
     const noChoices = choices.length === 0
     const modelLabel = role === 'conversation' ? '主力模型' : imageRole ? `${roleLabels[role]}图片模型` : `${roleLabels[role]}模型`
     const section = <section key={role} aria-label={`${roleLabels[role]}配置`} style={{ borderTop: '1px solid var(--border-color, #d0d5dd)', paddingTop: 12, minWidth: 0 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{roleLabels[role]}</h3>
      {imageRole && <p style={{ margin: '0 0 10px', fontSize: 13 }}>图片使用本次任务冻结的 ChatGPT OAuth 或已启用 OpenAI Images API 的连接。可点选目录中的图片模型或手动填写准确 ID；保存名称不代表能力已验证。API 路径当前仅支持单张参考图编辑。</p>}
      <div style={grid}>
        <label style={field}>{roleLabels[role]}连接<select aria-label={`${roleLabels[role]}连接`} value={roles[role].connectionId} onChange={event => chooseRoleConnection(role, event.target.value)}>
          <option value="">{role === 'vision' ? '跟随主力模型' : '未配置'}</option>
          {unsupported && <option value={roles[role].connectionId} disabled>{chosen ? `${chosen.connection.provider} · ${chosen.connection.accountId}` : roles[role].connectionId}（当前图片路径不支持）</option>}
          {available.map(entry => <option key={entry.connection.id} value={entry.connection.id}>{entry.connection.provider} · {entry.connection.accountId} · {billingLabels[entry.connection.billing.kind]}{entry.revoked ? '（已撤销）' : !entry.hasCredential ? isOAuthImageConnection(entry) ? '（未登录）' : '（未接通）' : ''}</option>)}
        </select></label>
        <label style={field}>{modelLabel}<select aria-label={modelLabel} value={roles[role].model} disabled={!roles[role].connectionId} onChange={event => chooseRoleModel(role, event.target.value)}>
          <option value="">{!chosen ? '先选择连接' : catalog ? '选择模型' : '正在读取目录或目录不可用'}</option>
          {extraModels.map(model => <option key={model} value={model}>{model}（已保存）</option>)}
          {choices.map(model => <option key={model.id} value={model.id}>{model.displayName && model.displayName !== model.id ? `${model.displayName} · ${model.id}` : model.id}{imageRole && isOAuthImageProjectCandidate(chosen, model.id) ? '' : ''}</option>)}
          {imageRole && chosen && isOAuthImageConnection(chosen) && [...oauthImageProjectCandidates]
            .filter(projectCandidate => !choices.some(model => model.id === projectCandidate))
            .map(model => <option key={model} value={model}>{model}</option>)}
        </select></label>
      </div>
      {imageRole && chosen && isApiImageConnection(chosen) && <label style={field}>自定义{modelLabel}<input aria-label={`自定义${modelLabel}`} value={roles[role].model}
        onChange={event => patchRole(role, { model: event.target.value })} placeholder="供应商实际支持的 Images 模型 ID" /></label>}
      {chosen && <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        <small role={catalogError || !imageRole && catalog && noChoices ? 'alert' : undefined}>{catalogError
          ?? (catalog ? catalog.models.length ? `${chosen.connection.provider} · ${catalog.models.length} 个可选模型` : '模型目录返回 0 个模型，可重试目录或手动指定模型 ID。'
            : chosen.hasCredential && !chosen.revoked ? '正在读取模型目录…' : '连接凭据不可用，无法读取目录。')}</small>
        {chosen.hasCredential && !chosen.revoked && (catalogError || catalog && noChoices) && <button type="button" className="secondary-button"
          aria-label={`重试${role === 'conversation' ? '主力' : roleLabels[role]}模型目录`} onClick={() => void retryCatalog(chosen)} style={{ justifySelf: 'start' }}>重试模型目录</button>}
      </div>}
      {role === 'compression' && <details style={{ marginTop: 8 }}><summary>压缩如何工作</summary><p style={{ margin: '8px 0 0', fontSize: 13 }}>未配置时使用当前任务的主模型。选定后，退出活跃上下文的内容会发送到这个连接整理；费用按所选连接计算。该模型不调用工具，也不能修改文档或授权。</p></details>}
      {roles[role].connectionId && !imageRole && <details><summary>手动指定准确模型 ID</summary>
        <label style={field}>自定义{modelLabel}<input aria-label={`自定义${modelLabel}`} value={roles[role].model} onChange={event => chooseRoleModel(role, event.target.value)} placeholder="请核对供应商提供的准确 ID" /></label>
        <small>可填写供应商提供的准确模型 ID 或私有别名；保存名称不代表能力已验证，请核对当前连接的计费来源。</small>
      </details>}
      {chosen && !imageRole && roles[role].model && (() => {
        const reference = findModelKnowledgeReference(modelKnowledge, roles[role].capabilityModel)
        const actual = catalog?.models.find(model => model.id === roles[role].model) ?? { id: roles[role].model }
        const resolved = resolveModelReasoning(chosen.connection, { ...actual, ...(reference ? { metadata: reference } : {}) })
        let parameters: ModelJsonObject | undefined
        try { const parsed: unknown = JSON.parse(roles[role].parameters); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parameters = parsed as ModelJsonObject } catch { /* Keep advanced text until explicitly saved. */ }
        const effort = readModelReasoningEffort(parameters, resolved)
        return <div role="group" aria-label={`${roleLabels[role]}思考设置`} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {resolved.kind === 'fixed' ? <small>该模型固定启用思考，没有可调档位。</small>
            : resolved.format === 'anthropic-budget' ? <ModelThinkingBudgetControl
              key={`${roles[role].model}:${roles[role].capabilityModel}`} parameters={parameters ?? {}} resolved={resolved} disabled={busy || !parameters}
              onChange={next => patchRole(role, { parameters: JSON.stringify(next, null, 2) })} />
            : resolved.kind === 'budget' ? <small>该型号使用数值控制思考；当前连接的参数格式尚未识别。</small>
            : resolved.choices.length > 0 ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span>{resolved.kind === 'toggle' ? '思考模式' : '推理强度'}</span>
              <button type="button" aria-pressed={effort === undefined} onClick={() => chooseRoleEffort(role, undefined, resolved)}>默认</button>
              {resolved.choices.map(choice => <button type="button" key={choice.effort} aria-pressed={effort === choice.effort}
                onClick={() => chooseRoleEffort(role, choice.effort, resolved)}>{choice.label ?? effortLabels[choice.effort]}</button>)}
            </div> : <small>尚未识别可调思考。若这是供应商别名，可选择对应参考型号。</small>}
          <details open={Boolean(roles[role].capabilityModel)}><summary>参考型号</summary>
            <ModelReferencePicker models={modelKnowledge} label={`${roleLabels[role]}参考型号`}
              value={reference ? knowledgeKey(reference) : roles[role].capabilityModel} disabled={busy}
              onChange={key => chooseRoleReference(role, key)} />
            <small>只用于识别能力；仍向当前连接请求 {roles[role].model}。实际支持以接入服务为准。</small>
            {knowledgeError && <small>{knowledgeError}</small>}
          </details>
        </div>
      })()}
      {imageRole && <p style={{ margin: '8px 0 0', fontSize: 13 }}>
        {unsupported ? '已保存的连接没有启用受支持的图片协议；请明确配置 Images API 或选择 ChatGPT OAuth。' : !chosen ? '尚未配置图片连接。请先启用 Images API 并接通 API Key，或登录 ChatGPT。' : chosen.revoked ? '此连接已撤销，需要重新接通。' : !chosen.hasCredential ? '此连接尚未接通凭据。' : '此连接已接通凭据。'}
        {' '}此设置页没有{roleLabels[role]}能力的独立验证记录；保存模型名称不代表该模型可用。请求会使用所选连接和模型，不会自动切换图片连接。
      </p>}
      {probeCapability && <details style={{ marginTop: 8 }}><summary>高级：能力诊断</summary><div style={{ display: 'grid', gap: 6, justifyItems: 'start', marginTop: 8 }}>
        <small>{!currentMatchesSaved ? '此未保存选择未验证；请先保存模型角色，再验证能力。'
          : capabilityFact?.status === 'supported' ? `${probeCapability === 'vision' ? '视觉' : '工具'}能力已按当前连接版本、模型和参数验证。`
          : capabilityOutcome ? `${probeCapability === 'vision' ? '视觉' : '工具'}能力仍为未知：${capabilityOutcome.message}`
            : `${probeCapability === 'vision' ? '视觉' : '工具'}能力尚未按当前连接版本、模型和参数验证。`}</small>
        <small>验证会向已保存的 {roleLabels[role]} 模型发起 1 次小请求，并按该连接的实际计费来源计费；不会自动切换连接或重试。</small>
        <button type="button" className="secondary-button" onClick={() => void probe(role as 'conversation' | 'vision', probeCapability)}
          disabled={!currentMatchesSaved || !savedConnection?.hasCredential || savedConnection.revoked}>
          验证{roleLabels[role]}{probeCapability === 'vision' ? '视觉' : '工具'}能力
        </button>
      </div></details>}
      <details style={{ marginTop: 8 }}><summary>{imageRole ? '图片角色参数（当前仅支持空对象）' : '模型参数'}</summary><label style={field}>{roleLabels[role]}参数（JSON）<textarea aria-label={`${roleLabels[role]}参数`} rows={4} value={roles[role].parameters} onChange={event => patchRole(role, { parameters: event.target.value })} spellCheck={false} style={{ fontFamily: 'monospace', width: '100%', boxSizing: 'border-box' }} /></label>{imageRole && <small>图片输出参数由具体请求指定；角色级参数不参与 Images 请求，填写非空对象会拒绝保存。</small>}</details>
    </section>
    return section

  }
  return <div className="modal-backdrop" role="presentation">
    <section ref={dialog} className="modal execution-settings-panel" role="dialog" aria-modal="true" aria-labelledby="execution-settings-title" onKeyDown={keys}
      style={{ width: 'min(920px, calc(100vw - 32px))', maxHeight: '90vh', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
      <header className="execution-settings-panel__header">
        <h2 id="execution-settings-title" style={{ margin: 0 }}>模型与连接</h2>
        <button type="button" className="secondary-button execution-settings-panel__close" onClick={close} disabled={busy} aria-label="关闭模型连接设置" title="关闭模型连接设置">×</button>
      </header>
      <div className="execution-settings-panel__body">
      <p style={{ margin: 0 }}>登录后为未配置的主力、压缩和图片角色推荐模型；已有选择和未保存的手动修改保留。下次任务生效，计费按所选连接。</p>
      <section aria-label="ChatGPT 登录" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {loggedInAccounts.length > 0 && <small>已登录 ChatGPT：{loggedInAccounts.map(item => `${item.connection.accountId} · ${billingLabels[item.connection.billing.kind]}`).join('；')}</small>}
        {entry === 'chatgpt-oauth' && <p style={{ margin: 0 }}>通过系统浏览器登录当前账号，读取模型目录；此过程不会发起生成。</p>}
        {oauthImageConnections.length > 1 && <label style={field}>ChatGPT 账号<select aria-label="ChatGPT 账号" value={loginConnection?.connection.id ?? ''} onChange={event => choose(oauthImageConnections.find(item => item.connection.id === event.target.value))}>
          {oauthImageConnections.map(item => <option key={item.connection.id} value={item.connection.id}>{item.connection.accountId}{item.hasCredential ? '（已登录）' : '（未登录）'}</option>)}
        </select></label>}
        <button type="button" className="primary-button" disabled={busy || !settings?.secureStorageAvailable || Boolean(loginId)} onClick={() => void startLogin(true)}>
          {loginConnection?.hasCredential ? '重新登录 ChatGPT' : '登录 ChatGPT'}
        </button>
      </section>
      {error && <p role="alert" style={{ color: 'var(--danger, #b42318)', margin: 0 }}>{error}</p>}
      {status && <p role="status" style={{ margin: 0 }}>{status}</p>}
      {loginId && <button type="button" className="secondary-button" onClick={() => void cancelLogin()} style={{ justifySelf: 'start' }}>取消 ChatGPT 登录</button>}
      {settings && !settings.secureStorageAvailable && <p role="alert">系统安全凭据存储不可用，无法修改模型角色或读取密钥；免 Key 搜索设置仍可保存，原配置保留。</p>}
      <fieldset disabled={busy || !settings || !settings.secureStorageAvailable} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        <legend style={{ fontWeight: 600, marginBottom: 10 }}>下次任务使用的模型</legend>
        <div className="execution-settings-primary-models" role="group" aria-label="默认模型配置" style={grid}>
          {renderRole('conversation')}
          {renderRole('compression')}
      <section aria-label="图片服务配置" style={{ borderTop: '1px solid var(--border-color, #d0d5dd)', paddingTop: 12, minWidth: 0 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>图片模型{imageRolesDiffer ? '（生成与编辑分别配置）' : ''}</h3>
      <fieldset disabled={busy || !settings || !settings.secureStorageAvailable} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {imageRolesDiffer && <p style={{ margin: 0 }}>当前图片生成与编辑分别使用不同配置。下面的选择不会改动它们，除非您明确确认统一。</p>}
        <label style={field}>图片账号<select aria-label="图片账号" value={imageConnectionId} onChange={event => { setImageConnectionId(event.target.value); setImageModel(''); setConfirmImageUnification(false) }}>
          <option value="">未选择</option>
          {imageConnections.map(item => <option key={item.connection.id} value={item.connection.id} disabled={!item.hasCredential}>
            {item.connection.provider} · {item.connection.accountId} · {billingLabels[item.connection.billing.kind]}{item.hasCredential ? '' : isOAuthImageConnection(item) ? '（未登录）' : '（未接通 API Key）'}
          </option>)}
        </select></label>
        <label style={field}>图片模型<select aria-label="图片模型" value={imageChoices.includes(imageModel) ? imageModel : ''} disabled={!chosenImageConnection?.hasCredential} onChange={event => { setImageModel(event.target.value); setConfirmImageUnification(false) }}>
          <option value="">未选择</option>
          {imageChoices.map(model => <option key={model} value={model}>{model}{isOAuthImageProjectCandidate(chosenImageConnection, model) ? model === DEFAULT_CHATGPT_IMAGE_MODEL ? '（推荐：快速生图）' : model === 'gpt-image-2.5-sunburst' ? '（精确编辑）' : '' : imageCatalog?.models.some(item => item.id === model) ? '（目录列出，图片能力待验证）' : '（已存配置）'}</option>)}
        </select></label>
        {chosenImageConnection && isApiImageConnection(chosenImageConnection) && <label style={field}>自定义图片模型 ID<input aria-label="自定义图片模型 ID" value={imageModel} onChange={event => { setImageModel(event.target.value); setConfirmImageUnification(false) }} placeholder="供应商实际支持的 Images 模型 ID" /></label>}
        {imageCatalogError && <div style={{ display: 'grid', gap: 6 }}><small role="alert">{imageCatalogError}</small>
          <button type="button" className="secondary-button" aria-label="重试图片模型目录" onClick={() => void retryCatalog(chosenImageConnection!)} style={{ justifySelf: 'start' }}>重试模型目录</button>
        </div>}
        {imageRolesDiffer && <label><input type="checkbox" checked={confirmImageUnification} onChange={event => setConfirmImageUnification(event.target.checked)} /> 确认将图片生成和编辑统一为上方选定的账号、模型及计费来源</label>}
        <button type="button" className="primary-button" onClick={() => void saveImageService()} disabled={!chosenImageConnection?.hasCredential || !imageModel || imageRolesDiffer && !confirmImageUnification} style={{ justifySelf: 'start' }}>保存图片服务</button>
        <details><summary>图片请求与计费说明</summary>
          <p style={{ margin: '8px 0' }}>点选已接通的 ChatGPT 或已启用 OpenAI Images API 的连接和模型。保存后，图片生成与编辑使用同一服务；不会自动切换账号或计费来源。</p>
          {chosenImageConnection && <small>请求路径：{chosenImageConnection.connection.provider} · {chosenImageConnection.connection.accountId} · {billingLabels[chosenImageConnection.connection.billing.kind]}{isApiImageConnection(chosenImageConnection) ? ` · ${openAIImagesEndpoint(chosenImageConnection.connection, 'generate')}` : ''}。模型目录及登录状态不等于图片生成或编辑能力已通过验证。</small>}
        </details>
      </fieldset>
      </section>
        </div>
        <button type="button" className="primary-button" onClick={() => void saveRoles()} style={{ justifySelf: 'start' }}>保存模型角色</button>
        <details><summary>高级模型配置</summary><div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {(['vision', 'imageGenerate', 'imageEdit'] as const).map(role => <details key={role}><summary>高级：{roleLabels[role]}{role === 'vision' && !roles[role].connectionId ? '（默认跟随主力模型）' : ''}</summary>{renderRole(role)}</details>)}
        </div></details>
      </fieldset>
      {entry === 'default' && <details><summary>连接详情</summary>
      <fieldset disabled={busy || !settings || Boolean(loginId)} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        <legend style={{ fontWeight: 600, marginBottom: 10 }}>连接</legend>
        <div role="group" aria-label="快速接入" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {connectionPresets.map(preset => <button type="button" key={preset.label} className="secondary-button" onClick={() => {
            setSelectedId(''); setApiKey(''); setConnection({ ...preset.connection }); setModels([]); setStatus(''); setError('')
          }}>{preset.label}</button>)}
        </div>
        <label style={field}>选择连接<select aria-label="选择连接" value={selectedId} onChange={event => choose(settings?.connections.find(entry => entry.connection.id === event.target.value))}>
          <option value="">新建连接</option>
          {settings?.connections.map(entry => <option key={entry.connection.id} value={entry.connection.id}>{entry.connection.provider} · {entry.connection.accountId}{entry.revoked ? '（已撤销）' : !entry.hasCredential ? '（未接通）' : ''}</option>)}
        </select></label>
        <div style={grid}>
          <label style={field}>供应商标识<input aria-label="供应商标识" value={connection.provider} readOnly={connection.authKind === 'oauth'} onChange={event => setConnection(value => ({ ...value, provider: event.target.value }))} placeholder="供应商名称" /></label>
          <label style={field}>账号标识<input aria-label="账号标识" value={connection.accountId === 'pending-login' ? '登录后自动识别' : connection.accountId} readOnly={connection.authKind === 'oauth'} onChange={event => setConnection(value => ({ ...value, accountId: event.target.value }))} placeholder="便于区分账号的名称" /></label>
          <label style={field}>API 地址<input aria-label="API 地址" type="url" value={connection.baseURL} readOnly={connection.authKind === 'oauth'} onChange={event => setConnection(value => ({ ...value, baseURL: event.target.value }))} placeholder="https://供应商地址/v1" /></label>
          <label style={field}>协议{connection.authKind === 'oauth'
            ? <input aria-label="协议" value="ChatGPT Responses" readOnly />
            : <select aria-label="协议" value={connection.protocol} onChange={event => setConnection(value => ({ ...value, protocol: event.target.value as ConnectionDraft['protocol'] }))}>
              <option value="openai-chat">OpenAI Chat Completions</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>}</label>
          <label style={field}>认证方式<select aria-label="认证方式" value={connection.authKind} onChange={event => { setApiKey(''); const oauth = event.target.value === 'oauth'; setConnection(value => oauth
            ? oauthConnection()
            : { ...value, protocol: 'openai-chat', imageProtocol: null, baseURL: '', accountId: '', authKind: 'api-key', billing: { kind: 'unknown' } }) }}>
            <option value="api-key">API Key</option><option value="oauth">ChatGPT OAuth</option>
          </select></label>
          <label style={field}>计费来源<select aria-label="计费来源" value={connection.billing.kind} onChange={event => setConnection(value => ({ ...value, billing: { kind: event.target.value as ConnectionDraft['billing']['kind'] } }))}>
            <option value="unknown">未知</option><option value="metered">按量付费</option><option value="token-plan">Token Plan</option><option value="subscription">订阅</option><option value="prepaid">预付费</option>
          </select></label>
        </div>
        {connection.authKind === 'api-key' && <label style={{ display: 'grid', gap: 5 }}><span><input aria-label="启用 OpenAI Images API" type="checkbox"
          checked={connection.imageProtocol === 'openai-images'} onChange={event => setConnection(value => ({ ...value,
            imageProtocol: event.target.checked ? 'openai-images' : null }))} /> 此连接支持 OpenAI Images API</span>
          <small>启用后，仅在把此连接明确选为图片角色时向所填 API 地址发送图片请求与 API Key。要求 HTTPS、无 URL 凭据或查询参数；模型目录不证明图片能力。</small>
          {connection.imageProtocol === 'openai-images' && <small>图片生成目标：{(() => { try { return openAIImagesEndpoint({
            protocol: connection.protocol, baseURL: connection.baseURL, imageProtocol: connection.imageProtocol,
            auth: { kind: connection.authKind, credentialRef: '' },
          }, 'generate') } catch { return '地址无效，请填写可信的 HTTPS Images API 根地址。' } })()}</small>}
        </label>}
        {connection.authKind === 'api-key' ? <label style={field}>API Key（仅写入，不回显）<input aria-label="API Key" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)}
          placeholder={selected?.hasCredential ? '仅改账号名称可留空保留密钥；更换供应商、API 地址或协议需重新输入' : '可先保存配置，输入密钥后才可发起请求'} /></label>
          : <p style={{ margin: 0 }}>{selected?.hasCredential && !hasConnectionChanges ? 'ChatGPT 账号已登录。' : '尚未完成正式登录。先保存连接，再通过系统浏览器登录当前 ChatGPT 账号。'}</p>}
        <small>{selected?.hasCredential ? '凭据已安全保存。' : '此连接尚未接通凭据。'}</small>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="primary-button" onClick={() => void saveConnection()} disabled={!settings?.secureStorageAvailable}>保存连接</button>
          {connection.authKind === 'oauth' && <button type="button" className="primary-button" onClick={() => void startLogin()} disabled={!selected || hasConnectionChanges || !settings?.secureStorageAvailable}>登录当前 ChatGPT 账号</button>}
          <button type="button" className="secondary-button" onClick={() => void discover()} disabled={!selected?.hasCredential || selected.revoked || !settings?.secureStorageAvailable || hasConnectionChanges}>读取模型目录</button>
          <button type="button" className="secondary-button" onClick={() => void revoke()} disabled={!selected?.hasCredential}>{connection.authKind === 'oauth' ? '退出 ChatGPT 连接' : '撤销凭据'}</button>
        </div>
        {hasConnectionChanges && <small>先保存当前连接修改，再读取该连接的模型目录。</small>}
        {models.length > 0 && <details open><summary>模型目录</summary><div style={{ maxHeight: 140, overflow: 'auto' }}>{models.map(model => <div key={model}><code>{model}</code></div>)}</div></details>}
      </fieldset>
      </details>}
      {entry === 'default' && settings && api && <SearchSettingsSection settings={settings} api={api} onSaved={value => { setSettings(value); setProfileRevision(value.profile.revision); onSaved?.(value) }} />}
      {entry === 'default' && <details><summary>可选：Pixabay 图库</summary><PixabaySettingsSection /></details>}
      </div>
    </section>
  </div>
}
