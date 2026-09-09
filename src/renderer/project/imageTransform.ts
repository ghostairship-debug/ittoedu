import { unzlibSync, zlibSync } from 'fflate'
import { imageTransformInputSchema, MAX_IMAGE_TRANSFORM_PIXELS, type ImageTransformInput } from '../../shared/imageTransformContract'

export interface ImagePixels { readonly width: number; readonly height: number; readonly data: Uint8Array }
interface PngMetadata { type: string; bytes: Uint8Array }
interface DecodedImage extends ImagePixels { metadata?: PngMetadata[] }
const signature = [137, 80, 78, 71, 13, 10, 26, 10]
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('图片变换已停止') }
function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_IMAGE_TRANSFORM_PIXELS) {
    throw new Error('图片尺寸无效或超过 1600 万像素')
  }
}
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
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
    if (crc(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(8 + length)) throw new Error('PNG 数据块校验失败')
    if (offset === 8 && type !== 'IHDR') throw new Error('PNG 缺少首部')
    if (type === 'IHDR') {
      if (width || length !== 13) throw new Error('PNG 首部无效')
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = header.getUint32(0); height = header.getUint32(4); dimensions(width, height)
      depth = data[8]!; color = data[9]!; interlace = data[12]!
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8], 2: [8], 3: [1, 2, 4, 8], 4: [8], 6: [8] }
      if (depth === 16) throw new Error('16 位 PNG 需要先转为 8 位图片；当前操作不会静默丢失颜色精度')
      if (!depths[color]?.includes(depth) || data[10] || data[11] || interlace > 1) throw new Error('PNG 像素格式无效')
    } else if (type === 'acTL') throw new Error('动画图片需要明确逐帧编辑范围，当前操作仅支持静态图片')
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
  let raw: Uint8Array
  try { raw = unzlibSync(concat(compressed), { out: new Uint8Array(expected + 1) }) }
  catch { throw new Error('PNG 像素无法解压') }
  if (raw.length !== expected) throw new Error('PNG 像素长度无效')
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

async function decodeOriginal(bytes: Uint8Array, mimeType: string): Promise<DecodedImage> {
  if (mimeType === 'image/png') return decodeImageTransformPng(bytes)
  if (!['image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('当前确定性操作支持静态 PNG、JPEG、WebP；其他格式请先转为静态 PNG')
  // VP8X animation flag / ANIM chunk: never flatten animation silently.
  if (mimeType === 'image/webp') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const type = String.fromCharCode(...bytes.subarray(at, at + 4)), view = new DataView(bytes.buffer, bytes.byteOffset + at)
      const length = view.getUint32(4, true)
      if (type === 'ANIM' || (type === 'VP8X' && (bytes[at + 8]! & 2))) throw new Error('动画 WebP 需要明确逐帧编辑范围')
      at += 8 + length + (length & 1)
    }
  }
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
  try {
    const image = new Image(); image.src = url
    await image.decode(); dimensions(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('原图像素读取器不可用')
    context.drawImage(image, 0, 0)
    return { width: canvas.width, height: canvas.height, data: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data) }
  } catch (error) { throw new Error(`原图解码失败：${error instanceof Error ? error.message : String(error)}`) }
  finally { URL.revokeObjectURL(url) }
}

/** Pure original-pixel operations; inputs and unselected pixel channels remain untouched. */
export function transformImagePixels(source: ImagePixels, input: ImageTransformInput, signal?: AbortSignal) {
  dimensions(source.width, source.height)
  if (source.data.length !== source.width * source.height * 4) throw new Error('原图 RGBA 像素长度无效')
  let image: ImagePixels = { ...source, data: source.data.slice() }, changed = false
  const effects: Array<{ kind: string; changedPixels: number; targetColor?: string }> = []
  const regionIn = (region: { x: number; y: number; width: number; height: number }) => {
    if (region.x + region.width > image.width || region.y + region.height > image.height) throw new Error('指定区域超出当前原图尺寸，请明确图片内的范围')
    return region
  }
  for (const operation of input.operations) {
    abort(signal)
    if (operation.kind === 'replace-color') {
      const region = regionIn(operation.region ?? { x: 0, y: 0, width: image.width, height: image.height }), mask = operation.mask
      if (mask && (mask.width !== image.width || mask.height !== image.height || mask.bits.length !== image.width * image.height)) throw new Error('mask 必须与当前原图尺寸完全一致')
      const rgb = (value: string) => [1, 3, 5].map(start => Number.parseInt(value.slice(start, start + 2), 16))
      const from = rgb(operation.sourceColor), to = rgb(operation.targetColor)
      let selected = 0, matched = 0, changedPixels = 0
      for (let y = region.y; y < region.y + region.height; y++) {
        abort(signal)
        for (let x = region.x; x < region.x + region.width; x++) {
          const pixel = y * image.width + x, i = pixel * 4
          if (mask && mask.bits[pixel] !== '1') continue
          selected++
          if (image.data[i + 3] === 0 || (image.data[i]! - from[0]!) ** 2 + (image.data[i + 1]! - from[1]!) ** 2
            + (image.data[i + 2]! - from[2]!) ** 2 > operation.tolerance ** 2) continue
          matched++
          if (image.data[i] !== to[0] || image.data[i + 1] !== to[1] || image.data[i + 2] !== to[2]) {
            image.data.set(to, i); changedPixels++
          }
        }
      }
      if (!selected) throw new Error('mask 与指定区域没有共同选中的像素，请明确修改范围')
      if (!matched) throw new Error(`指定区域中没有匹配 ${operation.sourceColor} 的可见像素，请调整源颜色、容差或区域`)
      changed ||= changedPixels > 0; effects.push({ kind: operation.kind, changedPixels, targetColor: operation.targetColor })
    } else {
      const crop = operation.kind === 'crop' ? regionIn(operation.region) : { x: 0, y: 0, width: image.width, height: image.height }
      const width = operation.kind === 'resize' ? operation.width : crop.width, height = operation.kind === 'resize' ? operation.height : crop.height
      dimensions(width, height)
      const data = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++) {
        abort(signal)
        for (let x = 0; x < width; x++) {
          const from = ((crop.y + Math.min(crop.height - 1, Math.floor(y * crop.height / height))) * image.width
            + crop.x + Math.min(crop.width - 1, Math.floor(x * crop.width / width))) * 4
          data.set(image.data.subarray(from, from + 4), (y * width + x) * 4)
        }
      }
      const modified = width !== image.width || height !== image.height || crop.x !== 0 || crop.y !== 0
      changed ||= modified; effects.push({ kind: operation.kind, changedPixels: modified ? width * height : 0 })
      image = { width, height, data }
    }
  }
  return { ...image, changed, effects }
}

export async function transformImageAsset(bytes: Uint8Array, mimeType: string, rawInput: unknown, signal?: AbortSignal) {
  const input = imageTransformInputSchema.parse(rawInput)
  abort(signal)
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('原图为空或超过 64 MiB')
  const source = await decodeOriginal(bytes, mimeType)
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  abort(signal)
  const result = transformImagePixels(source, input, signal)
  const output = result.changed ? encodeImageTransformPng(result, source.metadata) : bytes.slice()
  if (result.changed) {
    const verified = decodeImageTransformPng(output)
    if (verified.width !== result.width || verified.height !== result.height
      || verified.data.some((byte, i) => byte !== result.data[i])) throw new Error('输出 PNG 解码校验失败')
  }
  // Let Stop / session changes reach the existing transaction owner before commit.
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  abort(signal)
  return { bytes: output, width: result.width, height: result.height, changed: result.changed, effects: result.effects }
}
