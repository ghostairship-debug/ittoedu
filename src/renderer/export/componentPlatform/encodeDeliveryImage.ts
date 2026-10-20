import type { ComponentAsset } from '../../../shared/contracts/component-platform'
import { assetBytesSha256 } from '../../project/assetManager'

type DeliveryImage = { bytes: Uint8Array; mimeType: string }
const deliveryEncoding = { mimeType: 'image/webp', quality: 0.9 } as const
// The renderer document owns its derivatives. Content identity, rather than asset
// IDs or filenames, also shares work across repeated exports and duplicate assets.
const derivatives = new WeakMap<Document, Map<string, Promise<DeliveryImage | undefined>>>()

function isAnimatedPng(bytes: Uint8Array): boolean {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)
    if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'acTL') return true
    offset += size + 12
  }
  return false
}

function isStaticLosslessWebp(bytes: Uint8Array): boolean {
  const chunk = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.length < 20 || chunk(0) !== 'RIFF' || chunk(8) !== 'WEBP') return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let lossless = false
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = chunk(offset), size = view.getUint32(offset + 4, true), end = offset + 8 + size
    if (end > bytes.length) return false
    if (type === 'ANIM' || type === 'ANMF' || type === 'VP8X' && size > 0 && (bytes[offset + 8]! & 2) !== 0) return false
    if (type === 'VP8 ') return false // Already lossy: preserve its existing delivery encoding.
    if (type === 'VP8L') lossless = true
    offset = end + (size & 1)
  }
  return lossless
}

async function encode(bytes: Uint8Array, mimeType: string, dom: Document): Promise<DeliveryImage | undefined> {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
  const image = new dom.defaultView!.Image()
  try {
    image.src = url
    await image.decode()
    const canvas = dom.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(image, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, deliveryEncoding.mimeType, deliveryEncoding.quality))
    if (!blob || blob.type !== deliveryEncoding.mimeType || blob.size >= bytes.length) return
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Encode a delivery derivative at its real intrinsic resolution; author bytes remain untouched. */
export async function encodeDeliveryImage(asset: Readonly<ComponentAsset>, bytes: Uint8Array, dom: Document, signal?: AbortSignal): Promise<(DeliveryImage & { filename?: string }) | undefined> {
  signal?.throwIfAborted()
  // Lossless WebP needs the same delivery candidate as PNG. Keep already lossy
  // WebP and every animated carrier, including APNG, in its original encoding.
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType ?? '')
    || asset.mimeType === 'image/png' && isAnimatedPng(bytes)
    || asset.mimeType === 'image/webp' && !isStaticLosslessWebp(bytes)) return
  const key = `${asset.mimeType}:${deliveryEncoding.mimeType}:${deliveryEncoding.quality}:${await assetBytesSha256(bytes)}`
  signal?.throwIfAborted()
  let cache = derivatives.get(dom)
  if (!cache) { cache = new Map(); derivatives.set(dom, cache) }
  let pending = cache.get(key)
  if (!pending) {
    // Cancellation belongs to each export, not to another export sharing this
    // same encoding. Failed decodes can be retried after their cause is fixed.
    pending = encode(bytes, asset.mimeType!, dom).catch(error => { cache.delete(key); throw error })
    cache.set(key, pending)
  }
  const result = await pending
  signal?.throwIfAborted()
  if (!result) return
  return { ...result, ...(asset.filename ? { filename: `${asset.filename.replace(/\.[^.]+$/, '')}.webp` } : {}) }
}
