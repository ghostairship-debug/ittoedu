import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

/** Tagged encoding keeps bytes distinct from user objects and ignores key order. */
function encode(value: unknown, compactBytes = false): unknown {
  if (value === null) return ['null']
  if (Object.prototype.toString.call(value) === '[object Uint8Array]') {
    const bytes = value as Uint8Array
    return compactBytes ? ['bytes', bytes.byteLength, bytesToHex(sha256(bytes))] : ['bytes', Array.from(bytes)]
  }
  if (Array.isArray(value)) return ['array', value.map(item => encode(item, compactBytes))]
  if (typeof value === 'object') {
    return ['object', Object.keys(value).sort().map(key => [key, encode((value as Record<string, unknown>)[key], compactBytes)])]
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('文档操作包含无效数字')
  if (['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return [typeof value, value]
  throw new TypeError('文档操作只能包含可序列化的数据')
}

export function documentDigest(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(encode(value)))))
}

/** Versioned Session request identity; resource views hash in place without numeric JSON copies. */
export function documentOperationDigest(value: unknown): string {
  return `op-v2:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(encode(value, true)))))}`
}
