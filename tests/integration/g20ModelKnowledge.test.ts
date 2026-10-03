import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { MODEL_KNOWLEDGE_URL, ModelKnowledgeService, normalizeModelKnowledge } from '../../src/main/workbench/providers/ModelKnowledgeService'
import type { DiscoveredModel } from '../../src/shared/workbench/executionSettingsDesktop'

const directories: string[] = []
const servers: http.Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})
const now = () => new Date('2026-10-03T01:02:03.000Z')
const publicCatalog = {
  openai: { id: 'openai', models: {
    'gpt-6-sol': { id: 'gpt-6-sol', name: 'GPT-6 Sol', limit: { context: 1050000, output: 128000 },
      modalities: { input: ['text', 'image'], output: ['text'] }, reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high', 'max'] }] },
    'gpt-fixed': { reasoning: true, reasoning_options: [] },
    'gpt-unknown': { reasoning: true, limit: { context: 16384 } },
  } },
  anthropic: { models: {
    'claude-sonnet-4-5': { reasoning: true, reasoning_options: [{ type: 'budget_tokens', min: 1024 }], limit: { context: 200000 } },
  } },
  deepseek: { models: {
    'deepseek-flash': { canonical_model_id: 'deepseek/deepseek-v4.1-flash', reasoning: true,
      reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }] },
  } },
  zai: { models: { 'glm-5': { reasoning: true, reasoning_options: [{ type: 'toggle' }] } } },
  'fixture-router': { models: {
    'gpt-6-sol': { limit: { context: 500000 }, reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] },
    'openai/gpt-6-sol': { limit: { context: 64000 }, reasoning: true, reasoning_options: [] },
  } },
}
async function directory() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-model-knowledge-'))
  directories.push(value)
  return value
}

it('consumes a real public HTTP catalog, preserves provider declarations, then saves and reopens without network', async () => {
  const location = await directory()
  const received: { method?: string; authorization?: string; body: string }[] = []
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      received.push({ method: request.method, authorization: request.headers.authorization, body })
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(publicCatalog))
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not listen')
  const transport = vi.fn<typeof fetch>(async (url, options) => {
    expect(url).toBe(MODEL_KNOWLEDGE_URL)
    expect(options?.headers).toEqual({ Accept: 'application/json' })
    return fetch(`http://127.0.0.1:${address.port}/api.json`, options)
  })
  const service = new ModelKnowledgeService({ directory: location, fetch: transport, now })
  await service.refresh()
  expect(received).toEqual([{ method: 'GET', authorization: undefined, body: '' }])
  expect(transport).toHaveBeenCalledTimes(1)
  const connection = { provider: 'teamorouter' }
  expect(await service.find(connection, 'openai/gpt-6-sol-2026-09-22')).toMatchObject({
    id: 'gpt-6-sol', provider: 'openai', contextWindow: 1050000, outputLimit: 128000,
    inputModalities: ['text', 'image'], reasoning: { kind: 'effort', efforts: ['none', 'low', 'high', 'max'] },
  })
  expect(await service.find({ provider: 'fixture-router' }, 'gpt-6-sol')).toMatchObject({
    provider: 'fixture-router', contextWindow: 500000, reasoning: { efforts: ['low', 'high'] },
  })
  expect(await service.find({ provider: 'fixture-router' }, 'openai/gpt-6-sol', true)).toMatchObject({
    provider: 'openai', contextWindow: 1050000,
  })
  expect(await service.find({ provider: 'fixture-router' }, 'openai/gpt-6-sol')).toMatchObject({
    provider: 'fixture-router', contextWindow: 64000, reasoning: { kind: 'fixed' },
  })
  const [updatedSupplement] = await service.enrich(connection, [{ id: 'gpt-6-sol', metadataSource: 'models.dev',
    metadata: { id: 'gpt-6-sol', contextWindow: 8000, outputLimit: 1000, reasoning: { kind: 'effort', efforts: ['low'] } } }])
  expect(updatedSupplement?.metadata).toMatchObject({ contextWindow: 1050000, outputLimit: 128000,
    reasoning: { efforts: ['none', 'low', 'high', 'max'] } })
  expect(await service.find(connection, 'claude-sonnet-4-5-20250929')).toMatchObject({ reasoning: { kind: 'budget' } })
  expect(await service.find(connection, 'glm-5')).toMatchObject({ reasoning: { kind: 'toggle' } })
  expect(await service.find(connection, 'deepseek-v4.1-flash')).toMatchObject({ reasoning: { efforts: ['none', 'low', 'high', 'max'] } })
  expect(await service.find(connection, 'unpublished-special-alias')).toBeUndefined()
  const declared: DiscoveredModel = { id: 'gpt-6-sol', displayName: 'User route label', reasoningEfforts: [],
    defaultReasoningEffort: 'high', metadata: { id: 'actual-directory-identity', contextWindow: 8192 } }
  const [enriched] = await service.enrich(connection, [declared])
  expect(enriched).toMatchObject({ ...declared, metadataSource: 'directory', metadata: {
    id: 'actual-directory-identity', contextWindow: 8192, outputLimit: 128000,
  } })
  expect(declared.metadata).toEqual({ id: 'actual-directory-identity', contextWindow: 8192 })
  const snapshot = JSON.parse(await fs.readFile(path.join(location, 'model-knowledge-v1.json'), 'utf8'))
  expect(snapshot).toMatchObject({ source: 'models.dev', sourceUrl: MODEL_KNOWLEDGE_URL, updatedAt: now().toISOString() })
  const offline = vi.fn<typeof fetch>(async () => { throw new Error('offline') })
  const reopened = new ModelKnowledgeService({ directory: location, fetch: offline, now })
  expect(await reopened.knownModels()).toEqual(await service.knownModels())
  expect(offline).not.toHaveBeenCalled()
  expect(await reopened.refresh()).toEqual(snapshot.models)
  expect(await reopened.find(connection, 'gpt-6-sol')).toMatchObject({ contextWindow: 1050000 })
  expect(JSON.parse(await fs.readFile(path.join(location, 'model-knowledge-v1.json'), 'utf8'))).toEqual(snapshot)
})

