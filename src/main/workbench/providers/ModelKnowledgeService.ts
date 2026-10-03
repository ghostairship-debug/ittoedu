import fs from 'node:fs/promises'
import path from 'node:path'
import bundledKnowledge from '../../../shared/generated/modelKnowledge.json'
import type { DiscoveredModel, DiscoveredReasoningEffort } from '../../../shared/workbench/executionSettingsDesktop'
import type { ModelKnowledgeEntry } from '../../../shared/workbench/modelKnowledge'
import { findModelKnowledgeReference } from '../../../shared/workbench/modelKnowledge'
import type { ModelConnectionSnapshot } from '../../../shared/workbench/modelProvider'

export const MODEL_KNOWLEDGE_URL = 'https://models.dev/api.json'
const refreshInterval = 24 * 60 * 60 * 1000
const efforts = new Set<DiscoveredReasoningEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
export interface ModelKnowledgeSnapshot {
  source: 'models.dev'
  sourceUrl: string
  updatedAt: string
  license: { spdx: 'MIT'; copyright: string; text: string }
  models: ModelKnowledgeEntry[]
}
// Attribution from https://github.com/anomalyco/models.dev/blob/dev/LICENSE.
const license: ModelKnowledgeSnapshot['license'] = {
  spdx: 'MIT', copyright: 'Copyright (c) 2025 models.dev',
  text: `MIT License

Copyright (c) 2025 models.dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined
const positive = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
const strings = (value: unknown): string[] | undefined => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : undefined

/** Normalize only declared model facts. In particular reasoning:true is not an off switch. */
export function normalizeModelKnowledge(data: unknown, updatedAt: string, sourceUrl = MODEL_KNOWLEDGE_URL): ModelKnowledgeSnapshot {
  const models: ModelKnowledgeEntry[] = []
  for (const [providerKey, rawProvider] of Object.entries(record(data) ?? {})) {
    const provider = record(rawProvider)
    if (!provider) continue
    const providerId = text(provider.id) ?? providerKey
    const byId = new Map<string, ModelKnowledgeEntry>()
    for (const [modelKey, rawModel] of Object.entries(record(provider.models) ?? {})) {
      const model = record(rawModel)
      if (!model) continue
      const id = text(model.id) ?? modelKey
      if (!id) continue
      const limit = record(model.limit), modalities = record(model.modalities)
      const contextWindow = positive(limit?.context), outputLimit = positive(limit?.output)
      const inputModalities = strings(modalities?.input), outputModalities = strings(modalities?.output)
      const name = text(model.name)
      const entry: ModelKnowledgeEntry = { id, provider: providerId, ...(name ? { name } : {}),
        ...(contextWindow ? { contextWindow } : {}), ...(outputLimit ? { outputLimit } : {}),
        ...(inputModalities ? { inputModalities } : {}), ...(outputModalities ? { outputModalities } : {}) }
      if (Array.isArray(model.reasoning_options)) {
        const options = model.reasoning_options.map(record).filter((option): option is Record<string, unknown> => !!option)
        const toggle = options.some(option => option.type === 'toggle')
        const levels = [...new Set(options.filter(option => option.type === 'effort').flatMap(option => strings(option.values) ?? []))]
          .filter((value): value is DiscoveredReasoningEffort => efforts.has(value as DiscoveredReasoningEffort))
        if (levels.length) entry.reasoning = { kind: 'effort', efforts: toggle && !levels.includes('none') ? ['none', ...levels] : levels }
        else if (toggle) entry.reasoning = { kind: 'toggle' }
        else if (options.some(option => option.type === 'budget_tokens')) entry.reasoning = { kind: 'budget' }
        else if (model.reasoning_options.length === 0 && model.reasoning === true) entry.reasoning = { kind: 'fixed' }
      }
      byId.set(id, entry)
      // models.dev explicitly supplies canonical identities for routed aliases.
      const canonical = text(model.canonical_model_id)
      if (canonical && normalizedId(canonical) !== normalizedId(id) && !byId.has(canonical)) byId.set(canonical, { ...entry, id: canonical })
    }
    models.push(...byId.values())
  }
  models.sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`))
  return { source: 'models.dev', sourceUrl, updatedAt, license, models }
}

function normalizedId(id: string): string { return id.toLowerCase().split('/').at(-1)! }
function undatedId(id: string): string { return normalizedId(id).replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{6})$/, '') }
function originalProviders(id: string): string[] {
  const prefix = id.includes('/') ? id.toLowerCase().split('/')[0] : undefined
  if (prefix) return [prefix]
  const model = normalizedId(id)
  if (/^(?:gpt-|chatgpt-|o[134](?:-|$))/.test(model)) return ['openai']
  if (model.startsWith('claude-')) return ['anthropic']
  if (model.startsWith('gemini-') || model.startsWith('gemma-')) return ['google']
  if (model.startsWith('deepseek-')) return ['deepseek']
  if (model.startsWith('glm-')) return ['zai', 'zhipuai']
  if (/^(?:kimi-|moonshot-)/.test(model)) return ['moonshotai', 'moonshotai-cn']
  if (model.startsWith('grok-')) return ['xai']
  if (model.startsWith('qwen')) return ['alibaba', 'alibaba-cn']
  if (model.startsWith('minimax')) return ['minimax', 'minimax-cn']
  if (model.startsWith('mimo-')) return ['xiaomi']
  return []
}

