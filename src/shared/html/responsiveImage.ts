/** Replace candidate URLs while retaining the author's descriptors and spacing. */
export function replaceSrcsetUrls(srcset: string, url: string): string {
  let cursor = 0, copied = 0, result = ''
  while (cursor < srcset.length) {
    while (cursor < srcset.length && /[\s,]/.test(srcset[cursor]!)) cursor++
    const start = cursor
    while (cursor < srcset.length && !/\s/.test(srcset[cursor]!)) cursor++
    let end = cursor
    while (end > start && srcset[end - 1] === ',') end--
    if (end === start) continue
    result += srcset.slice(copied, start) + url
    copied = end
    if (end < cursor) continue
    let depth = 0
    while (cursor < srcset.length) {
      const character = srcset[cursor++]
      if (character === '(') depth++
      else if (character === ')') depth--
      else if (character === ',' && depth === 0) break
    }
  }
  return result + srcset.slice(copied)
}

export function imageMimeFromUrl(url: string): string | undefined {
  const dataType = /^data:(image\/[^;,]+)/i.exec(url)?.[1]
  if (dataType) return dataType.toLowerCase()
  const extension = /\.([a-z]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase()
  return extension ? ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' } as Record<string, string>)[extension] : undefined
}
