import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

/** A stable UTF-8 range read and streaming digest. Whole-file memory is optional. */
export async function readUtf8File(filename: string, options: {
  from?: number; limit?: number; onChunk?: (bytes: Uint8Array) => Promise<void>; maxCollectedBytes?: number
} = {}) {
  const [actual, entry] = await Promise.all([fs.realpath(filename), fs.lstat(filename)])
  const same = process.platform === 'win32' ? actual.toLowerCase() === filename.toLowerCase() : actual === filename
  if (!same || !entry.isFile() || entry.isSymbolicLink()) throw new Error('文件位置或类型已改变')
  const from = options.from ?? 0, limit = options.limit ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(from) || from < 0 || !(limit >= 0)) throw new Error('文本范围无效')
  const file = await fs.open(filename, 'r')
  const hash = createHash('sha256'), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let total = 0, byteLength = 0, collectedBytes = 0
  const parts: string[] = []
  const accept = (text: string) => {
    if (text.includes('\0')) throw new Error('文件含二进制零字节，不是可编辑的 UTF-8 源文')
    const start = Math.max(0, from - total), end = Math.min(text.length, from + limit - total)
    if (end > start) {
      const part = text.slice(start, end)
      collectedBytes += Buffer.byteLength(part)
      if (options.maxCollectedBytes !== undefined && collectedBytes > options.maxCollectedBytes)
        throw new Error('当前完整源文编辑超过可驻留范围；原件保留，可按范围读取或使用受控计算处理')
      parts.push(part)
    }
    total += text.length
  }
  try {
    const before = await file.stat({ bigint: true }), buffer = Buffer.alloc(64 * 1024)
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      const bytes = buffer.subarray(0, bytesRead)
      hash.update(bytes); byteLength += bytesRead
      accept(decoder.decode(bytes, { stream: true }))
      await options.onChunk?.(bytes)
    }
    accept(decoder.decode())
    const after = await file.stat({ bigint: true }), current = await fs.lstat(filename, { bigint: true })
    const unchanged = (a: typeof before, b: typeof before) => a.dev === b.dev && a.ino === b.ino
      && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode
    if (!unchanged(before, after) || !unchanged(after, current) || current.isSymbolicLink()) throw new Error('读取期间文件已改变，请重新读取')
    if (from > total) throw new Error('文本范围超过实际内容')
    return { text: parts.join(''), total, byteLength, version: `sha256:${hash.digest('hex')}`,
      mode: Number(before.mode), ...(before.ino ? { identity: `${before.dev}:${before.ino}` } : {}) }
  } finally { await file.close() }
}
