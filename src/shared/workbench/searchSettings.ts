import { z } from 'zod'
import type { ModelJson, ModelConnectionSnapshot } from './modelProvider'
const json: z.ZodType<ModelJson> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(z.string(), json)]))
const selection = z.object({ connectionId: z.string().trim().min(1), model: z.string().trim().min(1),
  parameters: z.record(z.string(), json).optional(), capabilityModel: z.string().trim().min(1).optional() }).strict()
export const searchSettingsSchema = z.object({
  mode: z.enum(['auto', 'openai', 'deepseek', 'independent', 'off']).default('auto'),
  openai: selection.nullable().default(null), deepseek: selection.nullable().default(null),
  independent: z.enum(['exa', 'searxng']).default('exa'),
  searxngURL: z.string().trim().default('').refine(value => {
    if (!value) return true
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash }
    catch { return false }
  }, 'SearXNG 地址须为不含凭据的 HTTP(S) 实例地址'),
}).strict()
export type SearchSettings = Omit<z.infer<typeof searchSettingsSchema>, 'openai' | 'deepseek'> & {
  openai: import('./executionSettings').ExecutionRoleSelection | null
  deepseek: import('./executionSettings').ExecutionRoleSelection | null
}
export const defaultSearchSettings = (): SearchSettings => ({ mode: 'auto', openai: null, deepseek: null, independent: 'exa', searxngURL: '' })
export function supportsOpenAISearch(connection: ModelConnectionSnapshot): boolean {
  try {
    return connection.provider === 'openai' && (connection.protocol === 'chatgpt-responses' && connection.auth.kind === 'oauth'
      && connection.baseURL === 'https://chatgpt.com/backend-api/codex'
      || connection.protocol === 'openai-responses' && connection.auth.kind === 'api-key' && new URL(connection.baseURL).origin === 'https://api.openai.com')
  } catch { return false }
}
