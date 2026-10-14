import { zlibSync } from 'fflate'

/** Valid deterministic PNG bytes for output-consumer tests, with no decoder dependency. */
export function auditExportPng(width = 2, height = 1, pixel: (x: number, y: number) => [number, number, number, number] = () => [255, 255, 255, 255]) {
  const chunk = (tag: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer)
    view.setUint32(0, data.length); bytes.set(Array.from(tag, character => character.charCodeAt(0)), 4); bytes.set(data, 8)
    let crc = 0xffffffff
    for (const value of bytes.subarray(4, -4)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1 }
    view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0)
    return bytes
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6], 8)
  const pixels = new Uint8Array((width * 4 + 1) * height)
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) pixels.set(pixel(column, row), row * (width * 4 + 1) + 1 + column * 4)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(pixels)), chunk('IEND', new Uint8Array())]
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