it('uses the distributable real catalog offline and leaves unspecified reasoning unknown', async () => {
  const service = new ModelKnowledgeService({ directory: await directory(), now,
    fetch: async () => { throw new Error('offline') } })
  const bundled = await service.knownModels()
  expect(bundled.find(entry => entry.provider === 'openai' && entry.id === 'gpt-6-sol')).toMatchObject({ contextWindow: 1050000 })
  expect(bundled.find(entry => entry.provider === 'anthropic' && entry.id === 'claude-opus-4-5')?.reasoning?.efforts).toEqual(['low', 'medium', 'high'])
  const normalized = normalizeModelKnowledge(publicCatalog, now().toISOString())
  expect(normalized.models.find(entry => entry.id === 'gpt-unknown')?.reasoning).toBeUndefined()
  expect(normalized.models.find(entry => entry.id === 'gpt-fixed')?.reasoning).toEqual({ kind: 'fixed' })
  expect(normalized.models.some(entry => Object.hasOwn(entry, 'cost') || Object.hasOwn(entry, 'billing'))).toBe(false)
})

it('serves stale cache immediately while one public refresh updates and persists it', async () => {
  const location = await directory()
  await fs.writeFile(path.join(location, 'model-knowledge-v1.json'), JSON.stringify({
    source: 'models.dev', sourceUrl: MODEL_KNOWLEDGE_URL, updatedAt: '2026-09-01T00:00:00.000Z',
    models: [{ id: 'old-cached-model', provider: 'fixture' }],
  }))
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const transport = vi.fn<typeof fetch>(async () => { await pending; return Response.json(publicCatalog) })
  const service = new ModelKnowledgeService({ directory: location, fetch: transport, now })
  expect(await service.knownModels()).toEqual([{ id: 'old-cached-model', provider: 'fixture' }])
  expect(await service.knownModels()).toEqual([{ id: 'old-cached-model', provider: 'fixture' }])
  const refresh = service.refresh()
  release()
  expect((await refresh).find(entry => entry.id === 'gpt-6-sol')?.reasoning?.kind).toBe('effort')
  expect(transport).toHaveBeenCalledTimes(1)
  expect((await service.knownModels()).some(entry => entry.id === 'old-cached-model')).toBe(false)
})