/** Public capability data is independent of user connections, credentials, billing and available models. */
export class ModelKnowledgeService {
  private snapshot: ModelKnowledgeSnapshot = bundledKnowledge as ModelKnowledgeSnapshot
  private readonly filename: string
  private readonly transport: typeof fetch
  private readonly now: () => Date
  private loaded?: Promise<void>
  private refreshing?: Promise<ModelKnowledgeEntry[]>
  private lastRefreshAttempt = 0

  constructor(options: { directory: string; fetch?: typeof fetch; now?: () => Date }) {
    this.filename = path.join(path.resolve(options.directory), 'model-knowledge-v1.json')
    this.transport = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
  }
  private load(): Promise<void> {
    return this.loaded ??= (async () => {
      try {
        const cached = JSON.parse(await fs.readFile(this.filename, 'utf8')) as ModelKnowledgeSnapshot
        if (cached.source === 'models.dev' && Array.isArray(cached.models) && cached.models.length
          && cached.models.every(entry => !!entry && typeof entry.id === 'string')
          && Number.isFinite(Date.parse(cached.updatedAt))) this.snapshot = cached
      } catch { /* Missing or unreadable cache uses the distributable snapshot. */ }
    })()
  }
  async knownModels(): Promise<ModelKnowledgeEntry[]> {
    await this.load()
    const now = this.now().getTime()
    if (now - Date.parse(this.snapshot.updatedAt) >= refreshInterval && now - this.lastRefreshAttempt >= refreshInterval) {
      void this.refresh()
    }
    return structuredClone(this.snapshot.models)
  }
  /** Refreshes shared public facts only; failure leaves model selection and usable cached facts intact. */
  refresh(): Promise<ModelKnowledgeEntry[]> {
    return this.refreshing ??= (async () => {
      await this.load()
      this.lastRefreshAttempt = this.now().getTime()
      try {
        const response = await this.transport(MODEL_KNOWLEDGE_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
        if (!response.ok) return structuredClone(this.snapshot.models)
        const next = normalizeModelKnowledge(await response.json(), this.now().toISOString())
        if (!next.models.length) return structuredClone(this.snapshot.models)
        this.snapshot = next
        try {
          await fs.mkdir(path.dirname(this.filename), { recursive: true })
          const temporary = `${this.filename}.tmp`
          await fs.writeFile(temporary, JSON.stringify(next), 'utf8')
          await fs.rename(temporary, this.filename)
        } catch { /* A read-only cache directory does not make the live facts unusable. */ }
      } catch { /* Offline or invalid public data must not block provider model discovery. */ }
      return structuredClone(this.snapshot.models)
    })().finally(() => { this.refreshing = undefined })
  }
  async find(connection: Pick<ModelConnectionSnapshot, 'provider'>, modelOrCapabilityRef: string, reference = false): Promise<ModelKnowledgeEntry | undefined> {
    const models = await this.knownModels()
    if (reference) {
      const explicit = findModelKnowledgeReference(models, modelOrCapabilityRef)
      if (explicit) return explicit
      const prefix = modelOrCapabilityRef.includes('/') ? modelOrCapabilityRef.split('/')[0]! : connection.provider
      return this.match(models, { provider: prefix }, modelOrCapabilityRef)
    }
    return this.match(models, connection, modelOrCapabilityRef)
  }
  private match(models: ModelKnowledgeEntry[], connection: Pick<ModelConnectionSnapshot, 'provider'>,
    modelOrCapabilityRef: string): ModelKnowledgeEntry | undefined {
    const provider = connection.provider.toLowerCase(), model = modelOrCapabilityRef.toLowerCase()
    const direct = models.find(entry => entry.provider?.toLowerCase() === provider && entry.id.toLowerCase() === model)
    if (direct) return direct
    const normalized = normalizedId(model), undated = undatedId(model)
    const sameProvider = models.filter(entry => entry.provider?.toLowerCase() === provider)
    const same = sameProvider.find(entry => normalizedId(entry.id) === normalized)
      ?? sameProvider.find(entry => normalizedId(entry.id) === undated)
    if (same) return same
    for (const original of originalProviders(model)) {
      const candidates = models.filter(entry => entry.provider?.toLowerCase() === original)
      const found = candidates.find(entry => normalizedId(entry.id) === normalized)
        ?? candidates.find(entry => normalizedId(entry.id) === undated)
      if (found) return found
    }
    // For a model not identified with an original lab, identical declarations across
    // providers are still useful; differing declarations need an explicit capability reference.
    const candidates = models.filter(entry => normalizedId(entry.id) === normalized)
    const signatures = new Set(candidates.map(entry => JSON.stringify({ ...entry, provider: undefined, id: normalized })))
    return signatures.size === 1 ? candidates[0] : undefined
  }
  async enrich(connection: Pick<ModelConnectionSnapshot, 'provider'>, models: DiscoveredModel[]): Promise<DiscoveredModel[]> {
    const known = await this.knownModels()
    return models.map(model => {
      const metadata = this.match(known, connection, model.id)
      const { metadata: previous, metadataSource, ...fields } = model
      const declared = metadataSource === 'models.dev' ? undefined : previous
      return metadata ? { ...fields, metadata: { ...metadata, ...declared }, metadataSource: declared ? metadataSource ?? 'directory' as const : 'models.dev' as const }
        : declared ? { ...fields, metadata: declared, ...(metadataSource ? { metadataSource } : {}) } : fields
    })
  }
}
