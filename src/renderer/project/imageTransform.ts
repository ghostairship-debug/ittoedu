import { imageTransformInputSchema, type ImageTransformInput } from '../../shared/imageTransformContract'
import { decodeImageTransformPng, encodeImageTransformPng, dimensions, ImageTransformSourceError, type ImagePixels, type DecodedImage, type ImageTransformSourceInspection } from '../../shared/imageTransform'
export { decodeImageTransformPng, encodeImageTransformPng, ImageTransformSourceError, type ImagePixels, type ImageTransformSourceInspection } from '../../shared/imageTransform'
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('图片变换已停止') }

async function decodeOriginal(bytes: Uint8Array, mimeType: string): Promise<DecodedImage> {
  if (mimeType === 'image/png') return decodeImageTransformPng(bytes)
  if (!['image/jpeg', 'image/webp'].includes(mimeType)) throw new ImageTransformSourceError('unsupported', '当前确定性操作支持静态 PNG、JPEG、WebP；其他格式请先转为静态 PNG')
  // VP8X animation flag / ANIM chunk: never flatten animation silently.
  if (mimeType === 'image/webp') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const type = String.fromCharCode(...bytes.subarray(at, at + 4)), view = new DataView(bytes.buffer, bytes.byteOffset + at)
      const length = view.getUint32(4, true)
      if (type === 'ANIM' || (type === 'VP8X' && (bytes[at + 8]! & 2))) throw new ImageTransformSourceError('unsupported', '动画 WebP 需要明确逐帧编辑范围')
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

async function readImageTransformSource(bytes: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<DecodedImage> {
  abort(signal)
  try {
    if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('原图为空或超过 64 MiB')
    const source = await decodeOriginal(bytes, mimeType)
    abort(signal)
    return source
  } catch (error) {
    abort(signal)
    if (error instanceof ImageTransformSourceError) throw error
    throw new ImageTransformSourceError('failed', error instanceof Error ? error.message : String(error))
  }
}

/** Read-only source readiness, not an operation check or a commit receipt. */
export async function inspectImageTransformSource(bytes: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<ImageTransformSourceInspection> {
  try {
    const source = await readImageTransformSource(bytes, mimeType, signal)
    return { status: 'ready', width: source.width, height: source.height }
  } catch (error) {
    if (error instanceof ImageTransformSourceError) return { status: error.status, code: error.code, message: error.message }
    throw error
  }
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
  const source = await readImageTransformSource(bytes, mimeType, signal)
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
