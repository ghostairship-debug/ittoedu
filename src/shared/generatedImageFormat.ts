/** Bytes, never a caller-supplied extension, select the image decoder. */
export function generatedImageFormat(bytes: Uint8Array): { mimeType: string; animated: boolean } {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  const ascii = (from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length))
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) {
    let animated = false
    for (let at = 8; at + 12 <= bytes.length;) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0)
      if (length > bytes.length - at - 12) break
      if (ascii(at + 4, 4) === 'acTL') animated = true
      at += 12 + length
    }
    return { mimeType: 'image/png', animated }
  }
  if (starts(255, 216, 255)) return { mimeType: 'image/jpeg', animated: false }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    let animated = false
    for (let at = 12; at + 8 <= bytes.length;) {
      const type = ascii(at, 4), length = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0, true)
      if (length > bytes.length - at - 8) break
      if (type === 'ANIM' || (type === 'VP8X' && (bytes[at + 8]! & 2))) animated = true
      at += 8 + length + (length & 1)
    }
    return { mimeType: 'image/webp', animated }
  }
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { mimeType: 'image/gif', animated: true }
  const encoding = starts(255, 254) ? 'utf-16le' : starts(254, 255) ? 'utf-16be' : 'utf-8'
  const prefix = new TextDecoder(encoding).decode(bytes.subarray(0, 4096))
  if (/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/.test(prefix)) return { mimeType: 'image/svg+xml', animated: false }
  throw new Error('素材不是受支持的真实 PNG、JPEG、WebP、GIF 或 SVG 图片')
}
