/** Session models are immutable. Equal owned buffers and subtrees need no scan or allocation. */
export function documentEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  const leftBytes = Object.prototype.toString.call(left) === '[object Uint8Array]'
  const rightBytes = Object.prototype.toString.call(right) === '[object Uint8Array]'
  if (leftBytes || rightBytes) {
    if (!leftBytes || !rightBytes) return false
    const a = left as Uint8Array, b = right as Uint8Array
    if (a.byteLength !== b.byteLength) return false
    for (let index = 0; index < a.byteLength; index++) if (a[index] !== b[index]) return false
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => documentEqual(value, right[index]))
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>, keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && documentEqual(a[key], b[key]))
}
