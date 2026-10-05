export function flowImageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mimeType === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    const width = view.getUint32(16), height = view.getUint32(20)
    return width > 0 && height > 0 ? { width, height } : undefined
  }
  if (mimeType === 'image/gif' && bytes.length >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
    const width = view.getUint16(6, true), height = view.getUint16(8, true)
    return width > 0 && height > 0 ? { width, height } : undefined
  }
  if (mimeType === 'image/webp' && bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4))
      const length = view.getUint32(offset + 4, true)
      const start = offset + 8
      if (start + length > bytes.length) break
      if (kind === 'VP8X' && length >= 10) {
        const width = 1 + bytes[start + 4]! + (bytes[start + 5]! << 8) + (bytes[start + 6]! << 16)
        const height = 1 + bytes[start + 7]! + (bytes[start + 8]! << 8) + (bytes[start + 9]! << 16)
        return { width, height }
      }
      if (kind === 'VP8L' && length >= 5 && bytes[start] === 47) {
        const width = 1 + bytes[start + 1]! + ((bytes[start + 2]! & 63) << 8)
        const height = 1 + (bytes[start + 2]! >> 6) + (bytes[start + 3]! << 2) + ((bytes[start + 4]! & 15) << 10)
        return { width, height }
      }
      if (kind === 'VP8 ' && length >= 10 && bytes[start + 3] === 157 && bytes[start + 4] === 1 && bytes[start + 5] === 42) {
        const width = view.getUint16(start + 6, true) & 16383, height = view.getUint16(start + 8, true) & 16383
        return width > 0 && height > 0 ? { width, height } : undefined
      }
      offset = start + length + (length & 1)
    }
  }
  if (mimeType === 'image/svg+xml') {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
    const root = /<svg\b([^>]*)>/i.exec(new TextDecoder(encoding, { fatal: true }).decode(bytes))?.[1]
    if (!root) return undefined
    const attribute = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*([\"'])(.*?)\\1`, 'i').exec(root)?.[2]
    const length = (name: string): number | undefined => {
      const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(px|in|cm|mm|pt|pc)?\s*$/i.exec(attribute(name) ?? '')
      if (!match) return undefined
      const scale: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16 }
      const value = Number(match[1]) * scale[(match[2] ?? 'px').toLowerCase()]!
      return value > 0 ? value : undefined
    }
    const viewBox = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    const boxWidth = viewBox?.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0 ? viewBox[2]! : undefined
    const boxHeight = boxWidth ? viewBox![3]! : undefined
    const width = length('width'), height = length('height')
    if (width && height) return { width, height }
    if (width && boxWidth && boxHeight) return { width, height: width * boxHeight / boxWidth }
    if (height && boxWidth && boxHeight) return { width: height * boxWidth / boxHeight, height }
    if (boxWidth && boxHeight) return { width: boxWidth, height: boxHeight }
    return { width: width ?? 300, height: height ?? 150 }
  }
  if (mimeType === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break
      while (bytes[offset] === 255) offset += 1
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218 || marker === undefined || offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5)
        return width > 0 && height > 0 ? { width, height } : undefined
      }
      offset += length
    }
  }
  return undefined
}

