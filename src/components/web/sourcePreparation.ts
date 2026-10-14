import type { WebRuntimeData } from './moduleGraph'

/** Data preparation is independent from execution; only the loaded Source selects its document. */
export function hasWebContentData(data: unknown): data is WebRuntimeData {
  return !!data && typeof data === 'object' && !Array.isArray(data) && typeof (data as { html?: unknown }).html === 'string'
}
