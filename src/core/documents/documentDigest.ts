import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

/** Tagged encoding keeps bytes distinct from user objects and ignores key order. */
function encode(value: unknown): unknown {
  if (value === null) return ['null']
  if (value instanceof Uint8Array) return ['bytes', Array.from(value)]
  if (Array.isArray(value)) return ['array', value.map(encode)]
  if (typeof value === 'object') {
    return ['object', Object.keys(value).sort().map(key => [key, encode((value as Record<string, unknown>)[key])])]
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('文档操作包含无效数字')
  if (['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return [typeof value, value]
  throw new TypeError('文档操作只能包含可序列化的数据')
}

export function documentDigest(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(encode(value)))))
}
