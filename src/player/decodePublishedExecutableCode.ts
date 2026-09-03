import type { PublishedCourseExecutableCode } from '../shared/publishedCourseTypes'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeBase64Bytes(value: string, label: string): Uint8Array {
  const normalized = value.replace(/\s/g, '')
  if (
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error(`${label}的编码无效`)
  }
  const padding = normalized.endsWith('==')
    ? 2
    : normalized.endsWith('=')
      ? 1
      : 0
  const bytes = new Uint8Array((normalized.length / 4) * 3 - padding)
  const chunkSize = 32_768
  let byteOffset = 0
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    const binary = atob(normalized.slice(offset, offset + chunkSize))
    for (let index = 0; index < binary.length; index += 1) {
      bytes[byteOffset] = binary.charCodeAt(index)
      byteOffset += 1
    }
  }
  return bytes
}

export function decodePublishedCode(
  encoded: PublishedCourseExecutableCode,
  label = '发布代码',
): string {
  if (
    !isRecord(encoded) ||
    encoded.encoding !== 'base64-utf16le' ||
    typeof encoded.data !== 'string'
  ) {
    throw new Error(`${label}的编码格式不受支持`)
  }
  const bytes = decodeBase64Bytes(encoded.data, label)
  if (bytes.length % 2 !== 0) {
    throw new Error(`${label}的 UTF-16 数据不完整`)
  }
  const chunks: string[] = []
  const chunkSize = 16_384
  for (let offset = 0; offset < bytes.length; offset += chunkSize * 2) {
    const end = Math.min(offset + chunkSize * 2, bytes.length)
    const codeUnits = new Uint16Array((end - offset) / 2)
    for (let byteIndex = offset, unitIndex = 0; byteIndex < end; byteIndex += 2) {
      codeUnits[unitIndex] =
        (bytes[byteIndex] ?? 0) | ((bytes[byteIndex + 1] ?? 0) << 8)
      unitIndex += 1
    }
    chunks.push(String.fromCharCode(...codeUnits))
  }
  return chunks.join('')
}
