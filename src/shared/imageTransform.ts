import { unzlibSync, zlibSync } from 'fflate'
import { MAX_IMAGE_TRANSFORM_PIXELS } from './imageTransformContract'

export interface ImagePixels { readonly width: number; readonly height: number; readonly data: Uint8Array }
interface PngMetadata { type: string; bytes: Uint8Array }
export interface DecodedImage extends ImagePixels { metadata?: PngMetadata[] }
export class ImageTransformSourceError extends Error {
  readonly code: 'image-source-unsupported' | 'image-source-decode-failed'
  constructor(readonly status: 'unsupported' | 'failed', message: string) {
    super(message)
    this.name = 'ImageTransformSourceError'
    this.code = status === 'unsupported' ? 'image-source-unsupported' : 'image-source-decode-failed'
  }
}
export type ImageTransformSourceInspection =
  | { status: 'ready'; width: number; height: number }
  | { status: 'unsupported' | 'failed'; code: ImageTransformSourceError['code']; message: string }
const signature = [137, 80, 78, 71, 13, 10, 26, 10]
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
export function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_IMAGE_TRANSFORM_PIXELS) {
    throw new Error('图片尺寸无效或超过 1600 万像素')
  }
}
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}
function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0
  for (let offset = 0; offset < bytes.length;) {
    const end = Math.min(offset + 5552, bytes.length)
    for (; offset < end; offset++) { a += bytes[offset]!; b += a }
    a %= 65521; b %= 65521
  }
  return ((b << 16) | a) >>> 0
}
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, bytes) => sum + bytes.length, 0))
  let offset = 0
  for (const bytes of parts) { result.set(bytes, offset); offset += bytes.length }
  return result
}
function chunk(type: string, bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length + 12), view = new DataView(result.buffer)
  view.setUint32(0, bytes.length)
  result.set(new TextEncoder().encode(type), 4); result.set(bytes, 8)
  view.setUint32(result.length - 4, crc(result.subarray(4, result.length - 4)))
  return result
}

/** PNG stays unpremultiplied, including RGB hidden beneath zero alpha. */
export function encodeImageTransformPng(image: ImagePixels, metadata: readonly PngMetadata[] = []): Uint8Array {
  dimensions(image.width, image.height)
  if (image.data.length !== image.width * image.height * 4) throw new Error('RGBA 像素长度与尺寸不匹配')
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, image.width); view.setUint32(4, image.height); header[8] = 8; header[9] = 6
  const stride = image.width * 4, scanlines = new Uint8Array((stride + 1) * image.height)
  for (let row = 0; row < image.height; row++) scanlines.set(image.data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1)
  return concat([Uint8Array.from(signature), chunk('IHDR', header), ...metadata.map(item => chunk(item.type, item.bytes)),
    chunk('IDAT', zlibSync(scanlines)), chunk('IEND', new Uint8Array())])
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c)
  return da <= db && da <= dc ? a : db <= dc ? b : c
}

