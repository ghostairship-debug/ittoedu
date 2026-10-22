import { createHash } from 'node:crypto'

export const JOURNAL_MAGIC = Buffer.from('G20JNL01')
export const JOURNAL_COMMIT = Buffer.from('G20DONE!')
export const JOURNAL_HEADER_SIZE = 48

/** Framing is shared by Main append and the pure checkpoint worker. */
export function recordDocumentJournalPayload(payload: Uint8Array): Buffer {
  if (payload.length > 0xffffffff) throw new Error('恢复记录超出支持大小')
  const header = Buffer.alloc(JOURNAL_HEADER_SIZE)
  JOURNAL_MAGIC.copy(header)
  header.writeUInt32BE(payload.length, 8)
  header.writeUInt32BE((~payload.length) >>> 0, 12)
  createHash('sha256').update(payload).digest().copy(header, 16)
  return Buffer.concat([header, payload, JOURNAL_COMMIT])
}
