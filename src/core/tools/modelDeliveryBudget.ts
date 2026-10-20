import type { ToolResult } from '../../shared/workbench/tools'

/** A delivery budget, never a limit on the value retained by its original owner. */
export const MODEL_DELIVERY_BYTES = 24_000
const utf8 = new TextEncoder()
export const modelJsonBytes = (value: unknown): number => utf8.encode(JSON.stringify(value) ?? 'null').byteLength
export type ModelValuePath = (string | number)[]
export interface ModelValueOmission { path: ModelValuePath; type: string; total?: number; nextOffset?: number }
export interface ModelValuePage {
  value: unknown
  complete: boolean
  path: ModelValuePath
  offset?: number
  total?: number
  nextOffset?: number
  omitted?: ModelValueOmission[]
}

/** Largest exact UTF-16 range whose JSON encoding fits; never bisects a surrogate pair. */
export function modelTextEnd(text: string, offset: number, end: number, maxBytes: number): number {
  let low = offset, high = end
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2)
    if (modelJsonBytes(text.slice(offset, middle)) <= maxBytes) low = middle
    else high = middle - 1
  }
  if (low < text.length && low > offset && /[\uD800-\uDBFF]/.test(text[low - 1]!) && /[\uDC00-\uDFFF]/.test(text[low]!)) low--
  return low
}

/**
 * A bounded structural preview. Omissions name exact paths in the unchanged source.
 * offset/limit selects array items, string characters, or object keys; a large
 * single item is recursively previewed instead of escaping an item-count limit.
 */
export function boundedModelValue(value: unknown, options: { maxBytes?: number; path?: ModelValuePath; offset?: number; limit?: number; prioritizeScalars?: boolean } = {}): ModelValuePage {
  const maxBytes = Math.max(1024, Math.floor(options.maxBytes ?? MODEL_DELIVERY_BYTES)), path = options.path ?? []
  const ranged = typeof value === 'string' || !!value && typeof value === 'object'
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : undefined
  const total = typeof value === 'string' || Array.isArray(value) ? value.length : keys?.length
  const offset = options.offset ?? 0
  const requestedEnd = total === undefined ? undefined : Math.min(total, offset + (options.limit ?? total))
  const selected = typeof value === 'string' || Array.isArray(value) ? value.slice(offset, requestedEnd)
    : keys ? Object.fromEntries(keys.slice(offset, requestedEnd).map(key => [key, (value as Record<string, unknown>)[key]])) : value
  const range = ranged && total !== undefined ? { offset, total } : {}
  const full: ModelValuePage = { value: selected, complete: requestedEnd === undefined || requestedEnd === total, path, ...range,
    ...(requestedEnd !== undefined && requestedEnd < total! ? { nextOffset: requestedEnd } : {}) }
  if (modelJsonBytes(full) <= maxBytes) return full

  // The fixed metadata reserve is included in the final encoded-size check below.
  const make = (budget: number): ModelValuePage => {
    const omitted: ModelValueOmission[] = []
    const omit = (item: unknown, at: ModelValuePath, nextOffset?: number) => {
      omitted.push({ path: at, type: item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item,
        ...(typeof item === 'string' || Array.isArray(item) ? { total: item.length } : item && typeof item === 'object' ? { total: Object.keys(item).length } : {}),
        ...(nextOffset !== undefined ? { nextOffset } : {}) })
    }
    const visit = (item: unknown, at: ModelValuePath, bytes: number, depth: number): unknown => {
      if (modelJsonBytes(item) <= bytes) return item
      if (typeof item === 'string') {
        const end = modelTextEnd(item, 0, item.length, Math.max(2, bytes - 180))
        omit(item, at, end); return item.slice(0, end)
      }
      if (!item || typeof item !== 'object' || depth >= 16 || bytes < 320 || omitted.length >= 24) { omit(item, at); return null }
      const array = Array.isArray(item), result: unknown[] | Record<string, unknown> = array ? [] : {}
      // Short scalar facts survive even when an earlier content property is huge.
      // This is structural ordering, not a blacklist of author/user field names.
      const names = array ? item.map((_, index) => index) : Object.keys(item).sort((left, right) => {
        if (!options.prioritizeScalars) return 0
        const small = (key: string) => {
          const child = (item as Record<string, unknown>)[key]
          return child === null || typeof child !== 'object' && (typeof child !== 'string' || modelJsonBytes(child) <= 512) ? 0 : 1
        }
        return small(left) - small(right)
      })
      let used = 2, taken = 0
      for (const key of names) {
        const keyBytes = array ? 0 : modelJsonBytes(String(key)) + 1
        if (bytes - used - keyBytes < 320 || taken >= 64 || omitted.length >= 24) break
        const childPath = [...at, array && at.length === path.length ? Number(key) + offset : key]
        const remaining = bytes - used - keyBytes - 1
        const next = visit((item as Record<string | number, unknown>)[key], childPath, Math.max(160, Math.floor(remaining / 2)), depth + 1)
        if (array) (result as unknown[]).push(next)
        else (result as Record<string, unknown>)[String(key)] = next
        used += modelJsonBytes(next) + keyBytes + 1; taken++
      }
      // A reordered public receipt is addressed by field path. Its object-key
      // cursor must not pretend the original insertion order was reordered too.
      if (taken < names.length) omit(item, at, !array && options.prioritizeScalars ? undefined : taken + (at.length === path.length ? offset : 0))
      return result
    }
    const preview = visit(selected, path, budget, 0)
    const rootOmission = omitted.find(item => item.path.length === path.length)
    if (rootOmission && typeof selected === 'string' && rootOmission.nextOffset !== undefined) rootOmission.nextOffset += offset
    return { value: preview, complete: false, path, ...range,
      ...(rootOmission?.nextOffset !== undefined ? { nextOffset: rootOmission.nextOffset } : requestedEnd !== undefined && requestedEnd < total! ? { nextOffset: requestedEnd } : {}), omitted }
  }
  let budget = Math.max(128, maxBytes - 1800), page = make(budget)
  while (modelJsonBytes(page) > maxBytes && budget > 128) { budget = Math.max(128, Math.floor(budget / 2)); page = make(budget) }
  if (modelJsonBytes(page) > maxBytes) return { value: null, complete: false, path: [], omitted: [{ path: [], type: 'source' }] }
  return page
}

