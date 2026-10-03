// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { ExecutionSettingsDesktopService } from '../../src/main/workbench/providers/executionSettingsService'
import { ModelKnowledgeService } from '../../src/main/workbench/providers/ModelKnowledgeService'
import { routeModelProviders, serializeModelPayload } from '../../src/main/workbench/providers/ModelProviderRouter'
import { resolveModelReasoning, withModelReasoning } from '../../src/shared/workbench/modelReasoning'
import { modelContextBudget } from '../../src/core/execution/modelContextBudget'
import type { DiscoveredModels } from '../../src/shared/workbench/executionSettingsDesktop'
import type { ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'

it('joins directory, public facts, persisted reference and frozen wire protocol without replacing the connection or model', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'g20-automatic-capabilities-'))
  try {
    const secret = 'fixture-only-key', key = randomBytes(32)
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString(value: string) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
        return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()])
      },
      decryptString(value: Buffer) {
        const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
        cipher.setAuthTag(value.subarray(-16))
        return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString('utf8')
      },
    }
    const publicTransport = vi.fn<typeof fetch>(async () => { throw new Error('offline fixture') })
    const modelKnowledge = new ModelKnowledgeService({ directory: path.join(directory, 'facts'),
      now: () => new Date('2026-10-03T11:00:00Z'), fetch: publicTransport })
    const store = new ExecutionSettingsStore({ directory, encryption, modelKnowledge })
    const saved = await store.saveConnection({ connection: { provider: 'teamorouter', protocol: 'openai-chat',
      baseURL: 'https://api.teamorouter.com/v1', accountId: '按量账号', authKind: 'api-key', billing: { kind: 'metered' },
      capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, apiKey: secret })
    const transport = vi.fn<typeof fetch>(async (url, options) => {
      expect(String(url)).toBe('https://api.teamorouter.com/v1/models')
      expect(options?.headers).toMatchObject({ Authorization: `Bearer ${secret}` })
      return Response.json({ data: [{ id: 'claude-opus-4-6' }, { id: 'gpt-5.4-mini', supported_reasoning_efforts: ['high'] },
        { id: 'private-alias' }] })
    })
    const service = new ExecutionSettingsDesktopService(store, transport)
    const catalog = await service.operate({ type: 'discover-models', id: saved.connection.id, revision: 1 }) as DiscoveredModels
    const claude = catalog.models.find(model => model.id === 'claude-opus-4-6')!
    expect(claude.metadata).toMatchObject({ provider: 'anthropic', outputLimit: 128000 })
    expect(resolveModelReasoning(saved.connection, catalog.models.find(model => model.id === 'gpt-5.4-mini')!).choices)
      .toEqual([{ effort: 'high' }])
    const parameters = withModelReasoning({ temperature: 0.4 }, 'high', resolveModelReasoning(saved.connection, claude))
    await store.saveProfile({ expectedRevision: 0, roles: {
      conversation: { connectionId: saved.connection.id, model: claude.id, parameters },
      vision: null, imageGenerate: null, imageEdit: null,
    } })
    const selection = await store.snapshot('conversation')
    expect(selection).toMatchObject({ model: claude.id, apiProtocol: 'anthropic-messages', outputLimit: 128000,
      connection: { protocol: 'openai-chat', billing: { kind: 'metered' } } })
    expect(selection.connection).toEqual(saved.connection)
    expect(modelContextBudget(selection).outputReserve).toBe(selection.outputLimit)
    expect(await store.resolveCredential(selection.connection)).toBe(secret)
    const request: ModelRequest = { requestId: 'fixture', selection, messages: [{ role: 'user', content: 'Hello' }] }
    expect(JSON.parse(serializeModelPayload(request))).toMatchObject({ model: claude.id, max_tokens: 128000,
      thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, temperature: 0.4 })
    const called: string[] = []
    const provider = (name: string): ModelProvider => ({ async *stream() { called.push(name) } })
    const routed = routeModelProviders({ 'openai-chat': provider('chat'), 'anthropic-messages': provider('messages'),
      'openai-responses': provider('responses'), 'chatgpt-responses': provider('oauth') })
    for await (const _ of routed.stream(request)) { /* No model is called. */ }
    expect(called).toEqual(['messages'])

    const reference = 'openai/gpt-5.4-mini', facts = await modelKnowledge.find(saved.connection, reference)
    expect(facts?.id).toBe('gpt-5.4-mini')
    const aliasParameters = withModelReasoning({ temperature: 0.3 }, 'xhigh',
      resolveModelReasoning(saved.connection, { id: 'private-alias', metadata: facts }))
    await store.saveProfile({ expectedRevision: 1, roles: {
      conversation: { connectionId: saved.connection.id, model: 'private-alias', capabilityModel: reference, parameters: aliasParameters },
      vision: null, imageGenerate: null, imageEdit: null,
    } })
    const reopened = new ExecutionSettingsStore({ directory, encryption, modelKnowledge })
    const frozen = await reopened.snapshot('conversation')
    expect(frozen).toMatchObject({ model: 'private-alias', capabilityModel: reference, apiProtocol: 'openai-responses',
      connection: saved.connection, parameters: { reasoning: { effort: 'xhigh' }, temperature: 0.3 } })
    expect(JSON.parse(serializeModelPayload({ ...request, selection: frozen }))).toMatchObject({
      model: 'private-alias', reasoning: { effort: 'xhigh' } })
    expect(await reopened.resolveCredential(frozen.connection)).toBe(secret)
    expect((await reopened.cachedModelCatalog(saved.connection.id, 1))?.models.find(model => model.id === claude.id)?.metadata)
      .toBeUndefined()
    expect(publicTransport).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledTimes(1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('reads a native Anthropic directory with the native version and key headers', async () => {
  const store = { read: async () => ({ connections: [{ connection: { id: 'native', revision: 1, provider: 'anthropic',
    protocol: 'anthropic-messages', baseURL: 'https://api.anthropic.com', auth: { kind: 'api-key' } }, hasCredential: true, revoked: false }] }),
    resolveCredential: async () => 'fixture-key', recordModelCatalog: async () => {},
    modelKnowledge: { enrich: async (_connection: unknown, models: unknown[]) => models },
  } as unknown as ExecutionSettingsStore
  const transport = vi.fn<typeof fetch>(async (url, options) => {
    expect(String(url)).toBe('https://api.anthropic.com/v1/models')
    expect(options?.headers).toEqual({ 'x-api-key': 'fixture-key', 'anthropic-version': '2023-06-01', Accept: 'application/json' })
    return Response.json({ data: [{ id: 'claude-opus-4-6' }] })
  })
  const result = await new ExecutionSettingsDesktopService(store, transport).operate({ type: 'discover-models', id: 'native', revision: 1 }) as DiscoveredModels
  expect(result.models.map(model => model.id)).toEqual(['claude-opus-4-6'])
})
