import type { ModelUsage } from './modelProvider'
export interface WebSearchHit { title: string; url: string; snippet: string; publishedAt?: string }
export interface SearchAttempt {
  provider: string
  connectionId?: string
  /** Actual model only when the provider reported it; requested identity remains separate. */
  model?: string
  requestedModel?: string
  providerRequestId?: string
  outcome: 'completed' | 'not-sent' | 'rejected' | 'unknown'
  usage?: ModelUsage
  error?: { code: string; message: string; httpStatus?: number }
}
export interface SearchProviderPage {
  provider: string
  results: readonly WebSearchHit[]
  nextCursor?: string
  providerRequestId?: string
  charge?: { amount: number; currency: string }
  execution?: { connectionId: string; model: string; billingKind?: string; inputTokens?: number; outputTokens?: number }
  attempts?: readonly SearchAttempt[]
  summary?: string
  citations?: readonly { url: string; title: string }[]
  diagnostics?: readonly string[]
}
export type WebSearchResult =
  | ({ status: 'results'; query: string; searchedAt: string } & SearchProviderPage)
  | { status: 'not-configured' | 'rejected' | 'failed'; reason: string; attempts?: readonly SearchAttempt[] }