export interface ModelDeliverySource { sourceId?: string; tool?: string; input?: Record<string, unknown> }
/** Last public boundary for direct tools, MCP and historical results. Raw records are never mutated. */
export function boundedToolResult(name: string, result: ToolResult, source?: ModelDeliverySource): ToolResult {
  if (modelJsonBytes(result) <= MODEL_DELIVERY_BYTES) return result
  const page = boundedModelValue(result, { maxBytes: MODEL_DELIVERY_BYTES - 1500, prioritizeScalars: true })
  const { value: preview, ...delivery } = page
  const record = result.kind === 'read' && result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : undefined
  const diagnostics = [record?.diagnostics, record?.errors, record?.failures].filter(Array.isArray).flat() as Record<string, unknown>[]
  const severities: Record<string, number> = {}
  for (const item of diagnostics) if (item && typeof item === 'object') {
    const raw = typeof item.level === 'string' ? item.level : typeof item.severity === 'string' ? item.severity : 'unspecified'
    const severity = ['fatal', 'error', 'warning', 'info', 'debug'].includes(raw) ? raw : 'unspecified'
    severities[severity] = (severities[severity] ?? 0) + 1
  }
  return { ...(preview as object), kind: result.kind, modelDelivery: { ...delivery, complete: false, tool: name,
    ...(diagnostics.length ? { diagnostics: { total: diagnostics.length, severities } } : {}), ...(source ? { source } : {}),
    notice: source ? '有界公开片段；完整内容保留于原来源，按来源和 omitted 的 path/范围续读。未展示不表示全部成功。'
      : '有界公开片段；完整内容保留于原工具 owner。本回执未提供精确回读来源，未展示不表示全部成功或已经读取。',
  } } as unknown as ToolResult
}
