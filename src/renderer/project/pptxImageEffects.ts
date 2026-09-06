import { pptxReject, xmlChildren, xmlFirst } from './pptxPackage'

export interface PptxColorChange { from: readonly number[]; to: readonly number[]; useAlpha: boolean }
export function parsePptxColorChanges(blip: Element | undefined, color: (node: Element | undefined, fallback: string) => string): PptxColorChange[] {
  const rgba = (node: Element | undefined) => {
    if (!node) return pptxReject('图片颜色替换', '颜色定义缺失')
    const rgb = color(node, '#000000').slice(1)
    const alpha = Number(xmlFirst(node, 'alpha')?.getAttribute('val') ?? 100000) / 100000
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) pptxReject('图片颜色替换', '透明度无效')
    return [...[0, 2, 4].map(offset => Number.parseInt(rgb.slice(offset, offset + 2), 16)), Math.round(alpha * 255)]
  }
  return (blip ? xmlChildren(blip) : []).flatMap(effect => {
    if (effect.localName === 'extLst') return []
    if (effect.localName !== 'clrChange') return pptxReject('图片效果', `尚不支持 ${effect.localName}，请先把效果应用到图片文件`)
    return [{ from: rgba(xmlFirst(effect, 'clrFrom')), to: rgba(xmlFirst(effect, 'clrTo')), useAlpha: !['0', 'false'].includes(effect.getAttribute('useA') ?? '1') }]
  })
}

/** Replace only matching channels; unrelated colors and existing antialiased alpha remain intact. */
export function applyPptxColorChanges(pixels: Uint8ClampedArray, changes: readonly PptxColorChange[]): void {
  for (const change of changes) for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== change.from[0] || pixels[i + 1] !== change.from[1] || pixels[i + 2] !== change.from[2] || (change.useAlpha && pixels[i + 3] !== change.from[3])) continue
    pixels[i] = change.to[0]!; pixels[i + 1] = change.to[1]!; pixels[i + 2] = change.to[2]!
    if (change.useAlpha) pixels[i + 3] = change.to[3]!
  }
}

export async function renderPptxColorChanges(bytes: Uint8Array, mimeType: string, changes: readonly PptxColorChange[]): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('图片颜色替换解码失败')); image.src = url })
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片颜色替换尺寸无效')
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法创建图片颜色替换画布')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    applyPptxColorChanges(pixels.data, changes)
    context.putImageData(pixels, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片颜色替换编码失败')), 'image/png'))
    return new Uint8Array(await blob.arrayBuffer())
  } finally { URL.revokeObjectURL(url) }
}
