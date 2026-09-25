import type { ModelJsonObject } from '../../../shared/workbench/modelProvider'

const object = (value: unknown): value is ModelJsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)

export function decodeImageBase64(payload: unknown): { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; extension: string } {
  if (typeof payload !== 'string' || !payload.length || payload.length > 90 * 1024 * 1024
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) throw new Error('invalid-image-base64')
  const bytes = Buffer.from(payload, 'base64')
  if (bytes.toString('base64') !== payload) throw new Error('noncanonical-image-base64')
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { bytes, mimeType: 'image/png', extension: 'png' }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { bytes, mimeType: 'image/jpeg', extension: 'jpg' }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { bytes, mimeType: 'image/webp', extension: 'webp' }
  throw new Error('unsupported-generated-image')
}

export async function readBoundedImageJson(response: Response, maxBytes: number): Promise<ModelJsonObject> {
  if (!response.body) throw new Error('missing-image-body')
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maxBytes) throw new Error('image-response-too-large')
      chunks.push(Buffer.from(chunk.value))
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!object(parsed) || !Number.isSafeInteger(parsed.created) || Number(parsed.created) < 0
    || !Array.isArray(parsed.data) || parsed.data.length < 1 || parsed.data.length > 4 || !parsed.data.every(object)
    || parsed.error != null) throw new Error('invalid-image-response')
  return parsed
}
