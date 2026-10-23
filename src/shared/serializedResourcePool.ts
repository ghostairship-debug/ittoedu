/** Single-file transport only. The published model and its logical resource IDs
 * are unchanged; exact string positions restore authored source before use. */
export interface SerializedResourcePool {
  version: 1
  content: string[]
  strings: Array<{ path: Array<string | number>; insertions: Array<[number, number]> }>
}

// Match the base64 carrier, including carriers inside compiled HTML/code strings.
// No authored token is used as a sentinel: only recorded offsets are restored.
const dataCarrier = /data:[^\s"'<>\\()]*?;base64,([a-zA-Z0-9+/]+={0,2})/gi

export function serializeResourcePool(value: unknown): { data: unknown; pool?: SerializedResourcePool } {
  const counts = new Map<string, number>()
  const visit = (item: unknown) => {
    if (typeof item === 'string') for (const match of item.matchAll(dataCarrier)) counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1)
    else if (Array.isArray(item)) item.forEach(visit)
    else if (item && typeof item === 'object') Object.values(item).forEach(visit)
  }
  visit(value)
  if (![...counts.values()].some(count => count > 1)) return { data: value }
  const pool: SerializedResourcePool = { version: 1, content: [], strings: [] }, indices = new Map<string, number>()
  const encode = (item: unknown, path: Array<string | number>): unknown => {
    if (typeof item === 'string') {
      let result = '', start = 0
      const insertions: Array<[number, number]> = []
      for (const match of item.matchAll(dataCarrier)) {
        const content = match[1]!
        if ((counts.get(content) ?? 0) < 2) continue
        const position = match.index! + match[0].length - content.length
        result += item.slice(start, position)
        let index = indices.get(content)
        if (index === undefined) { index = pool.content.length; indices.set(content, index); pool.content.push(content) }
        insertions.push([result.length, index]); start = position + content.length
      }
      if (!insertions.length) return item
      pool.strings.push({ path, insertions })
      return result + item.slice(start)
    }
    if (Array.isArray(item)) return item.map((entry, index) => encode(entry, [...path, index]))
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, encode(entry, [...path, key])]))
    return item
  }
  const data = encode(value, [])
  return { data, ...(pool.strings.length ? { pool } : {}) }
}

/** Kept closure-free so the exact decoder can also run before the player bundle. */
export function restoreSerializedResourcePool(data: unknown, pool?: SerializedResourcePool): unknown {
  if (!pool) return data
  if (pool.version !== 1 || !Array.isArray(pool.content) || !Array.isArray(pool.strings)) throw new Error('课件内嵌资源表无效')
  for (const entry of pool.strings) {
    if (!Array.isArray(entry.path) || !entry.path.length || !Array.isArray(entry.insertions)) throw new Error('课件内嵌资源位置无效')
    let parent = data as Record<string | number, unknown>
    for (const key of entry.path.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.prototype.hasOwnProperty.call(parent, key)) throw new Error('课件内嵌资源路径无效')
      parent = parent[key] as Record<string | number, unknown>
    }
    const key = entry.path[entry.path.length - 1]!
    if (!parent || typeof parent !== 'object' || !Object.prototype.hasOwnProperty.call(parent, key) || typeof parent[key] !== 'string') throw new Error('课件内嵌资源字符串无效')
    const original = parent[key] as string
    let result = '', start = 0
    for (const [position, index] of entry.insertions) {
      if (!Number.isInteger(position) || position < start || position > original.length || !Number.isInteger(index) || typeof pool.content[index] !== 'string') throw new Error('课件内嵌资源引用无效')
      result += original.slice(start, position) + pool.content[index]; start = position
    }
    parent[key] = result + original.slice(start)
  }
  return data
}
