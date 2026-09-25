/** Recently used colours are a per-viewer convenience; storage may be missing or throw, and nothing depends on it. */
export type RecentColorKind = 'color' | 'highlight'

const LIMIT = 8
const key = (kind: RecentColorKind) => `guoling.recent-colors.${kind}.v1`
const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value)

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function readRecentColors(kind: RecentColorKind): string[] {
  try {
    const raw = storage()?.getItem(key(kind))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isHex).slice(0, LIMIT) : []
  } catch { return [] }
}

export function rememberRecentColor(kind: RecentColorKind, color: string): string[] {
  const value = color.toLowerCase()
  if (!isHex(value)) return readRecentColors(kind)
  const next = [value, ...readRecentColors(kind).filter(item => item !== value)].slice(0, LIMIT)
  try { storage()?.setItem(key(kind), JSON.stringify(next)) } catch { /* the list only lives for this view */ }
  return next
}
