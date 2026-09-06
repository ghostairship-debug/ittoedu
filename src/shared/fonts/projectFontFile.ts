export const MAX_PROJECT_FONT_BYTES = 32 * 1024 * 1024

/** Inspect the actual container, never infer font kind from a media extension. */
export function inspectProjectFont(bytes: Uint8Array): { mimeType: string; extension: string } {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_PROJECT_FONT_BYTES) throw new Error('字体文件应为 12 字节至 32 MB')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const signature = view.getUint32(0)
  if (signature === 0x774f4632 || signature === 0x774f4646) {
    const woff2 = signature === 0x774f4632
    const headerSize = woff2 ? 48 : 44
    if (bytes.length < headerSize || view.getUint32(8) !== bytes.length || view.getUint16(12) === 0 || view.getUint16(14) !== 0) throw new Error('WOFF 字体头或文件长度无效')
    if (woff2) {
      if (view.getUint32(20) === 0 || view.getUint32(20) > bytes.length - headerSize) throw new Error('WOFF2 压缩数据长度无效')
    } else {
      const count = view.getUint16(12)
      if (44 + count * 20 > bytes.length) throw new Error('WOFF 字体表目录不完整')
      for (let i = 0; i < count; i++) {
        const offset = view.getUint32(44 + i * 20 + 4)
        const length = view.getUint32(44 + i * 20 + 8)
        if (offset < 44 + count * 20 || offset + length > bytes.length) throw new Error('WOFF 字体表超出文件边界')
      }
    }
    return { mimeType: woff2 ? 'font/woff2' : 'font/woff', extension: woff2 ? 'woff2' : 'woff' }
  }
  if (signature !== 0x00010000 && signature !== 0x4f54544f) throw new Error('仅支持 WOFF2、WOFF、TTF 和 OTF 字体')
  const count = view.getUint16(4)
  if (count === 0 || 12 + count * 16 > bytes.length) throw new Error('字体表目录无效')
  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(12 + i * 16 + 8)
    const length = view.getUint32(12 + i * 16 + 12)
    if (offset < 12 + count * 16 || offset + length > bytes.length) throw new Error('字体表超出文件边界')
  }
  return signature === 0x4f54544f ? { mimeType: 'font/otf', extension: 'otf' } : { mimeType: 'font/ttf', extension: 'ttf' }
}