// PNG filter/Adam7 rules: https://www.w3.org/TR/png-3/#9Filters
export function decodeImageTransformPng(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 45 || signature.some((byte, i) => bytes[i] !== byte)) throw new Error('原图不是有效 PNG')
  let offset = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0, ended = false
  let palette: Uint8Array | undefined, transparency: Uint8Array | undefined
  const compressed: Uint8Array[] = [], metadata: PngMetadata[] = []
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset), length = view.getUint32(0)
    if (length > bytes.length - offset - 12) throw new Error('PNG 数据块不完整')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)), data = bytes.subarray(offset + 8, offset + 8 + length)
    if (crc(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(8 + length)) throw new Error(`PNG 数据块校验失败：${type}（偏移 ${offset}）`)
    if (offset === 8 && type !== 'IHDR') throw new Error('PNG 缺少首部')
    if (type === 'IHDR') {
      if (width || length !== 13) throw new Error('PNG 首部无效')
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = header.getUint32(0); height = header.getUint32(4); dimensions(width, height)
      depth = data[8]!; color = data[9]!; interlace = data[12]!
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8], 2: [8], 3: [1, 2, 4, 8], 4: [8], 6: [8] }
      if (depth === 16) throw new ImageTransformSourceError('unsupported', '16 位 PNG 需要先转为 8 位图片；当前操作不会静默丢失颜色精度')
      if (!depths[color]?.includes(depth) || data[10] || data[11] || interlace > 1) throw new Error('PNG 像素格式无效')
    } else if (type === 'acTL') throw new ImageTransformSourceError('unsupported', '动画图片需要明确逐帧编辑范围，当前操作仅支持静态图片')
    else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') transparency = data
    else if (type === 'IDAT') compressed.push(data)
    else if (type === 'IEND') { ended = true; break }
    else if (['cHRM', 'gAMA', 'iCCP', 'sRGB', 'cICP', 'pHYs'].includes(type)) metadata.push({ type, bytes: data.slice() })
    else if (type[0] === type[0]!.toUpperCase()) throw new Error(`不支持的 PNG 关键数据块 ${type}`)
    offset += length + 12
  }
  if (!ended || !compressed.length || (color === 3 && (!palette || palette.length % 3 !== 0))) throw new Error('PNG 缺少完整图像数据')
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 4 ? 2 : 1
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
  const passInfo = passes.map(([x, y, dx, dy]) => ({ x: x!, y: y!, dx: dx!, dy: dy!,
    width: Math.max(0, Math.ceil((width - x!) / dx!)), height: Math.max(0, Math.ceil((height - y!) / dy!)) }))
  const expected = passInfo.reduce((sum, pass) => sum + (pass.width ? pass.height * (1 + Math.ceil(pass.width * channels * depth / 8)) : 0), 0)
  const zlib = concat(compressed)
  if (zlib.length < 6) throw new Error('PNG IDAT zlib 数据不完整')
  let raw: Uint8Array
  try { raw = unzlibSync(zlib, { out: new Uint8Array(expected + 1) }) }
  catch { throw new Error('PNG IDAT 像素无法解压') }
  if (raw.length !== expected) throw new Error('PNG 像素长度无效')
  // fflate checks zlib framing but does not validate its Adler-32 trailer.
  if (adler32(raw) !== new DataView(zlib.buffer, zlib.byteOffset, zlib.byteLength).getUint32(zlib.length - 4)) {
    throw new Error('PNG IDAT zlib 校验失败（Adler-32）')
  }
  const rgba = new Uint8Array(width * height * 4), bpp = Math.max(1, channels * depth / 8)
  let at = 0
  for (const pass of passInfo) {
    if (!pass.width || !pass.height) continue
    const stride = Math.ceil(pass.width * channels * depth / 8)
    let previous = new Uint8Array(stride)
    for (let y = 0; y < pass.height; y++) {
      const filter = raw[at++]!
      if (filter > 4) throw new Error('PNG 行过滤器无效')
      const row = raw.slice(at, at + stride); at += stride
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0, b = previous[i]!, c = i >= bpp ? previous[i - bpp]! : 0
        row[i] = (row[i]! + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c))) & 255
      }
      const sample = (i: number) => depth === 8 ? row[i]! : (row[Math.floor(i * depth / 8)]! >> (8 - depth - (i * depth % 8))) & ((1 << depth) - 1)
      const transparencyView = transparency ? new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength) : null
      for (let x = 0; x < pass.width; x++) {
        const to = ((pass.y + y * pass.dy) * width + pass.x + x * pass.dx) * 4, i = x * channels, first = sample(i)
        if (color === 3) {
          if (first * 3 + 2 >= palette!.length) throw new Error('PNG 调色板索引无效')
          rgba.set(palette!.subarray(first * 3, first * 3 + 3), to); rgba[to + 3] = transparency?.[first] ?? 255
        } else if (color === 0 || color === 4) {
          rgba.fill(Math.round(first * 255 / ((1 << depth) - 1)), to, to + 3)
          rgba[to + 3] = color === 4 ? sample(i + 1) : transparencyView?.byteLength === 2 && first === transparencyView.getUint16(0) ? 0 : 255
        } else {
          rgba[to] = first; rgba[to + 1] = sample(i + 1); rgba[to + 2] = sample(i + 2)
          rgba[to + 3] = color === 6 ? sample(i + 3) : transparencyView?.byteLength === 6
            && first === transparencyView.getUint16(0) && sample(i + 1) === transparencyView.getUint16(2) && sample(i + 2) === transparencyView.getUint16(4) ? 0 : 255
        }
      }
      previous = row
    }
  }
  return { width, height, data: rgba, metadata }
}

