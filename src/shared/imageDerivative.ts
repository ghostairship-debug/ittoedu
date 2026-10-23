/** A delivery demand is a CSS display requirement, not a limit on editor originals. */
export interface ImageDerivativeDemand {
  width: number
  height: number
  dpr?: number
  fit?: 'contain' | 'cover' | 'stretch'
  /** Normalized source window; delivery retains the whole image so existing crop coordinates stay valid. */
  crop?: { x: number; y: number; width: number; height: number }
  quality?: 'photo' | 'detail' | 'original'
}

export interface ImageDerivativeTraits {
  animated: boolean
  alpha: boolean
  lossy: boolean
}

export function imageDerivativeTraits(bytes: Uint8Array, mimeType: string): ImageDerivativeTraits {
  const word = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let animated = mimeType === 'image/gif', alpha = false, lossy = mimeType === 'image/jpeg'
  if (mimeType === 'image/png') {
    alpha = bytes[25] === 4 || bytes[25] === 6
    for (let at = 8; at + 12 <= bytes.length;) {
      const size = view.getUint32(at), type = word(at + 4)
      if (size > bytes.length - at - 12) break
      if (type === 'acTL') animated = true
      if (type === 'tRNS') alpha = true
      at += size + 12
    }
  }
  if (mimeType === 'image/webp') {
    // An unrecognized or incomplete carrier must not be flattened into its first frame.
    if (word(0) !== 'RIFF' || word(8) !== 'WEBP') return { animated: true, alpha: false, lossy: false }
    let image = false
    for (let at = 12; at + 8 <= bytes.length;) {
      const size = view.getUint32(at + 4, true), type = word(at)
      if (size > bytes.length - at - 8) return { animated: true, alpha, lossy }
      if (type === 'ANIM' || type === 'ANMF' || type === 'VP8X' && !!(bytes[at + 8]! & 2)) animated = true
      if (type === 'ALPH' || type === 'VP8X' && !!(bytes[at + 8]! & 16)) alpha = true
      if (type === 'VP8 ') { lossy = true; image = true }
      if (type === 'VP8L') { image = true; alpha ||= size >= 5 && !!(bytes[at + 12]! & 16) }
      at += 8 + size + (size & 1)
    }
    if (!image) animated = true
  }
  return { animated, alpha, lossy }
}

export function imageDerivativePlan(source: { width: number; height: number }, mimeType: string,
  traits: ImageDerivativeTraits, demand?: ImageDerivativeDemand) {
  const preserve = traits.animated || mimeType === 'image/svg+xml' || demand?.quality === 'original'
  let ratio = 1
  if (!preserve && demand && [demand.width, demand.height].every(value => Number.isFinite(value) && value > 0)) {
    const crop = demand.crop
    const cropWidth = crop && Number.isFinite(crop.width) && crop.width > 0 ? Math.min(1, crop.width) : 1
    const cropHeight = crop && Number.isFinite(crop.height) && crop.height > 0 ? Math.min(1, crop.height) : 1
    const dpr = demand.dpr && Number.isFinite(demand.dpr) && demand.dpr > 0 ? demand.dpr : 2
    const scaleX = demand.width * dpr / (source.width * cropWidth)
    const scaleY = demand.height * dpr / (source.height * cropHeight)
    ratio = Math.min(1, demand.fit === 'cover' || demand.fit === 'stretch' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY))
  }
  const width = Math.max(1, Math.ceil(source.width * ratio)), height = Math.max(1, Math.ceil(source.height * ratio))
  const resized = width !== source.width || height !== source.height
  // An unclassified PNG may be a chart or text. Keep its lossless carrier until
  // the caller explicitly identifies photography; never infer content from size.
  // Transparent lossy carriers keep the more conservative colour quality below.
  const outputMimeType = demand?.quality === 'detail' || mimeType === 'image/png' && demand?.quality !== 'photo' ? 'image/png' : 'image/webp'
  const quality = demand?.quality === 'detail' ? 0.96 : traits.alpha ? 0.94 : demand?.quality === 'photo' ? 0.84 : 0.9
  const encode = !preserve && (resized || !traits.lossy || mimeType === 'image/jpeg')
    && (outputMimeType !== mimeType || resized || mimeType === 'image/webp' && !traits.lossy)
  return { width, height, outputMimeType, quality, resized, encode }
}
